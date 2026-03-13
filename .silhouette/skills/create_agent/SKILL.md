---
name: create_agent
description: Step-by-step procedure for creating new agents in Silhouette OS using AgentFactory and GenesisV2. Use when a task requires a specialist that doesn't exist yet.
---

# Create Agent Skill

## When to Use
- When a task requires expertise that no existing agent has.
- When workload demands parallel processing with dedicated workers.
- When the Orchestrator or a Leader needs to spawn a sub-agent.

## Methods of Agent Creation

### Method 1: spawnForTask() — Quick On-Demand Agent
Best for temporary agents needed for a specific task.

```
Use tool: AgentFactory.spawnForTask(taskDescription)
```

This will:
1. Analyze the task via backgroundLLM
2. Generate an optimal agent profile (name, role, capabilities, directives)
3. Create the agent in SQLite + 8-file identity system
4. Return the agent ID ready for delegation

### Method 2: architectAgent() — Premium Crafted Agent
Best for permanent team members with carefully crafted prompts.

```
Use tool: AgentFactory.architectAgent(specification)
```

This will:
1. Search universalprompts library via vector similarity for best matching prompts
2. Compose a superior agent from multiple source prompts
3. Create a full Agent definition with optimized systemInstruction
4. Write all 8 identity files (IDENTITY, SOUL, AGENTS, TOOLS, USER, HEARTBEAT, BOOTSTRAP, MEMORY)

### Method 3: GenesisV2 — Full Birth Protocol
Used for system-level agents during bootstrap. Not typically used during runtime.

## The 8-File Identity System
Every agent gets a directory at `data/agents/{agent-id}/` with:

| File | Purpose |
|---|---|
| IDENTITY.md | Name, role, team, greeting, avatar |
| SOUL.md | Personality, values, communication style, root-cause directives |
| AGENTS.md | Permissions, restrictions, communication rules |
| TOOLS.md | Available capabilities and tool usage conventions |
| USER.md | Info about the human operator |
| HEARTBEAT.md | Proactive checklist tasks |
| BOOTSTRAP.md | Startup sequence and dependencies |
| MEMORY.md | Append-only memory log |

## Agent Tiers
- **CORE**: Always active, full system access. Used for kernel agents.
- **SPECIALIST**: On-demand, hydrated when expertise needed. Sleeps when idle.
- **WORKER**: Task-specific, spawned for a job and dehydrated after completion.

## Rules
- ALWAYS check if a similar agent already exists before creating one.
- Use `spawnForTask()` for temporary needs, `architectAgent()` for permanent team additions.
- New agents inherit the root-cause, anti-garbage, and self-creation directives from templates.
- After spawning, assign the task via SystemBus delegation protocol.
- Dehydrate WORKER agents when their task is complete (use `sleep_agent` tool).
