# LED Cube Animation System - Main Application
# MicroPython for ESP32-C3
# Based on testdevice.py architecture adapted for 3D coordinate-based animations

import machine
import neopixel
import time
import config
from coordinate_loader import load_coordinates
from animations.sphere_animation import SphereAnimation
from animations.plane_animation import PlaneAnimation


def clear_all(np):
    """Clear all LEDs to black"""
    for i in range(len(np)):
        np[i] = (0, 0, 0)
    np.write()


def main():
    """Main application loop"""
    print("\n" + "="*50)
    print("LED Cube Animation System")
    print("="*50)
    print(f"Hardware: ESP32-C3")
    print(f"Target FPS: {1000 // config.FRAME_TIME}")
    print(f"Brightness: {config.BRIGHTNESS}/255")
    print("="*50 + "\n")

    # Load and normalize LED coordinates
    print("Loading LED coordinates...")
    coords = load_coordinates('solution1.txt')
    print()

    # Calculate total LEDs needed (cube LEDs + built-in offset)
    num_leds = len(coords) + config.EXTERNAL_START
    print(f"Total LEDs in strip: {num_leds}")
    print(f"  Built-in LEDs: 0-{config.EXTERNAL_START - 1}")
    print(f"  Cube LEDs: {config.EXTERNAL_START}-{num_leds - 1}")
    print()

    # Initialize hardware
    print("Initializing hardware...")
    button = machine.Pin(config.BUTTON_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
    np = neopixel.NeoPixel(machine.Pin(config.LED_PIN), num_leds)
    print(f"Button on GPIO {config.BUTTON_PIN}")
    print(f"LED strip on GPIO {config.LED_PIN}")
    print()

    # Define available animations
    animations = [
        ("Plane", PlaneAnimation),
        ("Sphere", SphereAnimation),
    ]

    print("Available animations:")
    for i, (name, _) in enumerate(animations, 1):
        print(f"  {i}. {name}")
    print()

    # Initialize first animation
    animation_idx = 0
    animation_name, AnimationClass = animations[animation_idx]
    current_time = time.ticks_ms()
    current_animation = AnimationClass(coords, current_time)

    print(f"Starting animation: {animation_name}")
    print("Press button to switch animations")
    print("="*50 + "\n")

    # Clear LEDs
    clear_all(np)

    # Button state tracking
    last_button_state = 1
    button_press_time = 0

    # Status tracking
    last_status_time = time.ticks_ms()
    frame_count = 0
    total_frame_time = 0

    # Main loop
    try:
        while True:
            frame_start = time.ticks_ms()
            current_time = frame_start

            # Button handling with debouncing (same as testdevice.py)
            button_state = button.value()

            if button_state == 0 and last_button_state == 1:
                # Button just pressed
                button_press_time = current_time

            elif button_state == 0 and last_button_state == 0:
                # Button held down - check if debounce time passed
                if time.ticks_diff(current_time, button_press_time) >= config.BUTTON_DEBOUNCE:
                    # Wait for button release
                    while button.value() == 0:
                        time.sleep_ms(10)

                    # Switch to next animation
                    animation_idx = (animation_idx + 1) % len(animations)
                    animation_name, AnimationClass = animations[animation_idx]

                    print(f"Switching to animation: {animation_name}")

                    # Clear LEDs
                    clear_all(np)

                    # Create new animation instance
                    current_animation = AnimationClass(coords, time.ticks_ms())

                    # Reset button state
                    last_button_state = 1
                    continue

            last_button_state = button_state

            # Update animation
            current_animation.update(current_time, np)

            # Write to LEDs
            np.write()

            # Frame rate limiting
            elapsed = time.ticks_diff(time.ticks_ms(), frame_start)
            if elapsed < config.FRAME_TIME:
                time.sleep_ms(config.FRAME_TIME - elapsed)

            # Track frame statistics
            frame_count += 1
            total_frame_time += elapsed

            # Print status every second
            status_elapsed = time.ticks_diff(current_time, last_status_time)
            if status_elapsed >= 1000:
                avg_frame_time = total_frame_time / frame_count if frame_count > 0 else 0
                actual_fps = frame_count / (status_elapsed / 1000.0)
                print(f"[{animation_name}] FPS: {actual_fps:.1f} | Avg frame: {avg_frame_time:.1f}ms | Frames: {frame_count}")

                # Reset counters
                last_status_time = current_time
                frame_count = 0
                total_frame_time = 0

    except KeyboardInterrupt:
        print("\n" + "="*50)
        print("Shutting down...")
        clear_all(np)
        print("LEDs cleared. Goodbye!")
        print("="*50)


if __name__ == "__main__":
    main()
