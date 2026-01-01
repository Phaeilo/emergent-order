// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.
// Simple 3D Fire Effect
// Volumetric fire using Perlin-like noise with realistic flame behavior
// Inspired by Shadertoy fire shaders, adapted for 3D LED cube

const params = {
    fireGroup: {
        group: 'Fire Properties',
        height: { type: 'float', name: 'Flame Height', min: 0.2, max: 1.5, default: 0.778 },
        width: { type: 'float', name: 'Flame Width', min: 0.1, max: 1.0, default: 0.35 },
        intensity: { type: 'float', name: 'Intensity', min: 0.0, max: 2.0, default: 1.1 },
        baseHeight: { type: 'float', name: 'Base Y Position', min: 0.0, max: 0.5, default: 0.07 }
    },

    animationGroup: {
        group: 'Animation',
        speed: { type: 'float', name: 'Rise Speed', min: 0.1, max: 3.0, default: 0.5 },
        turbulenceSpeed: { type: 'float', name: 'Turbulence Speed', min: 0.5, max: 3.0, default: 2.0 },
        noiseScale: { type: 'float', name: 'Noise Scale', min: 2.0, max: 15.0, default: 8.0 },
        swayAmount: { type: 'float', name: 'Sway Amount', min: 0.0, max: 0.5, default: 0.14 },
        swaySpeed: { type: 'float', name: 'Sway Speed', min: 0.5, max: 4.0, default: 1.5 },
        pulseAmount: { type: 'float', name: 'Pulse Amount', min: 0.0, max: 1.0, default: 0.23 },
        pulseSpeed: { type: 'float', name: 'Pulse Speed', min: 0.5, max: 5.0, default: 2.5 }
    },

    colorGroup: {
        group: 'Colors',
        coreColor: { type: 'color', name: 'Core Color (hot)', default: [1.0, 1.0, 0.6] },
        midColor: { type: 'color', name: 'Mid Color', default: [1.0, 0.4, 0.0] },
        tipColor: { type: 'color', name: 'Tip Color (cool)', default: [0.8, 0.0, 0.0] },
        backgroundColor: { type: 'color', name: 'Background Color', default: [0.0, 0.0, 0.0] }
    },

    shapeGroup: {
        group: 'Shape',
        tightness: { type: 'float', name: 'Flame Tightness', min: 0.5, max: 5.0, default: 1.0 },
        octaves: { type: 'float', name: 'Noise Octaves', min: 1.0, max: 6.0, default: 3.0 },
        persistence: { type: 'float', name: 'Noise Persistence', min: 0.3, max: 0.8, default: 0.6 },
        turbulenceAmount: { type: 'float', name: 'Turbulence Amount', min: 0.0, max: 0.5, default: 0.19 }
    }
};

// Fast integer hash - no expensive trig functions
// Replaces Math.sin-based hash for ~40-50% performance improvement
function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0; // Bitwise OR forces 32-bit int
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    h = h ^ (h >>> 16);
    return (h & 0x7fffffff) / 0x7fffffff; // Normalize to [0, 1]
}

// Hermite interpolation for smooth noise
function hermite(t) {
    return t * t * (3.0 - 2.0 * t);
}

// 2D noise function using bilinear interpolation
function noise2D(x, y) {
    const ix1 = Math.floor(x);
    const iy1 = Math.floor(y);
    const ix2 = ix1 + 1.0;
    const iy2 = iy1 + 1.0;

    const fx = hermite(x - ix1);
    const fy = hermite(y - iy1);

    const a = hash(ix1, iy1);
    const b = hash(ix2, iy1);
    const c = hash(ix1, iy2);
    const d = hash(ix2, iy2);

    const fade1 = a + (b - a) * fx;
    const fade2 = c + (d - c) * fx;

    return fade1 + (fade2 - fade1) * fy;
}

