---
name: pg-run-e2e
description: 自动运行 E2E 测试，对每个失败脚本调用 pg-run-e2e/fix-e2e agent 进行根因分析和修复，最终汇总结果并更新 KnownIssues.md。
license: MIT
compatibility: 项目根目录需要 pg-spec/config.yaml 包含 e2e 和 knownIssues 配置。
metadata:
  author: pg-spec
  version: "1.0"
---

# pg-run-e2e

自动运行 E2E 测试流水线，对每个失败的测试脚本使用 `pg-run-e2e/fix-e2e` agent 进行系统性的根因分析和修复。workflow 以脚本为单位调度 agent，最终汇总所有结果并更新 `KnownIssues.md`。

## 前置条件

使用此 SKILL 的项目必须满足以下条件：

### 1. pg-spec/config.yaml 配置

项目根目录的 `pg-spec/config.yaml` 必须包含 `e2e` 和 `knownIssues` 配置段：

```yaml
e2e:
  testDir: <E2E 测试目录>              # 如 tests/e2e
  runAllCommand: <运行全部测试的命令>    # 如 cd {frontend.root} && npm test
  runSingleCommand: <运行单个测试的命令> # 用 {script} 作为脚本路径占位符

knownIssues:
  path: <已知问题文件路径>              # 如 tests/KnownIssues.md
```

### 2. 子 agent 定义

此 SKILL 期望以下子 agent 存在于标准路径：

| Agent | 角色 |
|-------|------|
| `pg-run-e2e/fix-e2e` | 执行 E2E 测试脚本，诊断每个失败，调用 pg-systematic-diagnosing 判定根因，决定是否修复 |

---

## 整体流程

```
Phase 0: 前置检查 → Phase 1: 执行测试并按脚本分组 → Phase 2: 并行调度 pg-run-e2e/fix-e2e agent → Phase 3: 汇总报告并更新 KnownIssues.md
```

---

## 编排器执行工作流

### Phase 0: 前置检查

#### 0.1 验证 pg-run-e2e/fix-e2e agent 可用性

`pg-run-e2e/fix-e2e` agent 必须能够正确理解和响应指令。

验证步骤：
1. 向 `pg-run-e2e/fix-e2e` agent 发送可用性确认消息
2. agent 必须在回复中明确包含 "✅ pg-run-e2e/fix-e2e 已就绪"
3. 如果未正确响应 → 判定不可用，终止

可用性确认模板：
```
pg-run-e2e/fix-e2e，请确认你已就绪。
你需要加载 pg-systematic-diagnosing SKILL，并回复一条简单的确认消息。
```

#### 0.2 启动 backend

使用 `backend.start` 命令启动后端，等待 `backend.port` 就绪。

#### 0.3 启动 frontend

使用 `frontend.start` 命令启动前端，等待 `frontend.port` 就绪。

#### 0.4 清理临时目录

清理上次运行的临时文件，确保每次执行从干净状态开始：

```bash
mkdir -p temp && rm -f temp/e2e-test-output.log temp/phase1-failures.json temp/phase1-known-issues.json temp/fix-results.json
```

所有临时文件统一写入项目根目录下的 `temp/`，该目录已在 `.gitignore` 中忽略。

---

### Phase 1: 执行测试并按脚本分组

#### 1.1 运行全部 E2E 测试

执行 `e2e.runAllCommand`，将输出保存到 `temp/e2e-test-output.log`：

```bash
{e2e.runAllCommand} 2>&1 | tee temp/e2e-test-output.log
```

**⚠️ 重要：不要为 E2E 测试命令设置 bash timeout**
- `e2e.runAllCommand` 是长时间运行命令，其背后的框架会设置超时时间
- bash 的 timeout 会在 `e2e.runAllCommand` 超时之前强制终止进程，导致测试结果不完整
- 永远不要在调用此命令时添加任何 bash timeout 参数

注意：`runAllCommand` 中的 `{frontend.root}` 由编排器在调用前替换为实际路径。

#### 1.2 按脚本分组失败用例

使用 `pg-e2e-parse-results.py` 自动解析：

```bash
python3 .opencode/scripts/pg-e2e-parse-results.py parse --log-file temp/e2e-test-output.log --out temp/phase1-failures.json
```

如果 `summary.failed == 0` → 跳转到 Phase 3

#### 1.3 读取 KnownIssues.md

使用 `pg-e2e-parse-results.py` 提取跳过列表：

```bash
python3 .opencode/scripts/pg-e2e-parse-results.py known-issues --path <knownIssues.path> --out temp/phase1-known-issues.json
```

脚本会做三件事：
1. 读取 fix-results.json 中的 `unfixableIssues` 结构化数据 → 格式化追加到 `## Active Known Issues`
2. 生成 E2E Fix 汇总报告（含 fixed/unfixable 统计） → 追加到 `## Fix History`
3. 输出处理结果摘要（新增问题数、修复数等）

`KnownIssues.md` 区域说明：

| 区域 | 用途 | Phase 1.3 参与跳过 |
|------|------|-------------------|
| `## Active Known Issues` | 活跃已知问题，需人工修复 | ✅ |
| `## Fix History` | 历史报告归档，只增不删 | ❌ |

#### 3.3 输出最终状态

只需一行状态 + 提醒用户查看：

```
⚠️ 更新完成。新增 [N] 条已知问题到 Active Known Issues。
📋 汇总报告已追加到 Fix History。请人工查看 <knownIssues.path> 确认。
```

---

## 修复执行原则

1. **只修测试脚本，不动生产代码** — pg-run-e2e/fix-e2e 遵循根因边界原则
2. **保留测试意图** — 不削弱断言，不删除测试覆盖
3. **skipped 测试处理** — 分析跳过原因，尝试满足前置条件后重跑
4. **统一修复策略** — 所有问题诊断完毕后统一决定，不逐个临时决策

---

## 配置模板变量替换

编排器在调用 `e2e.runAllCommand` 或 `e2e.runSingleCommand` 前，需要替换以下占位符：

| 占位符 | 替换为 |
|--------|--------|
| `{frontend.root}` | `frontend.root` 配置值 |
| `{script}` | 当前处理的脚本路径 |

---

## Troubleshooting

| 问题 | 原因 | 解决 |
|------|------|------|
| pg-run-e2e/fix-e2e 未确认就绪 | agent 指令加载失败 | 检查 `.opencode/agents/pg-run-e2e/fix-e2e.md` |
| 后端 9080 端口无法启动 | 编译错误 | 检查 `scripts/start-backend.sh` |
| 前端 3008 端口无法启动 | 依赖未安装 | 检查 `scripts/start-frontend.sh` |
| agent 执行超时 | 问题复杂或环境问题 | 检查 agent 日志，手动处理 |
