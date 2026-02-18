# Installation Guide: Silhouette Agency OS

This guide provides detailed installation instructions for **Silhouette Agency OS**.

---

## Minimum Requirements (Alpha)

To start the orchestrator you only need **two things**:

1. **An AI API key** (at least one provider — free tiers available)
2. **A way to interact** — web UI (browser/terminal) or a messaging channel (Telegram, Discord, WhatsApp)

Everything else (Neo4j, Redis, voice engine, media pipelines) is **optional** and degrades gracefully when absent.

### Required Software

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Optional (for enhanced capabilities)

- **Docker** — for Neo4j (knowledge graph) and Redis (persistent cache)
- **Python 3.10+** — for the reasoning engine and video generation modules

---

## Quick Start (Minimal — Terminal + One API Key)

### 1. Clone

```bash
git clone https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource.git
cd Silhouette-Agency-OS-OpenSource
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your API key

Copy the example environment file and add your key:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add **at least one** of these:

```env
# Free tier available — recommended for getting started
GEMINI_API_KEY=your_key_here

# Fast inference, free tier
GROQ_API_KEY=your_key_here

# Multi-model access
OPENROUTER_API_KEY=your_key_here

# Coding specialist
DEEPSEEK_API_KEY=your_key_here
```

> **Tip:** Gemini and Groq both offer free tiers — no billing required to start.

### 4. Start the backend (orchestrator)

```bash
npm run server
```

The system starts on `http://localhost:3005`. The orchestrator is now alive and thinking.

- **API**: `http://localhost:3005/v1/system/status`
- **WebSocket**: `ws://localhost:3005/ws`
- **Health**: `http://localhost:3005/v1/system/health`

### 5. (Optional) Start the frontend UI

In a second terminal:

```bash
npm run dev
```

Frontend: `http://localhost:5173`

---

## What Works Without Docker

| Capability | Without Docker | With Docker |
|---|---|---|
| Orchestrator + Core Agents | Full | Full |
| Chat (terminal / WebSocket) | Full | Full |
| Memory (working / episodic) | SQLite + in-memory | + Redis persistent |
| Knowledge graph | Degraded (no Neo4j) | Full |
| Vector semantic search | LanceDB (local file) | Full |
| Evolution scheduler | Full | Full |
| Telegram / Discord channel | Full (with token) | Full (with token) |
| Image / video generation | Full (with provider key) | Full (with provider key) |
| Voice synthesis | Full (with ElevenLabs key) | Full (with ElevenLabs key) |

---

## Interactive Setup Wizard (Alternative to manual setup)

The wizard handles provider selection, port detection, and Docker startup automatically:

```bash
npm run setup:intelligent
```

---

## Adding a Communication Channel (Optional)

Channels let you interact with the orchestrator through messaging apps instead of the web UI.

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Add to `.env.local`:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   ```
3. In `silhouette.config.json`, set:
   ```json
   "channels": { "telegram": { "enabled": true, "botToken": "your_bot_token" } }
   ```
4. Restart the server — the orchestrator will listen for messages in your Telegram chat.

### Discord

Same process — get a bot token from the Discord Developer Portal and set `DISCORD_BOT_TOKEN` in `.env.local`.

### WhatsApp

Set `WHATSAPP_SESSION_PATH=./data/whatsapp_session` in `.env.local`. On first start, scan the QR code printed in the terminal.

---

## Personalize Your Orchestrator

Give your AGI a name and personality:

```bash
npm run personalize
```

---

## Full Stack with Docker (Recommended for Production)

```bash
# Start all services (Neo4j, Redis, main app)
docker-compose up --build

# Production deployment
npm run docker:prod
```

Key ports:
- `3005` — API + WebSocket (main entry point)
- `5173` — React UI (dev only)
- `7474 / 7687` — Neo4j (knowledge graph)
- `6379` — Redis (persistent cache)
- `8000` — Python reasoning engine

---

## Troubleshooting

**"No LLM provider configured" warning at startup**
Add at least one API key to `.env.local` (see step 3 above). The orchestrator needs a provider to think.

**Neo4j connection failed**
Not required to start. The system degrades gracefully — memory and reasoning still work via SQLite and in-memory stores. Install Docker and run `docker-compose up -d` for the full knowledge graph.

**Redis connection failed**
Not required. An in-memory fallback activates automatically. Persistent session caching requires Redis.

**Port conflict on 3005**
Add `PORT=3006` to `.env.local`.

**Module not found / install errors**
```bash
npm cache clean --force && rm -rf node_modules && npm install
```

**`npm run dev` shows only the frontend but no backend**
Run `npm run server` in a separate terminal first. The frontend connects to the backend on port 3005.

---

## Further Documentation

- **[README.md](README.md)** — System overview and architecture
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Technical design
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — Full configuration reference
- **[docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)** — How to interact with the system
- **[SECURITY.md](SECURITY.md)** — Security guidelines

---

**Silhouette Agency OS** — *Cognition meets Creation.*
