---
name: 2-pg-micro
description: 2a. 快速实现小型变更——单 agent 按全栈管线自动完成，无需审批文档
trigger: slash
---

# Pg Micro Change

**技能**: `pg-micro-change`

**用法**: `/2-pg-micro [变更描述]`

直接描述需求即可，例如：

- `/2-pg-micro 用户列表页增加邮箱搜索功能`
- `/2-pg-micro 在 model 详情页添加版本删除按钮`
- `/2-pg-micro 新增根据项目 ID 查找运行时的 API`

适合小型变更（~8 个文件以内）。完整变更请使用 `/2-pg-propose`。

> **注意**：如果需求已在当前对话中讨论明确，直接基于对话上下文执行 Phase 0 的步骤 0.2 分析需求和 0.3 展示计划确认即可，但 **步骤 0.0 自检、0.4 自核查和 question 确认不可跳过**。
