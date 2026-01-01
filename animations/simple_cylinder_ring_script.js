// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.
// Cylinder Ring SDF Demo
// Displays N infinite cylinders arranged in a circle around the origin
// All cylinders are parallel and the group rotates together

const params = {
    autoGroup: {
        group: 'Automated Mode',
        autoMode: { type: 'float', name: 'Enable Auto Mode', min: 0.0, max: 1.0, default: 1.0 },
        holdDuration: { type: 'float', name: 'Hold Time (s)', min: 5.0, max: 120.0, default: 15.0 },
        transitionDuration: { type: 'float', name: 'Transition Time (s)', min: 1.0, max: 120.0, default: 60.0 }
    },

    cylinderGroup: {
        group: 'Cylinder Ring',
        numCylinders: { type: 'int', name: 'Number of Cylinders', min: 1, max: 20, default: 3 },
        cylinderRadius: { type: 'float', name: 'Cylinder Diameter', min: 0.01, max: 0.3, default: 0.1 },
        ringRadius: { type: 'float', name: 'Distance from Origin', min: 0.1, max: 0.5, default: 0.3 },
        rotationSpeedX: { type: 'float', name: 'Rotation Speed X', min: -2.0, max: 2.0, default: -0.5 },
        rotationSpeedY: { type: 'float', name: 'Rotation Speed Y', min: -2.0, max: 2.0, default: 0.15 },
        rotationSpeedZ: { type: 'float', name: 'Rotation Speed Z', min: -2.0, max: 2.0, default: 1.0 }
    },

    colorGroup: {
        group: 'Colors',
        hue: { type: 'float', name: 'Base Hue', min: 0.0, max: 1.0, default: 0.6 },
        saturation: { type: 'float', name: 'Saturation', min: 0.0, max: 1.0, default: 0.6 },
        hueOffset: { type: 'float', name: 'Hue Offset per Cylinder', min: 0.0, max: 1.0, default: 0.333 },
        hueShiftSpeed: { type: 'float', name: 'Hue Shift Time (s)', min: 1.0, max: 300.0, default: 180.0 },
        backColor: { type: 'color', name: 'Back Color', default: [0.0, 0.0, 0.0] },
        edgeSmoothness: { type: 'float', name: 'Edge Smoothness', min: 0.0, max: 0.5, default: 0.05 }
    },

    effectsGroup: {
        group: 'Effects',
        scrambleStrength: { type: 'float', name: 'Scramble Strength', min: 0.0, max: 1.0, default: 0.0 },
        scrambleFrequency: { type: 'float', name: 'Scramble Frequency', min: 0.0, max: 10.0, default: 1.0 },
        scrambleAmplitude: { type: 'float', name: 'Scramble Amplitude', min: 0.0, max: 1.0, default: 0.0 }
    }
};

// Vec3 class for 3D vector operations
class Vec3 {
    constructor(x = 0.0, y = 0.0, z = 0.0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    static splat(value) {
        return new Vec3(value, value, value);
    }

    get len() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    add(v) {
        return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
    }

    sub(v) {
        return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
    }

    mul(s) {
        return new Vec3(this.x * s, this.y * s, this.z * s);
    }
}

// Signed distance function for infinite cylinder along Z-axis at origin
function sdf_cylinder_z(v, radius) {
    return Math.sqrt(v.x * v.x + v.y * v.y) - radius;
}

// Signed distance function for a cylinder at a specific position (translated in XY plane)
// Cylinder is infinite along Z-axis
function sdf_cylinder_at(v, cx, cy, radius) {
    const dx = v.x - cx;
    const dy = v.y - cy;
    return Math.sqrt(dx * dx + dy * dy) - radius;
}

// Union of N cylinders arranged in a ring
// Returns { distance, cylinderIndex } where cylinderIndex is the closest cylinder
function sdf_cylinder_ring(v, numCylinders, cylinderRadius, ringRadius) {
    let minDist = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < numCylinders; i++) {
        const angle = (i / numCylinders) * Math.PI * 2.0;
        const cx = Math.cos(angle) * ringRadius;
        const cy = Math.sin(angle) * ringRadius;

        const dist = sdf_cylinder_at(v, cx, cy, cylinderRadius);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }

