// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

// Logging helper
function log(message, ...args) {
    console.log(`[LED Detector] ${message}`, ...args);
}

function logTime(operation, duration) {
    console.log(`[LED Detector] ${operation} took ${duration.toFixed(2)}ms`);
}

// WebGL Shader sources
const vertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform sampler2D u_image;
uniform sampler2D u_darkFrame;
uniform sampler2D u_maskFrame;
uniform sampler2D u_litFrames[9]; // Up to 9 lit frames for ID decoding
uniform int u_numLitFrames;
uniform float u_threshold; // Direct threshold value 0-255, normalized to 0-1
uniform float u_purity;
uniform int u_mode; // 0=normal, 1=classified, 2=r, 3=g, 4=b, 5=idmap, 6=idmap_shader, 7=id_encode
uniform float u_darkFrameContribution; // -1.0 to 1.0 (negative=subtract, positive=add, 0=none)
uniform bool u_applyMask;
uniform bool u_hasDark;
uniform bool u_hasMask;
uniform bool u_useRectMask;
uniform vec4 u_rectMask; // x, y, width, height (normalized 0-1)
uniform vec2 u_resolution; // Image resolution for texel size calculation
uniform float u_blurRadius; // Gaussian blur radius (0 = disabled, 1+ = blur strength)
uniform float u_greenCorrection; // Green correction factor (1.0 = no correction, >1.0 boosts green vs blue)

varying vec2 v_texCoord;

// Apply selective green correction for cyan-appearing green LEDs
vec3 applyGreenCorrection(vec3 rgb, float correctionFactor) {
    if (correctionFactor <= 1.01) return rgb; // No correction needed

    float minThreshold = 50.0 / 255.0;

    // Check if this pixel looks cyan (high G and B, green > red)
    bool isCyan = (rgb.g > minThreshold) && (rgb.b > minThreshold) && (rgb.g > rgb.r);

    if (isCyan) {
        // Boost green relative to blue
        rgb.g *= correctionFactor;
        rgb.b /= correctionFactor;
        rgb = clamp(rgb, 0.0, 1.0);
    }

    return rgb;
}

vec3 classifyColor(vec3 rgb, float purity) {
    float r = rgb.r;
    float g = rgb.g;
    float b = rgb.b;

    bool bright = r > 0.0 || g > 0.0 || b > 0.0;
    if (!bright) return vec3(0.0);

    // White check
    float minBrightness = 50.0 / 255.0;
    float whiteBalanceRatio = 1.25;

    if (r > minBrightness && g > minBrightness && b > minBrightness) {
        float maxVal = max(max(r, g), b);
        float minVal = min(min(r, g), b);
        if (maxVal <= whiteBalanceRatio * minVal) {
            return vec3(1.0);
        }
    }

    // Pure colors
    bool pureR = r > purity * g && r > purity * b;
    bool pureG = g > purity * r && g > purity * b;
    bool pureB = b > purity * r && b > purity * g;

    if (pureR) return vec3(1.0, 0.0, 0.0);
    if (pureG) return vec3(0.0, 1.0, 0.0);
    if (pureB) return vec3(0.0, 0.0, 1.0);

    return vec3(0.0);
}

// Apply Gaussian blur to RGB image
vec3 applyGaussianBlur(sampler2D frameTex, vec2 texCoord, float radius) {
    if (radius < 0.1) {
        vec3 sample = texture2D(frameTex, texCoord).rgb;
        // Apply dark frame to center pixel
        if (u_hasDark && abs(u_darkFrameContribution) > 0.01) {
            vec3 dark = texture2D(u_darkFrame, texCoord).rgb;
            sample = sample + (dark * u_darkFrameContribution);
            sample = clamp(sample, 0.0, 1.0);
        }
        // Apply green correction
        sample = applyGreenCorrection(sample, u_greenCorrection);
        return sample;
    }

    vec3 result = vec3(0.0);
    vec2 texelSize = 1.0 / u_resolution;
    float totalWeight = 0.0;

    // Use radius to determine kernel size (clamp to reasonable range)
    int kernelRadius = int(clamp(radius, 0.0, 3.0));

    // Gaussian blur with dynamic kernel
    for (int y = -3; y <= 3; y++) {
        for (int x = -3; x <= 3; x++) {
            // Skip if outside kernel radius (manual abs for int compatibility)
            int absX = x < 0 ? -x : x;
            int absY = y < 0 ? -y : y;
            if (absX > kernelRadius || absY > kernelRadius) continue;

            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec3 sample = texture2D(frameTex, texCoord + offset).rgb;

            // Apply dark frame to sample if enabled
            if (u_hasDark && abs(u_darkFrameContribution) > 0.01) {
                vec3 dark = texture2D(u_darkFrame, texCoord + offset).rgb;
                sample = sample + (dark * u_darkFrameContribution);
                sample = clamp(sample, 0.0, 1.0);
            }

            // Apply green correction
            sample = applyGreenCorrection(sample, u_greenCorrection);

            // Gaussian weight: exp(-(x^2 + y^2) / (2 * sigma^2))
            // Using sigma = radius / 2 for smooth falloff
            float sigma = radius * 0.5;
            float distance = float(x * x + y * y);
            float weight = exp(-distance / (2.0 * sigma * sigma));

            result += sample * weight;
            totalWeight += weight;
        }
    }

    return result / totalWeight;
}

// Process a single frame: apply corrections and classify
vec3 processFrame(sampler2D frameTex, vec2 texCoord) {
    vec3 rgb = texture2D(frameTex, texCoord).rgb;

    // Apply dark frame
    if (u_hasDark && abs(u_darkFrameContribution) > 0.01) {
        vec3 dark = texture2D(u_darkFrame, texCoord).rgb;
        rgb = rgb + (dark * u_darkFrameContribution);
        rgb = clamp(rgb, 0.0, 1.0);
    }

    // Apply green correction
    rgb = applyGreenCorrection(rgb, u_greenCorrection);

    // Apply Gaussian blur (before masking)
    if (u_blurRadius > 0.1) {
        rgb = applyGaussianBlur(frameTex, texCoord, u_blurRadius);
    }

    // Apply mask
    if (u_applyMask && u_hasMask) {
        float mask = texture2D(u_maskFrame, texCoord).r;
        rgb *= mask;
    }

    // Apply rectangle mask
    if (u_useRectMask) {
        vec2 rectMin = u_rectMask.xy;
        vec2 rectMax = u_rectMask.xy + u_rectMask.zw;
        if (texCoord.x < rectMin.x || texCoord.x > rectMax.x ||
            texCoord.y < rectMin.y || texCoord.y > rectMax.y) {
            rgb = vec3(0.0);
        }
    }

    // Threshold
    vec3 thresholded;
    thresholded.r = rgb.r >= u_threshold ? rgb.r : 0.0;
    thresholded.g = rgb.g >= u_threshold ? rgb.g : 0.0;
    thresholded.b = rgb.b >= u_threshold ? rgb.b : 0.0;

    // Classify
    vec3 classified = classifyColor(thresholded, u_purity);

    return classified;
}

// Convert classified color to ternary digit (R=0, G=1, B=2, -1=invalid)
int colorToTernary(vec3 classified) {
    if (classified.r > 0.5) return 0;
    if (classified.g > 0.5) return 1;
    if (classified.b > 0.5) return 2;
    return -1; // Invalid (black, white, or ambiguous)
}

// Integer modulo using integer arithmetic (avoids floating point precision issues)
bool isDivisibleBy7(int value) {
    int quotient = value / 7;
    int remainder = value - quotient * 7;
    return remainder == 0;
}

// Generate unique color for LED ID (simple hash for visualization)
vec3 ledIdToColor(int id) {
    // Simple color hash based on LED ID (using mod for GLSL ES 1.00 compatibility)
    float r = mod(float(id * 137), 256.0) / 255.0;
    float g = mod(float(id * 211), 256.0) / 255.0;
    float b = mod(float(id * 173), 256.0) / 255.0;
    return vec3(r, g, b);
}

