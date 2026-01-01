# Sphere Animation with Wobble Distortion (Heavily Optimized)
# Inlined all operations, no Vec3 objects, native compilation

import micropython
from animation_base import Animation
from fast_math import fast_sin
from color_hsv import hsv_to_rgb


class SphereAnimation(Animation):
    """
    Animated sphere with wobble distortion effect.
    Heavily optimized with inlined operations.
    """

    def __init__(self, coords, current_time):
        super().__init__(coords, current_time)

        # Auto mode enabled by default
        self.auto_mode = True

        # Auto mode parameters (matching JS defaults)
        self.hue_cycle_duration = 180.0  # Seconds for full hue cycle
        self.auto_saturation = 0.95
        self.auto_brightness = 1.0

        # Sphere parameters
        self.radius = 0.4
        self.edge_smoothness = 0.05

        # Wobble parameters
        self.wobble_intensity = 1.0
        self.wobble_speed = 1.6
        self.wobble_scale = 0.2

        # Base foreground color (orange) - used when auto mode is off
        self.fg_r = 1.0
        self.fg_g = 0.5
        self.fg_b = 0.0

    @micropython.native
    def get_color(self, x, y, z, t, led_id):
        """
        Calculate color - matches original JS implementation.
        """
        # Cache self properties
        auto_mode = self.auto_mode
        radius = self.radius
        edge = self.edge_smoothness
        wobble_scale = self.wobble_scale
        wobble_speed = self.wobble_speed

        # Auto mode: override foreground color with hue cycling
        if auto_mode:
            # Calculate current hue based on time and cycle duration
            # Hue cycles from 0.0 to 1.0 over hue_cycle_duration seconds
            current_hue = (t / self.hue_cycle_duration) % 1.0

            # Convert HSV to RGB for the foreground color
            fg_r, fg_g, fg_b = hsv_to_rgb(current_hue, self.auto_saturation, self.auto_brightness)
        else:
            # Use base foreground color
            fg_r = self.fg_r
            fg_g = self.fg_g
            fg_b = self.fg_b

        # Center coordinates to [-0.5, 0.5]
        px = x - 0.5
        py = y - 0.5
        pz = z - 0.5

        # Inline wobble distortion (no Vec3, no function calls)
        anim_time = t * wobble_speed
        px += wobble_scale * fast_sin(px * 10.0 + anim_time * 2.0)
        py += wobble_scale * fast_sin(py * 8.5 + anim_time * 1.7)
        pz += wobble_scale * fast_sin(pz * 9.2 + anim_time * 1.5)

        # Inline sphere SDF: length(pos) - radius
        dist_sq = px * px + py * py + pz * pz

        # Fast sqrt
        if dist_sq < 0.0001:
            dist = 0.0
        else:
            dist = dist_sq ** 0.5

        sdf = dist - radius

        # Inline sdf2bri: smoothstep conversion
        if sdf < -edge:
            brightness = 1.0
        elif sdf > edge:
            brightness = 0.0
        else:
            # Smoothstep calculation inlined
            t_val = (sdf + edge) / (edge * 2.0)
            t_smooth = t_val * t_val * (3.0 - 2.0 * t_val)
            brightness = 1.0 - t_smooth

        # Return color (bg is black, so just multiply)
        return (fg_r * brightness, fg_g * brightness, fg_b * brightness)
