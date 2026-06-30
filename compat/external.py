from __future__ import annotations

import json
import os
import subprocess
import textwrap
import uuid
from pathlib import Path
from typing import Any

from .openclaw import CompatFailure


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
    return proc


def _agent_config(manifest: dict[str, Any], agent: str) -> dict[str, Any]:
    cfg = manifest.get("agents", {}).get(agent)
    if not isinstance(cfg, dict):
        raise CompatFailure("setup_failure", f"missing agent config: {agent}")
    return cfg


def _repo_ref(agent_cfg: dict[str, Any], plugin_ref: str | None) -> tuple[str, str | None]:
    plugin_cfg = agent_cfg.get("plugin")
    default_ref = ""
    if isinstance(plugin_cfg, dict):
        default_ref = str(plugin_cfg.get("default_ref", "") or "")
    ref = plugin_ref or default_ref or agent_cfg.get("default_ref") or "main"
    if isinstance(ref, str) and ref.startswith("github:"):
        spec = ref.split(":", 1)[1]
        if "@" not in spec:
            raise CompatFailure("setup_failure", "github plugin_ref must look like github:<owner>/<repo>@<ref>")
        repo, parsed_ref = spec.rsplit("@", 1)
        return parsed_ref, repo
    return str(ref), None


def _external_repo_path(
    *,
    module_dir: Path,
    agent: str,
    agent_cfg: dict[str, Any],
    plugin_ref: str | None,
) -> tuple[Path, dict[str, Any]]:
    ref, repo_override = _repo_ref(agent_cfg, plugin_ref)
    if ref.startswith("path:"):
        repo_path = Path(ref.split(":", 1)[1]).expanduser().resolve()
        if not repo_path.exists():
            raise CompatFailure("setup_failure", f"external repo path does not exist: {repo_path}")
        return repo_path, {"source": "path", "path": str(repo_path), "ref": ref}

    path_env = agent_cfg.get("path_env")
    if isinstance(path_env, str) and os.getenv(path_env):
        repo_path = Path(os.environ[path_env]).expanduser().resolve()
        if not repo_path.exists():
            raise CompatFailure("setup_failure", f"{path_env} points at missing path: {repo_path}")
        return repo_path, {"source": "env_path", "path": str(repo_path), "ref": ref, "path_env": path_env}

    repo = repo_override or agent_cfg.get("repo")
    if not isinstance(repo, str) or not repo:
        raise CompatFailure("setup_failure", f"missing repo for external agent {agent}")

    repo_url = repo if repo.startswith(("http://", "https://", "git@")) else f"https://github.com/{repo}.git"
    checkout_dir = module_dir / "checkout" / agent
    checkout_dir.parent.mkdir(parents=True, exist_ok=True)
    init = _run(["git", "init", str(checkout_dir)], cwd=module_dir, module_dir=module_dir, stem="git-init")
    if init.returncode != 0:
        raise CompatFailure("setup_failure", init.stderr.strip() or "git init failed")
    fetch = _run(
        ["git", "fetch", "--depth", "1", repo_url, ref],
        cwd=checkout_dir,
        module_dir=module_dir,
        stem="git-fetch",
        timeout=300,
    )
    if fetch.returncode != 0:
        raise CompatFailure("setup_failure", fetch.stderr.strip() or f"git fetch failed for {repo}@{ref}")
    checkout = _run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=checkout_dir, module_dir=module_dir, stem="git-checkout")
    if checkout.returncode != 0:
        raise CompatFailure("setup_failure", checkout.stderr.strip() or "git checkout failed")
    rev = _run(["git", "rev-parse", "HEAD"], cwd=checkout_dir, module_dir=module_dir, stem="git-rev-parse")
    sha = rev.stdout.strip() if rev.returncode == 0 else ""
    return checkout_dir, {"source": "git", "repo": repo, "repo_url": repo_url, "ref": ref, "sha": sha}


def _install_python_deps(repo_dir: Path, module_dir: Path, deps: list[str]) -> Path:
    venv_dir = module_dir / ".venv"
    create = _run(["python3", "-m", "venv", str(venv_dir)], cwd=repo_dir, module_dir=module_dir, stem="venv-create")
    if create.returncode != 0:
        raise CompatFailure("setup_failure", create.stderr.strip() or "python venv creation failed")
    python = venv_dir / "bin" / "python"
    if not deps:
        return python
    proc = _run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", *deps],
        cwd=repo_dir,
        module_dir=module_dir,
        stem="pip-install",
        timeout=600,
    )
    if proc.returncode != 0:
        raise CompatFailure("setup_failure", proc.stderr.strip() or "pip install failed")
    return python


