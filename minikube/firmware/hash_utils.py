# Hash utilities for LED scrambling effect
# Matches the hashLedId function from JS

import micropython

@micropython.native
def hash_led_id(led_id, seed=42):
    """
    Deterministic hash function to map LED ID to another LED ID.
    Matches the JavaScript implementation.

    Args:
        led_id: LED index
        seed: Hash seed for variation

    Returns:
        Hashed value (positive integer)
    """
    # Simple multiplicative hash (matching JS)
    h = led_id * 2654435761 + seed
    h = ((h >> 16) ^ h) * 0x45d9f3b
    h = ((h >> 16) ^ h) * 0x45d9f3b
    h = (h >> 16) ^ h

    # Return absolute value
    if h < 0:
        return -h
    return h
