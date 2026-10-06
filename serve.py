#!/usr/bin/env python3
"""Local static file server for SoundLoom provider development.

Serves this repo (index.json + providers/*.js) with CORS so a phone on your LAN
can add http://<lan-ip>:8000/index.json as a repo URL.

All search/debrid logic lives in the provider .js files — not here. Production
uses GitHub/raw hosting; this script is optional for local dev only.

Usage (from repo root):
  python3 serve.py
"""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"SoundLoom providers (static) on http://0.0.0.0:{PORT}")
    print(f"  manifest: http://<lan-ip>:{PORT}/index.json")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
