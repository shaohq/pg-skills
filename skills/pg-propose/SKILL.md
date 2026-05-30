---
name: pg-propose
description: 生成一个变更提案，一次性产出所有产物（proposal、design、tasks）。用户描述需求后，自动生成完整的提案文档，供 pg-apply-change 实现。
license: MIT
compatibility: 需要 `pg-spec/changes/` 目录结构和 `pg-spec/config.yaml` 统一配置文件。
metadata:
  author: pg
  version: "1.1"
---

# pg-propose

生成变更提案——创建变更目录并一次性产出所有产物：
- `proposal.md`（做什么、为什么做）
- `design.md`（怎么做、验证标准）
- `tasks.md`（按 A-G 阶段划分的实现步骤 + E2E 测试描述）

产物就绪后，可执行 `/3-pg-apply` 开始实现。

---

**输入**：用户提供变更名称（kebab-case）或对需求的描述。

---

## 第一阶段：确认变更名称（强制门控）

在开始任何代码调研、文件读取、代码修改之前，你必须先做以下三件事，**缺一不可**：

### 1a. 创建 TodoWrite

立即创建如下 TodoWrite：

```
TodoWrite:
1. [待开始] 确认变更名称（等待用户确认）
2. [待开始] 创建变更目录
3. [待开始] 生成 proposal.md
4. [待开始] 生成 design.md
5. [待开始] 判定变更类型
6. [待开始] 生成 tasks.md
```

### 1b. 推导变更名称

从用户描述中推导出 kebab-case 名称（例如 "添加用户认证" → `add-user-auth`）。

### 1c. 询问用户确认

使用 `question` 工具向用户确认变更名称：

- **question 类型**：single（单选）
- **header**：`确认变更名称`
- **question 内容**：展示推导出的变更名称，请用户选择
- **options**：
  1. `确认，开始生成` — 继续到第二阶段
  2. `修改名称` — 用户提供新的变更名称（触发新循环）

**TodoWrite 更新**：选择"确认"后，将第 1 项标记为完成

---

## ⛔ 第一阶段禁令

从你加载本 SKILL 开始，到用户确认变更名称之前，**严禁执行以下任何操作**：

- ❌ 严禁读取任何源代码文件
- ❌ 严禁搜索或浏览项目代码库（禁止使用 Glob、Grep、Read 工具浏览代码）
- ❌ 严禁加载本项目 AGENTS.md 或其他开发指南文件
- ❌ 严禁修改任何文件
- ❌ 严禁读取项目目录结构（如 `ls src/views/`）
- ❌ 严禁执行任何与提案生成无关的命令

**此阶段唯一允许的操作**：创建 TodoWrite + 推导变更名称 + 询问用户确认。

---

## 第二阶段：生成提案产物

**前提**：用户已确认变更名称，且 **TodoWrite 第 1 项已标记为完成**。

### 2a. 创建变更目录

```bash
mkdir -p "pg-spec/changes/<change-name>"
cat > "pg-spec/changes/<change-name>/.pg-spec.yaml" << 'EOF'
name: <change-name>
version: "1.0"
EOF
```

验证 `pg-spec/changes/<change-name>/` 目录已创建。更新 TodoWrite 第 2 项。

### 2b. 获取配置上下文

```bash
pg_dispatch tool 自动读取 pg-spec/config.yaml，无需手动执行
```

从输出 JSON 获取：
- `context`：项目技术栈、编码约定、设计模式
- `rules`：各产物的生成规则（proposal/design/tasks 规则）
- `test_strategy`：测试策略（TDD、覆盖率目标）
- `coding_standards`：编码规范
- `backend`、`frontend`：构建和运行命令（供 tasks.md 引用）

### 2c. 依次生成产物

按顺序生成四个产物：proposal.md → design.md → 判定类型 → tasks.md。每个产物依赖前一个产物的内容。
每生成一个产物后，更新 TodoWrite 对应项。

#### proposal.md

路径：`pg-spec/changes/<change-name>/proposal.md`

模板结构：

```markdown
# {change-name}
## 背景
{为什么需要这个变更}

## 目标
{要解决什么问题、达到什么效果}

## 范围
### 包含
{本变更要做的事}

### 不包含
{明确不做的事}

## 方案概述
{简要描述技术方案}

## 风险和注意事项
{潜在风险、注意事项}
```

**约束**（来自统一配置 `rules.proposal`）：
- 使用中文撰写
- 保持简洁，聚焦 why 和 what
- 详细技术说明留给 design.md

#### design.md

路径：`pg-spec/changes/<change-name>/design.md`

模板结构：

