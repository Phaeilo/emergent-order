import { readFile } from 'fs/promises';

/**
 * LED Coordinate Loader
 * Parses LED coordinate files and normalizes coordinates to [0, 1] range
 */
export class CoordinateLoader {
  constructor(filePath) {
    this.filePath = filePath;
    this.coordinates = []; // Sparse array: ledId -> [x, y, z] or undefined
    this.rawCoordinates = []; // [{id, x, y, z}]
    this.ledCount = 0;
  }

  /**
   * Load and parse LED coordinate file
   */
  async load() {
    const content = await readFile(this.filePath, 'utf-8');
    const lines = content.split('\n');

    const rawCoords = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Only process lines starting with LED_
      if (!trimmed.startsWith('LED_')) {
        continue;
      }

      // Parse line: LED_<channel>_<id> x y z or LED_<id> x y z
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) {
        console.warn(`Skipping invalid line: ${line}`);
        continue;
      }

      const ledIdPart = parts[0];
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);

      // Extract LED ID from last underscore
      const lastUnderscoreIndex = ledIdPart.lastIndexOf('_');
      if (lastUnderscoreIndex === -1) {
        console.warn(`Invalid LED ID format: ${ledIdPart}`);
        continue;
      }

      const ledId = parseInt(ledIdPart.substring(lastUnderscoreIndex + 1), 10);

      if (isNaN(ledId) || isNaN(x) || isNaN(y) || isNaN(z)) {
        console.warn(`Invalid values in line: ${line}`);
        continue;
      }

      rawCoords.push({ id: ledId, x, y, z });
    }

    if (rawCoords.length === 0) {
      throw new Error('No valid LED coordinates found in file');
    }

    this.rawCoordinates = rawCoords;
    this.normalizeCoordinates();
    this.ledCount = rawCoords.length;

    console.log(`Loaded ${this.ledCount} LED coordinates from ${this.filePath}`);
  }

  /**
   * Normalize coordinates to [0.0, 1.0] range
   * Formula: normalized = (value - min) / (max - min)
   */
  normalizeCoordinates() {
    if (this.rawCoordinates.length === 0) {
      return;
    }

    // Find bounding box
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;

    for (const coord of this.rawCoordinates) {
      xMin = Math.min(xMin, coord.x);
      xMax = Math.max(xMax, coord.x);
      yMin = Math.min(yMin, coord.y);
      yMax = Math.max(yMax, coord.y);
      zMin = Math.min(zMin, coord.z);
      zMax = Math.max(zMax, coord.z);
    }

    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const zRange = zMax - zMin;

    // Normalize and store in sparse array
    for (const coord of this.rawCoordinates) {
      const normalizedX = xRange > 0 ? (coord.x - xMin) / xRange : 0.5;
      const normalizedY = yRange > 0 ? (coord.y - yMin) / yRange : 0.5;
      const normalizedZ = zRange > 0 ? (coord.z - zMin) / zRange : 0.5;

      this.coordinates[coord.id] = [normalizedX, normalizedY, normalizedZ];
    }

    console.log(`Normalized coordinates to [0, 1] range`);
    console.log(`  X range: [${xMin.toFixed(3)}, ${xMax.toFixed(3)}]`);
    console.log(`  Y range: [${yMin.toFixed(3)}, ${yMax.toFixed(3)}]`);
    console.log(`  Z range: [${zMin.toFixed(3)}, ${zMax.toFixed(3)}]`);
  }

  /**
   * Get normalized coordinate for a specific LED ID
   * @param {number} ledId - LED index (0 to N-1)
   * @returns {Array|null} [x, y, z] normalized coordinates or null if missing
   */
  getCoordinate(ledId) {
    return this.coordinates[ledId] || null;
  }

  /**
   * Get total number of LEDs with valid coordinates
   * @returns {number} LED count
   */
  getLEDCount() {
    return this.ledCount;
  }

  /**
   * Check if a LED has coordinates
   * @param {number} ledId - LED index
   * @returns {boolean} True if LED has coordinates
   */
  hasCoordinate(ledId) {
    return this.coordinates[ledId] !== undefined;
  }

  /**
   * Get all LED IDs that have coordinates
   * @returns {Array} Array of LED IDs
   */
  getAllLEDIds() {
    const ids = [];
    for (let i = 0; i < this.coordinates.length; i++) {
      if (this.coordinates[i] !== undefined) {
        ids.push(i);
      }
    }
    return ids;
  }
}
