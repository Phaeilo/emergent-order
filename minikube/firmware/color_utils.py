# Color Manipulation Utilities
# HSV conversion, color mixing, brightness scaling

def hsv_to_rgb(h, s, v):
    """
    Convert HSV color to RGB.
    MicroPython compatible implementation.

    Args:
        h: Hue (0.0 to 1.0)
        s: Saturation (0.0 to 1.0)
        v: Value/Brightness (0.0 to 1.0)

    Returns:
        (r, g, b) tuple with values 0.0 to 1.0
    """
    # Achromatic (gray)
    if s == 0.0:
        return (v, v, v)

    h = h * 6.0  # Sector 0 to 5
    i = int(h)
    f = h - i    # Fractional part

    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))

    i = i % 6

    if i == 0:
        return (v, t, p)
    elif i == 1:
        return (q, v, p)
    elif i == 2:
        return (p, v, t)
    elif i == 3:
        return (p, q, v)
    elif i == 4:
        return (t, p, v)
    else:  # i == 5
        return (v, p, q)


def rgb_to_hsv(r, g, b):
    """
    Convert RGB color to HSV.

    Args:
        r: Red (0.0 to 1.0)
        g: Green (0.0 to 1.0)
        b: Blue (0.0 to 1.0)

    Returns:
        (h, s, v) tuple with values 0.0 to 1.0
    """
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    diff = max_c - min_c

    # Value
    v = max_c

    # Saturation
    if max_c == 0.0:
        s = 0.0
    else:
        s = diff / max_c

    # Hue
    if diff == 0.0:
        h = 0.0
    elif max_c == r:
        h = (60.0 * ((g - b) / diff) + 360.0) % 360.0
    elif max_c == g:
        h = (60.0 * ((b - r) / diff) + 120.0) % 360.0
    else:  # max_c == b
        h = (60.0 * ((r - g) / diff) + 240.0) % 360.0

    h = h / 360.0  # Normalize to 0-1

    return (h, s, v)


def mix_colors(color1, color2, t):
    """
    Linear interpolation between two RGB colors.

    Args:
        color1: (r, g, b) tuple (0.0 to 1.0)
        color2: (r, g, b) tuple (0.0 to 1.0)
        t: Blend factor (0.0 = color1, 1.0 = color2)

    Returns:
        (r, g, b) tuple with values 0.0 to 1.0
    """
    r = color1[0] * (1.0 - t) + color2[0] * t
    g = color1[1] * (1.0 - t) + color2[1] * t
    b = color1[2] * (1.0 - t) + color2[2] * t
    return (r, g, b)


def scale_color_brightness(r, g, b, brightness):
    """
    Scale RGB values by brightness factor.

    Args:
        r: Red (0-255)
        g: Green (0-255)
        b: Blue (0-255)
        brightness: Brightness scale (0-255)

    Returns:
        (r, g, b) tuple with scaled values (0-255)
    """
    return (
        r * brightness // 255,
        g * brightness // 255,
        b * brightness // 255
    )


def clamp_rgb(r, g, b):
    """
    Clamp RGB values to valid 0-255 range.

    Args:
        r, g, b: Color values (may be out of range)

    Returns:
        (r, g, b) tuple clamped to 0-255
    """
    r = max(0, min(255, int(r)))
    g = max(0, min(255, int(g)))
    b = max(0, min(255, int(b)))
    return (r, g, b)
