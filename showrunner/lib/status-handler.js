import { writeFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Status Handler
 * Parses UART status messages and writes to a single JSON file
 */
export class StatusHandler {
  constructor(config, serialConn) {
    this.config = config;
    this.statusFile = config.statusFile;
    this.lastStatus = null;

    // Listen for serial messages
    serialConn.on('message', (line) => this.handleMessage(line));
  }

  /**
   * Handle incoming serial message
   * @param {string} line - Message line from serial
   */
  async handleMessage(line) {
    if (!line) return;

    // Check if this is a status message
    if (line.startsWith('STATS')) {
      const status = this.parseStatusMessage(line);
      if (status) {
        await this.writeStatusFile(status);
      }
    } else {
      // Log other messages with [PICO] prefix
      console.log('[PICO]', line);
    }
  }

  /**
   * Parse status message
   * Format: STATS up=X cmd=Y pix=Z fps=A buff=B ...
   * @param {string} line - Status line
   * @returns {Object|null} Parsed status object
   */
  parseStatusMessage(line) {
    const matches = line.match(/STATS\s+(.+)/);
    if (!matches) return null;

    const parts = matches[1].split(/\s+/);
    const status = {
      timestamp: Date.now(),
      raw: line,
    };

    for (const part of parts) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) continue;

      const key = part.substring(0, eqIndex);
      const value = part.substring(eqIndex + 1);

      // Try to parse as number, otherwise keep as string
      const numValue = parseFloat(value);
      status[key] = isNaN(numValue) ? value : numValue;
    }

    return status;
  }

  /**
   * Write status to file (overwrites each time)
   * @param {Object} status - Parsed status object
   */
  async writeStatusFile(status) {
    this.lastStatus = status;

    // Add ISO timestamp to status object
    status.timestamp_iso = new Date(status.timestamp).toISOString();

    try {
      // Write JSON to file (overwrites previous content)
      const content = JSON.stringify(status, null, 2);
      await writeFile(this.statusFile, content, 'utf-8');

      // Log if debug enabled
      if (this.config.logLevel === 'debug') {
        console.log(`Status written to ${this.statusFile}`);
      }

    } catch (err) {
      console.error('Failed to write status file:', err.message);
    }
  }

  /**
   * Get last received status
   * @returns {Object|null} Last status object
   */
  getLastStatus() {
    return this.lastStatus;
  }
}
