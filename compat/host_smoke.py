from __future__ import annotations

import http.server
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from .openclaw import CompatFailure


class _FakeMem9Handler(http.server.BaseHTTPRequestHandler):
    records: list[dict[str, Any]] = []

    def do_POST(self) -> None:  # noqa: N802
        payload = self._read_json()
        self._record(payload)
        if self.path == "/v1alpha1/mem9s":
            self._write_json(201, {"id": "compat-host-smoke-key"})
            return
        if self.path == "/v1alpha2/mem9s/memories":
            self._write_json(202, {"status": "accepted", "ok": True})
            return
        self._write_json(404, {"error": "not found"})

    def do_GET(self) -> None:  # noqa: N802
        self._record(None)
        if self.path.startswith("/v1alpha2/mem9s/memories"):
            self._write_json(
                200,
                {
                    "memories": [
                        {
                            "id": "compat-memory",
                            "content": "host smoke memory response",
                            "score": 0.9,
                        }
                    ],
                    "total": 1,
                },
            )
            return
        self._write_json(404, {"error": "not found"})

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return None
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    def _record(self, body: Any) -> None:
        self.__class__.records.append(
            {
                "method": self.command,
                "path": self.path,
                "headers": {
                    "X-API-Key": self.headers.get("X-API-Key", ""),
                    "X-Mnemo-Agent-Id": self.headers.get("X-Mnemo-Agent-Id", ""),
                    "Content-Type": self.headers.get("Content-Type", ""),
                },
                "body": body,
            }
        )

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class FakeMem9Server:
    def __init__(self) -> None:
        _FakeMem9Handler.records = []
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeMem9Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    @property
    def records(self) -> list[dict[str, Any]]:
        return list(_FakeMem9Handler.records)

    def __enter__(self) -> "FakeMem9Server":
        self.thread.start()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def _run(
    argv: list[str],
    *,
    cwd: Path,
    module_dir: Path,
    stem: str,
    env: dict[str, str] | None = None,
    timeout: int = 300,
) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        argv,
        cwd=str(cwd),
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
    (module_dir / f"{stem}.stdout.txt").write_text(proc.stdout, encoding="utf-8")
    (module_dir / f"{stem}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
    if proc.returncode != 0:
        raise CompatFailure(
            "host_contract_break",
            proc.stderr.strip() or proc.stdout.strip() or f"{stem} failed",
        )
    return proc


def _agent_config(manifest: dict[str, Any], agent: str) -> dict[str, Any]:
    cfg = manifest.get("agents", {}).get(agent)
    if not isinstance(cfg, dict):
        raise CompatFailure("setup_failure", f"missing agent config: {agent}")
    return cfg


def _install_npm_host(
    *,
    manifest: dict[str, Any],
    agent: str,
    host_ref: str | None,
    module_dir: Path,
) -> tuple[Path, dict[str, Any]]:
    cfg = _agent_config(manifest, agent)
    host_cfg = cfg.get("host")
    if not isinstance(host_cfg, dict):
        raise CompatFailure("setup_failure", f"missing host config for {agent}")

    binary = str(host_cfg.get("binary", agent))
    if host_ref and host_ref.startswith("path:"):
        executable = Path(host_ref.split(":", 1)[1]).expanduser().resolve()
        if not executable.exists():
            raise CompatFailure("install_failure", f"host executable does not exist: {executable}")
        return executable, {"source": "path", "path": str(executable), "ref": host_ref}

    package = str(host_cfg.get("package", "") or "")
    if not package:
        raise CompatFailure("setup_failure", f"missing npm host package for {agent}")
    ref = host_ref or str(host_cfg.get("default_ref", "") or "latest")
    package_spec = package if ref in {"", "latest"} else f"{package}@{ref}"
    if ref == "latest":
        package_spec = f"{package}@latest"

    prefix = module_dir / "host-npm"
    prefix.mkdir(parents=True, exist_ok=True)
    _run(
        ["npm", "install", "--prefix", str(prefix), "--no-audit", "--no-fund", package_spec],
        cwd=module_dir,
        module_dir=module_dir,
        stem="host-npm-install",
        timeout=600,
    )
    executable = prefix / "node_modules" / ".bin" / binary
    if not executable.exists():
        raise CompatFailure("install_failure", f"host binary was not installed: {executable}")
    return executable, {"source": "npm", "package": package, "ref": ref, "package_spec": package_spec}


def _version(executable: Path, module_dir: Path, env: dict[str, str] | None = None) -> str:
    proc = _run(
        [str(executable), "--version"],
        cwd=module_dir,
        module_dir=module_dir,
        stem="host-version",
        env=env,
        timeout=60,
    )
    return "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_transcript(path: Path) -> None:
    lines = [
        {"type": "event_msg", "payload": {"type": "user_message", "message": "remember host smoke"}},
        {"type": "event_msg", "payload": {"type": "agent_message", "message": "stored host smoke"}},
        {"role": "user", "content": "remember host smoke"},
        {"role": "assistant", "content": "stored host smoke"},
    ]
    path.write_text("\n".join(json.dumps(item) for item in lines) + "\n", encoding="utf-8")


def _run_claude_host_smoke(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    module_dir: Path,
    host_ref: str | None,
) -> dict[str, Any]:
    executable, host_details = _install_npm_host(
        manifest=manifest,
        agent="claude",
        host_ref=host_ref,
        module_dir=module_dir,
    )
    env = os.environ.copy()
    env["HOME"] = str(module_dir / "home")
    env["CLAUDE_PLUGIN_DATA"] = str(module_dir / "claude-plugin-data")
    env["MEM9_DEBUG"] = "1"
    (module_dir / "home").mkdir(parents=True, exist_ok=True)
    (module_dir / "claude-plugin-data").mkdir(parents=True, exist_ok=True)

    version_text = _version(executable, module_dir, env)
    _run(
        [str(executable), "plugin", "validate", str(repo_root / "claude-plugin")],
        cwd=repo_root,
        module_dir=module_dir,
        stem="claude-plugin-validate",
        env=env,
        timeout=120,
    )

    transcript = module_dir / "claude-transcript.jsonl"
    _write_transcript(transcript)
    with FakeMem9Server() as server:
        env.update(
            {
                "MEM9_API_URL": server.base_url,
                "MEM9_API_KEY": "compat-host-smoke-key",
                "MEM9_AGENT_ID": "claude-code-main",
                "MEM9_WRITER_ID": "claude-code",
            }
        )
        hooks = repo_root / "claude-plugin" / "hooks"
        for name, payload in [
            ("session-start", {"source": "startup"}),
            ("user-prompt-submit", {"prompt": "please recall host smoke"}),
            ("stop", {"session_id": "claude-host-smoke", "transcript_path": str(transcript)}),
            ("pre-compact", {"session_id": "claude-host-smoke", "transcript_path": str(transcript)}),
            ("session-end", {"session_id": "claude-host-smoke", "transcript_path": str(transcript)}),
        ]:
            proc = subprocess.run(
                ["bash", str(hooks / f"{name}.sh")],
                cwd=str(repo_root),
                env=env,
                input=json.dumps(payload),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=120,
                check=False,
            )
            (module_dir / f"claude-{name}.stdout.txt").write_text(proc.stdout, encoding="utf-8")
            (module_dir / f"claude-{name}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
            if proc.returncode != 0:
                raise CompatFailure("host_contract_break", f"Claude hook {name} failed: {proc.stderr.strip()}")

        records = server.records
    if not any(record["method"] == "GET" and record["path"].startswith("/v1alpha2/mem9s/memories") for record in records):
        raise CompatFailure("recall_failure", "Claude host smoke did not observe recall GET")
    if not any(record["method"] == "POST" and record["path"] == "/v1alpha2/mem9s/memories" for record in records):
        raise CompatFailure("ingest_failure", "Claude host smoke did not observe ingest POST")
    return {"host": host_details, "version_text": version_text, "records": records}


def _resolve_opencode_plugin_source(repo_root: Path, plugin_source: str, plugin_ref: str | None) -> str:
    if plugin_source == "manifest":
        plugin_source = "local"
    if plugin_source == "local":
        return str(repo_root / "opencode-plugin")
    if plugin_source.startswith("npm:"):
        version = plugin_source.split(":", 1)[1] or "latest"
        return f"@mem9/opencode@{version}"
    if plugin_source.startswith("path:"):
        return plugin_source.split(":", 1)[1]
    if plugin_source.startswith("github:"):
        return f"git+https://github.com/{plugin_source.split(':', 1)[1]}"
    if plugin_ref:
        return plugin_ref
    return plugin_source


def _run_opencode_host_smoke(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    module_dir: Path,
    plugin_source: str,
    plugin_ref: str | None,
    host_ref: str | None,
) -> dict[str, Any]:
    executable, host_details = _install_npm_host(
        manifest=manifest,
        agent="opencode",
        host_ref=host_ref,
        module_dir=module_dir,
    )
    env = os.environ.copy()
    env["HOME"] = str(module_dir / "home")
    env["XDG_CONFIG_HOME"] = str(module_dir / "config")
    env["XDG_DATA_HOME"] = str(module_dir / "data")
    env["XDG_CACHE_HOME"] = str(module_dir / "cache")
    for key in ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]:
        Path(env[key]).mkdir(parents=True, exist_ok=True)

    version_text = _version(executable, module_dir, env)
    resolved_plugin = _resolve_opencode_plugin_source(repo_root, plugin_source, plugin_ref)
    _run(
        [str(executable), "plugin", "--global", "--force", resolved_plugin],
        cwd=repo_root,
        module_dir=module_dir,
        stem="opencode-plugin-install",
        env=env,
        timeout=300,
    )
    config_path = Path(env["XDG_CONFIG_HOME"]) / "opencode" / "opencode.json"
    tui_path = Path(env["XDG_CONFIG_HOME"]) / "opencode" / "tui.json"
    if not config_path.exists() or not tui_path.exists():
        raise CompatFailure("host_contract_break", "OpenCode plugin install did not write both server and TUI config")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    tui = json.loads(tui_path.read_text(encoding="utf-8"))
    _write_json(module_dir / "opencode-config.json", config)
    _write_json(module_dir / "opencode-tui.json", tui)
    config_text = json.dumps({"opencode": config, "tui": tui})
    if "mem9" not in config_text and "@mem9/opencode" not in config_text and "opencode-plugin" not in config_text:
        raise CompatFailure("host_contract_break", "OpenCode config does not reference mem9 plugin")
    return {
        "host": host_details,
        "version_text": version_text,
        "plugin_install_source": resolved_plugin,
        "config_paths": [str(config_path), str(tui_path)],
    }


def _run_codex_host_smoke(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    module_dir: Path,
    host_ref: str | None,
) -> dict[str, Any]:
    executable, host_details = _install_npm_host(
        manifest=manifest,
        agent="codex",
        host_ref=host_ref,
        module_dir=module_dir,
    )
    env = os.environ.copy()
    env["PATH"] = f"{executable.parent}:{env.get('PATH', '')}"
    env["CODEX_HOME"] = str(module_dir / "codex-home")
    env["MEM9_HOME"] = str(module_dir / "mem9-home")
    env["MEM9_API_KEY"] = "compat-host-smoke-key"
    Path(env["CODEX_HOME"]).mkdir(parents=True, exist_ok=True)
    Path(env["MEM9_HOME"]).mkdir(parents=True, exist_ok=True)
    manifest_path = repo_root / "codex-plugin" / ".codex-plugin" / "plugin.json"
    plugin_version = "local"
    if manifest_path.exists():
        plugin_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        plugin_version = str(plugin_manifest.get("version") or "local")
    (Path(env["CODEX_HOME"]) / "plugins" / "cache" / "mem9-ai" / "mem9" / plugin_version).mkdir(
        parents=True,
        exist_ok=True,
    )

    version_text = _version(executable, module_dir, env)
    _run(
        [str(executable), "plugin", "marketplace", "--help"],
        cwd=repo_root,
        module_dir=module_dir,
        stem="codex-plugin-marketplace-help",
        env=env,
        timeout=60,
    )

    setup = repo_root / "codex-plugin" / "skills" / "setup" / "scripts" / "setup.mjs"
    with FakeMem9Server() as server:
        _run(
            [
                "node",
                str(setup),
                "profile",
                "save-key",
                "--profile",
                "default",
                "--label",
                "Compat",
                "--base-url",
                server.base_url,
                "--api-key-env",
                "MEM9_API_KEY",
                "--cwd",
                str(repo_root),
            ],
            cwd=repo_root,
            module_dir=module_dir,
            stem="codex-profile-save-key",
            env=env,
        )
        _run(
            [
                "node",
                str(setup),
                "scope",
                "apply",
                "--scope",
                "user",
                "--profile",
                "default",
                "--default-timeout-ms",
                "8000",
                "--search-timeout-ms",
                "15000",
                "--recall-min-prompt-length",
                "5",
                "--cwd",
                str(repo_root),
            ],
            cwd=repo_root,
            module_dir=module_dir,
            stem="codex-scope-apply",
            env=env,
        )
        inspect = _run(
            ["node", str(setup), "inspect", "--cwd", str(repo_root)],
            cwd=repo_root,
            module_dir=module_dir,
            stem="codex-inspect",
            env=env,
        )
        hook_feature = "hooks"
        config_toml = Path(env["CODEX_HOME"]) / "config.toml"
        if config_toml.exists() and "codex_hooks = true" in config_toml.read_text(encoding="utf-8"):
            hook_feature = "codex_hooks"

        transcript = module_dir / "codex-transcript.jsonl"
        _write_transcript(transcript)
        for name, payload in [
            ("session-start", {"cwd": str(repo_root)}),
            ("user-prompt-submit", {"cwd": str(repo_root), "prompt": "please recall host smoke"}),
            (
                "stop",
                {
                    "cwd": str(repo_root),
                    "session_id": "codex-host-smoke",
                    "transcript_path": str(transcript),
                },
            ),
        ]:
            proc = subprocess.run(
                ["node", str(repo_root / "codex-plugin" / "hooks" / f"{name}.mjs")],
                cwd=str(repo_root),
                env=env,
                input=json.dumps(payload),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=120,
                check=False,
            )
            (module_dir / f"codex-{name}.stdout.txt").write_text(proc.stdout, encoding="utf-8")
            (module_dir / f"codex-{name}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
            if proc.returncode != 0:
                raise CompatFailure("host_contract_break", f"Codex hook {name} failed: {proc.stderr.strip()}")

        records = server.records

    if not any(record["method"] == "GET" and record["path"].startswith("/v1alpha2/mem9s/memories") for record in records):
        raise CompatFailure("recall_failure", "Codex host smoke did not observe recall GET")
    if not any(record["method"] == "POST" and record["path"] == "/v1alpha2/mem9s/memories" for record in records):
        raise CompatFailure("ingest_failure", "Codex host smoke did not observe ingest POST")
    return {
        "host": host_details,
        "version_text": version_text,
        "hook_feature": hook_feature,
        "inspect": json.loads(inspect.stdout),
        "records": records,
    }


def run_host_smoke_module(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    module_name: str,
    module_cfg: dict[str, Any],
    module_dir: Path,
    plugin_source: str,
    plugin_ref: str | None,
    host_ref: str | None,
) -> dict[str, Any]:
    if shutil.which("npm") is None:
        raise CompatFailure("install_failure", "npm is required for host smoke modules")

    agent = str(module_cfg.get("agent", ""))
    if agent == "claude":
        return _run_claude_host_smoke(
            repo_root=repo_root,
            manifest=manifest,
            module_dir=module_dir,
            host_ref=host_ref,
        )
    if agent == "opencode":
        return _run_opencode_host_smoke(
            repo_root=repo_root,
            manifest=manifest,
            module_dir=module_dir,
            plugin_source=plugin_source,
            plugin_ref=plugin_ref,
            host_ref=host_ref,
        )
    if agent == "codex":
        return _run_codex_host_smoke(
            repo_root=repo_root,
            manifest=manifest,
            module_dir=module_dir,
            host_ref=host_ref,
        )
    raise CompatFailure("setup_failure", f"unsupported host smoke module {module_name} for agent {agent}")
