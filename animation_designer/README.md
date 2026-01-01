# LED Cube Animation Designer

A web-based tool for creating, testing, and live-streaming animations to the LED cube.
It was used to prepare content for the installation, but also used during the installation to 
stream "live" content to the cube.

## Features

### Visual Editor
- **3D Preview**: Real-time visualization of your animations in an interactive 3D viewport
- **Parameter Controls**: Auto-generated UI controls for all animation parameters
- **Preset Management**: Save and load your favorite parameter configurations

### Code Editor
- Live JavaScript editor with error display
- Same format as the [animations/](../animations/) directory scripts
- Supports full parameter system with types, ranges, and grouping

### Live Streaming
- **WLED Integration**: Connect directly to WLED devices via WebSocket
- **Dual Protocols**: Support for WLED JSON and binary protocols
- **Adjustable FPS**: Stream at 20-120 FPS
- **Coordinate Import**: Load actual LED positions for accurate preview

### Distribution Modes
- **Grid**: Regular 3D grid distribution
- **Random**: Random point cloud
- **Import**: Use actual LED coordinates from the physical cube

## Getting Started

### Local Use

1. Open `index.html` in a web browser
2. Write your animation code in the editor (or load an existing script)
3. Click **Run** (or press `Ctrl+Enter`) to start the animation
4. Adjust parameters in real-time using the generated controls

### Connecting to Hardware

1. Enter your WLED device IP address (e.g., `192.168.1.100`)
2. Select protocol and FPS
3. Click **Connect**
4. Run your animation - it will stream to the physical cube!

## Animation Format

See the [animations README](../animations/README.md) for the script format. Quick overview:

```javascript
const params = {
    myGroup: {
        group: 'My Parameters',
        speed: { type: 'float', name: 'Speed', min: 0.0, max: 5.0, default: 1.0 },
        color: { type: 'color', name: 'Color', default: [1.0, 0.0, 0.0] }
    }
};

function getSphereColor(x, y, z, t, params, id) {
    // x, y, z: LED position (0.0 to 1.0)
    // t: time in seconds
    // params: your parameter values
    // id: LED index
    // Return: [r, g, b] color (0.0 to 1.0)

    return [1.0, 0.0, 0.0]; // Your logic here!
}
```

## Tips

- Use `Ctrl+Enter` to run, `Ctrl+.` to stop
- Start with simple effects and build complexity gradually
- Check the console for JavaScript errors
- Use the default script (`default_script.js`) as a reference
- Parameter changes apply immediately - no need to restart

## Files

- `index.html` - Main application page
- `script.js` - Application logic and 3D rendering
- `style.css` - UI styling
- `default_script.js` - Example animation
- `convert_coords.py` - Utility for converting LED coordinate formats

## License

Designer tool is licensed under MIT
