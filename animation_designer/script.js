// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

class CubeDemo {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.gl = this.canvas.getContext('webgl');
        
        if (!this.gl) {
            alert('WebGL not supported');
            return;
        }
        
        // UI elements
        this.codeInput = document.getElementById('codeInput');
        this.runButton = document.getElementById('runButton');
        this.stopButton = document.getElementById('stopButton');
        this.resetCameraButton = document.getElementById('resetCamera');
        this.distributionMode = document.getElementById('distributionMode');
        this.cubeOrientation = document.getElementById('cubeOrientation');
        this.cubeSizeSlider = document.getElementById('cubeSize');
        this.cubeSizeValue = document.getElementById('cubeSizeValue');
        this.cubeSizeLabel = document.getElementById('cubeSizeLabel');
        this.sphereSizeSlider = document.getElementById('sphereSize');
        this.sphereSizeValue = document.getElementById('sphereSizeValue');
        this.spinSpeedSlider = document.getElementById('spinSpeed');
        this.spinSpeedValue = document.getElementById('spinSpeedValue');
        this.importPointsBtn = document.getElementById('importPointsBtn');
        this.importPointsGroup = document.getElementById('importPointsGroup');
        this.importedPointsCount = document.getElementById('importedPointsCount');
        this.statusMessage = document.getElementById('statusMessage');
        this.statusContainer = document.getElementById('statusContainer');
        this.errorDisplay = document.getElementById('errorDisplay');
        this.errorMessage = document.getElementById('errorMessage');
        
        // WLED controls
        this.wledHost = document.getElementById('wledHost');
        this.wledConnect = document.getElementById('wledConnect');
        this.wledStatus = document.getElementById('wledStatus');
        this.wledProtocol = document.getElementById('wledProtocol');
        this.wledFps = document.getElementById('wledFps');
        
        // Parameters section
        this.parametersSection = document.getElementById('parametersSection');
        this.parametersHeader = document.getElementById('parametersHeader');
        this.parametersContent = document.getElementById('parametersContent');
        this.parametersContainer = document.getElementById('parametersContainer');
        
        // Presets system
        this.presets = {};
        this.loadPresets();
        this.loadSourceCode(); // Load saved source code on init
        
        // Preset UI elements
        this.savePresetBtn = document.getElementById('savePresetBtn');
        this.presetSelector = document.getElementById('presetSelector');
        this.loadPresetBtn = document.getElementById('loadPresetBtn');
        this.deletePresetBtn = document.getElementById('deletePresetBtn');
        
        // Collapsible sections
        this.viewportControlsHeader = document.getElementById('viewportControlsHeader');
        this.viewportControlsContent = document.getElementById('viewportControlsContent');
        this.codeEditorHeader = document.getElementById('codeEditorHeader');
        this.codeEditorContent = document.getElementById('codeEditorContent');
        this.resetCodeBtn = document.getElementById('resetCodeBtn');
        
        // Animation state
        this.isRunning = false;
        this.animationId = null;
        this.startTime = null;
        this.spinStartTime = null;
        this.userGetSphereColor = null;
        
        // Parameter system
        this.parameters = {};
        this.parameterValues = {};
        
        // Cube parameters
        this.cubeSize = 8;
        this.sphereSize = 1.7;
        this.spinSpeed = 0.0;
        this.sphereCount = this.cubeSize ** 3;
        this.importedPoints = []; // Store imported coordinate points
        
        // Store normalized positions for color calculation
        this.normalizedPositions = null;
        this.incompleteLeds = null; // Track which LEDs have incomplete coordinates
        
        // WLED websocket streaming
        this.wledWebsocket = null;
        this.wledHostValue = '';
        this.wledConnected = false;
        this.wledStreaming = false;
        this.wledProtocolType = 'wled'; // 'wled' or 'binary'
        this.lastWledSendTime = 0;
        this.wledFrameInterval = 1000 / 60; // Target 60fps, can be adjusted
        
        // Camera state
        this.camera = {
            distance: 5.0,
            rotationX: 0.3,
            rotationY: 0.3,
            fov: 45
        };
        
        // Mouse interaction
        this.mouse = {
            isDown: false,
            lastX: 0,
            lastY: 0
        };
        
        // WebGL resources
        this.shaderProgram = null;
        this.sphereGeometry = null;
        this.instancePositions = null;
        this.instanceColors = null;
        this.colorBuffer = null;
        
        // Matrices
        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();
        this.modelMatrix = mat4.create();
        
        // Default code template
        this.defaultCode = `// Parameter definitions demonstrating all parameter types
const params = {
    // Animation controls
    animationGroup: {
        group: 'Animation',
        speed: { type: 'float', name: 'Speed', min: 0.1, max: 8.0, default: 2.5 },
        waveCount: { type: 'int', name: 'Wave Count', min: 1, max: 15, default: 6 },
        amplitude: { type: 'float', name: 'Amplitude', min: 0.0, max: 1.5, default: 0.6 },
        waveType: { type: 'enum', name: 'Wave Pattern', options: ['Sine Wave', 'Square Wave', 'Triangle Wave', 'Sawtooth Wave'], default: 0 }
    },

    // Visual style controls
    visualGroup: {
        group: 'Visual Style',
        colorScheme: { type: 'enum', name: 'Color Scheme', options: ['Rainbow', 'Plasma', 'Fire', 'Ocean', 'Neon', 'Sunset'], default: 0 },
        baseColor: { type: 'color', name: 'Base Tint', default: [1.0, 1.0, 1.0] },
        contrast: { type: 'float', name: 'Contrast', min: 0.1, max: 3.0, default: 1.2 },
        brightness: { type: 'float', name: 'Brightness', min: 0.1, max: 2.0, default: 1.0 }
    },

    // Post-processing effects using flags
    effectsGroup: {
        group: 'Effects',
        postEffects: { type: 'flag', name: 'Post Effects', flags: ['Glow', 'Color Invert', 'Enhance Edges', 'Add Noise', 'Pulse Sync'], default: 1 }
    },

    // Spatial controls
    center: { type: 'vec2', name: 'Wave Center', min: [0.0, 0.0], max: [1.0, 1.0], default: [0.5, 0.5] },
    rotation: { type: 'float', name: 'Pattern Rotation', min: 0.0, max: 6.28, default: 0.0 }
};

function getSphereColor(x, y, z, t, params, id) {
    // x, y, z are normalized coordinates (0.0 to 1.0)
    // t is time in seconds since start
    // params contains parameter values
    // id is the sequential LED number (0 to N-1)
    // Return [r, g, b] values (0.0 to 1.0)

    // Helper function: getSphereCoords(i) returns [x, y, z] for LED i
    // Example: const coords = getSphereCoords(id + 1); // get next LED's coords

    // Get parameters with defaults
    const speed = params.speed ?? 2.5;
    const waveCount = params.waveCount ?? 6;
    const amplitude = params.amplitude ?? 0.6;
    const waveType = params.waveType ?? 0;
    const colorScheme = params.colorScheme ?? 0;
    const baseColor = params.baseColor ?? [1.0, 1.0, 1.0];
    const contrast = params.contrast ?? 1.2;
    const brightness = params.brightness ?? 1.0;
    const postEffects = params.postEffects ?? 0;
    const center = params.center ?? [0.5, 0.5];
    const rotation = params.rotation ?? 0.0;
    
    // Apply rotation to coordinates
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const cx = x - center[0], cy = y - center[1], cz = z - 0.5;
    const rx = cx * cosR - cy * sinR + center[0];
    const ry = cx * sinR + cy * cosR + center[1];
    const rz = cz + 0.5;
    
    // Calculate distance from center
    const dx = rx - center[0], dy = ry - center[1], dz = rz - 0.5;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // Generate wave pattern based on selected type
    let wave;
    const phase = dist * waveCount + t * speed;
    
    switch(waveType) {
        case 1: // Square Wave
            wave = Math.sign(Math.sin(phase)) * amplitude + 0.5;
            break;
        case 2: // Triangle Wave  
            wave = (2 / Math.PI) * Math.asin(Math.sin(phase)) * amplitude + 0.5;
            break;
        case 3: // Sawtooth Wave
            wave = ((phase % (2 * Math.PI)) / (2 * Math.PI)) * amplitude + 0.5;
            break;
        default: // Sine Wave
            wave = Math.sin(phase) * amplitude + 0.5;
    }
    
    // Generate base color based on scheme
    let r, g, b;
    const hue = (dist * 3 + t * 0.5) % 1.0;
    
    switch(colorScheme) {
        case 1: // Plasma
            r = Math.sin(hue * 3.14159 + 0) * 0.5 + 0.5;
            g = Math.sin(hue * 3.14159 + 2.094) * 0.5 + 0.5;  
            b = Math.sin(hue * 3.14159 + 4.188) * 0.5 + 0.5;
            break;
        case 2: // Fire
            r = Math.min(1, wave * 1.5);
            g = Math.max(0, wave - 0.3) * 1.2; 
            b = Math.max(0, wave - 0.7) * 2.0;
            break;
        case 3: // Ocean
            r = Math.max(0, wave - 0.8) * 2.0;
            g = wave * 0.8;
            b = Math.min(1, wave * 1.3);
            break;
        case 4: // Neon
            const neonHue = (hue * 6) % 6;
            if(neonHue < 1) { r = 1; g = neonHue; b = 0; }
            else if(neonHue < 2) { r = 2-neonHue; g = 1; b = 0; }
            else if(neonHue < 3) { r = 0; g = 1; b = neonHue-2; }
            else if(neonHue < 4) { r = 0; g = 4-neonHue; b = 1; }  
            else if(neonHue < 5) { r = neonHue-4; g = 0; b = 1; }
            else { r = 1; g = 0; b = 6-neonHue; }
            r *= wave; g *= wave; b *= wave;
            break;
        case 5: // Sunset
            r = Math.sin(hue * 3.14159 + 0) * 0.3 + 0.7;
            g = Math.sin(hue * 3.14159 + 1.57) * 0.4 + 0.4;
            b = Math.sin(hue * 3.14159 + 3.14) * 0.2 + 0.2;
            r *= wave; g *= wave; b *= wave;
            break;
        default: // Rainbow
            const rainbowHue = hue * 6;
            if(rainbowHue < 1) { r = 1; g = rainbowHue; b = 0; }
            else if(rainbowHue < 2) { r = 2-rainbowHue; g = 1; b = 0; }
            else if(rainbowHue < 3) { r = 0; g = 1; b = rainbowHue-2; }
            else if(rainbowHue < 4) { r = 0; g = 4-rainbowHue; b = 1; }
            else if(rainbowHue < 5) { r = rainbowHue-4; g = 0; b = 1; }
            else { r = 1; g = 0; b = 6-rainbowHue; }
            r *= wave; g *= wave; b *= wave;
    }
    
    // Apply base color tint
    r *= baseColor[0];
    g *= baseColor[1]; 
    b *= baseColor[2];
    
    // Apply post-processing effects based on flags
    if (postEffects & 1) { // Glow effect
        const glow = Math.sin(t * 4) * 0.2 + 0.8;
        r *= glow; g *= glow; b *= glow;
    }
    
    if (postEffects & 2) { // Color invert  
        r = 1 - r; g = 1 - g; b = 1 - b;
    }
    
    if (postEffects & 4) { // Enhance edges
        const edge = Math.abs(wave - 0.5) * 4;
        r = r * (1 - edge) + edge;
        g = g * (1 - edge) + edge;
        b = b * (1 - edge) + edge;
    }
    
    if (postEffects & 8) { // Add noise
        const noise = (Math.random() - 0.5) * 0.1;
        r += noise; g += noise; b += noise;
    }
    
    if (postEffects & 16) { // Pulse sync
        const pulse = Math.sin(t * 6) * 0.3 + 0.7;
        r *= pulse; g *= pulse; b *= pulse;
    }
    
    // Apply contrast and brightness
    r = Math.pow(r * brightness, contrast);
    g = Math.pow(g * brightness, contrast);  
    b = Math.pow(b * brightness, contrast);
    
    // Clamp values
    return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}`;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.loadViewportSettings(); // Load saved viewport settings after event listeners are set up
        this.loadWledSettings(); // Load saved WLED settings
        this.initWebGL();
        this.loadDefaultCode();
        this.updateCubeSizeDisplay();
        this.updateSphereSizeDisplay();
        this.updateSpinSpeedDisplay();
        this.updateDistributionMode();  // Initialize viewport controls CSS classes
        this.updatePresetSelector();   // Initialize preset selector
        this.setStatus('Ready');
        
