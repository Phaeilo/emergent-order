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

- **`controller_pcb/`** - KiCad project for the custom controller PCB that interfaces the Raspberry Pi 4 with the Raspberry Pi Pico and provides power distribution for the LED strings.

- **`pico_firmware/`** - C firmware for the Raspberry Pi Pico that receives LED data over USB serial and outputs WS2812B protocol data using PIO state machines.

- **`mechanical/`** - 3D printable parts (base, corners, combs, controller mounts) and carbon fiber tube specifications for building the physical cube structure. See [mechanical/README.md](mechanical/README.md) for details.

### Software & Control

- **`showrunner/`** - Node.js service that runs on the Raspberry Pi, manages animation playback, streams LED data to the Pico firmware via USB serial, and provides WebSocket interface.

- **`animations/`** - JavaScript animation scripts that generate LED patterns using 3D math (SDF primitives, planes, spheres, fire effects, etc.). See [animations/README.md](animations/README.md) for examples and animation format.

- **`animation_designer/`** - Web-based tool for designing and previewing animations before deploying them to the cube. See [animation_designer/README.md](animation_designer/README.md) for usage instructions.

### Calibration & Utilities

- **`calibration/`** - Python tools and web interface for detecting and mapping the 3D coordinates of each LED in the physical cube using computer vision.

- **`ws2serial/`** - Python utility for testing and interfacing with WS2812 LED strips over USB serial during development. Provides a WebSocket-to-serial adapter allowing the animation designer web tool to stream pixel data over the network to the Pico controller. See [ws2serial/README.md](ws2serial/README.md) for details.

- **`testdevice/`** - MicroPython code for ESP32-C3 to quickly test single LED strings during installation and teardown. See [testdevice/README.md](testdevice/README.md) for details.

### Prototypes

- **`minikube/`** - Smaller ~20×20×20cm prototype cube with MicroPython firmware and mechanical designs for ESP32-C3. See [minikube/README.md](minikube/README.md) for details.

## Technical Specifications

- **Physical size:** 1×1×1 meter cube
- **LEDs:** 1200 individually addressable WS2812B LEDs
- **Structure:** Carbon fiber tubes (20×18mm) with 3D printed corner connectors
- **Controller:** Raspberry Pi 4 + Raspberry Pi Pico
- **Power:** Custom PCB with power distribution for LED strings
- **Software:** Node.js showrunner + JavaScript animation framework
- **Communication:** USB serial (Pi 4 → Pico), PIO-based WS2812B output, WebSocket interface for live animation streaming

## Development Approach

Most of the code in this project was synthesized ("vibe coded") using various Anthropic Claude models. The goal was to rapidly prototype and get something working, so the code may not be well understood in all places or may contain bugs. However, key decisions about architecture, algorithms and artistic content were provided by humans, just not manually implemented line-by-line.

## License

See the license files in individual directories or license text in source files.

In general:
- **Code/Software:** MIT License
- **3D Models:** CC-BY 4.0
- **PCB Designs:** CERN-OHL-W (CERN Open Hardware License - Weakly Reciprocal)

## Contributing

This project was created for 39c3. Feel free to fork, modify, and create your own versions. If you build something based on this work, we'd love to hear about it!
