# Configuration Guide - Silhouette Agency OS

Silhouette is highly customizable through a combination of a JSON config file and environmental variables.

---

## 1. `silhouette.config.json` ⚙️

This is the main "brain" configuration.

| Field | Description | Default |
|-------|-------------|---------|
| `system.adminName` | Your name (how she addresses you). | "User" |
| `autonomy.agentName` | How the agent identifies herself. | "Silhouette" |
| `autonomy.defaultProvider` | Primary LLM: `gemini` or `minimax`. | "gemini" |
| `modules.graph` | Enable/Disable Neo4j memory graphs. | `true` |
| `modules.browser` | Enable/Disable web scraping capabilities. | `true` |

---

## 2. `.env.local` 🔑

Sensitive credentials and API keys.

```env
# LLM Providers
GEMINI_API_KEY=your_key_here
MINIMAX_API_KEY=your_key_here

# Channels
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_CHAT_IDS=123456,789012

# Integrations
GITHUB_TOKEN=ghp_etc
GITHUB_REPO_OWNER=username
GITHUB_REPO_NAME=repo_name
```

---

## 3. Security Hardening 🛡️

### Whitelisting
Always populate `ALLOWED_CHAT_IDS` if you enable the Telegram channel. Without it, anyone who finds your bot could potentially access your system.

### Blacklisting
System command execution is protected by a blacklist in `systemControlService.ts`. You can modify this file to restrict specific hazardous commands.

---

## 4. Advanced: Custom Tools 🛠️

You can extend Silhouette by creating new plugins in `services/plugins`. Refer to `docs/PLUGIN_STANDARD.md` for implementation details.