    return { distance: minDist, cylinderIndex: closestIndex };
}

// HSV to RGB conversion
// h, s, v are in range [0.0, 1.0]
// Returns [r, g, b] in range [0.0, 1.0]
function hsv2rgb(h, s, v) {
    // Wrap hue to [0, 1]
    h = h - Math.floor(h);

    const c = v * s;
    const x = c * (1.0 - Math.abs(((h * 6.0) % 2.0) - 1.0));
    const m = v - c;

    let r, g, b;

    if (h < 1.0 / 6.0) {
        r = c; g = x; b = 0;
    } else if (h < 2.0 / 6.0) {
        r = x; g = c; b = 0;
    } else if (h < 3.0 / 6.0) {
        r = 0; g = c; b = x;
    } else if (h < 4.0 / 6.0) {
        r = 0; g = x; b = c;
    } else if (h < 5.0 / 6.0) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }

    return [r + m, g + m, b + m];
}

// Smooth step function for smooth transitions
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

// Convert SDF value to brightness (0.0 to 1.0)
// Returns how much we're inside the shape
function sdf2side(f, ease = 0.0) {
    if (ease === 0.0) {
        return f <= 0.0 ? 1.0 : 0.0;
    }
    return 1.0 - smoothstep(-ease, ease, f);
}

// Rotation matrix application
function rotatePoint(pos, rotX, rotY, rotZ) {
    let result = new Vec3(pos.x, pos.y, pos.z);

    // Apply rotation around X axis
    if (rotX !== 0.0) {
        let cosX = Math.cos(rotX);
        let sinX = Math.sin(rotX);
        let y = result.y * cosX - result.z * sinX;
        let z = result.y * sinX + result.z * cosX;
        result = new Vec3(result.x, y, z);
    }

    // Apply rotation around Y axis
    if (rotY !== 0.0) {
        let cosY = Math.cos(rotY);
        let sinY = Math.sin(rotY);
        let x = result.x * cosY + result.z * sinY;
        let z = -result.x * sinY + result.z * cosY;
        result = new Vec3(x, result.y, z);
    }

    // Apply rotation around Z axis
    if (rotZ !== 0.0) {
        let cosZ = Math.cos(rotZ);
        let sinZ = Math.sin(rotZ);
        let x = result.x * cosZ - result.y * sinZ;
        let y = result.x * sinZ + result.y * cosZ;
        result = new Vec3(x, y, result.z);
    }

    return result;
}

// Deterministic hash function to map LED ID to another LED ID
function hashLedId(id, seed = 42) {
    let hash = id * 2654435761 + seed;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = (hash >>> 16) ^ hash;
    return Math.abs(hash);
}