def _run_hermes_pytest(repo_dir: Path, module_dir: Path) -> dict[str, Any]:
    python = _install_python_deps(repo_dir, module_dir, ["pytest", "httpx"])
    proc = _run([str(python), "-m", "pytest", "-q", "tests/test_mem9.py"], cwd=repo_dir, module_dir=module_dir, stem="pytest")
    if proc.returncode != 0:
        raise CompatFailure("host_contract_break", proc.stderr.strip() or proc.stdout.strip() or "Hermes pytest failed")
    return {"pytest": {"returncode": proc.returncode}}


def _write_script(module_dir: Path, name: str, source: str) -> Path:
    path = module_dir / name
    path.write_text(textwrap.dedent(source), encoding="utf-8")
    return path


def _run_hermes_hosted(repo_dir: Path, module_dir: Path) -> dict[str, Any]:
    base_url = os.getenv("MNEMO_BASE_URL", "").rstrip("/")
    if not base_url:
        raise CompatFailure("setup_failure", "MNEMO_BASE_URL is required for hermes.hosted-contract")
    python = _install_python_deps(repo_dir, module_dir, ["httpx"])
    script = _write_script(
        module_dir,
        "hermes_hosted_contract.py",
        """
        import importlib.util
        import json
        import os
        import sys
        import types
        from pathlib import Path

        repo = Path(sys.argv[1])
        home = Path(os.environ["HERMES_HOME"])
        home.mkdir(parents=True, exist_ok=True)

        agent_pkg = types.ModuleType("agent")
        memory_provider_mod = types.ModuleType("agent.memory_provider")
        class MemoryProvider: pass
        memory_provider_mod.MemoryProvider = MemoryProvider
        agent_pkg.memory_provider = memory_provider_mod

        tools_pkg = types.ModuleType("tools")
        registry_mod = types.ModuleType("tools.registry")
        registry_mod.tool_error = lambda message: json.dumps({"error": message})
        tools_pkg.registry = registry_mod

        hermes_constants_mod = types.ModuleType("hermes_constants")
        hermes_constants_mod.get_hermes_home = lambda: home

        sys.modules["agent"] = agent_pkg
        sys.modules["agent.memory_provider"] = memory_provider_mod
        sys.modules["tools"] = tools_pkg
        sys.modules["tools.registry"] = registry_mod
        sys.modules["hermes_constants"] = hermes_constants_mod

        spec = importlib.util.spec_from_file_location("mem9_hermes", repo / "__init__.py")
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)

        base_url = os.environ["MNEMO_BASE_URL"].rstrip("/")
        tenant = module._Mem9Client.autoprovision(base_url)["id"]
        os.environ["MEM9_API_URL"] = base_url
        os.environ["MEM9_API_KEY"] = tenant
        os.environ["MEM9_AGENT_ID"] = "compat-hermes"

        provider = module.Mem9MemoryProvider()
        provider.initialize("compat-hermes-session", user_id="compat-hermes-user")
        assert provider.is_available()
        provider.prefetch("compat hermes hosted recall")
        provider.sync_turn("Remember compat Hermes hosted smoke.", "Acknowledged.")
        if provider._sync_thread:
            provider._sync_thread.join(timeout=10)
        provider._client.search("compat hermes hosted recall", limit=1)
        print(json.dumps({"tenant": tenant, "ok": True}))
        """,
    )
    env = os.environ.copy()
    env["MNEMO_BASE_URL"] = base_url
    env["HERMES_HOME"] = str(module_dir / "hermes-home")
    proc = _run([str(python), str(script), str(repo_dir)], cwd=repo_dir, module_dir=module_dir, stem="hermes-hosted", env=env)
    if proc.returncode != 0:
        raise CompatFailure("host_contract_break", proc.stderr.strip() or proc.stdout.strip() or "Hermes hosted contract failed")
    return {"hosted": json.loads(proc.stdout.splitlines()[-1])}


