# pg-skills

一套基于 OpenCode 的标准化开发工作流。通过 `pg-apply`、`pg-fix-issue` 等命令，自动完成全栈变更的测试 → 实现 → 验证 → OpenAPI 生成 → 前端开发的全流程。

## 安装

在项目根目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/shaohq/pg-skills/master/scripts/install.sh | bash
```

安装脚本会：

1. 复制 agents 到 `.opencode/agents/`
2. 复制 commands 到 `.opencode/commands/`
3. 复制 skills 到 `.opencode/skills/`
4. 复制脚本到 `.opencode/scripts/`
5. 创建 `pg-spec/config.yaml`（如不存在）

完成后重启 opencode。

## 升级

重新执行安装命令即可覆盖所有文件：

```bash
curl -fsSL https://raw.githubusercontent.com/shaohq/pg-skills/master/scripts/install.sh | bash
```

重启 opencode 后新版生效。

## 使用

| 命令 | 用途 |
|------|------|
| `/1-pg-explore` | 探索模式 — 分析需求、调查问题 |
| `/2-pg-micro` | 快速实现小型变更 |
| `/2-pg-propose` | 提交变更提案 |
| `/3-pg-apply <change>` | **全栈变更实现** — A→G 阶段管线 |
| `/4-pg-run-e2e` | 运行 E2E 测试并修复 |
| `/5-pg-fix-issue` | 修复问题 |

## 配置

`pg-spec/config.yaml` 是项目配置文件，包含后端/前端的端口、启动命令、lint 命令等。

## 目录结构

```
.opencode/
├── agents/          ← agent 定义（task 工具调度）
├── commands/        ← 命令入口（/3-pg-apply 等）
├── skills/          ← 工作流定义（pg-apply-change 等）
└── scripts/         ← Python 工具脚本
pg-spec/
└── config.yaml      ← 项目配置
```