function getSphereColor(x, y, z, t, params, id) {
    // x, y, z are normalized coordinates (0.0 to 1.0)
    // t is time in seconds since start
    // params contains parameter values
    // id is the sequential LED number (0 to N-1)
    // Return [r, g, b] values (0.0 to 1.0)

    // Automated mode parameters
    const autoMode = params.autoMode ?? 0.0;
    const holdDuration = params.holdDuration ?? 30.0;
    const transitionDuration = params.transitionDuration ?? 10.0;

    // Get parameters with defaults
    const numCylinders = Math.floor(params.numCylinders ?? 6.0);
    const cylinderRadius = params.cylinderRadius ?? 0.08;
    const ringRadius = params.ringRadius ?? 0.3;
    const rotationSpeedX = params.rotationSpeedX ?? 0.0;
    const rotationSpeedY = params.rotationSpeedY ?? 0.0;
    const rotationSpeedZ = params.rotationSpeedZ ?? 0.0;

    // Color parameters
    const baseHue = params.hue ?? 0.6;
    const saturation = params.saturation ?? 0.8;
    const hueOffset = params.hueOffset ?? 0.333;
    const hueShiftSpeed = params.hueShiftSpeed ?? 60.0;
    const backColor = params.backColor ?? [0.0, 0.0, 0.0];
    const edgeSmoothness = params.edgeSmoothness ?? 0.05;

    // Calculate animated base hue (completes full rotation in hueShiftSpeed seconds)
    const animatedBaseHue = baseHue + (t / hueShiftSpeed);

    // Effect parameters (scrambleStrength may be overridden by auto mode)
    let scrambleStrength = params.scrambleStrength ?? 0.0;
    const scrambleFrequency = params.scrambleFrequency ?? 1.0;
    const scrambleAmplitude = params.scrambleAmplitude ?? 0.0;

    // Automated mode override for scramble strength
    if (autoMode > 0.5) {
        // Calculate cycle timing
        const totalCycleTime = holdDuration + transitionDuration;
        const currentCycle = Math.floor(t / totalCycleTime);
        const cycleTime = t % totalCycleTime;
        const isTransitioning = cycleTime >= holdDuration;

        // Transition direction alternates each cycle
        const transitionUp = currentCycle % 2 === 0;

        if (isTransitioning) {
            // During transition: smoothly animate between 0.0 and 1.0
            const transitionPhase = (cycleTime - holdDuration) / transitionDuration;
            if (transitionUp) {
                // 0.0 → 1.0
                scrambleStrength = transitionPhase;
            } else {
                // 1.0 → 0.0
                scrambleStrength = 1.0 - transitionPhase;
            }
        } else {
            // During hold: stay at extreme values
            scrambleStrength = transitionUp ? 0.0 : 1.0;
        }
    }

    // Apply scramble effect: binary swap between true position and foreign position
    let finalX = x;
    let finalY = y;
    let finalZ = z;

    if (scrambleStrength > 0.0) {
        const foreignId = hashLedId(id) % 1200;
        const foreignCoords = getSphereCoords(foreignId);

        if (foreignCoords && foreignCoords.length === 3) {
            const swapThreshold = (hashLedId(id, 123) % 1000) / 1000.0;
            const usesForeign = scrambleStrength > swapThreshold;

            if (usesForeign) {
                finalX = foreignCoords[0];
                finalY = foreignCoords[1];
                finalZ = foreignCoords[2];
            }

            if (scrambleAmplitude > 0.0) {
                const phaseOffset = id * 0.1;
                const timePhase = t * scrambleFrequency * Math.PI * 2;

                const wiggleX = Math.sin(timePhase + phaseOffset) * scrambleAmplitude * 0.1;
                const wiggleY = Math.sin(timePhase * 1.3 + phaseOffset + 1.0) * scrambleAmplitude * 0.1;
                const wiggleZ = Math.sin(timePhase * 0.7 + phaseOffset + 2.0) * scrambleAmplitude * 0.1;

                finalX += wiggleX;
                finalY += wiggleY;
                finalZ += wiggleZ;
            }
        }
    }

    // Transform coordinates from [0,1] to [-0.5, 0.5] centered at origin
    let pos = new Vec3(finalX - 0.5, finalY - 0.5, finalZ - 0.5);

    // Calculate animated rotation for cylinder ring
    const rotX = rotationSpeedX * t;
    const rotY = rotationSpeedY * t;
    const rotZ = rotationSpeedZ * t;

    // Apply rotation to the point (inverse rotation so cylinders rotate)
    const rotatedPos = rotatePoint(pos, -rotX, -rotY, -rotZ);

    // Sample the cylinder ring SDF
    const sdfResult = sdf_cylinder_ring(rotatedPos, numCylinders, cylinderRadius, ringRadius);

    // Convert SDF to brightness (inside = bright, outside = dark)
    const brightness = sdf2side(sdfResult.distance, edgeSmoothness);

    // Calculate hue for this specific cylinder (using animated base hue)
    const cylinderHue = animatedBaseHue + sdfResult.cylinderIndex * hueOffset;

    // Convert HSV to RGB for the cylinder color (value = 1.0 for full brightness)
    const cylinderColor = hsv2rgb(cylinderHue, saturation, 1.0);

    // Calculate final color by blending cylinder color with background
    const finalR = cylinderColor[0] * brightness + backColor[0] * (1.0 - brightness);
    const finalG = cylinderColor[1] * brightness + backColor[1] * (1.0 - brightness);
    const finalB = cylinderColor[2] * brightness + backColor[2] * (1.0 - brightness);

    return [finalR, finalG, finalB];
}
