#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import time
import serial
import struct
import threading
import argparse

NUM_LEDS = 200*6
LEDS_PER_STRING = 200
NUM_STRINGS = 6


class WS2812Proxy:
    """Interface to WS2812 UART proxy on Pi Pico"""

    # Protocol commands
    CMD_UPDATE_AND_FLUSH = 0xFF
    CMD_UPDATE_ONLY = 0xFE
    CMD_FLUSH = 0xFD
    CMD_RESET = 0xFC
    CMD_START_PATTERN = 0xFB
    CMD_STOP_PATTERN = 0xFA
    CMD_CLEAR_ALL = 0xF9

    def __init__(self, port, baudrate=115200):
        """Initialize serial connection to Pi Pico

        Args:
            port: Serial port device (e.g., '/dev/ttyACM0')
            baudrate: UART baudrate (default: 115200)
        """
        self.ser = serial.Serial(port, baudrate, timeout=0.1,
                                write_timeout=None,  # Non-blocking writes
                                exclusive=True)
        # Increase write buffer for better throughput
        try:
            self.ser.set_buffer_size(rx_size=4096, tx_size=16384)
        except (AttributeError, NotImplementedError):
            pass  # Not all platforms support this
        #self.ser = SerMock()
        self.running = True
        self.buff = []

        # Start reader thread to display messages from Pico
        self.reader_thread = threading.Thread(target=self._read_messages, daemon=True)
        self.reader_thread.start()

        time.sleep(0.5)  # Wait for connection and initial messages

    def _read_messages(self):
        """Read and display messages from Pico (runs in background thread)"""
        while self.running:
            try:
                if self.ser.in_waiting:
                    line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        print(f"[PICO] {line}")
            except Exception:
                pass
            time.sleep(0.01)

    def send_frame(self, channel, rgb_data, auto_flush=False):
        """Send RGB data to a specific channel

        Args:
            channel: Channel ID (0-7)
            rgb_data: List of (R, G, B) tuples, each value 0-255
            auto_flush: If True, immediately update LEDs (default: True)
        """
        led_count = len(rgb_data)

        # Build packet
        packet = bytearray()
        packet.append(self.CMD_UPDATE_AND_FLUSH if auto_flush else self.CMD_UPDATE_ONLY)
        packet.append(channel)
        packet.extend(struct.pack('<H', led_count))  # Little-endian 16-bit LED count

        # Add RGB data for each LED
        for i, (r, g, b) in enumerate(rgb_data):
            # if channel == 7 and i != 164:
            #     r = g = b = 0
            packet.extend([r, g, b])

        # Send packet
        #print(f"[FRAME] {packet.hex()}")
        if auto_flush:
            self.ser.write(packet)
            self.ser.flush()
        else:
            self.buff.append(packet)

    def flush_channels(self, channel_mask):
        """Flush specific channels to LEDs

        Args:
            channel_mask: 8-bit mask (bit 0=ch0, bit 1=ch1, etc.)
        """
        packet = bytes([self.CMD_FLUSH, channel_mask])
        self.buff.append(packet)
        data = b"".join(self.buff)
        self.ser.write(data)
        # Don't flush - let OS buffer and send asynchronously for better throughput
        self.buff.clear()

    def reset(self):
        """Reset the Pico"""
        packet = bytes([self.CMD_RESET])
        self.ser.write(packet)
        self.ser.flush()

    def start_pattern(self, pattern_id):
        """Start a test pattern

        Args:
            pattern_id: Pattern number (0-3)
        """
        packet = bytes([self.CMD_START_PATTERN, pattern_id])
        self.ser.write(packet)
        self.ser.flush()

    def stop_pattern(self):
        """Stop test pattern and return to normal mode"""
        packet = bytes([self.CMD_STOP_PATTERN])
        self.ser.write(packet)
        self.ser.flush()

    def clear_all(self):
        """Clear all LEDs on all channels (set to black and flush)"""
        packet = bytes([self.CMD_CLEAR_ALL])
        self.ser.write(packet)
        self.ser.flush()

    def close(self):
        """Close serial connection"""
        self.running = False
        if self.reader_thread.is_alive():
            self.reader_thread.join(timeout=1)
        self.ser.close()


def main():
    """Command-line interface for WS2812 LED control"""
    parser = argparse.ArgumentParser(
        description='Control WS2812 LED strips via Pi Pico proxy',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('-p', '--port', required=True,
                        help='Serial port (e.g., /dev/ttyACM0)')
    parser.add_argument('-b', '--baudrate', type=int, default=115200,
                        help='Baudrate (default: 115200)')

    subparsers = parser.add_subparsers(dest='command', help='Command to execute')
    subparsers.required = True

    # Pattern commands
    pattern_parser = subparsers.add_parser('pattern', help='Control test patterns')
    pattern_group = pattern_parser.add_mutually_exclusive_group(required=True)
    pattern_group.add_argument('--start', type=int, metavar='ID',
                               help='Start pattern (0-3)')
    pattern_group.add_argument('--stop', action='store_true',
                               help='Stop current pattern')

    # Clear command
    subparsers.add_parser('clear', help='Clear all LEDs (set to black)')

    # Reset command
    subparsers.add_parser('reset', help='Reset the Pi Pico')

    # Set color command
    color_parser = subparsers.add_parser('color', help='Set all LEDs to a specific color')
    color_parser.add_argument('r', type=int, help='Red value (0-255)')
    color_parser.add_argument('g', type=int, help='Green value (0-255)')
    color_parser.add_argument('b', type=int, help='Blue value (0-255)')
    color_parser.add_argument('-c', '--channels', type=str, default='all',
                              help='Channels to update (e.g., "0,1,2" or "all", default: all)')

    args = parser.parse_args()

    # Connect to device
    print(f"Connecting to {args.port}...")
    proxy = WS2812Proxy(args.port, args.baudrate)

    try:
        if args.command == 'pattern':
            if args.start is not None:
                print(f"Starting pattern {args.start}...")
                proxy.start_pattern(args.start)
            elif args.stop:
                print("Stopping pattern...")
                proxy.stop_pattern()

        elif args.command == 'clear':
            print("Clearing all LEDs...")
            proxy.clear_all()

        elif args.command == 'reset':
            print("Resetting Pi Pico...")
            proxy.reset()

        elif args.command == 'color':
            # Validate RGB values
            if not (0 <= args.r <= 255 and 0 <= args.g <= 255 and 0 <= args.b <= 255):
                print("Error: RGB values must be between 0 and 255")
                return 1

            # Parse channel list
            if args.channels.lower() == 'all':
                channels = range(NUM_STRINGS)
            else:
                try:
                    channels = [int(c.strip()) for c in args.channels.split(',')]
                    if any(c < 0 or c >= NUM_STRINGS for c in channels):
                        print(f"Error: Channel numbers must be between 0 and {NUM_STRINGS-1}")
                        return 1
                except ValueError:
                    print("Error: Invalid channel format. Use comma-separated numbers or 'all'")
                    return 1

            print(f"Setting LEDs to RGB({args.r}, {args.g}, {args.b}) on channels {list(channels)}...")
            rgb_data = [(args.r, args.g, args.b)] * LEDS_PER_STRING

            for channel in channels:
                proxy.send_frame(channel, rgb_data, auto_flush=False)

            # Flush all updated channels
            channel_mask = sum(1 << c for c in channels)
            proxy.flush_channels(channel_mask)
            print("Done!")

        # Give time for messages to be displayed
        time.sleep(0.5)

    finally:
        proxy.close()

    return 0


if __name__ == '__main__':
    exit(main())
