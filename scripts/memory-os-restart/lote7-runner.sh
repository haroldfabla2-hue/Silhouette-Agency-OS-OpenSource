#!/usr/bin/env bash
# lote7-runner.sh - UNA corrida congelada del test OS-restart bajo UNA ventana
# Uso: NO invocar directamente - la entrada es el comando wrapper minimo
# documentado en la cabecera de lote7-launch.sh (ancla + cap 900s ANTES del
# primer hostwrite). Este runner exige LOTE7_T0_EPOCH.
# v7/v8: ENTRADA UNICA = comando wrapper minimo (ancla exportada y cap 900s
#   de timeout ANTES del primer hostwrite - el git show del lanzador ya ocurre
#   dentro del cap; sin archivo previo ni supuesto de tiempo despreciable).
#   Sin LOTE7_T0_EPOCH este runner sale BLOCKED. Margen duro: TERM<=T0+894,
#   KILL<=T0+899 (kill-after 5s + 1s slack DENTRO de los 900). --configLoader
#   runner: vite 6.4.1
#   admite tambien native, pero depende del soporte TS nativo del minor de
#   Node 22 (no verificado); runner transforma TS sin esa dependencia (F2).
# v5/v6: pin por argumento verificado contra los blobs
#   del worktree (runner+setup) y archivado en la jaula (F3); rotacion de la
#   evidencia lote7-* anterior con sufijo .<epoch> sin borrar nada (F4); causa
#   raiz de lanzamiento ANTES del chequeo de medicion (F5); env -i allowlist
#   del lote6 en la cadena del payload; ruta absoluta en la autoenvoltura (F7).
# TOTAL de 900s (incluye prep, probes, payload y teardown). CODIGO para
# revision estatica: NO ejecutar sin alcance+permiso del usuario.
#
# Contrato UNICO de ventana (runner == doc, revisor #4):
#   WINDOW_S=900 total | TEARDOWN_RESERVE_S=180 | corte de lanzamientos:
#   ningun payload nuevo si left < PAYLOAD_MIN_S + RESERVE (=> nada nuevo
#   tras T0+5:00 con los valores declarados: left < 420+180=600).
#   Enforcement global: autoenvoltura `timeout --kill-after=5s <TERM budget>` (abajo,
#   en codigo) + `systemctl stop $UNIT` en trap TERM/EXIT + RuntimeMaxSec dinamico
#   (=left-TEARDOWN_RESERVE_S) en la unidad (ahora SERVICE: soporta --wait, exit code y RuntimeMaxSec;
#   --scope era incompatible con --wait - fallo del intento 1 lote 7).
#
# Lecciones: oom_kill se deriva del TIMELINE del sampler (el ControlGroup
# desaparece al morir la unidad - revisor #2); whitelist EXACTA de fuentes
# (revisor #3, == setup-v8 lineas 15-17); findmnt -rn sin parsear caracteres
# de arbol (revisor #7); ledger clasifica PASS/FAIL/BLOCKED parseando el
# payload (#6). UNA corrida: sin diagnosticos encadenados.
set -u
export LC_ALL=C

WINDOW_S=900
HARD_KILL_MARGIN_S=6
TEARDOWN_RESERVE_S=180
PAYLOAD_MIN_S=420
JAIL=/var/sil-jail
EVID=/var/sil-jail-evidence
UNIT=sil-jail-lote7-memosrestart
SETUP_SCRIPT=/root/sil-jail-v4/sil-jail-setup.sh
WORKTREE=/root/apps/silhouette-agency-os
MEMMAX_BYTES=3221225472
LEDGER=$EVID/lote7-budget-ledger.tsv
TIMELINE=$EVID/lote7-memory-timeline.tsv
ACCOUNTING=$EVID/lote7-accounting.md
SAMPLER_PID=""
# T0 lo fija el bloque (0b) desde la ancla OBLIGATORIA LOTE7_T0_EPOCH.
T0=${LOTE7_T0_EPOCH:-}

