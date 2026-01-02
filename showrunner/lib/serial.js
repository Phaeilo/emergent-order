import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { access, constants } from 'fs/promises';
import { EventEmitter } from 'events';

// Serial protocol commands (from 3d_demo_pico.py)
const CMD_UPDATE_AND_FLUSH = 0xFF;
const CMD_UPDATE_ONLY = 0xFE;
const CMD_FLUSH = 0xFD;
const CMD_RESET = 0xFC;
const CMD_START_PATTERN = 0xFB;
const CMD_STOP_PATTERN = 0xFA;
const CMD_CLEAR_ALL = 0xF9;

/**
 * Serial Connection Manager
 * Handles serial port communication with Pi Pico using binary protocol
 */
export class SerialConnection extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.port = null;
    this.portPath = null;
    this.parser = null;
  }

  /**
   * Auto-detect and connect to serial port
   * Tries /dev/ttyACM0, /dev/ttyACM1, etc.
   */
  async connect() {
    // Try to find available serial port
    const portPath = await this.detectSerialPort();
    this.portPath = portPath;

    console.log(`Connecting to serial port: ${portPath}`);

    // Open serial port
    this.port = new SerialPort({
      path: portPath,
      baudRate: this.config.serialBaudrate,
      autoOpen: false,
    });

    // Setup readline parser for status messages
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    this.parser.on('data', (line) => {
      this.emit('message', line.trim());
    });

    // Setup error handling
    this.port.on('error', (err) => {
      console.error('Serial port error:', err.message);
      this.emit('error', err);
    });

    this.port.on('close', () => {
      console.error('Serial port closed');
      this.emit('disconnect');
    });

    // Open the port
    await new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open serial port: ${err.message}`));
        } else {
          resolve();
        }
      });
    });

    console.log(`Connected to ${portPath} at ${this.config.serialBaudrate} baud`);
  }

  /**
   * Auto-detect first available serial port
   * @returns {string} Port path
   */
  async detectSerialPort() {
    const basePath = this.config.serialPortBase;

    // Try ttyACM0 through ttyACM9
    for (let i = 0; i < 10; i++) {
      const portPath = `${basePath}${i}`;
      try {
        await access(portPath, constants.R_OK | constants.W_OK);
        console.log(`Found serial port: ${portPath}`);
        return portPath;
      } catch (err) {
        // Port doesn't exist or not accessible, try next
        continue;
      }
    }

    throw new Error(`No serial port found (tried ${basePath}0 to ${basePath}9)`);
  }

  /**
   * Send frame data for one channel (buffered, no flush)
   * @param {number} channel - Channel number (0-7)
   * @param {Array} rgbData - Array of [r, g, b] tuples (0-255 each)
   */
  sendFrame(channel, rgbData) {
    const ledCount = rgbData.length;
    const packet = Buffer.alloc(4 + ledCount * 3);

    // Build packet: [CMD][CHANNEL][LED_COUNT_LOW][LED_COUNT_HIGH][RGB data...]
    packet[0] = CMD_UPDATE_ONLY; // 0xFE - buffer without flushing
    packet[1] = channel;
    packet[2] = ledCount & 0xFF; // Low byte
    packet[3] = (ledCount >> 8) & 0xFF; // High byte

    // Write RGB data
    let offset = 4;
    for (const [r, g, b] of rgbData) {
      packet[offset++] = Math.max(0, Math.min(255, Math.round(r)));
      packet[offset++] = Math.max(0, Math.min(255, Math.round(g)));
      packet[offset++] = Math.max(0, Math.min(255, Math.round(b)));
    }

    // Write to serial port
    this.write(packet);
  }

  /**
   * Send frame data from flat buffer (optimized, buffered, no flush)
   * @param {number} channel - Channel number (0-7)
   * @param {Uint8ClampedArray} flatBuffer - Flat RGB buffer
   * @param {number} offset - Byte offset into flatBuffer
   * @param {number} ledCount - Number of LEDs to send
   */
  sendFrameFlat(channel, flatBuffer, offset, ledCount) {
    const packet = Buffer.alloc(4 + ledCount * 3);

    // Build packet header
    packet[0] = CMD_UPDATE_ONLY; // 0xFE - buffer without flushing
    packet[1] = channel;
    packet[2] = ledCount & 0xFF; // Low byte
    packet[3] = (ledCount >> 8) & 0xFF; // High byte

    // Copy RGB data directly from flat buffer (already clamped 0-255)
    for (let i = 0; i < ledCount * 3; i++) {
      packet[4 + i] = flatBuffer[offset + i];
    }

    // Write to serial port
    this.write(packet);
  }

  /**
   * Flush specific channels to LEDs
   * @param {number} channelMask - 8-bit mask (bit 0 = channel 0, etc.)
   */
  flush(channelMask = 0xFF) {
    const packet = Buffer.from([CMD_FLUSH, channelMask]);
    this.write(packet);
  }

  /**
   * Clear all LEDs (set to black) and flush
   */
  clearAll() {
    const packet = Buffer.from([CMD_CLEAR_ALL]);
    this.write(packet);
  }

  /**
   * Reset the controller
   */
  reset() {
    const packet = Buffer.from([CMD_RESET]);
    this.write(packet);
  }

  /**
   * Start a test pattern
   * @param {number} patternId - Pattern ID (0-5)
   */
  startPattern(patternId) {
    const packet = Buffer.from([CMD_START_PATTERN, patternId]);
    this.write(packet);
  }

  /**
   * Stop test pattern
   */
  stopPattern() {
    const packet = Buffer.from([CMD_STOP_PATTERN]);
    this.write(packet);
  }

  /**
   * Write data to serial port
   * @param {Buffer} data - Data to write
   */
  write(data) {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    this.port.write(data, (err) => {
      if (err) {
        console.error('Write error:', err.message);
        this.emit('error', err);
      }
    });
  }

  /**
   * Get current port path
   * @returns {string} Port path
   */
  getPort() {
    return this.portPath;
  }

  /**
   * Close the serial port
   */
  close() {
    if (this.port && this.port.isOpen) {
      this.port.close((err) => {
        if (err) {
          console.error('Error closing port:', err.message);
        }
      });
    }
  }
}
