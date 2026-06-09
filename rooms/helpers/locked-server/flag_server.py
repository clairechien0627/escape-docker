#!/usr/bin/env python3
"""locked-server 內部的 FLAG 服務，跑在 localhost:9090"""
import os, hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler

seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room4".encode()).hexdigest()[:16] + "}"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/flag':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"{flag}\n".encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"SSH Tunnel Challenge\nGET /flag to get the flag\n")

HTTPServer(('127.0.0.1', 9090), Handler).serve_forever()
