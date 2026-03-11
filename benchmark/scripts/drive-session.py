#!/usr/bin/env python3
"""
drive-session.py — Parallel prompt driver for mnemos Layer 2b benchmarks.

Sends identical prompts to two OpenClaw profiles (A=baseline, B=treatment)
in parallel, captures outputs, and produces structured results + a
human-readable transcript.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml is required. Install with: pip3 install pyyaml", file=sys.stderr)
    sys.exit(1)


def send_prompt(profile: str, message: str, timeout: int, session_id: str = None) -> dict:
    """Send a single prompt to an OpenClaw profile and capture the response."""
    start = time.monotonic()
    try:
        cmd = [
            "openclaw",
            "--profile", profile,
            "agent",
            "--agent", "main",
            "--message", message,
            "--json",
        ]
        if session_id:
            cmd.extend(["--session-id", session_id])
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        elapsed = time.monotonic() - start
        return {
            "profile": profile,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "elapsed_seconds": round(elapsed, 2),
            "error": None,
        }
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - start
        return {
            "profile": profile,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Timeout after {timeout}s",
            "elapsed_seconds": round(elapsed, 2),
            "error": f"Timeout after {timeout}s",
        }
    except Exception as e:
        elapsed = time.monotonic() - start
        return {
            "profile": profile,
            "returncode": -1,
            "stdout": "",
            "stderr": str(e),
            "elapsed_seconds": round(elapsed, 2),
            "error": str(e),
        }


def parse_response(raw: dict) -> str:
    """Extract the assistant's text response from raw output."""
    stdout = raw.get("stdout", "").strip()
    if not stdout:
        return raw.get("stderr", "(no output)")

    # Try to parse as JSON (--json flag output)
    try:
        parsed = json.loads(stdout)
        # OpenClaw JSON output may have different structures
        if isinstance(parsed, dict):
            # Try nested result.payloads[].text (OpenClaw format)
            result = parsed.get("result")
            if isinstance(result, dict):
                payloads = result.get("payloads")
                if isinstance(payloads, list):
                    parts = []
                    for p in payloads:
                        if isinstance(p, dict) and "text" in p:
                            parts.append(p["text"])
                    if parts:
                        return "\n".join(parts)
            # Try common top-level keys
            for key in ("response", "content", "message", "text", "output"):
                if key in parsed:
                    val = parsed[key]
                    if isinstance(val, str):
                        return val
                    if isinstance(val, list):
                        # Content blocks
                        parts = []
                        for block in val:
                            if isinstance(block, dict) and "text" in block:
                                parts.append(block["text"])
                            elif isinstance(block, str):
                                parts.append(block)
                        if parts:
                            return "\n".join(parts)
            # Fall back to full JSON string
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        return stdout
    except json.JSONDecodeError:
        return stdout


def write_transcript(scenario: dict, turns: list, results_dir: str):
    """Write a human-readable markdown transcript."""
    lines = [
        f"# Benchmark Transcript: {scenario['name']}",
        "",
        f"**Description:** {scenario.get('description', 'N/A')}",
        f"**Date:** {datetime.now(timezone.utc).isoformat()}",
        "",
        "---",
        "",
    ]

    for i, turn in enumerate(turns, 1):
        lines.append(f"## Turn {i}")
        lines.append("")
        lines.append("### Prompt")
        lines.append("")
        lines.append(f"```\n{turn['prompt'].strip()}\n```")
        lines.append("")

        lines.append("### Profile A (Baseline)")
        lines.append("")
        resp_a = turn["response_a"]
        lines.append(f"*Elapsed: {resp_a['elapsed_seconds']}s | "
                      f"Exit code: {resp_a['returncode']}*")
        lines.append("")
        lines.append(resp_a["parsed_response"])
        lines.append("")

        lines.append("### Profile B (Treatment / mnemo)")
        lines.append("")
        resp_b = turn["response_b"]
        lines.append(f"*Elapsed: {resp_b['elapsed_seconds']}s | "
                      f"Exit code: {resp_b['returncode']}*")
        lines.append("")
        lines.append(resp_b["parsed_response"])
        lines.append("")
        lines.append("---")
        lines.append("")

    path = os.path.join(results_dir, "transcript.md")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"    Transcript written to {path}")


def write_results_json(scenario: dict, turns: list, results_dir: str):
    """Write structured JSON results."""
    output = {
        "scenario": scenario["name"],
        "description": scenario.get("description", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "turns": turns,
    }
    path = os.path.join(results_dir, "benchmark-results.json")
    with open(path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"    Results JSON written to {path}")


def main():
    parser = argparse.ArgumentParser(description="Drive benchmark sessions")
    parser.add_argument("--prompt-file", required=True, help="YAML prompt file")
    parser.add_argument("--results-dir", required=True, help="Output directory")
    parser.add_argument("--profile-a", required=True, help="Baseline profile name")
    parser.add_argument("--profile-b", required=True, help="Treatment profile name")
    parser.add_argument("--timeout", type=int, default=600, help="Per-prompt timeout (seconds)")
    args = parser.parse_args()

    # Load scenario
    with open(args.prompt_file) as f:
        scenario = yaml.safe_load(f)

    prompts = scenario.get("prompts", [])
    if not prompts:
        print("ERROR: No prompts found in scenario file.", file=sys.stderr)
        sys.exit(1)

    print(f"    Scenario: {scenario['name']}")
    print(f"    Prompts:  {len(prompts)}")
    print(f"    Timeout:  {args.timeout}s per prompt")
    print()

    os.makedirs(args.results_dir, exist_ok=True)
    turns = []

    # Stable session IDs so all prompts share one conversation per profile
    session_a = f"bench-{scenario['name']}-a"
    session_b = f"bench-{scenario['name']}-b"
    print(f"    Session A: {session_a}")
    print(f"    Session B: {session_b}")
    print()

    for i, prompt in enumerate(prompts, 1):
        prompt_text = prompt.strip()
        print(f"  --- Turn {i}/{len(prompts)} ---")
        print(f"    Prompt: {prompt_text[:80]}{'...' if len(prompt_text) > 80 else ''}")

        # Send to both profiles in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(send_prompt, args.profile_a, prompt_text, args.timeout, session_a)
            future_b = executor.submit(send_prompt, args.profile_b, prompt_text, args.timeout, session_b)
            raw_a = future_a.result()
            raw_b = future_b.result()

        # Parse responses
        raw_a["parsed_response"] = parse_response(raw_a)
        raw_b["parsed_response"] = parse_response(raw_b)

        turn = {
            "turn": i,
            "prompt": prompt_text,
            "response_a": raw_a,
            "response_b": raw_b,
        }
        turns.append(turn)

        print(f"    A: {raw_a['elapsed_seconds']}s (exit={raw_a['returncode']})")
        print(f"    B: {raw_b['elapsed_seconds']}s (exit={raw_b['returncode']})")
        print()

    # Write outputs
    write_transcript(scenario, turns, args.results_dir)
    write_results_json(scenario, turns, args.results_dir)

    print()
    print(f"    Done. {len(turns)} turns completed.")


if __name__ == "__main__":
    main()