// Encode LED ID directly in RGB channels for detection (LED ID up to 3^9 = 19683)
vec3 encodeLedId(int id) {
    // Encode LED ID as R + G*256 + B*65536
    float r = mod(float(id), 256.0) / 255.0;
    float g = mod(float(id / 256), 256.0) / 255.0;
    float b = mod(float(id / 65536), 256.0) / 255.0;
    return vec3(r, g, b);
}

void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    vec3 rgb = color.rgb;

    // Apply dark frame with contribution (-1=subtract, 0=none, +1=add)
    if (u_hasDark && abs(u_darkFrameContribution) > 0.01) {
        vec3 dark = texture2D(u_darkFrame, v_texCoord).rgb;
        rgb = rgb + (dark * u_darkFrameContribution);
        rgb = clamp(rgb, 0.0, 1.0);
    }

    // Apply green correction
    rgb = applyGreenCorrection(rgb, u_greenCorrection);

    // Apply Gaussian blur (before masking)
    if (u_blurRadius > 0.1) {
        rgb = applyGaussianBlur(u_image, v_texCoord, u_blurRadius);
    }

    // Apply mask
    if (u_applyMask && u_hasMask) {
        float mask = texture2D(u_maskFrame, v_texCoord).r;
        rgb *= mask;
    }

    // Apply rectangle mask
    if (u_useRectMask) {
        vec2 rectMin = u_rectMask.xy;
        vec2 rectMax = u_rectMask.xy + u_rectMask.zw;
        if (v_texCoord.x < rectMin.x || v_texCoord.x > rectMax.x ||
            v_texCoord.y < rectMin.y || v_texCoord.y > rectMax.y) {
            rgb = vec3(0.0);
        }
    }

    if (u_mode == 0) {
        // Normal mode
        gl_FragColor = vec4(rgb, 1.0);
    } else if (u_mode == 1) {
        // Classified mode
        vec3 thresholded;
        thresholded.r = rgb.r >= u_threshold ? rgb.r : 0.0;
        thresholded.g = rgb.g >= u_threshold ? rgb.g : 0.0;
        thresholded.b = rgb.b >= u_threshold ? rgb.b : 0.0;

        vec3 classified = classifyColor(thresholded, u_purity);
        gl_FragColor = vec4(classified, 1.0);
    } else if (u_mode == 2) {
        // Red channel (thresholded binary)
        float val = rgb.r >= u_threshold ? 1.0 : 0.0;
        gl_FragColor = vec4(val, val, val, 1.0);
    } else if (u_mode == 3) {
        // Green channel (thresholded binary)
        float val = rgb.g >= u_threshold ? 1.0 : 0.0;
        gl_FragColor = vec4(val, val, val, 1.0);
    } else if (u_mode == 4) {
        // Blue channel (thresholded binary)
        float val = rgb.b >= u_threshold ? 1.0 : 0.0;
        gl_FragColor = vec4(val, val, val, 1.0);
    } else if (u_mode == 6) {
        // ID map shader mode - decode ternary from all frames
        int digits[9];
        bool valid = true;
        bool allBlack = true;  // Check if pixel is dark in all frames

        // Process each lit frame and extract ternary digit
        // Note: GLSL doesn't support dynamic sampler indexing, so we use if-else
        for (int i = 0; i < 9; i++) {
            if (i >= u_numLitFrames) {
                digits[i] = -1;
                break;
            }

            vec3 classified;
            if (i == 0) classified = processFrame(u_litFrames[0], v_texCoord);
            else if (i == 1) classified = processFrame(u_litFrames[1], v_texCoord);
            else if (i == 2) classified = processFrame(u_litFrames[2], v_texCoord);
            else if (i == 3) classified = processFrame(u_litFrames[3], v_texCoord);
            else if (i == 4) classified = processFrame(u_litFrames[4], v_texCoord);
            else if (i == 5) classified = processFrame(u_litFrames[5], v_texCoord);
            else if (i == 6) classified = processFrame(u_litFrames[6], v_texCoord);
            else if (i == 7) classified = processFrame(u_litFrames[7], v_texCoord);
            else if (i == 8) classified = processFrame(u_litFrames[8], v_texCoord);

            int digit = colorToTernary(classified);

            // Check if this frame is black (off)
            if (classified.r > 0.0 || classified.g > 0.0 || classified.b > 0.0) {
                allBlack = false;
            }

            if (digit < 0) {
                valid = false;
                break;
            }
            digits[i] = digit;
        }

        if (allBlack || !valid) {
            // Blank pixel: dark in all frames OR not all frames classified - show as black
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else if (u_numLitFrames > 0) {
            // All frames classified - decode ternary to encoded LED ID (LSB first)
            int encodedLedId = 0;
            int base = 1;
            for (int i = 0; i < 9; i++) {
                if (i >= u_numLitFrames) break;
                encodedLedId += digits[i] * base;
                base *= 3;
            }

            // Validate checksum (must be divisible by 7)
            if (isDivisibleBy7(encodedLedId)) {
                // Get true LED ID (remove checksum by dividing by 9)
                int trueLedId = encodedLedId / 9;
                // Generate unique color for this true LED ID
                vec3 idColor = ledIdToColor(trueLedId);
                gl_FragColor = vec4(idColor, 1.0);
            } else {
                // Invalid pixel: all frames classified but checksum failed - show as magenta
                gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
            }
        } else {
            // Fallback - show as black
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    } else if (u_mode == 7) {
        // ID encode mode - output LED ID encoded in RGB for detection
        int digits[9];
        bool valid = true;
        bool allBlack = true;

        // Process each lit frame and extract ternary digit
        for (int i = 0; i < 9; i++) {
            if (i >= u_numLitFrames) {
                digits[i] = -1;
                break;
            }

            vec3 classified;
            if (i == 0) classified = processFrame(u_litFrames[0], v_texCoord);
            else if (i == 1) classified = processFrame(u_litFrames[1], v_texCoord);
            else if (i == 2) classified = processFrame(u_litFrames[2], v_texCoord);
            else if (i == 3) classified = processFrame(u_litFrames[3], v_texCoord);
            else if (i == 4) classified = processFrame(u_litFrames[4], v_texCoord);
            else if (i == 5) classified = processFrame(u_litFrames[5], v_texCoord);
            else if (i == 6) classified = processFrame(u_litFrames[6], v_texCoord);
            else if (i == 7) classified = processFrame(u_litFrames[7], v_texCoord);
            else if (i == 8) classified = processFrame(u_litFrames[8], v_texCoord);

            int digit = colorToTernary(classified);

            if (classified.r > 0.0 || classified.g > 0.0 || classified.b > 0.0) {
                allBlack = false;
            }

            if (digit < 0) {
                valid = false;
                break;
            }
            digits[i] = digit;
        }

        if (allBlack || !valid) {
            // Blank pixel: dark in all frames OR not all frames classified
            // Output sentinel: RGB(255, 255, 254) to avoid clash with LED ID 0
            gl_FragColor = vec4(1.0, 1.0, 254.0/255.0, 1.0);
        } else if (u_numLitFrames > 0) {
            // All frames classified - decode ternary to encoded LED ID
            int encodedLedId = 0;
            int base = 1;
            for (int i = 0; i < 9; i++) {
                if (i >= u_numLitFrames) break;
                encodedLedId += digits[i] * base;
                base *= 3;
            }

            // Validate checksum (must be divisible by 7)
            if (isDivisibleBy7(encodedLedId)) {
                // Get true LED ID (remove checksum by dividing by 9)
                int trueLedId = encodedLedId / 9;
                // Encode true LED ID in RGB channels for JavaScript extraction
                vec3 encoded = encodeLedId(trueLedId);
                gl_FragColor = vec4(encoded, 1.0);
            } else {
                // Invalid pixel: all frames classified but checksum failed
                // Output sentinel: RGB(255, 255, 255)
                gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
            }
        } else {
            // Fallback - output blank sentinel
            gl_FragColor = vec4(1.0, 1.0, 254.0/255.0, 1.0);
        }
    }
}
`;

// Global state
const state = {
    files: [],
    darkFrame: null,
    maskFrame: null,
    litFrames: [],
    processedData: null,
    ledPixels: {},
    ledPositions: {},
    outputText: ''
};

// Transform state for zoom/pan
const transform = {
    scale: 1.0,
    translateX: 0,
    translateY: 0
};

// Rectangle mask state (coordinates stored in normalized 0-1 texture space)
const rectMask = {
    enabled: false,
    drawing: false,
    drawn: false,  // Track if rectangle has been drawn
    normX: 0,      // Normalized texture coordinates (0-1)
    normY: 0,
    normW: 0,
    normH: 0,
    drawStartX: 0, // Screen coordinates during drawing
    drawStartY: 0
};

// WebGL setup
let gl, program, textures = {};

// Offscreen canvas and WebGL context for detection (doesn't interfere with display)
let offscreenCanvas, offscreenGl, offscreenProgram, offscreenTextures = {};

// Detection state
let isDetecting = false;
let detectionPending = false;

// DOM elements
const canvas = document.getElementById('canvas');
const canvasWrapper = document.getElementById('canvasWrapper');
const overlayContainer = document.getElementById('overlayContainer');
const viewport = document.getElementById('viewport');
const crosshairH = document.getElementById('crosshairH');
const crosshairV = document.getElementById('crosshairV');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const unloadBtn = document.getElementById('unloadBtn');
const frameButtons = document.getElementById('frameButtons');
const modeButtons = document.getElementById('modeButtons');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const stats = document.getElementById('stats');
const showOverlayCheckbox = document.getElementById('showOverlay');
const resetViewBtn = document.getElementById('resetViewBtn');
const spinner = document.getElementById('spinner');

let currentFrame = '';
let currentMode = 'normal';

// Configuration elements
const numDigitsInput = document.getElementById('numDigits');
const minPixelsInput = document.getElementById('minPixels');
const minPixelsValueSpan = document.getElementById('minPixelsValue');
const brightnessThresholdInput = document.getElementById('brightnessThreshold');
const brightnessValueSpan = document.getElementById('brightnessValue');
const colorPurityInput = document.getElementById('colorPurity');
const purityValueSpan = document.getElementById('purityValue');
const blurRadiusInput = document.getElementById('blurRadius');
const blurValueSpan = document.getElementById('blurValue');
const greenCorrectionInput = document.getElementById('greenCorrection');
const greenCorrectionValueSpan = document.getElementById('greenCorrectionValue');
const darkFrameContributionInput = document.getElementById('darkFrameContribution');
const darkFrameValueSpan = document.getElementById('darkFrameValue');
const applyMaskCheckbox = document.getElementById('applyMask');
const darkFrameInfo = document.getElementById('darkFrameInfo');
const maskFrameInfo = document.getElementById('maskFrameInfo');
const enableRectMaskCheckbox = document.getElementById('enableRectMask');
const clearRectBtn = document.getElementById('clearRectBtn');
const rectMaskInfo = document.getElementById('rectMaskInfo');

// Initialize WebGL context for a given canvas
function initWebGLContext(canvas) {
    const glContext = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!glContext) {
        alert('WebGL not supported');
        return null;
    }

    // Compile shaders
    const vertexShader = createShader(glContext, glContext.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentShaderSource);

    // Create program
    const programObj = glContext.createProgram();
    glContext.attachShader(programObj, vertexShader);
    glContext.attachShader(programObj, fragmentShader);
    glContext.linkProgram(programObj);

    if (!glContext.getProgramParameter(programObj, glContext.LINK_STATUS)) {
        console.error('Program link error:', glContext.getProgramInfoLog(programObj));
        return null;
    }

    glContext.useProgram(programObj);

    // Setup geometry (full-screen quad)
    const positions = new Float32Array([
        -1, -1,  0, 1,
         1, -1,  1, 1,
        -1,  1,  0, 0,
         1,  1,  1, 0
    ]);

    const buffer = glContext.createBuffer();
    glContext.bindBuffer(glContext.ARRAY_BUFFER, buffer);
    glContext.bufferData(glContext.ARRAY_BUFFER, positions, glContext.STATIC_DRAW);

    const positionLoc = glContext.getAttribLocation(programObj, 'a_position');
    const texCoordLoc = glContext.getAttribLocation(programObj, 'a_texCoord');

    glContext.enableVertexAttribArray(positionLoc);
    glContext.vertexAttribPointer(positionLoc, 2, glContext.FLOAT, false, 16, 0);

    glContext.enableVertexAttribArray(texCoordLoc);
    glContext.vertexAttribPointer(texCoordLoc, 2, glContext.FLOAT, false, 16, 8);

    return { gl: glContext, program: programObj };
}

// Initialize WebGL for main display canvas
function initWebGL() {
    const startTime = performance.now();
    const result = initWebGLContext(canvas);
    if (!result) return false;

    gl = result.gl;
    program = result.program;

    logTime('WebGL initialization', performance.now() - startTime);
    return true;
}

// Initialize offscreen canvas for detection
function initOffscreenWebGL() {
    offscreenCanvas = document.createElement('canvas');
    const result = initWebGLContext(offscreenCanvas);
    if (!result) {
        console.error('Failed to initialize offscreen WebGL context');
        return false;
    }

    offscreenGl = result.gl;
    offscreenProgram = result.program;

    // Verify the context and program are valid
    if (!offscreenGl || !offscreenProgram) {
        console.error('Offscreen WebGL context or program is null');
        return false;
    }

    // Override vertex buffer with flipped texture coordinates for offscreen rendering
    // This ensures readPixels returns correctly oriented data without JavaScript flipping
    const flippedPositions = new Float32Array([
        -1, -1,  0, 0,  // bottom-left screen → top of texture (flipped)
         1, -1,  1, 0,  // bottom-right screen → top of texture
        -1,  1,  0, 1,  // top-left screen → bottom of texture
         1,  1,  1, 1   // top-right screen → bottom of texture
    ]);

    const buffer = offscreenGl.createBuffer();
    offscreenGl.bindBuffer(offscreenGl.ARRAY_BUFFER, buffer);
    offscreenGl.bufferData(offscreenGl.ARRAY_BUFFER, flippedPositions, offscreenGl.STATIC_DRAW);

    const positionLoc = offscreenGl.getAttribLocation(offscreenProgram, 'a_position');
    const texCoordLoc = offscreenGl.getAttribLocation(offscreenProgram, 'a_texCoord');

    offscreenGl.enableVertexAttribArray(positionLoc);
    offscreenGl.vertexAttribPointer(positionLoc, 2, offscreenGl.FLOAT, false, 16, 0);

    offscreenGl.enableVertexAttribArray(texCoordLoc);
    offscreenGl.vertexAttribPointer(texCoordLoc, 2, offscreenGl.FLOAT, false, 16, 8);

    log('Offscreen WebGL initialized');
    return true;
}

function createShader(glContext, type, source) {
    const shader = glContext.createShader(type);
    glContext.shaderSource(shader, source);
    glContext.compileShader(shader);

    if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
        console.error('Shader compile error:', glContext.getShaderInfoLog(shader));
        glContext.deleteShader(shader);
        return null;
    }

    return shader;
}

function createTexture(image) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return texture;
}

function createOffscreenTexture(image) {
    const texture = offscreenGl.createTexture();
    offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, texture);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MAG_FILTER, offscreenGl.LINEAR);
    offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, image);
    return texture;
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Event listeners
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);
unloadBtn.addEventListener('click', unloadFiles);
showOverlayCheckbox.addEventListener('change', () => {
    updateOverlayVisibility();
    saveSettings();
});
copyBtn.addEventListener('click', copyOutput);
downloadBtn.addEventListener('click', downloadOutput);

// Rectangle mask event listeners
enableRectMaskCheckbox.addEventListener('change', () => {
    rectMask.enabled = enableRectMaskCheckbox.checked;
    clearRectBtn.disabled = !rectMask.enabled || !rectMask.drawn;

    if (!rectMask.enabled) {
        // Disabling rectangle mask - reset
        rectMask.drawn = false;
        rectMask.normX = 0;
        rectMask.normY = 0;
        rectMask.normW = 0;
        rectMask.normH = 0;
    }

    // Set cursor: crosshair if enabled and no rectangle drawn yet, otherwise grab
    viewport.style.cursor = rectMask.enabled && !rectMask.drawn ? 'crosshair' : 'grab';
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

clearRectBtn.addEventListener('click', () => {
    rectMask.drawn = false;
    rectMask.normX = 0;
    rectMask.normY = 0;
    rectMask.normW = 0;
    rectMask.normH = 0;
    clearRectBtn.disabled = true;

    // After clearing, allow drawing again with crosshair cursor
    viewport.style.cursor = rectMask.enabled ? 'crosshair' : 'grab';
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});
resetViewBtn.addEventListener('click', resetTransform);

// Global drag & drop
document.body.addEventListener('dragover', handleGlobalDragOver);
document.body.addEventListener('dragleave', handleGlobalDragLeave);
document.body.addEventListener('drop', handleGlobalDrop);

// Drop zone specific handlers
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);

// Mode buttons
modeButtons.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setMode(mode);
    });
});

// Live update on parameter changes
const autoDetect = debounce(processAndDetect, 300);
const liveRender = debounce(renderCurrentView, 50);

// Settings persistence
function saveSettings() {
    const settings = {
        numDigits: numDigitsInput.value,
        minPixels: minPixelsInput.value,
        brightnessThreshold: brightnessThresholdInput.value,
        colorPurity: colorPurityInput.value,
        blurRadius: blurRadiusInput.value,
        greenCorrection: greenCorrectionInput.value,
        darkFrameContribution: darkFrameContributionInput.value,
        applyMask: applyMaskCheckbox.checked,
        showOverlay: showOverlayCheckbox.checked,
        currentMode: currentMode,
        rectMask: {
            enabled: rectMask.enabled,
            normX: rectMask.normX,
            normY: rectMask.normY,
            normW: rectMask.normW,
            normH: rectMask.normH
        }
    };
    localStorage.setItem('ledDetectorSettings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('ledDetectorSettings');
    if (!saved) return;

    try {
        const settings = JSON.parse(saved);

        // Apply settings
        if (settings.numDigits !== undefined) numDigitsInput.value = settings.numDigits;
        if (settings.minPixels !== undefined) {
            minPixelsInput.value = settings.minPixels;
            minPixelsValueSpan.textContent = settings.minPixels;
        }
        if (settings.brightnessThreshold !== undefined) {
            brightnessThresholdInput.value = settings.brightnessThreshold;
            brightnessValueSpan.textContent = settings.brightnessThreshold;
        }
        if (settings.colorPurity !== undefined) {
            colorPurityInput.value = settings.colorPurity;
            purityValueSpan.textContent = settings.colorPurity;
        }
        if (settings.blurRadius !== undefined) {
            blurRadiusInput.value = settings.blurRadius;
            blurValueSpan.textContent = parseFloat(settings.blurRadius).toFixed(1);
        }
        if (settings.greenCorrection !== undefined) {
            greenCorrectionInput.value = settings.greenCorrection;
            greenCorrectionValueSpan.textContent = parseFloat(settings.greenCorrection).toFixed(1);
        }
        if (settings.darkFrameContribution !== undefined) {
            darkFrameContributionInput.value = settings.darkFrameContribution;
            darkFrameValueSpan.textContent = parseFloat(settings.darkFrameContribution).toFixed(1);
        }
        if (settings.applyMask !== undefined) {
            applyMaskCheckbox.checked = settings.applyMask;
        }
        if (settings.showOverlay !== undefined) {
            showOverlayCheckbox.checked = settings.showOverlay;
        }
        if (settings.currentMode !== undefined) {
            currentMode = settings.currentMode;
            modeButtons.querySelectorAll('.mode-btn').forEach(btn => {
                if (btn.dataset.mode === settings.currentMode) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
        if (settings.rectMask !== undefined) {
            rectMask.enabled = settings.rectMask.enabled || false;
            rectMask.normX = settings.rectMask.normX || 0;
            rectMask.normY = settings.rectMask.normY || 0;
            rectMask.normW = settings.rectMask.normW || 0;
            rectMask.normH = settings.rectMask.normH || 0;
            rectMask.drawn = rectMask.normW > 0 && rectMask.normH > 0;
            enableRectMaskCheckbox.checked = rectMask.enabled;

            // Update UI state based on whether rectangle is drawn
            if (rectMask.enabled && rectMask.drawn) {
                clearRectBtn.disabled = false;
                viewport.style.cursor = 'grab'; // Rectangle already drawn, allow panning
            } else {
                clearRectBtn.disabled = true;
                viewport.style.cursor = rectMask.enabled ? 'crosshair' : 'grab';
            }
        }

        log('Settings loaded from localStorage');
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

function updateDetectionStatus(status, message) {
    const statsDiv = document.getElementById('stats');

    if (status === 'outdated') {
        // Results are outdated due to parameter change
        statsDiv.style.opacity = '0.5';
        statsDiv.style.filter = 'grayscale(100%)';
        copyBtn.disabled = true;
        downloadBtn.disabled = true;
        spinner.style.display = 'none';
    } else if (status === 'computing') {
        // Actively processing
        statsDiv.style.opacity = '0.5';
        statsDiv.style.filter = 'grayscale(100%)';
        copyBtn.disabled = true;
        downloadBtn.disabled = true;
        spinner.style.display = 'flex';
    } else if (status === 'ready') {
        // Results ready
        statsDiv.style.opacity = '1';
        statsDiv.style.filter = 'none';
        copyBtn.disabled = false;
        downloadBtn.disabled = false;
        spinner.style.display = 'none';
    } else if (status === 'error') {
        // Error occurred
        statsDiv.style.opacity = '1';
        statsDiv.style.filter = 'none';
        copyBtn.disabled = true;
        downloadBtn.disabled = true;
        spinner.style.display = 'none';
    }
}

applyMaskCheckbox.addEventListener('change', () => {
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});
numDigitsInput.addEventListener('change', () => {
    updateDetectionStatus('outdated');
    autoDetect();
    saveSettings();
});
minPixelsInput.addEventListener('input', (e) => {
    minPixelsValueSpan.textContent = e.target.value;
    updateDetectionStatus('outdated');
    autoDetect();
    saveSettings();
});

brightnessThresholdInput.addEventListener('input', (e) => {
    brightnessValueSpan.textContent = e.target.value;
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

colorPurityInput.addEventListener('input', (e) => {
    purityValueSpan.textContent = e.target.value;
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

blurRadiusInput.addEventListener('input', (e) => {
    blurValueSpan.textContent = parseFloat(e.target.value).toFixed(1);
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

greenCorrectionInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    greenCorrectionValueSpan.textContent = value.toFixed(1);
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

darkFrameContributionInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    darkFrameValueSpan.textContent = value.toFixed(1);
    updateDetectionStatus('outdated');
    liveRender();
    autoDetect();
    saveSettings();
});

// Add scroll wheel support for all sliders
function addScrollWheelToSlider(slider, valueDisplay, suffix = '') {
    slider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = parseFloat(slider.step) || 1;
        const delta = e.deltaY > 0 ? -step : step;
        const newValue = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), parseFloat(slider.value) + delta));
        slider.value = newValue;
        if (valueDisplay) {
            const displayValue = slider.step.includes('.') ? newValue.toFixed(slider.step.split('.')[1].length) : newValue;
            valueDisplay.textContent = displayValue + suffix;
        }
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, { passive: false });
}

addScrollWheelToSlider(minPixelsInput, minPixelsValueSpan);
addScrollWheelToSlider(brightnessThresholdInput, brightnessValueSpan);
addScrollWheelToSlider(colorPurityInput, purityValueSpan);
addScrollWheelToSlider(blurRadiusInput, blurValueSpan);
addScrollWheelToSlider(greenCorrectionInput, greenCorrectionValueSpan);
addScrollWheelToSlider(darkFrameContributionInput, darkFrameValueSpan);

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    document.body.classList.remove('drag-over-global');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    loadFiles(files);
}

function handleGlobalDragOver(e) {
    e.preventDefault();
    document.body.classList.add('drag-over-global');
}

function handleGlobalDragLeave(e) {
    e.preventDefault();
    // Only remove if we're leaving the body entirely
    if (e.target === document.body) {
        document.body.classList.remove('drag-over-global');
    }
}

function handleGlobalDrop(e) {
    e.preventDefault();
    document.body.classList.remove('drag-over-global');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
        loadFiles(files);
    }
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    loadFiles(files);
}

function unloadFiles() {
    log('Unloading all files');

    // Clear state
    state.files = [];
    state.darkFrame = null;
    state.maskFrame = null;
    state.litFrames = [];
    state.processedData = null;
    state.ledPixels = {};
    state.ledPositions = {};
    state.outputText = '';
    currentFrame = '';

    // Clear textures
    textures = {};
    offscreenTextures = {};

    // Clear UI
    fileList.style.display = 'none';
    fileList.innerHTML = '';
    unloadBtn.style.display = 'none';
    frameButtons.innerHTML = '';
    overlayContainer.innerHTML = '';
    overlayContainer.style.display = 'none';
    stats.style.display = 'none';
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    showOverlayCheckbox.checked = false;

    // Reset file input
    fileInput.value = '';

    // Clear canvas
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Reset frame info
    updateFrameInfo();

    log('All files unloaded');
}

function setMode(mode) {
    currentMode = mode;

    // Update button states
    modeButtons.querySelectorAll('.mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderCurrentView();
    updateOverlayVisibility();
    saveSettings();
}

function setFrame(frame) {
    currentFrame = frame;

    // Update button states
    frameButtons.querySelectorAll('.frame-btn').forEach(btn => {
        if (btn.dataset.frame === frame) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderCurrentView();
    updateOverlayVisibility();
}

async function loadFiles(files) {
    const startTime = performance.now();

    if (files.length === 0) return;

    log('Loading files', files.length);
    state.files = files.sort((a, b) => a.name.localeCompare(b.name));

    // Auto-detect dark and mask frames
    state.darkFrame = null;
    state.maskFrame = null;
    state.litFrames = [];

    for (const file of state.files) {
        if (file.name.includes('_dark')) {
            state.darkFrame = file;
        } else if (file.name.includes('_mask')) {
            state.maskFrame = file;
        } else {
            state.litFrames.push(file);
        }
    }

    log('Detected frames:', {
        dark: state.darkFrame?.name,
        mask: state.maskFrame?.name,
        lit: state.litFrames.length
    });

    // Clear textures
    textures = {};
    offscreenTextures = {};

    // Load textures to both contexts
    if (state.darkFrame) {
        const loaded = await loadImageTexture(state.darkFrame);
        textures.dark = loaded;
        offscreenTextures.dark = loaded.offscreenTexture;
        log('Loaded dark frame');
    }
    if (state.maskFrame) {
        const loaded = await loadImageTexture(state.maskFrame);
        textures.mask = loaded;
        offscreenTextures.mask = loaded.offscreenTexture;
        log('Loaded mask frame');
    }

    // Update UI
    updateFileList();
    updateFrameButtons();
    updateFrameInfo();
    unloadBtn.style.display = 'block';

    // Load and display first lit frame
    if (state.litFrames.length > 0) {
        await renderCurrentView();
        await processAndDetect();
    }

    logTime('File loading', performance.now() - startTime);
}

function updateFileList() {
    fileList.style.display = 'block';
    fileList.innerHTML = '';

    if (state.darkFrame) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<span>${state.darkFrame.name}</span><span class="file-type">DARK</span>`;
        fileList.appendChild(item);
    }

    if (state.maskFrame) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<span>${state.maskFrame.name}</span><span class="file-type">MASK</span>`;
        fileList.appendChild(item);
    }

    state.litFrames.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<span>${file.name}</span><span class="file-type">LIT</span>`;
        fileList.appendChild(item);
    });
}

