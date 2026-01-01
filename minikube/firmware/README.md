# Minikube Firmware

MicroPython firmware to drive the LEDs of the minikube (single WS2812 string) with an ESP32-C3. Different ESP models or other microcontrollers may also work, provided they are capable of running MicroPython and driving a WS2812 string.

## Wiring Electronics

1. **Connect LED strip:**
   - Either solder strip directly to ESP32 pads, or use a connector
   - LED strip 5V to ESP32 VBUS
   - LED strip GND to ESP32 GND
   - LED data input to ESP32 pin 20 (configurable in `config.py`)

2. **Optional level shifter:**
   - Insert 3.3V to 5V level shifter between ESP32 and LED data line
   - A small PCB with 4× WS2812 LEDs works well for this purpose ([AliExpress link](https://de.aliexpress.com/item/1005010216258357.html))
   - Not strictly necessary but improves signal integrity

4. **Power the ESP32:**
   - Connect ESP32 via USB

## Installation Instructions

### 1. Flash MicroPython

Download MicroPython firmware for ESP32-C3 from [micropython.org](https://micropython.org/download/ESP32_GENERIC_C3/) and flash it using esptool.

### 2. Configure Settings

Edit `config.py` to configure:
- GPIO pin numbers
- Number of LEDs
- Other hardware-specific settings (see comments in file)

### 3. Upload Firmware

Upload all files from this directory to the ESP32 using [mpremote](https://docs.micropython.org/en/latest/reference/mpremote.html):

```bash
mpremote connect /dev/ttyACM0 cp -r * :
```

### 4. Verify Operation

Monitor serial output to ensure everything runs correctly:

```bash
mpremote connect /dev/ttyACM0
```

### 5. Calibrate LED Positions

For the animations to look correct, the exact 3D position of each LED must be known:

1. Press the boot button on the ESP32 to cycle animations and bring up the calibration pattern (TODO: not yet implemented in firmware)
2. Capture calibration images/videos of the cube from different perspectives
3. Process the data and generate a LED calibration text file using the tools in `../../calibration/`
4. Upload the LED calibration results (positions) as `solution1.txt` to the ESP32:
   ```bash
   mpremote connect /dev/ttyACM0 cp solution1.txt :
   ```

After calibration, the volumetric animations will render correctly!

## Usage

- **Cycle animations:** Press the boot button of the ESP32
- **Modify animations:** Edit Python files in `animations/`
- **Create new animations:** Subclass `AnimationBase` and implement the `render()` method
- **Adjust speed/colors:** Modify parameters in the animation files

## Animation Framework

The firmware includes a simple animation framework:

- **`animation_base.py`** Base class for animations
- **`sdf_primitives.py`** Signed distance field primitives for 3D shapes
- **`math_utils.py`** Vector math, noise functions
- **`color_utils.py`** Color manipulation and conversion
- **`coordinate_loader.py`** Loads LED positions from calibration file

Example animations included:
- **`plane_animation.py`** Animated plane sweeping through the cube
- **`sphere_animation.py`** Pulsing sphere effect

## License

Firmware is licensed under MIT
