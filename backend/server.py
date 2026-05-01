"""
WebSocket server streaming pipeline output to browser clients.
Also serves the frontend static files via HTTP.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import websockets
from websockets.asyncio.server import serve

from pipeline import Pipeline

# --- Configuration ---
WS_PORT = 8765
HTTP_PORT = 8080
TICK_INTERVAL = 0.1  # 10 Hz

# Path to frontend files
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


class SimulationServer:
    """WebSocket server that streams pipeline data to connected clients."""

    def __init__(self):
        self.pipeline = Pipeline("large_swarm")
        self.clients = set()

    async def handler(self, websocket):
        """Handle a single WebSocket connection."""
        self.clients.add(websocket)
        print(f"[WS] Client connected ({len(self.clients)} total)")

        try:
            async for message in websocket:
                try:
                    cmd = json.loads(message)
                    await self._handle_command(cmd)
                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"[WS] Client disconnected ({len(self.clients)} total)")

    async def _handle_command(self, cmd):
        """Process incoming commands from clients."""
        action = cmd.get("command")
        if action == "set_scenario":
            scenario = cmd.get("scenario", "large_swarm")
            if scenario in ["single", "small_swarm", "large_swarm"]:
                self.pipeline.set_scenario(scenario)
                print(f"[WS] Scenario changed to: {scenario}")
        elif action == "toggle":
            self.pipeline.running = not self.pipeline.running
            print(f"[WS] Simulation {'resumed' if self.pipeline.running else 'paused'}")

    async def broadcast_loop(self):
        """Main loop: tick pipeline and broadcast to all clients."""
        print(f"[WS] Pipeline broadcast loop started at {TICK_INTERVAL}s interval")
        while True:
            if self.pipeline.running and self.clients:
                result = self.pipeline.tick()
                if result:
                    payload = json.dumps(result)
                    disconnected = set()
                    for ws in self.clients:
                        try:
                            await ws.send(payload)
                        except websockets.exceptions.ConnectionClosed:
                            disconnected.add(ws)
                    self.clients -= disconnected

            await asyncio.sleep(TICK_INTERVAL)


def start_http_server():
    """Start a simple HTTP server to serve frontend static files."""
    os.chdir(str(FRONTEND_DIR))

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # Suppress HTTP access logs

    server = HTTPServer(("0.0.0.0", HTTP_PORT), QuietHandler)
    print(f"[HTTP] Serving frontend at http://localhost:{HTTP_PORT}")
    server.serve_forever()


async def main():
    server_obj = SimulationServer()

    # Start HTTP server in a background thread
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()

    # Start WebSocket server
    async with serve(server_obj.handler, "0.0.0.0", WS_PORT):
        print(f"[WS] WebSocket server running on ws://localhost:{WS_PORT}")
        print(f"\n  → Open http://localhost:{HTTP_PORT} in your browser\n")

        # Run broadcast loop
        await server_obj.broadcast_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[SERVER] Shutting down...")
