---
name: pg-apply-change
description: 全栈项目的变更实现工作流。在 pg-propose 生成变更产物后执行，通过子 agent 按 A-G 阶段逐阶段推进，支持 verify→fix 循环。
license: MIT
compatibility: 项目根目录需要 `pg-spec/config.yaml` 统一配置文件。变更产物（`pg-spec/changes/<change>/` 目录结构）由 pg-propose 上游生成或手动创建。
metadata:
  author: pg-spec
  version: "1.0"
---

# pg-apply-change

端到端实现一个变更，覆盖后端和前端，使用标准的 A-G 阶段管线。

**输入**：一个变更名称（kebab-case），该变更已由 `pg-propose` 创建，且 `pg-spec/changes/<change-name>/tasks.md` 存在。

> **角色边界**：此 SKILL 由 `pg-manager` agent 在收到 `/3-pg-apply` 命令后加载执行。编排器使用 Task 工具派遣各阶段 agent。

---

## 前置条件

使用此 SKILL 的项目必须满足以下条件：

### 1. 变更产物

变更产物（`proposal.md`、`design.md`、`tasks.md`）位于 `pg-spec/changes/<change-name>/` 下。可由 `pg-propose` SKILL 生成，或手动创建。目录结构必须满足 SKILL 中各 phase 引用的文件路径约定。

### 2. `pg-spec/config.yaml` 统一配置