```markdown
# {change-name} 设计
## 架构概览
{涉及的后端模块、前端组件、数据流}

## API 设计（如有）
{接口路径、请求/响应格式、状态码}

## 数据模型（如有）
{新增或修改的数据库表、字段}

## 组件设计（如有）
{前端组件拆分、交互逻辑}

## Verification Criteria
### Backend Verification Criteria
| ID | 验证项 | 方法 | 预期结果 |
|-----|--------|------|---------|
| V-Backend-1 | ... | ... | ... |

### Frontend Verification Criteria
| ID | 验证项 | 方法 | 预期结果 |
|-----|--------|------|---------|
| V-Frontend-1 | ... | ... | ... |
```

**约束**（来自统一配置 `rules.design`）：
- 使用中文撰写
- UI 布局：使用 ASCII box 可视化界面结构（用于展示组件位置、嵌套关系）
- 代码示例：使用标准 markdown 代码块（```），禁止用 ASCII 框包裹
- 组件描述：使用结构化格式（表格、编号列表、bullet points），不用 ASCII 框
- 前端列表页必须包含 ID 列
- Verification Criteria 的编号规则：V-Backend-N、V-Frontend-N
- 每个验证项需包含具体的 HTTP 状态码、响应格式或 UI 行为

### 2d. 判定变更类型

在 design.md 完成之后、生成 tasks.md 之前，必须先执行变更类型判定：

1. **列举后端改动**：列出本次变更涉及的所有后端代码（新增/修改的 API 端点、业务逻辑、数据模型等）
2. **列举前端改动**：列出本次变更涉及的所有前端代码（新增/修改的组件、页面、API 模块等）
3. **判定类型**：
   - **全栈变更**：后端 + 前端都有改动 → Phase A 必须包含至少一条测试任务
   - **仅后端变更**：只有后端改动 → Phase A 必须包含至少一条测试任务
   - **仅前端变更**：只有前端改动 → Phase A-D 写 `- 无`
4. **记录判定结果**：将类型判定结果记录到临时上下文，供生成 tasks.md 时引用

**示例**：
```
后端改动列举：
  1. 新增 BucketS3InfoResponse（数据模型）
  2. 新增 ObjectStorageService.getBucketS3Info()（业务方法）
  3. 新增 BucketController.getBucketS3Info()（API 端点）

前端改动列举：
  1. 新增 BucketDetailDialog（组件）
  2. 修改 detail 页面（添加渲染函数和 dialog 引用）

→ 有后端改动 → 全栈变更 → Phase A 必须写测试，不能写 "无"
```

更新 TodoWrite 第 5 项。

#### tasks.md

路径：`pg-spec/changes/<change-name>/tasks.md`

使用统一的 Phase A-G 结构。**任务列表必须使用 `- [ ] X.Y` 格式**（A=1.x, B=2.x, ..., G=7.x），
禁止使用 markdown 标题（如 `### 任务 X-Y`）或多级列表代替。

全栈变更示例：
```markdown
## 1. Phase A: 后端测试先行 (Testing Agent)

- [ ] 1.1 编写后端单元测试：Xxx 业务方法验证正常创建和异常处理
- [ ] 1.2 编写后端 E2E 测试：POST /api/xxx 创建后 GET /api/xxx/{id} 返回正确数据

## 2. Phase B: 后端实现开发 (Development Agent)

- [ ] 2.1 新增 Xxx 数据模型字段
- [ ] 2.2 更新 Xxx 业务逻辑
- [ ] 2.3 更新 Xxx API 接口

## 3. Phase C: 后端集成验证 (Verification Agent)

- [ ] 3.1 运行 `{backend.lint}` — 检查代码风格（必须在启动前执行）
- [ ] 3.2 运行 `{backend.test}` — 运行单元测试（必须在启动前执行）
- [ ] 3.3 执行 `{backend.start}` 启动后端（无论端口是否可用）
- [ ] 3.4 验证 V-Backend-1：POST 创建返回 201
- [ ] 3.5 验证 V-Backend-2：GET 查询返回正确字段

## 4. Phase D: 生成前端 OpenAPI 客户端

- [ ] 4.1 确认后端已启动：`curl http://localhost:{backend.port}/api-docs`
- [ ] 4.2 执行 `{openapi.command}` 重新生成

## 5. Phase E: 前端测试先行 (Testing Agent)

- [ ] 5.1 编写前端单元测试：列表页渲染操作列
- [ ] 5.2 编写前端 E2E 测试：打开列表 → 点击创建 → 填写表单 → 提交 → 验证列表更新
  **验证要求**：
  1. 创建成功后列表新增一行
  2. 包含错误捕获和诊断信息记录

