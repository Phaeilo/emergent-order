# LED Test Device

A MicroPython utility for quickly testing single WS2812B LED strings during installation and teardown. Runs on an ESP32-C3 microcontroller with a simple handheld setup, powered by a USB power bank for convenient field testing without external power supplies.

The device uses 4× WS2812B LEDs on a PCB connected directly to the ESP (before the strip) that serve as mode indicators and also act as a "hacky" level-shifter/signal-conditioner for the data stream. The test strip consists of 200 external LEDs (204 total including the indicator LEDs).

## Features

- **Color cycling** - Sequentially displays all colors to test each LED
- **First/last LED blinking** - Validates string completeness and correct length by alternating the first and last LEDs
- **Low brightness operation** - Configured for low power consumption to easily run from a power bank
- **Button-selectable test patterns**:
  - Mode 1: Color cycle with flashing first/last LEDs
  - Mode 2: Minimal blink (first and last LED alternating red)
  - Mode 3: Chase pattern filling the strip
  - Mode 4: Shifting rainbow animation
- **Visual mode indicator** - Built-in LEDs show current mode (1-4 LEDs lit)

## License

MIT License - See source file for full license text
