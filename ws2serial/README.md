# WS2Serial

A WebSocket-to-serial bridge for development and testing of LED animations. During development, the animation_designer web app needs to send animation data to the Raspberry Pi Pico (which drives the LED strips). Since the animation designer runs in a browser and uses WebSockets, this component provides a server that accepts WebSocket connections and forwards the data to the serial port connected to the Pico.

## Features

- **WebSocket server** - Accepts connections on port 8080 (configurable)
- **Serial bridge** - Bidirectional data flow between WebSocket and USB serial port
- **Connection management** - Single active connection with optional force-takeover support
- **Real-time statistics** - Reports message/byte rates for both directions every 3 seconds

## Usage

```bash
python main.py --serial /dev/ttyACM0 [--host 0.0.0.0] [--port 8080]
```

Connect via WebSocket at `ws://hostname:8080/ws` (add `?force=1` to take over existing connection).

## License

MIT License