# --- (0) pin revisado como argumento (F3: sin autorreferencia) + ruta (F7) ---
PIN="${1:-}"
[[ "$PIN" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED: uso: lote7-runner.sh <commit-pin-revisado> (sha1 40 hex)"; exit 3; }
RUNNER_PATH=$(readlink -f "$0" 2>/dev/null || true)
[ -n "$RUNNER_PATH" ] && [ -f "$RUNNER_PATH" ] || { echo "BLOCKED: invocar por ruta de archivo, no por stdin"; exit 3; }

# --- (0b) ancla OBLIGATORIA (revisor r3): la ventana 900s empieza en el
# primer hostwrite del LANZADOR. Sin ancla no hay reloj confiable: BLOCKED.
# La auditoria mtime >= ancla bloquea una ancla tramposa hacia el futuro.
[ -n "${LOTE7_T0_EPOCH:-}" ] || { echo "BLOCKED: falta LOTE7_T0_EPOCH - la entrada es el wrapper de lote7-launch.sh"; exit 3; }
[[ "$LOTE7_T0_EPOCH" =~ ^[0-9]+$ ]] || { echo "BLOCKED: LOTE7_T0_EPOCH no es epoch"; exit 3; }
NOW=$(date +%s)
[ "$LOTE7_T0_EPOCH" -le "$NOW" ] || { echo "BLOCKED: ancla T0 en el futuro"; exit 3; }
[ "$(stat -c %Y "$RUNNER_PATH")" -ge "$LOTE7_T0_EPOCH" ] || { echo "BLOCKED: ancla T0 posterior a la materializacion del runner"; exit 3; }
[ -f "$SETUP_SCRIPT" ] && [ "$(stat -c %Y "$SETUP_SCRIPT")" -ge "$LOTE7_T0_EPOCH" ] || { echo "BLOCKED: ancla T0 posterior a la materializacion del setup"; exit 3; }
T0=$LOTE7_T0_EPOCH
# Margen duro compartido con el wrapper/lanzador: TERM <= T0+894, KILL <=
# T0+899 (5s kill-after + 1s slack fork/exec) - NUNCA tras T0+900.
TERM_BUDGET=$(( T0 + WINDOW_S - HARD_KILL_MARGIN_S - $(date +%s) ))
[ "$TERM_BUDGET" -gt $(( PAYLOAD_MIN_S + TEARDOWN_RESERVE_S )) ] || { echo "BLOCKED: ventana remanente desde el ancla insuficiente (${TERM_BUDGET}s)"; exit 3; }

# --- (1) autoenvoltura del watchdog global: remanente de la ventana TOTAL ---
if [ "${LOTE7_WRAPPED:-}" != "1" ]; then
    exec env LOTE7_WRAPPED=1 LOTE7_T0_EPOCH="$T0" timeout --kill-after=5s "${TERM_BUDGET}s" bash "$RUNNER_PATH" "$@"
fi

say()  { printf '[runner %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LEDGER"; }
left() { echo $(( T0 + WINDOW_S - $(date +%s) )); }

# F4: la rotacion de evidencia la hace el LANZADOR antes de materializar.

# Fuentes de montaje EXACTAS de la jaula (sil-jail-setup.sh: DONOR/NODE22/MODELS). Ni una mas.
fuente_conocida() {
    case "$1" in
        tmpfs|/opt/silhouette-tools/node22|/opt/silhouette-tools/models|/opt/silhouette/app/node_modules) return 0 ;;
        *) return 1 ;;
    esac
}

# --- teardown idempotente: para la unidad, mata sampler, desmonta, borra ---
teardown() {
    local rc=$?
    [ -n "$SAMPLER_PID" ] && { kill "$SAMPLER_PID" 2>/dev/null; wait "$SAMPLER_PID" 2>/dev/null; SAMPLER_PID=""; }
    systemctl is-active --quiet "$UNIT" 2>/dev/null && { systemctl stop "$UNIT" 2>/dev/null; say "unidad $UNIT detenida (watchdog/salida)"; }
    local t
    findmnt -rn -o TARGET | grep "^$JAIL" | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- \
        | while read -r t; do umount "$t" 2>/dev/null && say "umount OK $t" || say "umount FALLO $t"; done
    if findmnt -rn -o TARGET | grep -q "^$JAIL"; then
        say "RESIDUO: montajes vivos tras teardown - requiere intervencion humana"
    else
        rm -rf "$JAIL" && say "raiz temporal eliminada"
    fi
    accounting
    say "teardown fin (rc=$rc)"
}
trap teardown EXIT
trap 'say "watchdog TERM/INT recibido"; exit 3' TERM INT

# --- contabilidad automatica + clasificacion (#6) ---
accounting() {
    local cls="SIN-PAYLOAD"
    if [ -f "$EVID/lote7-payload.log" ]; then
        local last_receipt
        last_receipt=$(grep '^OS_RESTART_RECEIPT ' "$EVID/lote7-payload.log" | tail -1 || true)
        if [ -n "$last_receipt" ]; then
            cls=$(printf '%s' "$last_receipt" | sed -E 's/^OS_RESTART_RECEIPT //; s/.*"status": ?"([A-Z]+)".*/\1/')
        elif grep -q 'BLOCKED' "$EVID/lote7-payload.log"; then cls="BLOCKED"
        elif [ "${PAYLOAD_RC:-1}" = 0 ]; then cls="PASS"; else cls="FAIL"
        fi
    fi
    {
        echo "# lote7 accounting"
        echo "T0: $(date -ud "@$T0" +%FT%TZ) | fin: $(date -u +%FT%TZ) | span: $(( $(date +%s) - T0 ))s / ${WINDOW_S}s (TOTAL: prep+payload+teardown)"
        echo "clasificacion: $cls | payload rc: ${PAYLOAD_RC:-n/a}"
        echo
        echo "## journal de unidades"
        journalctl --no-pager -o short-iso --since "@$T0" 2>/dev/null \
            | grep -E "sil-jail-lote7" | grep -E "Started|Deactivated|Consumed" \
            | sed -E 's| - /usr/bin/unshare.*| [cmd]|' || true
        echo
        echo "## memoria (serie completa en lote7-memory-timeline.tsv)"
        [ -f "$TIMELINE" ] && awk -F'\t' 'NR>1 && $4+0>m{m=$4} END{print "pico memory.peak agregado: "m" bytes (limite '"$MEMMAX_BYTES"')"}' "$TIMELINE"
    } > "$ACCOUNTING" 2>/dev/null || true
}

# --- preflight: residuo SOLO con identidad verificada (#3), peak, pesos ---
preflight() {
    # F3: el pin revisado gobierna los TRES artefactos (runner, setup, jaula)
    git -C "$WORKTREE" cat-file -e "$PIN^{commit}" 2>/dev/null \
        || { say "BLOCKED: pin $PIN ausente en worktree (sin fetch en esta fase)"; exit 3; }
    [ "$(git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/sil-jail-setup.sh" 2>/dev/null | sha256sum | cut -d' ' -f1)" \
      = "$(sha256sum "$SETUP_SCRIPT" 2>/dev/null | cut -d' ' -f1)" ] \
        || { say "BLOCKED: setup materializado != blob del pin (rematerializar desde $PIN)"; exit 3; }
    [ "$(git -C "$WORKTREE" show "$PIN:scripts/memory-os-restart/lote7-runner.sh" 2>/dev/null | sha256sum | cut -d' ' -f1)" \
      = "$(sha256sum "$RUNNER_PATH" | cut -d' ' -f1)" ] \
        || { say "BLOCKED: runner materializado != blob del pin (rematerializar desde $PIN)"; exit 3; }
    say "pin verificado contra worktree: runner+setup == blobs de $PIN (la jaula archiva ese mismo pin)"
    if findmnt -rn -o TARGET | grep -q "^$JAIL" || [ -d "$JAIL" ]; then
        local src ajena=0
        while read -r src; do
            fuente_conocida "$src" || { ajena=1; say "RESIDUO con fuente AJENA: $src"; }
        done < <(findmnt -rn -o TARGET,SOURCE | awk -v j="$JAIL" '$1 ~ ("^" j) {print $2}')
        if [ "$ajena" = 1 ]; then
            say "BLOCKED: residuo de identidad NO verificada (fuentes ajenas). No se toca; revision humana."
            exit 3
        fi
        say "RESIDUO de jaula propia verificado: limpieza"
        findmnt -rn -o TARGET | grep "^$JAIL" | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- \
            | while read -r t; do umount "$t" 2>/dev/null || true; done
        findmnt -rn -o TARGET | grep -q "^$JAIL" && { say "BLOCKED: residuo no limpiable"; exit 3; }
        rm -rf "$JAIL"
    fi
    [ -f /sys/fs/cgroup/system.slice/memory.peak ] \
        || { say "BLOCKED: memory.peak no disponible en este kernel/cgroup"; exit 3; }
    local base=/opt/silhouette-tools/models/Xenova/all-MiniLM-L6-v2 f ok=1
    for f in config.json tokenizer.json tokenizer_config.json vocab.txt onnx/model_quantized.onnx; do
        [ -f "$base/$f" ] || { say "BLOCKED: falta peso staged $f"; ok=0; }
    done
    [ "$ok" = 1 ] || exit 3
    sha256sum "$base"/{config.json,tokenizer.json,tokenizer_config.json,vocab.txt,onnx/model_quantized.onnx} \
        > "$EVID/lote7-weights-sha256.txt"
    [ -x "$SETUP_SCRIPT" ] || { say "BLOCKED: setup script ausente o no ejecutable"; exit 3; }
    "$SETUP_SCRIPT" "$PIN" lote7- >> "$EVID/lote7-setup.log" 2>&1 || { say "BLOCKED: setup fallo"; exit 3; }
    say "preflight OK ($(left)s restantes)"
}

# --- sampler: lee el cgroup real de la unidad mientras vive (#2) ---
sampler() {
    local unit=$1 cg="" i d
    for i in $(seq 1 20); do
        cg=$(systemctl show -p ControlGroup --value "$unit" 2>/dev/null)
        [ -n "$cg" ] && break; sleep 0.5
    done
    [ -z "$cg" ] && { say "sampler: ControlGroup no resuelto para $unit"; return; }
    d=/sys/fs/cgroup$cg
    printf 'ts\tunit\tcurrent\tpeak\tmax_ev\toom\toom_kill\n' >> "$TIMELINE"
    while systemctl is-active --quiet "$unit" 2>/dev/null; do
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%S)" "$unit" \
            "$(cat $d/memory.current 2>/dev/null || echo '?')" \
            "$(cat $d/memory.peak 2>/dev/null || echo '?')" \
            "$(awk '/^max /{print $2}' $d/memory.events 2>/dev/null || echo '?')" \
            "$(awk '/^oom /{print $2}' $d/memory.events 2>/dev/null || echo '?')" \
            "$(awk '/^oom_kill /{print $2}' $d/memory.events 2>/dev/null || echo '?')" \
            >> "$TIMELINE"
        sleep 2
    done
}

