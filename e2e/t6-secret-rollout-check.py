#!/usr/bin/env python3
"""Live check for the protected-secret rollout (T6, PR #490).

Run it against one environment before and after each rollout step. It proves
that every path reading a protected column still works:

  tenants.db_password    provision a Space, then list and write memories
                         (the server decrypts the password to reach the Space)
  tenants.claim_url      provisioning succeeds (it is encrypted on write)
  webhook secret         create a webhook, send a test event, rotate, test again;
                         the target is a reserved .invalid host, so the
                         dispatcher decrypts the secret and then fails DNS
                         lookup: nothing leaves the server
  outbox subjects        not reachable over HTTP; use migrate-secrets dry-run
                         and verify, and the metrics below

Spaces created by earlier runs are kept in a state file (mode 0600) and checked
again on every run, so a Space created before a step is read after it.

API keys, claim URLs and signing secrets are never printed; Spaces are shown by
a short SHA-256 fingerprint.

Usage:
  MNEMO_BASE=http://127.0.0.1:18080 python3 -I e2e/t6-secret-rollout-check.py <label>

Environment:
  MNEMO_BASE            required; no default, so prod is never hit by accident
  T6_STATE_FILE         default ~/.mem9-t6-check-<host>.json
  T6_PROVISION          1 (default) provisions one new Space for this run; 0 skips
  T6_EXISTING_KEY_FILE  optional file holding the API key of a Space that existed
                        before the rollout; checked like the others
  MNEMO_METRICS_URL     optional /metrics URL (for example through port-forward)
  POLL_TIMEOUT_S        default 90
"""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("MNEMO_BASE", "").rstrip("/")
POLL_TIMEOUT_S = int(os.environ.get("POLL_TIMEOUT_S", "90"))
PROVISION = os.environ.get("T6_PROVISION", "1") == "1"
AGENT_ID = "t6-rollout-check"
INVALID_WEBHOOK_URL = "https://t6-rollout-check.invalid/hook"

results = []


def fingerprint(key):
    return "sp-" + hashlib.sha256(key.encode()).hexdigest()[:8]


def record(ok, desc):
    results.append(ok)
    print(("  PASS " if ok else "  FAIL ") + desc, flush=True)
    return ok


def request(method, path, key=None, body=None, timeout=30):
    headers = {"Accept": "application/json", "X-Mnemo-Agent-Id": AGENT_ID}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if key is not None:
        headers["X-API-Key"] = key
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as err:
        raw = err.read()
        status = err.code
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return 0, {"error": type(err).__name__}
    try:
        payload = json.loads(raw) if raw else {}
    except ValueError:
        payload = {}
    return status, payload


