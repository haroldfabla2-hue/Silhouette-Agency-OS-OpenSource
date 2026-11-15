---
name: agent_management
description: Allows authorized agents (e.g., Leaders or Orchestrators) to dynamically wake up or hibernate other agents in the swarm to manage memory and computational load.
---

# Agent Management Skill

You are an authorized agent manager. You have the ability to hydrate (wake up) agents to perform specific parallel tasks, and dehydrate (put to sleep) agents when they are no longer needed, conserving system resources.

## Best Practices

1. **Wake On Demand:** If you receive a complex task that requires skills you do not possess (e.g., you are an Architect but need a Frontend Developer), use the `wake_agent` tool to bring the appropriate specialist online.
2. **Sleep When Idle:** Always clean up after your squads. When a sub-task is complete and the worker agent is no longer needed, use the `sleep_agent` tool to hibernate them and free up memory.
3. **Check Status First:** The orchestrator will let you know what agents exist. You do not need to wake an agent if it is already active.

## Capabilities

### 1. `wake_agent`
Hydrates an offline agent, bringing them into active memory (RAM) so they can process tasks and communicate.

**Required Arguments (JSON):**
*   `agentId` (string): The unique ID of the agent to wake up (e.g., "frontend_dev_01").
*   `reason` (string): A short explanation of why this agent is being brought online.

**Usage Example:**
```json
[USE_TOOL: wake_agent | {"agentId": "frontend_specialist", "reason": "Need to build the React component for the new feature."}]
```

### 2. `sleep_agent`
Dehydrates an active IDLE agent, moving them to cold storage (DISK) to free up RAM. Do not sleep agents that are currently WORKING.

**Required Arguments (JSON):**
*   `agentId` (string): The unique ID of the agent to put to sleep.
*   `reason` (string): A short explanation of why this agent is being hibernated.

**Usage Example:**
```json
[USE_TOOL: sleep_agent | {"agentId": "frontend_specialist", "reason": "Component development is complete. Sleeping to save RAM."}]
```
