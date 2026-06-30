from __future__ import annotations

import argparse
import json
from pathlib import Path

from .runtime import load_default_manifest, run_agent_lane, run_matrix, run_module, run_suite


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="mem9 compatibility test harness")
    parser.add_argument("--manifest", default=None, help="Path to compat manifest (defaults to compat/manifest.yaml)")
    parser.add_argument("--artifacts-root", default=None, help="Override artifacts root directory")

    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run a single compat module")
    run_parser.add_argument("module")
    run_parser.add_argument("--lane", default="ad-hoc")
    run_parser.add_argument("--host-channel", default="stable")
    run_parser.add_argument("--model-profile", default="primary")
    run_parser.add_argument("--plugin-source", default="local")
    run_parser.add_argument("--plugin-ref", default=None)
    run_parser.add_argument("--host-ref", default=None)
    run_parser.add_argument("--agent-ref", default=None, help=argparse.SUPPRESS)
    run_parser.add_argument("--manifest", default=None)
    run_parser.add_argument("--artifacts-root", default=None)

    suite_parser = subparsers.add_parser("suite", help="Run a compat suite")
    suite_parser.add_argument("suite")
    suite_parser.add_argument("--lane", default="ad-hoc")
    suite_parser.add_argument("--host-channel", default="stable")
    suite_parser.add_argument("--model-profile", default="primary")
    suite_parser.add_argument("--plugin-source", default="local")
    suite_parser.add_argument("--plugin-ref", default=None)
    suite_parser.add_argument("--host-ref", default=None)
    suite_parser.add_argument("--agent-ref", default=None, help=argparse.SUPPRESS)
    suite_parser.add_argument("--manifest", default=None)
    suite_parser.add_argument("--artifacts-root", default=None)

    agent_parser = subparsers.add_parser("agent", help="Run one agent for a compatibility lane")
    agent_parser.add_argument("agent", choices=["openclaw", "hermes", "claude", "opencode", "codex", "dify", "all"])
    agent_parser.add_argument(
        "--lane",
        default="plugin-contract",
        choices=["plugin-contract", "host-smoke", "full", "contract", "hosted-smoke"],
    )
    agent_parser.add_argument("--host-channel", default="stable")
    agent_parser.add_argument("--model-profile", default="primary")
    agent_parser.add_argument("--plugin-source", default="manifest")
    agent_parser.add_argument("--plugin-ref", default=None)
    agent_parser.add_argument("--host-ref", default=None)
    agent_parser.add_argument("--agent-ref", default=None, help=argparse.SUPPRESS)
    agent_parser.add_argument("--manifest", default=None)
    agent_parser.add_argument("--artifacts-root", default=None)

    matrix_parser = subparsers.add_parser("matrix", help="Run a compat matrix lane")
    matrix_parser.add_argument("lane")
    matrix_parser.add_argument("--plugin-ref", default=None)
    matrix_parser.add_argument("--host-ref", default=None)
    matrix_parser.add_argument("--agent-ref", default=None, help=argparse.SUPPRESS)
    matrix_parser.add_argument("--manifest", default=None)
    matrix_parser.add_argument("--artifacts-root", default=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[1]
    manifest = load_default_manifest(repo_root)
    if args.manifest:
        from .manifest import load_manifest

        manifest = load_manifest(args.manifest)

    def compat_plugin_ref() -> str | None:
        return args.plugin_ref or args.agent_ref

    def compat_host_ref() -> str | None:
        return args.host_ref

    def compat_lane(value: str) -> str:
        if value == "contract":
            return "plugin-contract"
        if value == "hosted-smoke":
            return "host-smoke"
        return value

    if args.command == "run":
        result = run_module(
            repo_root=repo_root,
            manifest=manifest,
            module_name=args.module,
            lane=args.lane,
            host_channel=args.host_channel,
            model_profile=args.model_profile,
            plugin_source=args.plugin_source,
            plugin_ref=compat_plugin_ref(),
            host_ref=compat_host_ref(),
            artifacts_root=args.artifacts_root,
        )
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return 0 if result.status == "passed" else 1

    if args.command == "suite":
        summary = run_suite(
            repo_root=repo_root,
            manifest=manifest,
            suite_name=args.suite,
            lane=args.lane,
            host_channel=args.host_channel,
            model_profile=args.model_profile,
            plugin_source=args.plugin_source,
            plugin_ref=compat_plugin_ref(),
            host_ref=compat_host_ref(),
            artifacts_root=args.artifacts_root,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if summary["status"] == "passed" else 1

    if args.command == "agent":
        summary = run_agent_lane(
            repo_root=repo_root,
            manifest=manifest,
            agent=args.agent,
            lane=compat_lane(args.lane),
            host_channel=args.host_channel,
            model_profile=args.model_profile,
            plugin_source=args.plugin_source,
            plugin_ref=compat_plugin_ref(),
            host_ref=compat_host_ref(),
            artifacts_root=args.artifacts_root,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if summary["status"] == "passed" else 1

    if args.command == "matrix":
        summary = run_matrix(
            repo_root=repo_root,
            manifest=manifest,
            lane_name=args.lane,
            plugin_ref=args.plugin_ref or args.agent_ref,
            host_ref=args.host_ref,
            artifacts_root=args.artifacts_root,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if summary["status"] == "passed" else 1

    parser.error(f"unknown command: {args.command}")
    return 2
