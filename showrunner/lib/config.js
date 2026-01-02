import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { access, constants } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load and validate configuration from environment variables
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  const config = {
    // Required - LED coordinate file path
    ledCoordsFile: process.env.LED_COORDS_FILE,

    // Animation configuration
    animationDir: process.env.ANIMATION_DIR || resolve(__dirname, '../../3d_cube_demo'),
    animationControlFile: process.env.ANIMATION_CONTROL_FILE || '/var/run/led_animation',
    initialAnimation: process.env.INITIAL_ANIMATION || 'simple_sphere_script.js',

    // Serial configuration
    serialPortBase: process.env.SERIAL_PORT_BASE || '/dev/ttyACM',
    serialBaudrate: parseInt(process.env.SERIAL_BAUDRATE || '115200', 10),
    serialTimeout: parseInt(process.env.SERIAL_TIMEOUT || '100', 10),

    // LED configuration
    ledsPerChannel: parseInt(process.env.LEDS_PER_CHANNEL || '200', 10),
    numChannels: parseInt(process.env.NUM_CHANNELS || '6', 10),

    // Performance configuration
    fps: parseInt(process.env.FPS || '30', 10),
    highResolutionTimer: process.env.HIGH_RESOLUTION_TIMER !== 'false',

    // Status handling
    statusFile: process.env.STATUS_FILE || '/var/run/led_status.json',

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    logFrameStats: process.env.LOG_FRAME_STATS === 'true',
    frameStatsInterval: parseInt(process.env.FRAME_STATS_INTERVAL || '60', 10),

    // WebSocket configuration
    wsListen: process.env.WS_LISTEN || '127.0.0.1:8080',
    wsEvictionAge: parseInt(process.env.WS_EVICTION_AGE || '300', 10),
    wsIdleTimeout: parseInt(process.env.WS_IDLE_TIMEOUT || '30', 10),
  };

  // Calculate total LEDs
  config.totalLeds = config.ledsPerChannel * config.numChannels;

  // Parse WS_LISTEN into host and port
  const [wsHost, wsPort] = config.wsListen.split(':');
  config.wsListenHost = wsHost || '127.0.0.1';
  config.wsListenPort = parseInt(wsPort || '8080', 10);

  // Validate required fields
  if (!config.ledCoordsFile) {
    throw new Error('LED_COORDS_FILE environment variable is required');
  }

  // Validate numeric values
  if (isNaN(config.fps) || config.fps <= 0 || config.fps > 120) {
    throw new Error(`Invalid FPS value: ${process.env.FPS}. Must be between 1 and 120`);
  }

  if (isNaN(config.ledsPerChannel) || config.ledsPerChannel <= 0 || config.ledsPerChannel > 200) {
    throw new Error(`Invalid LEDS_PER_CHANNEL: ${process.env.LEDS_PER_CHANNEL}. Must be between 1 and 200`);
  }

  if (isNaN(config.numChannels) || config.numChannels <= 0 || config.numChannels > 8) {
    throw new Error(`Invalid NUM_CHANNELS: ${process.env.NUM_CHANNELS}. Must be between 1 and 8`);
  }

  // Validate WebSocket configuration
  if (isNaN(config.wsListenPort) || config.wsListenPort <= 0 || config.wsListenPort > 65535) {
    throw new Error(`Invalid WS_LISTEN port. Must be between 1 and 65535`);
  }

  if (isNaN(config.wsEvictionAge) || config.wsEvictionAge < 0) {
    throw new Error(`Invalid WS_EVICTION_AGE. Must be non-negative`);
  }

  if (isNaN(config.wsIdleTimeout) || config.wsIdleTimeout <= 0) {
    throw new Error(`Invalid WS_IDLE_TIMEOUT. Must be positive`);
  }

  return config;
}

/**
 * Validate that required files exist
 * @param {Object} config - Configuration object
 */
export async function validateConfig(config) {
  // Check LED coordinates file exists
  try {
    await access(config.ledCoordsFile, constants.R_OK);
  } catch (err) {
    throw new Error(`LED coordinate file not found or not readable: ${config.ledCoordsFile}`);
  }

  // Check animation directory exists
  try {
    await access(config.animationDir, constants.R_OK);
  } catch (err) {
    console.warn(`Warning: Animation directory not found: ${config.animationDir}`);
  }

  // Check initial animation file exists
  const initialAnimPath = resolve(config.animationDir, config.initialAnimation);
  try {
    await access(initialAnimPath, constants.R_OK);
  } catch (err) {
    throw new Error(`Initial animation file not found: ${initialAnimPath}`);
  }
}

/**
 * Print configuration summary
 * @param {Object} config - Configuration object
 */
export function printConfig(config) {
  const logLevel = config.logLevel.toLowerCase();
  if (logLevel !== 'debug' && logLevel !== 'info') {
    return;
  }

  console.log('Configuration:');
  console.log(`  LED Coordinates: ${config.ledCoordsFile}`);
  console.log(`  Animation Dir: ${config.animationDir}`);
  console.log(`  Initial Animation: ${config.initialAnimation}`);
  console.log(`  Control File: ${config.animationControlFile}`);
  console.log(`  Serial Port Base: ${config.serialPortBase}`);
  console.log(`  Serial Baudrate: ${config.serialBaudrate}`);
  console.log(`  FPS: ${config.fps}`);
  console.log(`  LEDs: ${config.totalLeds} (${config.ledsPerChannel} per channel × ${config.numChannels} channels)`);
  console.log(`  Status File: ${config.statusFile}`);
  console.log(`  Log Level: ${config.logLevel}`);
  console.log(`  WebSocket Listen: ${config.wsListenHost}:${config.wsListenPort}`);
  console.log(`  WebSocket Eviction Age: ${config.wsEvictionAge}s`);
  console.log(`  WebSocket Idle Timeout: ${config.wsIdleTimeout}s`);
}
