#!/usr/bin/env python3
"""pg-parse-config.py - Unified configuration provider for pg-* SKILLs.

Reads pg-spec/config.yaml as the single source of truth.
Manager calls this with a workflow name to get only the config
that workflow needs — preventing context pollution in sub-agents.

Usage:
  python3 pg-parse-config.py <workflow>               # Filtered by workflow
  python3 pg-parse-config.py                          # Full config (debug)
  python3 pg-parse-config.py --key backend.port       # Single value
  python3 pg-parse-config.py --prefix backend         # Subtree as JSON
"""

import json
import os
import sys

try:
    import yaml
except ImportError:
    print('{"error": "PyYAML is required. Install with: pip install pyyaml"}', file=sys.stderr)
    sys.exit(1)

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "../../pg-spec/config.yaml",
)

# Each workflow only gets the top-level config keys it needs.
# Add new entries when creating pg-* SKILLs.
WORKFLOW_KEYS = {
    "pg-apply-change": ["backend", "frontend", "openapi", "git"],
    "pg-verify-and-merge": ["backend", "frontend", "git"],
    "pg-propose": ["context", "rules", "test_strategy", "coding_standards", "backend", "frontend"],
    "pg-run-e2e": ["backend", "frontend", "e2e", "knownIssues"],
    "pg-fix-issue": ["backend", "frontend"],
    "pg-micro-change": ["backend", "frontend", "openapi", "git"],
}


def load():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_by_path(data, path):
    parts = path.split(".")
    current = data
    for p in parts:
        if isinstance(current, dict) and p in current:
            current = current[p]
        else:
            return None
    return current


def filter_by_workflow(data, workflow):
    keys = WORKFLOW_KEYS.get(workflow)
    if keys is None:
        return data
    return {k: data[k] for k in keys if k in data}


def inject_meta(data):
    import socket
    data["__meta"] = {"hostname": socket.gethostname()}
    return data


def main():
    data = load()
    args = sys.argv[1:]

    if not args:
        print(json.dumps(inject_meta(data), indent=2, ensure_ascii=False))
        return

    # First positional arg as workflow name
    if args[0] in WORKFLOW_KEYS:
        filtered = filter_by_workflow(data, args[0])
        print(json.dumps(inject_meta(filtered), indent=2, ensure_ascii=False))
        return

    i = 0
    while i < len(args):
        if args[i] == "--key" and i + 1 < len(args):
            val = get_by_path(data, args[i + 1])
            print(json.dumps(val, ensure_ascii=False))
            i += 2
        elif args[i] == "--prefix" and i + 1 < len(args):
            val = get_by_path(data, args[i + 1])
            print(json.dumps(val, ensure_ascii=False))
            i += 2
        else:
            print(json.dumps({"error": f"Unknown argument: {args[i]}"}, ensure_ascii=False))
            i += 1


if __name__ == "__main__":
    main()
