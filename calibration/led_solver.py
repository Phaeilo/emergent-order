#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import numpy as np
import cv2
import sys
import argparse
from typing import Dict, Tuple, List, Optional
from scipy.optimize import least_squares
from dataclasses import dataclass, field
from collections import defaultdict
import json

# uv run led_solver.py ../tri2/p0_fixed.txt ../tri2/p1_fixed.txt ../tri2/p4_fixed.txt --output test_results_complete.txt --viz test_results_complete.html

@dataclass
class OutlierRejectionConfig:
    """Configuration for outlier detection and rejection"""
    # Feature flags
    enable_prefilter: bool = True
    apply_ransac_masks: bool = True
    use_pnp_ransac: bool = True
    validate_triangulation: bool = True
    iterative_ba: bool = True

    # Thresholds
    mad_threshold: float = 3.0  # MAD factor for statistical outlier detection
    ransac_threshold: float = 1.0  # RANSAC threshold in pixels
    reproj_threshold: float = 2.0  # Reprojection error threshold in pixels
    pnp_ransac_threshold: float = 2.0  # PnP RANSAC threshold in pixels
    ba_outlier_factor: float = 2.5  # MAD factor for BA outlier detection
    min_consistent_views: int = 3  # Minimum views required for triangulation (for 6+ cameras)

    # Iteration limits
    pnp_refine_iterations: int = 3
    ba_iterations: int = 3

    @classmethod
    def create_robust(cls):
        """Robust mode for 6+ cameras with mixed errors"""
        return cls()  # Use defaults

    @classmethod
    def create_conservative(cls):
        """Conservative mode for noisy data or fewer cameras"""
        return cls(
            mad_threshold=4.0,
            ransac_threshold=1.5,
            reproj_threshold=2.5,
            pnp_ransac_threshold=2.5,
            ba_outlier_factor=3.0,
            min_consistent_views=2,
            pnp_refine_iterations=2,
            ba_iterations=2
        )

    @classmethod
    def create_legacy(cls):
        """Legacy mode - disables all outlier rejection"""
        return cls(
            enable_prefilter=False,
            apply_ransac_masks=False,
            use_pnp_ransac=False,
            validate_triangulation=False,
            iterative_ba=False
        )

    @classmethod
    def from_json(cls, filepath: str):
        """Load configuration from JSON file"""
        with open(filepath, 'r') as f:
            config_dict = json.load(f)
        return cls(**config_dict)


class ObservationStats:
    """Track observation rejections throughout the pipeline"""

    def __init__(self):
        self.observations: Dict[Tuple[str, int], Dict] = {}  # (led_id, cam_idx) -> {status, reason, error}
        self.rejected_count_by_camera: Dict[int, int] = defaultdict(int)
        self.rejected_count_by_led: Dict[str, int] = defaultdict(int)
        self.rejection_reasons: Dict[str, int] = defaultdict(int)
        self.total_observations = 0
        self.rejected_observations = 0

    def record_observation(self, led_id: str, cam_idx: int, status: str, reason: str = "", error: float = 0.0):
        """Record an observation and its status"""
        key = (led_id, cam_idx)
        self.observations[key] = {
            'status': status,  # 'accepted' or 'rejected'
            'reason': reason,
            'error': error
        }
        self.total_observations += 1

        if status == 'rejected':
            self.rejected_observations += 1
            self.rejected_count_by_camera[cam_idx] += 1
            self.rejected_count_by_led[led_id] += 1
            if reason:
                self.rejection_reasons[reason] += 1

    def get_camera_stats(self, cam_idx: int, total_leds_in_camera: int) -> Dict:
        """Get rejection statistics for a specific camera"""
        rejected = self.rejected_count_by_camera.get(cam_idx, 0)
        rejection_rate = rejected / total_leds_in_camera if total_leds_in_camera > 0 else 0.0
        return {
            'total': total_leds_in_camera,
            'rejected': rejected,
            'accepted': total_leds_in_camera - rejected,
            'rejection_rate': rejection_rate
        }

    def get_led_stats(self, led_id: str, total_cameras_seeing_led: int) -> Dict:
        """Get rejection statistics for a specific LED"""
        rejected = self.rejected_count_by_led.get(led_id, 0)
        rejection_rate = rejected / total_cameras_seeing_led if total_cameras_seeing_led > 0 else 0.0
        return {
            'total': total_cameras_seeing_led,
            'rejected': rejected,
            'accepted': total_cameras_seeing_led - rejected,
            'rejection_rate': rejection_rate
        }

    def print_summary(self):
        """Print summary statistics"""
        if self.total_observations == 0:
            print("No observations recorded")
            return

        print("\n" + "="*50)
        print("OUTLIER REJECTION SUMMARY")
        print("="*50)
        print(f"Total observations: {self.total_observations}")
        print(f"Rejected: {self.rejected_observations} ({100*self.rejected_observations/self.total_observations:.1f}%)")
        print(f"Accepted: {self.total_observations - self.rejected_observations} ({100*(self.total_observations - self.rejected_observations)/self.total_observations:.1f}%)")

        if self.rejection_reasons:
            print("\nRejection reasons:")
            for reason, count in sorted(self.rejection_reasons.items(), key=lambda x: x[1], reverse=True):
                print(f"  {reason}: {count} ({100*count/self.rejected_observations:.1f}%)")


def parse_led_file(filepath: str) -> Tuple[Tuple[int, int], Dict[str, Tuple[float, float]]]:
    """
    Parse LED coordinate file.
    
    Returns:
        frame_size: (width, height) tuple
        led_coords: dict mapping LED_ID to (x, y) coordinates
    """
    led_coords = {}
    frame_size = None
    
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
                
            parts = line.split()
            if parts[0] == 'FRAME_SIZE':
                frame_size = (int(parts[1]), int(parts[2]))
            elif parts[0].startswith('LED_'):
                led_id = parts[0]
                x, y = float(parts[1]), float(parts[2])
                led_coords[led_id] = (x, y)
    
    if frame_size is None:
        raise ValueError(f"No FRAME_SIZE found in {filepath}")
    
    return frame_size, led_coords

