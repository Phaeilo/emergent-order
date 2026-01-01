# Coordinate Loader - Parse and normalize LED positions from solution1.txt
# Format: LED_0004 0.170590 -1.000000 -0.077250

import config

def load_coordinates(filename):
    """
    Load and normalize LED coordinates from file.

    Args:
        filename: Path to coordinates file (solution1.txt)

    Returns:
        List of (x, y, z) tuples normalized to [0.0, 1.0], or None for missing IDs
        Index in list corresponds to LED ID from file
    """
    raw_coords = []

    print(f"Loading coordinates from {filename}...")

    # Pass 1: Parse all coordinates and find max LED ID
    try:
        with open(filename, 'r') as f:
            for line in f:
                line = line.strip()

                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue

                # Only process LED lines
                if not line.startswith('LED_'):
                    continue

                parts = line.split()
                if len(parts) < 4:
                    continue

                # Extract LED ID from LED_0004 -> 4
                led_id_str = parts[0].split('_')[-1]
                led_id = int(led_id_str)

                # Parse coordinates
                x = float(parts[1])
                y = float(parts[2])
                z = float(parts[3])

                raw_coords.append((led_id, x, y, z))

    except OSError as e:
        print(f"Error loading coordinates: {e}")
        return []

    if not raw_coords:
        print("No LED coordinates found in file!")
        return []

    print(f"Loaded {len(raw_coords)} LED positions")

    # Find max LED ID to size the coordinate array
    max_led_id = max(led_id for led_id, _, _, _ in raw_coords)
    print(f"Max LED ID in file: {max_led_id}")

    # Initialize coordinate list sized for all LEDs in file
    coords = [None] * (max_led_id + 1)

    # Pass 2: Find bounding box
    xs = [c[1] for c in raw_coords]
    ys = [c[2] for c in raw_coords]
    zs = [c[3] for c in raw_coords]

    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    z_min, z_max = min(zs), max(zs)

    print(f"Bounding box:")
    print(f"  X: [{x_min:.3f}, {x_max:.3f}]")
    print(f"  Y: [{y_min:.3f}, {y_max:.3f}]")
    print(f"  Z: [{z_min:.3f}, {z_max:.3f}]")

    # Calculate ranges
    x_range = x_max - x_min
    y_range = y_max - y_min
    z_range = z_max - z_min

    # Pass 3: Normalize and store
    for led_id, x, y, z in raw_coords:
        # Normalize to [0.0, 1.0]
        # Handle zero range (all coordinates same) by defaulting to 0.5
        nx = (x - x_min) / x_range if x_range > 0 else 0.5
        ny = (y - y_min) / y_range if y_range > 0 else 0.5
        nz = (z - z_min) / z_range if z_range > 0 else 0.5

        coords[led_id] = (nx, ny, nz)

    # Count how many LEDs have coordinates
    loaded_count = sum(1 for c in coords if c is not None)
    print(f"Normalized {loaded_count} LED coordinates to [0.0, 1.0] range")

    return coords


def get_coordinate(coords, led_id):
    """
    Get normalized coordinate for a specific LED.

    Args:
        coords: List from load_coordinates()
        led_id: LED index (0-73)

    Returns:
        (x, y, z) tuple or None if LED has no coordinate
    """
    if led_id < 0 or led_id >= len(coords):
        return None
    return coords[led_id]
