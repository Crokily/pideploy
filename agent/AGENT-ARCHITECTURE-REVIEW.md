# Agent 架构审查报告

> **日期**: 2026-02-22  
> **范围**: `agent/orchestrator/` 全部源码、`agent/frontend/` API routes、最近 commit 历史  
> **结论**: 当前 agent 层本质上是一个 **LLM 传令官（message passer）**，没有体现 agent 应有的自主决策和验证闭环能力。引入 LLM 中间层后反而降低了系统稳定性。

---

## 1. 架构对比：原版 vs Agent 版

### 原版（`original/`）— 同步确定性流程

```
用户点击 Create → API Route POST →
  1. prisma.instance.create(status: creating)
  2. createInstanceStorage()
  3. generateConfig() + writeInstanceConfig()
  4. createContainer()  (Docker)
  5. prisma.instance.update(status: running, containerId, port)
  6. updateNginxPortMap()
  → 返回 HTTP 201 + 完整 instance 数据
```

所有步骤在一次同步请求内完成，参数通过代码硬传递，不可能丢失或误解。

### Agent 版（`agent/`）— 异步 LLM 中转流程

```
用户点击 Create → API Route POST →
  1. prisma.instance.create(status: creating)     ← 创建占位记录
  2. prisma.task.create(type: instance_create)     ← 投入任务队列
  → 立即返回 HTTP 202（实例还没真正创建）

  ↓ 异步（orchestrator 每 5 秒轮询 task queue）

  3. 取到 task → 构造自然语言消息发给 LLM：
     "Execute task: instance_create\nUser: user_xxx\nParameters: {...}"
  4. LLM"理解"后决定调用 instance_create tool
  5. tool 执行（逻辑与原版相同的函数链）
  6. LLM 再调用 report_result tool 汇报结果
```

中间多出的 LLM 环节不做任何原版没有的事情——它只是把任务参数从自然语言中"解读"出来，然后转调同一套函数。

---

## 2. 重复实例 Bug 的根因

来自最新 commit `640ad41`（*fix: prevent duplicate instance rows during async create tasks*）：

| 步骤 | 发生了什么 |
|------|-----------|
| API Route | `prisma.instance.create()` 创建了一条 DB 记录（ID = A） |
| API Route | `prisma.task.create({ params: { name, channel, ... } })` — **没传 `instanceId`** |
| Orchestrator | 把 params 序列化成自然语言发给 LLM |
| LLM | 调用 `instance_create` tool，tool 发现没有 `instanceId` 参数 |
| Tool | **又执行了 `prisma.instance.create()`**，创建了第二条记录（ID = B） |
| 结果 | 用户看到两条实例：一条 status=creating（僵尸占位），一条可能成功也可能失败 |

**根本原因**: 确定性的参数（`instanceId`）被交给自然语言管道传递，中间传丢了。这类 bug 在原版的直接函数调用架构中不可能发生。

修复方式也很说明问题——最终还是靠在 params 里 **硬编码传递 `instanceId`** 解决的，等于承认 LLM 中转不可靠。

---

## 3. 心跳（Heartbeat）分析

### 设计

心跳逻辑完全由 `HEARTBEAT_PROMPT`（自然语言）驱动：

```
你是 piDeploy Health Monitor。你的任务：
1. 查询 DB 里所有 running/creating 的实例
2. 用 bash 执行 docker inspect 检查实际状态
3. 如果不匹配就修复
4. nginx_sync
5. report_result
```

### 问题

| 问题 | 详情 |
|------|------|
| **Turn 限制过紧** | `maxTurnsPerHeartbeat: 4`，模型要在 4 轮内完成：查 DB → inspect 每个容器 → 对比 → 修复 → nginx sync → report。实例稍多就不够 |
| **使用免费模型** | `minimax-m2.5-free` / `glm-5-free`，tool calling 能力不稳定，容易出错或格式异常 |
| **只做表面检查** | 只看 `docker inspect` 的容器状态，不验证服务本身是否可用（无 HTTP 健康检查、无端口可达性验证） |
| **无法发现重复实例** | 心跳 prompt 里完全没有"检查是否存在重复实例"的逻辑 |
| **修复能力有限** | 发现异常后的"修复"就是 restart 或标记 error，没有日志分析、配置诊断等深层自愈 |

从实际日志来看，心跳报告基本都是：
```json
{ "fixes_applied": 0, "instances_checked": 3, "match": true }
```
即：它每次都觉得一切正常，即使系统中存在不可用的实例和重复记录。

---

## 4. 代码量分析

`agent/orchestrator/src/` 共 **2466 行** TypeScript：

| 模块 | 行数 | 占比 | 作用 |
|------|------|------|------|
| `observability/`（tracer, cost-monitor, alerting, eval, performance, transcript） | ~700 | 28% | 追踪、成本、告警 |
| `tools/`（7 个 tool 实现） | ~850 | 34% | 业务逻辑（与原版几乎相同） |
| `lib/`（docker, nginx, config, prisma, logger） | ~730 | 30% | 基础设施库（从原版复制） |
| `agent-loop.ts` + `task-queue.ts` + `heartbeat.ts` + `prompt.ts` + `config.ts` + `index.ts` | ~610 | 25% | agent 编排层 |
| **agent 的"大脑"**（`prompt.ts` 中的 system prompt） | **42** | **1.7%** | 全部决策逻辑 |