def match_leds(led_coords1: Dict[str, Tuple[float, float]], 
               led_coords2: Dict[str, Tuple[float, float]]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Match LEDs between two views and return corresponding point arrays.
    
    Returns:
        pts1: Nx2 array of points from first view
        pts2: Nx2 array of points from second view  
        led_ids: List of LED IDs in matching order
    """
    common_leds = set(led_coords1.keys()) & set(led_coords2.keys())
    
    if len(common_leds) < 5:
        raise ValueError(f"Need at least 5 matching LEDs, found {len(common_leds)}")
    
    led_ids = sorted(list(common_leds))
    pts1 = np.array([led_coords1[led_id] for led_id in led_ids], dtype=float)
    pts2 = np.array([led_coords2[led_id] for led_id in led_ids], dtype=float)
    
    return pts1, pts2, led_ids

def create_camera_matrix(frame_size: Tuple[int, int]) -> np.ndarray:
    """
    Create camera intrinsic matrix based on frame size.
    Assumes focal length approximately equal to max(width, height)
    and principal point at center.
    """
    width, height = frame_size
    f = max(width, height)
    cx, cy = width / 2, height / 2
    
    K = np.array([[f, 0, cx],
                  [0, f, cy],
                  [0, 0, 1]], dtype=float)
    return K

def solve_cameras_and_triangulate(pts1: np.ndarray, pts2: np.ndarray, 
                                K: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Solve for camera poses and triangulate 3D points.
    
    Returns:
        R: Rotation matrix of second camera relative to first
        t: Translation vector of second camera relative to first
        camera1_pos: Position of first camera in world coordinates
        camera2_pos: Position of second camera in world coordinates
        pts3d: Nx3 array of triangulated 3D points
    """
    # Compute Essential matrix
    E, mask = cv2.findEssentialMat(pts1, pts2, K, method=cv2.RANSAC, prob=0.999, threshold=1.0)
    
    if E is None:
        raise ValueError("Failed to compute Essential matrix")
    
    # Recover relative camera pose
    _, R, t, mask_pose = cv2.recoverPose(E, pts1, pts2, K)
    
    # Build projection matrices
    # First camera at origin with identity rotation
    P0 = K @ np.hstack((np.eye(3), np.zeros((3,1))))
    P1 = K @ np.hstack((R, t))
    
    # Triangulate points
    pts4d_h = cv2.triangulatePoints(P0, P1, pts1.T, pts2.T)
    pts3d = (pts4d_h / pts4d_h[3])[:3].T  # Convert from homogeneous to 3D
    
    # Camera positions in world coordinates
    # First camera is at origin
    camera1_pos = np.array([0, 0, 0])
    
    # Second camera position: -R^T * t (inverse transformation)
    camera2_pos = -R.T @ t.flatten()
    
    return R, t, camera1_pos, camera2_pos, pts3d

def generate_3d_visualization(led_ids: List[str], pts3d: np.ndarray, 
                            cam1_pos: np.ndarray, cam2_pos: np.ndarray,
                            R: np.ndarray, output_path: str):
    """
    Generate an interactive 3D HTML visualization using Three.js
    """
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LED Triangulation 3D Visualization</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            background-color: #000;
            font-family: Arial, sans-serif;
            overflow: hidden;
        }}
        #info {{
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
            max-width: 300px;
        }}
        #controls {{
            position: absolute;
            top: 10px;
            right: 10px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div id="info">
        <h3>LED Triangulation Results</h3>
        <p><strong>LEDs:</strong> {len(led_ids)} points</p>
        <p><strong>Cameras:</strong> 2 positions</p>
        <p><strong>Baseline:</strong> {np.linalg.norm(cam2_pos - cam1_pos):.3f} units</p>
        <p><strong>Controls:</strong> Mouse to rotate, wheel to zoom</p>
    </div>
    
    <div id="controls">
        <button onclick="toggleLEDs()">Toggle LEDs</button><br>
        <button onclick="toggleCameras()">Toggle Cameras</button><br>
        <button onclick="toggleLabels()">Toggle Labels</button><br>
        <button onclick="resetView()">Reset View</button>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    
    <script>
        // Scene setup
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
        const renderer = new THREE.WebGLRenderer({{ antialias: true }});
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x111111);
        document.body.appendChild(renderer.domElement);

        // Controls
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // Groups for toggling visibility
        const ledGroup = new THREE.Group();
        const cameraGroup = new THREE.Group();
        const labelGroup = new THREE.Group();
        scene.add(ledGroup);
        scene.add(cameraGroup);
        scene.add(labelGroup);

        // LED data
        const ledData = ["""

    # Add LED coordinates
    for i, led_id in enumerate(led_ids):
        x, y, z = pts3d[i]
        html_content += f"""
            {{ id: "{led_id}", x: {x:.6f}, y: {y:.6f}, z: {z:.6f} }},"""
    
    html_content += f"""
        ];

        // Camera data
        const cameraData = [
            {{ id: "Camera_1", x: {cam1_pos[0]:.6f}, y: {cam1_pos[1]:.6f}, z: {cam1_pos[2]:.6f} }},
            {{ id: "Camera_2", x: {cam2_pos[0]:.6f}, y: {cam2_pos[1]:.6f}, z: {cam2_pos[2]:.6f} }}
        ];

        // Create LEDs
        ledData.forEach(led => {{
            const geometry = new THREE.SphereGeometry(0.01, 16, 16);
            const material = new THREE.MeshLambertMaterial({{ color: 0x00ff00 }});
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(led.x, led.y, led.z);
            sphere.userData = {{ id: led.id }};
            ledGroup.add(sphere);

            // LED labels
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 128;
            canvas.height = 32;
            context.fillStyle = 'rgba(0,0,0,0.8)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = 'white';
            context.font = '14px Arial';
            context.textAlign = 'center';
            context.fillText(led.id, canvas.width/2, 20);
            
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({{ map: texture }});
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.set(led.x, led.y + 0.03, led.z);
            sprite.scale.set(0.1, 0.025, 1);
            labelGroup.add(sprite);
        }});

        // Create cameras
        cameraData.forEach((cam, index) => {{
            // Camera body
            const geometry = new THREE.BoxGeometry(0.02, 0.015, 0.03);
            const material = new THREE.MeshLambertMaterial({{ color: index === 0 ? 0xff0000 : 0x0000ff }});
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(cam.x, cam.y, cam.z);
            cube.userData = {{ id: cam.id }};
            
            // Camera orientation and direction
            let rotMatrix = null;
            const direction = new THREE.Vector3(0, 0, -0.1);
            
            if (index === 1) {{
                rotMatrix = new THREE.Matrix4();
                rotMatrix.set(
                    {R[0,0]:.6f}, {R[0,1]:.6f}, {R[0,2]:.6f}, 0,
                    {R[1,0]:.6f}, {R[1,1]:.6f}, {R[1,2]:.6f}, 0,
                    {R[2,0]:.6f}, {R[2,1]:.6f}, {R[2,2]:.6f}, 0,
                    0, 0, 0, 1
                );
                cube.applyMatrix4(rotMatrix);
                direction.applyMatrix3(new THREE.Matrix3().setFromMatrix4(rotMatrix));
            }}
            
            cameraGroup.add(cube);
            
            const arrowGeometry = new THREE.ConeGeometry(0.005, 0.02, 8);
            const arrowMaterial = new THREE.MeshLambertMaterial({{ color: index === 0 ? 0xff4444 : 0x4444ff }});
            const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
            arrow.position.set(cam.x + direction.x, cam.y + direction.y, cam.z + direction.z);
            arrow.lookAt(cam.x + direction.x * 2, cam.y + direction.y * 2, cam.z + direction.z * 2);
            cameraGroup.add(arrow);

            // Camera labels
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 128;
            canvas.height = 32;
            context.fillStyle = 'rgba(0,0,0,0.8)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = index === 0 ? '#ff4444' : '#4444ff';
            context.font = '14px Arial';
            context.textAlign = 'center';
            context.fillText(cam.id, canvas.width/2, 20);
            
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({{ map: texture }});
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.set(cam.x, cam.y + 0.05, cam.z);
            sprite.scale.set(0.1, 0.025, 1);
            labelGroup.add(sprite);
        }});

        // Add coordinate axes
        const axesHelper = new THREE.AxesHelper(0.2);
        scene.add(axesHelper);

        // Position camera for good initial view
        camera.position.set(0.5, 0.3, 0.8);
        camera.lookAt(0, 0, 0.3);

        // Control functions
        function toggleLEDs() {{
            ledGroup.visible = !ledGroup.visible;
        }}

        function toggleCameras() {{
            cameraGroup.visible = !cameraGroup.visible;
        }}

        function toggleLabels() {{
            labelGroup.visible = !labelGroup.visible;
        }}

        function resetView() {{
            camera.position.set(0.5, 0.3, 0.8);
            camera.lookAt(0, 0, 0.3);
            controls.reset();
        }}

        // Animation loop
        function animate() {{
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }}

        // Handle window resize
        window.addEventListener('resize', () => {{
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }});

        animate();
    </script>
