# 3D Math Utilities for LED Cube Animations
# Lightweight implementations optimized for MicroPython

import math


class Vec3:
    """
    Lightweight 3D vector class with basic operations.
    Uses __slots__ for memory efficiency on MicroPython.
    """
    __slots__ = ['x', 'y', 'z']

    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = x
        self.y = y
        self.z = z

    @property
    def length(self):
        """Calculate vector magnitude"""
        return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)

    def add(self, v):
        """Vector addition - returns new Vec3"""
        return Vec3(self.x + v.x, self.y + v.y, self.z + v.z)

    def sub(self, v):
        """Vector subtraction - returns new Vec3"""
        return Vec3(self.x - v.x, self.y - v.y, self.z - v.z)

    def mul(self, s):
        """Scalar multiplication - returns new Vec3"""
        return Vec3(self.x * s, self.y * s, self.z * s)

    def __repr__(self):
        return f"Vec3({self.x:.3f}, {self.y:.3f}, {self.z:.3f})"


def smoothstep(edge0, edge1, x):
    """
    Smooth Hermite interpolation between 0 and 1.

    Args:
        edge0: Lower edge of transition
        edge1: Upper edge of transition
        x: Value to interpolate

    Returns:
        Smoothly interpolated value in [0, 1]
    """
    # Clamp x to [edge0, edge1]
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0

    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))

    # Hermite interpolation: 3t^2 - 2t^3
    return t * t * (3.0 - 2.0 * t)


def rotate_point(pos, rot_x, rot_y, rot_z):
    """
    Apply 3D rotation to a point around X, Y, Z axes (in that order).

    Args:
        pos: Vec3 position to rotate
        rot_x: Rotation around X axis in radians
        rot_y: Rotation around Y axis in radians
        rot_z: Rotation around Z axis in radians

    Returns:
        New Vec3 with rotated position
    """
    result = Vec3(pos.x, pos.y, pos.z)

    # Rotation around X axis
    if rot_x != 0:
        cos_x = math.cos(rot_x)
        sin_x = math.sin(rot_x)
        y = result.y * cos_x - result.z * sin_x
        z = result.y * sin_x + result.z * cos_x
        result = Vec3(result.x, y, z)

    # Rotation around Y axis
    if rot_y != 0:
        cos_y = math.cos(rot_y)
        sin_y = math.sin(rot_y)
        x = result.x * cos_y + result.z * sin_y
        z = -result.x * sin_y + result.z * cos_y
        result = Vec3(x, result.y, z)

    # Rotation around Z axis
    if rot_z != 0:
        cos_z = math.cos(rot_z)
        sin_z = math.sin(rot_z)
        x = result.x * cos_z - result.y * sin_z
        y = result.x * sin_z + result.y * cos_z
        result = Vec3(x, y, result.z)

    return result


def clamp(value, min_val, max_val):
    """
    Clamp value to range [min_val, max_val].

    Args:
        value: Value to clamp
        min_val: Minimum value
        max_val: Maximum value

    Returns:
        Clamped value
    """
    return max(min_val, min(max_val, value))
