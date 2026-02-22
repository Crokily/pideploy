# Agent 版架构问题调查（Reality Check）

> 调查时间：2026-02-22  
> 目标：解释为什么 agent 重构后并未提升稳定性、可用性与灵活性，并出现“重复实例/实例不可运行”等问题。

## 1) 结论摘要

当前 agent 版的核心问题是：**LLM 主要扮演“传话 + 调工具”角色，而非真正具备闭环决策与自愈能力的执行智能体**。

- 原本可确定执行的硬编码流程，被改造成“任务入队 → LLM 决定调哪个 tool → tool 执行”。
- 可观测性（trace/cost/eval）投入很多，但“创建成功后可运行验证”这类核心闭环不足。
- 由参数传递链不严谨（特别是异步 task 的上下文）引入了新失败面，典型现象是重复实例。

---

## 2) 原版 vs Agent 版：执行链路差异

### 原版（同步、确定性）

`original/frontend/src/app/api/instances/route.ts`

用户点击创建后，API route 内直接执行：
1. `prisma.instance.create(status=creating)`
2. `createInstanceStorage()`
3. 生成并写入配置
4. `createContainer()`
5. `prisma.instance.update(status=running, containerId, port, gatewayToken)`
6. `updateNginxPortMap()`

> 同一个请求内完整执行，失败路径也在同一代码上下文内处理。

### Agent 版（异步 + LLM 中间层）

- `agent/frontend/src/app/api/instances/route.ts` 只做：
  - 创建占位实例（`status=creating`）
  - 写入 `task(status=pending)`
  - 返回 `202`
- `agent/orchestrator/src/task-queue.ts` 轮询任务并调用 `executeTask()`
- `agent/orchestrator/src/agent-loop.ts` 将任务拼成自然语言消息发给模型
- 模型再调用 `instance_create` tool（`agent/orchestrator/src/tools/instance-create.ts`）

> 本质变成“API -> Task -> LLM -> Tool”，比“API -> 函数”多出一层不确定性。

---

## 3) 关键故障：重复实例的根因

最新修复提交：`640ad41 fix: prevent duplicate instance rows during async create tasks`

根因链路（修复前）：

1. API 已经创建了一条 `instance(creating)` 占位记录。
2. 但 task 参数里没有稳定传递 `instanceId/userId` 到 tool。
3. `instance_create` tool 在缺失 `instanceId` 时，走“新建实例”路径。
4. 结果：一次创建请求可能产生两条实例记录（占位 + 再次创建）。

该提交的修复方向是正确的：
- 在 task params 中补传 `instanceId/userId`
- 在 tool 内优先复用占位实例，避免重复创建

> 这说明问题不是“功能太少”，而是**控制面重构后，参数与状态一致性设计不够硬**。

---

## 4) 心跳为何“看起来在跑，但问题还在”

心跳逻辑见：`agent/orchestrator/src/heartbeat.ts` + `prompt.ts`

现状特征：
- 心跳以 prompt 形式描述目标，依赖 LLM 规划检查步骤。
- `maxTurnsPerHeartbeat=4`（`config.ts`）限制较紧，复杂环境下检查深度不足。
- 主要检查容器状态一致性（DB vs Docker），对“业务可用性”验证不充分（例如实例 HTTP 可访问、网关 token 链路可用）。

因此会出现：
- 心跳日志显示执行正常
- 但页面仍有异常实例、或实例“running 但不可用”

> **状态一致 != 服务可用。** 当前心跳更偏“状态对账”，不是“端到端可运行性验证”。

---

## 5) 设计层面的问题本质

1. **把确定性流程包在 LLM 外层，却没有把关键保障前移为硬约束。**
2. **观测能力强于治理能力。** trace/cost/eval 很完整，但失败后自动纠偏策略薄弱。
3. **agent prompt 负责“策略”，tool 负责“执行”，但中间缺少严格状态机。**
4. **幂等性设计不够系统化。** 创建、重试、补偿在并发/重入场景下容易产生副作用。

---

## 6) 建议改造方向（务实）

### A. 把关键路径从“LLM决定”改为“编排器硬状态机”
- `instance_create/start/stop/delete/update` 走确定性 pipeline。
- LLM 仅用于诊断分支（如错误分类、日志总结、下一步建议）。

### B. 明确“成功定义”并强制验收
创建成功至少满足：
1. DB 状态正确
2. Docker container running
3. Nginx 路由存在
4. 实例健康检查 endpoint 可达（或握手成功）

任一失败即标记 `degraded/error` 并触发补偿。

### C. 全链路幂等与去重
- 以 `task.id` + `instance.id` 建立幂等键。
- create 请求若存在同幂等键任务，直接复用结果或返回处理中。
- DB 层增加必要唯一约束/条件索引，防止“重复占位 + 重复创建”。

### D. 心跳升级为“可运行性巡检”
- 除状态对账外增加真实可用性探测。
- 对重复失败实例执行分级恢复（restart -> recreate -> 标记人工介入）。
- 记录 MTTR、恢复成功率，而不只记录“是否执行了心跳”。

### E. 失败面控制
- 为每个 tool 定义清晰的 precondition/postcondition。
- 将“report_result”从建议变为**流程强制步骤**（未报告即任务失败）。

---

## 7) 一句话评价

这次重构“把执行方式 agent 化了”，但“把可靠性工程 agent 化”还没有完成。  
当前更像**LLM 调度器 + 工具集**，而不是具备可靠交付闭环的自治系统。

如果目标是“点创建就得到可运行实例”，下一步重点不该是继续加花哨观测，而是：**先把确定性状态机 + 可运行验收 + 幂等补偿打透**。