</body>
</html>"""

    with open(output_path, 'w') as f:
        f.write(html_content)

def generate_multi_camera_visualization(led_ids: List[str], led_3d_coords: Dict[str, np.ndarray], 
                                      camera_positions: List[np.ndarray], camera_rotations: List[np.ndarray], 
                                      output_path: str):
    """
    Generate an interactive 3D HTML visualization for multiple cameras using Three.js
    """
    # Count valid cameras
    valid_cameras = [(i, pos, rot) for i, (pos, rot) in enumerate(zip(camera_positions, camera_rotations)) 
                     if pos is not None and rot is not None]
    
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Multi-Camera LED Triangulation 3D Visualization</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            overflow: hidden;
        }}
        
        #container {{
            position: relative;
            width: 100vw;
            height: 100vh;
        }}
        
        #info {{
            position: absolute;
            top: 15px;
            left: 15px;
            color: white;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 10px;
            font-size: 13px;
            max-width: 350px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 100;
        }}
        
        #controls {{
            position: absolute;
            top: 15px;
            right: 15px;
            color: white;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 10px;
            font-size: 13px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 100;
        }}
        
        #camera-coords {{
            position: absolute;
            bottom: 15px;
            left: 15px;
            color: white;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 10px;
            font-size: 12px;
            max-width: 400px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 100;
            font-family: 'Courier New', monospace;
        }}
        
        button {{
            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
            border: none;
            color: white;
            padding: 8px 12px;
            margin: 2px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.3s ease;
        }}
        
        button:hover {{
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        }}
        
        .camera-info {{
            margin: 5px 0;
            padding: 5px;
            border-left: 3px solid;
            padding-left: 10px;
        }}
        
        h3 {{
            margin: 0 0 10px 0;
            color: #64b5f6;
        }}
        
        h4 {{
            margin: 10px 0 5px 0;
            color: #81c784;
        }}
    </style>
</head>
<body>
    <div id="container">
        <div id="info">
            <h3>🎯 LED Triangulation Results</h3>
            <p><strong>LEDs:</strong> {len(led_ids)} triangulated points</p>
            <p><strong>Cameras:</strong> {len(valid_cameras)} solved positions</p>
            <p><strong>Navigation:</strong></p>
            <ul style="margin: 5px 0; padding-left: 20px; font-size: 11px;">
                <li>Left mouse: Rotate view</li>
                <li>Right mouse: Pan view</li>
                <li>Mouse wheel: Zoom in/out</li>
                <li>Double-click: Focus on center</li>
            </ul>
        </div>
        
        <div id="controls">
            <h4>🎮 Scene Controls</h4>
            <button onclick="toggleLEDs()">🔴 Toggle LEDs</button><br>
            <button onclick="toggleCameras()">📷 Toggle Cameras</button><br>
            <button onclick="toggleLabels()">🏷️ Toggle Labels</button><br>
            <button onclick="toggleAxes()">📐 Toggle Axes</button><br>
            <button onclick="resetView()">🔄 Reset View</button><br>
            <button onclick="fitToScene()">🎯 Fit Scene</button>
        </div>
        
        <div id="camera-coords">
            <h4>📷 Camera Coordinates</h4>"""
    
    # Add camera coordinate information
    for i, (cam_idx, pos, rot) in enumerate(valid_cameras):
        color_hex = ['#ff4444', '#4444ff', '#44ff44', '#ffff44', '#ff44ff', '#44ffff', '#ffa544', '#a544ff'][i % 8]
        html_content += f"""
            <div class="camera-info" style="border-left-color: {color_hex};">
                <strong>Camera_{cam_idx}:</strong><br>
                Position: [{pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f}]
            </div>"""
    
    html_content += f"""
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
        // Import OrbitControls
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
        document.head.appendChild(script);
        
        script.onload = function() {{
            initScene();
        }};
        
        function initScene() {{
            // Scene setup
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0a0a0a);
            scene.fog = new THREE.Fog(0x0a0a0a, 10, 200);
            
            // Camera setup
            const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
            
            // Renderer setup
            const renderer = new THREE.WebGLRenderer({{ 
                antialias: true,
                alpha: true,
                powerPreference: "high-performance"
            }});
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputEncoding = THREE.sRGBEncoding;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.2;
            
            document.getElementById('container').appendChild(renderer.domElement);

            // Enhanced lighting setup
            const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
            scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(10, 10, 5);
            directionalLight.castShadow = true;
            directionalLight.shadow.mapSize.width = 2048;
            directionalLight.shadow.mapSize.height = 2048;
            scene.add(directionalLight);
            
            const pointLight = new THREE.PointLight(0x64b5f6, 0.5, 50);
            pointLight.position.set(0, 5, 0);
            scene.add(pointLight);

            // Controls setup
            const controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = false;
            controls.minDistance = 0.1;
            controls.maxDistance = 500;
            controls.maxPolarAngle = Math.PI;
            controls.autoRotate = false;
            controls.autoRotateSpeed = 0.5;

            // Groups for scene organization
            ledGroup = new THREE.Group();
            cameraGroup = new THREE.Group();
            labelGroup = new THREE.Group();
            axesGroup = new THREE.Group();
            
            scene.add(ledGroup);
            scene.add(cameraGroup);
            scene.add(labelGroup);
            scene.add(axesGroup);

            // LED data
            const ledData = ["""

    # Add LED coordinates
    for led_id in led_ids:
        x, y, z = led_3d_coords[led_id]
        html_content += f"""
                {{ id: "{led_id}", x: {x:.6f}, y: {y:.6f}, z: {z:.6f} }},"""
    
    html_content += f"""
            ];

            // Camera data
            const cameraData = ["""
    
    # Add camera data with colors
    colors = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff, 0xffa544, 0xa544ff]
    for i, (cam_idx, pos, rot) in enumerate(valid_cameras):
        color = colors[i % len(colors)]
        html_content += f"""
                {{ 
                    id: "Camera_{cam_idx}", 
                    x: {pos[0]:.6f}, y: {pos[1]:.6f}, z: {pos[2]:.6f}, 
                    rotation: [
                        [{rot[0,0]:.6f}, {rot[0,1]:.6f}, {rot[0,2]:.6f}],
                        [{rot[1,0]:.6f}, {rot[1,1]:.6f}, {rot[1,2]:.6f}],
                        [{rot[2,0]:.6f}, {rot[2,1]:.6f}, {rot[2,2]:.6f}]
                    ], 
                    color: {color:#x}
                }},"""
    
    html_content += f"""
            ];

            // Create enhanced LEDs
            ledData.forEach((led, index) => {{
                // LED sphere with glow effect
                const geometry = new THREE.SphereGeometry(0.02, 32, 32);
                const material = new THREE.MeshPhongMaterial({{ 
                    color: 0x00ff88,
                    emissive: 0x002211,
                    shininess: 100,
                    transparent: true,
                    opacity: 0.9
                }});
                
                const sphere = new THREE.Mesh(geometry, material);
                sphere.position.set(led.x, led.y, led.z);
                sphere.userData = {{ id: led.id, originalScale: 0.02 }};
                sphere.castShadow = true;
                sphere.receiveShadow = true;
                ledGroup.add(sphere);

                // LED glow effect
                const glowGeometry = new THREE.SphereGeometry(0.04, 16, 16);
                const glowMaterial = new THREE.MeshBasicMaterial({{
                    color: 0x00ff88,
                    transparent: true,
                    opacity: 0.2
                }});
                const glow = new THREE.Mesh(glowGeometry, glowMaterial);
                glow.position.copy(sphere.position);
                glow.userData = {{ originalScale: 0.04 }};
                ledGroup.add(glow);

                // Enhanced LED labels
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = 256;
                canvas.height = 64;
                
                // Background
                context.fillStyle = 'rgba(0, 0, 0, 0.8)';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                // Border
                context.strokeStyle = '#00ff88';
                context.lineWidth = 2;
                context.strokeRect(2, 2, canvas.width-4, canvas.height-4);
                
                // Text
                context.fillStyle = 'white';
                context.font = 'bold 20px Arial';
                context.textAlign = 'center';
                context.fillText(ledData[index].id, canvas.width/2, 35);
                context.font = '12px Arial';
                context.fillText(`[${{ledData[index].x.toFixed(2)}}, ${{ledData[index].y.toFixed(2)}}, ${{ledData[index].z.toFixed(2)}}]`, canvas.width/2, 50);
                
                const texture = new THREE.CanvasTexture(canvas);
                const spriteMaterial = new THREE.SpriteMaterial({{ 
                    map: texture,
                    sizeAttenuation: true
                }});
                const sprite = new THREE.Sprite(spriteMaterial);
                sprite.position.set(led.x, led.y + 0.1, led.z);
                sprite.scale.set(0.2, 0.05, 1);
                sprite.userData = {{ originalScale: {{ x: 0.2, y: 0.05, z: 1 }} }};
                labelGroup.add(sprite);
            }});

            // Create enhanced cameras
            cameraData.forEach((cam, index) => {{
                // Camera body (more detailed)
                const bodyGeometry = new THREE.BoxGeometry(0.06, 0.04, 0.08);
                const bodyMaterial = new THREE.MeshPhongMaterial({{ 
                    color: cam.color,
                    shininess: 50
                }});
                const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
                body.position.set(cam.x, cam.y, cam.z);
                body.castShadow = true;
                body.receiveShadow = true;
                body.userData = {{ originalScale: {{ x: 0.06, y: 0.04, z: 0.08 }} }};
                
                // Camera lens
                const lensGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 16);
                const lensMaterial = new THREE.MeshPhongMaterial({{ 
                    color: 0x333333,
                    shininess: 100
                }});
                const lens = new THREE.Mesh(lensGeometry, lensMaterial);
                lens.position.set(0, 0, 0.05);
                lens.rotation.x = Math.PI / 2;
                body.add(lens);
                
                // Apply camera rotation
                const rotMatrix = new THREE.Matrix4();
                rotMatrix.set(
                    cam.rotation[0][0], cam.rotation[0][1], cam.rotation[0][2], 0,
                    cam.rotation[1][0], cam.rotation[1][1], cam.rotation[1][2], 0,
                    cam.rotation[2][0], cam.rotation[2][1], cam.rotation[2][2], 0,
                    0, 0, 0, 1
                );
                body.applyMatrix4(rotMatrix);
                cameraGroup.add(body);

                // Camera viewing direction with better arrow
                const direction = new THREE.Vector3(0, 0, -0.2);
                direction.applyMatrix3(new THREE.Matrix3().setFromMatrix4(rotMatrix));
                
                const arrowGeometry = new THREE.ConeGeometry(0.02, 0.08, 8);
                const arrowMaterial = new THREE.MeshPhongMaterial({{ 
                    color: cam.color,
                    transparent: true,
                    opacity: 0.7
                }});
                const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
                arrow.position.set(cam.x + direction.x, cam.y + direction.y, cam.z + direction.z);
                arrow.lookAt(cam.x + direction.x * 2, cam.y + direction.y * 2, cam.z + direction.z * 2);
                arrow.userData = {{ originalScale: {{ radius: 0.02, height: 0.08 }} }};
                cameraGroup.add(arrow);

                // Enhanced camera labels
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = 256;
                canvas.height = 64;
                
                context.fillStyle = 'rgba(0, 0, 0, 0.8)';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                context.strokeStyle = '#' + cam.color.toString(16).padStart(6, '0');
                context.lineWidth = 2;
                context.strokeRect(2, 2, canvas.width-4, canvas.height-4);
                
                context.fillStyle = '#' + cam.color.toString(16).padStart(6, '0');
                context.font = 'bold 20px Arial';
                context.textAlign = 'center';
                context.fillText(cameraData[index].id, canvas.width/2, 35);
                context.font = '12px Arial';
                context.fillText(`[${{cameraData[index].x.toFixed(2)}}, ${{cameraData[index].y.toFixed(2)}}, ${{cameraData[index].z.toFixed(2)}}]`, canvas.width/2, 50);
                
                const texture = new THREE.CanvasTexture(canvas);
                const spriteMaterial = new THREE.SpriteMaterial({{ 
                    map: texture,
                    sizeAttenuation: true
                }});
                const sprite = new THREE.Sprite(spriteMaterial);
                sprite.position.set(cam.x, cam.y + 0.15, cam.z);
                sprite.scale.set(0.25, 0.06, 1);
                sprite.userData = {{ originalScale: {{ x: 0.25, y: 0.06, z: 1 }} }};
                labelGroup.add(sprite);
            }});

            // Enhanced coordinate axes
            const axesHelper = new THREE.AxesHelper(1);
            axesGroup.add(axesHelper);
            
            // Add grid
            const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
            axesGroup.add(gridHelper);

            // Calculate scene bounds and set up camera
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            [...ledData, ...cameraData].forEach(obj => {{
                minX = Math.min(minX, obj.x); maxX = Math.max(maxX, obj.x);
                minY = Math.min(minY, obj.y); maxY = Math.max(maxY, obj.y);
                minZ = Math.min(minZ, obj.z); maxZ = Math.max(maxZ, obj.z);
            }});
            
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const centerZ = (minZ + maxZ) / 2;
            const sceneSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
            
            // Position camera for optimal view
            const distance = Math.max(sceneSize * 2, 5);
            camera.position.set(centerX + distance * 0.7, centerY + distance * 0.5, centerZ + distance * 0.7);
            camera.lookAt(centerX, centerY, centerZ);
            controls.target.set(centerX, centerY, centerZ);
            controls.update();

            // Function to update object scales based on camera distance
            function updateScales() {{
                const cameraDistance = camera.position.distanceTo(controls.target);
                const baseScaleFactor = Math.max(0.5, Math.min(3.0, cameraDistance / 2.0));
                
                // Update LED spheres and glow effects with better visibility
                ledGroup.traverse((child) => {{
                    if (child.isMesh && child.userData.originalScale !== undefined) {{
                        if (typeof child.userData.originalScale === 'number') {{
                            // For spheres - ensure they're always visible
                            const ledScaleFactor = Math.max(0.8, Math.min(4.0, baseScaleFactor));
                            const newScale = child.userData.originalScale * ledScaleFactor;
                            child.scale.setScalar(newScale);
                        }}
                    }}
                }});
                
                // Update LED labels (sprites) with better readability
                labelGroup.traverse((child) => {{
                    if (child.isSprite && child.userData.originalScale) {{
                        const labelScaleFactor = Math.max(0.6, Math.min(2.0, baseScaleFactor * 0.8));
                        child.scale.set(
                            child.userData.originalScale.x * labelScaleFactor,
                            child.userData.originalScale.y * labelScaleFactor,
                            child.userData.originalScale.z
                        );
                    }}
                }});
                
                // Update camera bodies and arrows
                cameraGroup.traverse((child) => {{
                    if (child.isMesh && child.userData.originalScale) {{
                        if (child.userData.originalScale.x !== undefined) {{
                            // Camera body
                            const cameraScaleFactor = Math.max(0.5, Math.min(2.0, baseScaleFactor));
                            child.scale.set(
                                child.userData.originalScale.x * cameraScaleFactor,
                                child.userData.originalScale.y * cameraScaleFactor,
                                child.userData.originalScale.z * cameraScaleFactor
                            );
                        }} else if (child.userData.originalScale.radius !== undefined) {{
                            // Camera arrow
                            const arrowScaleFactor = Math.max(0.5, Math.min(2.0, baseScaleFactor));
                            child.scale.setScalar(arrowScaleFactor);
                        }}
                    }}
                }});
            }}

            // Animation loop
            function animate() {{
                requestAnimationFrame(animate);
                controls.update();
                updateScales();
                renderer.render(scene, camera);
            }}

            // Handle window resize
            window.addEventListener('resize', () => {{
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }});

            // Global control functions
            window.toggleLEDs = function() {{
                ledGroup.visible = !ledGroup.visible;
            }};

            window.toggleCameras = function() {{
                cameraGroup.visible = !cameraGroup.visible;
            }};

            window.toggleLabels = function() {{
                labelGroup.visible = !labelGroup.visible;
            }};

            window.toggleAxes = function() {{
                axesGroup.visible = !axesGroup.visible;
            }};

            window.resetView = function() {{
                camera.position.set(centerX + distance * 0.7, centerY + distance * 0.5, centerZ + distance * 0.7);
                camera.lookAt(centerX, centerY, centerZ);
                controls.target.set(centerX, centerY, centerZ);
                controls.reset();
            }};

            window.fitToScene = function() {{
                const box = new THREE.Box3();
                scene.traverse(function(object) {{
                    if (object.isMesh) {{
                        box.expandByObject(object);
                    }}
                }});
                
                const size = box.getSize(new THREE.Vector3()).length();
                const center = box.getCenter(new THREE.Vector3());
                
                const fitDistance = size / (2 * Math.atan(Math.PI * camera.fov / 360));
                camera.position.copy(center);
                camera.position.x += fitDistance;
                camera.position.y += fitDistance * 0.5;
                camera.position.z += fitDistance;
                camera.lookAt(center);
                controls.target.copy(center);
                controls.update();
            }};

            animate();
        }}
        
        // Global variables for scene objects (accessible outside initScene)
        let ledGroup, cameraGroup, labelGroup, axesGroup, scene, camera, controls;
        
        // Fallback functions in case initScene hasn't run yet
        window.toggleLEDs = function() {{
            if (ledGroup) ledGroup.visible = !ledGroup.visible;
        }};

        window.toggleCameras = function() {{
            if (cameraGroup) cameraGroup.visible = !cameraGroup.visible;
        }};

        window.toggleLabels = function() {{
            if (labelGroup) labelGroup.visible = !labelGroup.visible;
        }};

        window.toggleAxes = function() {{
            if (axesGroup) axesGroup.visible = !axesGroup.visible;
        }};

        window.resetView = function() {{
            if (camera && controls) {{
                camera.position.set(0, 0, 5);
                camera.lookAt(0, 0, 0);
                controls.target.set(0, 0, 0);
                controls.reset();
            }}
        }};

        window.fitToScene = function() {{
            if (scene && camera && controls) {{
                const box = new THREE.Box3();
                scene.traverse(function(object) {{
                    if (object.isMesh) {{
                        box.expandByObject(object);
                    }}
                }});
                
                const size = box.getSize(new THREE.Vector3()).length();
                const center = box.getCenter(new THREE.Vector3());
                
                const fitDistance = size / (2 * Math.atan(Math.PI * camera.fov / 360));
                camera.position.copy(center);
                camera.position.x += fitDistance;
                camera.position.y += fitDistance * 0.5;
                camera.position.z += fitDistance;
                camera.lookAt(center);
                controls.target.copy(center);
                controls.update();
            }}
        }};
    </script>
</body>
</html>"""

    with open(output_path, 'w') as f:
        f.write(html_content)

