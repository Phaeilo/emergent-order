// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.
// Plane and Cross SDF Demo
// Displays a rotating plane and/or a 3D cross made of infinite cylinders
// Both effects can be mixed using opacity controls


const params = {
    autoGroup: {
        group: 'Automated Mode',
        autoMode: { type: 'float', name: 'Enable Auto Mode', min: 0.0, max: 1.0, default: 0.0 },
        holdDuration: { type: 'float', name: 'Hold Time (s)', min: 5.0, max: 120.0, default: 15.0 },
        transitionDuration: { type: 'float', name: 'Transition Time (s)', min: 1.0, max: 120.0, default: 60.0 }
    },

    planeGroup: {
        group: 'Plane',
        planeRotationSpeedX: { type: 'float', name: 'Rotation Speed X', min: -2.0, max: 2.0, default: -0.6 },
        planeRotationSpeedZ: { type: 'float', name: 'Rotation Speed Z', min: -2.0, max: 2.0, default: 1.6 },
        planeOpacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 1.0 }
    },

    crossGroup: {
        group: 'Cross',
        crossCylinderRadius: { type: 'float', name: 'Cylinder Radius', min: 0.01, max: 0.2, default: 0.1 },
        crossRotationSpeedX: { type: 'float', name: 'Rotation Speed X', min: -2.0, max: 2.0, default: 1.6 },
        crossRotationSpeedY: { type: 'float', name: 'Rotation Speed Y', min: -2.0, max: 2.0, default: -0.3 },
        crossRotationSpeedZ: { type: 'float', name: 'Rotation Speed Z', min: -2.0, max: 2.0, default: 0.0},
        crossOpacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 0.0 }
    },

    colorGroup: {
        group: 'Colors',
        frontColor: { type: 'color', name: 'Front Color', default: [0.75, 0.75, 1.0] },
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

// Signed distance function for a plane (XZ plane, normal pointing up)
function sdf_plane(v) {
    return v.y;
}

// Signed distance function for infinite cylinder along X-axis
function sdf_cylinder_x(v, radius) {
    return Math.sqrt(v.y * v.y + v.z * v.z) - radius;
}

// Signed distance function for infinite cylinder along Y-axis
function sdf_cylinder_y(v, radius) {
    return Math.sqrt(v.x * v.x + v.z * v.z) - radius;
}

// Signed distance function for infinite cylinder along Z-axis
function sdf_cylinder_z(v, radius) {
    return Math.sqrt(v.x * v.x + v.y * v.y) - radius;
}

// Union of three cylinders (cross shape)
function sdf_cross(v, radius) {
    const dx = sdf_cylinder_x(v, radius);
    const dy = sdf_cylinder_y(v, radius);
    const dz = sdf_cylinder_z(v, radius);
    return Math.min(dx, Math.min(dy, dz));
}

// Smooth step function for smooth transitions
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

// Convert SDF value to brightness (0.0 to 1.0)
// Returns how much we're in the positive side (front) of the plane
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
    // Plane parameters
    const planeRotationSpeedX = params.planeRotationSpeedX ?? 0.0;
    const planeRotationSpeedZ = params.planeRotationSpeedZ ?? 0.0;
    const planeOpacity = params.planeOpacity ?? 1.0;

    // Cross parameters
    const cylinderRadius = params.crossCylinderRadius ?? 0.05;
    const crossRotationSpeedX = params.crossRotationSpeedX ?? 0.0;
    const crossRotationSpeedY = params.crossRotationSpeedY ?? 0.0;
    const crossRotationSpeedZ = params.crossRotationSpeedZ ?? 0.0;
    const crossOpacity = params.crossOpacity ?? 0.0;

    // Color parameters
    const frontColor = params.frontColor ?? [0.8, 0.9, 1.0];
    const backColor = params.backColor ?? [0.0, 0.0, 0.0];
    const edgeSmoothness = params.edgeSmoothness ?? 0.05;

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

    // Initialize final color
    let finalR = 0.0;
    let finalG = 0.0;
    let finalB = 0.0;

    // Calculate plane effect
    if (planeOpacity > 0.0) {
        // Calculate animated rotation for plane
        const planeRotX = planeRotationSpeedX * t;
        const planeRotZ = planeRotationSpeedZ * t;

        // Apply rotation to the point (inverse rotation so plane rotates)
        const planePos = rotatePoint(pos, -planeRotX, 0.0, -planeRotZ);

        // Sample the plane SDF
        const planeSdfValue = sdf_plane(planePos);

        // Convert SDF to which side we're on (1.0 = front/positive, 0.0 = back/negative)
        const frontSide = sdf2side(planeSdfValue, edgeSmoothness);

        // Calculate plane color
        const planeR = frontColor[0] * frontSide + backColor[0] * (1.0 - frontSide);
        const planeG = frontColor[1] * frontSide + backColor[1] * (1.0 - frontSide);
        const planeB = frontColor[2] * frontSide + backColor[2] * (1.0 - frontSide);

        // Add plane contribution
        finalR += planeR * planeOpacity;
        finalG += planeG * planeOpacity;
        finalB += planeB * planeOpacity;
    }

    // Calculate cross effect
    if (crossOpacity > 0.0) {
        // Calculate animated rotation for cross
        const crossRotX = crossRotationSpeedX * t;
        const crossRotY = crossRotationSpeedY * t;
        const crossRotZ = crossRotationSpeedZ * t;

        // Apply rotation to the point (inverse rotation so cross rotates)
        const crossPos = rotatePoint(pos, -crossRotX, -crossRotY, -crossRotZ);

        // Sample the cross SDF
        const crossSdfValue = sdf_cross(crossPos, cylinderRadius);

        // Convert SDF to brightness (inside = bright, outside = dark)
        const crossBrightness = sdf2side(crossSdfValue, edgeSmoothness);

        // Calculate cross color (use front color for the cylinders)
        const crossR = frontColor[0] * crossBrightness;
        const crossG = frontColor[1] * crossBrightness;
        const crossB = frontColor[2] * crossBrightness;

        // Add cross contribution
        finalR += crossR * crossOpacity;
        finalG += crossG * crossOpacity;
        finalB += crossB * crossOpacity;
    }

    return [finalR, finalG, finalB];
}
