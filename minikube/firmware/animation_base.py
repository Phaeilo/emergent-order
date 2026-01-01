# Base Animation Class
# Similar to Mode pattern in testdevice.py but adapted for 3D coordinate-based animations

import config
import micropython


class Animation:
    """
    Base class for all LED cube animations.
    Subclasses must implement get_color() method.
    """

    def __init__(self, coords, current_time):
        """
        Initialize animation.

        Args:
            coords: List of (x, y, z) tuples or None from coordinate_loader
            current_time: Starting time in milliseconds (from time.ticks_ms())
        """
        self.coords = coords
        self.start_time = current_time

    def get_color(self, x, y, z, t, led_id):
        """
        Compute color for a single LED.
        Must be implemented by subclasses.

        Args:
            x: Normalized X coordinate (0.0 to 1.0)
            y: Normalized Y coordinate (0.0 to 1.0)
            z: Normalized Z coordinate (0.0 to 1.0)
            t: Time in seconds since animation start
            led_id: LED index (0-73)

        Returns:
            (r, g, b) tuple with values 0.0 to 1.0
        """
        raise NotImplementedError("Subclasses must implement get_color()")

    @micropython.native
    def update(self, current_time, np):
        """
        Update all LEDs - optimized with native compilation and cached locals.
        """
        # Cache values in local variables for speed
        coords = self.coords
        start_time = self.start_time
        brightness = config.BRIGHTNESS
        external_start = config.EXTERNAL_START
        get_color = self.get_color
        np_len = len(np)

        # Calculate elapsed time in seconds
        t = (current_time - start_time) / 1000.0

        # Update all cube LEDs (coordinates are 0-indexed, offset for physical strip)
        for led_id in range(len(coords)):
            coord = coords[led_id]

            # Handle missing coordinates - skip
            if coord is None:
                continue

            # Get normalized coordinates
            x, y, z = coord

            # Get color from subclass implementation
            try:
                r, g, b = get_color(x, y, z, t, led_id)

                # Clamp to valid range
                if r < 0.0:
                    r = 0.0
                elif r > 1.0:
                    r = 1.0
                if g < 0.0:
                    g = 0.0
                elif g > 1.0:
                    g = 1.0
                if b < 0.0:
                    b = 0.0
                elif b > 1.0:
                    b = 1.0

                # Convert to 0-255 range and apply brightness in one step
                r_scaled = int(r * brightness)
                g_scaled = int(g * brightness)
                b_scaled = int(b * brightness)

                # Write to physical LED strip with offset for built-in LEDs
                physical_led_id = led_id + external_start
                if physical_led_id < np_len:
                    np[physical_led_id] = (r_scaled, g_scaled, b_scaled)

            except:
                # On error, skip this LED silently
                pass
