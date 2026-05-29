---
name: pg-micro-change
description: 快速实现小型变更——单 agent 按全栈管线（A→G）顺序自动完成，不生成设计文档，不派生子 agent
license: MIT
compatibility: 使用 pg-spec/config.yaml 统一配置
metadata:
  author: pg
  version: "1.0"
---

# pg-micro-change

快速实现小型变更。同一 agent 按 A→G 阶段顺序执行，不生成设计文档，不派生子 agent。

## 适用范围

| 适合 | 不适合 |
|------|--------|
| 变更涉及 ~8 个文件以内 | 跨多模块的复杂变更 → 用 pg-propose + pg-apply-change |
| 简单 CRUD 增改、字段变更、UI 调整 | Bug 修复 → 用 pg-fix-issue |
| 新增简单 API + 对应前端功能 | 架构重构、新模块引入 |
| 无 DB migration、无新依赖引入 | 需要审核/评审的变更 |

## 配置

此 SKILL 读取 `pg-spec/config.yaml`，在 Phase 0 开头执行：

```bash
python3 {scriptsDir}/pg-parse-config.py pg-micro-change > /tmp/pg-config.json
```

输出包含 `backend`、`frontend`、`openapi`、`git` 四个配置块，各阶段通过 `{key}` 占位符引用。

### 引用的配置键

| 配置键 | 用途 | 示例值 |
|--------|------|--------|
| `backend.root` | 后端项目根目录 | `maas-backend` |
| `backend.port` | 后端服务端口 | `9080` |
| `backend.compile` | 编译验证命令 | 编译但不执行测试的命令 |
| `backend.lint` | 后端代码风格检查 | lint 命令 |
| `backend.test` | 后端测试命令 | 测试命令 |
| `backend.start` | 后端启动命令 | 启动命令 |
| `backend.health-check` | 后端健康检查 | `curl ...` |
| `frontend.root` | 前端项目根目录 | `maas-frontend` |
| `frontend.port` | 前端服务端口 | `3008` |
| `frontend.lint` | 前端代码检查 | lint 命令 |
| `frontend.format` | 前端代码格式化 | 格式化命令 |
| `frontend.start` | 前端启动命令 | 启动命令 |
| `openapi.command` | OpenAPI 客户端生成命令 | 生成命令 |
| `openapi.frontend-root` | 生成代码落地目录 | `maas-frontend` |

---

## 工作流

```
Phase 0: 快速规划  ─→  用户确认  ─→  Phase A / B / C / D / E / F / G
                                         │
                                    └─ 每个阶段自验证，失败立即修复
                                    └─ 累计 3 次修复失败 → 报错退出
```

### 阶段总览

| Phase | 名称 | 执行条件 |
|-------|------|---------|
| 0 | 快速规划 | 总是执行 |
| A | 后端测试 | Phase 0 判定需要 |
| B | 后端实现 | Phase 0 判定有后端改动 |
| C | 后端验证 | Phase 0 判定有后端改动 |
| D | OpenAPI 生成 | Phase 0 判定有后端改动 |
| E | 前端测试 | Phase 0 判定需要 |
| F | 前端实现 | Phase 0 判定有前端改动 |
| G | 前端验证 | Phase 0 判定有前端改动 |

---

### Phase 0：快速规划

> **目标**：分析需求，制定计划，获得用户确认。
> **禁令**：不生成设计文档，不修改任何代码。
> **硬性规则**：无论变更多小，Phase 0 必须先执行再动代码。用户直接要求实现不视为跳过 Phase 0 的理由。

#### 步骤 0.0：自检（必须在任何代码改动前完成）

在执行任何 Read/Edit/Write/Bash（仅用于读取配置的 Bash 除外）之前，先填充以下自检表：

```
- [ ] `python3 {scriptsDir}/pg-parse-config.py pg-micro-change > /tmp/pg-config.json` 是否已执行？
- [ ] 变更涉及哪些文件（列出绝对路径）？
- [ ] 本次变更是否需要修改生产代码？
- [ ] 本次变更是否需要修改测试代码？
- [ ] 跳过哪些阶段？理由是什么？
```

有一项未回答 → 不得进入 Phase A/B/E/F。补充完整后才能继续。
**如果在未完成 Phase 0 的情况下已经进入了实现阶段：立即撤销所有未提交的代码改动，回到 Phase 0 完成自检。**

