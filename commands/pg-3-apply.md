---
name: 3-pg-apply
description: 3. 启动 pg-apply-change 工作流，逐项实施 pg-propose 的任务条目
trigger: slash
agent: pg-manager
---

# /3-pg-apply <change-name>

change-name: $1

此命令被触发时，系统调度 pg-manager agent（编排器）执行。

执行步骤：
1. 使用 Skill tool 加载 `pg-apply-change` skill
2. 读取 `pg-spec/changes/<change>/tasks.md` 获取任务清单
3. 按 SKILL 定义的工作流依次执行各个 phase
4. 管理 context-chain.md 和 tasks.md 的状态更新
5. 输出最终报告

**示例**:
```
/3-pg-apply add-user-api
/3-pg-apply fix-login-bug
```