def rodrigues_to_mat(rvec):
    """Convert Rodrigues rotation vector to rotation matrix"""
    R, _ = cv2.Rodrigues(rvec)
    return R

def mat_to_rodrigues(R):
    """Convert rotation matrix to Rodrigues rotation vector"""
    rvec, _ = cv2.Rodrigues(R)
    return rvec.ravel()

def project_point(X, rvec, tvec, K):
    """Project 3D point to 2D using camera parameters"""
    R = rodrigues_to_mat(rvec)
    Xc = R @ X + tvec
    x = K @ Xc
    return x[:2] / x[2]

def bundle_adjustment_residuals(params, N_points, N_cams, observations, K_matrices):
    """
    Residual function for bundle adjustment optimization

    Args:
        params: Flattened parameters [points (N*3), cameras (N_cams*6)]
        N_points: Number of 3D points
        N_cams: Number of cameras
        observations: List of (point_idx, cam_idx, observed_uv) tuples
        K_matrices: List of camera intrinsic matrices

    Returns:
        Array of residuals (reprojection errors)
    """
    # Unpack parameters
    pts = params[:N_points*3].reshape((N_points, 3))
    cam_params = params[N_points*3:].reshape((N_cams, 6))

    residuals = []
    for point_idx, cam_idx, observed_uv in observations:
        rvec = cam_params[cam_idx, :3]
        tvec = cam_params[cam_idx, 3:]
        K = K_matrices[cam_idx]

        # Project 3D point to 2D
        projected_uv = project_point(pts[point_idx], rvec, tvec, K)

        # Compute reprojection error
        error = projected_uv - observed_uv
        residuals.extend(error)

    return np.array(residuals)

def build_sparse_jacobian_structure(N_points, N_cams, observations):
    """
    Build the sparse Jacobian structure for bundle adjustment.

    Each observation (2D reprojection error) depends on:
    - 3 parameters from the corresponding 3D point (x, y, z)
    - 6 parameters from the corresponding camera (rvec: 3, tvec: 3)

    This creates a very sparse Jacobian that can significantly speed up optimization.

    Args:
        N_points: Number of 3D points
        N_cams: Number of cameras
        observations: List of (point_idx, cam_idx, observed_uv) tuples

    Returns:
        Sparse matrix structure (scipy sparse matrix format)
    """
    from scipy.sparse import lil_matrix

    N_residuals = len(observations) * 2  # Each observation gives 2 residuals (u, v)
    N_params = N_points * 3 + N_cams * 6

    # Use lil_matrix for efficient incremental construction
    A = lil_matrix((N_residuals, N_params), dtype=int)

    for obs_idx, (point_idx, cam_idx, _) in enumerate(observations):
        # Each observation contributes 2 residuals (u and v components)
        residual_idx_u = obs_idx * 2
        residual_idx_v = obs_idx * 2 + 1

        # Mark dependencies on 3D point parameters (3 params per point)
        point_param_start = point_idx * 3
        for j in range(3):  # x, y, z
            A[residual_idx_u, point_param_start + j] = 1
            A[residual_idx_v, point_param_start + j] = 1

        # Mark dependencies on camera parameters (6 params per camera)
        cam_param_start = N_points * 3 + cam_idx * 6
        for j in range(6):  # rvec (3) + tvec (3)
            A[residual_idx_u, cam_param_start + j] = 1
            A[residual_idx_v, cam_param_start + j] = 1

    return A

