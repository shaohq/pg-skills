#!/usr/bin/env python3
"""pg-e2e-parse-results.py - E2E test result processor.

Commands:
  parse --log-file <path> --out <path>
    Parse playwright test output into structured JSON.

  known-issues --path <KnownIssues.md> --out <path>
    Extract known issue skip list from KnownIssues.md.

  update-known-issues --ki-path <KnownIssues.md> --fix-results <path>
    Update KnownIssues.md from fix-e2e agent results.
"""

import json
import os
import re
import sys
from collections import OrderedDict

COMMANDS = ["parse", "known-issues", "update-known-issues"]


def parse_test_output(log_path):
    with open(log_path, encoding="utf-8") as f:
        content = f.read()

    summary = {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "did_not_run": 0}

    m_total = re.search(r'Running (\d+) tests?', content)
    if m_total:
        summary["total"] = int(m_total.group(1))
    # Search last 30% of content for summary lines (end-of-run block)
    tail_start = int(len(content) * 0.7)
    tail = content[tail_start:]
    m_failed = re.search(r'(\d+)\s+failed', tail)
    if m_failed:
        summary["failed"] = int(m_failed.group(1))
    m_passed = re.search(r'(\d+)\s+passed', tail)
    if m_passed:
        summary["passed"] = int(m_passed.group(1))
    m_skipped = re.search(r'(\d+)\s+skipped', tail)
    if m_skipped:
        summary["skipped"] = int(m_skipped.group(1))
    m_dnr = re.search(r'(\d+)\s+did not run', tail)
    if m_dnr:
        summary["did_not_run"] = int(m_dnr.group(1))

    failure_pattern = re.compile(
        r'^\s+\[([^\]]+)\]\s+›\s+(tests/e2e/[^\s]+?\.spec\.ts):(\d+):(\d+)\s+›\s+(.+)$',
        re.MULTILINE
    )
    failures = []
    for m in failure_pattern.finditer(content):
        failures.append({
            "project": m.group(1),
            "script": m.group(2),
            "line": int(m.group(3)),
            "test_name": m.group(5).strip()
        })

    scripts = OrderedDict()
    for f in failures:
        script = f["script"]
        if script not in scripts:
            scripts[script] = {"script": script, "count": 0, "issues": []}
        scripts[script]["count"] += 1
        scripts[script]["issues"].append({
            "status": "failed",
            "project": f["project"],
            "test": f["test_name"],
            "line": f["line"]
        })

    return {"summary": summary, "failedScripts": list(scripts.values())}


def parse_known_issues(ki_path):
    with open(ki_path, encoding="utf-8") as f:
        content = f.read()

    m = re.search(r'^## Active Known Issues\s*\n(.*?)(?=\n## |\Z)', content, re.DOTALL | re.MULTILINE)
    if not m:
        return {"skippedScripts": [], "issues": []}

    active_section = m.group(1)
    skipped_scripts = []
    issues = []

    issue_blocks = re.split(r'^### Issue\b', active_section, flags=re.MULTILINE)
    for block in issue_blocks:
        block = block.strip()
        if not block:
            continue
        scripts_found = re.findall(r'^\s*-\s+`(tests/e2e/[^`]+)`', block, re.MULTILINE)
        for s in scripts_found:
            if s not in skipped_scripts:
                skipped_scripts.append(s)
        desc_line = block.split('\n')[0].strip()
        issues.append({"description": desc_line, "affectedScripts": scripts_found})

    return {"skippedScripts": skipped_scripts, "issues": issues}


def _parse_field(pattern, text, flags=re.MULTILINE):
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else ""


def _parse_heading_block(block):
    """Parse a single block split by '#### <num>. ' heading."""
    block = block.strip()
    if not block or block.startswith('以下问题根因不在'):
        return None

    lines = block.split('\n')
    title = lines[0].strip() if lines else ""
    if not title or title.startswith('|'):
        return None

    return {
        "title": title,
        "component": _parse_field(r'-\s*\*\*组件\*\*:\s*(.+)', block),
        "file": _parse_field(r'-\s*\*\*文件\*\*:\s*`([^`]+)`', block),
        "affectedTests": _parse_field(r'-\s*\*\*受影响测试\*\*:\s*(.+)', block),
        "expected": _parse_field(r'-\s*\*\*期望行为\*\*:\s*(.+)', block),
        "actual": _parse_field(r'-\s*\*\*实际行为\*\*:\s*(.+)', block),
        "rootCause": _parse_field(r'-\s*\*\*根因描述\*\*:\s*(.+)', block),
        "orchestratorSteps": [
            s.strip() for s in re.findall(r'-\s*步骤 \d+:\s*(.+)', block, re.MULTILINE)
        ]
    }