function updateFrameButtons() {
    frameButtons.innerHTML = '';

    let firstFrame = null;

    if (state.darkFrame) {
        const btn = document.createElement('button');
        btn.className = 'frame-btn';
        btn.dataset.frame = 'dark';
        btn.textContent = '🌑';
        btn.title = 'Dark Frame [D]';
        btn.addEventListener('click', () => setFrame('dark'));
        frameButtons.appendChild(btn);
        if (!firstFrame) firstFrame = 'dark';
    }

    if (state.maskFrame) {
        const btn = document.createElement('button');
        btn.className = 'frame-btn';
        btn.dataset.frame = 'mask';
        btn.textContent = '🎭';
        btn.title = 'Mask Frame [M]';
        btn.addEventListener('click', () => setFrame('mask'));
        frameButtons.appendChild(btn);
        if (!firstFrame) firstFrame = 'mask';
    }

    state.litFrames.forEach((file, idx) => {
        const value = `lit_${idx}`;
        const btn = document.createElement('button');
        btn.className = 'frame-btn';
        btn.dataset.frame = value;
        btn.textContent = (idx + 1).toString();
        btn.title = `Frame ${idx + 1} [${idx + 1}]`;
        btn.addEventListener('click', () => setFrame(value));
        frameButtons.appendChild(btn);
        if (!firstFrame) firstFrame = value;
    });

    // Set first lit frame as selected (prefer lit frames over dark/mask)
    if (state.litFrames.length > 0) {
        firstFrame = 'lit_0';
    }

    // Set first frame as active
    if (firstFrame) {
        currentFrame = firstFrame;
        const btn = frameButtons.querySelector(`[data-frame="${firstFrame}"]`);
        if (btn) btn.classList.add('active');
    }
}

