# Security Policy

## ⚠️ Experimental Hobby Project

**Silhouette Agency OS** is an experimental, self-evolving cognitive architecture that began as a personal hobby project. While it has grown into a sophisticated biomimetic system, it is important to understand that:

1.  **Code Execution**: The system includes a `ToolExecutor` that can run Python and Node.js code. By default, this is sandboxed, but you should **never** run this system with root/admin privileges unless you fully understand the risks.
2.  **Self-Modification**: The `git_operations` capability allows the agent to modify its own source code. While there are safeguards (approval flows), an autonomous agent modifying its own kernel carries inherent risks of instability or unexpected behavior.
3.  **API Keys**: Your API keys (`GEMINI_API_KEY`, etc.) are stored in `.env.local`. **NEVER** commit this file to a public repository. The `.gitignore` is configured to prevent this, but manual vigilance is required.

## Reporting a Vulnerability

If you discover a security vulnerability, please do **NOT** open a public issue. Instead, please contact the maintainer directly or open a draft security advisory if GitHub allows.

## Safe Usage Guidelines

-   **Sandboxing**: We strongly recommend running Silhouette inside a Docker container (provided via `docker-compose.yml`) to isolate it from your host system.
-   **Human-in-the-Loop**: For critical actions (file deletion, git pushes, executing shell commands), the system is designed to request user approval. **Do not disable these checks** in a production environment.
-   **Cost Monitoring**: This system uses LLMs which can incur costs. Monitor your API usage (OpenAI, Anthropic, Google, etc.) regularly. We have implemented token budgeting, but you are responsible for your own keys.
-   **Data Privacy**: The memory system (LanceDB/Neo4j) stores conversation history and "thoughts". Treat your database files as sensitive information.

## Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. THE AUTHORS ARE NOT RESPONSIBLE FOR ANY DAMAGE, DATA LOSS, OR UNINTENDED ACTIONS CAUSED BY THE AUTONOMOUS AGENT. USE AT YOUR OWN RISK.