def optimize_bundle_adjustment(led_3d_coords: Dict[str, np.ndarray], 
                             camera_positions: List[np.ndarray], 
                             camera_rotations: List[np.ndarray],
                             led_observations: List[Dict[str, Tuple[float, float]]],
                             frame_sizes: List[Tuple[int, int]]) -> Tuple[Dict[str, np.ndarray], List[np.ndarray], List[np.ndarray]]:
    """
    Optimize camera poses and 3D LED positions using bundle adjustment
    
    Args:
        led_3d_coords: Initial 3D LED coordinates
        camera_positions: Initial camera positions
        camera_rotations: Initial camera rotations
        led_observations: LED observations for each camera
        frame_sizes: Frame sizes for each camera
        
    Returns:
        Optimized LED coordinates, camera positions, and camera rotations
    """
    print("Running bundle adjustment optimization...")
    
    # Create LED ID to index mapping
    led_ids = sorted(led_3d_coords.keys())
    led_id_to_idx = {led_id: i for i, led_id in enumerate(led_ids)}
    
    # Build observation list: (point_idx, cam_idx, observed_uv)
    observations = []
    for cam_idx, cam_obs in enumerate(led_observations):
        if camera_positions[cam_idx] is None:
            continue  # Skip cameras that weren't solved
            
        for led_id, uv in cam_obs.items():
            if led_id in led_id_to_idx:
                point_idx = led_id_to_idx[led_id]
                observations.append((point_idx, cam_idx, np.array(uv)))
    
    if len(observations) < 10:
        print(f"Warning: Only {len(observations)} observations for bundle adjustment, skipping optimization")
        return led_3d_coords, camera_positions, camera_rotations
    
    print(f"Optimizing with {len(observations)} observations")
    
    # Prepare initial parameters
    N_points = len(led_ids)
    N_cams = len(camera_positions)
    
    # Initial 3D points
    initial_points = np.array([led_3d_coords[led_id] for led_id in led_ids])
    x0_points = initial_points.ravel()
    
    # Initial camera parameters (only for solved cameras)
    x0_cams = []
    valid_cam_indices = []
    for cam_idx in range(N_cams):
        if camera_positions[cam_idx] is not None:
            # Convert world-to-camera transformation
            R_world_to_cam = camera_rotations[cam_idx].T
            t_world_to_cam = -R_world_to_cam @ camera_positions[cam_idx]
            
            rvec = mat_to_rodrigues(R_world_to_cam)
            tvec = t_world_to_cam
            
            x0_cams.extend(rvec)
            x0_cams.extend(tvec)
            valid_cam_indices.append(cam_idx)
        else:
            # Use dummy parameters for unsolved cameras
            x0_cams.extend([0, 0, 0, 0, 0, 0])
    
    x0_cams = np.array(x0_cams)
    x0 = np.hstack([x0_points, x0_cams])
    
    # Create camera intrinsic matrices
    K_matrices = [create_camera_matrix(frame_size) for frame_size in frame_sizes]

    # Build sparse Jacobian structure for faster optimization
    print("Building sparse Jacobian structure...")
    jac_sparsity = build_sparse_jacobian_structure(N_points, N_cams, observations)
    print(f"Jacobian shape: {jac_sparsity.shape}, sparsity: {jac_sparsity.nnz}/{jac_sparsity.shape[0]*jac_sparsity.shape[1]} ({100*jac_sparsity.nnz/(jac_sparsity.shape[0]*jac_sparsity.shape[1]):.2f}%)")

    # Run optimization with sparse Jacobian and relaxed tolerances
    try:
        result = least_squares(
            bundle_adjustment_residuals,
            x0,
            args=(N_points, N_cams, observations, K_matrices),
            jac_sparsity=jac_sparsity,  # Use sparse Jacobian structure for speed
            loss="huber",
            max_nfev=500,      # Reduced from 1000 to 300
            ftol=1e-4,         # Function tolerance for convergence
            xtol=1e-6,         # Parameter tolerance for convergence
            gtol=1e-4,         # Gradient tolerance for convergence
            verbose=2
        )
        
        print(f"Bundle adjustment completed: {result.message}")
        print(f"Initial cost: {np.sum(bundle_adjustment_residuals(x0, N_points, N_cams, observations, K_matrices)**2):.6f}")
        print(f"Final cost: {result.cost:.6f}")
        
        # Unpack optimized results
        opt_points = result.x[:N_points*3].reshape((N_points, 3))
        opt_cam_params = result.x[N_points*3:].reshape((N_cams, 6))
        
        # Update LED coordinates
        optimized_led_coords = {}
        for i, led_id in enumerate(led_ids):
            optimized_led_coords[led_id] = opt_points[i]
        
        # Update camera poses
        optimized_positions = camera_positions.copy()
        optimized_rotations = camera_rotations.copy()
        
        for cam_idx in range(N_cams):
            if camera_positions[cam_idx] is not None:
                rvec = opt_cam_params[cam_idx, :3]
                tvec = opt_cam_params[cam_idx, 3:]
                
                # Convert back to world coordinates
                R_world_to_cam = rodrigues_to_mat(rvec)
                R_cam_to_world = R_world_to_cam.T
                t_world = -R_cam_to_world @ tvec
                
                optimized_positions[cam_idx] = t_world
                optimized_rotations[cam_idx] = R_cam_to_world
        
        return optimized_led_coords, optimized_positions, optimized_rotations
        
    except Exception as e:
        print(f"Bundle adjustment failed: {e}")
        print("Returning initial solution")
        return led_3d_coords, camera_positions, camera_rotations


def triangulate_multi_view_robust(led_id: str,
                                   cam_indices: List[int],
                                   image_points: List[Tuple[float, float]],
                                   projection_matrices: List[np.ndarray],
                                   K_matrices: List[np.ndarray],
                                   camera_positions: List[np.ndarray],
                                   camera_rotations: List[np.ndarray],
                                   config: OutlierRejectionConfig,
                                   stats: ObservationStats) -> Optional[np.ndarray]:
    """
    Robust multi-view triangulation with outlier rejection.

    For 2-3 views: Simple validation with depth and reprojection checks
    For 4+ views: Iteratively remove views with high reprojection error

    Returns:
        3D point if successful, None if validation fails
    """
    if len(cam_indices) < 2:
        return None

    # Helper function to triangulate using DLT (Direct Linear Transform)
    def triangulate_dlt(proj_matrices, img_pts):
        """Triangulate using direct linear transform"""
        A = []
        for i, P in enumerate(proj_matrices):
            x, y = img_pts[i]
            A.append(x * P[2] - P[0])
            A.append(y * P[2] - P[1])
        A = np.array(A)
        _, _, Vt = np.linalg.svd(A)
        pt_3d_h = Vt[-1]
        return pt_3d_h[:3] / pt_3d_h[3]

    # Helper function to compute reprojection errors
    def compute_reprojection_errors(pt_3d, proj_matrices, img_pts):
        """Compute reprojection error for each view"""
        errors = []
        for i, P in enumerate(proj_matrices):
            # Project 3D point
            pt_proj_h = P @ np.append(pt_3d, 1.0)
            pt_proj = pt_proj_h[:2] / pt_proj_h[2]
            # Compute error
            error = np.linalg.norm(pt_proj - np.array(img_pts[i]))
            errors.append(error)
        return np.array(errors)

    # Helper function to check if point is in front of camera
    def is_in_front_of_camera(pt_3d, cam_pos, cam_rot):
        """Check if 3D point is in front of camera"""
        # Transform to camera frame
        R_world_to_cam = cam_rot.T
        t_world_to_cam = -R_world_to_cam @ cam_pos
        pt_cam = R_world_to_cam @ pt_3d + t_world_to_cam
        return pt_cam[2] > 0.01  # At least 1cm in front

    # For 2-3 views: Simple validation
    if len(cam_indices) <= 3:
        if len(cam_indices) == 2:
            # Use OpenCV's optimized 2-view triangulation
            pts4d_h = cv2.triangulatePoints(projection_matrices[0], projection_matrices[1],
                                          np.array([image_points[0]]).T,
                                          np.array([image_points[1]]).T)
            pt_3d = (pts4d_h / pts4d_h[3])[:3, 0]
        else:
            # DLT for 3 views
            pt_3d = triangulate_dlt(projection_matrices, image_points)

        if not config.validate_triangulation:
            # Legacy mode: no validation
            for cam_idx in cam_indices:
                stats.record_observation(led_id, cam_idx, 'accepted', '', 0.0)
            return pt_3d

        # Validate: check depth
        all_in_front = True
        for i, cam_idx in enumerate(cam_indices):
            if not is_in_front_of_camera(pt_3d, camera_positions[cam_idx], camera_rotations[cam_idx]):
                all_in_front = False
                break

        if not all_in_front:
            for cam_idx in cam_indices:
                stats.record_observation(led_id, cam_idx, 'rejected', 'negative_depth', 0.0)
            return None

        # Validate: check reprojection errors
        errors = compute_reprojection_errors(pt_3d, projection_matrices, image_points)
        mean_error = np.mean(errors)
        max_error = np.max(errors)

        if max_error > config.reproj_threshold or mean_error > config.reproj_threshold * 0.8:
            for i, cam_idx in enumerate(cam_indices):
                stats.record_observation(led_id, cam_idx, 'rejected', 'high_reproj_error', errors[i])
            return None

        # All checks passed
        for i, cam_idx in enumerate(cam_indices):
            stats.record_observation(led_id, cam_idx, 'accepted', '', errors[i])
        return pt_3d

    # For 4+ views: Iterative outlier removal
    active_indices = list(range(len(cam_indices)))

    for iteration in range(3):  # Max 3 iterations
        if len(active_indices) < 3:
            break

        # Get active data
        active_proj_matrices = [projection_matrices[i] for i in active_indices]
        active_img_points = [image_points[i] for i in active_indices]

        # Triangulate
        pt_3d = triangulate_dlt(active_proj_matrices, active_img_points)

        if not config.validate_triangulation:
            # Legacy mode: no validation
            for cam_idx in cam_indices:
                stats.record_observation(led_id, cam_idx, 'accepted', '', 0.0)
            return pt_3d

        # Check depth for all active views
        valid_depth = []
        for i in active_indices:
            cam_idx = cam_indices[i]
            valid = is_in_front_of_camera(pt_3d, camera_positions[cam_idx], camera_rotations[cam_idx])
            valid_depth.append(valid)

        if not all(valid_depth):
            # Remove views with invalid depth
            active_indices = [active_indices[i] for i in range(len(active_indices)) if valid_depth[i]]
            continue

        # Compute reprojection errors for active views
        errors = compute_reprojection_errors(pt_3d, active_proj_matrices, active_img_points)

        # Check if any view has high error
        max_error_idx = np.argmax(errors)
        max_error = errors[max_error_idx]

        if max_error > config.reproj_threshold and len(active_indices) > config.min_consistent_views:
            # Remove worst view and retry
            removed_idx = active_indices.pop(max_error_idx)
            cam_idx = cam_indices[removed_idx]
            stats.record_observation(led_id, cam_idx, 'rejected', 'high_reproj_error_multiview', max_error)
        else:
            # All errors acceptable, or we can't remove more views
            mean_error = np.mean(errors)
            if mean_error < config.reproj_threshold:
                # Success: record all active as accepted
                for i in active_indices:
                    cam_idx = cam_indices[i]
                    idx_in_active = active_indices.index(i)
                    stats.record_observation(led_id, cam_idx, 'accepted', '', errors[idx_in_active])

                # Record removed views as already rejected (done above)
                removed_indices = set(range(len(cam_indices))) - set(active_indices)
                for i in removed_indices:
                    cam_idx = cam_indices[i]
                    # Already recorded as rejected
                    pass

                return pt_3d
            else:
                # Still too high error, reject all
                for i, cam_idx in enumerate(cam_indices):
                    if i in active_indices:
                        idx_in_active = active_indices.index(i)
                        stats.record_observation(led_id, cam_idx, 'rejected', 'mean_reproj_error_too_high', errors[idx_in_active])
                return None

    # Failed to converge to good solution
    for cam_idx in cam_indices:
        stats.record_observation(led_id, cam_idx, 'rejected', 'triangulation_failed', 0.0)
    return None