function updateFrameInfo() {
    if (state.darkFrame) {
        darkFrameInfo.textContent = `${state.darkFrame.name}`;
        darkFrameInfo.style.color = '#81c784';
        darkFrameContributionInput.disabled = false;
    } else {
        darkFrameInfo.textContent = 'No dark frame';
        darkFrameInfo.style.color = '#888';
        darkFrameContributionInput.disabled = true;
    }

    if (state.maskFrame) {
        maskFrameInfo.textContent = `${state.maskFrame.name}`;
        maskFrameInfo.style.color = '#81c784';
    } else {
        maskFrameInfo.textContent = 'No mask frame';
        maskFrameInfo.style.color = '#888';
    }
}

async function loadImageTexture(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const texture = createTexture(img);
                const offscreenTexture = createOffscreenTexture(img);
                resolve({ texture, offscreenTexture, image: img, width: img.width, height: img.height });
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function renderCurrentView() {
    const startTime = performance.now();

    const selectedFrame = currentFrame;
    const mode = currentMode;

    let imageTexture;

    if (selectedFrame === 'dark' && state.darkFrame) {
        imageTexture = textures.dark;
    } else if (selectedFrame === 'mask' && state.maskFrame) {
        imageTexture = textures.mask;
    } else if (selectedFrame.startsWith('lit_')) {
        const idx = parseInt(selectedFrame.split('_')[1]);
        const file = state.litFrames[idx];
        const cacheKey = `lit_${idx}`;

        if (!textures[cacheKey]) {
            const loaded = await loadImageTexture(file);
            textures[cacheKey] = loaded;
            offscreenTextures[cacheKey] = loaded.offscreenTexture;
        }
        imageTexture = textures[cacheKey];
    }

    if (!imageTexture) return;

    const width = imageTexture.width;
    const height = imageTexture.height;

    // Resize canvas to match image
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);

    // Set uniforms
    const modeMap = {
        'normal': 0,
        'classified': 1,
        'red': 2,
        'green': 3,
        'blue': 4,
        'idmap': 6  // Shader-based ID map
    };

    gl.uniform1i(gl.getUniformLocation(program, 'u_mode'), modeMap[mode] || 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), parseFloat(brightnessThresholdInput.value) / 255);
    gl.uniform1f(gl.getUniformLocation(program, 'u_purity'), parseFloat(colorPurityInput.value));
    gl.uniform1f(gl.getUniformLocation(program, 'u_darkFrameContribution'), parseFloat(darkFrameContributionInput.value));
    gl.uniform1i(gl.getUniformLocation(program, 'u_applyMask'), applyMaskCheckbox.checked ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_hasDark'), textures.dark ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_hasMask'), textures.mask ? 1 : 0);

    // Rectangle mask uniforms (uses normalized coordinates stored in rectMask)
    const hasRectMask = rectMask.enabled && rectMask.normW > 0 && rectMask.normH > 0;
    gl.uniform1i(gl.getUniformLocation(program, 'u_useRectMask'), hasRectMask ? 1 : 0);
    if (hasRectMask) {
        gl.uniform4f(gl.getUniformLocation(program, 'u_rectMask'),
            rectMask.normX, rectMask.normY, rectMask.normW, rectMask.normH);
    }

    // Resolution and blur uniforms
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_blurRadius'), parseFloat(blurRadiusInput.value));

    // Green correction
    const greenCorrection = parseFloat(greenCorrectionInput.value);
    gl.uniform1f(gl.getUniformLocation(program, 'u_greenCorrection'), greenCorrection);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);

    if (textures.dark) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures.dark.texture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_darkFrame'), 1);
    }

    if (textures.mask) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, textures.mask.texture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_maskFrame'), 2);
    }

    // For ID map mode, bind all lit frames
    if (mode === 'idmap') {
        const numDigits = parseInt(numDigitsInput.value);
        const numFrames = Math.min(state.litFrames.length, numDigits, 9);
        gl.uniform1i(gl.getUniformLocation(program, 'u_numLitFrames'), numFrames);

        for (let i = 0; i < numFrames; i++) {
            const cacheKey = `lit_${i}`;
            if (textures[cacheKey]) {
                gl.activeTexture(gl.TEXTURE3 + i);  // Start at TEXTURE3
                gl.bindTexture(gl.TEXTURE_2D, textures[cacheKey].texture);
                gl.uniform1i(gl.getUniformLocation(program, `u_litFrames[${i}]`), 3 + i);
            }
        }
    }

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    logTime('Render', performance.now() - startTime);
}

