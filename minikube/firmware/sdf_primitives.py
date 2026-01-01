# SDF (Signed Distance Field) Primitives
# Ported from JavaScript animation scripts
# SDF returns distance to surface: negative inside, zero on surface, positive outside

import math
from math_utils import smoothstep


def sdf_sphere(pos, radius):
    """
    Signed distance to sphere centered at origin.

    Args:
        pos: Vec3 position
        radius: Sphere radius

    Returns:
        Distance to sphere surface (negative = inside)
    """
    return pos.length - radius


def sdf_plane(pos):
    """
    Signed distance to XZ plane at origin with normal pointing +Y.

    Args:
        pos: Vec3 position

    Returns:
        Distance to plane (negative = below, positive = above)
    """
    return pos.y


def sdf_cylinder_x(pos, radius):
    """
    Signed distance to infinite cylinder along X axis.

    Args:
        pos: Vec3 position
        radius: Cylinder radius

    Returns:
        Distance to cylinder surface
    """
    return math.sqrt(pos.y * pos.y + pos.z * pos.z) - radius


def sdf_cylinder_y(pos, radius):
    """
    Signed distance to infinite cylinder along Y axis.

    Args:
        pos: Vec3 position
        radius: Cylinder radius

    Returns:
        Distance to cylinder surface
    """
    return math.sqrt(pos.x * pos.x + pos.z * pos.z) - radius


def sdf_cylinder_z(pos, radius):
    """
    Signed distance to infinite cylinder along Z axis.

    Args:
        pos: Vec3 position
        radius: Cylinder radius

    Returns:
        Distance to cylinder surface
    """
    return math.sqrt(pos.x * pos.x + pos.y * pos.y) - radius


def sdf_cross(pos, radius):
    """
    Signed distance to cross shape (union of three perpendicular cylinders).

    Args:
        pos: Vec3 position
        radius: Cylinder radius

    Returns:
        Distance to closest cylinder surface
    """
    dx = sdf_cylinder_x(pos, radius)
    dy = sdf_cylinder_y(pos, radius)
    dz = sdf_cylinder_z(pos, radius)
    return min(dx, min(dy, dz))


def sdf2bri(sdf_value, ease=0.0):
    """
    Convert SDF value to brightness.
    Inside/on surface = bright (1.0), outside = dark (0.0).

    Args:
        sdf_value: Signed distance value
        ease: Smoothness of transition (0 = hard edge, >0 = soft edge)

    Returns:
        Brightness value (0.0 to 1.0)
    """
    if ease == 0.0:
        # Hard edge
        return 1.0 if sdf_value <= 0.0 else 0.0

    # Soft edge using smoothstep
    return 1.0 - smoothstep(-ease, ease, sdf_value)


def sdf2side(sdf_value, ease=0.0):
    """
    Convert SDF value to side indicator.
    Negative side (inside) = 1.0, positive side (outside) = 0.0.

    Args:
        sdf_value: Signed distance value
        ease: Smoothness of transition (0 = hard edge, >0 = soft edge)

    Returns:
        Side value (0.0 to 1.0)
    """
    if ease == 0.0:
        # Hard edge
        return 1.0 if sdf_value <= 0.0 else 0.0

    # Soft edge using smoothstep
    return 1.0 - smoothstep(-ease, ease, sdf_value)
