#!/usr/bin/env python3
import os, hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler

seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room9".encode()).hexdigest()[:16] + "}"
TOKEN = "room9_player"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[secret-server] {self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self):
        if self.path == '/':
            self.respond(200, "Secret Server v1.0\nRoutes: /hint, /secret\n")
        elif self.path == '/hint':
            self.respond(200, f"Add header X-Token: {TOKEN} to access /secret\n")
        elif self.path == '/secret':
            token = self.headers.get('X-Token', '')
            if token == TOKEN:
                self.respond(200, f"FLAG: {flag}\n")
            else:
                self.respond(403, "Forbidden: invalid token\n")
        else:
            self.respond(404, "Not found\n")

    def respond(self, code, body):
        data = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

HTTPServer(('0.0.0.0', 80), Handler).serve_forever()