function renderIdMapWebGL() {
    if (!state.processedData) return;

    const width = state.processedData.width;
    const height = state.processedData.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(width, height);
    const data = imageData.data;

    // Draw valid LED IDs with unique colors
    for (const [ledId, pixels] of Object.entries(state.ledPixels)) {
        const color = idToColor(parseInt(ledId));
        for (const {x, y} of pixels) {
            const i = (y * width + x) * 4;
            data[i] = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = 255;
        }
    }

    // Draw invalid pixels in magenta
    if (state.processedData.invalidPixels) {
        for (const {x, y} of state.processedData.invalidPixels) {
            const i = (y * width + x) * 4;
            data[i] = 255;
            data[i + 1] = 0;
            data[i + 2] = 255;
            data[i + 3] = 255;
        }
    }

    tempCtx.putImageData(imageData, 0, 0);

    // Draw to WebGL canvas
    const texture = createTexture(tempCanvas);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_mode'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.deleteTexture(texture);
}

function updateOverlayVisibility() {
    if (showOverlayCheckbox.checked && state.ledPositions && Object.keys(state.ledPositions).length > 0) {
        renderOverlayHTML();
        overlayContainer.style.display = 'block';
    } else {
        overlayContainer.style.display = 'none';
    }
}

function renderOverlayHTML() {
    overlayContainer.innerHTML = '';

    if (!state.ledPositions || Object.keys(state.ledPositions).length === 0) return;

    // Calculate canvas scale and position in its natural (pre-transform) coordinate space
    // The overlayContainer shares the same coordinate space as the canvas wrapper before transforms
    const wrapperWidth = canvasWrapper.clientWidth;
    const wrapperHeight = canvasWrapper.clientHeight;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Calculate scale to fit canvas in wrapper (object-fit: contain behavior)
    const scaleX = wrapperWidth / canvasWidth;
    const scaleY = wrapperHeight / canvasHeight;
    const scale = Math.min(scaleX, scaleY);

    // Calculate centering offsets
    const scaledCanvasWidth = canvasWidth * scale;
    const scaledCanvasHeight = canvasHeight * scale;
    const offsetX = (wrapperWidth - scaledCanvasWidth) / 2;
    const offsetY = (wrapperHeight - scaledCanvasHeight) / 2;

    // Calculate inverse scale to keep labels constant size regardless of zoom
    const inverseScale = 1 / transform.scale;

    for (const [ledId, {x, y}] of Object.entries(state.ledPositions)) {
        const screenX = x * scale + offsetX;
        const screenY = y * scale + offsetY;

        const marker = document.createElement('div');
        marker.className = 'led-marker';
        marker.style.left = `${screenX}px`;
        marker.style.top = `${screenY}px`;

        const crosshair = document.createElement('div');
        crosshair.className = 'led-crosshair';
        // Apply inverse scale to crosshair to keep constant size
        crosshair.style.transform = `translate(-50%, -50%) scale(${inverseScale})`;

        const label = document.createElement('div');
        label.className = 'led-label';
        label.textContent = ledId;
        // Apply inverse scale to label to keep constant size
        // The translate moves it relative to the marker, scale keeps it constant size
        label.style.transform = `translate(${12 * inverseScale}px, ${-8 * inverseScale}px) scale(${inverseScale})`;
        label.style.transformOrigin = '0 0';

        marker.appendChild(crosshair);
        marker.appendChild(label);
        overlayContainer.appendChild(marker);
    }
}