def _run_hermes_host_smoke(
    *,
    manifest: dict[str, Any],
    repo_dir: Path,
    module_dir: Path,
    host_ref: str | None,
) -> dict[str, Any]:
    agent_cfg = _agent_config(manifest, "hermes")
    host_cfg = agent_cfg.get("host")
    if not isinstance(host_cfg, dict):
        raise CompatFailure("setup_failure", "missing Hermes host config")

    host_repo = str(host_cfg.get("repo", "") or "")
    if not host_repo:
        raise CompatFailure("setup_failure", "missing Hermes host repo")
    ref = host_ref or str(host_cfg.get("default_ref", "") or "main")
    repo_url = host_repo if host_repo.startswith(("http://", "https://", "git@")) else f"https://github.com/{host_repo}.git"
    checkout_dir = module_dir / "checkout" / "hermes-host"
    checkout_dir.parent.mkdir(parents=True, exist_ok=True)

    init = _run(["git", "init", str(checkout_dir)], cwd=module_dir, module_dir=module_dir, stem="host-git-init")
    if init.returncode != 0:
        raise CompatFailure("setup_failure", init.stderr.strip() or "Hermes host git init failed")
    fetch = _run(
        ["git", "fetch", "--depth", "1", repo_url, ref],
        cwd=checkout_dir,
        module_dir=module_dir,
        stem="host-git-fetch",
        timeout=300,
    )
    if fetch.returncode != 0:
        raise CompatFailure("setup_failure", fetch.stderr.strip() or f"Hermes host git fetch failed for {host_repo}@{ref}")
    checkout = _run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=checkout_dir, module_dir=module_dir, stem="host-git-checkout")
    if checkout.returncode != 0:
        raise CompatFailure("setup_failure", checkout.stderr.strip() or "Hermes host git checkout failed")
    rev = _run(["git", "rev-parse", "HEAD"], cwd=checkout_dir, module_dir=module_dir, stem="host-git-rev-parse")
    host_details = {
        "source": "git",
        "repo": host_repo,
        "repo_url": repo_url,
        "ref": ref,
        "sha": rev.stdout.strip() if rev.returncode == 0 else "",
        "path": str(checkout_dir),
    }
    hosted = _run_hermes_hosted(repo_dir, module_dir)
    return {"host": host_details, **hosted}