**近 30% 的代码在做可观测性（observability），但 agent 的决策智能 = 42 行自然语言 prompt，没有状态机、决策树、或结构化验证流程。**

---

## 5. 核心问题总结

### 5.1 Agent 只是传令官

当前 agent 的完整决策过程：

```
收到自然语言任务描述 → 决定调哪个 tool → 调用 tool → 调用 report_result
```

它没有做原版做不到的任何事情。tool 里的业务逻辑和原版 API route 里的一模一样（甚至是从原版复制过来的 `lib/` 代码）。LLM 在中间只起了一个"根据任务类型选择函数"的作用——而这件事用一个 `switch` 语句就能做到。

### 5.2 引入了不确定性

| 原版 | Agent 版 |
|------|---------|
| 参数通过类型安全的代码传递 | 参数先序列化成自然语言，LLM"理解"后再反序列化 |
| 函数调用是确定性的 | LLM 决定调哪个 tool（可能选错、漏参数、幻觉） |
| 同步执行，即时返回结果 | 异步队列 + LLM 推理，延迟增加数秒到数十秒 |
| 失败有明确的 error response | 失败可能被 LLM 误判为成功（看 `reportedSuccess` 逻辑） |

### 5.3 没有验证闭环

一个真正的 agent 应该有 **act → observe → judge → react** 循环。当前的 agent：

- ✅ Act：调用 tool 执行操作
- ❌ Observe：不主动验证操作结果（不 curl 健康端口、不检查服务响应）
- ❌ Judge：不判断结果是否真正符合预期（容器跑起来 ≠ 服务可用）
- ❌ React：出错后没有智能的诊断和恢复策略

prompt 里虽然写了"Verify operations succeeded: after creating/starting an instance, check it with docker inspect"，但这只是检查容器是否在跑，不是检查服务是否可用。而且这个验证是否执行完全取决于 LLM 是否"想得起来"在 4 个 turn 内去做。

### 5.4 过度工程

花费大量精力构建了：
- LangFuse 集成（自托管部署 + SDK 对接，5 个 user story）
- Structured tracing（span/trace/session 模型）
- Cost monitoring（per-task / per-heartbeat / daily 三级限制）
- Performance tracking
- Alerting（阈值评估）
- Eval dataset

这些都是优秀 agent 系统应该有的**基础设施**，但前提是 agent 本身得先有值得观测的智能行为。当前的 agent 行为就是"转发调用"，给它加这么多 observability 就像给一个只会跑直线的机器人装了一套 F1 赛车的遥测系统。

---

## 6. 改进方向

如果要让 agent 层真正发挥价值，而不只是增加复杂度，应该聚焦以下方向：

### 6.1 确定性参数通道 + AI 决策分离

```
API Route → 确定性参数（instanceId, userId, config）直传 tool
         → AI 只在需要判断的环节介入（诊断失败、选择恢复策略）
```

不要让 LLM 做参数搬运工。关键参数走代码管道，AI 只在需要"思考"的地方出现。

### 6.2 创建后主动验证

```
创建实例 → docker inspect 确认容器运行
        → curl http://localhost:{port}/health 确认服务响应
        → curl https://{subdomain}.domain.com 确认 nginx 路由可达
        → 全部通过 → 标记 running
        → 任一失败 → agent 分析日志 → 诊断问题 → 自动修复或标记 error 并附诊断报告
```

### 6.3 深度心跳检查

```
心跳周期 →
  1. 对每个 running 实例发 HTTP 健康检查（不只是 docker inspect）
  2. 检查响应时间是否在阈值内
  3. 检查最近日志有无 error/panic
  4. 检查 DB 中是否存在重复/僵尸记录并清理
  5. 发现异常 → agent 介入诊断（查日志、查资源占用）→ 智能决策修复方案
```

### 6.4 将心跳的确定性部分改为代码

心跳中"查 DB → docker inspect → 对比状态"这些步骤完全是确定性的，应该用代码实现，只在发现异常需要诊断时才调用 agent。这样既快又省 token。

---

## 7. 结论

当前的 agent 重构是一个 **架构上完整但功能上空心的实现**：

- ✅ 有完整的 agent loop 编排（task queue → agent loop → tools → report）
- ✅ 有丰富的 observability 基础设施
- ❌ agent 的"智能"仅为 42 行自然语言 prompt
- ❌ 没有验证闭环（act 了不 verify）
- ❌ 引入了不确定性（LLM 传参 > 代码传参）
- ❌ 没有比原版多解决任何问题，反而制造了新问题（重复实例）

**一句话概括**: 搭了一个漂亮的 agent 框架，但 agent 本身没有被赋予任何需要"智能"才能完成的任务。所有工作都是确定性的函数调用，agent 只是在中间做了一次不必要的自然语言转发。
