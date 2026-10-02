"""Read ✋ reports from the server and mark them handled.

    python tools/reports.py              # open reports
    python tools/reports.py --all        # every report, handled ones included
    python tools/reports.py --done ID [ID ...] [--note "what was fixed"]

The source of truth is the server: /opt/camarero/data/reports.jsonl (the
camarero-api container writes it). Handled ids are kept next to it in
handled.jsonl, so the list is the same from any machine (in LA, local marks
drifted away from the server).
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime

HOST = "hetzner"
DIR = "/opt/camarero/data"


def ssh(cmd, stdin=None):
    r = subprocess.run(["ssh", HOST, cmd], input=stdin, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit(f"ssh failed: {r.stderr.strip()}")
    return r.stdout


def load(name):
    out = ssh(f"cat {DIR}/{name} 2>/dev/null || true")
    return [json.loads(l) for l in out.splitlines() if l.strip()]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--done", nargs="+")
    ap.add_argument("--note", default="")
    a = ap.parse_args()

    if a.done:
        now = datetime.now().isoformat(timespec="seconds")
        lines = "".join(json.dumps({"id": i, "at": now, "note": a.note}, ensure_ascii=False) + "\n" for i in a.done)
        ssh(f"cat >> {DIR}/handled.jsonl", stdin=lines)
        print(f"marked handled: {len(a.done)}")
        return

    reports = load("reports.jsonl")
    handled = {h["id"] for h in load("handled.jsonl")}
    shown = [r for r in reports if a.all or r.get("id") not in handled]
    print(f"{len(reports)} reports total, {len(reports) - len(handled & {r.get('id') for r in reports})} open\n")
    skip = {"id", "text", "tags", "received", "ua", "at", "mode"}
    for r in shown:
        mark = "✓" if r.get("id") in handled else "•"
        print(f"{mark} [{r.get('id')}] {r.get('mode')}  tags: {r.get('tags') or '-'}")
        print(f"   ✋ {r.get('text')}")
        for k, v in r.items():
            if k not in skip and v not in ("", None):
                print(f"   {k}: {v}")
        print()


if __name__ == "__main__":
    main()
