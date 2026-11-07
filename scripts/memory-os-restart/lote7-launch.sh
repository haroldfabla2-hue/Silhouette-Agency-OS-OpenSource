#!/usr/bin/env bash
# lote7-launch.sh - ENTRADA UNICA de la ventana aprobada (900s LITERALES).
# El reloj UNICO arranca en la primera linea ejecutada (T0); TODO lo demas -
# verificacion, materializacion (hostwrites), runner, payload y teardown -
# consume esa misma ventana. No hay reloj nuevo ni cap externo dependiente
# del operador: la autoenvoltura timeout cubre hasta una materializacion
# colgada. Uso (ventana aprobada por el usuario):
#   git -C /root/apps/silhouette-agency-os show <pin>:scripts/memory-os-restart/lote7-launch.sh > /root/sil-jail-v4/lote7-launch.sh
#   bash /root/sil-jail-v4/lote7-launch.sh <pin>
# (ese unico git show previo es local al worktree y tarda <1s; el lanzador se
#  autoverifica contra el blob del pin antes de cualquier otro hostwrite).
set -u
T0=$(date +%s)
WINDOW_S=900
WORKTREE=/root/apps/silhouette-agency-os
DIR=/root/sil-jail-v4
EVID=/var/sil-jail-evidence
LEDGER=$EVID/lote7-budget-ledger.tsv

PIN="${1:-}"
[[ "$PIN" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED: uso: lote7-launch.sh <commit-pin-revisado> (sha1 40 hex)"; exit 3; }
SELF=$(readlink -f "$0" 2>/dev/null || true)
[ -n "$SELF" ] && [ -f "$SELF" ] || { echo "BLOCKED: invocar por ruta de archivo, no por stdin"; exit 3; }

# Cap global: 900s literales desde T0 cubren TAMBIEN la materializacion.
if [ "${LOTE7_LAUNCH_WRAPPED:-}" != "1" ]; then
    exec env LOTE7_LAUNCH_WRAPPED=1 timeout --kill-after=5s "${WINDOW_S}s" bash "$SELF" "$@"
fi

say() { printf '[launch %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LEDGER"; }

# Integridad: este lanzador debe ser exactamente el blob revisado del pin.
[ "$(git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/lote7-launch.sh" 2>/dev/null | sha256sum | cut -d' ' -f1)" \
  = "$(sha256sum "$SELF" 2>/dev/null | cut -d' ' -f1)" ] \
    || { echo "BLOCKED: lanzador materializado != blob del pin"; exit 3; }

# Rotacion de evidencia del intento anterior (nunca se borra; sufijo epoch).
mkdir -p "$EVID"
for f in lote7-launch.log lote7-payload.log lote7-memory-timeline.tsv lote7-setup.log \
         lote7-accounting.md lote7-budget-ledger.tsv lote7-weights-sha256.txt \
         lote7-P0a-libs.txt lote7-P1-fs.txt lote7-P2-caps.txt \
         lote7-P4-secret-candidates.txt lote7-P5-donor.txt lote7-P-mounts.txt; do
    if [ -f "$EVID/$f" ]; then
        mv "$EVID/$f" "$EVID/$f.$(date -u -r "$EVID/$f" +%Y%m%dT%H%M%SZ)"
    fi
done
exec > >(tee -a "$EVID/lote7-launch.log") 2>&1
say "T0=$T0 ventana ${WINDOW_S}s literales desde este instante (pin=$PIN)"

# Materializacion (hostwrites) dentro de la ventana; el runner audita sus mtimes.
git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/lote7-runner.sh" > "$DIR/lote7-runner.sh" \
    || { say "BLOCKED: materializacion runner"; exit 3; }
git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/sil-jail-setup.sh" > "$DIR/sil-jail-setup.sh" \
    || { say "BLOCKED: materializacion setup"; exit 3; }
chmod +x "$DIR/sil-jail-setup.sh"
say "materializacion OK desde pin (T0+$(( $(date +%s) - T0 ))s); entregando al runner"

# Un solo reloj: el runner recibe la ancla y aplica el remanente.
exec env LOTE7_T0_EPOCH="$T0" bash "$DIR/lote7-runner.sh" "$PIN"
