#!/usr/bin/env bash
# lote7-launch.sh - materializacion + arranque bajo el reloj UNICO de la ventana.
#
# ENTRADA UNICA (comando wrapper minimo, verificable: ancla y cap global ANTES
# del primer hostwrite, sin archivo previo ni supuestos de tiempo despreciable):
#
#   T0=$(date +%s); export LOTE7_T0_EPOCH=$T0; timeout --kill-after=5s $(( 894 - ( $(date +%s) - T0 ) ))s \
#     bash -c 'git -C /root/apps/silhouette-agency-os show "$1":scripts/memory-os-restart/lote7-launch.sh > /root/sil-jail-v4/lote7-launch.sh && exec bash /root/sil-jail-v4/lote7-launch.sh "$1"' _ <pin-sha1-40hex>
# Margen duro: TERM a mas tardar T0+894 y KILL a mas tardar T0+899 (5s de
# kill-after + 1s de slack fork/exec DENTRO de los 900s, nunca fuera).
#
# Orden garantizado: el ancla se exporta antes de que arranque timeout, y el
# primer hostwrite (git show) ocurre ya DENTRO del cap de 900s. Este script NO
# arranca un reloj nuevo: adopta LOTE7_T0_EPOCH o sale BLOCKED. Todo lo demas
# (autoverificacion, rotacion, materializacion de runner/setup, runner,
# payload, teardown) consume esa misma ventana.
set -u
WINDOW_S=900
HARD_KILL_MARGIN_S=6
WORKTREE=/root/apps/silhouette-agency-os
DIR=/root/sil-jail-v4
EVID=/var/sil-jail-evidence
LEDGER=$EVID/lote7-budget-ledger.tsv

PIN="${1:-}"
[[ "$PIN" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED: uso: wrapper de la cabecera con <commit-pin-revisado>"; exit 3; }
SELF=$(readlink -f "$0" 2>/dev/null || true)
[ -n "$SELF" ] && [ -f "$SELF" ] || { echo "BLOCKED: invocar por ruta de archivo, no por stdin"; exit 3; }

# Ancla OBLIGATORIA (revisor r3/r4): sin reloj externo verificable no hay ventana.
[ -n "${LOTE7_T0_EPOCH:-}" ] || { echo "BLOCKED: falta LOTE7_T0_EPOCH - usar el comando wrapper de la cabecera"; exit 3; }
[[ "$LOTE7_T0_EPOCH" =~ ^[0-9]+$ ]] || { echo "BLOCKED: LOTE7_T0_EPOCH no es epoch"; exit 3; }
[ "$LOTE7_T0_EPOCH" -le "$(date +%s)" ] || { echo "BLOCKED: ancla T0 en el futuro"; exit 3; }
T0=$LOTE7_T0_EPOCH
# El propio lanzador fue materializado por el wrapper DESPUES del ancla.
[ "$(stat -c %Y "$SELF")" -ge "$T0" ] || { echo "BLOCKED: ancla T0 posterior a la materializacion del lanzador"; exit 3; }
# TERM budget: el KILL (TERM+5s) nunca cae tras T0+900 (margen duro 6s).
TERM_BUDGET=$(( T0 + WINDOW_S - HARD_KILL_MARGIN_S - $(date +%s) ))
[ "$TERM_BUDGET" -gt 60 ] || { echo "BLOCKED: ventana remanente insuficiente para materializar (${TERM_BUDGET}s)"; exit 3; }

# Cap propio sobre el remanente (red de seguridad si se invoca sin el wrapper).
if [ "${LOTE7_LAUNCH_WRAPPED:-}" != "1" ]; then
    exec env LOTE7_LAUNCH_WRAPPED=1 LOTE7_T0_EPOCH="$T0" timeout --kill-after=5s "${TERM_BUDGET}s" bash "$SELF" "$@"
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
say "ancla LOTE7_T0_EPOCH=$T0 adoptada (TERM budget ${TERM_BUDGET}s, KILL <= T0+$((WINDOW_S-1))s; pin=$PIN)"

# Materializacion (hostwrites) dentro de la ventana; el runner audita sus mtimes.
git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/lote7-runner.sh" > "$DIR/lote7-runner.sh" \
    || { say "BLOCKED: materializacion runner"; exit 3; }
git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/sil-jail-setup.sh" > "$DIR/sil-jail-setup.sh" \
    || { say "BLOCKED: materializacion setup"; exit 3; }
chmod +x "$DIR/sil-jail-setup.sh"
say "materializacion OK desde pin (T0+$(( $(date +%s) - T0 ))s); entregando al runner"

# Un solo reloj: el runner recibe la ancla y aplica el remanente.
exec env LOTE7_T0_EPOCH="$T0" bash "$DIR/lote7-runner.sh" "$PIN"