        // Start with a basic render
        this.generateSpherePositions();
        this.render();
    }
    
    setupEventListeners() {
        // UI controls
        this.runButton.addEventListener('click', () => this.runAnimation());
        this.stopButton.addEventListener('click', () => this.stopAnimation());
        this.resetCameraButton.addEventListener('click', () => this.resetCamera());
        
        this.distributionMode.addEventListener('change', (e) => {
            this.updateDistributionMode();
            this.generateSpherePositions();
            this.saveViewportSettings();
            if (!this.isRunning) this.render();
        });
        
        this.cubeOrientation.addEventListener('change', (e) => {
            this.saveViewportSettings();
            if (!this.isRunning) this.render();
        });
        
        // Enhanced slider controls with bidirectional sync and mouse wheel support
        this.setupSliderControl('cubeSize', (value) => {
            this.cubeSize = parseInt(value);
            this.updateCubeSizeDisplay();
            this.generateSpherePositions();
            this.saveViewportSettings();
            if (!this.isRunning) this.render();
        });
        
        this.setupSliderControl('sphereSize', (value) => {
            this.sphereSize = parseFloat(value);
            this.updateSphereSizeDisplay();
            this.saveViewportSettings();
            if (!this.isRunning) this.render();
        });
        
        this.setupSliderControl('spinSpeed', (value) => {
            const oldSpinSpeed = this.spinSpeed;
            this.spinSpeed = parseFloat(value);
            this.updateSpinSpeedDisplay();
            this.saveViewportSettings();
            
            // Start spin animation if speed is non-zero and no animation is running
            if (this.spinSpeed !== 0.0 && oldSpinSpeed === 0.0 && !this.isRunning) {
                if (!this.spinStartTime) {
                    this.spinStartTime = performance.now();
                }
                this.animate();
            }
        });
        
        // Import points button
        this.importPointsBtn.addEventListener('click', () => this.importPoints());
        
        // WLED controls
        this.wledConnect.addEventListener('click', () => this.toggleWledConnection());

        if (this.wledFps) {
            this.wledFps.addEventListener('change', (e) => {
                const fps = parseInt(e.target.value) || 60;
                this.wledFrameInterval = 1000 / fps;
            });
        }
        
        // Collapsible sections
        this.viewportControlsHeader.addEventListener('click', () => this.toggleSection('viewportControls'));
        this.codeEditorHeader.addEventListener('click', () => this.toggleSection('codeEditor'));
        this.parametersHeader.addEventListener('click', () => this.toggleSection('parameters'));
        
        // Preset controls
        this.savePresetBtn.addEventListener('click', () => this.savePreset());
        
        this.loadPresetBtn.addEventListener('click', () => {
            const selectedPreset = this.presetSelector.value;
            if (selectedPreset) {
                this.loadPreset(selectedPreset);
            }
        });
        
        this.deletePresetBtn.addEventListener('click', () => {
            const selectedPreset = this.presetSelector.value;
            if (selectedPreset) {
                this.deletePreset(selectedPreset);
            }
        });
        
        this.presetSelector.addEventListener('change', () => {
            const hasSelection = this.presetSelector.value !== '';
            this.loadPresetBtn.disabled = !hasSelection;
            this.deletePresetBtn.disabled = !hasSelection;
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
        
        // Source code persistence - save code when user types
        this.codeInput.addEventListener('input', () => this.saveSourceCode());
        
        // Reset code button
        this.resetCodeBtn.addEventListener('click', () => this.resetSourceCode());
        
        // Mouse controls
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        
        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Handle canvas resize
        window.addEventListener('resize', () => this.handleResize());
        
        // Handle sticky viewport
        window.addEventListener('scroll', () => this.handleStickyViewport());
        
        // Initialize section states (expanded by default)
        this.initializeSections();
    }
    
    initWebGL() {
        const gl = this.gl;
        
        // Enable depth testing
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        
        // Set clear color to dark gray (5% brightness)
        gl.clearColor(0.05, 0.05, 0.05, 1.0);
        
        // Create shader program
        this.createShaderProgram();
        
        // Create sphere geometry
        this.createSphereGeometry();
        
        // Set up projection matrix
        this.updateProjectionMatrix();
    }
    
    createShaderProgram() {
        const gl = this.gl;
        
        const vertexShaderSource = `
            attribute vec3 a_position;
            attribute vec3 a_normal;
            attribute vec3 a_instancePosition;
            attribute vec3 a_instanceColor;
            
            uniform mat4 u_projectionMatrix;
            uniform mat4 u_viewMatrix;
            uniform mat4 u_modelMatrix;
            uniform float u_sphereSize;
            
            varying vec3 v_normal;
            varying vec3 v_color;
            varying vec3 v_position;
            
            void main() {
                vec3 worldPosition = a_position * 0.03 * u_sphereSize + a_instancePosition;
                gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(worldPosition, 1.0);
                
                v_normal = a_normal;
                v_color = a_instanceColor;
                v_position = worldPosition;
            }
        `;
        
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec3 v_normal;
            varying vec3 v_color;
            varying vec3 v_position;
            
            void main() {
                // Simple ambient + diffuse lighting
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8));
                vec3 normal = normalize(v_normal);
                
                // Ambient light
                float ambient = 0.8;
                
                // Diffuse lighting
                float diffuse = max(dot(normal, lightDir), 0.0) * 0.2;
                
                // Combine lighting
                float lightIntensity = ambient + diffuse;
                
                // Apply lighting to color
                vec3 finalColor = v_color * lightIntensity;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;
        
        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        this.shaderProgram = gl.createProgram();
        gl.attachShader(this.shaderProgram, vertexShader);
        gl.attachShader(this.shaderProgram, fragmentShader);
        gl.linkProgram(this.shaderProgram);
        
        if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
            console.error('Shader program failed to link:', gl.getProgramInfoLog(this.shaderProgram));
            return;
        }
        
        // Get attribute and uniform locations
        this.programInfo = {
            attribLocations: {
                position: gl.getAttribLocation(this.shaderProgram, 'a_position'),
                normal: gl.getAttribLocation(this.shaderProgram, 'a_normal'),
                instancePosition: gl.getAttribLocation(this.shaderProgram, 'a_instancePosition'),
                instanceColor: gl.getAttribLocation(this.shaderProgram, 'a_instanceColor'),
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(this.shaderProgram, 'u_projectionMatrix'),
                viewMatrix: gl.getUniformLocation(this.shaderProgram, 'u_viewMatrix'),
                modelMatrix: gl.getUniformLocation(this.shaderProgram, 'u_modelMatrix'),
                sphereSize: gl.getUniformLocation(this.shaderProgram, 'u_sphereSize'),
            },
        };
    }
    
    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    
    createSphereGeometry() {
        const gl = this.gl;
        
        // Create a simple icosphere
        const { vertices, normals, indices } = this.generateIcosphere(1);
        
        this.sphereGeometry = {
            vertexBuffer: gl.createBuffer(),
            normalBuffer: gl.createBuffer(),
            indexBuffer: gl.createBuffer(),
            indexCount: indices.length
        };
        
        // Upload vertex data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereGeometry.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        
        // Upload normal data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereGeometry.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
        
        // Upload index data
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereGeometry.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        
        // Create instance buffers
        this.instancePositionBuffer = gl.createBuffer();
        this.instanceColorBuffer = gl.createBuffer();
    }
    
    generateIcosphere(radius) {
        // Simple sphere generation (subdivided icosahedron would be better, but this works)
        const vertices = [];
        const normals = [];
        const indices = [];
        
        const latitudeBands = 16;
        const longitudeBands = 16;
        
        // Generate vertices
        for (let lat = 0; lat <= latitudeBands; lat++) {
            const theta = lat * Math.PI / latitudeBands;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            
            for (let lon = 0; lon <= longitudeBands; lon++) {
                const phi = lon * 2 * Math.PI / longitudeBands;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                
                const x = cosPhi * sinTheta;
                const y = cosTheta;
                const z = sinPhi * sinTheta;
                
                vertices.push(radius * x, radius * y, radius * z);
                normals.push(x, y, z);
            }
        }
        
        // Generate indices
        for (let lat = 0; lat < latitudeBands; lat++) {
            for (let lon = 0; lon < longitudeBands; lon++) {
                const first = (lat * (longitudeBands + 1)) + lon;
                const second = first + longitudeBands + 1;
                
                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }
        
        return { vertices, normals, indices };
    }
    
    generateSpherePositions() {
        const mode = this.distributionMode.value;
        const isRandomMode = mode === 'random';
        const isImportMode = mode === 'import';
        
        if (isImportMode) {
            // In import mode, use imported points
            this.sphereCount = this.importedPoints.length;
            if (this.sphereCount === 0) {
                // No points imported yet, show default single sphere at origin
                this.sphereCount = 1;
            }
        } else if (isRandomMode) {
            // In random mode, cubeSize represents total number of spheres
            this.sphereCount = this.cubeSize;
        } else {
            // In grid mode, cubeSize represents grid dimensions
            this.sphereCount = this.cubeSize ** 3;
        }
        
        this.instancePositions = new Float32Array(this.sphereCount * 3);
        this.instanceColors = new Float32Array(this.sphereCount * 3);
        
        // Store normalized positions for color calculation
        this.normalizedPositions = new Float32Array(this.sphereCount * 3);

        // Track incomplete LEDs
        this.incompleteLeds = new Uint8Array(this.sphereCount); // 0 = complete, 1 = incomplete

        if (isImportMode) {
            // Use imported coordinates
            if (this.importedPoints.length > 0) {
                for (let i = 0; i < this.sphereCount; i++) {
                    const point = this.importedPoints[i];

                    if (point.incomplete) {
                        // Incomplete point - set to origin (won't be visible with 0 size)
                        this.instancePositions[i * 3] = 0.0;
                        this.instancePositions[i * 3 + 1] = 0.0;
                        this.instancePositions[i * 3 + 2] = 0.0;

                        // Mark as incomplete
                        this.incompleteLeds[i] = 1;

                        // Set normalized position to 0.5 (won't be used for color calculation)
                        this.normalizedPositions[i * 3] = 0.5;
                        this.normalizedPositions[i * 3 + 1] = 0.5;
                        this.normalizedPositions[i * 3 + 2] = 0.5;

                        // Set to black
                        this.instanceColors[i * 3] = 0.0;
                        this.instanceColors[i * 3 + 1] = 0.0;
                        this.instanceColors[i * 3 + 2] = 0.0;
                    } else {
                        // Complete point - use imported coordinates
                        this.instancePositions[i * 3] = point.x;
                        this.instancePositions[i * 3 + 1] = -point.y;
                        this.instancePositions[i * 3 + 2] = point.z;

                        // Mark as complete
                        this.incompleteLeds[i] = 0;

                        // Store normalized positions (0.0 to 1.0) for color calculation
                        this.normalizedPositions[i * 3] = (point.x + 1.0) * 0.5;
                        this.normalizedPositions[i * 3 + 1] = (point.y + 1.0) * 0.5;
                        this.normalizedPositions[i * 3 + 2] = (point.z + 1.0) * 0.5;

                        // Default white color
                        this.instanceColors[i * 3] = 1.0;
                        this.instanceColors[i * 3 + 1] = 1.0;
                        this.instanceColors[i * 3 + 2] = 1.0;
                    }
                }
            } else {
                // Default single sphere at origin if no points imported
                this.instancePositions[0] = 0.0;
                this.instancePositions[1] = 0.0;
                this.instancePositions[2] = 0.0;
                
                this.normalizedPositions[0] = 0.5;
                this.normalizedPositions[1] = 0.5;
                this.normalizedPositions[2] = 0.5;
                
                this.instanceColors[0] = 1.0;
                this.instanceColors[1] = 1.0;
                this.instanceColors[2] = 1.0;
            }
        } else if (isRandomMode) {
            // Generate random positions within the cube volume
            for (let i = 0; i < this.sphereCount; i++) {
                // Random positions between -1.0 and 1.0
                this.instancePositions[i * 3] = (Math.random() - 0.5) * 2.0;
                this.instancePositions[i * 3 + 1] = -(Math.random() - 0.5) * 2.0;
                this.instancePositions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
                
                // Store normalized positions (0.0 to 1.0) for color calculation
                this.normalizedPositions[i * 3] = (this.instancePositions[i * 3] + 1.0) * 0.5;
                this.normalizedPositions[i * 3 + 1] = (this.instancePositions[i * 3 + 1] + 1.0) * 0.5;
                this.normalizedPositions[i * 3 + 2] = (this.instancePositions[i * 3 + 2] + 1.0) * 0.5;
                
                // Default white color
                this.instanceColors[i * 3] = 1.0;
                this.instanceColors[i * 3 + 1] = 1.0;
                this.instanceColors[i * 3 + 2] = 1.0;
            }
        } else {
            // Generate grid positions
            let index = 0;
            const spacing = 2.0 / (this.cubeSize - 1);
            const offset = -1.0;
            const normalizedSpacing = 1.0 / (this.cubeSize - 1);
            
            for (let x = 0; x < this.cubeSize; x++) {
                for (let y = 0; y < this.cubeSize; y++) {
                    for (let z = 0; z < this.cubeSize; z++) {
                        this.instancePositions[index * 3] = offset + x * spacing;
                        this.instancePositions[index * 3 + 1] = -(offset + y * spacing);
                        this.instancePositions[index * 3 + 2] = offset + z * spacing;
                        
                        // Store normalized positions (0.0 to 1.0) for color calculation
                        this.normalizedPositions[index * 3] = x * normalizedSpacing;
                        this.normalizedPositions[index * 3 + 1] = y * normalizedSpacing;
                        this.normalizedPositions[index * 3 + 2] = z * normalizedSpacing;
                        
                        // Default white color
                        this.instanceColors[index * 3] = 1.0;
                        this.instanceColors[index * 3 + 1] = 1.0;
                        this.instanceColors[index * 3 + 2] = 1.0;
                        
                        index++;
                    }
                }
            }
        }
        
        // Upload position data
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instancePositionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.instancePositions, gl.STATIC_DRAW);
        
        // Upload initial color data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceColors, gl.DYNAMIC_DRAW);
    }
    
    updateColors(time) {
        if (!this.userGetSphereColor || !this.normalizedPositions) return;

        // Use stored normalized positions for both grid and random modes
        for (let i = 0; i < this.sphereCount; i++) {
            // Skip color calculation for incomplete LEDs - keep them black
            if (this.incompleteLeds && this.incompleteLeds[i] === 1) {
                this.instanceColors[i * 3] = 0.0;
                this.instanceColors[i * 3 + 1] = 0.0;
                this.instanceColors[i * 3 + 2] = 0.0;
                continue;
            }

            const normalizedX = this.normalizedPositions[i * 3];
            const normalizedY = this.normalizedPositions[i * 3 + 1];
            const normalizedZ = this.normalizedPositions[i * 3 + 2];

            try {
                const color = this.userGetSphereColor(normalizedX, normalizedY, normalizedZ, time, this.parameterValues, i);

                if (Array.isArray(color) && color.length >= 3) {
                    this.instanceColors[i * 3] = Math.max(0, Math.min(1, color[0] || 0));
                    this.instanceColors[i * 3 + 1] = Math.max(0, Math.min(1, color[1] || 0));
                    this.instanceColors[i * 3 + 2] = Math.max(0, Math.min(1, color[2] || 0));
                }
            } catch (error) {
                // Use default color on error
                this.instanceColors[i * 3] = 1.0;
                this.instanceColors[i * 3 + 1] = 1.0;
                this.instanceColors[i * 3 + 2] = 1.0;
            }
        }
        
        // Upload updated color data to WebGL
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceColorBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceColors);
        
        // Stream colors to WLED if connected
        this.streamColorsToWled();
    }
    
    updateMatrices(time = 0) {
        // Update view matrix
        mat4.identity(this.viewMatrix);
        mat4.translate(this.viewMatrix, this.viewMatrix, [0, 0, -this.camera.distance]);
        mat4.rotateX(this.viewMatrix, this.viewMatrix, this.camera.rotationX);
        
        // Apply continuous spin rotation around Y-axis
        let totalYRotation = this.camera.rotationY;
        if (this.spinSpeed !== 0.0) {
            totalYRotation += time * this.spinSpeed * Math.PI; // Convert to radians per second
        }
        mat4.rotateY(this.viewMatrix, this.viewMatrix, totalYRotation);
        
        // Model matrix - apply cube orientation
        mat4.identity(this.modelMatrix);
        
        // Apply tipping transformation if selected
        if (this.cubeOrientation.value === 'tipped') {
            // Rotate to tip the cube onto one of its vertices
            // This combination of rotations tips the cube so one vertex touches the "ground"
            mat4.rotateX(this.modelMatrix, this.modelMatrix, Math.PI / 4); // 45 degrees
            mat4.rotateZ(this.modelMatrix, this.modelMatrix, Math.atan(Math.sqrt(2))); // ~54.74 degrees
        }
    }
    
    updateProjectionMatrix() {
        const aspect = this.canvas.width / this.canvas.height;
        mat4.perspective(this.projectionMatrix, this.camera.fov * Math.PI / 180, aspect, 0.1, 100.0);
    }
    
    render(time = 0) {
        const gl = this.gl;
        
        // Clear and render directly to screen
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        
        this.renderSpheres(time);
    }
    
    renderSpheres(time = 0) {
        const gl = this.gl;
        
        // Use main shader program
        gl.useProgram(this.shaderProgram);
        
        // Update matrices with time for spin
        this.updateMatrices(time);
        
        // Set uniforms
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.projectionMatrix, false, this.projectionMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.viewMatrix, false, this.viewMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.modelMatrix, false, this.modelMatrix);
        gl.uniform1f(this.programInfo.uniformLocations.sphereSize, this.sphereSize);
        
        // Bind sphere geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereGeometry.vertexBuffer);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.position);
        gl.vertexAttribPointer(this.programInfo.attribLocations.position, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereGeometry.normalBuffer);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.normal);
        gl.vertexAttribPointer(this.programInfo.attribLocations.normal, 3, gl.FLOAT, false, 0, 0);
        
        // Bind instance data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instancePositionBuffer);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.instancePosition);
        gl.vertexAttribPointer(this.programInfo.attribLocations.instancePosition, 3, gl.FLOAT, false, 0, 0);
        
        // Check if instanced arrays extension is available
        const ext = gl.getExtension('ANGLE_instanced_arrays');
        if (ext) {
            ext.vertexAttribDivisorANGLE(this.programInfo.attribLocations.instancePosition, 1);
        }
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceColorBuffer);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.instanceColor);
        gl.vertexAttribPointer(this.programInfo.attribLocations.instanceColor, 3, gl.FLOAT, false, 0, 0);
        
        if (ext) {
            ext.vertexAttribDivisorANGLE(this.programInfo.attribLocations.instanceColor, 1);
        }
        
        // Bind index buffer
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereGeometry.indexBuffer);
        
        // Draw instances
        if (ext) {
            ext.drawElementsInstancedANGLE(gl.TRIANGLES, this.sphereGeometry.indexCount, gl.UNSIGNED_SHORT, 0, this.sphereCount);
        } else {
            // Fallback: draw each sphere individually (much slower)
            for (let i = 0; i < this.sphereCount; i++) {
                gl.drawElements(gl.TRIANGLES, this.sphereGeometry.indexCount, gl.UNSIGNED_SHORT, 0);
            }
        }
    }
    
    
    animate() {
        if (!this.isRunning && this.spinSpeed === 0.0) return;
        
        const currentTime = performance.now();
        const time = this.startTime ? (currentTime - this.startTime) / 1000 : 0;
        
        try {
            // Update colors only if animation is running
            if (this.isRunning) {
                this.updateColors(time);
            }
            
            // Always render with time for spin effect
            this.render(time);
            
            // Continue animating if either animation is running or spin is enabled
            if (this.isRunning || this.spinSpeed !== 0.0) {
                this.animationId = requestAnimationFrame(() => this.animate());
            }
        } catch (error) {
            this.stopAnimation();
            this.setStatus(`Runtime error: ${error.message}`, 'error');
            this.showError(`Runtime error: ${error.message}`);
        }
    }
    
    // Event handlers
    onMouseDown(e) {
        this.mouse.isDown = true;
        this.mouse.lastX = e.clientX;
        this.mouse.lastY = e.clientY;
    }
    
    onMouseMove(e) {
        if (!this.mouse.isDown) return;
        
        const deltaX = e.clientX - this.mouse.lastX;
        const deltaY = e.clientY - this.mouse.lastY;
        
        this.camera.rotationY += deltaX * 0.01;
        this.camera.rotationX += deltaY * 0.01;
        
        // Clamp X rotation
        this.camera.rotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.camera.rotationX));
        
        this.mouse.lastX = e.clientX;
        this.mouse.lastY = e.clientY;
        
        if (!this.isRunning) this.render();
    }
    
    onMouseUp() {
        this.mouse.isDown = false;
    }
    
    onWheel(e) {
        e.preventDefault();
        
        const zoomSpeed = 0.1;
        this.camera.distance += e.deltaY * zoomSpeed * 0.01;
        this.camera.distance = Math.max(1.0, Math.min(20.0, this.camera.distance));
        
        if (!this.isRunning) this.render();
    }
    
    // UI methods
    loadDefaultCode() {
        // Try to load saved code, fallback to default if none exists
        const savedCode = this.loadSourceCode();
        this.codeInput.value = savedCode || this.defaultCode;
    }
    
    resetToDefaultCode() {
        // This method resets to the default template
        this.codeInput.value = this.defaultCode;
        this.saveSourceCode(); // Save the reset code
    }
    
    runAnimation() {
        const code = this.codeInput.value.trim();
        if (!code) {
            this.setStatus('No code to execute', 'error');
            return;
        }
        
        try {
            this.stopAnimation();
            this.hideError();
            
            // Parse parameters from the code
            this.parameters = this.parseParameters(code);
            
            // Initialize parameter values with defaults
            this.parameterValues = {};
            for (const [key, param] of Object.entries(this.parameters)) {
                this.parameterValues[key] = Array.isArray(param.default) ? [...param.default] : param.default;
            }
            
            // Create parameter UI
            this.createParameterControls();
            
            // Create getSphereCoords helper function that will be available to user code
            window.getSphereCoords = (i) => {
                if (typeof i !== 'number' || i < 0 || i >= this.normalizedPositions.length / 3) {
                    return null;
                }
                return [
                    this.normalizedPositions[i * 3],
                    this.normalizedPositions[i * 3 + 1],
                    this.normalizedPositions[i * 3 + 2]
                ];
            };

            // Create a function wrapper that executes the user's code
            const functionWrapper = new Function(`
                ${code}

                if (typeof getSphereColor !== 'function') {
                    throw new Error('getSphereColor function not found. Please define a getSphereColor(x, y, z, t, params, id) function.');
                }

                return function(x, y, z, t, params, id) {
                    return getSphereColor(x, y, z, t, params, id);
                };
            `);

            // Execute the wrapper to get the actual function
            this.userGetSphereColor = functionWrapper();

            // Test the function with parameter values
            const testResult = this.userGetSphereColor(0.5, 0.5, 0.5, 0, this.parameterValues, 0);
            
            if (!Array.isArray(testResult) || testResult.length < 3) {
                throw new Error('getSphereColor function must return an array of at least 3 values [r, g, b]');
            }
            
            for (let i = 0; i < 3; i++) {
                if (typeof testResult[i] !== 'number' || isNaN(testResult[i])) {
                    throw new Error(`getSphereColor function returned invalid value at index ${i}. All values must be numbers.`);
                }
            }
            
            this.startAnimation();
            this.setStatus('Animation running...', 'success');
            
        } catch (error) {
            this.setStatus(`Error: ${error.message}`, 'error');
            this.showError(error.message);
        }
    }
    
    startAnimation() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.startTime = performance.now();
        this.animate();
    }
    
    stopAnimation() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.setStatus('Animation stopped');
    }
    
    resetCamera() {
        this.camera.distance = 5.0;
        this.camera.rotationX = 0.3;
        this.camera.rotationY = 0.3;
        this.camera.fov = 45;
        
        if (!this.isRunning) this.render();
    }
    
    updateDistributionMode() {
        const mode = this.distributionMode.value;
        const isRandomMode = mode === 'random';
        const isImportMode = mode === 'import';
        
        // Get the controls container
        const controlsContainer = document.querySelector('.controls');
        
        // Remove all mode classes
        controlsContainer.classList.remove('mode-grid', 'mode-random', 'mode-import');
        
        // Add the current mode class
        controlsContainer.classList.add(`mode-${mode}`);
        
        if (isImportMode) {
            this.updateImportedPointsDisplay();
        } else if (isRandomMode) {
            // In random mode, slider controls total number of spheres
            this.cubeSizeLabel.textContent = 'Sphere Count:';
            this.cubeSizeSlider.min = '4';
            this.cubeSizeSlider.max = '1600';
            this.cubeSizeSlider.value = Math.min(this.cubeSize, 512);
            this.cubeSize = parseInt(this.cubeSizeSlider.value);
        } else {
            // In grid mode, slider controls grid dimensions
            this.cubeSizeLabel.textContent = 'Cube Size:';
            this.cubeSizeSlider.min = '4';
            this.cubeSizeSlider.max = '32';
            this.cubeSizeSlider.value = Math.min(this.cubeSize, 32);
            this.cubeSize = parseInt(this.cubeSizeSlider.value);
        }
        
        this.updateCubeSizeDisplay();
    }
    
    updateCubeSizeDisplay() {
        const mode = this.distributionMode.value;
        const isRandomMode = mode === 'random';
        const isImportMode = mode === 'import';
        
        if (isImportMode) {
            // In import mode, sphere count is determined by imported points
            this.sphereCount = this.importedPoints.length;
        } else if (isRandomMode) {
            this.cubeSizeValue.value = this.cubeSize;
            this.sphereCount = this.cubeSize;
        } else {
            this.cubeSizeValue.value = this.cubeSize;
            this.sphereCount = this.cubeSize ** 3;
        }
    }
    
    updateSphereSizeDisplay() {
        this.sphereSizeValue.value = this.sphereSize.toFixed(1);
    }
    
    updateSpinSpeedDisplay() {
        this.spinSpeedValue.value = this.spinSpeed.toFixed(1);
    }
    
    // Enhanced slider control setup with bidirectional sync and mouse wheel support
    setupSliderControl(baseId, onChange) {
        const slider = document.getElementById(baseId);
        const valueInput = document.getElementById(baseId + 'Value');
        
        if (!slider || !valueInput) return;
        
        // Slider input handler
        slider.addEventListener('input', (e) => {
            const value = e.target.value;
            valueInput.value = baseId === 'spinSpeed' ? parseFloat(value).toFixed(1) : 
                               baseId === 'sphereSize' ? parseFloat(value).toFixed(1) : 
                               parseInt(value);
            onChange(value);
        });
        
        // Value input handler with validation
        valueInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            
            // Validate and clamp value
            if (!isNaN(value) && value >= min && value <= max) {
                slider.value = value;
                onChange(value);
            }
        });
        
        // Value input blur handler to fix invalid values
        valueInput.addEventListener('blur', (e) => {
            const value = parseFloat(e.target.value);
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            
            if (isNaN(value) || value < min || value > max) {
                // Restore to slider's current value
                e.target.value = baseId === 'spinSpeed' ? parseFloat(slider.value).toFixed(1) : 
                                baseId === 'sphereSize' ? parseFloat(slider.value).toFixed(1) : 
                                parseInt(slider.value);
            }
        });
        
        // Mouse wheel support for sliders
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const step = parseFloat(slider.step) || 1;
            const currentValue = parseFloat(slider.value);
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            
            // Calculate new value
            const delta = e.deltaY > 0 ? -step : step;
            const newValue = Math.max(min, Math.min(max, currentValue + delta));
            
            if (newValue !== currentValue) {
                slider.value = newValue;
                valueInput.value = baseId === 'spinSpeed' ? newValue.toFixed(1) : 
                                  baseId === 'sphereSize' ? newValue.toFixed(1) : 
                                  parseInt(newValue);
                onChange(newValue);
            }
        });
        
        // Mouse wheel support for value inputs
        valueInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const step = parseFloat(slider.step) || 1;
            const currentValue = parseFloat(valueInput.value);
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            
            // Calculate new value
            const delta = e.deltaY > 0 ? -step : step;
            const newValue = Math.max(min, Math.min(max, currentValue + delta));
            
            if (newValue !== currentValue && !isNaN(newValue)) {
                slider.value = newValue;
                valueInput.value = baseId === 'spinSpeed' ? newValue.toFixed(1) : 
                                  baseId === 'sphereSize' ? newValue.toFixed(1) : 
                                  parseInt(newValue);
                onChange(newValue);
            }
        });
    }
    
    importPoints() {
        const input = prompt(
            'Enter coordinates as comma-separated values:\n' +
            'Format: x1,y1,z1,x2,y2,z2,x3,y3,z3,...\n' +
            'Example: 0,0,0,0.5,-0.5,0.8,-1,1,0\n\n' +
            'Coordinates should be between -1 and 1.\n' +
            'Use "?" for unknown coordinates (LED will be black):'
        );

        if (input === null) return; // User cancelled

        try {
            const rawValues = input.trim().split(',').map(val => val.trim());
            const points = [];

            if (rawValues.length % 3 !== 0) {
                throw new Error(`Invalid number of coordinates. Expected multiples of 3 (x,y,z), got ${rawValues.length}`);
            }

            // Group values into sets of 3 (x,y,z)
            for (let i = 0; i < rawValues.length; i += 3) {
                const xStr = rawValues[i];
                const yStr = rawValues[i + 1];
                const zStr = rawValues[i + 2];

                // Check if this is an incomplete point (has any "?")
                const isIncomplete = xStr === '?' || yStr === '?' || zStr === '?';

                if (isIncomplete) {
                    // Store as incomplete point - will be black in output
                    points.push({ x: null, y: null, z: null, incomplete: true });
                } else {
                    // Parse as normal numbers
                    const x = parseFloat(xStr);
                    const y = parseFloat(yStr);
                    const z = parseFloat(zStr);

                    if (isNaN(x) || isNaN(y) || isNaN(z)) {
                        throw new Error(`Invalid coordinates at position ${i / 3}: (${xStr}, ${yStr}, ${zStr}). Use numbers or "?" for unknown coordinates.`);
                    }

                    // Clamp coordinates to -1 to 1 range
                    points.push({
                        x: Math.max(-1, Math.min(1, x)),
                        y: Math.max(-1, Math.min(1, y)),
                        z: Math.max(-1, Math.min(1, z)),
                        incomplete: false
                    });
                }
            }

            if (points.length === 0) {
                throw new Error('No valid coordinates found');
            }

            if (points.length > 4096) {
                throw new Error(`Too many points (${points.length}). Maximum is 4096 for performance.`);
            }

            const completePoints = points.filter(p => !p.incomplete).length;
            const incompletePoints = points.length - completePoints;

            this.importedPoints = points;
            this.updateImportedPointsDisplay();
            this.generateSpherePositions();
            if (!this.isRunning) this.render();

            let statusMsg = `Imported ${points.length} LEDs`;
            if (incompletePoints > 0) {
                statusMsg += ` (${incompletePoints} black)`;
            }
            this.setStatus(statusMsg, 'success');

        } catch (error) {
            this.setStatus(`Import error: ${error.message}`, 'error');
            alert(`Import error: ${error.message}`);
        }
    }
    
    updateImportedPointsDisplay() {
        this.importedPointsCount.textContent = `${this.importedPoints.length} points`;
    }
    
    setStatus(message, type = 'normal') {
        this.statusMessage.textContent = message;
        const statusContainer = document.querySelector('.status');
        statusContainer.className = 'status';
        if (type !== 'normal') {
            statusContainer.classList.add(type);
        }
    }
    
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorDisplay.style.display = 'block';
    }
    
    hideError() {
        this.errorDisplay.style.display = 'none';
        this.errorMessage.textContent = '';
    }
    
    handleResize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.updateProjectionMatrix();
        if (!this.isRunning) this.render();
    }
    
    handleStickyViewport() {
        const canvasContainer = document.querySelector('.canvas-container');
        const viewportSection = document.querySelector('.viewport-section');
        
        if (!canvasContainer || !viewportSection) return;
        
        const viewportRect = viewportSection.getBoundingClientRect();
        // Trigger sticky mode when 25% of viewport is cut off (75% still visible)
        const shouldBeSticky = viewportRect.bottom < viewportRect.height * 0.75;
        
        if (shouldBeSticky && !canvasContainer.classList.contains('sticky')) {
            // Create placeholder to maintain layout
            this.createStickyPlaceholder(canvasContainer);
            
            canvasContainer.classList.add('sticky');
            // Store original canvas size if not already stored
            if (!this.originalCanvasSize) {
                this.originalCanvasSize = {
                    width: this.canvas.width,
                    height: this.canvas.height
                };
            }
            
            // Initialize sticky canvas size (use stored size if available)
            if (!this.stickyCanvasSize) {
                this.stickyCanvasSize = { width: 400, height: 305 };
            }
            
            // Update canvas size for sticky mode (fixed size: 400x305)
            this.canvas.width = 400;
            this.canvas.height = 305;
            this.gl.viewport(0, 0, 400, 305);
            this.updateProjectionMatrix();
            if (!this.isRunning) this.render();
            
        } else if (!shouldBeSticky && canvasContainer.classList.contains('sticky')) {
            canvasContainer.classList.remove('sticky');
            
            // Remove placeholder to restore normal layout
            this.removeStickyPlaceholder();
            
            // Store current sticky size for next time
            this.stickyCanvasSize = {
                width: this.canvas.width,
                height: this.canvas.height
            };
            
            // Restore original canvas size
            if (this.originalCanvasSize) {
                this.canvas.width = this.originalCanvasSize.width;
                this.canvas.height = this.originalCanvasSize.height;
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
                this.updateProjectionMatrix();
                if (!this.isRunning) this.render();
            }
            
        }
    }
    
    createStickyPlaceholder(canvasContainer) {
        // Don't create if already exists
        if (document.querySelector('.sticky-placeholder')) return;
        
        // Get current dimensions and position
        const rect = canvasContainer.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(canvasContainer);
        
        // Create placeholder element
        const placeholder = document.createElement('div');
        placeholder.className = 'sticky-placeholder';
        placeholder.style.width = rect.width + 'px';
        placeholder.style.height = rect.height + 'px';
        placeholder.style.margin = computedStyle.margin;
        placeholder.style.padding = computedStyle.padding;
        placeholder.style.border = 'transparent';
        placeholder.style.visibility = 'hidden';
        placeholder.style.pointerEvents = 'none';
        
        // Insert placeholder before the canvas container
        canvasContainer.parentNode.insertBefore(placeholder, canvasContainer);
    }
    
    removeStickyPlaceholder() {
        const placeholder = document.querySelector('.sticky-placeholder');
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
    }
    
    // Removed resize functionality - sticky viewport now has fixed size
    
    // Collapsible sections functionality
    initializeSections() {
        // Initialize both sections as expanded
        this.viewportControlsContent.classList.add('expanded');
        this.codeEditorContent.classList.add('expanded');
        
        // Set initial arrow states
        const viewportArrow = this.viewportControlsHeader.querySelector('.toggle-arrow');
        const codeArrow = this.codeEditorHeader.querySelector('.toggle-arrow');
        viewportArrow.classList.add('rotated');
        codeArrow.classList.add('rotated');
    }
    
    toggleSection(sectionName) {
        let content, header, arrow;
        
        if (sectionName === 'viewportControls') {
            content = this.viewportControlsContent;
            header = this.viewportControlsHeader;
        } else if (sectionName === 'codeEditor') {
            content = this.codeEditorContent;
            header = this.codeEditorHeader;
        } else if (sectionName === 'parameters') {
            content = this.parametersContent;
            header = this.parametersHeader;
        } else {
            return;
        }
        
        arrow = header.querySelector('.toggle-arrow');
        const isExpanded = content.classList.contains('expanded');
        
        if (isExpanded) {
            // Collapse
            content.classList.remove('expanded');
            content.classList.add('collapsed');
            arrow.classList.remove('rotated');
        } else {
            // Expand
            content.classList.remove('collapsed');
            content.classList.add('expanded');
            arrow.classList.add('rotated');
        }
    }
    
    // Parameter system methods
    parseParameters(code) {
        // Extract parameter definitions from code
        const paramRegex = /const\s+params\s*=\s*({[\s\S]*?});/;
        const match = code.match(paramRegex);
        
        if (!match) {
            return {};
        }
        
        try {
            // Create a safe evaluation context for the params object
            const paramsFunc = new Function(`return ${match[1]}`);
            const params = paramsFunc();
            
            // Parse both grouped and ungrouped parameters
            const validatedParams = {};
            const groups = {};
            
            for (const [key, value] of Object.entries(params)) {
                if (typeof value === 'object' && value !== null) {
                    // Check if this is a group (has 'group' property)
                    if (value.group && typeof value.group === 'string') {
                        const groupName = value.group;
                        if (!groups[groupName]) {
                            groups[groupName] = [];
                        }
                        
                        // Process parameters within the group
                        for (const [paramKey, param] of Object.entries(value)) {
                            if (paramKey !== 'group' && typeof param === 'object' && param !== null) {
                                const validatedParam = this.validateParameter(paramKey, param);
                                if (validatedParam) {
                                    validatedParam.group = groupName;
                                    validatedParams[paramKey] = validatedParam;
                                    groups[groupName].push(paramKey);
                                }
                            }
                        }
                    } else {
                        // This is a standalone parameter
                        const validatedParam = this.validateParameter(key, value);
                        if (validatedParam) {
                            validatedParams[key] = validatedParam;
                        }
                    }
                }
            }
            
            // Store group information
            this.parameterGroups = groups;
            
            return validatedParams;
        } catch (error) {
            console.warn('Failed to parse parameters:', error);
            return {};
        }
    }
    
    validateParameter(key, param) {
        const name = param.name || key;
        const type = param.type || 'float';
        
        if (type === 'float') {
            const min = typeof param.min === 'number' ? param.min : 0;
            const max = typeof param.max === 'number' ? param.max : 1;
            const defaultValue = typeof param.default === 'number' ? param.default : min;
            
            return {
                type: 'float',
                name,
                min,
                max,
                default: Math.max(min, Math.min(max, defaultValue))
            };
        } else if (type === 'int') {
            const min = typeof param.min === 'number' ? Math.floor(param.min) : 0;
            const max = typeof param.max === 'number' ? Math.floor(param.max) : 10;
            const defaultValue = typeof param.default === 'number' ? Math.floor(param.default) : min;
            
            return {
                type: 'int',
                name,
                min,
                max,
                default: Math.max(min, Math.min(max, defaultValue))
            };
        } else if (type === 'vec2') {
            const minVec = Array.isArray(param.min) && param.min.length === 2 ? param.min : [0.0, 0.0];
            const maxVec = Array.isArray(param.max) && param.max.length === 2 ? param.max : [1.0, 1.0];
            const defaultVec = Array.isArray(param.default) && param.default.length === 2 
                ? param.default 
                : [0.5, 0.5];
            
            return {
                type: 'vec2',
                name,
                min: minVec,
                max: maxVec,
                default: [
                    Math.max(minVec[0], Math.min(maxVec[0], defaultVec[0])),
                    Math.max(minVec[1], Math.min(maxVec[1], defaultVec[1]))
                ]
            };
        } else if (type === 'color') {
            const defaultValue = Array.isArray(param.default) && param.default.length === 3 
                ? param.default.map(v => Math.max(0, Math.min(1, v))) 
                : [1.0, 1.0, 1.0];
            
            return {
                type: 'color',
                name,
                default: defaultValue
            };
        } else if (type === 'enum') {
            const options = Array.isArray(param.options) ? param.options : ['Option 1', 'Option 2'];
            const defaultValue = typeof param.default === 'number' 
                ? Math.max(0, Math.min(options.length - 1, Math.floor(param.default)))
                : 0;
            
            return {
                type: 'enum',
                name,
                options,
                default: defaultValue
            };
        } else if (type === 'flag') {
            const flags = Array.isArray(param.flags) ? param.flags : ['Flag 1', 'Flag 2'];
            const defaultValue = typeof param.default === 'number' 
                ? Math.max(0, Math.min((1 << flags.length) - 1, Math.floor(param.default)))
                : 0;
            
            return {
                type: 'flag',
                name,
                flags,
                default: defaultValue
            };
        }
        
        return null;
    }
    
    createParameterControls() {
        this.parametersContainer.innerHTML = '';
        
        if (Object.keys(this.parameters).length === 0) {
            this.parametersSection.style.display = 'none';
            return;
        }
        
        this.parametersSection.style.display = 'block';
        
        // Group parameters by their group property
        const groupedParams = {};
        const ungroupedParams = {};
        
        for (const [key, param] of Object.entries(this.parameters)) {
            if (param.group) {
                if (!groupedParams[param.group]) {
                    groupedParams[param.group] = {};
                }
                groupedParams[param.group][key] = param;
            } else {
                ungroupedParams[key] = param;
            }
        }
        
        // Create grouped parameters first
        for (const [groupName, groupParams] of Object.entries(groupedParams)) {
            this.createParameterGroup(groupName, groupParams);
        }
        
        // Create a synthetic "General" group for ungrouped parameters if any exist
        if (Object.keys(ungroupedParams).length > 0) {
            this.createParameterGroup('General', ungroupedParams);
        }
    }
    
    createParameterGroup(groupName, groupParams) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'parameter-group';
        
        // Group header
        const groupHeader = document.createElement('div');
        groupHeader.className = 'parameter-group-header';
        
        const groupTitle = document.createElement('h4');
        groupTitle.textContent = groupName;
        
        const groupArrow = document.createElement('span');
        groupArrow.className = 'parameter-group-arrow';
        groupArrow.textContent = '▼';
        
        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(groupArrow);
        
        // Group content
        const groupContent = document.createElement('div');
        groupContent.className = 'parameter-group-content';
        
        // Add parameters to group
        for (const [key, param] of Object.entries(groupParams)) {
            const controlDiv = this.createParameterControl(key, param);
            groupContent.appendChild(controlDiv);
        }
        
        // Toggle functionality
        let isExpanded = true;
        const toggleGroup = () => {
            isExpanded = !isExpanded;
            if (isExpanded) {
                groupContent.style.display = 'block';
                groupArrow.textContent = '▼';
                groupArrow.classList.remove('collapsed');
            } else {
                groupContent.style.display = 'none';
                groupArrow.textContent = '▶';
                groupArrow.classList.add('collapsed');
            }
        };
        
        groupHeader.addEventListener('click', toggleGroup);
        
        groupDiv.appendChild(groupHeader);
        groupDiv.appendChild(groupContent);
        this.parametersContainer.appendChild(groupDiv);
    }
    
    createParameterControl(key, param) {
        const controlDiv = document.createElement('div');
        controlDiv.className = 'parameter-control';
        
        const label = document.createElement('label');
        label.className = 'parameter-label';
        label.textContent = param.name;
        
        const inputsDiv = document.createElement('div');
        inputsDiv.className = 'parameter-inputs';
        
        if (param.type === 'float') {
            this.createFloatControl(inputsDiv, param, key);
        } else if (param.type === 'int') {
            this.createIntegerControl(inputsDiv, param, key);
        } else if (param.type === 'vec2') {
            this.createVec2Control(inputsDiv, param, key);
        } else if (param.type === 'color') {
            this.createColorControl(inputsDiv, param, key);
        } else if (param.type === 'enum') {
            this.createEnumControl(inputsDiv, param, key);
        } else if (param.type === 'flag') {
            this.createFlagControl(inputsDiv, param, key);
        }
        
        controlDiv.appendChild(label);
        controlDiv.appendChild(inputsDiv);
        
        // Reset button
        const resetButton = document.createElement('button');
        resetButton.className = 'parameter-reset';
        resetButton.innerHTML = '↺';
        resetButton.title = 'Reset to default value';
        resetButton.onclick = () => {
            this.resetParameter(key, param);
        };
        
        controlDiv.appendChild(resetButton);
        
        if (!param.group) {
            this.parametersContainer.appendChild(controlDiv);
        }
        
        return controlDiv;
    }
    
    createFloatControl(container, param, key) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'slider slider-small';
        slider.min = param.min;
        slider.max = param.max;
        slider.step = (param.max - param.min) / 1000;
        slider.value = this.parameterValues[key];
        
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.className = 'form-control input-small';
        numberInput.min = param.min;
        numberInput.max = param.max;
        numberInput.step = (param.max - param.min) / 1000;
        numberInput.value = this.parameterValues[key];
        
        const updateValue = (value) => {
            const clampedValue = Math.max(param.min, Math.min(param.max, parseFloat(value)));
            slider.value = clampedValue;
            numberInput.value = clampedValue;
            this.parameterValues[key] = clampedValue;
        };
        
        slider.addEventListener('input', (e) => updateValue(e.target.value));
        numberInput.addEventListener('input', (e) => updateValue(e.target.value));
        
        this.addMouseWheelSupport(slider, numberInput, param, key);
        
        container.appendChild(slider);
        container.appendChild(numberInput);
    }
    
    createIntegerControl(container, param, key) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'slider slider-small';
        slider.min = param.min;
        slider.max = param.max;
        slider.step = 1;
        slider.value = this.parameterValues[key];
        
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.className = 'form-control input-small';
        numberInput.min = param.min;
        numberInput.max = param.max;
        numberInput.step = 1;
        numberInput.value = this.parameterValues[key];
        
        const updateValue = (value) => {
            const intValue = Math.floor(parseFloat(value) || param.min);
            const clampedValue = Math.max(param.min, Math.min(param.max, intValue));
            slider.value = clampedValue;
            numberInput.value = clampedValue;
            this.parameterValues[key] = clampedValue;
        };
        
        slider.addEventListener('input', (e) => updateValue(e.target.value));
        numberInput.addEventListener('input', (e) => updateValue(e.target.value));
        
        this.addIntegerMouseWheelSupport(slider, numberInput, param, key);
        
        container.appendChild(slider);
        container.appendChild(numberInput);
    }
    
    createVec2Control(container, param, key) {
        const sliderArea = document.createElement('div');
        sliderArea.className = 'parameter-vec2-area';
        
        const sliderHandle = document.createElement('div');
        sliderHandle.className = 'parameter-vec2-handle';
        sliderArea.appendChild(sliderHandle);
        
        const updateHandlePosition = () => {
            const [x, y] = this.parameterValues[key];
            const normalizedX = (x - param.min[0]) / (param.max[0] - param.min[0]);
            const normalizedY = (y - param.min[1]) / (param.max[1] - param.min[1]);
            
            sliderHandle.style.left = `${normalizedX * 100}%`;
            sliderHandle.style.top = `${(1 - normalizedY) * 100}%`;
        };
        
        updateHandlePosition();
        
        let isDragging = false;
        
        const updateFromMouse = (e) => {
            const rect = sliderArea.getBoundingClientRect();
            const normalizedX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const normalizedY = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
            
            const newX = param.min[0] + normalizedX * (param.max[0] - param.min[0]);
            const newY = param.min[1] + normalizedY * (param.max[1] - param.min[1]);
            
            this.parameterValues[key] = [newX, newY];
            updateHandlePosition();
            
            xInput.value = newX;
            yInput.value = newY;
        };
        
        sliderArea.addEventListener('mousedown', (e) => {
            isDragging = true;
            updateFromMouse(e);
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) updateFromMouse(e);
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
        
        const numberContainer = document.createElement('div');
        numberContainer.className = 'parameter-vec2-inputs';
        
        const xInput = document.createElement('input');
        xInput.type = 'number';
        xInput.className = 'form-control input-small';
        xInput.min = param.min[0];
        xInput.max = param.max[0];
        xInput.step = (param.max[0] - param.min[0]) / 1000;
        xInput.value = this.parameterValues[key][0];
        xInput.placeholder = 'X';
        
        const yInput = document.createElement('input');
        yInput.type = 'number';
        yInput.className = 'form-control input-small';
        yInput.min = param.min[1];
        yInput.max = param.max[1];
        yInput.step = (param.max[1] - param.min[1]) / 1000;
        yInput.value = this.parameterValues[key][1];
        yInput.placeholder = 'Y';
        
        const updateFromInputs = () => {
            const newX = Math.max(param.min[0], Math.min(param.max[0], parseFloat(xInput.value) || param.min[0]));
            const newY = Math.max(param.min[1], Math.min(param.max[1], parseFloat(yInput.value) || param.min[1]));
            
            this.parameterValues[key] = [newX, newY];
            xInput.value = newX;
            yInput.value = newY;
            updateHandlePosition();
        };
        
        xInput.addEventListener('input', updateFromInputs);
        yInput.addEventListener('input', updateFromInputs);
        
        numberContainer.appendChild(xInput);
        numberContainer.appendChild(yInput);
        
        container.appendChild(sliderArea);
        container.appendChild(numberContainer);
    }
    
    createColorControl(container, param, key) {
        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.className = 'form-control color-picker';
        
        const rgbToHex = (rgb) => {
            const r = Math.round(rgb[0] * 255);
            const g = Math.round(rgb[1] * 255);
            const b = Math.round(rgb[2] * 255);
            return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        };
        
        const hexToRgb = (hex) => {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return [r, g, b];
        };
        
        colorPicker.value = rgbToHex(this.parameterValues[key]);
        
        const rgbContainer = document.createElement('div');
        rgbContainer.className = 'parameter-rgb-inputs';
        
        const createRGBInput = (component, index) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control input-small';
            input.min = 0;
            input.max = 1;
            input.step = 0.01;
            input.value = this.parameterValues[key][index];
            input.placeholder = component;
            
            const updateFromRGB = () => {
                const newColor = [...this.parameterValues[key]];
                newColor[index] = Math.max(0, Math.min(1, parseFloat(input.value) || 0));
                this.parameterValues[key] = newColor;
                colorPicker.value = rgbToHex(newColor);
                
                rgbInputs.forEach((inp, i) => {
                    if (i !== index) inp.value = newColor[i];
                });
            };
            
            input.addEventListener('input', updateFromRGB);
            
            return input;
        };
        
        const rgbInputs = [
            createRGBInput('R', 0),
            createRGBInput('G', 1),
            createRGBInput('B', 2)
        ];
        
        rgbInputs.forEach(input => rgbContainer.appendChild(input));
        
        colorPicker.addEventListener('input', (e) => {
            const newColor = hexToRgb(e.target.value);
            this.parameterValues[key] = newColor;
            rgbInputs.forEach((input, i) => {
                input.value = newColor[i];
            });
        });
        
        container.appendChild(colorPicker);
        container.appendChild(rgbContainer);
    }
    
    createEnumControl(container, param, key) {
        const select = document.createElement('select');
        select.className = 'form-control select-small';
        
        param.options.forEach((option, index) => {
            const optionElement = document.createElement('option');
            optionElement.value = index;
            optionElement.textContent = option;
            if (index === this.parameterValues[key]) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });
        
        select.addEventListener('change', (e) => {
            this.parameterValues[key] = parseInt(e.target.value);
        });
        
        container.appendChild(select);
    }
    
    createFlagControl(container, param, key) {
        const flagContainer = document.createElement('div');
        flagContainer.className = 'parameter-flag-container';
        
        param.flags.forEach((flag, index) => {
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'parameter-flag-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'parameter-flag-checkbox';
            checkbox.id = `${key}_flag_${index}`;
            checkbox.checked = (this.parameterValues[key] & (1 << index)) !== 0;
            
            const label = document.createElement('label');
            label.className = 'parameter-flag-label';
            label.htmlFor = checkbox.id;
            label.textContent = flag;
            
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.parameterValues[key] |= (1 << index);
                } else {
                    this.parameterValues[key] &= ~(1 << index);
                }
            });
            
            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(label);
            flagContainer.appendChild(checkboxWrapper);
        });
        
        container.appendChild(flagContainer);
    }
    
    addMouseWheelSupport(slider, numberInput, param, key) {
        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const step = (param.max - param.min) / 100;
            const currentValue = parseFloat(slider.value);
            const newValue = Math.max(param.min, Math.min(param.max, currentValue + (delta * step)));
            
            slider.value = newValue;
            numberInput.value = newValue;
            this.parameterValues[key] = newValue;
        };
        
        slider.addEventListener('wheel', handleWheel);
        numberInput.addEventListener('wheel', handleWheel);
    }
    
    addIntegerMouseWheelSupport(slider, numberInput, param, key) {
        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(slider.value);
            const newValue = Math.max(param.min, Math.min(param.max, currentValue + delta));
            
            slider.value = newValue;
            numberInput.value = newValue;
            this.parameterValues[key] = newValue;
        };
        
        slider.addEventListener('wheel', handleWheel);
        numberInput.addEventListener('wheel', handleWheel);
    }
    
    resetParameter(key, param) {
        this.parameterValues[key] = Array.isArray(param.default) ? [...param.default] : param.default;
        this.createParameterControls();
    }
    
    // Presets management methods
    loadPresets() {
        try {
            const stored = localStorage.getItem('cubeDemo_presets');
            this.presets = stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.warn('Failed to load presets from localStorage:', error);
            this.presets = {};
        }
    }
    
    savePresets() {
        try {
            localStorage.setItem('cubeDemo_presets', JSON.stringify(this.presets));
        } catch (error) {
            console.error('Failed to save presets to localStorage:', error);
            this.setStatus('Failed to save presets', 'error');
        }
    }
    
    savePreset() {
        if (Object.keys(this.parameters).length === 0) {
            this.setStatus('No parameters to save', 'error');
            return;
        }
        
        const selectedPreset = this.presetSelector.value;
        let targetName = null;
        
        if (selectedPreset) {
            // A preset is selected - ask if they want to overwrite it
            const overwrite = confirm(`Do you want to overwrite the selected preset "${selectedPreset}"?`);
            if (overwrite) {
                targetName = selectedPreset;
            } else {
                // User doesn't want to overwrite, prompt for new name
                targetName = this.promptForPresetName();
            }
        } else {
            // No preset selected - prompt for new name
            targetName = this.promptForPresetName();
        }
        
        if (!targetName) return; // User cancelled
        
        const presetData = {
            timestamp: Date.now(),
            parameterValues: {},
            parameterDefinitions: {}
        };
        
        // Store current parameter values and definitions
        for (const [key, value] of Object.entries(this.parameterValues)) {
            presetData.parameterValues[key] = Array.isArray(value) ? [...value] : value;
            if (this.parameters[key]) {
                presetData.parameterDefinitions[key] = { ...this.parameters[key] };
            }
        }
        
        const existingNames = Object.keys(this.presets);
        const wasExisting = existingNames.includes(targetName);
        
        this.presets[targetName] = presetData;
        this.savePresets();
        this.updatePresetSelector();
        
        // Update selector to show the saved preset
        this.presetSelector.value = targetName;
        const hasSelection = this.presetSelector.value !== '';
        this.loadPresetBtn.disabled = !hasSelection;
        this.deletePresetBtn.disabled = !hasSelection;
        
        const action = wasExisting ? 'updated' : 'saved';
        this.setStatus(`Preset "${targetName}" ${action}`, 'success');
    }
    
    promptForPresetName() {
        const existingNames = Object.keys(this.presets);
        const defaultName = `Preset ${existingNames.length + 1}`;
        
        let nameOptions = '';
        if (existingNames.length > 0) {
            nameOptions = '\n\nExisting presets:\n' + existingNames.map(name => `• ${name}`).join('\n');
        }
        
        const name = prompt(
            `Enter a name for this preset:${nameOptions}\n\nNote: If you use an existing name, it will be overwritten.`,
            defaultName
        );
        
        if (name === null) return null; // User cancelled
        
        if (!name.trim()) {
            this.setStatus('Preset name cannot be empty', 'error');
            return null;
        }
        
        return name.trim();
    }
    
    loadPreset(presetName) {
        if (!this.presets[presetName]) {
            this.setStatus(`Preset "${presetName}" not found`, 'error');
            return;
        }
        
        const preset = this.presets[presetName];
        const warnings = [];
        const loaded = [];
        let loadedCount = 0;
        
        // Attempt to load each parameter value
        for (const [key, value] of Object.entries(preset.parameterValues)) {
            if (this.parameters[key]) {
                const currentParam = this.parameters[key];
                const storedParam = preset.parameterDefinitions[key];
                
                // Check if parameter types match
                if (storedParam && currentParam.type === storedParam.type) {
                    // Validate the value based on parameter type
                    let isValid = false;
                    let processedValue = value;
                    
                    switch (currentParam.type) {
                        case 'float':
                            if (typeof value === 'number' && !isNaN(value)) {
                                processedValue = Math.max(currentParam.min, Math.min(currentParam.max, value));
                                isValid = true;
                            }
                            break;
                        case 'int':
                            if (typeof value === 'number' && !isNaN(value)) {
                                processedValue = Math.max(currentParam.min, Math.min(currentParam.max, Math.floor(value)));
                                isValid = true;
                            }
                            break;
                        case 'vec2':
                            if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && !isNaN(v))) {
                                processedValue = [
                                    Math.max(currentParam.min[0], Math.min(currentParam.max[0], value[0])),
                                    Math.max(currentParam.min[1], Math.min(currentParam.max[1], value[1]))
                                ];
                                isValid = true;
                            }
                            break;
                        case 'color':
                            if (Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && !isNaN(v))) {
                                processedValue = value.map(v => Math.max(0, Math.min(1, v)));
                                isValid = true;
                            }
                            break;
                        case 'enum':
                            if (typeof value === 'number' && !isNaN(value)) {
                                processedValue = Math.max(0, Math.min(currentParam.options.length - 1, Math.floor(value)));
                                isValid = true;
                            }
                            break;
                        case 'flag':
                            if (typeof value === 'number' && !isNaN(value)) {
                                const maxValue = (1 << currentParam.flags.length) - 1;
                                processedValue = Math.max(0, Math.min(maxValue, Math.floor(value)));
                                isValid = true;
                            }
                            break;
                    }
                    
                    if (isValid) {
                        this.parameterValues[key] = processedValue;
                        loaded.push(currentParam.name || key);
                        loadedCount++;
                    } else {
                        warnings.push(`${currentParam.name || key}: Invalid value format`);
                    }
                } else {
                    const reason = storedParam ? 'type mismatch' : 'definition changed';
                    warnings.push(`${currentParam.name || key}: Skipped (${reason})`);
                }
            } else {
                warnings.push(`${key}: Parameter no longer exists`);
            }
        }
        
        // Update UI with loaded values
        this.createParameterControls();
        
        // Show results
        let message = `Loaded preset "${presetName}"`;
        if (loadedCount > 0) {
            message += ` (${loadedCount} parameters)`;
        }
        
        if (warnings.length > 0) {
            message += `\n\nWarnings:\n${warnings.join('\n')}`;
            this.setStatus(`Preset loaded with warnings`, 'error');
            alert(message);
        } else {
            this.setStatus(`Preset "${presetName}" loaded successfully`, 'success');
        }
    }
    
    deletePreset(presetName) {
        if (!this.presets[presetName]) {
            this.setStatus(`Preset "${presetName}" not found`, 'error');
            return;
        }
        
        if (confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
            delete this.presets[presetName];
            this.savePresets();
            this.updatePresetSelector();
            this.setStatus(`Preset "${presetName}" deleted`, 'success');
        }
    }
    
    updatePresetSelector() {
        const selector = document.getElementById('presetSelector');
        if (!selector) return;
        
        // Clear existing options except the first one
        selector.innerHTML = '<option value="">Select a preset...</option>';
        
        const presetNames = Object.keys(this.presets).sort();
        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            selector.appendChild(option);
        });
        
        // Update preset count display
        const countDisplay = document.getElementById('presetCount');
        if (countDisplay) {
            countDisplay.textContent = presetNames.length > 0 ? `${presetNames.length} presets` : 'No presets';
        }
    }
    
    // Source code persistence methods
    saveSourceCode() {
        try {
            const code = this.codeInput.value;
            localStorage.setItem('cubeDemo_sourceCode', code);
        } catch (error) {
            console.warn('Failed to save source code to localStorage:', error);
        }
    }
    
    loadSourceCode() {
        try {
            const savedCode = localStorage.getItem('cubeDemo_sourceCode');
            return savedCode;
        } catch (error) {
            console.warn('Failed to load source code from localStorage:', error);
            return null;
        }
    }
    
    resetSourceCode() {
        if (confirm('Reset source code to the default template? This will overwrite your current code.')) {
            this.codeInput.value = this.defaultCode;
            this.saveSourceCode();
            this.setStatus('Source code reset to default template', 'success');
        }
    }
    
    // Viewport settings persistence methods
    saveViewportSettings() {
        try {
            const settings = {
                distributionMode: this.distributionMode.value,
                cubeOrientation: this.cubeOrientation.value,
                cubeSize: this.cubeSize,
                sphereSize: this.sphereSize,
                spinSpeed: this.spinSpeed,
                importedPoints: this.importedPoints
            };
            localStorage.setItem('cubeDemo_viewportSettings', JSON.stringify(settings));
        } catch (error) {
            console.warn('Failed to save viewport settings to localStorage:', error);
        }
    }
    
    loadViewportSettings() {
        try {
            const saved = localStorage.getItem('cubeDemo_viewportSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                
                // Restore distribution mode
                if (settings.distributionMode && ['grid', 'random', 'import'].includes(settings.distributionMode)) {
                    this.distributionMode.value = settings.distributionMode;
                }
                
                // Restore cube orientation
                if (settings.cubeOrientation && ['normal', 'tipped'].includes(settings.cubeOrientation)) {
                    this.cubeOrientation.value = settings.cubeOrientation;
                }
                
                // Restore numeric settings with validation
                if (typeof settings.cubeSize === 'number' && settings.cubeSize >= 4) {
                    this.cubeSize = settings.cubeSize;
                    this.cubeSizeSlider.value = this.cubeSize;
                    this.cubeSizeValue.value = this.cubeSize;
                }
                
                if (typeof settings.sphereSize === 'number' && settings.sphereSize >= 0.1 && settings.sphereSize <= 5.0) {
                    this.sphereSize = settings.sphereSize;
                    this.sphereSizeSlider.value = this.sphereSize;
                    this.sphereSizeValue.value = this.sphereSize.toFixed(1);
                }
                
                if (typeof settings.spinSpeed === 'number' && settings.spinSpeed >= 0.0 && settings.spinSpeed <= 5.0) {
                    this.spinSpeed = settings.spinSpeed;
                    this.spinSpeedSlider.value = this.spinSpeed;
                    this.spinSpeedValue.value = this.spinSpeed.toFixed(1);
                    
                    // Start spin animation if speed is non-zero
                    if (this.spinSpeed !== 0.0) {
                        if (!this.spinStartTime) {
                            this.spinStartTime = performance.now();
                        }
                        this.animate();
                    }
                }
                
                // Restore imported points if valid
                if (Array.isArray(settings.importedPoints) && settings.importedPoints.length <= 4096) {
                    const validPoints = settings.importedPoints.filter(point => {
                        if (!point) return false;

                        // Check if it's an incomplete point
                        if (point.incomplete === true) {
                            return point.x === null && point.y === null && point.z === null;
                        }

                        // Check if it's a complete point with valid coordinates
                        return typeof point.x === 'number' && point.x >= -1 && point.x <= 1 &&
                               typeof point.y === 'number' && point.y >= -1 && point.y <= 1 &&
                               typeof point.z === 'number' && point.z >= -1 && point.z <= 1;
                    });
                    this.importedPoints = validPoints;
                }
            }
        } catch (error) {
            console.warn('Failed to load viewport settings from localStorage:', error);
        }
    }
    
    // Keyboard shortcuts handler
    handleKeyboardShortcuts(e) {
        // Check for Ctrl+Enter (run animation)
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            this.runAnimation();
            return;
        }
        
        // Check for Ctrl+. (stop animation)
        if (e.ctrlKey && e.key === '.') {
            e.preventDefault();
            this.stopAnimation();
            return;
        }
    }
    
    // WLED websocket streaming methods
    loadWledSettings() {
        try {
            const saved = localStorage.getItem('cubeDemo_wledSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.host && typeof settings.host === 'string') {
                    this.wledHostValue = settings.host;
                    if (this.wledHost) {
                        this.wledHost.value = settings.host;
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to load WLED settings from localStorage:', error);
        }
    }
    
    saveWledSettings() {
        try {
            const settings = {
                host: this.wledHostValue || ''
            };
            localStorage.setItem('cubeDemo_wledSettings', JSON.stringify(settings));
        } catch (error) {
            console.warn('Failed to save WLED settings to localStorage:', error);
        }
    }
    
    toggleWledConnection() {
        if (this.wledConnected) {
            this.disconnectWled();
        } else {
            this.connectWled();
        }
    }
    
    connectWled() {
        if (!this.wledHost) {
            this.setStatus('WLED host input not found', 'error');
            return;
        }

        const host = this.wledHost.value ? this.wledHost.value.trim() : '';
        if (!host) {
            this.setStatus('Please enter a WLED host address', 'error');
            return;
        }

        // Get selected protocol
        if (this.wledProtocol) {
            this.wledProtocolType = this.wledProtocol.value || 'wled';
        }

        // Validate and format the websocket URL
        let wsUrl;
        try {
            // Remove any protocol prefix and add ws://
            const cleanHost = host.replace(/^(https?:\/\/|ws:\/\/|wss:\/\/)/, '');
            wsUrl = `ws://${cleanHost}/ws`;

            // Basic validation
            new URL(`http://${cleanHost}`);
        } catch (error) {
            this.setStatus('Invalid WLED host address format', 'error');
            return;
        }

        // Update UI to show connecting state
        this.updateWledStatus('connecting', 'Connecting...');
        this.wledConnect.disabled = true;

        try {
            this.wledWebsocket = new WebSocket(wsUrl);

            // Set binary type for binary protocol
            if (this.wledProtocolType === 'binary') {
                this.wledWebsocket.binaryType = 'arraybuffer';
            }

            this.wledWebsocket.onopen = () => {
                this.wledConnected = true;
                this.wledHostValue = host;
                this.saveWledSettings();
                this.updateWledStatus('connected', 'Connected');
                this.wledConnect.textContent = 'Disconnect';
                this.wledConnect.disabled = false;
                this.setStatus(`Connected to ${host} (${this.wledProtocolType})`, 'success');

                // Send clear command for binary protocol
                if (this.wledProtocolType === 'binary') {
                    this.sendBinaryClearCommand();
                }
            };

            this.wledWebsocket.onclose = (event) => {
                this.wledConnected = false;
                this.wledStreaming = false;
                this.wledWebsocket = null;
                this.updateWledStatus('disconnected', 'Disconnected');
                this.wledConnect.textContent = 'Connect';
                this.wledConnect.disabled = false;

                if (event.wasClean) {
                    this.setStatus('Disconnected from WLED', 'normal');
                } else {
                    this.setStatus('Connection to WLED lost', 'error');
                }
            };

            this.wledWebsocket.onerror = (error) => {
                console.error('WLED WebSocket error:', error);
                this.wledConnected = false;
                this.wledStreaming = false;
                this.updateWledStatus('error', 'Connection Error');
                this.wledConnect.textContent = 'Connect';
                this.wledConnect.disabled = false;
                this.setStatus('Failed to connect to WLED', 'error');
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.updateWledStatus('error', 'Connection Error');
            this.wledConnect.disabled = false;
            this.setStatus('Failed to connect to WLED', 'error');
        }
    }
    
    disconnectWled() {
        if (this.wledWebsocket) {
            // Send clear command for binary protocol before disconnecting
            if (this.wledProtocolType === 'binary' && this.wledWebsocket.readyState === WebSocket.OPEN) {
                this.sendBinaryClearCommand();
            }

            this.wledWebsocket.close(1000, 'User disconnect');
        }

        this.wledConnected = false;
        this.wledStreaming = false;
        this.wledWebsocket = null;
        this.updateWledStatus('disconnected', 'Disconnected');
        this.wledConnect.textContent = 'Connect';
        this.wledConnect.disabled = false;
    }
    
    updateWledStatus(status, text) {
        if (!this.wledStatus) return;
        
        // Remove all status classes
        this.wledStatus.classList.remove('connected', 'connecting', 'disconnected', 'error');
        
        // Add current status class
        this.wledStatus.classList.add(status);
        this.wledStatus.textContent = text;
    }
    
    streamColorsToWled() {
        if (!this.wledConnected || !this.wledWebsocket || this.wledWebsocket.readyState !== WebSocket.OPEN) {
            return;
        }

        if (!this.instanceColors || this.sphereCount === 0) {
            return;
        }

        // Throttle frame rate - only send if enough time has passed
        const now = performance.now();
        if (now - this.lastWledSendTime < this.wledFrameInterval) {
            return; // Skip this frame
        }

        // Check WebSocket buffer - skip if too much data is queued (>16KB)
        // This prevents latency from building up
        if (this.wledWebsocket.bufferedAmount > 16384) {
            console.warn(`Dropping frame - WebSocket buffer: ${this.wledWebsocket.bufferedAmount} bytes queued`);
            this.setStatus(`Dropping frames (buffer: ${Math.round(this.wledWebsocket.bufferedAmount / 1024)}KB)`, 'error');
            return;
        }

        this.lastWledSendTime = now;

        // Clear error status if we're successfully sending
        if (this.wledStreaming && this.statusMessage.textContent.includes('Dropping frames')) {
            this.setStatus('Streaming resumed', 'success');
        }

        // Route to appropriate protocol handler
        if (this.wledProtocolType === 'binary') {
            this.streamColorsBinaryProtocol();
        } else {
            this.streamColorsWledProtocol();
        }
    }

    streamColorsWledProtocol() {
        // Convert RGB float values to hex strings
        const colorArray = [];
        for (let i = 0; i < this.sphereCount; i++) {
            const r = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3])) * 255);
            const g = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3 + 1])) * 255);
            const b = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3 + 2])) * 255);

            const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase();
            colorArray.push(hex);
        }

        // Split into chunks of 256 colors per message (WLED limitation)
        const maxColorsPerMessage = 256;
        let offset = 0;

        while (offset < colorArray.length) {
            const chunk = colorArray.slice(offset, offset + maxColorsPerMessage);
            const message = {
                seg: {
                    i: [offset, ...chunk]
                }
            };

            try {
                this.wledWebsocket.send(JSON.stringify(message));
                this.wledStreaming = true;
            } catch (error) {
                console.error('Failed to send WLED data:', error);
                this.wledStreaming = false;
                break;
            }

            offset += maxColorsPerMessage;
        }
    }

    streamColorsBinaryProtocol() {
        // Binary protocol with 200 LEDs per channel
        const LEDS_PER_CHANNEL = 200;
        const totalLeds = this.sphereCount;

        // Calculate which channels need data and total buffer size
        const channelCount = Math.ceil(totalLeds / LEDS_PER_CHANNEL);
        let channelMask = 0;
        let totalBufferSize = 0;
        const channelSizes = [];

        // Calculate buffer sizes for each channel
        for (let channel = 0; channel < channelCount && channel < 8; channel++) {
            const startLed = channel * LEDS_PER_CHANNEL;
            const endLed = Math.min(startLed + LEDS_PER_CHANNEL, totalLeds);
            const ledsInChannel = endLed - startLed;

            if (ledsInChannel > 0) {
                const channelBufferSize = 4 + (ledsInChannel * 3); // header + RGB data
                channelSizes.push({ channel, startLed, endLed, ledsInChannel, size: channelBufferSize });
                totalBufferSize += channelBufferSize;
                channelMask |= (1 << channel);
            }
        }

        // Add flush command size (2 bytes)
        if (channelMask > 0) {
            totalBufferSize += 2;
        }

        // Build single combined message with all channel data + flush
        const combinedBuffer = new Uint8Array(totalBufferSize);
        let bufferOffset = 0;

        // Write all channel data
        for (const channelInfo of channelSizes) {
            // Command: Update buffer only (no flush)
            combinedBuffer[bufferOffset++] = 0xFE;
            // Channel ID
            combinedBuffer[bufferOffset++] = channelInfo.channel;
            // LED count (16-bit little-endian)
            combinedBuffer[bufferOffset++] = channelInfo.ledsInChannel & 0xFF;
            combinedBuffer[bufferOffset++] = (channelInfo.ledsInChannel >> 8) & 0xFF;

            // RGB data
            for (let i = channelInfo.startLed; i < channelInfo.endLed; i++) {
                const r = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3])) * 255);
                const g = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3 + 1])) * 255);
                const b = Math.round(Math.max(0, Math.min(1, this.instanceColors[i * 3 + 2])) * 255);

                combinedBuffer[bufferOffset++] = r;
                combinedBuffer[bufferOffset++] = g;
                combinedBuffer[bufferOffset++] = b;
            }
        }

        // Append flush command at the end
        if (channelMask > 0) {
            combinedBuffer[bufferOffset++] = 0xFD; // Flush command
            combinedBuffer[bufferOffset++] = channelMask;
        }

        // Send single combined message
        try {
            this.wledWebsocket.send(combinedBuffer.buffer);
            this.wledStreaming = true;
        } catch (error) {
            console.error('Failed to send binary data:', error);
            this.wledStreaming = false;
        }
    }

    sendBinaryClearCommand() {
        if (!this.wledWebsocket || this.wledWebsocket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Send clear all LEDs command (0xF9)
        const clearBuffer = new Uint8Array(1);
        clearBuffer[0] = 0xF9;

        try {
            this.wledWebsocket.send(clearBuffer.buffer);
        } catch (error) {
            console.error('Failed to send binary clear command:', error);
        }
    }
}