function idToColor(ledId) {
    const r = (ledId * 137) % 256;
    const g = (ledId * 211) % 256;
    const b = (ledId * 173) % 256;
    return {r, g, b};
}

async function processAndDetect() {
    if (state.litFrames.length === 0) return;

    // If already detecting, mark as pending and return
    if (isDetecting) {
        detectionPending = true;
        updateDetectionStatus('computing', 'Computing...');
        return;
    }

    isDetecting = true;
    updateDetectionStatus('computing', 'Computing...');

    const numDigits = parseInt(numDigitsInput.value);
    const minPixels = parseInt(minPixelsInput.value);

    log('Starting LED detection', { numDigits, minPixels });

    try {
        const startTime = performance.now();

        // Load all lit frame textures (cached)
        const numFrames = Math.min(state.litFrames.length, numDigits, 9);
        for (let i = 0; i < numFrames; i++) {
            const cacheKey = `lit_${i}`;
            if (!textures[cacheKey]) {
                const loaded = await loadImageTexture(state.litFrames[i]);
                textures[cacheKey] = loaded;
                offscreenTextures[cacheKey] = loaded.offscreenTexture;
            }
        }

        const width = textures.lit_0.width;
        const height = textures.lit_0.height;

        // Set offscreen canvas to frame size
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        offscreenGl.viewport(0, 0, width, height);
        offscreenGl.useProgram(offscreenProgram);

        // Set uniforms
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_mode'), 7); // id_encode mode
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_threshold'), parseFloat(brightnessThresholdInput.value) / 255);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_purity'), parseFloat(colorPurityInput.value));
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_darkFrameContribution'), parseFloat(darkFrameContributionInput.value));
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_applyMask'), applyMaskCheckbox.checked ? 1 : 0);
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_hasDark'), offscreenTextures.dark ? 1 : 0);
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_hasMask'), offscreenTextures.mask ? 1 : 0);

        // Rectangle mask uniforms (uses normalized coordinates stored in rectMask)
        const hasRectMask = rectMask.enabled && rectMask.normW > 0 && rectMask.normH > 0;
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_useRectMask'), hasRectMask ? 1 : 0);
        if (hasRectMask) {
            offscreenGl.uniform4f(offscreenGl.getUniformLocation(offscreenProgram, 'u_rectMask'),
                rectMask.normX, rectMask.normY, rectMask.normW, rectMask.normH);
        }

        // Resolution and blur uniforms
        offscreenGl.uniform2f(offscreenGl.getUniformLocation(offscreenProgram, 'u_resolution'), width, height);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_blurRadius'), parseFloat(blurRadiusInput.value));

        // Green correction
        const greenCorrection = parseFloat(greenCorrectionInput.value);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_greenCorrection'), greenCorrection);

        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_numLitFrames'), numFrames);

        // Bind cached offscreen textures for all lit frames
        for (let i = 0; i < numFrames; i++) {
            const cacheKey = `lit_${i}`;
            if (offscreenTextures[cacheKey]) {
                offscreenGl.activeTexture(offscreenGl.TEXTURE3 + i);
                offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTextures[cacheKey]);
                offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, `u_litFrames[${i}]`), 3 + i);
            }
        }

        // Bind dark frame if present
        if (offscreenTextures.dark) {
            offscreenGl.activeTexture(offscreenGl.TEXTURE1);
            offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTextures.dark);
            offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_darkFrame'), 1);
        }

        // Bind mask frame if present
        if (offscreenTextures.mask) {
            offscreenGl.activeTexture(offscreenGl.TEXTURE2);
            offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTextures.mask);
            offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_maskFrame'), 2);
        }

        // Clear and draw
        offscreenGl.clearColor(0, 0, 0, 1);
        offscreenGl.clear(offscreenGl.COLOR_BUFFER_BIT);
        offscreenGl.drawArrays(offscreenGl.TRIANGLE_STRIP, 0, 4);

        // Read back pixels
        const pixels = new Uint8Array(width * height * 4);
        offscreenGl.readPixels(0, 0, width, height, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, pixels);

        logTime('GPU LED ID encoding', performance.now() - startTime);

        // Decode LED IDs from RGB channels
        const decodeStartTime = performance.now();
        const ledPixels = {};
        const invalidPixels = [];  // White pixels: checksum mismatch
        const blankPixels = [];     // Black pixels: not all frames classified
        let validCount = 0;
        let invalidCount = 0;
        let blankCount = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];

                // Skip blank (255, 255, 254): not all frames classified or background
                if (r === 255 && g === 255 && b === 254) {
                    blankCount++;
                    continue;
                }

                // Track invalid (255, 255, 255): all frames classified but checksum failed
                if (r === 255 && g === 255 && b === 255) {
                    invalidPixels.push({ x, y });
                    invalidCount++;
                    continue;
                }

                // Decode true LED ID directly: id = R + G*256 + B*65536
                // (Shader already validated checksum and divided by 9)
                // LED ID 0 encodes as RGB(0, 0, 0) and is valid
                const trueLedId = r + g * 256 + b * 65536;

                if (!ledPixels[trueLedId]) {
                    ledPixels[trueLedId] = [];
                }
                ledPixels[trueLedId].push({ x, y });
                validCount++;
            }
        }

        // Filter by minimum pixel count
        const filteredLedPixels = {};
        for (const [ledId, pixels] of Object.entries(ledPixels)) {
            if (pixels.length >= minPixels) {
                filteredLedPixels[ledId] = pixels;
            }
        }

        // Compute centers of mass
        const ledPositions = {};
        for (const [ledId, pixels] of Object.entries(filteredLedPixels)) {
            const meanX = Math.round(pixels.reduce((sum, p) => sum + p.x, 0) / pixels.length);
            const meanY = Math.round(pixels.reduce((sum, p) => sum + p.y, 0) / pixels.length);
            ledPositions[ledId] = { x: meanX, y: meanY };
        }

        logTime('LED decoding', performance.now() - decodeStartTime);

        // Update state
        state.ledPixels = filteredLedPixels;
        state.ledPositions = ledPositions;
        state.processedData = {
            width,
            height,
            validCount,
            invalidCount,
            blankCount,
            invalidPixels,
            blankPixels
        };

        generateOutput();
        updateStats();
        updateOverlayVisibility();
        copyBtn.disabled = false;
        downloadBtn.disabled = false;

        logTime('Total LED detection', performance.now() - startTime);
        log('Detection complete:', {
            validPixels: validCount,
            invalidPixels: invalidCount,
            blankPixels: blankCount,
            uniqueLEDs: Object.keys(state.ledPositions).length
        });

        updateDetectionStatus('ready', `${Object.keys(state.ledPositions).length} LEDs detected`);

        isDetecting = false;

        // If another detection was requested while processing, start it now
        if (detectionPending) {
            detectionPending = false;
            processAndDetect();
        }

    } catch (error) {
        console.error('Processing error:', error);
        isDetecting = false;
        updateDetectionStatus('error', 'Detection failed');

        // If another detection was requested while processing, start it now
        if (detectionPending) {
            detectionPending = false;
            processAndDetect();
        }
    }
}

