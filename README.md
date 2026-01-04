# /dev/emergent_order

An experiment in chaos and structure, presented at 39c3 (39th Chaos Communication Congress).

A 1×1×1m LED cube art installation filled with 1200 individually addressable WS2812B LEDs, creating a volumetric 3D display.

![Assembled LED cube](cube.jpg)

## Overview

This repository contains most materials involved in creating the LED cube installation: software, firmware, animations, 3D mechanical parts, PCB designs, calibration tools, and documentation. The aim is to document the complete structure of the cube and make relevant tools and designs available to others who want to build their own version, learn from the project, create derivative works, or apply these concepts in entirely new ways.

## Project Structure

This repository contains the following subdirectories:

**Note:** Some directories mentioned below may not yet be available in the repository. We are actively uploading the remaining materials and expect to have everything published within the next few days.

### Hardware & Electronics

- **`controller_pcb/`** - KiCad project for a high-performance 8-channel WS2812 controller based on the Raspberry Pi Pico. Features include USB streaming mode, standalone operation with built-in test patterns, SD card playback, comprehensive monitoring (voltage, current, temperature), and per-channel smart fuse protection (3.7A). Supports up to 200 LEDs per channel at 60Hz. See [controller_pcb/README.md](controller_pcb/README.md) for complete specifications.

- **`pico_firmware/`** - C firmware for the Raspberry Pi Pico that drives 8 independent WS2812B channels via PIO hardware. Features gamma correction, automatic current limiting, hardware monitoring (temperature, current, voltage), channel fault detection, and built-in test patterns including a ternary-encoded calibration pattern for camera-based position recovery. See [pico_firmware/README.md](pico_firmware/README.md) for protocol specification and development setup.

- **`mechanical/`** - 3D printable parts (base, corners, combs, controller mounts) and carbon fiber tube specifications for building the physical cube structure. See [mechanical/README.md](mechanical/README.md) for details.

### Software & Control

- **`showrunner/`** - Node.js service that plays LED animations on the cube, streaming frames at 30-60 FPS over serial to the Pico firmware. Supports hot-swappable animations and WebSocket interface for live streaming. See [showrunner/README.md](showrunner/README.md) for details.

- **`animations/`** - JavaScript animation scripts that generate LED patterns using 3D math (SDF primitives, planes, spheres, fire effects, etc.). See [animations/README.md](animations/README.md) for examples and animation format.

- **`animation_designer/`** - Web-based tool for designing and previewing animations before deploying them to the cube. See [animation_designer/README.md](animation_designer/README.md) for usage instructions.

### Calibration & Utilities

- **`calibration/`** - Tools for recovering 3D LED positions from video captures of the cube. Includes video frame extraction, LED detection with ternary color-coded identification, and multi-camera 3D triangulation with bundle adjustment. Features both Python CLI tools and a web-based detector with real-time visualization. See [calibration/README.md](calibration/README.md) for complete workflow and encoding scheme documentation.

- **`ws2serial/`** - Python utility for testing and interfacing with WS2812 LED strips over USB serial during development. Provides a WebSocket-to-serial adapter allowing the animation designer web tool to stream pixel data over the network to the Pico controller. See [ws2serial/README.md](ws2serial/README.md) for details.

- **`testdevice/`** - MicroPython code for ESP32-C3 to quickly test single LED strings during installation and teardown. See [testdevice/README.md](testdevice/README.md) for details.

### Prototypes

- **`minikube/`** - Smaller ~20×20×20cm prototype cube with MicroPython firmware and mechanical designs for ESP32-C3. See [minikube/README.md](minikube/README.md) for details.

## Technical Specifications

- **Physical size:** 1×1×1 meter cube
- **LEDs:** 1200 individually addressable WS2812B LEDs
- **Structure:** Carbon fiber tubes (20×18mm) with 3D printed corner connectors
- **Controller:** Raspberry Pi Pico-based 8-channel controller (can be driven by Raspberry Pi 3 or run standalone)
- **Power:** Custom 4-layer PCB with 8-channel power distribution, smart fuse protection (3.7A per channel), and comprehensive monitoring
- **Software:** Node.js showrunner + JavaScript animation framework (USB streaming), or standalone test patterns
- **Communication:** USB serial (Pi 3 → Pico), PIO-based WS2812B output, WebSocket interface for live animation streaming

## Development Approach

Most of the code in this project was synthesized ("vibe coded") using various Anthropic Claude models. The goal was to rapidly prototype and get something working, so the code may not be well understood in all places or may contain bugs. However, key decisions about architecture, algorithms and artistic content were provided by humans, just not manually implemented line-by-line.

## Related Works

Others have explored similar concepts in volumetric LED displays and spatial calibration:

- **Matt Parker's Christmas Tree (2020):** Matt Parker from the YouTube channel "Stand-up Maths" set up his Christmas tree with 500 LED lights in December 2020 and calculated their positions in 3D space. His well-made and educational video documenting the process: [I wired my tree with 500 LED lights and calculated their 3D coordinates.](https://www.youtube.com/watch?v=TvlpIojusBE)

- **Birk Schmithuesen's SpeculativeAI Series (2019-2022):** Artist Birk Schmithuesen created a sphere installation filled with 160 meters of LED strips comprising 9600 pixels. Through calibration work by Felix Bonowski, volumetric content was rendered on this sphere. The project is extensively documented at [birkschmithuesen.com/_speculativeAI](https://www.birkschmithuesen.com/_speculativeAI)

## License

See the license files in individual directories or license text in source files.

In general:
- **Code/Software:** MIT License
- **3D Models:** CC-BY 4.0
- **PCB Designs:** CERN-OHL-W (CERN Open Hardware License - Weakly Reciprocal)

## Contributing

This project was created for 39c3. Feel free to fork, modify, and create your own versions. If you build something based on this work, we'd love to hear about it!