项目根目录的 `pg-spec/config.yaml` **必须**包含所有项目特定的命令、路径、端口、项目上下文、产物规则。由 `{scriptsDir}/pg-parse-config.py` 脚本读取（`scriptsDir` 由 config.yaml 的 `scripts.dir` 指定，默认为 `.opencode/scripts`），编排器通过执行该脚本获取配置值。具体格式在下方 [配置约定](#配置约定) 中定义。

### 3. 子 agent 定义

此 SKILL 期望以下子 agent 存在于标准路径（相对于 `.opencode/agents/`）：

| Phase | Agent | 角色 |
|-------|-------|------|
| A | `pg-apply-change/backend-test` | 编写后端测试 |
| B | `pg-apply-change/backend-dev` | 实现后端代码 |
| C | `pg-apply-change/backend-verify` | 通过真实 API 验证后端 |
| C (fix) | `pg-apply-change/backend-fix` | 修复后端问题 |
| C (fix pro) | `pg-apply-change/backend-fix-pro` | 深度修复后端问题 |
| E | `pg-apply-change/frontend-test` | 编写前端测试 |
| F | `pg-apply-change/frontend-dev` | 实现前端代码 |
| G | `pg-apply-change/frontend-verify` | 通过浏览器/E2E 验证前端 |
| G (fix) | `pg-apply-change/frontend-fix` | 修复前端问题 |
| G (fix pro) | `pg-apply-change/frontend-fix-pro` | 深度修复前端问题 |

如果项目使用不同的 agent 名称，在上述路径创建符号链接或直接覆盖即可。

---

## 配置约定

项目根目录的 `pg-spec/config.yaml` 是统一配置源，包含所有项目特定的命令、路径、端口、项目上下文、产物规则。编排器在工作流开始时调用 `{scriptsDir}/pg-parse-config.py` 读取该文件一次，解析后将子 agent 需要的配置值作为上下文传递。**子 agent 不需要自己读取配置文件。**

### 必须的结构

```yaml
backend:
  root: <相对路径>                    # 后端项目根目录
  port: <端口号>                      # 服务监听端口
  compile: <编译命令（可选）>          # 仅编译不运行测试
  test: <测试命令>                     # 运行测试
  lint: <代码检查命令>                 # lint 检查
  start: <启动命令>                    # 启动服务
  health-check: <健康检查 URL 或命令>   # 如 curl http://localhost:9080/health
  stop: <停止命令>                     # 如 bash scripts/stop-backend.sh

frontend:
  root: <相对路径>                    # 如 maas-frontend
  port: <端口号>                      # 如 3008
  test: <测试命令>                     # 运行测试
  lint: <代码检查命令>                 # lint 检查
  format: <格式化命令>                 # 格式化
  start: <启动命令>                    # 启动服务
  build: <构建命令>                    # 构建

openapi:
  command: <生成命令>                  # OpenAPI 客户端生成命令
  frontend-root: <前端目录>            # 生成代码落地的目录

git:
  default-branch: <默认分支名>          # 如 main 或 master
```

`backend`、`frontend`、`git` 下的 `compile` 和 `format` 是可选的，其余键都是**必需的**。`openapi` 仅在项目使用 OpenAPI 代码生成时需要（Phase D）。

---

## 编排器读取配置的策略

**关键设计**：编排器（manager agent）在执行工作流前调用 `{scriptsDir}/pg-parse-config.py` 获取统一配置 JSON (`scriptsDir` 来自 `pg-spec/config.yaml` 的 `scripts.dir`)。配置值注入到上下文后，编排器从中解析出 Backend、Frontend、OpenAPI、Git、Scripts 五个配置块。之后每次派遣子 agent 时，编排器将对应的配置值作为上下文传递给 agent，**子 agent 不需要自己读取配置文件**。

```
工作流开始（编排器执行 {scriptsDir}/pg-parse-config.py 获取配置）
  │
  ├→ 解析统一配置
  │   ├→ Scripts config   { dir }
  │   ├→ Backend config   { root, port, compile, test, lint, start, health-check }
  │   ├→ Frontend config  { root, port, test, lint, start, format }
  │   ├→ OpenAPI config   { command, frontend-root }
  │   └→ Git config       { default-branch }
  │
  ├→ 派遣 Phase A: 传递 Backend.root 路径
  ├→ 派遣 Phase B: 传递 Backend config（含 lint/test 命令）
  ├→ 派遣 Phase C: 传递 Backend config（含 start/test/lint/health-check 命令）
  ├→ 自执行 Phase D: 使用 Backend config + OpenAPI config
  ├→ 派遣 Phase E: 传递 Frontend.root 路径
  ├→ 派遣 Phase F: 传递 Frontend config（含 lint 命令）
  └→ 派遣 Phase G: 传递 Frontend config + Backend config（含 start/port 命令）
```

---

## 阶段结构

此 SKILL 面向**全栈项目**（后端 + 前端）。管线包含 7 个阶段：

| Phase | 名称 | 类型 | Agent |
|-------|------|------|-------|
| A | 后端测试先行 | 简单派遣 | `pg-apply-change/backend-test` |
| B | 后端实现开发 | 简单派遣 | `pg-apply-change/backend-dev` |
| C | 后端集成验证 | 验证派遣（verify→fix） | `pg-apply-change/backend-verify` |
| D | OpenAPI 客户端生成 | 编排器自执行 | (orchestrator) |
| E | 前端测试先行 | 简单派遣 | `pg-apply-change/frontend-test` |
| F | 前端实现开发 | 简单派遣 | `pg-apply-change/frontend-dev` |
| G | 前端集成验证 | 验证派遣（verify→fix） | `pg-apply-change/frontend-verify` |

### 阶段依赖顺序

```
后端 (A→B→C) → OpenAPI 生成 (D) → 前端 (E→F→G)
```

### 仅前端变更

如果一个变更只涉及前端（没有后端修改），由 `pg-propose` 生成的 `tasks.md` 应该在 Phase A/B/C/D 中填写 `- 无`。编排器会跳过没有任务的阶段，从 Phase E 开始执行。

### 阶段标题约定

`tasks.md` 中的阶段标题必须遵循以下格式：

```
## 1. Phase A: 后端测试先行 (Testing Agent)
## 2. Phase B: 后端实现开发 (Development Agent)
## 3. Phase C: 后端集成验证 (Verification Agent)
## 4. Phase D: 生成前端 OpenAPI 客户端
## 5. Phase E: 前端测试先行 (Testing Agent)
## 6. Phase F: 前端实现开发 (Development Agent)
## 7. Phase G: 前端集成验证 (Verification Agent)
```

编排器通过扫描 `tasks.md` 中的 `## <N>. Phase <X>:` 模式来检测阶段。

---

## 编排器执行工作流

```
WORKFLOW_FAILED=false

1. 执行 `python3 {scriptsDir}/pg-parse-config.py pg-apply-change` 获取工作流所需配置（含 `__meta.hostname`）

2. 读取 pg-spec/changes/<change>/tasks.md 获取任务清单

3. 从解析的配置中取 `__meta.hostname` 作为 WORKER_NAME，基于 Git.default-branch 创建分支 `feat/<WORKER_NAME>/<change>`

4. 初始化 context-chain.md（如不存在），记录工作流开始时间

5. 从 Phase A 到 G，依次检查 tasks.md 中的每个阶段：
   a. 解析当前阶段的任务章节
   b. 如果所有任务已完成（或仅有 "- 无"）→ 跳到下一阶段
   c. 如果有未完成任务 →
      判断阶段类型：
      - A/B/E/F → 简单派遣（无 fix 循环）
      - C/G     → 验证派遣（支持 verify→fix→verify 循环）
      - D       → 编排器自执行

6. 所有阶段完成后，检查 WORKFLOW_FAILED：
   - false → 归档 + 提交 + 成功报告
   - true  → WIP 推送 + 失败报告（不归档）
```

### 简单派遣（Phase A, B, E, F）

```
1. 读取 context-chain.md 获取执行历史
2. 追加子阶段开始记录到 context-chain.md (SUB-START)
3. 使用 Task 工具派遣对应的阶段 agent，传递该阶段所需的配置值
4. 校验 agent 返回：
   a. 空结果 → 标记 [FAILED]，重试（最多 3 次），或 WORKFLOW_FAILED=true
   b. 正常   → 标记 [COMPLETED]，验证 tasks.md 已更新
5. 如果 WORKFLOW_FAILED → 跳出阶段循环
```

### 简单派遣完成清单

编排器在每阶段 agent 返回后，按以下清单逐项确认：

```
□ context-chain.md 已追加 SUB-START 记录（date -Iseconds 真实时间戳）
□ agent 返回非空结果
□ tasks.md 中当前阶段所有任务已标记 [x]
□ context-chain.md 已追加 SUB-END 记录（含摘要和产出物）
```

### 验证派遣（Phase C, G）

```
1. attempt=1, max_fix_cycles=4
2. 读取 context-chain.md
3. 追加 Verify-START 记录到 context-chain.md
4. 使用 Task 工具派遣 verify agent，传递该阶段所需的配置值
5. 读取 verification report，校验报告一致性：
   a. 检查 ## Recommendation 的值（PROCEED / ESCALATE）
   b. 检查 ### ORCHESTRATOR ACTION - Status 的值
   c. 两者必须一致；不一致时，拒绝报告，重新派遣 verify agent（限重试 1 次）
   d. 一致时，以 Recommendation 的值为准
6. 根据校验后的 Recommendation：
   a. PROCEED → 标记阶段完成，验证 tasks.md 已更新，进入下一阶段
   b. ESCALATE →
      - 检查 fix 循环次数（最多 4 次）
      - 从报告中提取 FIX ISSUE REQUEST
      - 追加 Fix-START 记录到 context-chain.md
      - 使用 Task 工具派遣 fix agent（attempt≤2 用标准版，attempt≥3 用 pro 版），传递配置值
      - 追加 Fix-END 记录
      - attempt += 1，回到步骤 2（重新派遣 verify agent）
7. 如果 WORKFLOW_FAILED → 跳出阶段循环
```

### 编排器自执行（Phase D）

```
1. 从之前解析的 Backend config 和 OpenAPI config 中读取：
   - OpenAPI.command: 生成命令
   - Backend.port: 后端端口
   - Backend.start: 后端启动命令
   - Backend.health-check: 健康检查命令
2. 检查后端是否已在 Backend.port 运行
3. 如未运行，执行 Backend.start 启动，等待健康检查通过
4. 执行 OpenAPI.command
5. 验证生成的文件已存在
6. 将 tasks.md 中 Phase D 的所有任务标记为 [x]
7. 追加 Phase D 记录到 context-chain.md

如果统一配置中没有 openapi 配置（项目没有 OpenAPI 生成），
跳过此阶段，将 tasks.md 中的任务标记为 "- 无"。
```

---

## 阶段派遣详情

### Phase A — 后端测试先行

```
Agent: pg-apply-change/backend-test
角色: 编写后端测试，初始应失败（红 phase）
工作目录: Backend.root

 硬约束:
   - Mock 调用必须带具体类型参数，禁止因重载导致的歧义
   - 禁止使用 eq(any(T.class)) 模式 → 使用明确参数匹配
   - 不创建生产实现代码 → 测试必需的编译依赖通过局部 stub 或 mock 框架解决
   - 提交前验证编译命令零错误（对应配置中的 compile 命令，非完整测试套件）

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - Backend.root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md
  - pg-spec/changes/<change>/proposal.md
  - pg-spec/changes/<change>/specs/*/spec.md（如存在）
  - 应用程序源代码（用于理解接口）
```

### Phase B — 后端实现开发

```
Agent: pg-apply-change/backend-dev
角色: 实现后端生产代码，让 Phase A 的测试通过
工作目录: Backend.root

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - 来自统一配置的 Backend config:
    - lint 命令    -> 用于验证代码质量
    - test 命令    -> 用于验证测试通过
    - root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md
  - pg-spec/changes/<change>/proposal.md
```

### Phase C — 后端集成验证

```
Agent: pg-apply-change/backend-verify
角色: 通过真实 HTTP API 验证后端
工作目录: Backend.root

硬约束:
  - 绝不修改任何文件 (edit: deny)
  - 不更新 tasks.md（编排器的职责）
  - 必须启动真实后端服务，不接受仅 mock 的验证

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - 来自统一配置的 Backend config:
    - lint 命令        -> cd <root> && <lint>
    - test 命令        -> cd <root> && <test>
    - start 命令        -> 启动后端
    - port             -> 等待端口
    - health-check     -> 健康检查 URL/命令
    - root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md（获取 Verification Criteria）

执行流程:
  1. 执行 lint 命令
  2. 执行 test 命令
  3. 执行 start 命令启动后端
  4. 等待 port 就绪或 health-check 通过
  5. 执行 tasks.md 中的验证步骤

验证报告: verification-report-c-{N}.md
  - N 自动递增（找到已有最大 N + 1）
  - 写入 pg-spec/changes/<change-name>/

Fix agent（编排器调度，工作目录同样为 Backend.root）:
  - 标准版（attempt 1-2）: pg-apply-change/backend-fix
  - Pro 版（attempt 3-4）: pg-apply-change/backend-fix-pro
```

### Phase D — OpenAPI 客户端生成

```
执行者: 编排器（自执行）

使用之前解析的配置:
  - OpenAPI.command: 执行 OpenAPI 生成
  - Backend.port: 检查后端是否在运行
  - Backend.start: 如需要则启动后端
  - Backend.health-check: 验证后端就绪

流程:
  1. 检查后端是否已在 Backend.port 运行
  2. 如未运行，执行 Backend.start，等待健康检查通过
  3. 执行 OpenAPI.command
  4. 验证生成的文件已存在
  5. 将 tasks.md 中 Phase D 的所有任务标记为 [x]
  6. 追加 Phase D 记录到 context-chain.md

如果统一配置中没有 openapi 配置，跳过此阶段。
```

### Phase E — 前端测试先行

```
Agent: pg-apply-change/frontend-test
角色: 编写前端测试，初始应失败（红 phase）
工作目录: Frontend.root

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - 来自统一配置的 Frontend config:
    - root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md
  - pg-spec/changes/<change>/proposal.md
```

### Phase F — 前端实现开发

```
Agent: pg-apply-change/frontend-dev
角色: 实现前端代码，让 Phase E 的测试通过
工作目录: Frontend.root

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - 来自统一配置的 Frontend config:
    - lint 命令    -> 用于验证代码质量
    - root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md
  - pg-spec/changes/<change>/proposal.md
```

### Phase G — 前端集成验证

```
Agent: pg-apply-change/frontend-verify
角色: 通过 E2E 和浏览器验证前端
工作目录: Frontend.root

硬约束:
  - 绝不修改任何文件 (edit: deny)
  - 不更新 tasks.md（编排器的职责）
  - 必须启动真实前端 + 后端，不接受仅 mock 的验证
  - 禁止仅通过源代码阅读验证 UI 行为 → 必须通过浏览器做运行时渲染检查

**注意**：必须引用 `pg-browser-testing-with-devtools` SKILL 做运行时 UI 验证，不得以代码审查替代浏览器实际渲染验证。

编排器传递的上下文:
  - pg-spec/changes/<change>/tasks.md 路径
  - 来自统一配置的 Backend config:
    - start 命令         -> 确保后端运行
    - port              -> 端口
    - health-check      -> 健康检查
  - 来自统一配置的 Frontend config:
    - lint 命令         -> 验证代码质量
    - start 命令         -> 启动前端
    - port              -> 等待前端端口
    - root 路径

Agent 自己读取:
  - pg-spec/changes/<change>/design.md（获取 Verification Criteria）

执行流程:
  1. 确保后端正在运行（如需要则执行 start 命令）
  2. 执行前端 lint 命令
  3. 执行前端 start 命令启动前端
  4. 执行 tasks.md 中的验证步骤（E2E 测试、UI 检查）
  5. 加载 `pg-browser-testing-with-devtools` SKILL 做运行时浏览器验证：
     a. 打开目标页面 http://localhost:{{Frontend.port}}/<target-path>
     b. 确认页面关键组件正确渲染（由 tasks.md 中的 Verification Criteria 定义）
     c. 验证交互行为（点击、导航、表单提交等）按预期工作
     d. 验证列表/表格数据展示正确
     e. 检查浏览器控制台无 4xx/5xx 错误
  6. 将步骤 5 的运行时结果合并到验证报告

验证报告: verification-report-g-{N}.md

Fix agent（编排器调度，工作目录同样为 Frontend.root）:
  - 标准版（attempt 1-2）: pg-apply-change/frontend-fix
  - Pro 版（attempt 3-4）: pg-apply-change/frontend-fix-pro
```

---

## Context Chain（执行历史）

编排器维护一份执行历史记录，路径为：

```
pg-spec/changes/<change-name>/context-chain.md
```

### 格式

```markdown
# Context Chain - {change-name}

---
*此文件由编排器自动管理，请勿手动修改*

### {timestamp} - Phase {X} ({sub_name}) START
**状态**: IN_PROGRESS

### {timestamp} - Phase {X} ({sub_name}) END
**状态**: COMPLETED | FAILED
**报告**: <路径>（仅 C/G 阶段有）
**摘要**: <一句话总结>
**输出文件**: <产物列表>
**问题**: <失败时填写根因>

### {timestamp} - WORKFLOW COMPLETED
**状态**: SUCCESS | FAILED
**总耗时**: <Xm Ys>
```

### 初始化

```bash
CONTEXT_CHAIN="pg-spec/changes/${change}/context-chain.md"
if [[ ! -f "$CONTEXT_CHAIN" ]]; then
  cat > "$CONTEXT_CHAIN" <<- EOF
# Context Chain - ${change}

---
*此文件由编排器自动管理，请勿手动修改*

EOF
fi
```

### 追加函数

```bash
# 追加子阶段开始记录
append_sub_start() {
  local phase=$1
  local sub_name=$2
  local timestamp=$(date -Iseconds)
  cat >> "$CONTEXT_CHAIN" <<- EOF

### ${timestamp} - Phase ${phase} (${sub_name}) START
**状态**: IN_PROGRESS

EOF
}

# 追加子阶段完成记录
append_sub_end() {
  local phase=$1
  local sub_name=$2
  local status=$3         # COMPLETED | FAILED
  local report=$4         # 报告路径（可选）
  local summary=$5
  local outputs=$6
  local issue=$7
  local timestamp=$(date -Iseconds)
  cat >> "$CONTEXT_CHAIN" <<- EOF

### ${timestamp} - Phase ${phase} (${sub_name}) END
**状态**: ${status}
**报告**: ${report}
**摘要**: ${summary}
**输出文件**: ${outputs}
**问题**: ${issue}

EOF
}

# 追加 WORKFLOW 完成记录（含总耗时）
append_workflow_complete() {
  local status=$1         # SUCCESS | FAILED
  local start_time=$2     # ISO 格式的开始时间
  local end_time=$(date -Iseconds)

  local start_epoch=$(date -d "$start_time" +%s 2>/dev/null || echo 0)
  local end_epoch=$(date -d "$end_time" +%s 2>/dev/null || echo 0)
  local elapsed=$((end_epoch - start_epoch))
  local minutes=$((elapsed / 60))
  local seconds=$((elapsed % 60))

  cat >> "$CONTEXT_CHAIN" <<- EOF

### ${end_time} - WORKFLOW COMPLETED
**状态**: ${status}
**总耗时**: ${minutes}m ${seconds}s

EOF
}
```

---

## Verification Report（验证报告格式）

由 `pg-apply-change/backend-verify`（Phase C）和 `pg-apply-change/frontend-verify`（Phase G）生成。

```
pg-spec/changes/<change-name>/verification-report-{c|g}-{N}.md
```

### 结构

```markdown
## Summary
<一句话总结>

## Design Comparison（设计对比）

| 验证项 | 预期（来自 design.md） | 实际结果 | 判定 |
|--------|----------------------|---------|------|
| ...    | ...                  | ...     | ✅ / ❌ |

## Issues Found（发现的问题）

### Issue #N: <标题>
- **verification_step**: <哪个步骤失败>
- **expected**: <应该发生什么>
- **actual**: <实际发生了什么>
- **root_cause_phase**: <根因阶段 A/B/C/D/E/F/G>
- **affected_tasks**: <受影响的 task ID>
- **fix_suggestion**: <建议修复方向>

## Recommendation
PROCEED / ESCALATE
```

当 Recommendation 为 **ESCALATE** 时，报告末尾**必须**包含以下结构化输出：

```markdown
### ORCHESTRATOR ACTION

- **Status**: ESCALATE
- **Reason**: <简要说明为什么需要修复>
- **Unresolved Issues**: <未解决的 issue 列表>

### FIX ISSUE REQUEST

- **source_phase**: Phase C 或 Phase G
- **change_name**: <变更名称>
- **design_doc_path**: pg-spec/changes/<change>/design.md
- **tasks_path**: pg-spec/changes/<change>/tasks.md

#### Issue #N: <标题>
- **verification_step**: ...
- **expected**: ...
- **actual**: ...
- **root_cause_phase**: ...
- **affected_tasks**: ```

### 一致性规则

报告生成 agent 必须确保：
- `## Recommendation` 与 `### ORCHESTRATOR ACTION - Status` 的值一致
- PROCEED → ORCHESTRATOR ACTION Status 必须为 PROCEED
- ESCALATE → ORCHESTRATOR ACTION Status 必须为 ESCALATE 且包含 FIX ISSUE REQUEST 块

---

### 版本号递增

```bash
get_next_report_version() {
  local phase=$1  # "c" 或 "g"
  local change=$2
  local dir="pg-spec/changes/${change}"
  local max=0
  for f in $(ls ${dir}/verification-report-${phase}-*.md 2>/dev/null); do
    local num=$(echo "$f" | grep -oP '\d+(?=\.md$)')
    [[ -n "$num" && "$num" -gt "$max" ]] && max=$num
  done
  echo $((max + 1))
}
```

---

## 任务进度跟踪

编排器仅通过 `tasks.md` 中的复选框状态跟踪进度：

- `- [ ]` = 未开始
- `- [x]` = 已完成
- `- 无` = 跳过（该阶段无需工作）

### 检测当前阶段

```bash
TASKS_FILE="pg-spec/changes/${change}/tasks.md"
for phase in A B C D E F G; do
  phase_section=$(sed -n "/^## [0-9]\. Phase ${phase}:/,/^## [0-9]\./p" "$TASKS_FILE")
  unchecked=$(echo "$phase_section" | grep -c "^- \[ \]" || true)
  if [[ "$unchecked" -gt 0 ]]; then
    echo "$phase"
    break
  fi
done
```

---

## 异常处理

| 场景 | 行为 |
|------|------|
| Phase A/B/E/F agent 失败 | `WORKFLOW_FAILED=true`，停止管线 |
| Phase C/G verify 返回 ESCALATE | 进入 fix→re-verify 循环（最多 4 次） |
| Agent 返回空结果 | 自动重试，最多 3 次 |
| Phase D 无法启动后端 | 报告失败，`WORKFLOW_FAILED=true` |
| 会话中断 | 读取 tasks.md + context-chain.md，从未完成的阶段继续 |

### Fix 循环升级策略

```
attempt 1-2 → 标准 fix agent
attempt 3-4 → pro fix agent
attempt >4  → WORKFLOW_FAILED=true

每个循环: verify → fix → re-verify
```

---

## 每阶段输出格式

```
当前阶段：{{phase}}
当前状态：{{status}} SUCCESS | FAILED
执行Agent：{{agent}}
下一步：{{next_phase}}
完成进度：{{completed_count}}/{{total_count}}
```

---

## 完成处理

### 成功时（所有阶段通过）

1. **归档变更**：将 `pg-spec/changes/<change-name>/` 移动到 `pg-spec/changes/archive/` 下，以日期前缀标识：
    ```bash
    archive_date=$(date +%Y-%m-%d)
    mkdir -p pg-spec/changes/archive/
    mv "pg-spec/changes/<change-name>" "pg-spec/changes/archive/${archive_date}-<change-name>"
    ```
    验证 `pg-spec/changes/archive/` 下存在对应归档目录。
2. **记录总耗时**到 context-chain.md（必须在 git 操作之前执行）：
    ```bash
    append_workflow_complete()  # 追加 WORKFLOW COMPLETED 记录
    ```
3. **提交并推送**（在同一 shell 行执行，保证原子性）：
    ```bash
    git add -A && git commit -m "feat: <change-name> implementation complete" && git push origin HEAD
    ```
4. **输出成功报告**（不合并到 default-branch）

5. **自动触发 pg-verify-and-merge**（参阅 [与 pg-verify-and-merge 的集成](#与-pg-verify-and-merge-的集成)）：
    ```bash
    # 加载 pg-verify-and-merge SKILL 继续执行
    # 编排器按该 SKILL 定义执行 Phase 0-4
    ```

### 失败时

1. **不归档**
2. **记录总耗时**到 context-chain.md
3. **提交但不合并**——代码保留在工作区
4. **输出失败报告**，包含 `{{failed_phase}}`、`{{failed_description}}`，并引用 context-chain.md 路径

### 成功报告格式

```
## 变更实现完成

**变更：** {{change-name}}
**工作流：** pg-apply-change
**WORKFLOW: SUCCESS**

### Phase 完成情况

| Phase | 状态 | Agent |
|-------|------|-------|
| A - 后端测试先行 | ✓ 完成 | backend-test |
| B - 后端实现开发 | ✓ 完成 | backend-dev |
| C - 后端集成验证 | ✓ 完成 | backend-verify |
| D - OpenAPI 客户端生成 | ✓ 完成 | (orchestrator) |
| E - 前端测试先行 | ✓ 完成 | frontend-test |
| F - 前端实现开发 | ✓ 完成 | frontend-dev |
| G - 前端集成验证 | ✓ 完成 | frontend-verify |

### 归档

- **归档位置：** pg-spec/changes/archive/{{date}}-{{change-name}}/
- **Specs 同步：** ✓ 已完成

### 分支

- **Feature 分支：** feat/{{worker}}/{{change-name}}（已合并到 {{default-branch}}）
- **默认分支：** {{default-branch}}

### 产出物

- {{产出物列表}}
```

### 失败报告格式

```
## 变更实现未完成

**变更：** {{change-name}}
**工作流：** pg-apply-change
**WORKFLOW: FAILED**

### Phase 完成情况

| Phase | 状态 | Agent |
|-------|------|-------|
| A - 后端测试先行 | ✓ 完成 | ... |
| ... | ... | ... |
| {{failed-phase}} | ✗ **失败** | {{agent}} |

### 失败原因

- **失败 Phase：** {{failed-phase}}
- **失败详情：** {{描述}}
- **执行历史：** pg-spec/changes/{{change-name}}/context-chain.md

### 分支

- **Feature 分支：** feat/{{worker}}/{{change-name}}（未合并，仅本地）
- **未归档**。修复 {{failed-phase}} 后重新执行 `/apply-change {{change-name}}` 可继续

### 下一步建议

1. 读取 context-chain.md 了解失败详情
2. 修复 {{failed-phase}} 中的问题
3. 重新执行 `/apply-change {{change-name}}`——编排器会从失败的 phase 继续
```

---

## 安全规则

- **仅在全部成功时归档和提交**。如果 `WORKFLOW_FAILED=true`，跳过归档、提交、合并。
- **绝不 force push**，除非用户明确要求。
- **绝不跳过 hooks**（不使用 `--no-verify`），除非用户明确要求。
- **会话恢复**：读取 `tasks.md` + `context-chain.md` 确定上次执行位置，从第一个有未完成任务的阶段继续。
- **编排器不得在派遣 agent 前读取 design/proposal/specs 文件**——agent 自己读取自己的上下文。
- **Phase D 是唯一编排器自执行阶段**——其他阶段全部派遣子 agent。
- **编排器通过 `{scriptsDir}/pg-parse-config.py` 获取统一配置**，无需手动读取。编排器从中提取配置值传递给子 agent，子 agent 不再自己读配置文件。
