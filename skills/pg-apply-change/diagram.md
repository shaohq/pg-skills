# pg-apply-change 工作流图

## 1. 整体编排流程

```mermaid
graph TD
    Start([/opsx-apply change-name]) --> Extract[从 pg-parse-config.py 获取<br/>统一配置]
    Extract --> ReadTasks[读取 tasks.md<br/>获取各 Phase 任务清单]
    ReadTasks --> Hostname[WORKER_NAME = hostname]
    Hostname --> Branch[git checkout -b<br/>feat/WORKER_NAME/change]
    Branch --> InitChain[初始化 context-chain.md]

    InitChain --> Over[进入 Phase A→G 顺序循环]

    Over --> A[Phase A: 后端测试]
    A --> B[Phase B: 后端实现]
    B --> C[Phase C: 后端验证]
    C --> D[Phase D: OpenAPI 生成]
    D --> E[Phase E: 前端测试]
    E --> F[Phase F: 前端实现]
    F --> G[Phase G: 前端验证]
    G --> Done

    Done --> Check{WORKFLOW_FAILED?}
    Check -->|false| Archive[归档 · 提交 · 成功报告]
    Check -->|true| WIP[WIP 提交 · 失败报告]
```

## 2. Phase A/B/E/F — 简单派遣

```mermaid
graph TD
    StartA([进入 Phase]) --> CheckTasks{Phase 有未完成任务?}
    CheckTasks -->|全部完成 或 - 无| Skip[跳过]
    CheckTasks -->|有未完成任务| AppendChain[追加 SUB-START 到 context-chain]
    AppendChain --> Dispatch[通过 pg_dispatch_agent tool<br/>派遣子 agent，传递任务 + 配置]
    Dispatch --> Result{agent 返回?}
    Result -->|正常完成| Ok[追加 SUB-END COMPLETED<br/>验证 tasks.md 已更新]
    Result -->|空结果| Retry{重试次数 < 3?}
    Retry -->|是| Dispatch
    Retry -->|否| Fail[WORKFLOW_FAILED=true<br/>跳出循环]
    Ok --> Next[进入下一 Phase]
    Skip --> Next
```

## 3. Phase C/G — 验证派遣 (verify→fix 循环)

```mermaid
graph TD
    StartV([进入 Phase]) --> CheckV{Phase 有未完成任务?}
    CheckV -->|全部完成 或 - 无| SkipV[跳过]
    CheckV -->|有未完成任务| Init[attempt=1, max=4]
    Init --> VChain[追加 Verify-START 到 context-chain]
    VChain --> DispatchV[派遣 verify agent<br/>传递配置]
    DispatchV --> Report[读取 verification report]

    Report --> Decide{Recommendation?}

    Decide -->|PROCEED| DoneV[标记完成 · 进入下一 Phase]

    Decide -->|ESCALATE| MaxCheck{attempt ≤ 4?}

    MaxCheck -->|否| FailV[WORKFLOW_FAILED=true]

    MaxCheck -->|是| FixVer{attempt ≤ 2?}
    FixVer -->|是| FixStd[派遣 fix agent 标准版]
    FixVer -->|否| FixPro[派遣 fix agent Pro 版]
    FixStd --> FixChain[追加 Fix-END 到 context-chain<br/>attempt += 1]
    FixPro --> FixChain
    FixChain --> VChain
```

## 4. Phase D — 编排器自执行 (OpenAPI 生成)

```mermaid
graph TD
    StartD([进入 Phase D]) --> CheckD{Phase 有未完成任务?}
    CheckD -->|全部完成 或 - 无| SkipD[跳过]
    CheckD -->|有未完成任务| CheckBackend{统一配置有<br/>OpenAPI 配置?}
    CheckBackend -->|无| MarkSkip[标记为 - 无 · 跳过]
    CheckBackend -->|有| PortCheck{Backend.port 已就绪?}
    PortCheck -->|否| StartBackend[执行 Backend.start<br/>等待健康检查通过]
    StartBackend --> RunGen
    PortCheck -->|是| RunGen[执行 OpenAPI.command]
    RunGen --> GenOk{生成成功?}
    GenOk -->|是| UpdateTasks[标记 tasks.md 全部完成<br/>追加到 context-chain]
    GenOk -->|否| FailD[WORKFLOW_FAILED=true]
    UpdateTasks --> NextD[进入下一 Phase]
    SkipD --> NextD
    MarkSkip --> NextD
```

## 5. 收尾处理

```mermaid
graph TD
    StartE([所有 Phase 执行完毕]) --> Status{WORKFLOW_FAILED?}

    Status -->|false| Archive[归档变更<br/>mkdir + mv]
    Archive --> Duration[记录总耗时到 context-chain]
    Duration --> Commit[git add -A<br/>git commit -m feat: xxx]
    Commit --> Push[git push origin HEAD]
    Push --> SuccessReport[输出成功报告<br/>含每个 Phase 状态 + 产出物]

    Status -->|true| NoArchive[不归档]
    NoArchive --> Duration2[记录总耗时到 context-chain]
    Duration2 --> WIPCommit[git add -A<br/>git commit -m feat: xxx]
    WIPCommit --> FailReport[输出失败报告<br/>含失败 Phase + 原因 + context-chain 路径]
```

## 各图对应关系

| 图 | 覆盖范围 | 对应 SKILL 章节 |
|----|---------|----------------|
| 1. 整体编排 | 全局流程概览 | 编排器执行工作流 |
| 2. 简单派遣 | Phase A/B/E/F 内部逻辑 | 简单派遣 |
| 3. 验证派遣 | Phase C/G verify→fix 循环 | 验证派遣 + 异常处理 |
| 4. 自执行 | Phase D OpenAPI 生成 | 编排器自执行 |
| 5. 收尾处理 | 成功/失败后的操作 | 完成处理 |
