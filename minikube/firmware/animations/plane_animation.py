# Plane Animation with Rotation (Heavily Optimized)
# Inlined all operations, no Vec3 objects, native compilation
# Auto mode supports two styles:
#   - "scramble": LED position scrambling effect (default, matches original JS)
#   - "color": Hue cycling through color spectrum (like sphere animation)

import micropython
from animation_base import Animation
from fast_math import fast_sin, fast_cos
from hash_utils import hash_led_id
from color_hsv import hsv_to_rgb


class PlaneAnimation(Animation):
    """
    Animated rotating plane with scramble effect - heavily optimized.
    """

    def __init__(self, coords, current_time):
        super().__init__(coords, current_time)

        # Store coords for scramble effect
        self.coords = coords
        self.num_leds = len(coords)

        # Pre-compute scramble lookup tables for performance
        # This avoids calling hash_led_id() twice per LED per frame
        self.foreign_ids = [0] * self.num_leds
        self.swap_thresholds_int = [0] * self.num_leds

        for led_id in range(self.num_leds):
            # Pre-compute foreign LED ID
            self.foreign_ids[led_id] = hash_led_id(led_id) % self.num_leds
            # Pre-compute swap threshold as integer (0-999) for faster comparison
            self.swap_thresholds_int[led_id] = hash_led_id(led_id, 123) % 1000

        # Auto mode enabled by default
        self.auto_mode = True

        # Auto mode style: "scramble" or "color"
        self.auto_mode_style = "color"  # Change to "color" for hue cycling

        # Scramble auto mode parameters (matching JS defaults)
        self.hold_duration = 15.0       # Hold time in seconds
        self.transition_duration = 60.0  # Transition time in seconds

        # Pre-compute timing parameters in milliseconds for integer math
        self.hold_duration_ms = int(self.hold_duration * 1000)
        self.transition_duration_ms = int(self.transition_duration * 1000)
        self.total_cycle_time_ms = self.hold_duration_ms + self.transition_duration_ms

        # Color cycle auto mode parameters (matching sphere defaults)
        self.hue_cycle_duration = 180.0  # Seconds for full hue cycle
        self.auto_saturation = 0.95
        self.auto_brightness = 1.0

        # Rotation parameters (radians per second) - negated for inverse rotation
        self.rotation_speed_x = 0.9
        self.rotation_speed_z = -1.9

        # Edge smoothness
        self.edge_smoothness = 0.05

        # Front color (light blue) - constant in auto mode
        self.front_r = 0.75
        self.front_g = 0.75
        self.front_b = 1.0

        # Back color (black)
        self.back_r = 0.0
        self.back_g = 0.0
        self.back_b = 0.0

    @micropython.native
    def get_color(self, x, y, z, t, led_id):
        """
        Calculate color - with scramble effect for auto mode.
        """
        # Cache self properties
        auto_mode = self.auto_mode
        auto_mode_style = self.auto_mode_style
        speed_x = self.rotation_speed_x
        speed_z = self.rotation_speed_z
        edge = self.edge_smoothness
        back_r = self.back_r
        back_g = self.back_g
        back_b = self.back_b

        # Determine front color based on auto mode
        if auto_mode and auto_mode_style == "color":
            # Color cycle mode: hue cycling like sphere animation
            current_hue = (t / self.hue_cycle_duration) % 1.0
            front_r, front_g, front_b = hsv_to_rgb(current_hue, self.auto_saturation, self.auto_brightness)
        else:
            # Use base front color (light blue)
            front_r = self.front_r
            front_g = self.front_g
            front_b = self.front_b

        # Calculate scramble strength for scramble auto mode (using integer math)
        scramble_strength_int = 0
        if auto_mode and auto_mode_style == "scramble":
            # Convert time to milliseconds for integer math
            t_ms = int(t * 1000)

            # Calculate cycle timing in integer milliseconds
            cycle_time_ms = t_ms % self.total_cycle_time_ms
            is_transitioning = cycle_time_ms >= self.hold_duration_ms

            # Which cycle are we in?
            current_cycle = t_ms // self.total_cycle_time_ms
            transition_up = (current_cycle % 2) == 0

            if is_transitioning:
                # During transition: calculate strength as integer 0-1000
                elapsed_transition_ms = cycle_time_ms - self.hold_duration_ms
                scramble_strength_int = (elapsed_transition_ms * 1000) // self.transition_duration_ms
                if not transition_up:
                    # 1000 → 0
                    scramble_strength_int = 1000 - scramble_strength_int
            else:
                # During hold: stay at extreme values
                scramble_strength_int = 0 if transition_up else 1000

        # Apply scramble effect: binary swap between true and foreign positions
        final_x = x
        final_y = y
        final_z = z

        if scramble_strength_int > 0:
            # Use pre-computed foreign LED ID (avoids hash call)
            foreign_id = self.foreign_ids[led_id]
            foreign_coord = self.coords[foreign_id]

            if foreign_coord is not None:
                # Integer comparison (scramble_strength_int is 0-1000)
                uses_foreign = scramble_strength_int > self.swap_thresholds_int[led_id]

                if uses_foreign:
                    # Use foreign position
                    final_x, final_y, final_z = foreign_coord

        # Center coordinates to [-0.5, 0.5]
        px = final_x - 0.5
        py = final_y - 0.5
        pz = final_z - 0.5

        # Calculate rotation angles
        rot_x = speed_x * t
        rot_z = speed_z * t

        # Inline rotation around X axis (using fast trig)
        cos_x = fast_cos(rot_x)
        sin_x = fast_sin(rot_x)
        ry = py * cos_x - pz * sin_x
        # rz = py * sin_x + pz * cos_x  # Not used - commented out for performance

        # Inline rotation around Z axis (using fast trig)
        cos_z = fast_cos(rot_z)
        sin_z = fast_sin(rot_z)
        # rx = px * cos_z - ry * sin_z  # Not used - commented out for performance
        ry = px * sin_z + ry * cos_z

        # Inline sdf_plane: just the Y coordinate of rotated position
        sdf_value = ry

        # Inline sdf2side: smoothstep conversion
        if sdf_value < -edge:
            front_side = 1.0
        elif sdf_value > edge:
            front_side = 0.0
        else:
            # Smoothstep calculation inlined
            t_val = (sdf_value + edge) / (edge * 2.0)
            t_smooth = t_val * t_val * (3.0 - 2.0 * t_val)
            front_side = 1.0 - t_smooth

        # Mix front and back colors
        r = front_r * front_side + back_r * (1.0 - front_side)
        g = front_g * front_side + back_g * (1.0 - front_side)
        b = front_b * front_side + back_b * (1.0 - front_side)

        return (r, g, b)
