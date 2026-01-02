# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

"""
MicroPython program for ESP32-C3 LED test device
- Button (boot button) on GPIO 9 (pull-up, active low)
- WS2812 LED string on GPIO 20
- 4 built-in LEDs + 200 external LEDs = 204 total
- Operates from USB power bank with low brightness levels
"""

import machine
import neopixel
import time

# Configuration
BUTTON_PIN = 9
LED_PIN = 20
NUM_LEDS = 204  # 4 built-in + 200 external
BUILTIN_LEDS = 4
EXTERNAL_START = 4
EXTERNAL_END = 203
BRIGHTNESS = 10  # Low brightness to save power (0-255)
FRAME_TIME = 10  # ms per frame (100 Hz)

# Initialize hardware
button = machine.Pin(BUTTON_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
np = neopixel.NeoPixel(machine.Pin(LED_PIN), NUM_LEDS)

# Color constants (RGB) at low brightness
def scale_color(r, g, b):
    return (r * BRIGHTNESS // 255, g * BRIGHTNESS // 255, b * BRIGHTNESS // 255)

RED = scale_color(255, 0, 0)
GREEN = scale_color(0, 255, 0)
BLUE = scale_color(0, 0, 255)
CYAN = scale_color(0, 255, 255)
MAGENTA = scale_color(255, 0, 255)
YELLOW = scale_color(255, 255, 0)
WHITE = scale_color(255, 255, 255)
BLACK = (0, 0, 0)

COLOR_SEQUENCE_SHORT = [RED, GREEN, BLUE]
COLOR_SEQUENCE_BW = [RED, GREEN, BLUE, CYAN, MAGENTA, YELLOW, WHITE, BLACK]
COLOR_SEQUENCE_LONG = [RED, GREEN, BLUE, CYAN, MAGENTA, YELLOW]

# HSV to RGB conversion
def hsv_to_rgb(h, s, v):
    """Convert HSV to RGB. h: 0-1, s: 0-1, v: 0-1. Returns (r, g, b) scaled by brightness."""
    if s == 0.0:
        rgb = (int(v * 255), int(v * 255), int(v * 255))
    else:
        i = int(h * 6.0)
        f = (h * 6.0) - i
        p = v * (1.0 - s)
        q = v * (1.0 - s * f)
        t = v * (1.0 - s * (1.0 - f))
        i = i % 6
        if i == 0:
            rgb = (v, t, p)
        elif i == 1:
            rgb = (q, v, p)
        elif i == 2:
            rgb = (p, v, t)
        elif i == 3:
            rgb = (p, q, v)
        elif i == 4:
            rgb = (t, p, v)
        else:
            rgb = (v, p, q)
        rgb = (int(rgb[0] * 255), int(rgb[1] * 255), int(rgb[2] * 255))

    # Apply brightness scaling
    return scale_color(rgb[0], rgb[1], rgb[2])

# Mode base class
class Mode:
    def __init__(self, current_time):
        """Initialize mode with current time"""
        pass

    def update(self, current_time):
        """Update LED state - must be implemented by subclasses"""
        raise NotImplementedError

class Mode1(Mode):
    """Mode 1: Cycle colors with first/last LED flashing"""
    def __init__(self, current_time):
        super().__init__(current_time)
        self.color_idx = 0
        self.flash_state = False
        self.last_color_change = current_time
        self.last_flash = current_time

    def update(self, current_time):
        # Color cycle every 250ms
        if time.ticks_diff(current_time, self.last_color_change) >= 500:
            color = COLOR_SEQUENCE_BW[self.color_idx]
            for i in range(EXTERNAL_START, EXTERNAL_END + 1):
                np[i] = color
            self.color_idx = (self.color_idx + 1) % len(COLOR_SEQUENCE_BW)
            self.last_color_change = current_time

        # Flash first and last LED alternating at 125ms
        if time.ticks_diff(current_time, self.last_flash) >= 250:
            if self.flash_state:
                np[EXTERNAL_START] = WHITE
                np[EXTERNAL_END] = BLACK
            else:
                np[EXTERNAL_START] = BLACK
                np[EXTERNAL_END] = WHITE
            self.flash_state = not self.flash_state
            self.last_flash = current_time

class Mode2(Mode):
    """Mode 2: Minimal blink - first and last LED red alternating"""
    def __init__(self, current_time):
        super().__init__(current_time)
        self.flash_state = False
        self.last_flash = current_time

    def update(self, current_time):
        # Flash first and last LED alternating at 125ms
        if time.ticks_diff(current_time, self.last_flash) >= 500:
            if self.flash_state:
                np[EXTERNAL_START] = RED
                np[EXTERNAL_END] = BLACK
            else:
                np[EXTERNAL_START] = BLACK
                np[EXTERNAL_END] = RED
            self.flash_state = not self.flash_state
            self.last_flash = current_time

class Mode3(Mode):
    """Mode 3: Chase - fill strip one LED at a time, cycling through colors"""
    def __init__(self, current_time):
        super().__init__(current_time)
        self.color_idx = 0
        self.led_idx = EXTERNAL_START
        self.last_update = current_time

    def update(self, current_time):
        # Update one LED every 10ms
        if time.ticks_diff(current_time, self.last_update) >= 10:
            color = COLOR_SEQUENCE_LONG[self.color_idx]
            np[self.led_idx] = color
            self.led_idx += 1

            # When we reach the end, start over with next color
            if self.led_idx > EXTERNAL_END:
                self.led_idx = EXTERNAL_START
                self.color_idx = (self.color_idx + 1) % len(COLOR_SEQUENCE_LONG)

            self.last_update = current_time

class Mode4(Mode):
    """Mode 4: Shifting rainbow - hue cycle repeated 3 times across strip"""
    def __init__(self, current_time):
        super().__init__(current_time)
        self.phase_offset = 0.0
        self.last_update = current_time
        self.num_repetitions = 3  # Number of rainbow cycles across the strip

    def update(self, current_time):
        # Update animation every 50ms
        if time.ticks_diff(current_time, self.last_update) >= 50:
            strip_length = EXTERNAL_END - EXTERNAL_START + 1

            for i in range(EXTERNAL_START, EXTERNAL_END + 1):
                led_position = i - EXTERNAL_START
                # Calculate hue based on position and phase offset
                hue = ((led_position / strip_length) * self.num_repetitions + self.phase_offset) % 1.0
                color = hsv_to_rgb(hue, 1.0, 1.0)
                np[i] = color

            # Increment phase to create shifting effect
            self.phase_offset = (self.phase_offset + 0.01) % 1.0
            self.last_update = current_time

def clear_all():
    """Turn off all LEDs"""
    for i in range(NUM_LEDS):
        np[i] = BLACK
    np.write()

def clear_external():
    """Turn off only external LEDs (preserve internal LEDs)"""
    for i in range(EXTERNAL_START, NUM_LEDS):
        np[i] = BLACK

def set_mode_indicator(mode):
    """Set internal LEDs to indicate current mode (1-4 LEDs lit)"""
    for i in range(BUILTIN_LEDS):
        if i < mode:
            np[i] = RED
        else:
            np[i] = BLACK

def main():
    print("LED Test Device Starting...")
    print("Press button to cycle through modes")
    print("Mode 1: Color cycle with flashing")
    print("Mode 2: Minimal blink")
    print("Mode 3: Chase")
    print("Mode 4: Shifting rainbow")

    clear_all()

    mode_number = 1
    mode_classes = [Mode1, Mode2, Mode3, Mode4]

    # Initialize with mode 1
    current_time = time.ticks_ms()
    current_mode = Mode1(current_time)

    last_button_state = 1
    button_press_time = 0

    set_mode_indicator(mode_number)
    print(f"Mode {mode_number}")

    while True:
        frame_start = time.ticks_ms()
        current_time = frame_start

        # Button handling with debouncing
        button_state = button.value()
        if button_state == 0 and last_button_state == 1:
            # Button pressed
            button_press_time = current_time
        elif button_state == 0 and last_button_state == 0:
            # Button held - check if debounce period passed
            if time.ticks_diff(current_time, button_press_time) >= 50:
                # Wait for release
                while button.value() == 0:
                    time.sleep_ms(10)

                # Switch mode
                mode_number = (mode_number % len(mode_classes)) + 1
                clear_all()

                # Create new mode instance
                current_mode = mode_classes[mode_number - 1](current_time)

                set_mode_indicator(mode_number)
                print(f"Mode {mode_number}")
                last_button_state = 1
                continue

        last_button_state = button_state

        # Update current mode
        current_mode.update(current_time)

        # Write to LEDs
        np.write()

        # Maintain fixed frame rate
        frame_time = time.ticks_diff(time.ticks_ms(), frame_start)
        if frame_time < FRAME_TIME:
            time.sleep_ms(FRAME_TIME - frame_time)

# Run the program
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nProgram stopped")
        clear_all()