def _parse_table_block(block):
    """Parse a block where issues are listed in a markdown table with optional **详情**: after."""
    issues = []

    # Extract "**详情**:" after the table (capture once, shared by all table rows)
    detail_match = re.search(
        r'^\*\*详情\*\*\s*:\s*(.+?)$',
        block, re.MULTILINE | re.DOTALL
    )
    root_cause_detail = detail_match.group(1).strip() if detail_match else ""

    # Extract table rows: | num | title | component | affected |
    table_rows = re.findall(
        r'^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|',
        block, re.MULTILINE
    )
    for num, title, component, affected in table_rows:
        title = title.strip()
        if not title or title == '' or title.startswith('#') or title.startswith('---'):
            continue

        # Only keep affected if it looks like script paths (contains `*.spec.ts`)
        affected = affected.strip()
        if not re.search(r'\.spec\.ts', affected):
            affected = ""

        issues.append({
            "title": title,
            "component": component.strip(),
            "file": "",
            "affectedTests": affected,
            "expected": "",
            "actual": "",
            "rootCause": root_cause_detail,
            "orchestratorSteps": []
        })

    return issues


def extract_unfixable_issues(agent_report):
    """Extract unfixable issues from a fix-e2e agent markdown report."""
    issues = []

    # Find "### 无法修复的问题" section
    section_m = re.search(
        r'### 无法修复的问题\s*\n(.*?)(?=\n### |\Z)',
        agent_report, re.DOTALL
    )
    if not section_m:
        return issues

    section = section_m.group(1)

    # Try format 1: "#### <num>. <title>" heading blocks
    heading_blocks = re.split(r'^#### \d+\.\s+', section, flags=re.MULTILINE)
    for block in heading_blocks:
        parsed = _parse_heading_block(block)
        if parsed:
            issues.append(parsed)

    # If heading format yielded nothing, try format 2: markdown table
    if not issues:
        issues = _parse_table_block(section)

    return issues


def extract_fix_stats(agent_report):
    """Extract fix statistics from agent report."""
    stats = {"fixed": 0, "unfixable": 0}
    m = re.search(r'✅\s*已修复:\s*(\d+)', agent_report)
    if m:
        stats["fixed"] = int(m.group(1))
    m = re.search(r'❌\s*无法修复:\s*(\d+)', agent_report)
    if m:
        stats["unfixable"] = int(m.group(1))
    return stats


def extract_overview(agent_report):
    """Extract test overview numbers from agent report."""
    overview = {"total": 0, "passed": 0, "failed": 0, "error": 0}
    m = re.search(r'总测试数:\s*(\d+)', agent_report)
    if m:
        overview["total"] = int(m.group(1))
    m = re.search(r'通过:\s*(\d+)', agent_report)
    if m:
        overview["passed"] = int(m.group(1))
    m = re.search(r'失败:\s*(\d+)', agent_report)
    if m:
        overview["failed"] = int(m.group(1))
    m = re.search(r'错误:\s*(\d+)', agent_report)
    if m:
        overview["error"] = int(m.group(1))
    return overview


def format_known_issue(issue):
    """Format an unfixable issue as a KnownIssues.md block."""
    lines = []
    lines.append(f'### Issue: {issue["title"]}\n')
    lines.append(f'**One-line description**: {issue["title"]}\n')
    lines.append(f'**### Affected Scripts**')
    scripts = re.findall(r'`(tests/e2e/[^`]+)`', issue.get("affectedTests", ""))
    if scripts:
        for t in scripts:
            lines.append(f'- `{t}`')
    else:
        file_path = issue.get("file", "")
        if "tests/e2e/" in file_path:
            lines.append(f'- `{file_path}`')
    lines.append('')
    lines.append(f'**### Root Cause Location**')
    lines.append(f'- **Component**: {issue.get("component", "")}')
    lines.append(f'- **File**: {issue.get("file", "")}')
    lines.append('')
    lines.append(f'**### Failure Mechanism**')
    lines.append(f'- **Expected**: {issue.get("expected", "")}')
    lines.append(f'- **Actual**: {issue.get("actual", "")}')
    lines.append('')
    lines.append(f'**### Suggested Fix**')
    for step in issue.get("orchestratorSteps", []):
        lines.append(f'- {step}')
    if not issue.get("orchestratorSteps"):
        lines.append(f'- {issue.get("rootCause", "待排查")}')
    lines.append('')
    lines.append('---')
    return '\n'.join(lines)


def format_summary_report(date_str, test_run_summary, agents_stats, total_issues):
    """Format the E2E Fix summary report for Fix History."""
    total_scripts = len(agents_stats)
    total_fixed = sum(s["fixed"] for s in agents_stats)
    total_unfixable = sum(s["unfixable"] for s in agents_stats)

    lines = []
    lines.append(f'### E2E Fix 汇总报告 ({date_str})\n')
    lines.append('**执行统计**:')
    lines.append(f'- 总脚本数: {total_scripts}')
    lines.append(f'- 总测试数: {test_run_summary.get("total", 0)}')
    lines.append(f'- 通过: {test_run_summary.get("passed", 0)}')
    lines.append(f'- 失败: {test_run_summary.get("failed", 0)}')
    lines.append(f'- 跳过: {test_run_summary.get("skipped", 0)}\n')
    lines.append('**已修复测试**:')
    lines.append(f'- 共修复: {total_fixed} 个测试\n')
    lines.append('**需要生产代码修复的问题**:')
    lines.append(f'- 共上报: {total_unfixable} 个根因问题\n')
    for i, issue in enumerate(total_issues, 1):
        lines.append(f'{i}. {issue["title"]}')
        lines.append(f'   - 组件: {issue.get("component", "")}')
        lines.append(f'   - 文件: {issue.get("file", "")}')
    lines.append('')
    lines.append('---')
    return '\n'.join(lines)


