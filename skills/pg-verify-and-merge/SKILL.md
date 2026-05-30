---
name: pg-verify-and-merge
description: 将 feature branch 模拟合并到 master 并全量验证后合并。pg-apply-change 完成后自动触发。
license: MIT
compatibility: 由 manager agent 编排执行。项目根目录需要 `pg-spec/config.yaml` 统一配置文件。
metadata:
  author: pg
  version: "1.0"
---

# pg-verify-and-merge

## 概述

pg-apply-change 完成后，将 feature branch 合并到 master 前，先将 feature branch 合并到 master 的工作区（模拟合并），然后在合并后的代码上运行全量测试，确保主分支稳定性。

**核心原则：** 在合并后的代码上验证，不在 feature branch 上验证。

**关键改进：** 模拟合并后不切换分支，Phase 2 的验证和 Phase 3 的提交都在 default-branch 上完成。

## 何时使用

- pg-apply-change 工作流执行完成，feature branch 功能验证通过
- 准备将 feature branch 合并到 master

## 配置依赖

本 SKILL 声明所需的配置项。**SKILL 自身不解析配置文件。** orchestrator（manager agent）直接 Read `pg-spec/config.yaml` 获取工作流所需配置并注入上下文。

| 上下文变量 | 来源 | 用途 |
|-----------|------|------|
| `Backend.root` | 统一配置 → `backend.root` | Phase 2a/2c 工作目录 |
| `Backend.test` | 统一配置 → `backend.test` | Phase 2a 后端测试命令 |
| `Backend.lint` | 统一配置 → `backend.lint` | Phase 2a 后端 lint 命令 |
| `Backend.start` | 统一配置 → `backend.start` | Phase 2c 后端启动命令 |
| `Backend.port` | 统一配置 → `backend.port` | Phase 2c 端口检查 |
| `Backend.health-check` | 统一配置 → `backend.health-check` | Phase 2c 健康检查 |
| `Frontend.root` | 统一配置 → `frontend.root` | Phase 2b/2d/2e 工作目录 |
| `Frontend.lint` | 统一配置 → `frontend.lint` | Phase 2b/0 前端 lint 命令 |
| `Frontend.start` | 统一配置 → `frontend.start` | Phase 2d 前端启动命令 |
| `Frontend.port` | 统一配置 → `frontend.port` | Phase 2d 端口检查 |
| `Frontend.test` | 统一配置 → `frontend.test` | Phase 2e E2E 测试命令 |
| `Git.default-branch` | 统一配置 → `git.default-branch` | Phase 1/3 目标分支 |

如果 `frontend.format` 在统一配置中未定义，则 Phase 0 的格式化命令复用 `frontend.lint` 的值。

## 前置条件

- Feature branch 已推送到远端
- 当前在 feature branch 上，无未提交的修改（pg-apply-change 已完成并提交）
- `git remote` 可访问 origin/`Git.default-branch`

## 阶段结构

前置步骤（orchestrator 执行）：直接 Read `pg-spec/config.yaml` 获取配置，将以下值注入上下文：`Backend.root/test/lint/start/port/health-check`、`Frontend.root/lint/start/port/test`、`Git.default-branch`。

所有 phase 均为 orchestrator 自执行（无 sub-agent 派遣）。

```
Config: 获取工作流配置
    ↓
Phase 0: Auto-fix on Feature Branch（feature branch）
    ↓
Phase 1: 模拟合并到 master（切换到 default-branch）
    ↓
Phase 2: 全量验证（保持在 default-branch）
    ├── Phase 2a: 后端测试
    ├── Phase 2b: 前端 lint
    ├── Phase 2c: 启动后端服务
    ├── Phase 2d: 启动前端服务
    └── Phase 2e: 前端 E2E 测试
    ↓
Phase 3: 提交并推送（保持在 default-branch）
    ↓
Phase 4: 清理
```

### Phase 0: Auto-fix on Feature Branch

> Phase 0 在 feature branch 上执行，auto-fix 可能产生新的提交。

```bash
# 获取当前分支名（后续 Phase 需要）
CURRENT_BRANCH=$(git branch --show-current)

# 前端 lint 和格式化
cd {{Frontend.root}} && eval "{{Frontend.lint}}"

# 提交修复（如果有）
git add -A
git diff --cached --quiet || git commit -m "style: auto-fix before merge verification"
git push origin HEAD
```

**验证条件：** 所有修改已提交并推送成功。

**输出：** 将 `CURRENT_BRANCH` 记录到上下文，供后续 phase 使用。

---

### Phase 1: 模拟合并到 master

> 此 phase 从 feature branch 切换到 `{{Git.default-branch}}`，将 feature branch 合并到工作区（staged 但未提交）。

```bash
# $CURRENT_BRANCH 在 Phase 0 中已获取
CURRENT_BRANCH=$(git branch --show-current)

# 切换到目标分支并合并
git checkout "{{Git.default-branch}}"
git pull origin "{{Git.default-branch}}"
git merge --no-commit --no-ff "origin/$CURRENT_BRANCH"

if [ $? -ne 0 ]; then
    # 合并冲突 → 回退到 feature branch
    git merge --abort 2>/dev/null || true
    git checkout "$CURRENT_BRANCH"
    echo "MERGE_CONFLICT"
    exit 1
fi
```

**验证条件：** 无合并冲突。Phase 1 成功后，工作区处于模拟合并状态（merged staged, not committed）。

**关键约束：** Phase 1 完成后，整个 Phase 2 验证期间都必须保持在 `{{Git.default-branch}}` 分支上，**禁止切换回 feature branch**。这样 Phase 2 验证的就是合并后的代码。

