---
name: pg-fix-issue
description: 复现问题、收集错误信息、进行系统化诊断、对根因进行修复。触发词："修复问题"、"fix issue"
license: MIT
compatibility: 项目根目录需要 pg-spec/config.yaml 包含 backend 和 frontend 配置。
metadata:
  author: pg-spec
  version: "1.0"
---

# pg-fix-issue

用户描述问题后，编排器使用 `pg_dispatch_agent` tool 派遣 `pg-fix-issue/coder` agent 复现问题、收集错误信息、进行系统化诊断、对根因进行修复，coder 返回修复报告后编排器检查结果并按模板输出最终结论。

## 前置条件

使用此 SKILL 的项目必须满足以下条件：

### 1. pg-spec/config.yaml 配置

项目根目录的 `pg-spec/config.yaml` 必须包含 `backend` 和 `frontend` 配置段：

```yaml
backend:
  root: <backend-dir>          # 后端项目根目录
  port: <backend-port>         # 服务端口
  start: <start-command>        # 启动命令
  health-check: <health-check>  # 健康检查
  lint: <lint-command>          # lint 命令

frontend:
  root: <frontend-dir>         # 前端项目根目录
  port: <frontend-port>        # 服务端口
  start: <start-command>        # 启动命令
  health-check: <health-check>  # 健康检查
  lint: <lint-command>          # lint 命令
```

### 2. 配置上下文

编排器需从 `pg-spec/config.yaml` 读取配置，通过 `{scriptsDir}/pg-parse-config.py <workflow>` 获取统一配置 JSON，然后提取 `backend`、`frontend` 等配置块。

`pg_dispatch_agent` tool 的 `context` 参数接收配置上下文的 JSON 字符串：

```json
{
  "backend": { "root": "webvirt-backend", "port": 9080, ... },
  "frontend": { "root": "webvirt-frontend", "port": 3008, ... },
  "scriptsDir": ".opencode/scripts"
}
```

---

## 工作流程

```
用户描述问题
    ↓
┌─ 编排器职责 ─────────────────────────────┐
│  1. 分析问题，理解现象和预期                │
│  2. 规划复现步骤（含工具选择）              │
│  3. 请用户确认 ← 必须等待用户回复才能继续   │
│  ⚠️ 不要提前启动服务！                      │
└───────────────────────────────────────────┘
    ↓
┌─ 等待用户确认 ───────────────────────────┐
│  ⚠️ 必须收到用户明确回复后才能继续！        │
└───────────────────────────────────────────┘
    ↓
┌─ pg_dispatch_agent: 派遣 coder agent ────┐
│  prompt中包含：问题+预期+步骤+配置上下文    │
└───────────────────────────────────────────┘
    ↓
┌─ coder agent ────────────────────────────┐
│  1. 环境检查 + 启动服务                    │
│  2. 问题复现（真实执行）                    │
│  3. 系统化诊断（三阶段）                    │
│  4. 根因修复                               │
│  5. 修复验证（真实执行）                    │
│  6. 输出修复报告                           │
└───────────────────────────────────────────┘
    ↓
┌─ 编排器修复后验证 ───────────────────────┐
│  1. 理解修复内容                           │
│  2. 架构验证（读代码确认模式正确）          │
│  3. 功能验证（真实执行）                    │
│  4. 如失败则重派遣（最多2次）              │
│  5. 超限则标记 ESCALATE                    │
└───────────────────────────────────────────┘
    ↓
编排器按模板输出最终结论
```

---

## 编排器执行工作流

### Phase 1: 问题分析

收到用户问题后：
- 仔细阅读问题描述
- 理解问题现象和预期行为
- 分析问题可能的范围（前端/后端/集成/环境）
- 根据问题类型决定复现步骤中所需的工具（如前端问题需 `pg-browser-testing-with-devtools`）

### Phase 2: 规划复现步骤

编排器规划清晰、可执行的复现步骤。

### Phase 3: 请用户确认

**必须使用 `question` 工具**向用户展示复现步骤并请求确认，不得使用 plain text 询问：

```
question 工具调用：
  questions: [{
    question: "以下复现步骤是否准确可行？",
    header: "确认复现步骤",
    options: [
      { label: "可以，开始执行", description: "复现步骤准确，派遣 coder agent" },
      { label: "需要调整", description: "复现步骤有问题，需要修改" }
    ]
  }]
```

复现步骤模板：

```
问题描述：[问题描述]
预期结果：[预期结果]
复现步骤：
1. [具体操作]
2. [具体操作]
```

**复现步骤要求：**
- 步骤必须具体、可操作，基于**真实执行**而非阅读代码分析
- 如为前端问题，必须包含「使用浏览器 DevTools 观察」的操作

**必须等待用户明确回复确认，才能进入下一阶段。**

### Phase 4: 派遣 coder agent

使用 `pg_dispatch_agent` tool 派遣 coder agent，**在 task 参数中附带配置上下文**：

