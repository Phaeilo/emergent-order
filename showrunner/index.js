#!/usr/bin/env node
// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import { loadConfig, validateConfig, printConfig } from './lib/config.js';
import { SerialConnection } from './lib/serial.js';
import { CoordinateLoader } from './lib/coordinate-loader.js';
import { AnimationLoader } from './lib/animation-loader.js';
import { AnimationEngine } from './lib/animation-engine.js';
import { AnimationSwitcher } from './lib/animation-switcher.js';
import { StatusHandler } from './lib/status-handler.js';
import { WebSocketServer } from './lib/websocket-server.js';
import { resolve } from 'path';

/**
 * LED Cube Showrunner
 * Main entry point
 */
async function main() {
  console.log('=== LED Cube Showrunner ===');
  console.log('Starting...\n');

  let config, serialConn, engine, switcher, wsServer;

  try {
    // 1. Load and validate configuration
    console.log('[1/7] Loading configuration...');
    config = loadConfig();
    await validateConfig(config);
    printConfig(config);
    console.log();

    // 2. Load LED coordinates
    console.log('[2/7] Loading LED coordinates...');
    const coordLoader = new CoordinateLoader(config.ledCoordsFile);
    await coordLoader.load();
    console.log();

    // 3. Connect to serial port
    console.log('[3/7] Connecting to serial port...');
    serialConn = new SerialConnection(config);
    await serialConn.connect();
    console.log();

    // 4. Setup status handler
    console.log('[4/7] Setting up status handler...');
    const statusHandler = new StatusHandler(config, serialConn);
    console.log('Status handler ready\n');

    // 5. Load initial animation
    console.log('[5/7] Loading initial animation...');
    const animationLoader = new AnimationLoader(coordLoader);
    const initialAnimPath = resolve(config.animationDir, config.initialAnimation);
    const initialAnim = await animationLoader.loadAnimation(initialAnimPath);
    console.log();

    // 6. Create animation engine
    console.log('[6/8] Initializing animation engine...');
    engine = new AnimationEngine(config, serialConn, coordLoader);
    engine.setAnimation(initialAnim.func, initialAnim.params);
    console.log('Animation engine ready\n');

    // 7. Initialize WebSocket server
    console.log('[7/8] Initializing WebSocket server...');
    wsServer = new WebSocketServer(config, serialConn, engine);
    await wsServer.start();
    console.log('WebSocket server ready\n');

    // 8. Start animation switcher
    console.log('[8/8] Starting animation switcher...');
    switcher = new AnimationSwitcher(config, engine, animationLoader);
    await switcher.start();
    console.log();

    // Setup graceful shutdown handlers
    setupShutdownHandlers(engine, serialConn, switcher, wsServer);

    // Start rendering
    console.log('=== Showrunner Active ===');
    console.log(`Rendering at ${config.fps} FPS with ${coordLoader.getLEDCount()} LEDs`);
    console.log(`Animation control: ${config.animationControlFile}`);
    console.log(`WebSocket listening: ws://${config.wsListenHost}:${config.wsListenPort}/ws`);
    console.log('Press Ctrl+C to stop\n');

    await engine.start();

  } catch (err) {
    console.error('\nFatal error:', err.message);
    if (config && config.logLevel === 'debug') {
      console.error(err.stack);
    }

    // Cleanup on error
    if (engine) engine.stop();
    if (serialConn) serialConn.close();
    if (switcher) await switcher.stop();
    if (wsServer) await wsServer.stop();

    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 * @param {AnimationEngine} engine - Animation engine
 * @param {SerialConnection} serial - Serial connection
 * @param {AnimationSwitcher} switcher - Animation switcher
 * @param {WebSocketServer} wsServer - WebSocket server
 */
function setupShutdownHandlers(engine, serial, switcher, wsServer) {
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    // Stop animation engine
    engine.stop();

    // Stop WebSocket server
    if (wsServer) {
      console.log('Stopping WebSocket server...');
      await wsServer.stop();
    }

    // Clear all LEDs
    console.log('Clearing LEDs...');
    await new Promise(resolve => {
      serial.clearAll();
      setTimeout(resolve, 100); // Give time for clear command to send
    });

    // Stop animation switcher
    if (switcher) {
      await switcher.stop();
    }

    // Close serial connection
    serial.close();

    console.log('Shutdown complete');
    process.exit(0);
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM (systemd stop)
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Exit immediately on serial disconnect (systemd will restart)
  serial.on('disconnect', () => {
    console.error('\n!!! Serial port disconnected !!!');
    console.error('Exiting immediately (systemd will restart service)');
    process.exit(1);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('\nUncaught exception:', err.message);
    console.error(err.stack);
    console.error('Exiting...');

    engine.stop();
    serial.close();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('\nUnhandled promise rejection:', reason);
    console.error('Exiting...');

    engine.stop();
    serial.close();
    process.exit(1);
  });
}

// Run main function
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
