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

使用 `{scriptsDir}/pg-e2e-parse-results.py` 自动解析：

```bash
python3 {scriptsDir}/pg-e2e-parse-results.py parse --log-file temp/e2e-test-output.log --out temp/phase1-failures.json
```

如果 `summary.failed == 0` → 跳转到 Phase 3

#### 1.3 读取 KnownIssues.md

使用 `{scriptsDir}/pg-e2e-parse-results.py` 提取跳过列表：

```bash
python3 {scriptsDir}/pg-e2e-parse-results.py known-issues --path <knownIssues.path> --out temp/phase1-known-issues.json
```

仅从 `## Active Known Issues` 区域提取，忽略 `## Fix History`。这些脚本跳过 fix-e2e 调用。

---

### Phase 2: 并行调度 pg-run-e2e/fix-e2e Agent

对每个失败脚本（排除 KnownIssues 中已记录的），并行调用 `pg-run-e2e/fix-e2e` agent。每个 subagent 处理一个独立的 spec 文件，写入操作互不冲突。

> **编排器注意事项**：Phase 1.3 中 `skipped_known` 列表已记录应跳过的脚本。调度前检查当前脚本是否在该列表中，确保不将已知问题脚本下发至 subagent。

#### 2.1 构造 pg-run-e2e/fix-e2e 调用

> **编排器注意事项**：调用 subagent 前，从 `pg-spec/config.yaml` 读取 `frontend.root`、`e2e.runSingleCommand`，将实际值替换到模板占位符后发送。

向 `pg-run-e2e/fix-e2e` agent 传递：
- 脚本路径（如 `tests/e2e/specs/xxx.spec.ts`）
- 配置上下文（frontend.root、e2e.runSingleCommand）
- 全量测试输出文件路径（testOutputFile，如 `temp/e2e-test-output.log`）
- 脚本内所有失败/错误/skipped 测试的清单（issueList）

调用模板：
```
pg-run-e2e/fix-e2e，请诊断并修复以下 E2E 测试脚本的失败问题：

脚本路径：<script-path>

配置上下文：
- frontend.root: <frontend.root>
- e2e.runSingleCommand: <e2e.runSingleCommand>
- testOutputFile: <testOutputFile>

失败问题清单：
- [failed] <test-name>: <error-summary>
- [skipped] <test-name>: <skip-reason>
- [error] <test-name>: <error-summary>

请对每个问题调用 pg-systematic-diagnosing 进行根因分析，然后统一决定修复策略。并将你最终的处理结果汇报给我。
```

#### 2.2 调度策略（Work Queue 模型）

采用**工作队列模型**，维护一个"待处理队列"和一个"活跃池"，避免 batch 模式的长尾等待：

```
待处理队列: [script_D, script_E, script_F, ...]  ← 尚未调度的脚本
活跃池(上限5): [A, B, C]                          ← 正在执行的 agent
```

调度规则：

1. **初始化**：从待处理队列取出前 N 个脚本（N=并发上限），以 `background=true` 模式启动 subagent
2. **维持水位**：编排器进入轮询循环，对每个活跃 agent 调用 `task_status(task_id, wait=false)` 检查完成状态
3. **完成一个，调度一个**：当某个 agent 完成时，立即从队列头部取出下一个脚本调度，始终保持活跃池内有 N 个 agent 在执行
4. **队列为空**：当待处理队列为空且所有活跃 agent 完成，终止轮询，进入 Phase 3

并发上限建议为 4-5，避免 `--grep` 验证时过多浏览器进程争用资源。每个 subagent 处理一个独立的 spec 文件，互不冲突（读取共享文件、写入各自 spec 文件、`--grep` 验证快速且隔离）。

#### 2.3 收集 pg-run-e2e/fix-e2e 执行结果

每个 `pg-run-e2e/fix-e2e` agent 返回：
- 诊断报告列表（每个问题一条）
- 修复执行结果（fixed/skipped/reported）
- 需要上报生产代码问题的清单

汇总所有 agent 的结果：

| 脚本 | 问题数 | 已修复 | 跳过 | 上报 |
|------|--------|--------|------|------|
| xxx.spec.ts | 3 | 2 | 0 | 1 |

---

### Phase 3: 更新 KnownIssues.md（脚本自动处理，LLM pass-through）

#### 3.1 收集 fix-e2e agent 结果并从报告中提取结构化字段

每个 agent 返回的完整报告已包含所有需要的信息。**编排器需要阅读每个 agent 的报告，提取结构化字段**，按以下 schema 构造 `temp/fix-results.json`：

```json
{
  "date": "<YYYY-MM-DD>",
  "testRun": { "total": <N>, "passed": <N>, "failed": <N>, "skipped": <N> },
  "agents": [{
    "script": "tests/e2e/.../xxx.spec.ts",                    # required
    "overview": { "total": N, "passed": N, "failed": N },     # from agent's 测试执行概览
    "stats": { "fixed": N, "unfixable": N },                  # from agent's ✅/❌ 统计
    "unfixableIssues": [{                                      # from agent's ### 无法修复的问题
      "title": "问题标题",                                      # required
      "component": "test data|backend|frontend|environment",   # required
      "file": "path/to/source/file",                           # optional
      "affectedTests": "`tests/e2e/...` - test names",         # required: must include full script path in backticks
      "expected": "期望行为",                                    # optional
      "actual": "实际行为",                                     # optional
      "rootCause": "根因描述",                                   # required
      "orchestratorSteps": ["步骤 1", "步骤 2"]                 # optional
    }]
  }]
}
```

示例（1 个有不可修复问题的 agent）：
```json
{
  "script": "tests/e2e/specs/admin/tenant/packages/download-complete-flow.spec.ts",
  "overview": { "total": 4, "passed": 1, "failed": 3 },
  "stats": { "fixed": 0, "unfixable": 1 },
  "unfixableIssues": [{
    "title": "租户级镜像仓库缺失",
    "component": "test data",
    "file": "maas-frontend/tests/e2e/specs/admin/tenant/packages/download-complete-flow.spec.ts",
    "affectedTests": "`tests/e2e/specs/admin/tenant/packages/download-complete-flow.spec.ts` - 5.3.1, 5.3.2, 5.3.3",
    "expected": "下载向导 Step 3 的镜像仓库下拉框显示可选项",
    "actual": "下拉框展开后无可用选项",
    "rootCause": "测试 beforeAll 创建了平台级 registry 和 repository，但下载向导调用的是 tenant 范围的数据",
    "orchestratorSteps": ["在 beforeAll 中通过 scoped API 创建租户级镜像仓库", "确认 API 返回 201"]
  }]
}
```

#### 3.2 脚本自动更新 KnownIssues.md

```bash
python3 {scriptsDir}/pg-e2e-parse-results.py update-known-issues \
  --ki-path <knownIssues.path> \
  --fix-results temp/fix-results.json
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
