from __future__ import annotations

import http.server
import json
import os
import subprocess
import tempfile
import textwrap
import threading
import unittest
from pathlib import Path

from compat.manifest import load_manifest
from compat.runtime import run_module, run_suite


class FakeMem9Handler(http.server.BaseHTTPRequestHandler):
    memories = []
    last_messages = []

    def do_POST(self):  # noqa: N802
        if self.path == "/v1alpha1/mem9s":
            self._write_json(201, {"id": "tenant-123"})
            return

        if self.path == "/v1alpha2/mem9s/memories":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body) if body else {}
            if "content" in payload:
                self.__class__.memories.append(payload["content"])
            if "messages" in payload:
                self.__class__.last_messages = payload["messages"]
            self._write_json(202, {"status": "accepted"})
            return

        self._write_json(404, {"error": "not found"})

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/v1alpha2/mem9s/memories"):
            from urllib.parse import parse_qs, urlsplit

            query = parse_qs(urlsplit(self.path).query)
            q = "".join(query.get("q", []))
            matches = [item for item in self.__class__.memories if q.lower() in item.lower()]
            self._write_json(
                200,
                {
                    "memories": [{"id": f"mem-{idx}", "content": item} for idx, item in enumerate(matches, start=1)],
                    "total": len(matches),
                },
            )
            return
        if self.path == "/healthz":
            self._write_json(200, {"status": "ok"})
            return
        self._write_json(404, {"error": "not found"})

    def log_message(self, _format, *_args):
        return

    def _write_json(self, status: int, payload: dict):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def start_fake_mem9_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeMem9Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def write_fake_openclaw_script(path: Path) -> None:
    path.write_text(
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import json
            import os
            import sys
            import threading
            import time
            import urllib.parse
            import urllib.request
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
            from pathlib import Path

            HOME = Path(os.environ["HOME"])
            LOG_PATH = os.environ.get("FAKE_OPENCLAW_LOG", "")
            VERSION = os.environ.get("FAKE_OPENCLAW_VERSION", "2026.4.22")

            def log(entry):
                if not LOG_PATH:
                    return
                with open(LOG_PATH, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps(entry) + "\\n")

            def profile_dir(profile):
                return HOME / f".openclaw-{profile}"

            def config_path(profile):
                return profile_dir(profile) / "openclaw.json"

            def load_config(profile):
                path = config_path(profile)
                if not path.exists():
                    return {}
                return json.loads(path.read_text(encoding="utf-8"))

            def save_config(profile, data):
                path = config_path(profile)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data), encoding="utf-8")

            def set_nested(data, key, value):
                current = data
                parts = key.split(".")
                for part in parts[:-1]:
                    current = current.setdefault(part, {})
                current[parts[-1]] = value

            class HealthHandler(BaseHTTPRequestHandler):
                def do_GET(self):
                    if self.path == "/health":
                        payload = b'{"status":"ok"}'
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(payload)))
                        self.end_headers()
                        self.wfile.write(payload)
                    else:
                        self.send_response(404)
                        self.end_headers()

                def log_message(self, _format, *_args):
                    return

            argv = sys.argv[1:]
            log({"argv": argv})
            if argv == ["--version"]:
                print(VERSION)
                raise SystemExit(0)

            if len(argv) < 2 or argv[0] != "--profile":
                print("missing profile", file=sys.stderr)
                raise SystemExit(2)

            profile = argv[1]
            cmd = argv[2:]

            if cmd[:2] == ["config", "set"]:
                strict = False
                parts = cmd[2:]
                if parts and parts[0] == "--strict-json":
                    strict = True
                    parts = parts[1:]
                key = parts[0]
                raw_value = parts[1]
                value = json.loads(raw_value) if strict else raw_value
                cfg = load_config(profile)
                set_nested(cfg, key, value)
                save_config(profile, cfg)
                raise SystemExit(0)

            if cmd[:2] == ["config", "get"]:
                print(json.dumps(load_config(profile)))
                raise SystemExit(0)

            if cmd[:2] == ["plugins", "install"]:
                raise SystemExit(0)

            if cmd[:2] == ["gateway", "run"]:
                port = 0
                if "--port" in cmd:
                    port = int(cmd[cmd.index("--port") + 1])
                server = ThreadingHTTPServer(("127.0.0.1", port), HealthHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    while True:
                        time.sleep(1)
                except KeyboardInterrupt:
                    pass
                finally:
                    server.shutdown()
                    server.server_close()
                raise SystemExit(0)

            if cmd and cmd[0] == "agent":
                cfg = load_config(profile)
                mem9_cfg = cfg["plugins"]["entries"]["mem9"]["config"]
                api_url = mem9_cfg["apiUrl"].rstrip("/")
                session_id = cmd[cmd.index("--session-id") + 1]
                message = cmd[cmd.index("--message") + 1]
                query = urllib.parse.quote(message)
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"{api_url}/v1alpha2/mem9s/memories?q={query}&limit=10",
                        headers={"X-API-Key": mem9_cfg["apiKey"], "X-Mnemo-Agent-Id": "fake-openclaw"},
                        method="GET",
                    ),
                    timeout=5,
                ).read()
                if not message.startswith("/compact"):
                    payload = json.dumps(
                        {
                            "session_id": session_id,
                            "messages": [
                                {"role": "user", "content": message},
                                {"role": "assistant", "content": "stored from fake openclaw"},
                            ],
                        }
                    ).encode("utf-8")
                    urllib.request.urlopen(
                        urllib.request.Request(
                            f"{api_url}/v1alpha2/mem9s/memories",
                            data=payload,
                            headers={
                                "Content-Type": "application/json",
                                "X-API-Key": mem9_cfg["apiKey"],
                                "X-Mnemo-Agent-Id": "fake-openclaw",
                            },
                            method="POST",
                        ),
                        timeout=5,
                    ).read()
                print(json.dumps({"result": {"payloads": [{"text": "ok"}]}}))
                raise SystemExit(0)

            print("unsupported fake openclaw command", file=sys.stderr)
            raise SystemExit(3)
            """
        ),
        encoding="utf-8",
    )
    path.chmod(0o755)


class CompatHarnessTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeMem9Handler.memories = []
        FakeMem9Handler.last_messages = []
        self.server, self.thread = start_fake_mem9_server()
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.fake_openclaw = self.tmp_path / "fake-openclaw.py"
        write_fake_openclaw_script(self.fake_openclaw)
        self.log_path = self.tmp_path / "fake-openclaw.log"
        self.repo_root = Path(__file__).resolve().parents[2]
        self._old_env = {
            key: os.environ.get(key)
            for key in [
                "MNEMO_BASE_URL",
                "COMPAT_OPENCLAW_STABLE_BIN",
                "FAKE_OPENCLAW_LOG",
                "ANTHROPIC_API_KEY",
            ]
        }
        os.environ["MNEMO_BASE_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["COMPAT_OPENCLAW_STABLE_BIN"] = str(self.fake_openclaw)
        os.environ["FAKE_OPENCLAW_LOG"] = str(self.log_path)
        os.environ["ANTHROPIC_API_KEY"] = "test-key"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_manifest_loads(self) -> None:
        manifest = load_manifest(self.repo_root / "compat" / "manifest.yaml")
        self.assertIn("openclaw.install", manifest["modules"])
        self.assertEqual(manifest["agents"]["hermes"]["repo"], "mem9-ai/mem9-hermes-plugin")
        self.assertEqual(manifest["agents"]["dify"]["repo"], "mem9-ai/mem9-dify-plugin")
        self.assertEqual(manifest["hosts"]["openclaw"]["stable"]["executable"], str(self.fake_openclaw))

    def test_run_openclaw_install_module(self) -> None:
        manifest = load_manifest(self.repo_root / "compat" / "manifest.yaml")
        result = run_module(
            repo_root=self.repo_root,
            manifest=manifest,
            module_name="openclaw.install",
            lane="ad-hoc",
            host_channel="stable",
            model_profile="primary",
            plugin_source="local",
            artifacts_root=str(self.tmp_path / "artifacts"),
        )
        self.assertEqual(result.status, "passed")
        self.assertIn("2026.4.22", result.host_version_detected)

    def test_run_openclaw_suite(self) -> None:
        manifest = load_manifest(self.repo_root / "compat" / "manifest.yaml")
        summary = run_suite(
            repo_root=self.repo_root,
            manifest=manifest,
            suite_name="openclaw-smoke",
            lane="ad-hoc",
            host_channel="stable",
            model_profile="primary",
            plugin_source="local",
            artifacts_root=str(self.tmp_path / "artifacts"),
        )
        self.assertEqual(summary["status"], "passed")
        self.assertTrue(any(item["module"] == "openclaw.recall" for item in summary["results"]))
        self.assertTrue(FakeMem9Handler.last_messages)


if __name__ == "__main__":
    unittest.main()
