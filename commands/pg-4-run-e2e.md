---
name: 4-pg-run-e2e
description: 4. 自动运行 E2E 测试，并将需要进一步修复问题记录到 KnownIssues.md
trigger: slash
agent: pg-manager
---

# /4-pg-run-e2e

此工作流自动运行 E2E 测试，对每个失败用例进行系统性根因分析和修复。

执行步骤：
1. 使用 Skill tool 加载 `pg-run-e2e` SKILL
2. 按 SKILL 定义执行：前置检查 → 执行测试 → 逐例修复循环 → 汇总报告
3. 输出最终汇总报告

**触发词**:
```
/4-pg-run-e2e
```