def load_state(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {"spaces": []}


def save_state(path, state):
    old = os.umask(0o077)
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(state, fh, indent=2)
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        os.umask(old)


def check_space(key, label):
    fp = fingerprint(key)
    print(f"\n[{fp}] created in: {label}", flush=True)

    status, payload = request("GET", "/v1alpha2/status", key)
    record(status == 200 and payload.get("status") == "active", f"{fp} key status is active (HTTP {status})")

    status, payload = request("GET", "/v1alpha2/mem9s/memories?limit=5", key)
    if not record(status == 200 and "memories" in payload, f"{fp} list memories reaches the Space DB (HTTP {status})"):
        return
    before = payload.get("total", 0)

    marker = f"t6-rollout-check {label} {int(time.time())}"
    status, _ = request("POST", "/v1alpha2/mem9s/memories", key, {"content": marker, "tags": ["t6-rollout-check"]})
    if not record(status == 202, f"{fp} write memory accepted (HTTP {status})"):
        return
    deadline = time.time() + POLL_TIMEOUT_S
    total = before
    while time.time() < deadline:
        status, payload = request("GET", "/v1alpha2/mem9s/memories?limit=5", key)
        total = payload.get("total", 0) if status == 200 else total
        if total > before:
            break
        time.sleep(3)
    record(total > before, f"{fp} written memory is readable ({before} -> {total})")


def wait_delivery(key, delivery_id):
    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        status, payload = request("GET", "/v1alpha2/mem9s/webhook-deliveries", key)
        if status == 200:
            for delivery in payload.get("deliveries", []):
                if delivery.get("id") == delivery_id and delivery.get("last_error"):
                    return delivery["last_error"]
        time.sleep(3)
    return ""


def check_webhook(key):
    fp = fingerprint(key)
    print(f"\n[{fp}] webhook secret round trip", flush=True)
    status, payload = request("POST", "/v1alpha2/mem9s/webhooks", key, {
        "name": "t6-rollout-check", "url": INVALID_WEBHOOK_URL, "events": ["memory.added"],
    })
    webhook_id = payload.get("id", "")
    if not record(status == 201 and webhook_id and payload.get("signing_secret"), f"{fp} create webhook (HTTP {status})"):
        return
    try:
        for step in ("created", "rotated"):
            if step == "rotated":
                status, payload = request("POST", f"/v1alpha2/mem9s/webhooks/{webhook_id}/rotate-secret", key)
                if not record(status == 200 and payload.get("signing_secret"), f"{fp} rotate webhook secret (HTTP {status})"):
                    return
            status, payload = request("POST", f"/v1alpha2/mem9s/webhooks/{webhook_id}/test", key)
            delivery_id = payload.get("delivery", {}).get("id", "")
            if not record(status == 202 and delivery_id, f"{fp} enqueue test event with {step} secret (HTTP {status})"):
                return
            last_error = wait_delivery(key, delivery_id)
            decrypted = bool(last_error) and "decrypt" not in last_error and "resolve webhook destination" in last_error
            reason = "secret decrypted, DNS lookup failed as intended" if decrypted else (last_error[:80] or "no attempt within timeout")
            record(decrypted, f"{fp} dispatcher decrypted the {step} secret ({reason})")
    finally:
        status, _ = request("DELETE", f"/v1alpha2/mem9s/webhooks/{webhook_id}", key)
        record(status == 204, f"{fp} delete test webhook (HTTP {status})")


def check_metrics(url):
    print("\n[metrics]", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            text = resp.read().decode()
    except (urllib.error.URLError, OSError) as err:
        record(False, f"fetch metrics ({type(err).__name__})")
        return
    totals = {}
    for line in text.splitlines():
        if line.startswith("mnemo_secret_"):
            name = line.split("{", 1)[0].split(" ", 1)[0]
            totals[name] = totals.get(name, 0.0) + float(line.rsplit(" ", 1)[1])
    print(f"  mnemo_secret_legacy_reads_total  = {totals.get('mnemo_secret_legacy_reads_total', 0):.0f}  (per pod since start; should stop growing after backfill)")
    record(totals.get("mnemo_secret_decrypt_errors_total", 0) == 0,
           f"mnemo_secret_decrypt_errors_total = {totals.get('mnemo_secret_decrypt_errors_total', 0):.0f}")


def main():
    if not BASE or len(sys.argv) != 2:
        print(__doc__)
        return 2
    label = sys.argv[1]
    host = urllib.parse.urlsplit(BASE).hostname or "unknown"
    state_file = os.environ.get("T6_STATE_FILE", os.path.expanduser(f"~/.mem9-t6-check-{host}.json"))
    state = load_state(state_file)
    print(f"T6 secret rollout check  label={label}  base={BASE}  state={state_file}")

    status, payload = request("GET", "/healthz")
    if not record(status == 200 and payload.get("status") == "ok", f"healthz (HTTP {status})"):
        return 1

    if PROVISION:
        status, payload = request("POST", "/v1alpha1/mem9s", timeout=120)
        key = payload.get("id", "")
        if record(status == 201 and key, f"provision a new Space (HTTP {status})"):
            state["spaces"].append({"label": label, "key": key, "created_at": int(time.time())})
            save_state(state_file, state)

    spaces = [(s["key"], s["label"]) for s in state["spaces"]]
    existing_file = os.environ.get("T6_EXISTING_KEY_FILE")
    if existing_file:
        with open(existing_file) as fh:
            spaces.insert(0, (fh.read().strip(), "pre-existing"))
    if not spaces:
        record(False, "no Space to check (set T6_PROVISION=1 or T6_EXISTING_KEY_FILE)")
    for key, created in spaces:
        check_space(key, created)
    if spaces:
        check_webhook(spaces[-1][0])

    metrics_url = os.environ.get("MNEMO_METRICS_URL")
    if metrics_url:
        check_metrics(metrics_url)

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} checks passed  label={label}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
