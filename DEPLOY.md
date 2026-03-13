# Silhouette Agency OS — Deployment Guide

## Quick Start

```bash
# 1. Run the interactive setup wizard
npx tsx scripts/setup.ts

# 2. Follow the prompts to configure:
#    - LLM providers (Gemini, OpenAI, Groq, etc.)
#    - Messaging channels (Telegram, WhatsApp, Discord)
#    - Deployment mode (Local, Docker, VPS, Coolify)
#    - Domain & SSL (auto-provisioned via Caddy)
#    - Google Workspace OAuth2 (optional)
```

---

## Deployment Modes

### 🖥️ Local Development

```bash
npm run boot          # Starts via Janus supervisor (auto-restart + crash repair)
```

- No Docker required
- Accesses Neo4j/Redis from Docker or cloud
- Dashboard: `http://localhost:3005`

### 🐳 Docker Compose

```bash
# Development (with hot reload)
docker-compose up -d

# Production (optimized)
docker-compose -f docker-compose.prod.yml up -d
```

Services started: Neo4j, Redis, Qdrant, Reasoning Engine, Core Bot, Caddy (reverse proxy).

### 🌐 VPS / Dedicated Server

```bash
# 1. Clone repo on server
git clone <your-repo> && cd Silhouette-Agency-OS-OpenSource

# 2. Run setup (select "VPS" mode + enter your domain)
npx tsx scripts/setup.ts

# 3. Make sure DNS A record points to server IP

# 4. Deploy
docker-compose -f docker-compose.prod.yml up -d
```

Caddy automatically provisions SSL from Let's Encrypt. No manual certificate management.

**Requirements:** Docker, Docker Compose, ports 80+443 open, DNS A record pointing to server.

### 🚀 Coolify

1. Connect your Git repository in Coolify
2. Set the build pack to **Dockerfile**
3. Add environment variables from `.env.local` to Coolify's settings
4. Configure your domain in Coolify's project settings
5. Push to Git — Coolify builds and deploys automatically

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Primary LLM provider |
| `PORT` | Default: 3005 | Server port |
| `NODE_ENV` | Auto-set | `development` or `production` |
| `TELEGRAM_BOT_TOKEN` | Optional | From @BotFather |
| `DISCORD_BOT_TOKEN` | Optional | From Discord Developer Portal |
| `WHATSAPP_ENABLED` | Optional | `true` to enable WhatsApp (QR scan) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth2 Client Secret |
| `NEO4J_URI` | Auto-set | Graph database URI |
| `NEO4J_USER` | Auto-set | Graph database user |
| `NEO4J_PASSWORD` | Auto-set | Graph database password |
| `REDIS_URL` | Auto-set | Cache/PubSub URL |
| `DOMAIN` | Optional | Custom domain for SSL |

---

## SSL / HTTPS

SSL is handled automatically by **Caddy** via Let's Encrypt:

1. Setup wizard generates `Caddyfile` with your domain
2. Caddy provisions certificate on first request
3. Auto-renews before expiration
4. Forces HTTPS redirect

**Only requirement:** DNS A record must point to the server before starting.

---

## Health Check

```bash
curl http://localhost:3005/health
# or
curl https://yourdomain.com/health
```

---

## Logs

```bash
# Janus crash reports
cat logs/janus_crash_report.txt

# System errors (fed to LearningLoop)
cat logs/system_errors.log

# Docker logs
docker-compose logs -f bot
```
