#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import asyncio
import argparse
from aiohttp import web, WSMsgType
import serial
from pathlib import Path
import time
import threading
import queue

current_ws = None
serial_port_path = None

class SerialThread:
    def __init__(self, port_path):
        self.port_path = port_path
        self.tx_queue = queue.Queue()
        self.rx_queue = asyncio.Queue()
        self.stop_event = threading.Event()
        self.write_thread = None
        self.read_thread = None
        self.serial_port = None

    def start(self):
        self.stop_event.clear()
        self.serial_port = serial.Serial(
            self.port_path,
            baudrate=115200,
            timeout=0.01,
            write_timeout=0,
            inter_byte_timeout=None
        )
        self.write_thread = threading.Thread(target=self._write_loop, daemon=True)
        self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
        self.write_thread.start()
        self.read_thread.start()

    def stop(self):
        self.stop_event.set()
        if self.write_thread:
            self.write_thread.join(timeout=1)
        if self.read_thread:
            self.read_thread.join(timeout=1)
        if self.serial_port:
            self.serial_port.close()

    def _write_loop(self):
        while not self.stop_event.is_set():
            try:
                data = self.tx_queue.get(timeout=0.001)
                self.serial_port.write(data)
                self.serial_port.flush()
            except queue.Empty:
                pass
            except Exception:
                break

    def _read_loop(self):
        while not self.stop_event.is_set():
            try:
                data = self.serial_port.read(1024)
                if data:
                    asyncio.run_coroutine_threadsafe(
                        self.rx_queue.put(data),
                        asyncio.get_event_loop()
                    )
            except Exception:
                break
            time.sleep(0.001)

    def write(self, data):
        self.tx_queue.put(data)

    async def read(self):
        return await self.rx_queue.get()

async def handle_websocket(request):
    global current_ws

    force = 'force' in request.query

    if current_ws is not None and not force:
        return web.Response(text='Serial port already in use', status=409)

    if current_ws is not None and force:
        print('[INFO] Force takeover requested, closing existing connection')
        await current_ws.close(code=1000, message=b'Connection taken over')
        current_ws = None

    ws = web.WebSocketResponse()
    await ws.prepare(request)
    current_ws = ws

    ws_to_serial_msgs = 0
    ws_to_serial_bytes = 0
    serial_to_ws_msgs = 0
    serial_to_ws_bytes = 0

    client_ip = request.remote
    print(f'[SESSION START] Client connected from {client_ip}')
    session_start = time.time()

    serial_thread = SerialThread(serial_port_path)
    serial_thread.start()

    try:
        async def serial_reader():
            nonlocal serial_to_ws_msgs, serial_to_ws_bytes
            while not ws.closed:
                try:
                    data = await asyncio.wait_for(serial_thread.read(), timeout=0.1)
                    await ws.send_bytes(data)
                    serial_to_ws_msgs += 1
                    serial_to_ws_bytes += len(data)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break

        async def stats_reporter():
            last_ws_msgs = 0
            last_ws_bytes = 0
            last_serial_msgs = 0
            last_serial_bytes = 0
            last_time = time.time()

            while not ws.closed:
                await asyncio.sleep(3)
                now = time.time()
                elapsed = now - last_time

                ws_msg_rate = (ws_to_serial_msgs - last_ws_msgs) / elapsed
                ws_byte_rate = (ws_to_serial_bytes - last_ws_bytes) / elapsed
                serial_msg_rate = (serial_to_ws_msgs - last_serial_msgs) / elapsed
                serial_byte_rate = (serial_to_ws_bytes - last_serial_bytes) / elapsed

                print(f'[STATS] WS→Serial: {ws_msg_rate:.1f} msg/s, {ws_byte_rate:.1f} B/s | Serial→WS: {serial_msg_rate:.1f} msg/s, {serial_byte_rate:.1f} B/s')

                last_ws_msgs = ws_to_serial_msgs
                last_ws_bytes = ws_to_serial_bytes
                last_serial_msgs = serial_to_ws_msgs
                last_serial_bytes = serial_to_ws_bytes
                last_time = now

        reader_task = asyncio.create_task(serial_reader())
        stats_task = asyncio.create_task(stats_reporter())

        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                serial_thread.write(msg.data)
                ws_to_serial_msgs += 1
                ws_to_serial_bytes += len(msg.data)
            elif msg.type == WSMsgType.ERROR:
                break

        reader_task.cancel()
        stats_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass
        try:
            await stats_task
        except asyncio.CancelledError:
            pass

    finally:
        serial_thread.stop()

        session_duration = time.time() - session_start
        print(f'[SESSION END] Duration: {session_duration:.1f}s | WS→Serial: {ws_to_serial_msgs} msgs, {ws_to_serial_bytes} bytes | Serial→WS: {serial_to_ws_msgs} msgs, {serial_to_ws_bytes} bytes')

        if current_ws == ws:
            current_ws = None

    return ws

async def handle_index(request):
    html_path = Path(__file__).parent / 'index.html'
    return web.FileResponse(html_path)

async def cors_middleware(app, handler):
    async def middleware_handler(request):
        if request.method == 'OPTIONS':
            response = web.Response()
        else:
            response = await handler(request)

        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = '*'
        return response
    return middleware_handler

def main():
    global serial_port_path

    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()

    serial_port_path = args.serial

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get('/', handle_index)
    app.router.add_get('/ws', handle_websocket)

    web.run_app(app, host=args.host, port=args.port)

if __name__ == '__main__':
    main()
