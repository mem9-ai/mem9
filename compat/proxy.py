from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class FaultRule:
    path_prefix: str
    method: str | None = None
    delay_seconds: float = 0.0
    response_status: int | None = None
    response_body: dict[str, Any] | None = None

    def matches(self, method: str, path: str) -> bool:
        if self.method and self.method.upper() != method.upper():
            return False
        return path.startswith(self.path_prefix)


@dataclass
class RecordedRequest:
    method: str
    path: str
    status: int
    query: dict[str, list[str]]
    headers: dict[str, str]
    body_text: str
    body_json: dict[str, Any] | list[Any] | None
    timestamp: float = field(default_factory=time.time)


class RequestRecorderProxy:
    def __init__(self, *, target_base_url: str):
        self.target_base_url = target_base_url.rstrip("/")
        self._records: list[RecordedRequest] = []
        self._lock = threading.Lock()
        self._fault: FaultRule | None = None
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.base_url = ""

    @property
    def records(self) -> list[RecordedRequest]:
        with self._lock:
            return list(self._records)

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    def set_fault(self, fault: FaultRule | None) -> None:
        self._fault = fault

    def start(self) -> None:
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                proxy._handle(self)

            def do_POST(self) -> None:  # noqa: N802
                proxy._handle(self)

            def do_PUT(self) -> None:  # noqa: N802
                proxy._handle(self)

            def do_DELETE(self) -> None:  # noqa: N802
                proxy._handle(self)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = self._server.server_port
        self.base_url = f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def wait_for(self, predicate, timeout_seconds: float) -> bool:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if predicate(self.records):
                return True
            time.sleep(0.1)
        return predicate(self.records)

    def _handle(self, handler: BaseHTTPRequestHandler) -> None:
        body = b""
        content_length = handler.headers.get("Content-Length")
        if content_length:
            body = handler.rfile.read(int(content_length))

        parsed = urllib.parse.urlsplit(handler.path)
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        body_text = body.decode("utf-8", errors="replace")
        body_json: dict[str, Any] | list[Any] | None = None
        if body_text:
            try:
                decoded = json.loads(body_text)
                if isinstance(decoded, (dict, list)):
                    body_json = decoded
            except json.JSONDecodeError:
                body_json = None

        headers = {key: value for key, value in handler.headers.items()}
        fault = self._fault
        if fault and fault.matches(handler.command, parsed.path):
            if fault.delay_seconds > 0:
                time.sleep(fault.delay_seconds)
            status = fault.response_status or 503
            payload = fault.response_body or {"error": "compat proxy injected failure"}
            encoded = json.dumps(payload).encode("utf-8")
            self._record(
                RecordedRequest(
                    method=handler.command,
                    path=parsed.path,
                    status=status,
                    query=query,
                    headers=headers,
                    body_text=body_text,
                    body_json=body_json,
                )
            )
            handler.send_response(status)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(encoded)))
            handler.end_headers()
            handler.wfile.write(encoded)
            return

        target_url = f"{self.target_base_url}{handler.path}"
        request = urllib.request.Request(
            target_url,
            data=body if body else None,
            headers=headers,
            method=handler.command,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                status = response.getcode()
                response_headers = response.headers
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            response_headers = exc.headers
        except urllib.error.URLError as exc:
            encoded = json.dumps({"error": str(exc)}).encode("utf-8")
            status = 502
            payload = encoded
            response_headers = {"Content-Type": "application/json"}

        self._record(
            RecordedRequest(
                method=handler.command,
                path=parsed.path,
                status=status,
                query=query,
                headers=headers,
                body_text=body_text,
                body_json=body_json,
            )
        )
        handler.send_response(status)
        for key, value in response_headers.items():
            if key.lower() == "transfer-encoding":
                continue
            handler.send_header(key, value)
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)

    def _record(self, record: RecordedRequest) -> None:
        with self._lock:
            self._records.append(record)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
