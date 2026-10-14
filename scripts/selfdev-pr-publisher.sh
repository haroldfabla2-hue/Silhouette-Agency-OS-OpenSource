#!/usr/bin/env bash
# SELF-DEV PR PUBLISHER (root helper, decision (b): push-via-root)
# ═══════════════════════════════════════════════════════════════
# Triggered by systemd path unit on new files in $PR_DIR (requests written
# by the silhouette service AFTER operator approval). Validates each request,
# commits ONLY the declared paths from the shared selfwork clone onto a
# cycle branch, pushes, opens the PR, writes an atomic result file, and
# returns the clone to a pristine origin/main state.
#
# Hard rules: branch name allowlist, dirty-tree must equal declared paths,
# everything journaled to stdout (journald) + result file. Never deletes
# request/result files content-wise: processed requests are renamed .done.
set -u
SELFWORK="${SELFWORK:-/var/lib/silhouette/selfwork}"
PR_DIR="${PR_DIR:-/var/lib/silhouette/selfdev/pr-requests}"
RESULTS="${RESULTS:-/var/lib/silhouette/selfdev/pr-results}"
LOCK=/tmp/selfdev-pr-publisher.lock
exec 9>"$LOCK"; flock -n 9 || exit 0

fail() { # id, message
  local tmp="$RESULTS/.$1.tmp"
  printf '{"ok":false,"error":%s}\n' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$2")" > "$tmp"
  mv "$tmp" "$RESULTS/$1.json"; echo "[publisher] ERROR $1: $2"
}

shopt -s nullglob
for req in "$PR_DIR"/*.json; do
  id=$(basename "$req" .json)
  parsed=$(python3 - "$req" <<'PY'
import json,sys,re
d=json.load(open(sys.argv[1]))
assert re.fullmatch(r'selfdev/cycle-[0-9a-fA-F-]{36}', d['branch']), 'bad branch'
assert d['paths'] and all(p and not p.startswith('/') and '..' not in p.split('/') for p in d['paths']), 'bad paths'
print(d['branch']); print(d['title']); print('\n'.join(sorted(set(d['paths']))))
open('/tmp/selfdev-body.md','w').write(d['body'])
PY
) || { fail "$id" "invalid request"; mv "$req" "$req.done"; continue; }
  branch=$(sed -n '1p' <<<"$parsed"); title=$(sed -n '2p' <<<"$parsed"); paths=$(tail -n +3 <<<"$parsed")
  cd "$SELFWORK" || { fail "$id" "selfwork clone missing"; mv "$req" "$req.done"; continue; }
  git fetch -q origin main || { fail "$id" "git fetch failed"; mv "$req" "$req.done"; continue; }
  dirty=$(git status --porcelain -uall | awk '{print $2}' | sort -u)
  if [ "$dirty" != "$paths" ]; then fail "$id" "dirty tree does not match declared paths: [$dirty] vs [$paths]"; mv "$req" "$req.done"; continue; fi
  git checkout -q -B "$branch" origin/main || { fail "$id" "branch checkout failed"; mv "$req" "$req.done"; continue; }
  while IFS= read -r p; do git add -- "$p"; done <<<"$paths"
  git -c user.name='silhouette-selfdev' -c user.email='selfdev@silhouette.local' commit -q -m "$title" -m "$(cat /tmp/selfdev-body.md)" || { fail "$id" "commit failed"; git reset -q --hard origin/main; mv "$req" "$req.done"; continue; }
  if ! git push -q -u origin "$branch"; then fail "$id" "push failed"; git checkout -q main 2>/dev/null; git reset -q --hard origin/main; mv "$req" "$req.done"; continue; fi
  pr_url=$(gh pr create --head "$branch" --title "$title" --body-file /tmp/selfdev-body.md 2>&1) || { fail "$id" "gh pr create failed: $pr_url"; git checkout -q main 2>/dev/null; git reset -q --hard origin/main; mv "$req" "$req.done"; continue; }
  pr_num=$(basename "$pr_url")
  tmp="$RESULTS/.$id.tmp"
  printf '{"ok":true,"prUrl":"%s","number":%s}\n' "$pr_url" "$pr_num" > "$tmp"; mv "$tmp" "$RESULTS/$id.json"
  chown silhouette:silhouette "$RESULTS/$id.json" 2>/dev/null || true
  echo "[publisher] OK $id -> $pr_url"
  git checkout -q main 2>/dev/null || git checkout -q -b main origin/main
  git reset -q --hard origin/main; git branch -q -D "$branch" 2>/dev/null || true
  mv "$req" "$req.done"
done