#### 步骤 0.1：读取配置

```bash
python3 {scriptsDir}/pg-parse-config.py pg-micro-change > /tmp/pg-config.json
```

从输出 JSON 读取后续所需的所有配置值（backend、frontend、openapi 各键）。

#### 步骤 0.2：分析需求

首先判断需求是否已在当前对话中明确：
- **需求已明确**（如刚从 pg-explore/pg-propose 过渡，或用户之前在对话中已详述）：直接进行变更分析，**不要**问用户已经在对话中回答过的问题
- **需求不明确**：按下方指引阅读源代码并分析

然后确定：

1. **变更类型**：仅后端 / 仅前端 / 全栈
2. **受影响文件**：列出具体文件路径（预估 ≤8 个）
3. **测试策略**：按下方判定表确定

#### 测试策略判定表

| 场景 | 策略 |
|------|------|
| 新增业务逻辑方法 | 写单元测试 |
| 新增 API endpoint | 写 curl/E2E 测试 |
| 新增/修改数据模型 | 检查关联测试是否需要更新 |
| 修改已有业务逻辑 | 评估已有测试覆盖，补充或修改 |
| 新增前端组件/页面 | 写组件测试 |
| 修改前端已有逻辑 | 评估已有测试，补充或修改 |
| 仅改配置文件/常量/文案 | 跳过测试 |
| 纯 UI 样式/布局调整 | 跳过测试 |
| 重构（不改行为） | 修改已有测试保持同步 |

> **注意**：Phase C（后端验证）和 Phase G（前端验证）已包含端点级别的端到端验证，因此测试策略聚焦在**单元测试和组件测试**，不需要重复覆盖 E2E 场景。

#### 步骤 0.3：展示计划并确认

将分析结果简要展示给用户，示例格式：

```
变更类型：全栈
受影响文件：
  - {backend.root}/.../XxxController（新增）
  - {backend.root}/.../XxxService（新增）
  - {frontend.root}/.../xxx-list（修改）
  - {frontend.root}/.../xxx-api（新增）
测试策略：
  - 后端：写单元测试（XxxService）
  - 前端：修改已有测试（补充搜索用例）
跳过阶段及理由：
  - Phase D（OpenAPI）：API 签名未变，无需重新生成
  - Phase E（前端测试）：纯 UI 按钮添加，无新增逻辑
```

**没有理由的阶段不得跳过。** 如果所有阶段都需要执行，写明"无"。

使用 `question` 工具请求确认：

```
header: 确认计划
options:
  - 确认，开始执行 — 进入 Phase A
  - 修改计划 — 用户提供调整
```

- **确认后**：立即创建 TodoWrite 跟踪各阶段进度，进入 Phase A
- **修改**：用户补充后调整计划，再次展示确认

#### 步骤 0.4：Phase 0 自核查

```
- [ ] 步骤 0.0 自检表已填写完整？
- [ ] 配置已读取（`/tmp/pg-config.json` 存在且内容正确）？
- [ ] 变更分析完成（类型、文件、测试策略）？
- [ ] 计划已展示并获得用户确认？
- [ ] TodoWrite 已创建？
- [ ] 每个跳过阶段都有明确理由？
```

有一项未通过 → 修正后再进入 Phase A。

---

### Phase A：后端测试

> **条件**：Phase 0 判定需要写后端测试。
> **目标**：为新增/修改的逻辑编写或更新单元测试。
> **禁令**：不修改生产代码。测试必需的编译依赖通过局部 stub 或 mock 框架解决。

#### 步骤 A.1：创建/修改测试

> **Phase 0 验证**：在执行任何 Edit/Write 之前，确认 Phase 0 已通过：
> 1. 步骤 0.0 自检表已填写？
> 2. 步骤 0.4 自核查已通过？
> 3. 用户已通过 question 确认计划？
>
> 有任意一项未完成 → 立即停止，返回 Phase 0。已完成但未通过自检的代码视为无效，必须撤销。

在 `{backend.root}` 下搜索定位或创建对应测试类（遵循项目已有的测试目录约定）。

#### 步骤 A.2：编译验证

```bash
cd {backend.root} && {backend.compile}
```

必须零错误。如有错误 → 修复测试代码 → 重新编译。
连续 3 次失败 → 输出错误报告，终止工作流。

