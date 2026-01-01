// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.
// Simple Linear Chase Effect
// Creates continuous chase patterns across LED IDs with quick attack and slow decay

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

const params = {
    chaseGroup: {
        group: 'Chase Pattern',
        spacing: { type: 'int', name: 'Chase Spacing (LEDs)', min: 1, max: 100, default: 64 },
        chaseLength: { type: 'int', name: 'Chase Length (LEDs)', min: 1, max: 100, default: 32 },
        chaseSpeed: { type: 'float', name: 'Chase Speed', min: 0.1, max: 10.0, default: 0.15 }
    },

    timingGroup: {
        group: 'Timing',
        attackTime: { type: 'float', name: 'Attack Time', min: 0.01, max: 1.0, default: 0.21 },
        decayTime: { type: 'float', name: 'Decay Time', min: 0.1, max: 5.0, default: 1.9 },
        peakBrightness: { type: 'float', name: 'Peak Brightness', min: 0.1, max: 2.0, default: 1.0 }
    },

    colorGroup: {
        group: 'Color',
        colorMode: { type: 'float', name: 'Color Mode (0=Fixed, 1=Cycle)', min: 0.0, max: 1.0, default: 1.0 },
        color: { type: 'color', name: 'Chase Color (Fixed Mode)', default: [1.0, 1.0, 1.0] },
        hueCycleDuration: { type: 'float', name: 'Hue Cycle Duration (s)', min: 1.0, max: 300.0, default: 30.0 },
        saturation: { type: 'float', name: 'Saturation', min: 0.0, max: 1.0, default: 0.42 },
        brightness: { type: 'float', name: 'Overall Brightness', min: 0.0, max: 2.0, default: 1.0 }
    },

    zoneGroup: {
        group: 'Y-Axis Zones',
        ySplit: { type: 'float', name: 'Y Split Position', min: 0.0, max: 1.0, default: 0.5 },
        fadeWidth: { type: 'float', name: 'Fade Width', min: 0.0, max: 1.0, default: 0.6 },
        hueOffset: { type: 'float', name: 'Zone Hue Offset', min: 0.0, max: 1.0, default: 0.3 }
    }
};

function getSphereColor(x, y, z, t, params, id) {
    // Get parameters with defaults
    const spacing = params.spacing ?? 20.0;
    const chaseLength = params.chaseLength ?? 10.0;
    const chaseSpeed = params.chaseSpeed ?? 2.0;

    const attackTime = params.attackTime ?? 0.1;
    const decayTime = params.decayTime ?? 1.5;
    const peakBrightness = params.peakBrightness ?? 1.0;

    const colorMode = params.colorMode ?? 0.0;
    const fixedColor = params.color ?? [1.0, 1.0, 1.0];
    const hueCycleDuration = params.hueCycleDuration ?? 30.0;
    const saturation = params.saturation ?? 1.0;
    const brightness = params.brightness ?? 1.0;

    const ySplit = params.ySplit ?? 0.5;
    const fadeWidth = params.fadeWidth ?? 0.2;
    const hueOffset = params.hueOffset ?? 0.5;

    // Calculate the continuous chase position (moves forward with time)
    const chasePosition = t * chaseSpeed * spacing;

    // Calculate LED position within the repeating pattern
    const ledOffset = (id + spacing - (chasePosition % spacing)) % spacing;

    // Determine if this LED is within the chase length
    if (ledOffset <= chaseLength) {
        // Calculate position within the chase (0 = leading edge, 1 = trailing edge)
        const positionInChase = ledOffset / chaseLength;

        let intensity;

        // Quick attack at the leading edge
        if (positionInChase < attackTime) {
            // Rising edge: 0 to peak
            intensity = (positionInChase / attackTime) * peakBrightness;
        } else {
            // Decay: peak to 0
            const decayPhase = (positionInChase - attackTime) / (1.0 - attackTime);
            // Exponential decay for smooth falloff
            intensity = peakBrightness * Math.exp(-decayPhase * decayTime * 3.0);
        }

        // Apply overall brightness
        intensity *= brightness;

        // Clamp to valid range
        intensity = Math.max(0, Math.min(2, intensity));

        // Calculate color based on mode
        let color;

        if (colorMode > 0.5) {
            // Color cycle mode
            // Calculate base hue cycling with time
            // Complete one full hue cycle in hueCycleDuration seconds
            const baseHue = (t / hueCycleDuration) % 1.0;

            // Smoothstep function for smooth zone transition
            const smoothstep = (edge0, edge1, x) => {
                const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
                return t * t * (3 - 2 * t);
            };

            // Calculate zone mix factor based on Y position
            // y ranges from 0 to 1, ySplit is the center of the transition
            const zoneMix = smoothstep(ySplit - fadeWidth / 2, ySplit + fadeWidth / 2, y);

            // Calculate hue for each zone
            let hue1 = baseHue;
            let hue2 = (baseHue + hueOffset) % 1.0;

            // Mix hues between zones with proper wrapping
            // If hues are on opposite sides of the 0/1 boundary, adjust for shortest path
            let hueDiff = hue2 - hue1;
            if (hueDiff > 0.5) {
                // hue2 is ahead but wrapping would be shorter
                hue1 += 1.0;
            } else if (hueDiff < -0.5) {
                // hue1 is ahead but wrapping would be shorter
                hue2 += 1.0;
            }

            // Now interpolate and wrap back to [0, 1)
            const finalHue = (hue1 * (1 - zoneMix) + hue2 * zoneMix) % 1.0;

            // Convert HSV to RGB
            color = hsvToRgb(finalHue, saturation, 1.0);
        } else {
            // Fixed color mode
            color = fixedColor;
        }

        // Apply intensity to color
        const r = color[0] * intensity;
        const g = color[1] * intensity;
        const b = color[2] * intensity;

        return [r, g, b];
    }

    // LEDs outside the chase are off
    return [0, 0, 0];
}