def solve_multi_camera_system(led_observations: List[Dict[str, Tuple[float, float]]],
                             frame_sizes: List[Tuple[int, int]],
                             orientation_hints: Dict[str, List[str]] = None,
                             config: Optional[OutlierRejectionConfig] = None,
                             stats: Optional[ObservationStats] = None) -> Tuple[List[np.ndarray], List[np.ndarray], Dict[str, np.ndarray]]:
    """
    Solve for multiple camera poses and LED positions using bundle adjustment approach.

    Args:
        led_observations: List of dicts mapping LED_ID to (x, y) coordinates for each camera
        frame_sizes: List of frame sizes for each camera
        orientation_hints: Optional dict mapping direction to list of LED IDs for orientation alignment
                          e.g., {'top': ['LED_50', 'LED_33'], 'bottom': ['LED_3']}
        config: Optional outlier rejection configuration
        stats: Optional observation statistics tracker

    Returns:
        camera_positions: List of camera positions in world coordinates
        camera_rotations: List of camera rotation matrices
        led_3d_coords: Dict mapping LED_ID to 3D coordinates
    """
    # Initialize config and stats if not provided
    if config is None:
        config = OutlierRejectionConfig.create_robust()
    if stats is None:
        stats = ObservationStats()

    # Find all LEDs that appear in at least 2 cameras
    all_leds = set()
    for obs in led_observations:
        all_leds.update(obs.keys())
    
    # Filter LEDs that appear in at least 2 cameras for initial solution
    initial_leds = []
    for led_id in all_leds:
        count = sum(1 for obs in led_observations if led_id in obs)
        if count >= 2:
            initial_leds.append(led_id)
    
    if len(initial_leds) < 4:
        raise ValueError(f"Need at least 4 LEDs visible in multiple cameras, found {len(initial_leds)}")
    
    print(f"Found {len(initial_leds)} LEDs visible in multiple cameras for initial solution")
    print(f"Total LEDs across all cameras: {len(all_leds)}")
    
    # Use first two cameras with most common LEDs to establish initial coordinate system
    camera_pairs = []
    for i in range(len(led_observations)):
        for j in range(i + 1, len(led_observations)):
            common = set(led_observations[i].keys()) & set(led_observations[j].keys())
            camera_pairs.append((i, j, len(common), common))
    
    # Sort by number of common LEDs
    camera_pairs.sort(key=lambda x: x[2], reverse=True)
    best_pair = camera_pairs[0]
    cam1_idx, cam2_idx = best_pair[0], best_pair[1]
    
    print(f"Using cameras {cam1_idx} and {cam2_idx} as reference pair ({best_pair[2]} common LEDs)")
    
    # Solve initial stereo pair using only LEDs visible in both cameras
    common_leds = list(best_pair[3])
    pts1 = np.array([led_observations[cam1_idx][led_id] for led_id in common_leds], dtype=float)
    pts2 = np.array([led_observations[cam2_idx][led_id] for led_id in common_leds], dtype=float)
    
    K1 = create_camera_matrix(frame_sizes[cam1_idx])
    K2 = create_camera_matrix(frame_sizes[cam2_idx])
    
    # For simplicity, assume same intrinsics (can be improved)
    K = K1
    
    # Solve stereo pair
    E, mask = cv2.findEssentialMat(pts1, pts2, K, method=cv2.RANSAC, prob=0.999, threshold=1.0)
    if E is None:
        raise ValueError("Failed to compute Essential matrix for reference pair")

    _, R_rel, t_rel, mask_pose = cv2.recoverPose(E, pts1, pts2, K)

    # STAGE 2: Apply RANSAC masks to filter outliers
    if config.apply_ransac_masks:
        # Combine masks from both RANSAC operations
        mask_combined = (mask.ravel() > 0) & (mask_pose.ravel() > 0)
        inlier_indices = np.where(mask_combined)[0]

        print(f"RANSAC filtering: {len(inlier_indices)}/{len(common_leds)} inliers "
              f"({100*len(inlier_indices)/len(common_leds):.1f}%)")

        # Record rejected observations in stats
        for i, led_id in enumerate(common_leds):
            if mask_combined[i]:
                stats.record_observation(led_id, cam1_idx, 'accepted', '', 0.0)
                stats.record_observation(led_id, cam2_idx, 'accepted', '', 0.0)
            else:
                stats.record_observation(led_id, cam1_idx, 'rejected', 'ransac_essential_matrix', 0.0)
                stats.record_observation(led_id, cam2_idx, 'rejected', 'ransac_essential_matrix', 0.0)

        # Filter to inliers only
        pts1 = pts1[inlier_indices]
        pts2 = pts2[inlier_indices]
        common_leds = [common_leds[i] for i in inlier_indices]

        if len(common_leds) < 5:
            raise ValueError(f"Too few inliers after RANSAC filtering: {len(common_leds)}")

    # Build initial projection matrices
    P1 = K @ np.hstack((np.eye(3), np.zeros((3,1))))  # First camera at origin
    P2 = K @ np.hstack((R_rel, t_rel))                # Second camera

    # Triangulate initial 3D points (now using filtered points)
    pts4d_h = cv2.triangulatePoints(P1, P2, pts1.T, pts2.T)
    initial_3d = (pts4d_h / pts4d_h[3])[:3].T

    # Initialize camera poses
    camera_positions = [None] * len(led_observations)
    camera_rotations = [None] * len(led_observations)

    camera_positions[cam1_idx] = np.array([0, 0, 0])
    camera_rotations[cam1_idx] = np.eye(3)
    camera_positions[cam2_idx] = -R_rel.T @ t_rel.flatten()
    camera_rotations[cam2_idx] = R_rel.T

    # Initialize 3D LED positions from stereo pair
    led_3d_coords = {}
    for i, led_id in enumerate(common_leds):
        led_3d_coords[led_id] = initial_3d[i]
    
    # Solve remaining cameras using PnP
    for cam_idx in range(len(led_observations)):
        if camera_positions[cam_idx] is not None:
            continue  # Already solved
            
        # Find LEDs visible in this camera that we already have 3D coordinates for
        visible_leds = []
        image_points = []
        object_points = []
        
        for led_id in led_observations[cam_idx]:
            if led_id in led_3d_coords:
                visible_leds.append(led_id)
                image_points.append(led_observations[cam_idx][led_id])
                object_points.append(led_3d_coords[led_id])
        
        if len(visible_leds) < 4:
            print(f"Warning: Camera {cam_idx} has only {len(visible_leds)} known LEDs, skipping")
            continue
        
        image_points = np.array(image_points, dtype=float)
        object_points = np.array(object_points, dtype=float)
        
        K_cam = create_camera_matrix(frame_sizes[cam_idx])

        # STAGE 3: Solve PnP with RANSAC outlier rejection
        if config.use_pnp_ransac:
            success, rvec, tvec, inliers = cv2.solvePnPRansac(
                object_points, image_points, K_cam, None,
                reprojectionError=config.pnp_ransac_threshold,
                confidence=0.99,
                iterationsCount=1000,
                flags=cv2.SOLVEPNP_ITERATIVE
            )

            if success and inliers is not None:
                inlier_mask = np.zeros(len(visible_leds), dtype=bool)
                inlier_mask[inliers.ravel()] = True

                # Record observations
                for i, led_id in enumerate(visible_leds):
                    if inlier_mask[i]:
                        stats.record_observation(led_id, cam_idx, 'accepted', '', 0.0)
                    else:
                        stats.record_observation(led_id, cam_idx, 'rejected', 'pnp_ransac', 0.0)

                print(f"PnP RANSAC for camera {cam_idx}: {np.sum(inlier_mask)}/{len(visible_leds)} inliers "
                      f"({100*np.sum(inlier_mask)/len(visible_leds):.1f}%)")
        else:
            # Legacy mode: use standard solvePnP
            success, rvec, tvec = cv2.solvePnP(object_points, image_points, K_cam, None)

        if success:
            R_cam, _ = cv2.Rodrigues(rvec)
            camera_rotations[cam_idx] = R_cam.T  # World to camera -> camera to world
            camera_positions[cam_idx] = -R_cam.T @ tvec.flatten()
            print(f"Solved camera {cam_idx} pose using {len(visible_leds)} LEDs")
        else:
            print(f"Failed to solve camera {cam_idx} pose")
    
    # Triangulate ALL remaining LEDs using all available cameras (including those visible by only some cameras)
    for led_id in all_leds:
        if led_id in led_3d_coords:
            continue  # Already triangulated from stereo pair
            
        # Find cameras that see this LED and have known poses
        cam_indices = []
        image_points = []
        projection_matrices = []
        
        for cam_idx in range(len(led_observations)):
            if (led_id in led_observations[cam_idx] and 
                camera_positions[cam_idx] is not None):
                cam_indices.append(cam_idx)
                image_points.append(led_observations[cam_idx][led_id])
                
                # Build projection matrix
                R = camera_rotations[cam_idx].T  # Camera to world -> world to camera
                t = -R @ camera_positions[cam_idx].reshape(3, 1)
                K_cam = create_camera_matrix(frame_sizes[cam_idx])
                P = K_cam @ np.hstack((R, t))
                projection_matrices.append(P)
        
        if len(cam_indices) >= 2:
            # STAGE 4: Use robust triangulation with outlier rejection
            K_matrices = [create_camera_matrix(frame_sizes[cam_idx]) for cam_idx in cam_indices]

            pt_3d = triangulate_multi_view_robust(
                led_id, cam_indices, image_points, projection_matrices,
                K_matrices, camera_positions, camera_rotations, config, stats
            )

            if pt_3d is not None:
                led_3d_coords[led_id] = pt_3d
                print(f"Triangulated {led_id} using {len(cam_indices)} cameras")
            else:
                print(f"Warning: {led_id} failed validation with {len(cam_indices)} cameras")
        elif len(cam_indices) == 1:
            print(f"Warning: {led_id} only visible in 1 camera, cannot triangulate")
            stats.record_observation(led_id, cam_indices[0], 'rejected', 'single_view_only', 0.0)
    
    # Run bundle adjustment optimization to refine the solution
    print("\n" + "="*50)
    print("BUNDLE ADJUSTMENT OPTIMIZATION")
    print("="*50)
    
    optimized_led_coords, optimized_positions, optimized_rotations = optimize_bundle_adjustment(
        led_3d_coords, camera_positions, camera_rotations, led_observations, frame_sizes
    )

    # Apply orientation alignment if hints provided
    if orientation_hints:
        print("\n" + "="*50)
        print("ORIENTATION ALIGNMENT")
        print("="*50)

        # Debug: show what we're looking for
        print("\nLooking for hint LEDs:")
        for direction, led_ids in orientation_hints.items():
            print(f"  {direction}: {led_ids}")

        # Debug: show sample of available LEDs
        available_leds = sorted(list(optimized_led_coords.keys()))
        print(f"\nAvailable LEDs in triangulated point cloud: {len(available_leds)} total")
        print(f"  Sample: {available_leds[:10]}")

        # Check which hint LEDs are actually found
        found_hints = {}
        missing_hints = {}
        for direction, led_ids in orientation_hints.items():
            found = [lid for lid in led_ids if lid in optimized_led_coords]
            missing = [lid for lid in led_ids if lid not in optimized_led_coords]
            if found:
                found_hints[direction] = found
            if missing:
                missing_hints[direction] = missing

        if found_hints:
            print("\nFound hint LEDs:")
            for direction, led_ids in found_hints.items():
                print(f"  {direction}: {led_ids}")

        if missing_hints:
            print("\nMissing hint LEDs (not in triangulated data):")
            for direction, led_ids in missing_hints.items():
                print(f"  {direction}: {led_ids}")

        R_align = compute_alignment_rotation(optimized_led_coords, orientation_hints)

        print("Alignment rotation matrix:")
        print(R_align)

        # Rotate LED coordinates
        for led_id in optimized_led_coords:
            optimized_led_coords[led_id] = R_align @ optimized_led_coords[led_id]

        # Rotate camera poses
        for cam_idx in range(len(optimized_positions)):
            if optimized_positions[cam_idx] is not None:
                optimized_positions[cam_idx] = R_align @ optimized_positions[cam_idx]
                optimized_rotations[cam_idx] = R_align @ optimized_rotations[cam_idx]

        print("Orientation alignment applied")

    # Normalize point cloud: center at origin and scale to [-1, 1]
    print("\n" + "="*50)
    print("NORMALIZING POINT CLOUD")
    print("="*50)

    # Compute centroid of LED positions
    led_positions = np.array(list(optimized_led_coords.values()))
    centroid = np.mean(led_positions, axis=0)
    print(f"Original centroid: [{centroid[0]:.3f}, {centroid[1]:.3f}, {centroid[2]:.3f}]")

    # Center at origin
    for led_id in optimized_led_coords:
        optimized_led_coords[led_id] = optimized_led_coords[led_id] - centroid

    for cam_idx in range(len(optimized_positions)):
        if optimized_positions[cam_idx] is not None:
            optimized_positions[cam_idx] = optimized_positions[cam_idx] - centroid

    # Find maximum absolute coordinate value
    led_positions_centered = np.array(list(optimized_led_coords.values()))
    max_coord = np.max(np.abs(led_positions_centered))
    print(f"Maximum absolute coordinate: {max_coord:.3f}")

    # Scale to [-1, 1]
    scale_factor = 1.0 / max_coord
    print(f"Scale factor: {scale_factor:.3f}")

    for led_id in optimized_led_coords:
        optimized_led_coords[led_id] = optimized_led_coords[led_id] * scale_factor

    for cam_idx in range(len(optimized_positions)):
        if optimized_positions[cam_idx] is not None:
            optimized_positions[cam_idx] = optimized_positions[cam_idx] * scale_factor

    print("Point cloud normalized: centered at origin, scaled to [-1, 1]")

    return optimized_positions, optimized_rotations, optimized_led_coords

