// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.
// Simple Sphere SDF Demo
// Displays a single sphere at the origin using signed distance field rendering

const params = {
    autoGroup: {
        group: 'Automated Mode',
        autoMode: { type: 'float', name: 'Enable Auto Mode', min: 0.0, max: 1.0, default: 0.0 },
        hueCycleDuration: { type: 'float', name: 'Hue Cycle Duration (s)', min: 1.0, max: 300.0, default: 180.0 },
        autoSaturation: { type: 'float', name: 'Saturation', min: 0.0, max: 1.0, default: 0.42 },
        autoBrightness: { type: 'float', name: 'Brightness', min: 0.0, max: 2.0, default: 1.0 }
    },

    sphereGroup: {
        group: 'Sphere',
        radius: { type: 'float', name: 'Radius', min: 0.1, max: 2.0, default: 0.3 }
    },

    colorGroup: {
        group: 'Colors',
        foregroundColor: { type: 'color', name: 'Foreground Color', default: [1.0, 0.5, 0.0] },
        backgroundColor: { type: 'color', name: 'Background Color', default: [0.0, 0.0, 0.0] },
        edgeSmoothness: { type: 'float', name: 'Edge Smoothness', min: 0.0, max: 0.5, default: 0.05 }
    },

    effectsGroup: {
        group: 'Effects',
        scrambleStrength: { type: 'float', name: 'Scramble Strength', min: 0.0, max: 1.0, default: 0.0 },
        scrambleFrequency: { type: 'float', name: 'Scramble Frequency', min: 0.0, max: 10.0, default: 1.0 },
        scrambleAmplitude: { type: 'float', name: 'Scramble Amplitude', min: 0.0, max: 1.0, default: 0.0 },
        wobbleIntensity: { type: 'float', name: 'Wobble Intensity', min: 0.0, max: 1.0, default: 1.0 },
        wobbleSpeed: { type: 'float', name: 'Wobble Speed', min: 0.1, max: 5.0, default: 1.6 }
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

    sub(v) {
        return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
    }
}

// Signed distance function for a sphere
function sdf_sphere(v, radius) {
    return v.len - radius;
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

// Deterministic hash function to map LED ID to another LED ID
function hashLedId(id, seed = 42) {
    // Simple multiplicative hash
    let hash = id * 2654435761 + seed;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = (hash >>> 16) ^ hash;
    return Math.abs(hash);
}

// Convert HSV to RGB
// h: hue (0.0 to 1.0), s: saturation (0.0 to 1.0), v: value/brightness (0.0 to 1.0+)
function hsvToRgb(h, s, v) {
    // Wrap hue to [0, 1) range
    h = h - Math.floor(h);

    const c = v * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = v - c;

    let r, g, b;

    if (h < 1/6) {
        r = c; g = x; b = 0;
    } else if (h < 2/6) {
        r = x; g = c; b = 0;
    } else if (h < 3/6) {
        r = 0; g = c; b = x;
    } else if (h < 4/6) {
        r = 0; g = x; b = c;
    } else if (h < 5/6) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }

    return [r + m, g + m, b + m];
}

// Wobble distortion: chaotic but periodic displacement using sines
function distort_wobble(pos, t, intensity, speed) {
    if (intensity === 0.0) return pos;

    // Apply speed to time
    const animTime = t * speed;

    // Multiple sine waves with different frequencies and phases for chaos
    const scale = intensity * 0.1; // Scale down the effect

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

    // Automated mode parameters
    const autoMode = params.autoMode ?? 0.0;
    const hueCycleDuration = params.hueCycleDuration ?? 10.0;
    const autoSaturation = params.autoSaturation ?? 1.0;
    const autoBrightness = params.autoBrightness ?? 1.0;

    // Get parameters with defaults
    const radius = params.radius ?? 0.5;
    let foregroundColor = params.foregroundColor ?? [1.0, 0.5, 0.0];
    const backgroundColor = params.backgroundColor ?? [0.0, 0.0, 0.0];
    const edgeSmoothness = params.edgeSmoothness ?? 0.05;
    const scrambleStrength = params.scrambleStrength ?? 0.0;
    const scrambleFrequency = params.scrambleFrequency ?? 1.0;
    const scrambleAmplitude = params.scrambleAmplitude ?? 0.0;
    const wobbleIntensity = params.wobbleIntensity ?? 0.0;
    const wobbleSpeed = params.wobbleSpeed ?? 1.0;

    // Automated mode override for foreground color
    if (autoMode > 0.5) {
        // Calculate current hue based on time and cycle duration
        // Hue cycles from 0.0 to 1.0 over hueCycleDuration seconds
        const currentHue = (t / hueCycleDuration) % 1.0;

        // Convert HSV to RGB for the foreground color
        foregroundColor = hsvToRgb(currentHue, autoSaturation, autoBrightness);
    }

    // Apply scramble effect: binary swap between true position and foreign position
    let finalX = x;
    let finalY = y;
    let finalZ = z;

    if (scrambleStrength > 0.0) {
        // Compute deterministic foreign LED ID for this LED
        // Constrain to valid LED range (0-1199 for ~1200 LEDs)
        const foreignId = hashLedId(id) % 1200;

        // Fetch the foreign LED's position
        const foreignCoords = getSphereCoords(foreignId);

        if (foreignCoords && foreignCoords.length === 3) {
            // Binary swap: use deterministic threshold to decide true vs foreign position
            // This avoids center-clustering artifacts from linear interpolation
            const swapThreshold = (hashLedId(id, 123) % 1000) / 1000.0;
            const usesForeign = scrambleStrength > swapThreshold;

            if (usesForeign) {
                // Use foreign position
                finalX = foreignCoords[0];
                finalY = foreignCoords[1];
                finalZ = foreignCoords[2];
            }
            // else: keep true position (finalX, finalY, finalZ already set)

            // Add animated wiggle to the position
            if (scrambleAmplitude > 0.0) {
                // Use multiple sine waves with different phases for each axis
                // Each LED gets slightly different phase based on its ID
                const phaseOffset = id * 0.1;
                const timePhase = t * scrambleFrequency * Math.PI * 2;

                // Create wiggle offsets for each axis with different frequencies
                const wiggleX = Math.sin(timePhase + phaseOffset) * scrambleAmplitude * 0.1;
                const wiggleY = Math.sin(timePhase * 1.3 + phaseOffset + 1.0) * scrambleAmplitude * 0.1;
                const wiggleZ = Math.sin(timePhase * 0.7 + phaseOffset + 2.0) * scrambleAmplitude * 0.1;

                // Apply wiggle to whichever position was chosen
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

    // Sample the SDF at this position
    const sdfValue = sdf_sphere(pos, radius);

    // Convert SDF to brightness (1.0 inside/on sphere, 0.0 outside)
    const brightness = sdf2bri(sdfValue, edgeSmoothness);

    // Mix foreground and background colors based on brightness
    const r = foregroundColor[0] * brightness + backgroundColor[0] * (1.0 - brightness);
    const g = foregroundColor[1] * brightness + backgroundColor[1] * (1.0 - brightness);
    const b = foregroundColor[2] * brightness + backgroundColor[2] * (1.0 - brightness);

    return [r, g, b];
}
