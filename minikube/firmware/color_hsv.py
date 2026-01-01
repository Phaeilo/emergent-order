# HSV to RGB conversion for auto mode color cycling
# Optimized for MicroPython

import micropython

@micropython.native
def hsv_to_rgb(h, s, v):
    """
    Convert HSV to RGB.

    Args:
        h: Hue (0.0 to 1.0)
        s: Saturation (0.0 to 1.0)
        v: Value/Brightness (0.0 to 1.0+)

    Returns:
        (r, g, b) tuple (0.0 to 1.0+)
    """
    # Wrap hue to [0, 1) range
    h = h - int(h)
    if h < 0.0:
        h += 1.0

    c = v * s
    x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0))
    m = v - c

    # Determine which sector of the color wheel
    h6 = h * 6.0

    if h6 < 1.0:
        r, g, b = c, x, 0.0
    elif h6 < 2.0:
        r, g, b = x, c, 0.0
    elif h6 < 3.0:
        r, g, b = 0.0, c, x
    elif h6 < 4.0:
        r, g, b = 0.0, x, c
    elif h6 < 5.0:
        r, g, b = x, 0.0, c
    else:
        r, g, b = c, 0.0, x

    return (r + m, g + m, b + m)
