import chokidar from 'chokidar';
import { readFile, writeFile, access, constants } from 'fs/promises';
import { resolve } from 'path';

/**
 * Animation Switcher
 * Watches animation control file and hot-swaps animations at runtime
 */
export class AnimationSwitcher {
  constructor(config, animationEngine, animationLoader) {
    this.config = config;
    this.engine = animationEngine;
    this.loader = animationLoader;
    this.controlFile = config.animationControlFile;
    this.animationDir = config.animationDir;
    this.currentAnimation = null;
    this.watcher = null;
  }

  /**
   * Start watching the animation control file
   */
  async start() {
    console.log(`Watching ${this.controlFile} for animation changes`);

    // Ensure control file exists
    await this.ensureControlFileExists();

    // Setup file watcher
    this.watcher = chokidar.watch(this.controlFile, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
      ignoreInitial: false, // Trigger on initial file read
    });

    this.watcher.on('add', async (path) => {
      console.log(`Control file detected: ${path}`);
      await this.handleFileChange();
    });

    this.watcher.on('change', async (path) => {
      console.log(`Control file changed: ${path}`);
      await this.handleFileChange();
    });

    this.watcher.on('error', (err) => {
      console.error('File watcher error:', err.message);
    });
  }

  /**
   * Stop watching the control file
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      console.log('Animation switcher stopped');
    }
  }

  /**
   * Ensure control file exists, create if missing
   */
  async ensureControlFileExists() {
    try {
      await access(this.controlFile, constants.R_OK);
    } catch (err) {
      // File doesn't exist, create it with initial animation
      console.log(`Creating control file: ${this.controlFile}`);
      await writeFile(this.controlFile, this.config.initialAnimation, 'utf-8');
    }
  }

  /**
   * Handle control file change
   */
  async handleFileChange() {
    try {
      // Read animation name from file
      const content = await readFile(this.controlFile, 'utf-8');
      const animationName = content.trim();

      // Ignore empty file
      if (!animationName) {
        console.log('Control file is empty, ignoring');
        return;
      }

      // Ignore if same as current animation
      if (animationName === this.currentAnimation) {
        return;
      }

      console.log(`Switching to animation: ${animationName}`);
      await this.switchAnimation(animationName);

    } catch (err) {
      console.error('Error reading control file:', err.message);
    }
  }

  /**
   * Switch to a new animation
   * @param {string} animationName - Animation filename
   */
  async switchAnimation(animationName) {
    const scriptPath = resolve(this.animationDir, animationName);

    try {
      // Load new animation
      const animation = await this.loader.loadAnimation(scriptPath);

      // Set animation in engine
      this.engine.setAnimation(animation.func, animation.params);

      // Update current animation tracker
      this.currentAnimation = animationName;

      console.log(`Successfully switched to: ${animationName}`);

    } catch (err) {
      console.error(`Failed to load animation ${animationName}:`, err.message);
      console.error('Keeping current animation running');
      // Don't update this.currentAnimation, so we'll retry if the file changes again
    }
  }

  /**
   * Get current animation name
   * @returns {string} Current animation name
   */
  getCurrentAnimation() {
    return this.currentAnimation;
  }
}
