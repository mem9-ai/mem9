from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .external import run_external_module
from .manifest import load_manifest
from .openclaw import CompatFailure, run_openclaw_module


@dataclass
class ResultRecord:
    run_id: str
    lane: str
    agent: str
    module: str
    host_channel: str
    host_version_detected: str
    plugin_source: str
    plugin_version: str
    model_profile: str
    status: str
    failure_class: str
    artifacts: list[str]
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _read_plugin_version(repo_root: Path, agent: str) -> str:
    if agent == "openclaw":
        package_path = repo_root / "openclaw-plugin" / "package.json"
    elif agent == "opencode":
        package_path = repo_root / "opencode-plugin" / "package.json"
    elif agent == "codex":
        package_path = repo_root / "codex-plugin" / "package.json"
    else:
        return ""

    try:
        payload = json.loads(package_path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    version = payload.get("version")
    return version if isinstance(version, str) else ""


def _host_version_from_details(details: dict[str, Any]) -> str:
    probe = details.get("probe")
    if isinstance(probe, dict):
        version_text = probe.get("version_text")
        if isinstance(version_text, str):
            return version_text
    return ""


def _module_output_dir(
    *,
    repo_root: Path,
    run_id: str,
    module_name: str,
    artifacts_root: str | None,
) -> Path:
    root = Path(artifacts_root) if artifacts_root else repo_root / "compat" / "artifacts"
    module_dir = root / run_id / module_name
    module_dir.mkdir(parents=True, exist_ok=True)
    return module_dir


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_module(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    module_name: str,
    lane: str,
    host_channel: str,
    model_profile: str,
    plugin_source: str,
    agent_ref: str | None = None,
    run_id: str | None = None,
    artifacts_root: str | None = None,
) -> ResultRecord:
    modules = manifest.get("modules", {})
    module_cfg = modules.get(module_name)
    if not isinstance(module_cfg, dict):
        raise ValueError(f"unknown module: {module_name}")

    run_id = run_id or str(uuid.uuid4())
    agent = str(module_cfg.get("agent", ""))
    module_dir = _module_output_dir(
        repo_root=repo_root,
        run_id=run_id,
        module_name=module_name,
        artifacts_root=artifacts_root,
    )

    start = time.time()
    details: dict[str, Any] = {}
    status = "passed"
    failure_class = ""

    try:
        kind = module_cfg.get("kind")
        if kind == "openclaw":
            details = run_openclaw_module(
                repo_root=repo_root,
                module_dir=module_dir,
                manifest=manifest,
                module_name=module_name,
                host_channel=host_channel,
                model_profile_name=model_profile,
                plugin_source=plugin_source,
            )
        elif kind in {"hermes-pytest", "hermes-hosted", "dify-contract", "dify-hosted"}:
            details = run_external_module(
                manifest=manifest,
                module_name=module_name,
                module_cfg=module_cfg,
                module_dir=module_dir,
                agent_ref=agent_ref,
            )
        elif kind == "command":
            argv = module_cfg.get("argv")
            if not isinstance(argv, list) or not all(isinstance(item, str) for item in argv):
                raise CompatFailure("setup_failure", f"invalid argv for module {module_name}")
            proc = subprocess.run(
                argv,
                cwd=str(repo_root),
                env={
                    **os.environ.copy(),
                    "COMPAT_AGENT_REF": agent_ref or "",
                },
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            (module_dir / "command.stdout.txt").write_text(proc.stdout, encoding="utf-8")
            (module_dir / "command.stderr.txt").write_text(proc.stderr, encoding="utf-8")
            details = {"argv": argv, "returncode": proc.returncode}
            if proc.returncode != 0:
                raise CompatFailure(str(module_cfg.get("failure_class", "host_contract_break")), proc.stderr.strip())
        else:
            raise CompatFailure("setup_failure", f"unsupported module kind for {module_name}: {kind}")
    except CompatFailure as exc:
        status = "failed"
        failure_class = exc.failure_class
        details.setdefault("error", str(exc))
    except Exception as exc:  # noqa: BLE001
        status = "failed"
        failure_class = "env_flake"
        details.setdefault("error", str(exc))

    details["duration_seconds"] = round(time.time() - start, 3)
    write_json(module_dir / "details.json", details)

    result = ResultRecord(
        run_id=run_id,
        lane=lane,
        agent=agent,
        module=module_name,
        host_channel=host_channel,
        host_version_detected=_host_version_from_details(details),
        plugin_source=plugin_source,
        plugin_version=_read_plugin_version(repo_root, agent),
        model_profile=model_profile,
        status=status,
        failure_class=failure_class,
        artifacts=[str(module_dir)],
        details=details,
    )
    write_json(module_dir / "result.json", result.to_dict())
    return result


def run_suite(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    suite_name: str,
    lane: str,
    host_channel: str,
    model_profile: str,
    plugin_source: str,
    agent_ref: str | None = None,
    artifacts_root: str | None = None,
) -> dict[str, Any]:
    suites = manifest.get("suites", {})
    suite_cfg = suites.get(suite_name)
    if not isinstance(suite_cfg, dict):
        raise ValueError(f"unknown suite: {suite_name}")
    run_id = str(uuid.uuid4())
    results = []
    for module_name in suite_cfg.get("modules", []):
        if not isinstance(module_name, str):
            raise ValueError(f"invalid module entry in suite {suite_name}: {module_name!r}")
        result = run_module(
            repo_root=repo_root,
            manifest=manifest,
            module_name=module_name,
            lane=lane,
            host_channel=host_channel,
            model_profile=model_profile,
            plugin_source=plugin_source,
            agent_ref=agent_ref,
            run_id=run_id,
            artifacts_root=artifacts_root,
        )
        results.append(result.to_dict())
        if result.status == "failed" and not bool(suite_cfg.get("continue_on_failure", False)):
            break

    summary = {
        "run_id": run_id,
        "suite": suite_name,
        "lane": lane,
        "host_channel": host_channel,
        "model_profile": model_profile,
        "plugin_source": plugin_source,
        "agent_ref": agent_ref or "",
        "results": results,
        "status": "failed" if any(item["status"] == "failed" for item in results) else "passed",
    }
    suite_dir = _module_output_dir(
        repo_root=repo_root,
        run_id=run_id,
        module_name=f"suite-{suite_name}",
        artifacts_root=artifacts_root,
    )
    write_json(suite_dir / "summary.json", summary)
    return summary


def run_matrix(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    lane_name: str,
    agent_ref: str | None = None,
    artifacts_root: str | None = None,
) -> dict[str, Any]:
    matrices = manifest.get("matrices", {})
    matrix_cfg = matrices.get(lane_name)
    if not isinstance(matrix_cfg, dict):
        raise ValueError(f"unknown matrix: {lane_name}")

    run_id = str(uuid.uuid4())
    task_results: list[dict[str, Any]] = []
    for task in matrix_cfg.get("tasks", []):
        if not isinstance(task, dict):
            raise ValueError(f"invalid task in matrix {lane_name}: {task!r}")
        kind = task.get("kind")
        if kind == "suite":
            summary = run_suite(
                repo_root=repo_root,
                manifest=manifest,
                suite_name=str(task["suite"]),
                lane=lane_name,
                host_channel=str(task.get("host_channel", "stable")),
                model_profile=str(task.get("model_profile", "primary")),
                plugin_source=str(task.get("plugin_source", "local")),
                agent_ref=agent_ref,
                artifacts_root=artifacts_root,
            )
            task_results.append({"name": task.get("name", task["suite"]), "kind": "suite", "summary": summary})
        elif kind == "command":
            argv = task.get("argv")
            if not isinstance(argv, list) or not all(isinstance(item, str) for item in argv):
                raise ValueError(f"invalid argv in matrix {lane_name}: {task!r}")
            proc = subprocess.run(
                argv,
                cwd=str(repo_root),
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            task_dir = _module_output_dir(
                repo_root=repo_root,
                run_id=run_id,
                module_name=str(task.get("name", "command")),
                artifacts_root=artifacts_root,
            )
            (task_dir / "stdout.txt").write_text(proc.stdout, encoding="utf-8")
            (task_dir / "stderr.txt").write_text(proc.stderr, encoding="utf-8")
            task_results.append(
                {
                    "name": task.get("name", "command"),
                    "kind": "command",
                    "argv": argv,
                    "returncode": proc.returncode,
                    "status": "passed" if proc.returncode == 0 else "failed",
                    "artifacts": [str(task_dir)],
                }
            )
            if proc.returncode != 0:
                break
        else:
            raise ValueError(f"unsupported matrix task kind: {kind}")

    summary = {
        "run_id": run_id,
        "lane": lane_name,
        "agent_ref": agent_ref or "",
        "tasks": task_results,
        "status": "failed" if any(task.get("status") == "failed" or task.get("summary", {}).get("status") == "failed" for task in task_results) else "passed",
    }
    matrix_dir = _module_output_dir(
        repo_root=repo_root,
        run_id=run_id,
        module_name=f"matrix-{lane_name}",
        artifacts_root=artifacts_root,
    )
    write_json(matrix_dir / "summary.json", summary)
    return summary


def _agent_lane_plan(manifest: dict[str, Any], lane: str, agent: str) -> list[dict[str, Any]]:
    lanes = manifest.get("agent_lanes", {})
    lane_cfg = lanes.get(lane)
    if not isinstance(lane_cfg, dict):
        raise ValueError(f"unknown agent lane: {lane}")
    if agent == "all":
        agents = ["openclaw", "hermes", "claude", "opencode", "codex", "dify"]
        plan: list[dict[str, Any]] = []
        for item_agent in agents:
            plan.extend(_agent_lane_plan(manifest, lane, item_agent))
        return plan
    agent_cfg = lane_cfg.get(agent)
    if not isinstance(agent_cfg, list):
        raise ValueError(f"agent {agent!r} is not configured for lane {lane!r}")
    return [item for item in agent_cfg if isinstance(item, dict)]


def run_agent_lane(
    *,
    repo_root: Path,
    manifest: dict[str, Any],
    agent: str,
    lane: str,
    host_channel: str,
    model_profile: str,
    plugin_source: str,
    agent_ref: str | None = None,
    artifacts_root: str | None = None,
) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    task_results: list[dict[str, Any]] = []
    for task in _agent_lane_plan(manifest, lane, agent):
        kind = task.get("kind")
        resolved_plugin_source = str(task.get("plugin_source", plugin_source)) if plugin_source == "manifest" else plugin_source
        if kind == "module":
            result = run_module(
                repo_root=repo_root,
                manifest=manifest,
                module_name=str(task["module"]),
                lane=lane,
                host_channel=str(task.get("host_channel", host_channel)),
                model_profile=str(task.get("model_profile", model_profile)),
                plugin_source=resolved_plugin_source,
                agent_ref=agent_ref,
                run_id=run_id,
                artifacts_root=artifacts_root,
            )
            task_results.append({"name": task.get("name", task["module"]), "kind": "module", "result": result.to_dict()})
            if result.status == "failed":
                break
        elif kind == "suite":
            summary = run_suite(
                repo_root=repo_root,
                manifest=manifest,
                suite_name=str(task["suite"]),
                lane=lane,
                host_channel=str(task.get("host_channel", host_channel)),
                model_profile=str(task.get("model_profile", model_profile)),
                plugin_source=resolved_plugin_source,
                agent_ref=agent_ref,
                artifacts_root=artifacts_root,
            )
            task_results.append({"name": task.get("name", task["suite"]), "kind": "suite", "summary": summary})
            if summary["status"] == "failed":
                break
        else:
            raise ValueError(f"unsupported agent lane task kind: {kind}")

    status = "failed" if any(
        task.get("result", {}).get("status") == "failed"
        or task.get("summary", {}).get("status") == "failed"
        for task in task_results
    ) else "passed"
    summary = {
        "run_id": run_id,
        "agent": agent,
        "lane": lane,
        "host_channel": host_channel,
        "model_profile": model_profile,
        "plugin_source": plugin_source,
        "agent_ref": agent_ref or "",
        "tasks": task_results,
        "status": status,
    }
    agent_dir = _module_output_dir(
        repo_root=repo_root,
        run_id=run_id,
        module_name=f"agent-{agent}-{lane}",
        artifacts_root=artifacts_root,
    )
    write_json(agent_dir / "summary.json", summary)
    return summary


def load_default_manifest(repo_root: Path) -> dict[str, Any]:
    return load_manifest(repo_root / "compat" / "manifest.yaml")