def compute_alignment_rotation(led_3d_coords: Dict[str, np.ndarray],
                               orientation_hints: Dict[str, List[str]]) -> np.ndarray:
    """
    Compute optimal rotation matrix to align point cloud with orientation hints.

    Strategy:
    1. Build target coordinate frame from hints (X=right, Y=up, Z=front)
    2. Build current coordinate frame from LED positions
    3. Compute rotation via weighted SVD

    Args:
        led_3d_coords: Dict mapping LED_ID to 3D coordinates
        orientation_hints: Dict mapping direction to list of LED IDs
                          e.g., {'top': ['LED_50', 'LED_33'], 'bottom': ['LED_3']}

    Returns:
        3x3 rotation matrix that transforms current coords to aligned coords
    """

    def resolve_led_id(hint_id: str, available_ids: Dict[str, np.ndarray]) -> str:
        """
        Resolve a hint LED ID to an actual LED ID in the data.
        Tries multiple matching strategies:
        1. Exact match
        2. Fuzzy match (e.g., "LED_019" matches "LED_1_019" or "LED_1_19")
        """
        # Try exact match first
        if hint_id in available_ids:
            return hint_id

        # Extract the number from hint_id (e.g., "LED_019" -> "019" and "19")
        # Handle formats like "LED_019", "LED_19", etc.
        parts = hint_id.split('_')
        if len(parts) >= 2:
            number_padded = parts[-1]  # Keep with padding, e.g., "019"
            number_unpadded = parts[-1].lstrip('0') or '0'  # Remove leading zeros, e.g., "19"

            # Try fuzzy match: look for LED IDs ending with "_<number>"
            # Try both padded and unpadded versions
            for available_id in available_ids.keys():
                if available_id.endswith(f'_{number_padded}') or available_id.endswith(f'_{number_unpadded}'):
                    print(f"  Matched hint '{hint_id}' to '{available_id}'")
                    return available_id

        return None

    # Extract hint vectors from LED positions
    current_axes = []
    target_axes = []
    weights = []

    # Vertical axis (Y): up/down hints (HIGHEST PRIORITY)
    if 'top' in orientation_hints or 'bottom' in orientation_hints:
        top_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('top', [])
                    if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]
        bottom_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('bottom', [])
                       if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]

        if top_leds and bottom_leds:
            current_up = np.mean(top_leds, axis=0) - np.mean(bottom_leds, axis=0)
            current_up /= np.linalg.norm(current_up)
            current_axes.append(current_up)
            target_axes.append(np.array([0.0, 1.0, 0.0]))  # +Y is up
            weights.append(2.0)  # Double weight for vertical (user's priority)
        elif top_leds:
            # Only top: assume up is away from centroid
            centroid = np.mean(list(led_3d_coords.values()), axis=0)
            current_up = np.mean(top_leds, axis=0) - centroid
            current_up /= np.linalg.norm(current_up)
            current_axes.append(current_up)
            target_axes.append(np.array([0.0, 1.0, 0.0]))
            weights.append(1.5)
        elif bottom_leds:
            # Only bottom: assume down is toward centroid
            centroid = np.mean(list(led_3d_coords.values()), axis=0)
            current_down = centroid - np.mean(bottom_leds, axis=0)
            current_down /= np.linalg.norm(current_down)
            current_axes.append(current_down)
            target_axes.append(np.array([0.0, -1.0, 0.0]))  # Pointing down
            weights.append(1.5)

    # Horizontal axis (X): left/right hints
    if 'left' in orientation_hints or 'right' in orientation_hints:
        left_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('left', [])
                     if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]
        right_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('right', [])
                      if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]

        if left_leds and right_leds:
            current_right = np.mean(right_leds, axis=0) - np.mean(left_leds, axis=0)
            current_right /= np.linalg.norm(current_right)
            current_axes.append(current_right)
            target_axes.append(np.array([1.0, 0.0, 0.0]))  # +X is right
            weights.append(1.0)

    # Depth axis (Z): front/back hints
    if 'front' in orientation_hints or 'back' in orientation_hints:
        front_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('front', [])
                      if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]
        back_leds = [led_3d_coords[resolved] for hint_id in orientation_hints.get('back', [])
                     if (resolved := resolve_led_id(hint_id, led_3d_coords)) is not None]

        if front_leds and back_leds:
            current_front = np.mean(front_leds, axis=0) - np.mean(back_leds, axis=0)
            current_front /= np.linalg.norm(current_front)
            current_axes.append(current_front)
            target_axes.append(np.array([0.0, 0.0, 1.0]))  # +Z is front
            weights.append(1.0)

    if len(current_axes) == 0:
        print("Warning: No valid orientation hints found, skipping alignment")
        return np.eye(3)

    # Weighted SVD for optimal rotation
    # Build weighted cross-covariance matrix
    current_axes = np.array(current_axes)
    target_axes = np.array(target_axes)
    weights = np.array(weights)

    # H = sum_i w_i * target_i * current_i^T
    H = np.zeros((3, 3))
    for i in range(len(weights)):
        H += weights[i] * np.outer(target_axes[i], current_axes[i])

    # SVD: H = U S V^T, optimal rotation is R = U V^T
    U, S, Vt = np.linalg.svd(H)
    R = U @ Vt

    # Ensure proper rotation (det = +1, not reflection)
    if np.linalg.det(R) < 0:
        Vt[-1, :] *= -1
        R = U @ Vt

    # Validate alignment quality
    for i in range(len(current_axes)):
        aligned = R @ current_axes[i]
        dot_product = np.dot(aligned, target_axes[i])
        if dot_product < 0.7:  # Less than ~45 degrees
            print(f"Warning: Poor alignment for axis {i} (dot product: {dot_product:.3f})")

    return R

