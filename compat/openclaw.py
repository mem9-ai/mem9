from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from .manifest import resolve_path
from .proxy import FaultRule, RequestRecorderProxy, find_free_port


class CompatFailure(RuntimeError):
    def __init__(self, failure_class: str, message: str):
        super().__init__(message)
        self.failure_class = failure_class


def _parse_version(text: str) -> tuple[int, int, int] | None:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))


def _supports_conversation_access(version_text: str) -> bool:
    version = _parse_version(version_text)
    if version is None:
        return False
    major, minor, patch = version
    if major >= 2026:
        return (major, minor, patch) >= (2026, 4, 22)
    return (major, minor, patch) >= (4, 23, 0)


@dataclass
class CommandCapture:
    argv: list[str]
    returncode: int
    stdout: str
    stderr: str


class OpenClawHost:
    def __init__(
        self,
        *,
        executable: str,
        home_dir: Path,
        repo_root: Path,
        module_dir: Path,
        gateway_token: str,
        model_profile: dict[str, Any] | None,
    ):
        self.executable = resolve_path(executable)
        self.home_dir = home_dir
        self.repo_root = repo_root
        self.module_dir = module_dir
        self.gateway_token = gateway_token
        self.model_profile = model_profile or {}

    def env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["HOME"] = str(self.home_dir)
        api_key_env = self.model_profile.get("api_key_env")
        fallback_env = self.model_profile.get("fallback_api_key_env")
        resolved_key = ""
        if isinstance(api_key_env, str):
            resolved_key = os.getenv(api_key_env, "")
        if not resolved_key and isinstance(fallback_env, str):
            resolved_key = os.getenv(fallback_env, "")
        if resolved_key:
            env["ANTHROPIC_API_KEY"] = resolved_key
        return env

    def version_text(self) -> str:
        capture = self.run_raw(["--version"], timeout=30)
        text = "\n".join(part for part in (capture.stdout, capture.stderr) if part).strip()
        if not text:
            raise CompatFailure("install_failure", "openclaw --version returned no output")
        return text

    def supports_conversation_access(self) -> bool:
        return _supports_conversation_access(self.version_text())

    def run_raw(
        self,
        args: list[str],
        *,
        cwd: Path | None = None,
        timeout: int = 120,
        check: bool = True,
    ) -> CommandCapture:
        argv = [self.executable, *args]
        proc = subprocess.run(
            argv,
            cwd=str(cwd or self.repo_root),
            env=self.env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            check=False,
        )
        capture = CommandCapture(argv=argv, returncode=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)
        if check and proc.returncode != 0:
            raise CompatFailure(
                "host_contract_break",
                f"command failed ({proc.returncode}): {' '.join(argv)}\n{proc.stderr.strip()}".strip(),
            )
        return capture

    def config_set(self, profile: str, *parts: str, strict_json: bool = False) -> None:
        args = ["--profile", profile, "config", "set"]
        if strict_json:
            args.append("--strict-json")
        args.extend(parts)
        self.run_raw(args)

    def config_get(self, profile: str) -> dict[str, Any]:
        capture = self.run_raw(["--profile", profile, "config", "get"])
        try:
            parsed = json.loads(capture.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise CompatFailure("host_contract_break", f"openclaw config get returned invalid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise CompatFailure("host_contract_break", "openclaw config get did not return an object")
        return parsed

    def configure_profile(
        self,
        *,
        profile: str,
        plugin_source: str,
        plugin_name: str,
        plugin_dir: Path,
        api_url: str,
        api_key: str,
        model_id: str | None,
        debug: bool = True,
        default_timeout_ms: int = 8000,
        search_timeout_ms: int = 15000,
    ) -> None:
        self.config_set(profile, "gateway.mode", "local")
        self.config_set(profile, "gateway.auth.token", self.gateway_token)
        self.config_set(profile, "gateway.remote.token", self.gateway_token)

        if model_id:
            self.config_set(profile, "agents.defaults.model.primary", model_id)

        if plugin_source == "local":
            plugins_json = json.dumps(
                {"allow": [plugin_name], "load": {"paths": [str(plugin_dir.resolve())]}},
                separators=(",", ":"),
            )
            self.config_set(profile, "plugins", plugins_json, strict_json=True)
        elif plugin_source.startswith("path:"):
            path_value = Path(plugin_source.split(":", 1)[1]).expanduser().resolve()
            plugins_json = json.dumps(
                {"allow": [plugin_name], "load": {"paths": [str(path_value)]}},
                separators=(",", ":"),
            )
            self.config_set(profile, "plugins", plugins_json, strict_json=True)
        elif plugin_source.startswith("npm:"):
            version = plugin_source.split(":", 1)[1]
            package_ref = "@mem9/mem9" if not version else f"@mem9/mem9@{version}"
            self.run_raw(["--profile", profile, "plugins", "install", package_ref], timeout=300)
            self.config_set(profile, "plugins.allow", json.dumps([plugin_name]), strict_json=True)
        else:
            raise CompatFailure("install_failure", f"unsupported plugin source: {plugin_source}")

        self.config_set(profile, "plugins.slots.memory", plugin_name)
        self.config_set(profile, f"plugins.entries.{plugin_name}.enabled", "true")
        if self.supports_conversation_access():
            self.config_set(profile, f"plugins.entries.{plugin_name}.hooks.allowConversationAccess", "true")
        self.config_set(profile, f"plugins.entries.{plugin_name}.config.apiUrl", api_url)
        self.config_set(profile, f"plugins.entries.{plugin_name}.config.apiKey", api_key)
        self.config_set(profile, f"plugins.entries.{plugin_name}.config.tenantID", api_key)
        self.config_set(profile, f"plugins.entries.{plugin_name}.config.debug", "true" if debug else "false")
        self.config_set(
            profile,
            f"plugins.entries.{plugin_name}.config.defaultTimeoutMs",
            str(default_timeout_ms),
        )
        self.config_set(
            profile,
            f"plugins.entries.{plugin_name}.config.searchTimeoutMs",
            str(search_timeout_ms),
        )
        self.run_raw(
            ["--profile", profile, "config", "set", "plugins.entries.memory-core.enabled", "false"],
            check=False,
        )
        self.run_raw(
            ["--profile", profile, "config", "set", "plugins.entries.memory-lancedb.enabled", "false"],
            check=False,
        )

    def start_gateway(self, *, profile: str, port: int, log_path: Path) -> tuple[subprocess.Popen[str], TextIO]:
        argv = [
            self.executable,
            "--profile",
            profile,
            "gateway",
            "run",
            "--port",
            str(port),
            "--force",
        ]
        handle = log_path.open("w", encoding="utf-8")
        proc = subprocess.Popen(
            argv,
            cwd=str(self.repo_root),
            env=self.env(),
            stdout=handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        return proc, handle

    def wait_for_gateway(self, *, port: int, timeout_seconds: float = 20.0) -> None:
        deadline = time.time() + timeout_seconds
        url = f"http://127.0.0.1:{port}/health"
        last_error = ""
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.getcode() == 200:
                        return
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                time.sleep(0.25)
        raise CompatFailure("host_contract_break", f"gateway health check failed: {last_error}")

    def run_agent(
        self,
        *,
        profile: str,
        message: str,
        session_id: str,
        output_dir: Path,
        timeout_seconds: int = 120,
    ) -> CommandCapture:
        capture = self.run_raw(
            [
                "--profile",
                profile,
                "agent",
                "--agent",
                "main",
                "--session-id",
                session_id,
                "--message",
                message,
                "--json",
            ],
            timeout=timeout_seconds,
            check=False,
        )
        (output_dir / "agent.stdout.json").write_text(capture.stdout, encoding="utf-8")
        (output_dir / "agent.stderr.txt").write_text(capture.stderr, encoding="utf-8")
        return capture


def http_json(
    *,
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> tuple[int, dict[str, Any] | list[Any] | None, str]:
    payload = None
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            status = response.getcode()
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        status = exc.code
    try:
        decoded = json.loads(text) if text else None
    except json.JSONDecodeError:
        decoded = None
    return status, decoded, text


def provision_tenant(base_url: str) -> str:
    status, decoded, text = http_json(method="POST", url=f"{base_url.rstrip('/')}/v1alpha1/mem9s", body={})
    if status not in (200, 201) or not isinstance(decoded, dict) or not isinstance(decoded.get("id"), str):
        raise CompatFailure("setup_failure", f"failed to provision tenant: status={status} body={text}")
    return decoded["id"]


def seed_memory(*, base_url: str, api_key: str, content: str, tags: list[str]) -> None:
    status, _decoded, text = http_json(
        method="POST",
        url=f"{base_url.rstrip('/')}/v1alpha2/mem9s/memories",
        body={"content": content, "tags": tags},
        headers={"X-API-Key": api_key, "X-Mnemo-Agent-Id": "compat-openclaw"},
    )
    if status not in (200, 202):
        raise CompatFailure("setup_failure", f"failed to seed memory: status={status} body={text}")


def probe_seed_visible(*, base_url: str, api_key: str, query: str, timeout_seconds: float = 15.0) -> None:
    deadline = time.time() + timeout_seconds
    url = f"{base_url.rstrip('/')}/v1alpha2/mem9s/memories?q={urllib.parse.quote(query)}&limit=10"
    while time.time() < deadline:
        status, decoded, _text = http_json(
            method="GET",
            url=url,
            headers={"X-API-Key": api_key, "X-Mnemo-Agent-Id": "compat-openclaw"},
        )
        if status == 200 and isinstance(decoded, dict):
            memories = decoded.get("memories")
            if isinstance(memories, list) and memories:
                return
        time.sleep(0.5)
    raise CompatFailure("setup_failure", f"seed memory did not materialize for query={query!r}")


@dataclass
class OpenClawPreparedEnv:
    host: OpenClawHost
    target_base_url: str
    proxy: RequestRecorderProxy
    proxy_base_url: str
    tenant_id: str
    profile: str
    gateway_port: int
    gateway_process: subprocess.Popen[str] | None
    gateway_log_handle: TextIO | None
    module_dir: Path
    gateway_log: Path
    probe_info: dict[str, Any]

    def cleanup(self) -> None:
        if self.gateway_process is not None:
            self.gateway_process.terminate()
            try:
                self.gateway_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.gateway_process.kill()
        if self.gateway_log_handle is not None:
            self.gateway_log_handle.close()
        self.proxy.stop()


def prepare_openclaw_environment(
    *,
    repo_root: Path,
    module_dir: Path,
    manifest: dict[str, Any],
    module_name: str,
    host_channel: str,
    model_profile_name: str,
    plugin_source: str,
    host_ref: str | None = None,
    failure_class: str = "setup_failure",
    default_timeout_ms: int = 8000,
    search_timeout_ms: int = 15000,
) -> OpenClawPreparedEnv:
    hosts = manifest.get("hosts", {})
    openclaw_hosts = hosts.get("openclaw", {})
    host_cfg = openclaw_hosts.get(host_channel)
    if not isinstance(host_cfg, dict):
        raise CompatFailure("install_failure", f"missing host config for openclaw.{host_channel}")

    model_cfg = manifest.get("models", {}).get(model_profile_name, {})
    if not isinstance(model_cfg, dict):
        raise CompatFailure("setup_failure", f"missing model profile: {model_profile_name}")

    target_base_url = os.getenv("MNEMO_BASE_URL", "").rstrip("/")
    if not target_base_url:
        raise CompatFailure(
            failure_class,
            "MNEMO_BASE_URL is required for compat OpenClaw modules; point it at the target mnemo-server",
        )

    home_dir = module_dir / "home"
    home_dir.mkdir(parents=True, exist_ok=True)

    executable = str(host_cfg.get("executable", "openclaw"))
    if host_ref:
        if host_ref.startswith("path:"):
            executable = host_ref.split(":", 1)[1]
        else:
            package_name = str(host_cfg.get("package", "openclaw") or "openclaw")
            host_prefix = module_dir / "host-npm"
            host_prefix.mkdir(parents=True, exist_ok=True)
            package_spec = f"{package_name}@{host_ref}"
            proc = subprocess.run(
                ["npm", "install", "--prefix", str(host_prefix), "--no-audit", "--no-fund", package_spec],
                cwd=str(repo_root),
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=600,
                check=False,
            )
            (module_dir / "host-npm-install.stdout.txt").write_text(proc.stdout, encoding="utf-8")
            (module_dir / "host-npm-install.stderr.txt").write_text(proc.stderr, encoding="utf-8")
            if proc.returncode != 0:
                raise CompatFailure("install_failure", proc.stderr.strip() or f"failed to install {package_spec}")
            executable = str(host_prefix / "node_modules" / ".bin" / str(host_cfg.get("binary", "openclaw")))

    host = OpenClawHost(
        executable=executable,
        home_dir=home_dir,
        repo_root=repo_root,
        module_dir=module_dir,
        gateway_token="compat-openclaw-token",
        model_profile=model_cfg,
    )

    proxy = RequestRecorderProxy(target_base_url=target_base_url)
    proxy.start()

    tenant_id = provision_tenant(target_base_url)
    profile = f"compat-{module_name.replace('.', '-')}-{host_channel}"
    plugin_dir = repo_root / "openclaw-plugin"
    gateway_port = find_free_port()

    model_id = model_cfg.get("openclaw_model")
    if not isinstance(model_id, str):
        model_id = None

    host.configure_profile(
        profile=profile,
        plugin_source=plugin_source,
        plugin_name="mem9",
        plugin_dir=plugin_dir,
        api_url=proxy.base_url,
        api_key=tenant_id,
        model_id=model_id,
        default_timeout_ms=default_timeout_ms,
        search_timeout_ms=search_timeout_ms,
    )

    config = host.config_get(profile)
    version_text = host.version_text()
    supports_conversation = _supports_conversation_access(version_text)
    probe_info = {
        "version_text": version_text,
        "supports_allow_conversation_access": supports_conversation,
        "profile_dir": str(home_dir / f".openclaw-{profile}"),
        "workspace_dir": str(home_dir / ".openclaw" / f"workspace-{profile}"),
        "config_snapshot": config,
    }
    gateway_log = module_dir / "gateway.log"

    return OpenClawPreparedEnv(
        host=host,
        target_base_url=target_base_url,
        proxy=proxy,
        proxy_base_url=proxy.base_url,
        tenant_id=tenant_id,
        profile=profile,
        gateway_port=gateway_port,
        gateway_process=None,
        gateway_log_handle=None,
        module_dir=module_dir,
        gateway_log=gateway_log,
        probe_info=probe_info,
    )


def start_gateway(env: OpenClawPreparedEnv) -> None:
    env.gateway_process, env.gateway_log_handle = env.host.start_gateway(
        profile=env.profile,
        port=env.gateway_port,
        log_path=env.gateway_log,
    )
    env.host.wait_for_gateway(port=env.gateway_port)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_openclaw_module(
    *,
    repo_root: Path,
    module_dir: Path,
    manifest: dict[str, Any],
    module_name: str,
    host_channel: str,
    model_profile_name: str,
    plugin_source: str,
    host_ref: str | None = None,
) -> dict[str, Any]:
    env = prepare_openclaw_environment(
        repo_root=repo_root,
        module_dir=module_dir,
        manifest=manifest,
        module_name=module_name,
        host_channel=host_channel,
        model_profile_name=model_profile_name,
        plugin_source=plugin_source,
        host_ref=host_ref,
    )
    try:
        write_json(module_dir / "probe.json", env.probe_info)

        if module_name == "openclaw.install":
            return {"probe": env.probe_info}

        if module_name == "openclaw.setup":
            start_gateway(env)
            config = env.host.config_get(env.profile)
            if not isinstance(config.get("plugins"), dict):
                raise CompatFailure("setup_failure", "plugins config missing after setup")
            return {"probe": env.probe_info, "config": config}

        if module_name == "openclaw.recall":
            start_gateway(env)
            seed_memory(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                content="upgrade sentinel for recall verification",
                tags=["compat", "recall"],
            )
            probe_seed_visible(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                query="upgrade sentinel",
            )
            capture = env.host.run_agent(
                profile=env.profile,
                session_id="compat-recall",
                message="Please recall the upgrade sentinel",
                output_dir=module_dir,
            )
            env.proxy.wait_for(
                lambda records: any(
                    rec.method == "GET"
                    and rec.path == "/v1alpha2/mem9s/memories"
                    and "Please recall the upgrade sentinel" in "".join(rec.query.get("q", []))
                    for rec in records
                ),
                10.0,
            )
            if not any(
                rec.method == "GET"
                and rec.path == "/v1alpha2/mem9s/memories"
                and "Please recall the upgrade sentinel" in "".join(rec.query.get("q", []))
                for rec in env.proxy.records
            ):
                raise CompatFailure("recall_failure", "mem9 recall request was not observed")
            return {
                "probe": env.probe_info,
                "agent_returncode": capture.returncode,
                "proxy_records": [record.__dict__ for record in env.proxy.records],
            }

        if module_name == "openclaw.ingest":
            start_gateway(env)
            capture = env.host.run_agent(
                profile=env.profile,
                session_id="compat-ingest",
                message="Remember this upgrade checklist and keep it after the run.",
                output_dir=module_dir,
            )
            env.proxy.wait_for(
                lambda records: any(
                    rec.method == "POST"
                    and rec.path == "/v1alpha2/mem9s/memories"
                    and isinstance(rec.body_json, dict)
                    and isinstance(rec.body_json.get("messages"), list)
                    for rec in records
                ),
                10.0,
            )
            if not any(
                rec.method == "POST"
                and rec.path == "/v1alpha2/mem9s/memories"
                and isinstance(rec.body_json, dict)
                and isinstance(rec.body_json.get("messages"), list)
                for rec in env.proxy.records
            ):
                raise CompatFailure("ingest_failure", "agent_end ingest POST was not observed")
            return {
                "probe": env.probe_info,
                "agent_returncode": capture.returncode,
                "proxy_records": [record.__dict__ for record in env.proxy.records],
            }

        if module_name == "openclaw.compact":
            start_gateway(env)
            seed_memory(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                content="compaction sentinel for recall verification",
                tags=["compat", "compact"],
            )
            probe_seed_visible(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                query="compaction sentinel",
            )
            env.host.run_agent(
                profile=env.profile,
                session_id="compat-compact",
                message="/compact",
                output_dir=module_dir / "compact-command",
            )
            env.proxy.clear()
            env.host.run_agent(
                profile=env.profile,
                session_id="compat-compact",
                message="Please recall the compaction sentinel",
                output_dir=module_dir / "post-compact",
            )
            if not env.proxy.wait_for(
                lambda records: any(
                    rec.method == "GET"
                    and rec.path == "/v1alpha2/mem9s/memories"
                    and "Please recall the compaction sentinel" in "".join(rec.query.get("q", []))
                    for rec in records
                ),
                10.0,
            ):
                raise CompatFailure("recall_failure", "recall after /compact was not observed")
            return {"probe": env.probe_info, "proxy_records": [record.__dict__ for record in env.proxy.records]}

        if module_name == "openclaw.restart":
            start_gateway(env)
            env.gateway_process.terminate()
            env.gateway_process.wait(timeout=10)
            env.gateway_process = None
            env.proxy.clear()
            start_gateway(env)
            seed_memory(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                content="restart sentinel for recall verification",
                tags=["compat", "restart"],
            )
            probe_seed_visible(
                base_url=env.target_base_url,
                api_key=env.tenant_id,
                query="restart sentinel",
            )
            env.host.run_agent(
                profile=env.profile,
                session_id="compat-restart",
                message="Please recall the restart sentinel",
                output_dir=module_dir,
            )
            if not env.proxy.wait_for(
                lambda records: any(
                    rec.method == "GET"
                    and rec.path == "/v1alpha2/mem9s/memories"
                    and "Please recall the restart sentinel" in "".join(rec.query.get("q", []))
                    for rec in records
                ),
                10.0,
            ):
                raise CompatFailure("recall_failure", "recall after restart was not observed")
            return {"probe": env.probe_info, "proxy_records": [record.__dict__ for record in env.proxy.records]}

        if module_name == "openclaw.failsoft":
            env.cleanup()
            env = prepare_openclaw_environment(
                repo_root=repo_root,
                module_dir=module_dir,
                manifest=manifest,
                module_name=module_name,
                host_channel=host_channel,
                model_profile_name=model_profile_name,
                plugin_source=plugin_source,
                host_ref=host_ref,
                search_timeout_ms=50,
            )
            env.proxy.set_fault(
                FaultRule(
                    path_prefix="/v1alpha2/mem9s/memories",
                    method="GET",
                    delay_seconds=0.2,
                )
            )
            start_gateway(env)
            capture = env.host.run_agent(
                profile=env.profile,
                session_id="compat-failsoft",
                message="Trigger a failsoft memory lookup",
                output_dir=module_dir,
            )
            stderr_text = capture.stderr
            stdout_text = capture.stdout
            if capture.returncode != 0 and "[mem9]" not in stderr_text and "[mem9]" not in stdout_text:
                raise CompatFailure(
                    "host_contract_break",
                    "agent failed without mem9 diagnostic after injected timeout",
                )
            if not env.proxy.records:
                raise CompatFailure("recall_failure", "proxy did not observe the failsoft recall attempt")
            return {
                "probe": env.probe_info,
                "agent_returncode": capture.returncode,
                "proxy_records": [record.__dict__ for record in env.proxy.records],
            }

        raise CompatFailure("setup_failure", f"unsupported OpenClaw module: {module_name}")
    finally:
        env.cleanup()
