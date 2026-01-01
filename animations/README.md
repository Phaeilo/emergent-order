# LED Cube Animations

This directory contains animation scripts that were run on the LED cube during the installation at **39c3**. These serve as examples and inspiration for creating your own volumetric effects. Feel free to toy around with the parameters, modify existing animations, or create entirely new ones!

## Format

Each animation script exports:

- `params` - Configuration parameters organized into groups with types, ranges, and defaults
- `getSphereColor(x, y, z, t, params, id)` - Main rendering function that returns RGB color `[r, g, b]` for each LED

### Function Parameters

- `x, y, z` - LED position in normalized coordinates (0.0 to 1.0)
- `t` - Time in seconds since animation start
- `params` - User-configurable parameters
- `id` - LED index in the string

## Available Animations

### Basic Effects
- `blink_red.js` / `blink_green.js` / `blink_blue.js` - Simple color blinking with configurable count and speed

### 3D Effects
- `simple_fire_script.js` - Volumetric fire effect with Perlin noise turbulence
- `simple_sphere_script.js` - Distorted sphere with color gradients
- `simple_plane_script.js` - Monochromatic rotating plane that fades into and out of chaos
- `simple_cylinder_ring_script.js` - Colorful cylinders that rotate and also dissolbe into chaos
- `simple_chase_script.js` - Linear chase patterns with volumetric color

## Getting Started

Load these scripts into the animation designer and play around with parameters.
Alternatively, deploy them via the showrunner service.

## License

Animations are licensed under MIT
