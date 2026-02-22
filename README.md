# piDeploy

piDeploy (formerly ClawDeploy) is a one-click OpenClaw deployment platform. This monorepo contains two versions:

## Structure

```
piDeploy/
├── original/              # Original ClawDeploy code (read-only reference)
│   ├── frontend/          # Next.js app with hardcoded Docker lifecycle
│   ├── backend/           # Legacy backend (migrate.js)
│   ├── docs/              # Project documentation
│   └── scripts/           # Build & setup scripts
│
├── agent/                 # Agent-powered version (active development)
│   ├── frontend/          # Next.js app — modified API routes submit tasks
│   ├── orchestrator/      # Pi Agent Orchestrator service
│   │   └── src/
│   │       ├── tools/     # Custom tools (create, start, stop, delete, update, nginx_sync)
│   │       ├── observability/  # Tracing, cost monitoring, error classification
│   │       ├── heartbeat.ts    # 60s autonomous health check loop
│   │       ├── task-queue.ts   # DB-based task queue consumer
│   │       └── agent-loop.ts   # Core agentLoop() integration
│   └── scripts/           # E2E tests, setup scripts
│
├── prd.json               # Ralph loop PRD (development tracking)
└── progress.txt           # Development progress log
```

## Key Differences: Original vs Agent

| Aspect | Original | Agent Version |
|--------|----------|--------------|
| Instance lifecycle | Hardcoded in API routes | Agent decides + executes via custom tools |
| State sync | Manual API call (admin/sync) | Automatic 60s heartbeat loop |
| Self-healing | None | Auto-restart crashed containers |
| Error handling | Set status=error and stop | Agent diagnoses, retries, then reports |
| Nginx sync | Fire-and-forget | Verified + auto-repaired |
| Observability | Basic pino logs | Structured traces, cost tracking, eval |

## Tech Stack

- **Frontend**: Next.js 16, TypeScript, Tailwind CSS 4, Clerk auth
- **Agent**: @mariozechner/pi-agent-core (agentLoop), @mariozechner/pi-ai
- **Infrastructure**: Docker, Nginx, Neon PostgreSQL, Prisma
- **Runtime Model**: minimax-m2.5-free [opencode] (development)

## Architecture Review

> ⚠️ **[Agent 架构审查报告](agent/AGENT-ARCHITECTURE-REVIEW.md)** — 对 agent 版本的深度分析，指出当前 AI agent 层本质上只是一个"传令官"，未发挥自主决策和验证闭环能力，反而引入了不确定性和新 bug。

## Data Directory

Instance data lives at `/data/clawdeploy/` (not moved during rename).