---

### Phase 2: 全量验证

> **核心原则：** 在合并后的代码上验证，不在 feature branch 上验证。
>
> **状态保持：** Phase 2 整个过程都运行在 `{{Git.default-branch}}` 分支上，此时工作区已经包含 feature branch 的变更（staged but not committed）。Phase 2 验证的就是合并后的代码。

#### Phase 2a: 后端测试

```bash
cd {{Backend.root}} && eval "{{Backend.test}}"
```

**验证条件：** 后端测试全部通过。

#### Phase 2b: 前端 lint

```bash
cd {{Frontend.root}} && eval "{{Frontend.lint}}"
```

**验证条件：** lint 无错误。

#### Phase 2c: 启动后端服务

```bash
# 检查后端是否已在运行
if ! eval "{{Backend.health-check}}" > /dev/null 2>&1; then
    cd {{Backend.root}} && eval "{{Backend.start}}"
    # 等待就绪（最多 120s）
    for i in $(seq 1 60); do
        sleep 2
        if eval "{{Backend.health-check}}" > /dev/null 2>&1; then
            echo "Backend ready"
            break
        fi
    done
fi

# 再次验证
if ! eval "{{Backend.health-check}}" > /dev/null 2>&1; then
    echo "BACKEND_START_FAILED"
    exit 1
fi
```

**验证条件：** 后端健康检查通过。

#### Phase 2d: 启动前端服务

```bash
# 检查前端是否已在运行
if ! curl -s http://localhost:{{Frontend.port}} > /dev/null 2>&1; then
    cd {{Frontend.root}} && eval "{{Frontend.start}}"
    # 等待就绪（最多 120s）
    for i in $(seq 1 60); do
        sleep 2
        if curl -s http://localhost:{{Frontend.port}} > /dev/null 2>&1; then
            echo "Frontend ready"
            break
        fi
    done
fi

# 再次验证
if ! curl -s http://localhost:{{Frontend.port}} > /dev/null 2>&1; then
    echo "FRONTEND_START_FAILED"
    exit 1
fi
```

**验证条件：** 前端可访问。

#### Phase 2e: E2E 测试

```bash
cd {{Frontend.root}} && eval "{{Frontend.test}}"
```

**验证条件：** E2E 测试通过率达到 95% 以上，且失败用例不得为本次变更引入的新问题。

**判定标准：**
- 通过率 = 通过的测试数 / 总测试数
- 允许因测试环境数据不足（如列表页数据为空导致翻页测试失败）或外部依赖问题导致的失败
- 禁止因本次变更引入的代码问题导致的失败（如 API 接口变化、组件渲染错误等）

---

### Phase 3: 提交并推送

由于 Phase 1 已经将 feature branch 合并到 `{{Git.default-branch}}` 的工作区（staged），Phase 3 只需提交这个合并状态并推送。

```bash
CURRENT_BRANCH=$(git branch --show-current)

# 提交合并（已经在 default-branch 上，且工作区是合并状态）
git commit -m "Merge branch '$CURRENT_BRANCH' into {{Git.default-branch}}

Verified: All tests passed before merge."

if [ $? -ne 0 ]; then
    echo "COMMIT_FAILED"
    exit 1
fi

git push origin "{{Git.default-branch}}"
```

**验证条件：** 合并提交已推送到远端 `{{Git.default-branch}}`。

> **注意：** Phase 3 不再执行 `git merge --abort` 再 `git merge`，因为我们已经在正确的分支和工作区状态下。只需 `git commit` 即可。

---

### Phase 4: 清理

```bash
# 此时已在 {{Git.default-branch}} 分支上
CURRENT_BRANCH=$(git branch --show-current)

# 提示删除 feature branch
echo "Feature branch '$CURRENT_BRANCH' has been merged and committed to {{Git.default-branch}}"
echo "To delete local branch: git branch -d $CURRENT_BRANCH"
echo "To delete remote branch: git push origin --delete $CURRENT_BRANCH"
```

**注意：** Phase 4 不再需要切换分支或恢复 stash，因为整个流程都在 `{{Git.default-branch}}` 上执行。

---

## 输出格式

```
目标分支：{{Git.default-branch}}
Phase：{{phase}} ({{phase_name}})
状态：{{SUCCESS|FAILED}}
```

失败时额外输出：
```
失败 Phase：{{failed_phase}}
失败原因：{{description}}
下一步：根据失败阶段参考异常处理表
```

## 异常处理

| 失败阶段 | 处理方式 | 说明 |
|---------|---------|------|
| Phase 0 | 中止，提示手动修复 | lint 自动修复未必全覆盖 |
| Phase 1 | 中止，提示手动解决冲突 | 合并冲突必须人工介入 |
| Phase 2a-2b | 中止，提示修复并重试 | 回 feature branch 修复后重试 |
| Phase 2c-2e | 中止，提示服务或测试问题 | 环境问题修复后重试 |
| Phase 3 | 中止，提示手动解决合并问题 | 冲突窗口期 master 可能又有新提交 |

**不回退。** 任何阶段失败直接中止并报告，由人工决策下一步。

## 与 pg-apply-change 的集成

`pg-apply-change` 完成后，所有 phase 均通过时，**自动触发** pg-verify-and-merge 工作流，无需人工确认。

```
pg-apply-change（feature 开发与验证）
    ↓ (manager agent 自动触发)
pg-verify-and-merge（合并前验证与合并）
```

编排器（manager agent）在 pg-apply-change 末尾输出最终报告后，加载 `pg-verify-and-merge` SKILL 继续执行。