def _run_dify_script(repo_dir: Path, module_dir: Path, *, hosted: bool) -> dict[str, Any]:
    if hosted and not os.getenv("MNEMO_BASE_URL", "").rstrip("/"):
        raise CompatFailure("setup_failure", "MNEMO_BASE_URL is required for dify.hosted-contract")
    python = _install_python_deps(repo_dir, module_dir, ["requests"])
    script = _write_script(
        module_dir,
        "dify_contract.py",
        """
        import json
        import os
        import sys
        import types
        import urllib.request
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        repo = Path(sys.argv[1])
        hosted = sys.argv[2] == "hosted"
        sys.path.insert(0, str(repo))

        dify_plugin = types.ModuleType("dify_plugin")
        entities = types.ModuleType("dify_plugin.entities")
        tool_entities = types.ModuleType("dify_plugin.entities.tool")
        errors = types.ModuleType("dify_plugin.errors")
        tool_errors = types.ModuleType("dify_plugin.errors.tool")

        class ToolInvokeMessage(dict): pass
        class Tool:
            def create_json_message(self, payload):
                return payload
        class ToolProvider: pass
        class ToolProviderCredentialValidationError(Exception): pass

        dify_plugin.Tool = Tool
        dify_plugin.ToolProvider = ToolProvider
        tool_entities.ToolInvokeMessage = ToolInvokeMessage
        tool_errors.ToolProviderCredentialValidationError = ToolProviderCredentialValidationError
        sys.modules["dify_plugin"] = dify_plugin
        sys.modules["dify_plugin.entities"] = entities
        sys.modules["dify_plugin.entities.tool"] = tool_entities
        sys.modules["dify_plugin.errors"] = errors
        sys.modules["dify_plugin.errors.tool"] = tool_errors

        from provider.mem9 import Mem9Provider
        from tools.memory_search import MemorySearchTool
        from tools.memory_store import MemoryStoreTool

        class Response:
            def __init__(self, status_code=200, payload=None, text=""):
                self.status_code = status_code
                self._payload = payload or {}
                self.text = text
            def json(self):
                return self._payload

        def invoke(tool, credentials, params):
            tool.runtime = SimpleNamespace(credentials=credentials)
            return list(tool._invoke(params))[0]

        if hosted:
            base_url = os.environ["MNEMO_BASE_URL"].rstrip("/")
            with urllib.request.urlopen(urllib.request.Request(f"{base_url}/v1alpha1/mem9s", data=b"{}", method="POST"), timeout=20) as resp:
                tenant = json.loads(resp.read().decode("utf-8"))["id"]
            credentials = {"auth_mode": "single_space", "mem9_base_url": base_url, "mem9_api_key": tenant, "mem9_agent_id": "compat-dify"}
            Mem9Provider()._validate_credentials(credentials)
            store = invoke(MemoryStoreTool(), credentials, {"content": "Dify hosted compat memory", "session_id": "compat-dify-session"})
            assert store["ok"] is True
            search = invoke(MemorySearchTool(), credentials, {"query": "Dify hosted compat memory", "session_id": "compat-dify-session", "scanAll": True})
            assert search["ok"] is True
            print(json.dumps({"ok": True, "hosted": True, "tenant": tenant}))
            raise SystemExit(0)

        credentials = {"auth_mode": "single_space", "mem9_base_url": "https://mem9.test", "mem9_api_key": "tenant-1", "mem9_agent_id": "compat-dify"}

        with patch("provider.mem9.requests.get", return_value=Response(payload={"memories": [], "total": 0})) as get:
            Mem9Provider()._validate_credentials(credentials)
            assert get.call_args.kwargs["headers"]["X-API-Key"] == "tenant-1"

        missing = invoke(MemorySearchTool(), {"auth_mode": "multi_space", "mem9_base_url": "https://mem9.test"}, {"query": "x"})
        assert missing["ok"] is False and "Multi-space" in missing["error"]

        with patch("tools.memory_search.requests.get", return_value=Response(payload={"memories": [{"content": "fact", "confidence": 90, "score": 0.8}], "total": 1})) as get:
            result = invoke(MemorySearchTool(), credentials, {"query": "fact", "limit": 2, "session_id": "session-1", "scanAll": "true"})
            assert result["ok"] is True
            kwargs = get.call_args.kwargs
            assert kwargs["headers"]["X-Mnemo-Agent-Id"] == "compat-dify"
            assert kwargs["params"]["limit"] == "6"
            assert kwargs["params"]["session_id"] == "session-1"
            assert kwargs["params"]["scanAll"] == "true"

        with patch("tools.memory_store.requests.post", return_value=Response(payload={"status": "accepted"})) as post:
            result = invoke(MemoryStoreTool(), credentials, {"content": "remember this", "session_id": "session-2"})
            assert result["ok"] is True
            kwargs = post.call_args.kwargs
            assert kwargs["headers"]["X-API-Key"] == "tenant-1"
            assert kwargs["json"]["messages"] == [{"role": "user", "content": "remember this"}]
            assert kwargs["json"]["agent_id"] == "compat-dify"
            assert kwargs["json"]["mode"] == "smart"
            assert kwargs["json"]["session_id"] == "session-2"

        print(json.dumps({"ok": True, "hosted": False}))
        """,
    )
    proc = _run(
        [str(python), str(script), str(repo_dir), "hosted" if hosted else "contract"],
        cwd=repo_dir,
        module_dir=module_dir,
        stem="dify-hosted" if hosted else "dify-contract",
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        raise CompatFailure("host_contract_break", proc.stderr.strip() or proc.stdout.strip() or "Dify contract failed")
    return {"dify": json.loads(proc.stdout.splitlines()[-1])}


def run_external_module(
    *,
    manifest: dict[str, Any],
    module_name: str,
    module_cfg: dict[str, Any],
    module_dir: Path,
    plugin_ref: str | None,
    host_ref: str | None = None,
) -> dict[str, Any]:
    agent = str(module_cfg.get("agent", ""))
    agent_cfg = _agent_config(manifest, agent)
    repo_dir, checkout = _external_repo_path(
        module_dir=module_dir,
        agent=agent,
        agent_cfg=agent_cfg,
        plugin_ref=plugin_ref,
    )

    kind = str(module_cfg.get("kind", ""))
    details: dict[str, Any] = {
        "checkout": checkout,
        "repo_dir": str(repo_dir),
    }
    if kind == "hermes-pytest":
        details.update(_run_hermes_pytest(repo_dir, module_dir))
    elif kind == "hermes-hosted":
        details.update(_run_hermes_hosted(repo_dir, module_dir))
    elif kind == "hermes-host-smoke":
        details.update(
            _run_hermes_host_smoke(
                manifest=manifest,
                repo_dir=repo_dir,
                module_dir=module_dir,
                host_ref=host_ref,
            )
        )
    elif kind == "dify-contract":
        details.update(_run_dify_script(repo_dir, module_dir, hosted=False))
    elif kind == "dify-hosted":
        details.update(_run_dify_script(repo_dir, module_dir, hosted=True))
    else:
        raise CompatFailure("setup_failure", f"unsupported external module kind: {kind} for {module_name}")
    details["external_run_id"] = str(uuid.uuid4())
    return details