// Render a frame through the classification shader and read back the result
// Uses offscreen canvas to not interfere with display
async function renderFrameClassified(imageTexture) {
    if (!imageTexture || !imageTexture.image) {
        console.error('Invalid imageTexture:', imageTexture);
        return { data: new Uint8Array(0), width: 0, height: 0 };
    }

    const width = imageTexture.width;
    const height = imageTexture.height;

    // Set offscreen canvas to frame size
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    offscreenGl.viewport(0, 0, width, height);

    // Make sure the shader program is active
    offscreenGl.useProgram(offscreenProgram);

    // Create textures in offscreen context (textures are context-specific)
    // Bind image texture to TEXTURE0
    offscreenGl.activeTexture(offscreenGl.TEXTURE0);
    const offscreenImageTex = offscreenGl.createTexture();
    offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenImageTex);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
    offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MAG_FILTER, offscreenGl.LINEAR);
    offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, imageTexture.image);
    offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_image'), 0);

    // Set uniforms for classification mode
    offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_mode'), 1); // classified mode
    offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_threshold'), parseFloat(brightnessThresholdInput.value) / 255);
    offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_purity'), parseFloat(colorPurityInput.value));
    offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_darkFrameContribution'), parseFloat(darkFrameContributionInput.value));
    offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_applyMask'), applyMaskCheckbox.checked ? 1 : 0);
    offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_hasDark'), textures.dark ? 1 : 0);
    offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_hasMask'), textures.mask ? 1 : 0);

    // Green correction
    const greenCorrection = parseFloat(greenCorrectionInput.value);
    offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_greenCorrection'), greenCorrection);

    // Bind dark frame texture if present
    let offscreenDarkTex = null;
    if (textures.dark) {
        offscreenGl.activeTexture(offscreenGl.TEXTURE1); // Set texture unit FIRST
        offscreenDarkTex = offscreenGl.createTexture();
        offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenDarkTex);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MAG_FILTER, offscreenGl.LINEAR);
        offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, textures.dark.image);
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_darkFrame'), 1);
    }

    // Bind mask frame texture if present
    let offscreenMaskTex = null;
    if (textures.mask) {
        offscreenGl.activeTexture(offscreenGl.TEXTURE2); // Set texture unit FIRST
        offscreenMaskTex = offscreenGl.createTexture();
        offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenMaskTex);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MAG_FILTER, offscreenGl.LINEAR);
        offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, textures.mask.image);
        offscreenGl.uniform1i(offscreenGl.getUniformLocation(offscreenProgram, 'u_maskFrame'), 2);
    }

    // Clear and draw
    offscreenGl.clearColor(0, 0, 0, 1);
    offscreenGl.clear(offscreenGl.COLOR_BUFFER_BIT);
    offscreenGl.drawArrays(offscreenGl.TRIANGLE_STRIP, 0, 4);

    // Read back pixels
    const pixels = new Uint8Array(width * height * 4);
    offscreenGl.readPixels(0, 0, width, height, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, pixels);

    // Clean up temporary textures
    offscreenGl.deleteTexture(offscreenImageTex);
    if (offscreenDarkTex) offscreenGl.deleteTexture(offscreenDarkTex);
    if (offscreenMaskTex) offscreenGl.deleteTexture(offscreenMaskTex);

    return { data: pixels, width, height };
}

async function getImageData(image) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = image.width;
    tempCanvas.height = image.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(image, 0, 0);
    return tempCtx.getImageData(0, 0, image.width, image.height);
}

