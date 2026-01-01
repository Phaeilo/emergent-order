// LED Cube Demo Script
// Features: 1 Sphere at origin, 2 Planes with rotation, Scramble & Wobble effects, Linear Chase
//
// NOTE: If the code is changed, the animation must be stopped and started again in the
// web player for the changes to take effect.
//
// REQUIRED INTERFACE:
// - params: Object defining all controllable parameters (this is read by the UI)
// - getSphereColor(x, y, z, t, params, id): Function that returns [r, g, b] for each LED
//
// Everything else (Vec3 class, SDF functions, etc.) are just utility functions to help
// implement the color calculation logic.

const params = {
    sphereGroup: {
        group: 'Sphere',
        sphereRadius: { type: 'float', name: 'Radius', min: 0.1, max: 2.0, default: 0.3 },
        sphereColor: { type: 'color', name: 'Color', default: [1.0, 0.5, 0.0] },
        sphereOpacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 1.0 }
    },

    plane1Group: {
        group: 'Plane 1',
        plane1_rotateX: { type: 'float', name: 'Rotation X', min: -3.142, max: 3.142, default: 0.0 },
        plane1_rotateZ: { type: 'float', name: 'Rotation Z', min: -3.142, max: 3.142, default: 0.0 },
        plane1_shift: { type: 'float', name: 'Shift Along Normal', min: -1.0, max: 1.0, default: 0.0 },
        plane1_color: { type: 'color', name: 'Front Color', default: [0.0, 0.8, 1.0] },
        plane1_rotationSpeedX: { type: 'float', name: 'Rotation Speed X', min: -2.0, max: 2.0, default: 0.5 },
        plane1_rotationSpeedZ: { type: 'float', name: 'Rotation Speed Z', min: -2.0, max: 2.0, default: 0.0 },
        plane1_opacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 0.0 }
    },

    plane2Group: {
        group: 'Plane 2',
        plane2_rotateX: { type: 'float', name: 'Rotation X', min: -3.142, max: 3.142, default: 0.0 },
        plane2_rotateZ: { type: 'float', name: 'Rotation Z', min: -3.142, max: 3.142, default: 0.0 },
        plane2_shift: { type: 'float', name: 'Shift Along Normal', min: -1.0, max: 1.0, default: 0.0 },
        plane2_color: { type: 'color', name: 'Front Color', default: [1.0, 0.0, 0.8] },
        plane2_rotationSpeedX: { type: 'float', name: 'Rotation Speed X', min: -2.0, max: 2.0, default: 0.0 },
        plane2_rotationSpeedZ: { type: 'float', name: 'Rotation Speed Z', min: -2.0, max: 2.0, default: 0.5 },
        plane2_opacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 0.0 }
    },

    linearGroup: {
        group: 'Linear Chase',
        linearOpacity: { type: 'float', name: 'Opacity', min: 0.0, max: 1.0, default: 0.0 },
        linearSpacing: { type: 'int', name: 'Chase Spacing (LEDs)', min: 1, max: 100, default: 64 },
        linearLength: { type: 'int', name: 'Chase Length (LEDs)', min: 1, max: 100, default: 32 },
        linearSpeed: { type: 'float', name: 'Chase Speed', min: 0.1, max: 10.0, default: 0.15 },
        linearAttack: { type: 'float', name: 'Attack Time', min: 0.01, max: 1.0, default: 0.21 },
        linearDecay: { type: 'float', name: 'Decay Time', min: 0.1, max: 5.0, default: 1.9 },
        linearColor: { type: 'color', name: 'Chase Color', default: [1.0, 1.0, 1.0] }
    },

    effectsGroup: {
        group: 'Effects',
        scrambleStrength: { type: 'float', name: 'Scramble Strength', min: 0.0, max: 1.0, default: 0.0 },
        scrambleFrequency: { type: 'float', name: 'Scramble Frequency', min: 0.0, max: 10.0, default: 1.0 },
        scrambleAmplitude: { type: 'float', name: 'Scramble Amplitude', min: 0.0, max: 1.0, default: 0.0 },
        wobbleIntensity: { type: 'float', name: 'Wobble Intensity', min: 0.0, max: 1.0, default: 0.0 },
        wobbleSpeed: { type: 'float', name: 'Wobble Speed', min: 0.1, max: 5.0, default: 1.0 }
    },

    colorGroup: {
        group: 'Colors',
        backgroundColor: { type: 'color', name: 'Background Color', default: [0.0, 0.0, 0.0] },
        edgeSmoothness: { type: 'float', name: 'Edge Smoothness', min: 0.0, max: 0.5, default: 0.05 }
    },

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

    static zero() {
        return Vec3.splat(0.0);
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

    div(s) {
        return new Vec3(this.x / s, this.y / s, this.z / s);
    }
}

