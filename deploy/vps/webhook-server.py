#!/usr/bin/env python3
"""Local-only HTTPS-backed deploy webhook for GitHub Actions (SSH to :22 is blocked from GHA)."""

from __future__ import annotations

import hmac
import http.server
import json
import os
import subprocess
import threading

HOST = "127.0.0.1"
PORT = int(os.environ.get("DEPLOY_WEBHOOK_PORT", "9100"))
SECRET = os.environ.get("DEPLOY_WEBHOOK_SECRET", "").encode()
SCRIPT = os.environ.get("DEPLOY_API_SCRIPT", "/opt/sentinel/deploy-api.sh")
lock = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/hooks/deploy-api":
            self._json(404, {"ok": False, "error": "not found"})
            return

        provided = (self.headers.get("x-deploy-secret") or "").encode()
        if not SECRET or not provided or not hmac.compare_digest(provided, SECRET):
            self._json(401, {"ok": False, "error": "unauthorized"})
            return

        if not lock.acquire(blocking=False):
            self._json(409, {"ok": False, "error": "deploy already running"})
            return

        try:
            result = subprocess.run([SCRIPT], capture_output=True, text=True, timeout=600)
            self._json(
                200 if result.returncode == 0 else 500,
                {
                    "ok": result.returncode == 0,
                    "code": result.returncode,
                    "stdout": (result.stdout or "")[-4000:],
                    "stderr": (result.stderr or "")[-4000:],
                },
            )
        finally:
            lock.release()


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("DEPLOY_WEBHOOK_SECRET is required")
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