function generateOutput() {
    const width = state.processedData.width;
    const height = state.processedData.height;

    let result = `FRAME_SIZE ${width} ${height}\n`;

    const sortedLeds = Object.entries(state.ledPositions).sort((a, b) => {
        return parseInt(a[0]) - parseInt(b[0]);
    });

    for (const [ledId, {x, y}] of sortedLeds) {
        const paddedId = ledId.toString().padStart(4, '0');
        result += `LED_${paddedId} ${x} ${y}\n`;
    }

    state.outputText = result;
    log('Generated output', result.split('\n').length - 1, 'lines');
}

function updateStats() {
    stats.style.display = 'grid';

    // Calculate valid percentage (valid / non-blank)
    const nonBlankCount = state.processedData.validCount + state.processedData.invalidCount;
    const validPercentage = nonBlankCount > 0
        ? (state.processedData.validCount / nonBlankCount * 100).toFixed(1)
        : 0;

    stats.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${Object.keys(state.ledPositions).length}</div>
            <div class="stat-label">LEDs</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${validPercentage}%</div>
            <div class="stat-label">Valid</div>
        </div>
    `;
}

function copyOutput() {
    navigator.clipboard.writeText(state.outputText).then(() => {
        log('Copied to clipboard');
        const originalTitle = copyBtn.title;
        copyBtn.title = 'Copied!';
        copyBtn.style.opacity = '0.6';
        setTimeout(() => {
            copyBtn.title = originalTitle;
            copyBtn.style.opacity = '1';
        }, 2000);
    });
}

function getFilenamePrefix() {
    if (state.litFrames.length === 0) return 'results';

    // Get all lit frame filenames
    const filenames = state.litFrames.map(f => f.name);

    // Find common prefix
    if (filenames.length === 1) {
        // Single file - use filename without extension
        return filenames[0].replace(/\.[^/.]+$/, '');
    }

    // Multiple files - find longest common prefix
    let prefix = filenames[0];
    for (let i = 1; i < filenames.length; i++) {
        let j = 0;
        while (j < prefix.length && j < filenames[i].length && prefix[j] === filenames[i][j]) {
            j++;
        }
        prefix = prefix.substring(0, j);
    }

    // Remove trailing numbers, underscores, dashes
    prefix = prefix.replace(/[_\-0-9]+$/, '');

    // If prefix is empty or too short, use first filename
    if (!prefix || prefix.length < 3) {
        prefix = filenames[0].replace(/\.[^/.]+$/, '');
    }

    return prefix || 'results';
}

function downloadOutput() {
    const filename = getFilenamePrefix() + '_results.txt';
    const blob = new Blob([state.outputText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log('Downloaded as', filename);
    const originalTitle = downloadBtn.title;
    downloadBtn.title = 'Downloaded!';
    downloadBtn.style.opacity = '0.6';
    setTimeout(() => {
        downloadBtn.title = originalTitle;
        downloadBtn.style.opacity = '1';
    }, 2000);
}

// Handle window resize to update overlay positions
window.addEventListener('resize', () => {
    if (showOverlayCheckbox.checked) {
        updateOverlayVisibility();
    }
});

// Zoom and Pan Controls
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartTranslateX = 0;
let panStartTranslateY = 0;

function applyTransform() {
    canvasWrapper.style.transform = `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`;
    updateOverlayVisibility();
}

function resetTransform() {
    transform.scale = 1.0;
    transform.translateX = 0;
    transform.translateY = 0;
    applyTransform();
}

// Mouse wheel for zooming
viewport.addEventListener('wheel', (e) => {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(10, transform.scale * delta));

    // Zoom towards mouse position
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate zoom center offset
    const scaleChange = newScale / transform.scale;
    transform.translateX = mouseX - (mouseX - transform.translateX) * scaleChange;
    transform.translateY = mouseY - (mouseY - transform.translateY) * scaleChange;
    transform.scale = newScale;

    applyTransform();
}, { passive: false });

// Left mouse button for panning on viewport
viewport.addEventListener('mousedown', (e) => {
    // Only handle if clicking directly on viewport, canvas wrapper, or canvas (not on panels or controls)
    if (e.button === 0 && (e.target === viewport || e.target === canvasWrapper || e.target === canvas)) {
        e.preventDefault();

        // If rectangle mask mode is enabled AND no rectangle drawn yet, start drawing
        if (rectMask.enabled && !rectMask.drawn) {
            rectMask.drawing = true;
            const canvasRect = canvas.getBoundingClientRect();
            rectMask.drawStartX = e.clientX - canvasRect.left;
            rectMask.drawStartY = e.clientY - canvasRect.top;

            // Show crosshair
            crosshairH.style.display = 'block';
            crosshairV.style.display = 'block';
            crosshairH.style.top = e.clientY + 'px';
            crosshairV.style.left = e.clientX + 'px';
        } else {
            // Normal panning mode (either rect mask disabled or rectangle already drawn)
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartTranslateX = transform.translateX;
            panStartTranslateY = transform.translateY;
            viewport.style.cursor = 'grabbing';
        }
    }
});

document.addEventListener('mousemove', (e) => {
    if (rectMask.drawing) {
        e.preventDefault();
        // Update crosshair position to follow cursor
        crosshairH.style.top = e.clientY + 'px';
        crosshairV.style.left = e.clientX + 'px';
    } else if (isPanning) {
        e.preventDefault();
        const deltaX = e.clientX - panStartX;
        const deltaY = e.clientY - panStartY;
        transform.translateX = panStartTranslateX + deltaX;
        transform.translateY = panStartTranslateY + deltaY;
        applyTransform();
    }
});

document.addEventListener('mouseup', (e) => {
    if (rectMask.drawing) {
        rectMask.drawing = false;

        // Hide crosshair
        crosshairH.style.display = 'none';
        crosshairV.style.display = 'none';

        // Convert final screen coordinates to normalized texture coordinates
        const canvasRect = canvas.getBoundingClientRect();
        const drawEndX = e.clientX - canvasRect.left;
        const drawEndY = e.clientY - canvasRect.top;

        const x = Math.min(rectMask.drawStartX, drawEndX);
        const y = Math.min(rectMask.drawStartY, drawEndY);
        const width = Math.abs(drawEndX - rectMask.drawStartX);
        const height = Math.abs(drawEndY - rectMask.drawStartY);

        // Convert to normalized coordinates (0-1)
        rectMask.normX = x / canvasRect.width;
        rectMask.normY = y / canvasRect.height;
        rectMask.normW = width / canvasRect.width;
        rectMask.normH = height / canvasRect.height;

        rectMask.drawn = true;
        clearRectBtn.disabled = false;
        viewport.style.cursor = 'grab'; // Switch to grab cursor for panning
        updateDetectionStatus('outdated');
        liveRender();
        autoDetect();
        saveSettings();
    } else if (isPanning) {
        isPanning = false;
        viewport.style.cursor = rectMask.enabled && !rectMask.drawn ? 'crosshair' : 'grab';
    }
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    // Skip if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    // Frame selection: 1-9
    if (key >= '1' && key <= '9') {
        const idx = parseInt(key) - 1;
        if (idx < state.litFrames.length) {
            setFrame(`lit_${idx}`);
        }
        return;
    }

    // Special frames
    if (key === 'd' && state.darkFrame) {
        setFrame('dark');
        return;
    }
    if (key === 'm' && state.maskFrame) {
        setFrame('mask');
        return;
    }

    // View modes
    const modeMap = {
        'n': 'normal',
        'c': 'classified',
        'r': 'red',
        'g': 'green',
        'b': 'blue',
        'i': 'idmap'
    };

    if (modeMap[key]) {
        setMode(modeMap[key]);
        return;
    }

    // Toggle overlay
    if (key === 'o') {
        showOverlayCheckbox.checked = !showOverlayCheckbox.checked;
        updateOverlayVisibility();
        return;
    }

    // Reset zoom/pan
    if (key === 'z') {
        resetTransform();
        return;
    }
});

// Initialize
log('Initializing LED Detector');
initWebGL();
initOffscreenWebGL();
loadSettings();
