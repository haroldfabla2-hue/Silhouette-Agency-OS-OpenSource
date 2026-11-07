#!/usr/bin/env bash
# lote7-runner.sh - UNA corrida congelada del test OS-restart bajo UNA ventana
# TOTAL de 15 minutos (incluye prep, probes, payload y teardown).
#
# ESTADO: codigo para revision estatica. NO ejecutar sin alcance+permiso.
#
# Lecciones aplicadas (lote 6): ventana TOTAL (no "desde primer payload" -
# revisor #3: la preparacion no se esconde), contabilidad automatica, sampler
# cgroup (memory.current/peak/events), oom_kill => STOP+BLOCKED, trap
# idempotente con recuperacion residual, UNA sola corrida sin diagnosticos
# encadenados (si falla: evidencia + reporte, nada de reintentos).
#
# Estimacion que hace viable la ventana total (mediciones lote 6):
#   prep (montaje jaula v8 + probes, pesos YA staged): ~2-3 min
#   payload (vitest: seed -> fin proceso -> verify, modelo carga 2 veces): ~5 min
#   teardown + contabilidad: ~1 min
#   total ~9 min < 15 min. Si la estimacion se rompe: BLOCKED ventana.
set -u
export LC_ALL=C

# ---------- configuracion ----------
WINDOW_S=900                 # ventana TOTAL (prep+payload+teardown)
TEARDOWN_RESERVE_S=60        # ningun payload nuevo si resta menos que esto
PAYLOAD_MIN_S=420            # estimacion minima para decidir lanzar payload
JAIL=/var/sil-jail
EVID=/var/sil-jail-evidence
UNIT=sil-jail-lote7-memosrestart
SETUP_SCRIPT=/root/sil-jail-v4/sil-jail-setup-v8.sh   # revisado en lote 6
MEMMAX_BYTES=3221225472      # 3 GiB, == limite autorizado
LEDGER=$EVID/lote7-budget-ledger.tsv
TIMELINE=$EVID/lote7-memory-timeline.tsv
ACCOUNTING=$EVID/lote7-accounting.md
SAMPLER_PID=""
T0=$(date +%s)