# --- oom_kill desde el TIMELINE (el cgroup ya no existe al terminar) ---
ultimo_oom_kill() {
    [ -f "$TIMELINE" ] || { echo "?"; return; }
    awk -F'\t' -v u="$UNIT" 'NR>1 && $2==u && $7!="?" {v=$7} END{print (v==""?"?":v)}' "$TIMELINE"
}

# --- payload UNICO y congelado ---
# SERVICE transient (no --scope): --scope es incompatible con --wait (fallo
# del intento 1). La unidad service soporta --wait (propaga el exit code) y
# RuntimeMaxSec dinamico; las fronteras de aislamiento/medicion son IDENTICAS:
# mismos limites cgroup, unshare -n, chroot nobody, sampler por ControlGroup.
run_payload() {
    if [ "$(left)" -lt $(( PAYLOAD_MIN_S + TEARDOWN_RESERVE_S )) ]; then
        say "BLOCKED: ventana insuficiente para payload ($(left)s < $((PAYLOAD_MIN_S+TEARDOWN_RESERVE_S))s)"
        exit 3
    fi
    systemd-run --unit="$UNIT" -q --wait --collect \
        -p MemoryMax=$MEMMAX_BYTES -p MemorySwapMax=0 -p CPUQuota=100% \
        -p TasksMax=256 -p TimeoutStartSec=300 -p RuntimeMaxSec=$(( $(left) - TEARDOWN_RESERVE_S )) \
        -- /usr/bin/unshare -n -- /usr/bin/env -i \
           PATH=/node22/bin HOME=/scratch TMPDIR=/scratch NODE_ENV=test CI=true \
           REDIS_URL=redis://127.0.0.1:1 NEO4J_URI=bolt://127.0.0.1:1 \
           /usr/sbin/chroot --userspec=65534:65534 "$JAIL" \
           /node22/bin/node /node_modules/vitest/vitest.mjs run \
           tests/automated/memory-os-process-restart-localem.test.ts \
           --root /repo --configLoader runner --retry=0 \
        > "$EVID/lote7-payload.log" 2>&1 &
    local payload_pid=$!
    sampler "$UNIT" & SAMPLER_PID=$!
    wait "$payload_pid"; PAYLOAD_RC=$?
    kill "$SAMPLER_PID" 2>/dev/null; wait "$SAMPLER_PID" 2>/dev/null; SAMPLER_PID=""

    # F5: causa raiz primero - un lanzamiento/ejecucion fallido SIN recibo se
    # declara como tal (con el tail del payload log), no como fallo de medicion.
    if [ "$PAYLOAD_RC" != "0" ] && ! grep -q '^OS_RESTART_RECEIPT ' "$EVID/lote7-payload.log" 2>/dev/null; then
        say "BLOCKED: payload sin recibo (rc=$PAYLOAD_RC) - lanzamiento/ejecucion fallo; causa: $(tail -n 1 "$EVID/lote7-payload.log" 2>/dev/null | cut -c1-160)"
        exit 3
    fi

    # enforcement de memoria: del timeline, nunca del cgroup muerto
    local ok; ok=$(ultimo_oom_kill)
    if [ "$ok" = "?" ]; then
        say "BLOCKED: medicion de memoria fallo (timeline sin datos de $UNIT) - no se afirma enforcement"
        exit 3
    fi
    if [ "$ok" != "0" ]; then
        say "BLOCKED: oom_kill=$ok - el limite 3GB se ejercio y no basto; PROHIBIDO subirlo sin permiso"
        exit 3
    fi
    say "payload rc=$PAYLOAD_RC oom_kill=0 ($(left)s restantes)"
    return "$PAYLOAD_RC"
}

# --- main ---
say "T0 ventana TOTAL ${WINDOW_S}s desde ancla LOTE7_T0_EPOCH=$T0 (lanzador, primer hostwrite; corte lanzamientos T0+$((WINDOW_S-PAYLOAD_MIN_S-TEARDOWN_RESERVE_S))s) pin=$PIN"
preflight
run_payload
RC=$?
say "fin rc=$RC"
exit "$RC"
