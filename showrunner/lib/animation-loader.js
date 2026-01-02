import { readFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Animation Script Loader
 * Loads and executes animation JavaScript files (trusted code)
 */
export class AnimationLoader {
  constructor(coordinateLoader) {
    this.coordinateLoader = coordinateLoader;
  }

  /**
   * Load animation script from file
   * @param {string} scriptPath - Path to animation JS file
   * @returns {Object} {func, params} - getSphereColor function and parameters
   */
  async loadAnimation(scriptPath) {
    console.log(`Loading animation: ${scriptPath}`);

    // Read script file
    const scriptCode = await readFile(scriptPath, 'utf-8');

    // Execute script and extract function
    const { func, params } = this.executeScript(scriptCode, scriptPath);

    // Validate function
    this.validateAnimation(func);

    // Extract default parameter values
    const defaultParams = this.extractDefaultParams(params);

    console.log(`Successfully loaded animation from ${scriptPath}`);

    return {
      func,
      params: defaultParams,
      scriptPath,
    };
  }

  /**
   * Execute animation script and extract getSphereColor function
   * @param {string} scriptCode - JavaScript code
   * @param {string} scriptPath - Path for error messages
   * @returns {Object} {func, params}
   */
  executeScript(scriptCode, scriptPath) {
    // Create globals for animation scripts
    const animationGlobals = {
      // Provide Math object
      Math: Math,

      // Console with [ANIMATION] prefix
      console: {
        log: (...args) => console.log('[ANIMATION]', ...args),
        warn: (...args) => console.warn('[ANIMATION]', ...args),
        error: (...args) => console.error('[ANIMATION]', ...args),
      },

      // Inject getSphereCoords helper function
      getSphereCoords: (ledId) => {
        return this.coordinateLoader.getCoordinate(ledId);
      },
    };

    try {
      // Execute script in main context with provided globals
      const scriptFunc = new Function(
        'Math',
        'console',
        'getSphereCoords',
        scriptCode + '\nreturn { getSphereColor, params };'
      );

      const result = scriptFunc(
        animationGlobals.Math,
        animationGlobals.console,
        animationGlobals.getSphereCoords
      );

      if (!result.getSphereColor || typeof result.getSphereColor !== 'function') {
        throw new Error(`Animation script does not define getSphereColor function: ${scriptPath}`);
      }

      return {
        func: result.getSphereColor,
        params: result.params || {}
      };

    } catch (err) {
      throw new Error(`Failed to load animation script ${scriptPath}: ${err.message}`);
    }
  }

  /**
   * Validate that animation function has correct signature
   * @param {Function} func - getSphereColor function
   */
  validateAnimation(func) {
    if (typeof func !== 'function') {
      throw new Error('getSphereColor must be a function');
    }

    // Check function arity (should accept 6 parameters: x, y, z, t, params, id)
    if (func.length !== 6) {
      console.warn(`Warning: getSphereColor has ${func.length} parameters, expected 6 (x, y, z, t, params, id)`);
    }
  }

  /**
   * Extract default parameter values from params object
   * @param {Object} params - Params definition object
   * @returns {Object} Default parameter values
   */
  extractDefaultParams(params) {
    if (!params || typeof params !== 'object') {
      return {};
    }

    const defaults = {};

    // Iterate through param groups
    for (const [groupKey, groupValue] of Object.entries(params)) {
      if (typeof groupValue !== 'object') continue;

      // Iterate through parameters in group
      for (const [paramKey, paramDef] of Object.entries(groupValue)) {
        // Skip group metadata
        if (paramKey === 'group') continue;

        // Extract default value
        if (paramDef && typeof paramDef === 'object' && 'default' in paramDef) {
          defaults[paramKey] = paramDef.default;
        }
      }
    }

    return defaults;
  }

  /**
   * Create a safe animation wrapper that catches errors
   * @param {Function} animationFunc - Original getSphereColor function
   * @returns {Function} Wrapped function that catches errors
   */
  createSafeWrapper(animationFunc) {
    return (x, y, z, t, params, id) => {
      try {
        const result = animationFunc(x, y, z, t, params, id);

        // Validate return value
        if (!Array.isArray(result) || result.length < 3) {
          console.error(`Animation returned invalid value for LED ${id}:`, result);
          return [0, 0, 0];
        }

        return result;

      } catch (err) {
        console.error(`Animation error for LED ${id}:`, err.message);
        return [0, 0, 0]; // Return black on error
      }
    };
  }
}
