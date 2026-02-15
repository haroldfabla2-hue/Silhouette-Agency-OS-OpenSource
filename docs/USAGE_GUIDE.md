# Usage Guide - Silhouette Agency OS

Welcome to your Autonomous Agency. Silhouette is designed to be more than a chatbot; she is a goal-oriented entity capable of planning and executing complex tasks.

---

## 1. The Interface (Dynamic Workspace) 🖥️

The Silhouette UI is a unified workspace where you can interact with the agent across various modes:

- **Chat Pane**: Your primary line of communication. Supports standard chat, file attachments, and media display.
- **Orchestration Panel**: Monitor Silhouette's internal "Continuum" (thoughts, introspections, and plan state).
- **Tool Viewer**: See which tools are currently active and their status.
- **Terminal**: A built-in interactive terminal for direct system control when approved.

---

## 2. Agent Orchestration 🧠

Silhouette uses a **Cognitive Loop** architecture:
1. **Introspection**: She analyzes your request and her internal state.
2. **Planning**: She breaks the task into actionable steps.
3. **Execution**: She uses tools to perform actions.
4. **Reflection**: She reviews the outcome and adjusts her plan.

### Specialist Agents
For complex tasks, use specialized commands or let the Orchestrator decide:
- **Researcher**: For deep web searches and paper extraction.
- **Developer**: For coding and system modifications.
- **Memory**: For retrieving long-term concepts or past interactions.

---

## 3. Communication Channels 📡

You can interact with Silhouette through:
- **Web UI**: Full feature set, optimized for desktop use.
- **Telegram**: Enable the Telegram Channel in `silhouette.config.json` to control your agency remotely. 
    - *Tip: Use the `allowedChatIds` whitelist for maximum security.*

---

## 4. Best Practices
- **Be Specific**: Silhouette performs best when given clear objectives.
- **Check Introspection**: If she seems stuck, read her introspection thoughts to understand her reasoning.
- **Approve Actions**: Pay attention to "Human in the Loop" requests for sensitive system commands.
