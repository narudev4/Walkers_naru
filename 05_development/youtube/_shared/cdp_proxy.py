#!/usr/bin/env python3
"""
CDP WebSocket Proxy that filters out Browser.setDownloadBehavior commands.
Chrome 147 removed this method, breaking Playwright's connect_over_cdp().

Usage:
    python3 cdp_proxy.py [--listen 9223] [--target 9222]

Then connect Playwright to ws://localhost:9223 instead of 9222.
"""

import asyncio
import json
import sys
import aiohttp
from aiohttp import web, WSMsgType
import urllib.request


async def get_ws_url(target_port):
    """Get the Chrome DevTools WebSocket URL from the target."""
    url = f"http://localhost:{target_port}/json/version"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        return data["webSocketDebuggerUrl"]


class CDPProxy:
    def __init__(self, target_port):
        self.target_port = target_port
        self._pending_intercepts = set()

    async def handle_json_version(self, request):
        """Proxy /json/version but rewrite the WebSocket URL."""
        listen_port = request.app["listen_port"]
        url = f"http://localhost:{self.target_port}/json/version"
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                data = await resp.json()
                # Rewrite webSocketDebuggerUrl to point to our proxy
                ws_url = data.get("webSocketDebuggerUrl", "")
                data["webSocketDebuggerUrl"] = ws_url.replace(
                    f":{self.target_port}", f":{listen_port}"
                )
                return web.json_response(data)

    async def handle_json_list(self, request):
        """Proxy /json/list."""
        listen_port = request.app["listen_port"]
        url = f"http://localhost:{self.target_port}/json/list"
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                data = await resp.json()
                for item in data:
                    for key in ("webSocketDebuggerUrl", "devtoolsFrontendUrl"):
                        if key in item:
                            item[key] = item[key].replace(
                                f":{self.target_port}", f":{listen_port}"
                            )
                return web.json_response(data)

    async def handle_json(self, request):
        """Proxy other /json/* endpoints."""
        path = request.path
        url = f"http://localhost:{self.target_port}{path}"
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                text = await resp.text()
                return web.Response(text=text, content_type="application/json")

    async def handle_json_new(self, request):
        """Proxy PUT /json/new."""
        target_url = request.query.get("url", "")
        url = f"http://localhost:{self.target_port}/json/new?url={target_url}"
        async with aiohttp.ClientSession() as session:
            async with session.put(url) as resp:
                data = await resp.json()
                listen_port = request.app["listen_port"]
                for key in ("webSocketDebuggerUrl", "devtoolsFrontendUrl"):
                    if key in data:
                        data[key] = data[key].replace(
                            f":{self.target_port}", f":{listen_port}"
                        )
                return web.json_response(data)

    async def websocket_handler(self, request):
        """Proxy WebSocket connections, intercepting setDownloadBehavior."""
        ws_server = web.WebSocketResponse()
        await ws_server.prepare(request)

        # Connect to the real Chrome
        ws_path = request.path
        target_ws_url = f"ws://localhost:{self.target_port}{ws_path}"

        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(target_ws_url) as ws_chrome:

                async def forward_to_chrome():
                    """Forward messages from Playwright to Chrome."""
                    async for msg in ws_server:
                        if msg.type == WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                method = data.get("method", "")
                                if "setDownloadBehavior" in method:
                                    # Intercept: send fake success back to Playwright
                                    msg_id = data.get("id")
                                    if msg_id is not None:
                                        fake_response = json.dumps({"id": msg_id, "result": {}})
                                        await ws_server.send_str(fake_response)
                                    continue
                                await ws_chrome.send_str(msg.data)
                            except json.JSONDecodeError:
                                await ws_chrome.send_str(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await ws_chrome.send_bytes(msg.data)
                        elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
                            break

                async def forward_to_playwright():
                    """Forward messages from Chrome to Playwright."""
                    async for msg in ws_chrome:
                        if msg.type == WSMsgType.TEXT:
                            await ws_server.send_str(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await ws_server.send_bytes(msg.data)
                        elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
                            break

                await asyncio.gather(
                    forward_to_chrome(),
                    forward_to_playwright(),
                    return_exceptions=True,
                )

        return ws_server


async def start_proxy(listen_port=9223, target_port=9222):
    proxy = CDPProxy(target_port)
    app = web.Application()
    app["listen_port"] = listen_port

    # HTTP endpoints
    app.router.add_get("/json/version", proxy.handle_json_version)
    app.router.add_get("/json/list", proxy.handle_json_list)
    app.router.add_put("/json/new", proxy.handle_json_new)
    app.router.add_get("/json/{tail:.*}", proxy.handle_json)

    # WebSocket endpoint (catch-all for /devtools/*)
    app.router.add_get("/devtools/{tail:.*}", proxy.websocket_handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", listen_port)
    await site.start()
    print(f"CDP Proxy listening on port {listen_port}, forwarding to {target_port}")
    print(f"Connect Playwright to: http://localhost:{listen_port}")

    # Keep running
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    listen_port = 9223
    target_port = 9222
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--listen" and i < len(sys.argv) - 1:
            listen_port = int(sys.argv[i + 1])
        elif arg == "--target" and i < len(sys.argv) - 1:
            target_port = int(sys.argv[i + 1])

    asyncio.run(start_proxy(listen_port, target_port))
