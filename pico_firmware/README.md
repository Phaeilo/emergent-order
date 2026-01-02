# Pico Firmware - WS2812 Proxy

Multi-channel USB-to-WS2812 bridge. Receives RGB pixel data via USB serial and drives 8 independent WS2812 LED channels with hardware acceleration.

## Features

- **8 independent WS2812 channels** (GPIO 8-15) via PIO hardware
- **Up to 200 LEDs per channel** @ 60Hz refresh rate
- **Gamma correction** (γ=2.8, configurable)
- **Automatic current limiting** with per-channel brightness scaling
- **Hardware monitoring**: 2x NTC temperature sensors, INA226 current/voltage monitor
- **Channel fault detection**: 8x voltage feedback channels with trip detection
- **Built-in test patterns** (6 patterns, auto-activation after 5s timeout)
- **USB CDC serial** for high-speed data transfer (512-byte buffers)
- **Periodic status reports** (1Hz over serial)

## Serial Protocol

### Upstream (Host → Pico): LED Data Commands

All multi-byte values are little-endian.

| Command | Format | Description |
|---------|--------|-------------|
| `0xFF` | `[0xFF][CH][CNT_L][CNT_H][RGB...]` | Update channel and flush immediately |
| `0xFE` | `[0xFE][CH][CNT_L][CNT_H][RGB...]` | Update channel buffer only (no flush) |
| `0xFD` | `[0xFD][MASK]` | Flush selected channels (8-bit mask) |
| `0xFC` | `[0xFC]` | Reset Pico |
| `0xFB` | `[0xFB][PATTERN_ID]` | Start test pattern (0-5) |
| `0xFA` | `[0xFA]` | Stop test pattern |
| `0xF9` | `[0xF9]` | Clear all LEDs (black + flush) |

- `CH`: Channel ID (0-7)
- `CNT_L/CNT_H`: LED count (16-bit, little-endian)
- `RGB...`: RGB triplets (R, G, B bytes per LED)
- `MASK`: Channel mask (bit 0=ch0, bit 1=ch1, etc.)

### Downstream (Pico → Host): Status Messages

Status reports sent every 1 second:

```
STATS up=<uptime> cmd=<commands> pix=<pixels> flush=<flushes> err=<errors> t0=<temp0> t1=<temp1> v=<voltage> i=<current> fb=<fb_mask> trip=<trips> lim=<limits> mode=<mode>
```

**Fields:**
- `up`: Uptime (seconds)
- `cmd`: Total commands received
- `pix`: Total pixels processed
- `flush`: Total flush operations
- `err`: Error count
- `t0/t1`: Temperature (°C) from NTC sensors
- `v`: Bus voltage (V)
- `i`: Current draw (A)
- `fb`: Feedback mask (0xFF=all channels OK, bit cleared=channel tripped)
- `trip`: Total channel trip events
- `lim`: Total current limit events
- `mode`: System mode (0=normal, 1=test pattern)

**Fault notifications:**
```
Channel <ch> TRIPPED! (voltage: <v>V, threshold: <thresh>V)
Channel <ch> recovered (voltage: <v>V)
```

## Development Environment Setup

### Prerequisites

Install ARM GCC toolchain and CMake.

### Initialize Submodules

```bash
cd pico_firmware
git submodule update --init --recursive
```

This initializes:
- `pico-sdk/` - Raspberry Pi Pico SDK
- `picotool/` - Upload utility

### Build

```bash
./build.sh              # Incremental build
./build.sh --clean      # Clean build
```

Output: `build/wsproxy.uf2`

### Upload to Pico

**Method 1: USB bootloader (drag-and-drop)**
1. Hold BOOTSEL button while plugging in Pico
2. Copy `build/wsproxy.uf2` to the mounted drive

**Method 2: picotool (requires picotool installed)**

```bash
./build.sh --upload     # Build and upload via picotool
```

Or manually:
```bash
picotool load -f -x build/wsproxy.uf2
```

## Python Client (`ws_ctrl.py`)

CLI tool for controlling the WS2812 proxy. Can also be imported as a library (see source for API).

### Usage

```bash
# Test patterns
./ws_ctrl.py -p /dev/ttyACM0 pattern --start 0
./ws_ctrl.py -p /dev/ttyACM0 pattern --stop

# Set all LEDs to a color
./ws_ctrl.py -p /dev/ttyACM0 color 255 0 0           # Red, all channels
./ws_ctrl.py -p /dev/ttyACM0 color 0 255 0 -c 0,1,2  # Green, channels 0-2

# Clear and reset
./ws_ctrl.py -p /dev/ttyACM0 clear
./ws_ctrl.py -p /dev/ttyACM0 reset
```

## Hardware Configuration

### WS2812 Outputs (8 channels)
- GPIO 8-15 → CTRL_0 to CTRL_7 (WS2812 strings 0-7)

### User Interface
- GPIO 2 → LED_0 (primary status LED)
- GPIO 3 → LED_1 (secondary status LED)
- GPIO 6 → BTN_0 (primary button, active low)
- GPIO 7 → BTN_1 (secondary button, active low)

### Monitoring & Sensors
- GPIO 26 (ADC0) → NTC_0 (primary temperature sensor)
- GPIO 27 (ADC1) → NTC_1 (secondary temperature sensor)
- GPIO 28 (ADC2) → FB_M (feedback multiplexer output)
- GPIO 20-22 → FB_S0, FB_S1, FB_S2 (feedback multiplexer address)

### I2C Bus
- GPIO 4 → SDA (INA226 current sensor + optional display header)
- GPIO 5 → SCL

### SD Card (SPI)
- GPIO 16 → SD_DO
- GPIO 17 → SD_CS
- GPIO 18 → SD_CLK
- GPIO 19 → SD_DI

### UART
- GPIO 0 → UART0_TX
- GPIO 1 → UART0_RX

## License

MIT License
