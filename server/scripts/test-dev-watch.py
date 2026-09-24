#!/usr/bin/env python3
"""Verify that development reload and shutdown do not orphan the server."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time


def wait_for(predicate, description):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(description)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


with tempfile.TemporaryDirectory(prefix="mem9-dev-watch-") as directory:
    root = Path(directory)
    (root / "server/scripts").mkdir(parents=True)
    (root / "tools").mkdir()
    shutil.copyfile(Path(__file__).with_name("dev-watch.sh"), root / "server/scripts/dev-watch.sh")
    (root / "server/main.go").write_text("package main\n")
    (root / "server/nested/.tmp").mkdir(parents=True)
    cached_source = root / "server/nested/.tmp/dependency.go"
    cached_source.write_text("dependency version 1")
    make = root / "tools/make"
    make.write_text("#!/bin/sh\nexit 0\n")
    make.chmod(0o700)
    fake = root / "server/fake-server"
    fake.write_text("#!/usr/bin/env python3\nimport os,time\nfrom pathlib import Path\nPath(os.environ['TEST_SERVER_PID']).write_text(str(os.getpid()))\nwhile True: time.sleep(1)\n")
    fake.chmod(0o700)
    pidfile = root / "pid"
    env = dict(os.environ, PATH=f"{root / 'tools'}:{os.environ['PATH']}",
               MNEMO_DEV_BIN=str(fake), MNEMO_DEV_WATCH_INTERVAL="0.1", TEST_SERVER_PID=str(pidfile))
    watcher = subprocess.Popen(["bash", str(root / "server/scripts/dev-watch.sh")], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children = []
    try:
        first = wait_for(lambda: int(pidfile.read_text()) if pidfile.exists() else None, "initial server did not start")
        children.append(first)
        cached_source.write_text("dependency version 2")
        time.sleep(0.5)
        assert int(pidfile.read_text()) == first, "dependency cache triggered reload"
        (root / "server/main.go").write_text("package main // changed\n")
        second = wait_for(lambda: int(pidfile.read_text()) if pidfile.exists() and int(pidfile.read_text()) != first else None,
                          "changed source did not reload")
        children.append(second)
        wait_for(lambda: not alive(first), "reload orphaned the old server")
        watcher.send_signal(signal.SIGTERM)
        watcher.wait(timeout=10)
        wait_for(lambda: not alive(second), "shutdown orphaned the server")
        print("PASS: reload and shutdown stop the actual server process")
    finally:
        if watcher.poll() is None:
            watcher.kill()
            watcher.wait()
        for pid in children:
            if alive(pid):
                os.kill(pid, signal.SIGKILL)
