import { performance } from 'perf_hooks';

/**
 * High-Resolution Performance Timer
 * Provides precise frame timing for target FPS
 */
class HighResPerfTimer {
  constructor(fps) {
    this.fps = fps;
    this.frameTime = 1000 / fps; // milliseconds per frame
    this.nextFrameTime = 0;
  }

  /**
   * Wait for next frame time (minimum 1ms to yield to event loop)
   */
  async waitForNextFrame() {
    const now = performance.now();
    const waitTime = Math.max(1, this.nextFrameTime - now);

    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Schedule next frame
    this.nextFrameTime = performance.now() + this.frameTime;
  }

  /**
   * Reset timer
   */
  reset() {
    this.nextFrameTime = performance.now() + this.frameTime;
  }
}

/**
 * Animation Engine
 * Main render loop - calls getSphereColor for each LED at target FPS
 */
export class AnimationEngine {
  constructor(config, serialConn, coordLoader) {
    this.config = config;
    this.serialConn = serialConn;
    this.coordLoader = coordLoader;

    this.animationFunc = null;
    this.animationParams = {};

    this.running = false;
    this.startTime = 0;
    this.frameCount = 0;
    this.lastStatsTime = 0;

    this.paused = false;
    this.wasRunning = false;

    // Pre-allocate flat frame buffer (all channels sequential)
    // Layout: [ch0_led0_r, ch0_led0_g, ch0_led0_b, ch0_led1_r, ...]
    this.frameBuffer = new Uint8ClampedArray(this.config.totalLeds * 3);
  }

  /**
   * Set current animation function and parameters
   * @param {Function} animationFunc - getSphereColor function
   * @param {Object} params - Parameter values
   */
  setAnimation(animationFunc, params) {
    this.animationFunc = animationFunc;
    this.animationParams = params || {};
    console.log('Animation set successfully');
  }

  /**
   * Start render loop
   */
  async start() {
    if (this.running) {
      console.warn('Animation engine already running');
      return;
    }

    if (!this.animationFunc) {
      throw new Error('No animation loaded');
    }

    console.log(`Starting render loop at ${this.config.fps} FPS`);

    this.running = true;
    this.startTime = performance.now();
    this.frameCount = 0;
    this.lastStatsTime = Date.now();

    const timer = new HighResPerfTimer(this.config.fps);

    while (this.running) {
      const frameStart = performance.now();

      try {
        await this.renderFrame();
      } catch (err) {
        console.error('Frame render error:', err.message);
      }

      await timer.waitForNextFrame();

      this.frameCount++;

      // Optional frame stats logging
      if (this.config.logFrameStats) {
        const now = Date.now();
        if (now - this.lastStatsTime >= this.config.frameStatsInterval * 1000) {
          const elapsed = (now - this.lastStatsTime) / 1000;
          const fps = this.frameCount / elapsed;
          const frameDuration = performance.now() - frameStart;
          console.log(`Frame stats: ${fps.toFixed(2)} FPS (avg frame: ${frameDuration.toFixed(2)}ms)`);
          this.frameCount = 0;
          this.lastStatsTime = now;
        }
      }
    }

    console.log('Render loop stopped');
  }

  /**
   * Stop render loop
   */
  stop() {
    console.log('Stopping animation engine');
    this.running = false;
  }

  /**
   * Pause render loop (for WebSocket takeover)
   */
  pause() {
    if (this.paused) return;
    console.log('Pausing animation engine');
    this.paused = true;
    this.wasRunning = this.running;
    if (this.running) {
      this.running = false;
    }
    // Clear all LEDs when pausing
    this.serialConn.clearAll();
  }

  /**
   * Resume render loop (after WebSocket disconnect)
   */
  resume() {
    if (!this.paused) return;
    console.log('Resuming animation engine');
    this.paused = false;
    if (this.wasRunning) {
      this.start();
    }
  }

  /**
   * Render a single frame
   * Calls getSphereColor for each LED and sends to serial
   */
  async renderFrame() {
    // Calculate time in seconds since start
    const t = (performance.now() - this.startTime) / 1000;

    // Reset all LEDs to black
    this.frameBuffer.fill(0);

    // Render each LED
    for (let ledId = 0; ledId < this.config.totalLeds; ledId++) {
      const coords = this.coordLoader.getCoordinate(ledId);

      // If no coordinates, LED stays black (already set above)
      if (!coords) continue;

      try {
        const [x, y, z] = coords;

        // Call animation function
        const result = this.animationFunc(x, y, z, t, this.animationParams, ledId);

        // Validate result
        if (!Array.isArray(result) || result.length < 3) {
          throw new Error(`Invalid return value: ${JSON.stringify(result)}`);
        }

        const [r, g, b] = result;

        // Write RGB to flat buffer (Uint8ClampedArray auto-clamps to 0-255)
        const offset = ledId * 3;
        this.frameBuffer[offset] = r * 255;
        this.frameBuffer[offset + 1] = g * 255;
        this.frameBuffer[offset + 2] = b * 255;

      } catch (err) {
        // Log error but continue rendering other LEDs
        if (this.frameCount % 300 === 0) { // Log every 10 seconds at 30 FPS
          console.error(`Animation error for LED ${ledId}:`, err.message);
        }
        // LED stays black on error (already set above)
      }
    }

    // Send all channels to serial (buffered)
    for (let ch = 0; ch < this.config.numChannels; ch++) {
      const offset = ch * this.config.ledsPerChannel * 3;
      const length = this.config.ledsPerChannel;
      this.serialConn.sendFrameFlat(ch, this.frameBuffer, offset, length);
    }

    // Flush all channels at once
    this.serialConn.flush(0xFF); // All 8 bits set = flush all channels
  }

  /**
   * Get current animation statistics
   * @returns {Object} Stats
   */
  getStats() {
    const uptime = (performance.now() - this.startTime) / 1000;
    return {
      running: this.running,
      uptime,
      frameCount: this.frameCount,
      fps: this.frameCount / uptime,
    };
  }
}
