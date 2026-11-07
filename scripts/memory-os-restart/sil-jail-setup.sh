#!/usr/bin/env bash
# sil-jail-setup.sh - jaula UNA-corrida OS-restart (v8 host -> repo, v9):
# pin y prefijo de evidencia por ARGUMENTO (sin constantes autorreferenciales;
# el runner verifica este script contra el blob del pin antes de llamarlo, F3).
# Uso: sil-jail-setup.sh <commit-pin> [prefijo-evidencia]   (defecto lote7-)
#
# v7 + bind RO de pesos MiniLM staged en /opt/silhouette-tools/models +
# /repo/{db,data} escribibles SOLO para nobody (datos de prueba efimeros).
# Aprobacion original lote6 (7-nov 01:02:59) verificada en el canal; CADA
# corrida requiere aprobacion NUEVA del usuario (el runner la exige afuera).
# Alcance de la corrida: 15min/1CPU/3GB, sin red durante la prueba, sin
# credenciales/datos reales, teardown temporal + evidencia, main/prod intactos.
# No imprime secretos. Evidencia en /var/sil-jail-evidence (root-only).
set -euo pipefail

JAIL=/var/sil-jail
EV=/var/sil-jail-evidence
COMMIT=${1:?uso: sil-jail-setup.sh <commit-pin> [prefijo-evidencia]}
PFX=${2:-lote7-}
WORKTREE=/root/apps/silhouette-agency-os
DONOR=/opt/silhouette/app/node_modules
NODE22=/opt/silhouette-tools/node22
MODELS=/opt/silhouette-tools/models

for m in scratch node22 node_modules models; do
  if mountpoint -q "$JAIL/$m" 2>/dev/null || mountpoint -q "$JAIL/repo/models" 2>/dev/null; then
    echo "ABORT: montaje previo en $JAIL (bind stack). Teardown primero." >&2; exit 1
  fi
done
if [ -d "$JAIL" ] && [ -n "$(ls -A "$JAIL" 2>/dev/null)" ]; then
  echo "ABORT: $JAIL existe y no esta vacio; teardown antes de re-ejecutar." >&2; exit 1
fi

mkdir -p "$EV" && chmod 700 "$EV"
echo "=== setup ${PFX} $(date -u +%FT%TZ) commit=$COMMIT ==="

mkdir -p "$JAIL"/{repo,node22,node_modules,scratch,dev,etc,lib64,usr/lib/x86_64-linux-gnu}
chown root:root "$JAIL" && chmod 755 "$JAIL"

git -C "$WORKTREE" archive "$COMMIT" | tar -x -C "$JAIL/repo"
chown -R root:root "$JAIL/repo"
# dirs de datos de prueba (escritura nobody SOLO aqui; codigo queda no-escribible)
mkdir -p "$JAIL/repo/db" "$JAIL/repo/data" "$JAIL/repo/models"
chown 65534:65534 "$JAIL/repo/db" "$JAIL/repo/data"
mkdir -p "$JAIL/repo/.gemini" "$JAIL/repo/output" && chown -R 65534:65534 "$JAIL/repo/.gemini" "$JAIL/repo/output"

printf 'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n' > "$JAIL/etc/passwd"
printf 'nogroup:x:65534:\n' > "$JAIL/etc/group"
chmod 644 "$JAIL/etc/passwd" "$JAIL/etc/group"
printf "127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n" > "$JAIL/etc/hosts"
chmod 644 "$JAIL/etc/hosts"

mknod -m 666 "$JAIL/dev/null" c 1 3
mknod -m 666 "$JAIL/dev/zero" c 1 5
mknod -m 666 "$JAIL/dev/urandom" c 1 9

