# Deploy Runbook - Silhouette OS (os.albertofarah.com)

Audience: operators and self-dev cycles. Every step is verified, none is optional.

## 1. Fetch and checkout (byte-verified)

```bash
cd /opt/silhouette
git fetch https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource main
git checkout -q <sha>          # sha from GitHub API: gh api repos/<owner>/<repo>/branches/main --jq .commit.sha
git rev-parse HEAD             # MUST equal <sha> byte for byte
```

Never use bare `origin` on this host: local clones' origins may point at a template repo. Always the explicit URL.

## 2. Build the frontend (MANDATORY when the merge touches UI)

The server serves the prebuilt bundle in `dist/`. A checkout alone does NOT update the UI.

```bash
sudo -u silhouette npm run build
```

Rule: if the merge touches `components/`, `App.tsx`, `index.html`, or any `.tsx/.css`, deploy = checkout + build + service reload. Backend-only merges skip the build.

## 3. Reload the service

```bash
systemctl restart silhouette
```

Cold start takes ~50s (tsx compile). Do not probe auth before that.

## 4. Verify live, from outside

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://os.albertofarah.com/v1/memory/state   # expect 401 (fail-closed, no session)
curl -s -o /dev/null -w "%{http_code}\n" -H "x-session-id: <valid>" https://os.albertofarah.com/v1/memory/state  # expect 200
curl -s https://os.albertofarah.com/ | grep -o "<title>[^<]*</title>"                  # expect current title
```

The 401 must hold IMMEDIATELY after every boot. If it ever returns 200 without a session, the boot gate regressed: stop and fix before anything else.

## 5. What to check when something looks wrong

- Bundle served vs repo: the `<script src="/assets/index-*.js">` hash in the served HTML must match a file in `dist/assets/`. Stale hash = build was skipped.
- Server truth: `journalctl -u silhouette -n 100` and `/opt/deploy-logs/server.log`.
- Ownership after any root-side git op: `chown -R silhouette:silhouette /opt/silhouette`.