## 6. Phase F: 前端实现开发 (Development Agent)

- [ ] 6.1 新增列表页面组件
- [ ] 6.2 新增创建表单抽屉/对话框

## 7. Phase G: 前端集成验证 (Verification Agent)

- [ ] 7.1 执行 `{frontend.start}` 启动前端（无论端口是否可用）
- [ ] 7.2 验证 V-Frontend-1：列表页正确渲染
- [ ] 7.3 验证 V-Frontend-2：创建后列表更新
- [ ] 7.4 执行 `{frontend.lint}` 无报错
- [ ] 7.5 执行 `{frontend.format}` 格式正确
```

仅前端变更示例（Phase A-D 用 `- 无` 保持占位，Phase E-G 保持 X.Y 编号）：
```markdown
## 1. Phase A: 后端测试先行 (Testing Agent)

- 无

## 2. Phase B: 后端实现开发 (Development Agent)

- 无

## 3. Phase C: 后端集成验证 (Verification Agent)

- 无

## 4. Phase D: 生成前端 OpenAPI 客户端

- 无

## 5. Phase E: 前端测试先行 (Testing Agent)

- [ ] 5.1 编写前端 E2E 测试：跳转详情页 → 验证信息展示正确
  **验证要求**：页面标题正确显示，Tab 内容正确渲染

## 6. Phase F: 前端实现开发 (Development Agent)

- [ ] 6.1 修改详情页面布局

## 7. Phase G: 前端集成验证 (Verification Agent)

- [ ] 7.1 执行 `{frontend.start}` 启动前端
- [ ] 7.2 验证 V-Frontend-1：页面标题显示正确
- [ ] 7.3 验证 V-Frontend-2：返回按钮跳转到列表页
- [ ] 7.4 执行 `{frontend.lint}` 无报错
- [ ] 7.5 执行 `{frontend.format}` 格式正确
```

**约束**（来自统一配置 `rules.tasks`）：
- 使用中文撰写
- 任务编号必须使用 `- [ ] X.Y` 格式（A=1.x, B=2.x, ..., G=7.x），禁止使用 markdown 标题或其他格式
- Phase C 严格顺序：lint → test → start backend → verify API，不能调换
- Phase C 中必须执行后端启动脚本（不论端口是否已被占用）
- Phase G 必须包含 lint 验证（`{frontend.lint}`）和格式检查（`{frontend.format}`）作为独立编号任务
- Phase E/G 的 E2E 测试必须包含强断言。**验证要求示例**：
  - 创建成功后：必须验证数据出现在列表，不只是验证消息
  - 删除后：必须验证数据从列表消失
  - 每个 E2E 任务必须包含错误捕获和诊断信息记录
- **仅前端变更时**（由步骤 2d 判定为"仅前端"）：Phase A-D 写 `- 无` 占位，Phase E-G 保持 `- [ ] X.Y` 格式正常编写

## 第三阶段：最终确认与执行

产物生成完成后，更新 TodoWrite 全部标记为完成。使用 `question` 工具向用户展示产物摘要并确认：

- **question 类型**：single（单选）
- **header**：`提案已就绪`
- **question 内容**：展示产物摘要（变更名称、产物位置、已创建文件）
- **options**：
   1. `开始实现` — 请用户在终端输入 `/3-pg-apply {change-name}`
   2. `修改提案` — 等待用户提供修改意见

用户选择"开始实现"后，告知用户在终端输入 `/3-pg-apply {change-name}` 命令。该命令会触发 `pg-manager` 主 agent（`mode: primary`）加载 `pg-apply-change` SKILL，自动按 A-G 阶段编排实现。

> **为什么不是自动执行？** `pg-manager` 是 `mode: primary` 的主 agent，必须以独立会话加载，无法通过 Task 工具作为子 agent 派遣。因此需要用户在终端输入命令来触发。

用户选择"修改提案"时，标记该阶段未完成，等待用户提供修改意见后重新生成。

## 产物生成指导原则

- `context` 和 `rules` 是给你的约束，不可复制到产物中
- 每个产物文件写入后验证文件存在
- 如果变更名称已存在，询问用户是继续还是新建

## ⛔ 第二阶段/第三阶段禁令

下列操作在**整个提案阶段（第一阶段到第三阶段结束）**均被禁止：

- ❌ 严禁修改任何业务代码文件
- ❌ 严禁执行 lint、typecheck、test 等验证命令
- ❌ 严禁启动任何服务（backend/frontend）

生成产物过程中如需了解项目结构来编写 design.md，**仅限于读取产物模板和项目根级配置文件**（如 `pg-spec/config.yaml`、`package.json` 等），不得深入业务代码目录。