say()  { printf '[runner %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LEDGER"; }
left() { echo $(( T0 + WINDOW_S - $(date +%s) )); }

# ---------- teardown idempotente + recuperacion residual ----------
# Un trap NO garantiza nada ante SIGKILL/OOM del host (revisor): por eso el
# teardown es IDEMPOTENTE y el PRE-flight de la proxima ejecucion detecta y
# limpia residuos (montajes vivos, raiz temporal) antes de montar nada.
teardown() {
    local rc=$?
    [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null && wait "$SAMPLER_PID" 2>/dev/null
    SAMPLER_PID=""
    # desmontar todo lo que cuelgue de $JAIL, mas profundo primero
    local m
    findmnt | grep "$JAIL" | awk '{print $1}' | sed 's/^..//' \
        | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- \
        | while read -r m; do umount "$m" 2>/dev/null && say "umount OK $m" || say "umount FALLO $m"; done
    if findmnt | grep -q "$JAIL"; then
        say "RESIDUO: montajes vivos tras teardown - requiere intervencion"
    else
        rm -rf "$JAIL" && say "raiz temporal eliminada"
    fi
    accounting
    say "teardown fin (rc=$rc)"
}
trap teardown EXIT

# ---------- contabilidad automatica ----------
accounting() {
    {
        echo "# lote7 accounting"
        echo "T0: $(date -ud "@$T0" +%FT%TZ) | fin: $(date -u +%FT%TZ) | span: $(( $(date +%s) - T0 ))s / ${WINDOW_S}s"
        echo
        echo "| unidad | inicio | fin | wall s | CPU s | rc |"
        echo "|---|---|---|---|---|---|"
        journalctl --no-pager -o short-iso --since "@$T0" 2>/dev/null \
            | grep -E "$UNIT|sil-jail-lote7" | grep -E "Started|Deactivated|Consumed" \
            | sed 's/^/| /; s/$/ |/' || true
        echo
        echo "memoria: pico agregado y serie en lote7-memory-timeline.tsv"
        [ -f "$TIMELINE" ] && awk -F'\t' 'NR>1 && $4>m{m=$4} END{print "pico memory.peak agregado: "m" bytes (limite '"$MEMMAX_BYTES"')"}' "$TIMELINE"
    } > "$ACCOUNTING" 2>/dev/null || true
}

# ---------- preflight (todo falla BLOCKED, nunca sustituye) ----------
preflight() {
    # 1. residuos de una corrida muerta a la fuerza (SIGKILL/OOM host)
    if findmnt | grep -q "$JAIL" || [ -d "$JAIL" ]; then
        say "RESIDUO de corrida previa detectado: limpieza segura"
        findmnt | grep "$JAIL" | awk '{print $1}' | sed 's/^..//' \
            | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- \
            | while read -r m; do umount "$m" 2>/dev/null || true; done
        findmnt | grep -q "$JAIL" && { say "BLOCKED: residuo no limpiable"; exit 3; }
        rm -rf "$JAIL"
    fi
    # 2. kernel/cgroup: memory.peak disponible (v2, kernel >= 5.19)
    [ -f /sys/fs/cgroup/memory.peak ] || [ -f /sys/fs/cgroup/system.slice/memory.peak ] \
        || { say "BLOCKED: memory.peak no disponible en este kernel/cgroup"; exit 3; }
    # 3. pesos: los 5 archivos staged con sha256 contra el registro lote6
    local base=/opt/silhouette-tools/models/Xenova/all-MiniLM-L6-v2
    local f ok=1
    for f in config.json tokenizer.json tokenizer_config.json vocab.txt onnx/model_quantized.onnx; do
        [ -f "$base/$f" ] || { say "BLOCKED: falta peso staged $f"; ok=0; }
    done
    [ "$ok" = 1 ] || exit 3
    sha256sum "$base"/{config.json,tokenizer.json,tokenizer_config.json,vocab.txt,onnx/model_quantized.onnx} \
        > "$EVID/lote7-weights-sha256.txt"
    # 4. setup de la jaula (DENTRO de la ventana total) + probes de barrera
    [ -x "$SETUP_SCRIPT" ] || { say "BLOCKED: setup script ausente"; exit 3; }
    "$SETUP_SCRIPT" >> "$EVID/lote7-setup.log" 2>&1 || { say "BLOCKED: setup fallo"; exit 3; }
    say "preflight OK ($(left)s restantes)"
}

# ---------- sampler de memoria del cgroup real de la unidad ----------
sampler() {
    local unit=$1 cg="" i
    for i in $(seq 1 20); do
        cg=$(systemctl show -p ControlGroup --value "$unit" 2>/dev/null)
        [ -n "$cg" ] && break; sleep 0.5
    done
    [ -z "$cg" ] && { say "sampler: ControlGroup no resuelto para $unit"; return; }
    local d=/sys/fs/cgroup$cg
    printf 'ts\tunit\tcurrent\tpeak\tmax_ev\tboom\toom_kill\n' >> "$TIMELINE"
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

oom_kill_delta() {  # $1=antes archivo, $2=despues -> rc 0 si delta==0
    local a b
    a=$(awk '/^oom_kill /{print $2}' "$1" 2>/dev/null || echo 0)
    b=$(awk '/^oom_kill /{print $2}' "$2" 2>/dev/null || echo 0)
    [ "${a:-0}" = "${b:-0}" ]
}

# ---------- payload UNICO ----------
run_payload() {
    if [ "$(left)" -lt $(( PAYLOAD_MIN_S + TEARDOWN_RESERVE_S )) ]; then
        say "BLOCKED: ventana insuficiente para payload ($(left)s < $((PAYLOAD_MIN_S+TEARDOWN_RESERVE_S))s)"
        exit 3
    fi
    local cg ev_before ev_after rc
    systemd-run --unit="$UNIT" --scope -q --wait \
        -p MemoryMax=$MEMMAX_BYTES -p MemorySwapMax=0 -p CPUQuota=100% \
        -p TasksMax=256 -p TimeoutStartSec=$(( WINDOW_S < $(left) ? WINDOW_S : $(left) )) \
        -- /usr/bin/unshare -n -- /usr/bin/env -u INVOCATION_ID \
           /usr/sbin/chroot --userspec=65534:65534 "$JAIL" \
           /node22/bin/node /node_modules/vitest/vitest.mjs run \
           tests/automated/memory-os-process-restart-localem.test.ts \
           --root /repo --configLoader native --retry=0 \
        > "$EVID/lote7-payload.log" 2>&1 &
    local payload_pid=$!
    sampler "$UNIT" & SAMPLER_PID=$!
    wait "$payload_pid"; rc=$?
    kill "$SAMPLER_PID" 2>/dev/null; wait "$SAMPLER_PID" 2>/dev/null; SAMPLER_PID=""
    # enforcement: oom_kill durante la unidad?
    cg=$(systemctl show -p ControlGroup --value "$UNIT" 2>/dev/null)
    [ -n "$cg" ] && [ -f "/sys/fs/cgroup$cg/memory.events" ] && cp "/sys/fs/cgroup$cg/memory.events" "$EVID/lote7-memory.events.final"
    if [ -f "$EVID/lote7-memory.events.final" ]; then
        local ok
        ok=$(awk '/^oom_kill /{print $2}' "$EVID/lote7-memory.events.final")
        if [ "${ok:-0}" != "0" ]; then
            say "BLOCKED: oom_kill=$ok - el limite 3GB se ejercio y no basto; PROHIBIDO subirlo sin permiso"
            exit 3
        fi
    fi
    say "payload rc=$rc ($(left)s restantes)"
    return "$rc"
}

# ---------- main ----------
say "T0 ventana total ${WINDOW_S}s (prep+payload+teardown incluidos)"
preflight
run_payload
RC=$?
say "fin rc=$RC"
exit "$RC"
