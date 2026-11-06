# Silhouette Agency OS — Deployment Guide

## Canonical Server Deployment

The live server deployment for this repository is `docker-compose.server.yml`.

It runs:
- `silhouette-agency-os`
- `silhouette-reasoning-engine`
- `silhouette-postgres`
- `silhouette-redis`
- `silhouette-neo4j`

Public routing is handled by Traefik on the external Docker network `coolify`.
Current public domain:
- `https://silhouette.albertofarah.com`

## Server Prerequisites

- Docker with Compose plugin
- External Docker network `coolify`
- Ports `80` and `443` already handled by Traefik / Coolify proxy

## Server Environment

Runtime configuration is loaded from `.env.server`.

The server compose file also sets:
- `NODE_ENV=production`
- `DATABASE_URL` against local Postgres
- `REDIS_URL` against local Redis
- `REASONING_ENGINE_URL` against the local reasoning service

## Deploy / Update

```bash
docker compose -f docker-compose.server.yml up -d --build
```

To recreate only the main app container after label or env changes:

```bash
docker compose -f docker-compose.server.yml up -d --no-deps silhouette-agency-os
```

## Health Checks

Local checks:

```bash
docker compose -f docker-compose.server.yml ps
docker exec silhouette-agency-os node -e "fetch('http://127.0.0.1:3006/health').then((r)=>r.text().then(console.log))"
docker exec silhouette-reasoning-engine python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"
```

Public checks:

```bash
curl https://silhouette.albertofarah.com/health
curl https://silhouette.albertofarah.com/v1/system/status
```

## Notes

- `docker-compose.prod.yml` and `docker-compose.yml` are not the canonical server stack.
- Traefik labels live in `docker-compose.server.yml`; there are no manual dynamic proxy files for Silhouette.
- Host ports `3006` and `5173` are still published for direct server access and troubleshooting, but public traffic should go through Traefik.