// Signed distance function for a sphere
function sdf_sphere(v, radius) {
    return v.len - radius;
}

// Signed distance function for a plane (XZ plane, normal pointing up in +Y)
function sdf_plane(v) {
    return v.y;
}

// Smooth step function for smooth transitions
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

// Convert SDF value to brightness (0.0 to 1.0)
function sdf2bri(f, ease = 0.0) {
    if (ease === 0.0) {
        return f <= 0.0 ? 1.0 : 0.0;
    }
    return 1.0 - smoothstep(-ease, ease, f);
}

// Rotation around X, Y, Z axes
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

// Wobble distortion: chaotic but periodic displacement using sines
function distort_wobble(pos, t, intensity, speed) {
    if (intensity === 0.0) return pos;

    const animTime = t * speed;
    const scale = intensity * 0.1;

    const dx = scale * (
        Math.sin(pos.x * 10.0 + animTime * 2.0) +
        Math.sin(pos.y * 7.3 + pos.z * 5.7 + animTime * 1.3) * 0.5 +
        Math.sin(pos.x * 3.1 + pos.z * 4.2 + animTime * 0.7) * 0.3
    );

    const dy = scale * (
        Math.sin(pos.y * 8.5 + animTime * 1.7) +
        Math.sin(pos.z * 6.2 + pos.x * 9.1 + animTime * 2.1) * 0.5 +
        Math.sin(pos.y * 4.7 + pos.x * 3.3 + animTime * 0.9) * 0.3
    );

    const dz = scale * (
        Math.sin(pos.z * 9.2 + animTime * 1.5) +
        Math.sin(pos.x * 5.8 + pos.y * 7.6 + animTime * 1.9) * 0.5 +
        Math.sin(pos.z * 2.9 + pos.y * 6.4 + animTime * 1.1) * 0.3
    );

    return new Vec3(pos.x + dx, pos.y + dy, pos.z + dz);
}

