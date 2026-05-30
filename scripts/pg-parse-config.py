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
  python3 pg-parse-config.py <workflow> --project-dir <path>  # Specify project root
"""

import argparse
import json
import os
import sys

try:
    import yaml
except ImportError:
    print('{"error": "PyYAML is required. Install with: pip install pyyaml"}', file=sys.stderr)
    sys.exit(1)


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow", nargs="?", help="Workflow name to filter config")
    parser.add_argument("--key", help="Get a single config value by dot path")
    parser.add_argument("--prefix", help="Get a config subtree by key")
    parser.add_argument("--project-dir", default=os.getcwd(), help="Project root directory")
    return parser.parse_args(argv[1:])


CONFIG_PATH = os.path.join(os.getcwd(), "pg-spec/config.yaml")

# Each workflow only gets the top-level config keys it needs.
# Add new entries when creating pg-* SKILLs.
WORKFLOW_KEYS = {
    "pg-apply-change": ["scripts", "backend", "frontend", "openapi", "git"],
    "pg-verify-and-merge": ["scripts", "backend", "frontend", "git"],
    "pg-propose": ["scripts", "context", "rules", "test_strategy", "coding_standards", "backend", "frontend"],
    "pg-run-e2e": ["scripts", "backend", "frontend", "e2e", "knownIssues"],
    "pg-fix-issue": ["scripts", "backend", "frontend"],
    "pg-micro-change": ["scripts", "backend", "frontend", "openapi", "git"],
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
    args = parse_args(sys.argv)

    # Resolve config path relative to project-dir
    global CONFIG_PATH
    CONFIG_PATH = os.path.join(args.project_dir, "pg-spec/config.yaml")

    data = load()

    if args.workflow:
        filtered = filter_by_workflow(data, args.workflow)
        print(json.dumps(inject_meta(filtered), indent=2, ensure_ascii=False))
    elif args.key:
        val = get_by_path(data, args.key)
        print(json.dumps(val, ensure_ascii=False))
    elif args.prefix:
        val = get_by_path(data, args.prefix)
        print(json.dumps(val, ensure_ascii=False))
    else:
        print(json.dumps(inject_meta(data), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
