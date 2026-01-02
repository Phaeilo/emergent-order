# Showrunner

Node.js service that plays LED animations on the cube, streaming frames at 30-60 FPS over serial to the Raspberry Pi Pico firmware.

**Features:**
- Loads LED coordinates from calibration files
- Executes animation JavaScript
- Binary serial protocol compatible with Pico firmware
- Hot-swappable animations at runtime
- WebSocket server for live animation streaming (interrupts scheduled content)
- Status file with health data from service and Pico (for external monitoring)

## Installation

```bash
npm install
```

## Configuration

Configure via environment variables (see `.env.example` for all options):

**Required:**
- `LED_COORDS_FILE` - Path to LED coordinate calibration file
- `ANIMATION_DIR` - Directory containing animation JavaScript files

**Optional:**
- `INITIAL_ANIMATION` - Starting animation filename (default: `simple_sphere_script.js`)
- `FPS` - Target frame rate (default: `30`)
- `SERIAL_PORT_BASE` - Serial port base path (default: `/dev/ttyACM`)
- `ANIMATION_CONTROL_FILE` - File to watch for animation switching (default: `/var/run/led_animation`)
- `STATUS_FILE` - Status/health data output file (default: `/var/run/led_status.json`)
- `WS_LISTEN` - WebSocket server listen address (default: `127.0.0.1:8080`)
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: `info`)

## Running

```bash
npm start
```

To switch animations at runtime, write the animation filename to the control file:

```bash
echo "simple_sphere_script.js" > /var/run/led_animation
```

## License

MIT License