```text
pg_dispatch_agent tool 调用：
  agent_name: pg-fix-issue/coder
  task: |
    FIX ISSUE REQUEST

    - issue_title: <问题标题>
    - issue_description: <问题描述>
    - expected_result: <预期结果描述>
    - reproduction_steps: |
        1. <步骤 1>
        2. <步骤 2>
        ⚠️ 重要：必须真实执行以下步骤，不得以阅读代码代替！

    ────────────────────────────────────────
    请执行问题复现、诊断、修复并验证修复结果。
  context: '{{ 从 pg-parse-config.py 输出的 JSON 中提取的 backend、frontend 等配置 }}'
```

注：`context` 参数为 JSON 字符串，包含 `backend`、`frontend`、`scriptsDir` 等配置值。编排器在执行 `{scriptsDir}/pg-parse-config.py <workflow>` 后，将输出的 JSON 中的 `backend`、`frontend` 等块序列化为字符串传入。

### Phase 5: 检查修复结果（两步验证法）

收到 coder agent 的修复报告后，执行**两步验证**：

#### 5a. 理解修复内容
- 根因分析是否合理
- 修复方案是否针对根因而非症状
- 修复范围是否恰当

#### 5b. 架构验证 — 读代码
对照以下检查点逐项确认：
- 修复是否遵循了项目的 API scope 规范
- 修复是否使用了与已有相似功能页面一致的 API/组件模式
- 缓存守卫是否使用了 `loaded` 标志而非 `length > 0`
- 修复是否引入了新的安全隐患

#### 5c. 功能验证 — 真实执行（必须对比修复前后）

**原则：验证必须包含「修复前状态记录 → 实施修复 → 修复后结果对比」三步。**

1. **复现阶段（before）**：coder 在 Step 2 复现问题时，必须记录**可量化的错误证据**：
   - 前端问题：DevTools Network 面板截图 / Console 错误文本 / 接口返回的 status code + body
   - 后端问题：`curl -v` 输出的 status code、response body、X-Request-Id

2. **修复阶段**：实施修复代码

3. **验证阶段（after）**：用**完全相同的方法**重新执行，记录结果，与 before 对比
   - 前端问题：使用 `pg-browser-testing-with-devtools` skill + 真实浏览器
   - 后端问题：使用 `curl` 真实发起 HTTP 请求
   - **必须输出对比表**：

```markdown
| 场景 | 修复前（before） | 修复后（after） |
|------|-----------------|----------------|
| 正常流程 | 201 Created | 201 Created ✓ |
| 无效参数 | 500 Internal Server Error | 404 User not found ✓ |
| ... | ... | ... |
```

#### 5d. Code Review 检查清单
- [ ] 修复是否只改了目标文件（无连带改动）
- [ ] 修复是否遵循了项目的 API scope 规范
- [ ] 复现时观察的「可量化指标」是否在验证时被重新测量
- [ ] 静态检查（lint）通过

### Phase 6: 重试逻辑

编排器完成 Phase 5 验证后，判断验证结果：

```text
验证结果
    │
    ├─ ✅ 全部通过 → 输出最终结论
    │
    ├─ ❌ 检查清单未通过（lint/scope 等）→ 直接重新派遣 coder
    │     （明确告知：仅修复检查清单问题，不改变修复方案）
    │
    └─ ❌ E2E/功能验证失败
          │
          ├─ 分析与本次修复**根因相关**？
          │     ✅ 是 → 分析遗漏了什么，更新诊断方向后重新派遣 coder（第 1 次）
          │             → 再失败则标记 ESCALATE，需人工介入（第 2 次）
          │
          └─ ❌ 否 → 判断失败类型：
                        ├─ 环境/数据/已知问题 → 记入 KnownIssues.md，标记为已记录
                        └─ 代码 bug（与本次修复无关）→ 作为同次修复的连带问题重新派遣
```

| 情况 | 处理方式 |
|------|---------|
| 验证失败（第 1 次） | 分析上次诊断遗漏了什么，更新诊断方向后重新派遣 coder |
| 验证失败（第 2 次） | 标记 ESCALATE，需要人工介入 |
| coder 无法修复 | 标记需要人工介入 |
| 失败与本次修复根因无关 | 分析失败类型：环境问题记 KnownIssues，无关代码 bug 作为连带问题重新派遣 |

---

## 最终结论格式

编排器**必须**严格按以下模板输出，不得自行删减字段。

```markdown
## 问题修复结论

### 问题
[issue_title]

### 修复状态
[修复成功 / 修复失败 / 需人工介入]

### 根因
[一句话说明根因，如：创建用户接口未校验邮箱格式]

### 修复摘要
[简要说明修复了什么，列出变更文件]

### 验证结果

#### 功能验证对比表
| 场景 | 修复前（before） | 修复后（after） |
|------|-----------------|----------------|
| ... | ... | ... |

#### Code Review 检查清单
- [✅] 修复只改了目标文件（无连带改动）
- [✅] 遵循项目 API scope 规范
- [✅] 可量化指标已重新测量
- [✅] 静态检查通过

### 备注
[如有必要，如：Test X 失败与本次修复根因无关，已记入 KnownIssues]
```