def _parse_agent_structured(agent):
    """Parse structured data from the new JSON schema (no markdown parsing)."""
    script = agent.get("script", "unknown")
    stats = agent.get("stats", {"fixed": 0, "unfixable": 0})
    issues = agent.get("unfixableIssues", [])
    for iss in issues:
        at = iss.get("affectedTests", "")
        if not at or "tests/e2e/" not in at:
            iss["affectedTests"] = f'`{script}`' + (f' - {at}' if at else '')
    return stats, issues


def update_known_issues(ki_path, fix_results_json):
    """Update KnownIssues.md from fix-e2e agent results."""
    with open(fix_results_json, encoding="utf-8") as f:
        fix_results = json.load(f)

    with open(ki_path, encoding="utf-8") as f:
        content = f.read()

    date_str = fix_results.get("date", "unknown")
    test_run = fix_results.get("testRun", {})
    agents = fix_results.get("agents", [])

    all_issues = []
    agents_stats = []
    for agent in agents:
        script = agent.get("script", "unknown")

        # Prefer structured JSON (new schema), fallback to markdown parsing (old schema)
        if "unfixableIssues" in agent:
            stats, issues = _parse_agent_structured(agent)
        else:
            report = agent.get("report", "")
            stats = extract_fix_stats(report)
            issues = extract_unfixable_issues(report)
            for iss in issues:
                if not iss.get("affectedTests"):
                    iss["affectedTests"] = f'`{script}`'

        all_issues.extend(issues)
        agents_stats.append(stats)

    # --- Update Active Known Issues ---
    if all_issues:
        ki_marker = "## Active Known Issues"
        ki_pos = content.find(ki_marker)
        if ki_pos >= 0:
            # Find end of Active Known Issues section (next ## or end)
            next_section = content.find("\n## ", ki_pos + len(ki_marker))
            if next_section < 0:
                next_section = len(content)
            insert_pos = next_section
            # Build new issue blocks
            new_blocks = []
            for iss in all_issues:
                new_blocks.append(format_known_issue(iss))
            new_content = "\n\n" + "\n\n".join(new_blocks)
            content = content[:insert_pos] + new_content + "\n\n" + content[insert_pos:]

    # --- Update Fix History ---
    summary = format_summary_report(date_str, test_run, agents_stats, all_issues)
    fh_marker = "## Fix History"
    fh_pos = content.find(fh_marker)
    if fh_pos >= 0:
        # Insert after the "## Fix History" line
        insert_pos = fh_pos + len(fh_marker)
        content = content[:insert_pos] + "\n\n" + summary + content[insert_pos:]
    else:
        content += f"\n\n## Fix History\n\n{summary}\n"

    with open(ki_path, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "newIssues": len(all_issues),
        "fixedTests": sum(s["fixed"] for s in agents_stats),
        "unfixableIssues": sum(s["unfixable"] for s in agents_stats),
        "agentsProcessed": len(agents)
    }


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Usage: {sys.argv[0]} <{'|'.join(COMMANDS)}> [args...]", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    if command == "parse":
        log_path = None
        out_path = None
        for i, a in enumerate(args):
            if a == "--log-file" and i + 1 < len(args):
                log_path = args[i + 1]
            if a == "--out" and i + 1 < len(args):
                out_path = args[i + 1]
        if not log_path:
            print("--log-file required", file=sys.stderr)
            sys.exit(1)
        result = parse_test_output(log_path)
        output = json.dumps(result, indent=2, ensure_ascii=False)
        if out_path:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(output)
        print(output)

    elif command == "known-issues":
        ki_path = None
        out_path = None
        for i, a in enumerate(args):
            if a == "--path" and i + 1 < len(args):
                ki_path = args[i + 1]
            if a == "--out" and i + 1 < len(args):
                out_path = args[i + 1]
        if not ki_path:
            print("--path required", file=sys.stderr)
            sys.exit(1)
        result = parse_known_issues(ki_path)
        output = json.dumps(result, indent=2, ensure_ascii=False)
        if out_path:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(output)
        print(output)

    elif command == "update-known-issues":
        ki_path = None
        fix_path = None
        for i, a in enumerate(args):
            if a == "--ki-path" and i + 1 < len(args):
                ki_path = args[i + 1]
            if a == "--fix-results" and i + 1 < len(args):
                fix_path = args[i + 1]
        if not ki_path or not fix_path:
            print("--ki-path and --fix-results required", file=sys.stderr)
            sys.exit(1)
        result = update_known_issues(ki_path, fix_path)
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
