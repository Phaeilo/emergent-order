# Fast Math Utilities - Optimized for MicroPython
# Uses lookup tables and native compilation

import math
import micropython

# Precompute sin/cos lookup table (256 entries for 0-2π)
_TABLE_SIZE = 256
_TABLE_SCALE = _TABLE_SIZE / (2 * math.pi)
_sin_table = [math.sin(i * 2 * math.pi / _TABLE_SIZE) for i in range(_TABLE_SIZE)]

@micropython.native
def fast_sin(x):
    """
    Fast sine approximation using lookup table.
    Compiled to native code for maximum speed.

    Args:
        x: Angle in radians

    Returns:
        Approximate sin(x)
    """
    # Normalize to [0, 2π) and map to table index
    # Using modulo and direct calculation
    x = x % 6.28318531  # 2*pi
    index = int(x * 40.7436654)  # TABLE_SIZE / (2*pi) precalculated
    if index >= 256:
        index = 255

    return _sin_table[index]


@micropython.native
def fast_cos(x):
    """Fast cosine using sin table (cos = sin(x + π/2))"""
    return fast_sin(x + 1.57079633)  # π/2 precalculated


def fast_length(x, y, z):
    """
    Fast approximate length/magnitude of 3D vector.
    Uses integer approximation for speed.

    Args:
        x, y, z: Vector components

    Returns:
        Approximate sqrt(x^2 + y^2 + z^2)
    """
    # For small vectors, use exact calculation
    # For performance, could use integer approximation instead
    return math.sqrt(x * x + y * y + z * z)


def lerp(a, b, t):
    """
    Linear interpolation (optimized).

    Args:
        a, b: Values to interpolate between
        t: Interpolation factor (0.0 to 1.0)

    Returns:
        a + (b - a) * t
    """
    return a + (b - a) * t


def clamp(value, min_val, max_val):
    """Clamp value to range [min_val, max_val]"""
    if value < min_val:
        return min_val
    if value > max_val:
        return max_val
    return value


def smoothstep(edge0, edge1, x):
    """
    Smooth interpolation with easing.
    Faster than using multiple operations.
    """
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# Precomputed constants
PI = 3.14159265
TWO_PI = 6.28318531
HALF_PI = 1.57079633
