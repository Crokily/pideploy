# PRD: LangFuse Observability Integration

## Introduction

piDeploy 的 Agent Orchestrator 已有完整的可观测性数据采集（tracer、transcript、cost-monitor、alerting），但所有数据输出为服务器本地 JSON 文件，没有任何可视化界面。用户无法便捷地查看 agent 执行历史、费用统计、tool 调用链和告警。

本 PRD 将 LangFuse（开源 LLM 可观测性平台）自托管部署并集成到 orchestrator，替换本地 JSON 文件输出，提供专业的 Web Dashboard。

## Goals

1. 自托管 LangFuse 实例（Docker Compose），开机自启
2. 改造 orchestrator tracer 模块，将 trace/generation/span 数据推送到 LangFuse
3. 保留本地 JSON 文件写入作为 fallback（LangFuse 不可用时不影响任务执行）
4. 通过 LangFuse Dashboard 可视化：trace 列表、span 时间线、token/费用统计、tool 调用成功率
5. E2E 验证：从创建任务到在 LangFuse Dashboard 中看到完整 trace

## Non-Goals

- 不迁移历史 trace 数据（398 个旧 JSON 文件保留不动）
- 不修改 frontend UI（LangFuse 是独立的管理后台）
- 不修改任何 tool 代码或 agent-loop 主逻辑
- 不接入 Sentry（本 PRD 只做 LangFuse）
- 不做 LangFuse 的 Prompt Management 功能

## Technical Considerations

- LangFuse v3 自托管需要：PostgreSQL + langfuse-server + langfuse-worker（可选）
- 服务器资源：17GB RAM（可用 13GB）、18GB 磁盘、Docker Compose v5.0.2 已安装
- LangFuse SDK：`langfuse@3.38.6`（npm），提供 `Langfuse` 类 with `trace()` / `generation()` / `span()` / `score()`
- 数据模型映射：我们的 `AgentTrace` → LF `trace()`，`AgentSpan(generation)` → LF `generation()`，`AgentSpan(tool_execution)` → LF `span()`
- 改动范围：仅 `orchestrator/src/observability/tracer.ts` 重写 + `agent-loop.ts` 少量调整 + `config.ts` 加 LangFuse 初始化
- 安全：LangFuse 只监听 localhost，通过 nginx 反代加 HTTPS（可选）

## User Stories

### US-001: LangFuse 自托管部署
As a developer, I need LangFuse running as a self-hosted service so I have a professional observability dashboard.

**Acceptance Criteria:**
- `docker compose up -d` 在 `/home/ubuntu/piDeploy/langfuse/` 启动 LangFuse + PostgreSQL
- LangFuse Web UI 可通过 `http://localhost:3500` 访问
- 创建了项目和 API keys（LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY）
- 写入 `/home/ubuntu/piDeploy/agent/orchestrator/.env.langfuse` 保存 keys
- systemd service `pideploy-langfuse.service` 创建，开机自启
- `cd agent/orchestrator && npx tsc --noEmit` passes

### US-002: Tracer 模块改造 — 集成 LangFuse SDK
As a developer, I need the tracer to send data to LangFuse while keeping local JSON fallback.

**Acceptance Criteria:**
- `npm install langfuse` 在 orchestrator 中完成
- `tracer.ts` 重写：`createTracer()` 内部同时创建 LangFuse trace 和本地 AgentTrace
- `processEvent()` 中：`turn_start/end` → LangFuse `generation()`，`tool_execution_start/end` → LangFuse `span()`
- `message_end` 事件中的 token usage 传入 LangFuse `generation.end({ usage })`
- `finalize()` 调用 `langfuse.flush()` 确保数据发送
- `save()` 仍然写本地 JSON（fallback）
- LangFuse 调用失败时只 log warning，不影响任务执行
- `AgentTrace` / `AgentSpan` / `Tracer` 接口保持不变（alerting.ts / eval.ts 不需要改）
- `cd agent/orchestrator && npx tsc --noEmit` passes

### US-003: Orchestrator 配置 & 服务重启
As a developer, I need the orchestrator to load LangFuse configuration and connect on startup.

**Acceptance Criteria:**
- `config.ts` 新增 `getLangfuseConfig()` 读取环境变量 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
- `pideploy-orchestrator.service` 的 EnvironmentFile 加载 `.env.langfuse`
- 重启 orchestrator 后日志显示 "LangFuse connected" 或类似信息
- 手动创建一个 test task，orchestrator 处理后在 LangFuse Dashboard 中能看到对应 trace
- trace 包含：task type 标签、generation spans with token usage、tool execution spans with input/output
- `cd agent/orchestrator && npx tsc --noEmit` passes

### US-004: Nginx 反代 & 访问验证
As a user, I need to access LangFuse Dashboard securely via HTTPS.

**Acceptance Criteria:**
- nginx 配置 `langfuse.claw.a2a.ing` → `localhost:3500` 反代（若 SSL 证书支持）
- 或者直接通过 `http://服务器IP:3500` 访问（LangFuse 有内置登录）
- LangFuse Dashboard 中可以看到至少 1 个完整的 task trace 和 1 个 heartbeat trace
- trace 详情页显示：span 时间线、tool 调用名称、token 用量、成功/失败状态
- 截图验证 LangFuse Dashboard 界面

### US-005: E2E 测试 — 完整链路验证
As a developer, I need an end-to-end test that verifies the full observability pipeline.

**Acceptance Criteria:**
- 测试脚本 `agent/scripts/e2e-langfuse-test.sh` 创建
- 脚本流程：(1) 确认 LangFuse 运行 (2) 通过 API 创建 instance_start task (3) 等待 task 完成 (4) 通过 LangFuse API 查询 trace (5) 验证 trace 包含 generation + span 数据
- 使用 agent-browser 打开 LangFuse Dashboard，截图验证 trace 可见
- 脚本 exit 0 表示成功
- `cd agent/orchestrator && npx tsc --noEmit` passes
- `cd agent/frontend && npx tsc --noEmit` passes

## Success Metrics

- LangFuse Dashboard 可访问并显示实时 trace 数据
- 每个 agent 任务自动生成 LangFuse trace（generation + tool spans + token usage）
- Orchestrator 启动和任务执行不因 LangFuse 故障而中断
- E2E 测试脚本通过