#### 步骤 A.3：生产代码未改动检查

```bash
cd {backend.root} && git diff --stat
```

确认只有测试文件被修改。如果有生产代码文件被修改 → 撤销，回到 Phase A.1 只改测试。项目目录结构约定由 `AGENTS.md` 说明。

**成功后**：进入 Phase B。

---

### Phase B：后端实现

> **条件**：Phase 0 判定有后端改动。
> **禁令**：不修改测试代码。测试已在 Phase A 完成并通过编译。
> **如果发现需要修改测试**：回退到 Phase A，而不是在 Phase B 中顺带修改。

#### 步骤 B.1：实现代码

> **Phase 0 验证**：在执行任何 Edit/Write 之前，确认 Phase 0 已通过（三项同 Phase A.1）。未通过 → 撤销代码，返回 Phase 0。

按需求实现后端代码（API 端点 / 业务逻辑 / 数据模型等），遵循项目编码规范。

#### 步骤 B.2：代码风格检查

```bash
cd {backend.root} && {backend.lint}
```

有违规 → 修复 → 重新检查。连续 3 次失败 → 报错退出。

#### 步骤 B.3：编译验证

```bash
cd {backend.root} && {backend.compile}
```

必须零错误。

**成功后**：进入 Phase C。

---

### Phase C：后端验证

> **条件**：Phase 0 判定有后端改动。

#### 步骤 C.1：运行全量单元测试

```bash
cd {backend.root} && {backend.test}
```

**禁止使用测试过滤参数**（如 Maven 的 `-Dtest=` 或其他框架的类似过滤机制）——必须运行整个模块的所有测试以确保回归覆盖。

测试失败 → 分析根因 → 修复代码/测试 → 重新运行。
连续 3 次修复失败 → 报错退出。

#### 步骤 C.2：启动后端

```bash
{backend.start}
```

等待端口 `{backend.port}` 就绪（轮询最多 60 秒）：

```bash
for i in $(seq 1 60); do
  if netstat -tlnp 2>/dev/null | grep -q ":{backend.port} "; then
    echo "Backend ready"
    break
  fi
  sleep 1
done
```

启动失败或超时 → 输出错误原因 → 报错退出（基础设施问题不计入重试计数）。

#### 步骤 C.3：API 验证

对新增/修改的每个 endpoint 发送 curl 请求，验证：
- HTTP 状态码符合预期（201/200/204 等）
- 响应体包含关键字段
- 错误场景返回正确状态码和错误信息

验证失败 → 修复后端代码 → 重新验证。
连续 3 次修复失败 → 报错退出。

#### 步骤 C.4：后端保持运行

Phase C 结束后，**保持后端服务运行**（Phase D 需要）。

#### 步骤 C.5：Phase C 自核查

```
- [ ] 步骤 C.1 运行了全量测试（未使用过滤参数）？
- [ ] 所有测试通过？
- [ ] 后端已启动并可通过 curl 访问？
- [ ] 新增/修改的 endpoint 已验证（状态码 + 响应体）？
```

**成功后**：进入 Phase D。

---

### Phase D：OpenAPI 生成

> **条件**：Phase 0 判定有后端改动。
> **注意**：如果配置中没有 `openapi` 块，跳过此阶段。

#### 步骤 D.1：确认后端运行

检查后端是否在 `{backend.port}` 运行。如未运行，重新执行 `{backend.start}`。

#### 步骤 D.2：生成客户端

```bash
cd {openapi.frontend-root} && {openapi.command}
```

验证生成的文件已存在（根据项目结构确认正确输出目录）。

生成失败 → 修复后重试 → 连续 3 次失败 → 报错退出。

#### 步骤 D.3：Phase D 自核查

```
- [ ] 后端运行中？
- [ ] `{openapi.command}` 执行成功？
- [ ] 生成的客户端文件存在于预期目录？
```

**成功后**：进入 Phase E。

---

### Phase E：前端测试

> **条件**：Phase 0 判定需要写前端测试。
> **目标**：为新增/修改的前端逻辑编写或更新测试。
> **禁令**：不修改生产代码。

#### 步骤 E.1：创建/修改测试

> **Phase 0 验证**：在执行任何 Edit/Write 之前，确认 Phase 0 已通过（三项同 Phase A.1）。未通过 → 撤销代码，返回 Phase 0。