// Multi-octave Perlin noise
function perlinNoise(x, y, octaves, persistence) {
    let value = 0.0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0.0;

    const intOctaves = Math.floor(octaves);

    for (let i = 0; i < intOctaves; i++) {
        value += noise2D(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= 2.0;
    }

    return value / maxValue;
}

// 3D noise by combining 2D noise slices
function noise3D(x, y, z, octaves, persistence) {
    // Sample noise in different 2D planes and combine
    const noiseXY = perlinNoise(x, y, octaves, persistence);
    const noiseXZ = perlinNoise(x, z + 100.0, octaves, persistence);
    const noiseYZ = perlinNoise(y, z + 200.0, octaves, persistence);

    // Blend the three planes
    return (noiseXY + noiseXZ + noiseYZ) / 3.0;
}

// Smoothstep function for smooth transitions
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

// Mix two values
function mix(a, b, t) {
    return a * (1.0 - t) + b * t;
}

// Mix two colors
function mixColor(color1, color2, t) {
    return [
        mix(color1[0], color2[0], t),
        mix(color1[1], color2[1], t),
        mix(color1[2], color2[2], t)
    ];
}

function getSphereColor(x, y, z, t, params, id) {
    // Get parameters with defaults
    const height = params.height ?? 0.8;
    const width = params.width ?? 0.4;
    const intensity = params.intensity ?? 1.2;
    const baseHeight = params.baseHeight ?? 0.0;
    const speed = params.speed ?? 1.2;
    const turbulenceSpeed = params.turbulenceSpeed ?? 2.0;
    const noiseScale = params.noiseScale ?? 4.5;
    const swayAmount = params.swayAmount ?? 0.15;
    const swaySpeed = params.swaySpeed ?? 1.5;
    const pulseAmount = params.pulseAmount ?? 0.3;
    const pulseSpeed = params.pulseSpeed ?? 2.5;
    const coreColor = params.coreColor ?? [1.0, 1.0, 0.6];
    const midColor = params.midColor ?? [1.0, 0.4, 0.0];
    const tipColor = params.tipColor ?? [0.8, 0.0, 0.0];
    const backgroundColor = params.backgroundColor ?? [0.0, 0.0, 0.0];
    const tightness = params.tightness ?? 1.8;
    const octaves = params.octaves ?? 3.0;
    const persistence = params.persistence ?? 0.6;
    const turbulenceAmount = params.turbulenceAmount ?? 0.25;

    // Center coordinates around origin
    // Flip y-axis since origin is at (0,0,0) and fire should rise from bottom
    let cx = x - 0.5;
    let cy = 0.5 - y;  // Flipped: was (y - 0.5)
    let cz = z - 0.5;

    // Add swaying motion (horizontal displacement that increases with height)
    const swayPhaseX = Math.sin(t * swaySpeed) * swayAmount;
    const swayPhaseZ = Math.cos(t * swaySpeed * 0.7 + 1.5) * swayAmount;
    const swayInfluence = Math.max(0.0, (cy + 0.5) / height); // More sway at top
    cx -= swayPhaseX * swayInfluence;
    cz -= swayPhaseZ * swayInfluence;

    // Add pulsing effect (flame size variation)
    const pulse = 1.0 + Math.sin(t * pulseSpeed) * pulseAmount * 0.5;

    // Calculate vertical progress (0 = bottom, 1 = top of flame)
    const heightProgress = (cy - baseHeight + 0.5) / (height * pulse);

    // Early exit if way below the flame
    if (heightProgress < 0.0) {
        return backgroundColor;
    }

    // Calculate fade-out for the top of the flame
    // Make fade boundary travel upward with flame using oscillation
    const fadeWave = Math.sin(t * speed * 0.3) * 0.1 + 0.1; // Oscillates 0 to 0.2
    const fadeStart = 0.75 + fadeWave; // Ranges from 0.75 to 0.95
    const fadeEnd = fadeStart + 0.35;
    const topFade = heightProgress > fadeStart ?
        smoothstep(fadeEnd, fadeStart, heightProgress) : 1.0;

    // Early exit if completely faded out at top
    if (topFade <= 0.0) {
        return backgroundColor;
    }

    // Distance from center (XZ plane)
    const distFromCenter = Math.sqrt(cx * cx + cz * cz);

    // Animated vertical offset for rising flame effect
    const riseOffset = t * speed;

    // Sample 3D noise with time-based animation
    const noisePos = [
        cx * noiseScale,
        (cy + riseOffset) * noiseScale,
        cz * noiseScale + t * turbulenceSpeed * 0.3
    ];

    const noise1 = noise3D(noisePos[0], noisePos[1], noisePos[2], octaves, persistence);

    // Add secondary noise for more detail
    const noise2 = noise3D(
        noisePos[0] * 2.0 + t * turbulenceSpeed * 0.5,
        noisePos[1] * 2.0,
        noisePos[2] * 2.0,
        Math.max(1, octaves - 1),
        persistence
    ) * 0.3;

    const combinedNoise = noise1 + noise2;

    // Flame width tapers toward the top
    const taperFactor = 1.0 - Math.pow(heightProgress, 1.5);
    const flameRadius = width * taperFactor * pulse;

    // Apply noise to the flame boundary with more pronounced turbulence
    const turbulence = combinedNoise * turbulenceAmount * (1.0 + heightProgress);
    const noisyRadius = flameRadius + turbulence;

    // Calculate how far we are from the flame surface (negative = inside)
    const distanceFromFlame = distFromCenter - noisyRadius;

    // Check if we're inside the flame volume
    if (distanceFromFlame > 0.05) {
        return backgroundColor;
    }

    // We're inside or near the flame - calculate color and brightness

    // Depth into flame (0 = edge, 1 = center)
    const depthInFlame = smoothstep(0.05, -noisyRadius * 0.5, distanceFromFlame);

    // Color gradient based on height
    // Bottom = hot core color, middle = mid color, top = cool tip color
    let color;
    if (heightProgress < 0.4) {
        // Bottom part: core to mid
        const t = heightProgress / 0.4;
        color = mixColor(coreColor, midColor, t);
    } else {
        // Top part: mid to tip
        const t = (heightProgress - 0.4) / 0.6;
        color = mixColor(midColor, tipColor, t);
    }

    // Add brightness variation based on noise and pulsing
    const brightnessVariation = combinedNoise * 0.4 + 0.85;
    // Make brightness bands rise with flame by incorporating riseOffset
    const pulseBrightness = 1.0 + Math.sin(t * pulseSpeed * 2.0 + (heightProgress - riseOffset * 2.0) * 10.0) * 0.2;

    // Combine depth, height, and noise for final brightness
    const baseBrightness = depthInFlame * (1.0 - Math.min(heightProgress, 1.0) * 0.3);
    const finalBrightness = baseBrightness * brightnessVariation * intensity * pulseBrightness * topFade;

    // Apply tightness (makes flame more defined)
    const tightnessAdjusted = Math.pow(finalBrightness, tightness);

    // Final color with brightness applied
    let r = color[0] * tightnessAdjusted;
    let g = color[1] * tightnessAdjusted;
    let b = color[2] * tightnessAdjusted;

    // Blend with background at the edges
    const alpha = smoothstep(-0.05, -0.02, -distanceFromFlame) * Math.min(1.0, finalBrightness);
    r = backgroundColor[0] * (1.0 - alpha) + r * alpha;
    g = backgroundColor[1] * (1.0 - alpha) + g * alpha;
    b = backgroundColor[2] * (1.0 - alpha) + b * alpha;

    // Clamp to valid range
    return [
        Math.max(0.0, Math.min(1.0, r)),
        Math.max(0.0, Math.min(1.0, g)),
        Math.max(0.0, Math.min(1.0, b))
    ];
}
