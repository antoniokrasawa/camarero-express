"""Camarero Express: inbox for complaints sent with the ✋ button.

Antonio trains on his phone, and notes about bad cards used to stay in his head.
This service receives a note together with its context (which card, scene or
question) and appends it as one line to /data/reports.jsonl. Claude reads that
file with tools/reports.py.

It sits behind Caddy at https://77-42-69-208.sslip.io/camarero-api/ and lives in
the camarero-api service of /opt/bots/docker-compose.yml.

There is no authentication, because the page is public on GitHub Pages and has
nowhere to keep a secret. Abuse is bounded instead: CORS allows only our origin,
a report is capped at 4 KB, the file at 5 MB, and each IP at 60 reports per hour.

The ✋ inbox itself needs only the standard library. POST /check (automatic grading
of a spoken answer) lives in checker.py and uses the anthropic SDK; see that file
for cost and the daily cap.
"""
import json
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get("DATA_DIR", "/data")
FILE = os.path.join(DATA, "reports.jsonl")
ALLOWED_ORIGINS = {
    "https://antoniokrasawa.github.io",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
}
MAX_BODY = 4096
MAX_FILE = 5 * 1024 * 1024
PER_HOUR = 60
_hits = defaultdict(deque)
CHECKS_PER_HOUR = 300
MAX_MENU_BODY = 12 * 1024 * 1024   # up to 6 downscaled photos as base64


def _rate_ok(ip, limit=PER_HOUR, bucket=""):
    now, q = time.time(), _hits[bucket + ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


class H(BaseHTTPRequestHandler):
    server_version = "camarero-api"

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            n = 0
            if os.path.exists(FILE):
                with open(FILE, encoding="utf-8") as f:
                    n = sum(1 for _ in f)
            out = {"ok": True, "reports": n}
            try:
                import checker
                out["check"] = checker.spend_summary()
            except Exception as e:  # noqa: BLE001 - health must answer even if the SDK is missing
                out["check"] = {"error": str(e)[:100]}
            return self._send(200, out)
        if self.path.startswith("/packs/"):
            try:
                import menu
                return self._send(200, menu.load(self.path.split("/")[2].split("?")[0]))
            except (ValueError, FileNotFoundError):
                return self._send(404, {"error": "no such pack"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.rstrip("/")
        if path not in ("/report", "/check", "/menu/extract", "/menu/build"):
            return self._send(404, {"error": "not found"})
        if self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
            return self._send(403, {"error": "origin"})
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        if path == "/check":
            return self._check(ip)
        if path.startswith("/menu/"):
            return self._menu(ip, path)
        if not _rate_ok(ip):
            return self._send(429, {"error": "too many"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "size"})
        try:
            rec = json.loads(self.rfile.read(n).decode("utf-8"))
            assert isinstance(rec, dict) and str(rec.get("text", "")).strip()
        except Exception:
            return self._send(400, {"error": "bad json or empty text"})
        if os.path.exists(FILE) and os.path.getsize(FILE) > MAX_FILE:
            return self._send(507, {"error": "inbox full"})
        rec = {k: v for k, v in rec.items() if isinstance(v, (str, int, float, bool)) or v is None}
        rec["received"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rec["id"] = time.strftime("%m%d-%H%M%S") + "-" + os.urandom(2).hex()
        os.makedirs(DATA, exist_ok=True)
        with open(FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._send(200, {"ok": True})

    def _check(self, ip):
        if not _rate_ok(ip, CHECKS_PER_HOUR, "check:"):
            return self._send(429, {"error": "too many"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "size"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            import checker
            return self._send(200, checker.check(body))
        except OverflowError:
            return self._send(429, {"error": "budget"})
        except ValueError as e:
            return self._send(400, {"error": str(e)[:200]})
        except Exception as e:  # noqa: BLE001 - the app falls back to the local score
            print("check failed:", repr(e)[:300], flush=True)
            return self._send(502, {"error": "model"})

    def _menu(self, ip, path):
        """Photos -> menu (extract) and menu -> training pack (build). See menu.py."""
        if not _rate_ok(ip, 30, "menu:"):
            return self._send(429, {"error": "too many"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_MENU_BODY:
            return self._send(413, {"error": "size"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            import menu
            if path == "/menu/extract":
                return self._send(200, menu.extract(body.get("code"), body.get("images") or []))
            return self._send(200, menu.start_build(body.get("code"), body.get("menu") or {}))
        except menu.AccessDenied:
            return self._send(403, {"error": "code"})
        except OverflowError:
            return self._send(429, {"error": "budget"})
        except ValueError as e:
            return self._send(400, {"error": str(e)[:200]})
        except Exception as e:  # noqa: BLE001
            print("menu failed:", repr(e)[:300], flush=True)
            return self._send(502, {"error": "model"})

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), H).serve_forever()