在 `{frontend.root}` 下搜索定位或创建对应测试文件（遵循项目已有的测试目录约定）。

#### 步骤 E.2：lint 检查

```bash
cd {frontend.root} && {frontend.lint}
```

如有错误 → 修复测试代码。规则同 Phase A 的 3 次失败限制。

#### 步骤 E.3：生产代码未改动检查

```bash
cd {frontend.root} && git diff --stat
```

确认只有测试文件被修改。混入了生产代码 → 撤销，回到 Phase E.1。

**成功后**：进入 Phase F。

---

### Phase F：前端实现

> **条件**：Phase 0 判定有前端改动。
> **禁令**：不修改测试代码。测试已在 Phase E 完成。
> **如果发现需要修改测试**：回退到 Phase E。

#### 步骤 F.1：实现代码

> **Phase 0 验证**：在执行任何 Edit/Write 之前，确认 Phase 0 已通过（三项同 Phase A.1）。未通过 → 撤销代码，返回 Phase 0。

按需求实现前端代码（组件 / 页面 / API 模块 / Store / Route 等），遵循项目现有组件模式。

#### 步骤 F.2：代码质量检查

```bash
cd {frontend.root} && {frontend.lint}
cd {frontend.root} && {frontend.format}
```

违规 → 修复 → 重新检查。连续 3 次失败 → 报错退出。

**成功后**：进入 Phase G。

---

### Phase G：前端验证

> **条件**：Phase 0 判定有前端改动。

#### 步骤 G.1：确认后端运行

检查后端是否在 `{backend.port}` 运行。如未运行，重新执行 `{backend.start}`。

#### 步骤 G.2：启动前端

```bash
{frontend.start}
```

等待端口 `{frontend.port}` 就绪。启动失败或超时 → 报错退出（不计入重试计数）。

#### 步骤 G.3：功能验证

使用 curl 或 DevTools 访问前端页面，验证新增/修改的功能按预期工作。

验证失败 → 修复前端代码 → 重新验证。连续 3 次修复失败 → 报错退出。

#### 步骤 G.4：Lint 复查

```bash
cd {frontend.root} && {frontend.lint}
cd {frontend.root} && {frontend.format}
```

lint 失败 → 修复 → 重新运行。

#### 步骤 G.5：Phase G 自核查

```
- [ ] 后端运行中？
- [ ] 前端已启动并可访问？
- [ ] 新增/修改的功能已验证？
- [ ] lint + format 零错误？
```

**所有步骤通过后**：进入完成总结。

---

## 完成总结

输出摘要：

```
## 变更完成

**变更名**：{从用户需求提取的名称}
**变更类型**：后端/前端/全栈
**Pipeline**: pg-micro-change

### 完成情况

| Phase | 状态 |
|-------|------|
| 0 - 快速规划 | ✅ |
| A - 后端测试 | ✅ / 跳过 |
| B - 后端实现 | ✅ / 跳过 |
| C - 后端验证 | ✅ / 跳过 |
| D - OpenAPI 生成 | ✅ / 跳过 |
| E - 前端测试 | ✅ / 跳过 |
| F - 前端实现 | ✅ / 跳过 |
| G - 前端验证 | ✅ / 跳过 |
```

---

## 错误处理

### 3 次修复失败

任何 Phase 中，如果连续 3 次修复尝试后仍未通过验证，**必须停止并报错**：

```
阶段 {Phase} 失败——连续 3 次修复未通过

失败阶段：Phase X - {阶段名称}
失败步骤：{具体步骤}
最后错误：{错误详情}
建议：检查错误原因后重试，或改用 pg-propose 生成文档后按步骤实施。
```

不允许自动降级——报错后由用户决定后续方案。

### 基础设施失败

后端/前端启动失败（端口被占用、服务异常退出等），属于基础设施问题而非代码问题：
- 输出错误原因
- **不计入 3 次重试计数**
- 报错退出

---

## 与 pg-explore 的集成

在 pg-explore 模式结束时，如果判断变更范围较小（~8 文件以内、无复杂跨模块依赖），应主动推荐：

> "这个需求比较清晰，变化范围不大，推荐直接用 `/2-pg-micro <描述>` 快速实现。如果变更有跨模块依赖或需要文档审核，可以用 `/2-pg-propose` 生成完整提案。"