// Simple matrix library (mat4)
const mat4 = {
    create() {
        return new Float32Array(16);
    },
    
    identity(out) {
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },
    
    perspective(out, fovy, aspect, near, far) {
        const f = 1.0 / Math.tan(fovy / 2);
        const nf = 1 / (near - far);
        
        out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
        out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
        return out;
    },
    
    translate(out, a, v) {
        const x = v[0], y = v[1], z = v[2];
        
        out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
        out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
        out[8] = a[8]; out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
        return out;
    },
    
    rotateX(out, a, rad) {
        const s = Math.sin(rad);
        const c = Math.cos(rad);
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        
        out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
        out[4] = a10 * c + a20 * s;
        out[5] = a11 * c + a21 * s;
        out[6] = a12 * c + a22 * s;
        out[7] = a13 * c + a23 * s;
        out[8] = a20 * c - a10 * s;
        out[9] = a21 * c - a11 * s;
        out[10] = a22 * c - a12 * s;
        out[11] = a23 * c - a13 * s;
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        return out;
    },
    
    rotateY(out, a, rad) {
        const s = Math.sin(rad);
        const c = Math.cos(rad);
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        
        out[0] = a00 * c - a20 * s;
        out[1] = a01 * c - a21 * s;
        out[2] = a02 * c - a22 * s;
        out[3] = a03 * c - a23 * s;
        out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
        out[8] = a00 * s + a20 * c;
        out[9] = a01 * s + a21 * c;
        out[10] = a02 * s + a22 * c;
        out[11] = a03 * s + a23 * c;
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        return out;
    },
    
    rotateZ(out, a, rad) {
        const s = Math.sin(rad);
        const c = Math.cos(rad);
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        
        out[0] = a00 * c + a10 * s;
        out[1] = a01 * c + a11 * s;
        out[2] = a02 * c + a12 * s;
        out[3] = a03 * c + a13 * s;
        out[4] = a10 * c - a00 * s;
        out[5] = a11 * c - a01 * s;
        out[6] = a12 * c - a02 * s;
        out[7] = a13 * c - a03 * s;
        out[8] = a[8]; out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        return out;
    }
};

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CubeDemo();
});