function getSphereColor(x, y, z, t, params, id) {
    // x, y, z are normalized coordinates (0.0 to 1.0)
    // t is time in seconds since start
    // params contains parameter values
    // id is the sequential LED number (0 to N-1)
    // Return [r, g, b] values (0.0 to 1.0)

    // Extract parameters
    const sphereRadius = params.sphereRadius ?? 0.3;
    const sphereColor = params.sphereColor ?? [1.0, 0.5, 0.0];
    const sphereOpacity = params.sphereOpacity ?? 1.0;

    const plane1_rotateX = params.plane1_rotateX ?? 0.0;
    const plane1_rotateZ = params.plane1_rotateZ ?? 0.0;
    const plane1_shift = params.plane1_shift ?? 0.0;
    const plane1_color = params.plane1_color ?? [0.0, 0.8, 1.0];
    const plane1_rotationSpeedX = params.plane1_rotationSpeedX ?? 0.0;
    const plane1_rotationSpeedZ = params.plane1_rotationSpeedZ ?? 0.0;
    const plane1_opacity = params.plane1_opacity ?? 0.0;

    const plane2_rotateX = params.plane2_rotateX ?? 0.0;
    const plane2_rotateZ = params.plane2_rotateZ ?? 0.0;
    const plane2_shift = params.plane2_shift ?? 0.0;
    const plane2_color = params.plane2_color ?? [1.0, 0.0, 0.8];
    const plane2_rotationSpeedX = params.plane2_rotationSpeedX ?? 0.0;
    const plane2_rotationSpeedZ = params.plane2_rotationSpeedZ ?? 0.0;
    const plane2_opacity = params.plane2_opacity ?? 0.0;

    const scrambleStrength = params.scrambleStrength ?? 0.0;
    const scrambleFrequency = params.scrambleFrequency ?? 1.0;
    const scrambleAmplitude = params.scrambleAmplitude ?? 0.0;
    const wobbleIntensity = params.wobbleIntensity ?? 0.0;
    const wobbleSpeed = params.wobbleSpeed ?? 1.0;

    const backgroundColor = params.backgroundColor ?? [0.0, 0.0, 0.0];
    const edgeSmoothness = params.edgeSmoothness ?? 0.05;

    const linearOpacity = params.linearOpacity ?? 0.0;
    const linearSpacing = params.linearSpacing ?? 64;
    const linearLength = params.linearLength ?? 32;
    const linearSpeed = params.linearSpeed ?? 0.15;
    const linearAttack = params.linearAttack ?? 0.21;
    const linearDecay = params.linearDecay ?? 1.9;
    const linearColor = params.linearColor ?? [1.0, 1.0, 1.0];

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

    // Apply wobble distortion effect
    pos = distort_wobble(pos, t, wobbleIntensity, wobbleSpeed);

    // Initialize accumulated color
    let totalR = 0.0;
    let totalG = 0.0;
    let totalB = 0.0;
    let totalBrightness = 0.0;

    // Render sphere at origin
    if (sphereOpacity > 0.0) {
        const sdfValue = sdf_sphere(pos, sphereRadius);
        const brightness = sdf2bri(sdfValue, edgeSmoothness);
        const contribution = brightness * sphereOpacity;

        totalR += sphereColor[0] * contribution;
        totalG += sphereColor[1] * contribution;
        totalB += sphereColor[2] * contribution;
        totalBrightness += contribution;
    }

    // Render plane 1
    if (plane1_opacity > 0.0) {
        // Calculate animated rotation
        const animRotX = plane1_rotateX + plane1_rotationSpeedX * t;
        const animRotZ = plane1_rotateZ + plane1_rotationSpeedZ * t;

        // Apply inverse rotation to the point (so plane appears rotated)
        const plane1Pos = rotatePoint(pos, -animRotX, 0.0, -animRotZ);

        // Apply shift along the plane's normal (Y-axis after rotation)
        const shiftedPos = new Vec3(plane1Pos.x, plane1Pos.y - plane1_shift, plane1Pos.z);

        // Sample the plane SDF
        const planeSdfValue = sdf_plane(shiftedPos);

        // Convert to brightness (front side only)
        const brightness = sdf2bri(planeSdfValue, edgeSmoothness);
        const contribution = brightness * plane1_opacity;

        totalR += plane1_color[0] * contribution;
        totalG += plane1_color[1] * contribution;
        totalB += plane1_color[2] * contribution;
        totalBrightness += contribution;
    }

    // Render plane 2
    if (plane2_opacity > 0.0) {
        // Calculate animated rotation
        const animRotX = plane2_rotateX + plane2_rotationSpeedX * t;
        const animRotZ = plane2_rotateZ + plane2_rotationSpeedZ * t;

        // Apply inverse rotation to the point (so plane appears rotated)
        const plane2Pos = rotatePoint(pos, -animRotX, 0.0, -animRotZ);

        // Apply shift along the plane's normal (Y-axis after rotation)
        const shiftedPos = new Vec3(plane2Pos.x, plane2Pos.y - plane2_shift, plane2Pos.z);

        // Sample the plane SDF
        const planeSdfValue = sdf_plane(shiftedPos);

        // Convert to brightness (front side only)
        const brightness = sdf2bri(planeSdfValue, edgeSmoothness);
        const contribution = brightness * plane2_opacity;

        totalR += plane2_color[0] * contribution;
        totalG += plane2_color[1] * contribution;
        totalB += plane2_color[2] * contribution;
        totalBrightness += contribution;
    }

    // Clamp total brightness
    totalBrightness = Math.max(0.0, Math.min(1.0, totalBrightness));

    // Mix with background color
    let finalR = totalR + backgroundColor[0] * (1.0 - totalBrightness);
    let finalG = totalG + backgroundColor[1] * (1.0 - totalBrightness);
    let finalB = totalB + backgroundColor[2] * (1.0 - totalBrightness);

    // Apply linear chase effect (additive)
    if (linearOpacity > 0.0) {
        // Calculate the continuous chase position (moves forward with time)
        const chasePosition = t * linearSpeed * linearSpacing;

        // Calculate LED position within the repeating pattern
        const ledOffset = (id + linearSpacing - (chasePosition % linearSpacing)) % linearSpacing;

        // Determine if this LED is within the chase length
        if (ledOffset <= linearLength) {
            // Calculate position within the chase (0 = leading edge, 1 = trailing edge)
            const positionInChase = ledOffset / linearLength;

            let chaseIntensity;

            // Quick attack at the leading edge
            if (positionInChase < linearAttack) {
                // Rising edge: 0 to peak
                chaseIntensity = (positionInChase / linearAttack);
            } else {
                // Decay: peak to 0
                const decayPhase = (positionInChase - linearAttack) / (1.0 - linearAttack);
                // Exponential decay for smooth falloff
                chaseIntensity = Math.exp(-decayPhase * linearDecay * 3.0);
            }

            // Apply overall opacity
            chaseIntensity *= linearOpacity;

            // Add chase color (additive blending)
            finalR += linearColor[0] * chaseIntensity;
            finalG += linearColor[1] * chaseIntensity;
            finalB += linearColor[2] * chaseIntensity;
        }
    }

    return [
        Math.max(0.0, Math.min(1.0, finalR)),
        Math.max(0.0, Math.min(1.0, finalG)),
        Math.max(0.0, Math.min(1.0, finalB))
    ];
}