def parse_orientation_hints(args):
    """Parse orientation hint arguments into dict of LED ID lists.

    Args:
        args: Parsed command-line arguments

    Returns:
        Dict mapping direction to list of LED IDs
        e.g., {'top': ['LED_50', 'LED_33'], 'bottom': ['LED_3', 'LED_4', 'LED_5']}
    """
    hints = {}
    for direction in ['top', 'bottom', 'left', 'right', 'front', 'back']:
        arg_val = getattr(args, direction, None)
        if arg_val:
            # Parse LED IDs - accept either "50,33" or "LED_50,LED_33" format
            led_ids = []
            for led_id in arg_val.split(','):
                led_id = led_id.strip()
                # If it's just a number, prepend "LED_"
                if led_id.isdigit():
                    led_ids.append(f"LED_{int(led_id):03d}")
                else:
                    led_ids.append(led_id)
            hints[direction] = led_ids
    return hints

def main():
    parser = argparse.ArgumentParser(description='LED triangulation solver - supports multiple cameras')
    parser.add_argument('files', nargs='+', help='LED coordinate files (2 or more)')
    parser.add_argument('--output', '-o', help='Output file for results (optional)')
    parser.add_argument('--viz', '-v', help='Generate 3D visualization HTML file (optional)')
    parser.add_argument('--top', type=str, help='Comma-separated LED numbers near top (e.g., "50,33")')
    parser.add_argument('--bottom', type=str, help='Comma-separated LED numbers near bottom')
    parser.add_argument('--left', type=str, help='Comma-separated LED numbers near left')
    parser.add_argument('--right', type=str, help='Comma-separated LED numbers near right')
    parser.add_argument('--front', type=str, help='Comma-separated LED numbers near front')
    parser.add_argument('--back', type=str, help='Comma-separated LED numbers near back')
    parser.add_argument('--outlier-mode', type=str, choices=['robust', 'conservative', 'legacy'],
                        default='robust', help='Outlier rejection mode (default: robust)')
    parser.add_argument('--outlier-config', type=str, help='Path to custom outlier rejection config JSON file')

    args = parser.parse_args()

    if len(args.files) < 2:
        print("Error: Need at least 2 input files")
        sys.exit(1)

    # Parse orientation hints
    orientation_hints = parse_orientation_hints(args)
    if orientation_hints:
        print("\nOrientation hints provided:")
        for direction, led_ids in orientation_hints.items():
            print(f"  {direction}: {', '.join(led_ids)}")

    # Create outlier rejection configuration
    if args.outlier_config:
        print(f"\nLoading custom outlier rejection config from {args.outlier_config}")
        config = OutlierRejectionConfig.from_json(args.outlier_config)
    else:
        if args.outlier_mode == 'robust':
            config = OutlierRejectionConfig.create_robust()
            print("\nUsing robust outlier rejection mode")
        elif args.outlier_mode == 'conservative':
            config = OutlierRejectionConfig.create_conservative()
            print("\nUsing conservative outlier rejection mode")
        else:  # legacy
            config = OutlierRejectionConfig.create_legacy()
            print("\nUsing legacy mode (outlier rejection disabled)")

    # Create observation statistics tracker
    stats = ObservationStats()

    try:
        # Parse all input files
        led_observations = []
        frame_sizes = []

        for i, filepath in enumerate(args.files):
            print(f"Reading {filepath}...")
            frame_size, led_coords = parse_led_file(filepath)
            led_observations.append(led_coords)
            frame_sizes.append(frame_size)
            print(f"  Camera {i}: {len(led_coords)} LEDs, frame size {frame_size[0]}x{frame_size[1]}")

        # Solve multi-camera system
        camera_positions, camera_rotations, led_3d_coords = solve_multi_camera_system(
            led_observations, frame_sizes, orientation_hints=orientation_hints,
            config=config, stats=stats
        )
        
        # Print results
        print("\n" + "="*50)
        print("MULTI-CAMERA SOLUTION")
        print("="*50)
        print(f"Total cameras: {len(args.files)}")
        print(f"Solved cameras: {sum(1 for pos in camera_positions if pos is not None)}")
        print(f"Total LEDs triangulated: {len(led_3d_coords)}")
        
        print("\nCamera positions:")
        for i, pos in enumerate(camera_positions):
            if pos is not None:
                print(f"  Camera {i}: [{pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f}]")
            else:
                print(f"  Camera {i}: [FAILED TO SOLVE]")
        
        print("\n" + "="*50)
        print("3D LED COORDINATES")
        print("="*50)
        led_ids = sorted(led_3d_coords.keys())
        for led_id in led_ids:
            x, y, z = led_3d_coords[led_id]
            print(f"{led_id}: [{x:.3f}, {y:.3f}, {z:.3f}]")
        
        # Save to output file if specified
        if args.output:
            with open(args.output, 'w') as f:
                f.write("# Multi-Camera LED Triangulation Results\n")
                f.write(f"# Number of cameras: {len(args.files)}\n")
                f.write(f"# Solved cameras: {sum(1 for pos in camera_positions if pos is not None)}\n")
                f.write(f"# Number of LEDs: {len(led_3d_coords)}\n\n")
                
                f.write("# Camera Positions\n")
                for i, pos in enumerate(camera_positions):
                    if pos is not None:
                        f.write(f"CAMERA_{i} {pos[0]:.6f} {pos[1]:.6f} {pos[2]:.6f}\n")
                    else:
                        f.write(f"CAMERA_{i} FAILED_TO_SOLVE\n")
                
                f.write("\n# Camera Rotations (as rotation matrices)\n")
                for i, rot in enumerate(camera_rotations):
                    if rot is not None:
                        f.write(f"CAMERA_{i}_ROTATION\n")
                        for row in rot:
                            f.write(f"{row[0]:.6f} {row[1]:.6f} {row[2]:.6f}\n")
                    else:
                        f.write(f"CAMERA_{i}_ROTATION FAILED_TO_SOLVE\n")
                
                f.write("\n# 3D LED Coordinates\n")
                for led_id in led_ids:
                    x, y, z = led_3d_coords[led_id]
                    f.write(f"{led_id} {x:.6f} {y:.6f} {z:.6f}\n")
            
            print(f"\nResults saved to {args.output}")
        
        # Generate 3D visualization if specified
        if args.viz:
            if len(args.files) == 2:
                # Use simple 2-camera visualization for stereo pairs
                valid_cameras = [(i, pos, rot) for i, (pos, rot) in enumerate(zip(camera_positions, camera_rotations)) 
                               if pos is not None and rot is not None]
                if len(valid_cameras) == 2:
                    cam1_pos, cam2_pos = valid_cameras[0][1], valid_cameras[1][1]
                    R = camera_rotations[valid_cameras[1][0]]
                    pts3d = np.array([led_3d_coords[led_id] for led_id in led_ids])
                    generate_3d_visualization(led_ids, pts3d, cam1_pos, cam2_pos, R, args.viz)
                else:
                    generate_multi_camera_visualization(led_ids, led_3d_coords, camera_positions, camera_rotations, args.viz)
            else:
                # Use multi-camera visualization for 3+ cameras
                generate_multi_camera_visualization(led_ids, led_3d_coords, camera_positions, camera_rotations, args.viz)
            print(f"3D visualization saved to {args.viz}")

        # Print observation statistics summary
        stats.print_summary()

    except FileNotFoundError as e:
        print(f"Error: File not found - {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
