# Hardware Configuration for LED Cube
# Based on testdevice.py configuration adapted for 74-LED cube

# GPIO Configuration
BUTTON_PIN = 9           # Boot button (active low with pull-up)
LED_PIN = 20             # WS2812 data line

# LED Strip Configuration
EXTERNAL_START = 4       # Offset for external cube LEDs in strip (skips built-in LEDs)

# Brightness Configuration
BRIGHTNESS = 255          # Power-saving brightness (0-255)
                        # Low brightness reduces USB power bank load

# Timing Configuration
FRAME_TIME = 33          # Target 30 FPS (33ms per frame)
BUTTON_DEBOUNCE = 50     # 50ms debounce window for button presses