for f in /lib64/ld-linux-x86-64.so.2 \
         /usr/lib/x86_64-linux-gnu/libdl.so.2 \
         /usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
         /usr/lib/x86_64-linux-gnu/libm.so.6 \
         /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 \
         /usr/lib/x86_64-linux-gnu/libpthread.so.0 \
         /usr/lib/x86_64-linux-gnu/librt.so.1 \
         /usr/lib/x86_64-linux-gnu/libc.so.6 \
         /usr/lib/x86_64-linux-gnu/libresolv.so.2; do
  cp -L --parents "$f" "$JAIL"
done
chmod -R a-w "$JAIL/lib64" "$JAIL/usr"
ls -l "$JAIL/lib64" "$JAIL/usr/lib/x86_64-linux-gnu" > "$EV/${PFX}P0a-libs.txt"

ln -sfn /node_modules "$JAIL/repo/node_modules"

mount -t tmpfs -o size=512M,mode=1777,nosuid,nodev tmpfs "$JAIL/scratch"

mount --bind "$NODE22" "$JAIL/node22"
mount -o remount,ro,nosuid,nodev,bind "$JAIL/node22"
mount --bind "$DONOR" "$JAIL/node_modules"
mount -o remount,ro,nosuid,nodev,bind "$JAIL/node_modules"
mount --bind "$MODELS" "$JAIL/repo/models"
mount -o remount,ro,nosuid,nodev,bind "$JAIL/repo/models"
for m in node22 node_modules repo/models; do
  findmnt -no OPTIONS "$JAIL/$m" | grep -qw ro || { echo "ABORT: $JAIL/$m NO quedo ro" >&2; exit 1; }
done

# Preflight evidencia
{ echo '--- jail root ---'; ls -la "$JAIL";
  echo '--- /repo ---'; ls -la "$JAIL/repo" | head -30;
  echo '--- modelos (RO) ---'; find "$JAIL/repo/models" -type f | sort;
  echo '--- sha256 modelos ---'; find "$MODELS" -type f | sort | xargs sha256sum; } > "$EV/${PFX}P1-fs.txt"
{ echo '--- jail propio (xdev) ---'; find "$JAIL" -xdev -perm /6000 -ls;
  echo '--- capabilities ---'; getcap -r "$JAIL" 2>/dev/null || true;
  echo 'OK si vacio arriba'; } > "$EV/${PFX}P2-caps.txt"
grep -rIlE '(BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key|secret|token|password)' "$JAIL/repo" \
  --exclude-dir=docs --exclude='*.md' > "$EV/${PFX}P4-secret-candidates.txt" || true
MD5_PIN=$(git -C "$WORKTREE" show "$COMMIT:package-lock.json" | md5sum | cut -d' ' -f1)
MD5_DONOR=$(md5sum /opt/silhouette/app/package-lock.json | cut -d' ' -f1)
{ echo "pin $COMMIT package-lock: $MD5_PIN"; echo "donor package-lock:       $MD5_DONOR";
  for p in vitest tsx @xenova/transformers; do
    printf '%s %s\n' "$p" "$(grep -m1 '"version"' "/opt/silhouette/app/node_modules/$p/package.json" | sed -E 's/.*: *"([^"]+)".*/\1/')"
  done; } > "$EV/${PFX}P5-donor.txt"
# Sin waiver: si el lockfile del pin difiere del donor, las dependencias de la
# jaula son ajenas al codigo archivado y la corrida no es honesta.
[ "$MD5_PIN" = "$MD5_DONOR" ] || { echo "ABORT: package-lock del pin != donor (dependencias ajenas al pin)" >&2; exit 1; }
grep '^' /proc/self/mounts | grep "$JAIL" > "$EV/${PFX}P-mounts.txt"
echo "=== setup ${PFX} OK ==="

# TEARDOWN (tras revision de evidencia):
# umount /var/sil-jail/repo/models /var/sil-jail/scratch /var/sil-jail/node22 /var/sil-jail/node_modules
# rm -rf /var/sil-jail   # la evidencia /var/sil-jail-evidence/ se conserva (rotada por intento)
