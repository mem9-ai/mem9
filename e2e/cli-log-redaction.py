#!/usr/bin/env python3
"""Exercise the built CLI against a local HTTP peer; no cloud keys or DB needed.

Run: python3 e2e/cli-log-redaction.py /path/to/mnemo
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import quote, quote_plus, unquote, urlsplit


PROVISIONED_KEY = "55728418-5d1d-471f-a38e-057f824ea7eb"
requests = []


class Peer(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def handle_request(self):
        path = unquote(urlsplit(self.path).path)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        requests.append((path, body))
        key = path.split("/")[3] if path.count("/") > 3 else ""
        status = 200
        if path == "/v1alpha1/mem9s":
            payload = {"id": PROVISIONED_KEY}
        elif path.endswith("/echo-error"):
            status = 500
            payload = {"error": f"request failed for {key}"}
        elif path.endswith("/imports"):
            payload = {"id": "task-smoke", "status": "pending"}
        else:
            payload = {"memories": [], "total": 0, "diagnostic_echo": key}
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = handle_request
    do_POST = handle_request


def run(binary, base, args, secrets, success=True):
    env = {k: v for k, v in os.environ.items() if not k.startswith("MNEMO_")}
    result = subprocess.run(
        [binary, "--api-url", base, *args],
        capture_output=True, text=True, timeout=10, env=env,
    )
    assert (result.returncode == 0) == success, "unexpected CLI exit status"
    for secret in secrets:
        for value in {secret, quote(secret, safe=""), quote_plus(secret)}:
            assert value not in result.stderr, "credential leaked to stderr"
    return result


def main():
    binary = str(Path(sys.argv[1]).resolve())
    peer = ThreadingHTTPServer(("127.0.0.1", 0), Peer)
    worker = Thread(target=peer.serve_forever, daemon=True)
    worker.start()
    base = f"http://127.0.0.1:{peer.server_port}"
    try:
        for key in ("8c9fba0b-748e-42ae-b49b-78103d5e8b8c", "encoded key+canary"):
            for verbose in ([], ["--verbose"]):
                result = run(binary, base, ["--tenant-id", key, *verbose, "memory", "search"], [key])
                assert "[REDACTED]" in result.stderr, "missing redaction marker"
                assert requests[-1][0] == f"/v1alpha1/mem9s/{key}/memories", "request key changed"
            run(binary, base, ["--tenant-id", key, "--verbose", "memory", "get", "echo-error"], [key], False)
            with tempfile.NamedTemporaryFile(suffix=".json") as upload:
                upload.write(b"[]")
                upload.flush()
                run(binary, base, ["--tenant-id", key, "--verbose", "task", "create", upload.name, "--file-type", "memory"], [key])
                assert requests[-1][0] == f"/v1alpha1/mem9s/{key}/imports", "upload key changed"
                assert b"[]" in requests[-1][1], "upload body changed"
        for verbose in ([], ["--verbose"]):
            result = run(binary, base, [*verbose, "provision"], [PROVISIONED_KEY])
            assert json.loads(result.stdout)["id"] == PROVISIONED_KEY, "provision output changed"
    finally:
        peer.shutdown()
        peer.server_close()
        worker.join()

    key = "network failure+canary"
    run(binary, base, ["--tenant-id", key, "memory", "search"], [key], False)
    run(binary, "http://[invalid", ["--tenant-id", key, "memory", "search"], [key], False)
    print("PASS: normal/verbose requests, encoded keys, uploads, provisioning, HTTP/network/URL errors")


if __name__ == "__main__":
    main()
