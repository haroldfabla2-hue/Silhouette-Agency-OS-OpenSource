# Lote 7 - Diseno de presupuesto y controles de ejecucion (SIN EJECUTAR)

Estado: DISENO EN PAPEL. Nada de este documento se ha probado en host ni
instalado. Requiere revision del andamiaje + alcance/permiso nuevos antes de
cualquier corrida. Responde a las lecciones del lote 6 (ventana excedida
18:02 vs 15:00; metrica de memoria no confiable; FAIL/BLOCKED confundidos).

## 1. Presupuesto unico de 15 min, medido desde el PRIMER PAYLOAD

- Staging (descarga de pesos), montaje de jaula y probes de barrera son
  PREPARACION: ocurren antes de T0 y fuera del presupuesto (tienen red solo
  en staging; los payloads nunca).
- T0 = timestamp del primer lanzamiento de payload (cualquier unidad que
  ejecute codigo del repo: vitest, seed, verify). El runner lo registra en
  `evidence/budget-ledger.tsv` (unit, t_start, t_end, wall_s, cpu_s, rc).
- Regla de lanzamiento: antes de CADA unidad, el runner calcula
  `restante = T0 + 900 - ahora - RESERVA_TEARDOWN`. Si `restante` es menor
  que el minimo estimado de esa fase, NO lanza y pasa a teardown con motivo
  registrado. Estimaciones declaradas por fase (seed 180s, verify 180s,
  vitest total 660s tope interno) - la regla manda sobre la estimacion.
- RESERVA_TEARDOWN = 180s. Ningun payload nuevo tras T0+12:00; teardown
  (desmontar binds, borrar raiz temporal, cerrar ledger) termina dentro de
  la ventana. El desmontaje real tarda segundos; la reserva absorbe
  finalizacion de evidencia y contabilidad.
- Watchdog global: el runner es secuencial (unidades con --wait) y chequea
  el presupuesto entre unidades; ademas cada unidad lleva
  `RuntimeMaxSec = min(900, restante)` y el runner entero corre bajo
  `timeout --kill-after=5s 900s` desde T0. Si el watchdog mata a media
  fase, el teardown corre igual (trap EXIT) y el resultado se declara
  BLOCKED (ventana insuficiente), nunca PASS parcial.

## 2. Memoria: medicion robusta (la leccion del lote 6)

El `memory peak` de systemd al desactivar la unidad no es confiable en este
host (cgroup v2, systemd 255: lo reportaron 2/5 unidades; 37.3MB implausible
para node+onnxruntime). Reemplazo:

- Sampler del runner (host, bash, sin instalar nada): mientras la unidad
  este activa, cada 2s lee del cgroup de la unidad
  (`systemctl show -p ControlGroup <unit>` para resolver la ruta, nunca a
  ojo): `memory.current`, `memory.peak`, y de `memory.events` los campos
  `max`, `oom`, `oom_kill`. Apenda a `evidence/memory-timeline.tsv`
  (ts, unit, current, peak, max, oom, oom_kill). El pico agregado del
  bloque = max(memory.peak) sobre todas las unidades, con la serie
  completa como evidencia.
- Deteccion de enforcement: delta de `memory.events.max`/`oom_kill` entre
  antes y despues de cada unidad. `oom_kill > 0` => el limite SI se ejercio
  y la carga no cabe: STOP, BLOCKED "limite insuficiente", reportar; esta
  PROHIBIDO subir el limite sin permiso nuevo. `peak >= 90% de MemoryMax`
  => advertencia destacada en el reporte.
- La serie agregada (no un numero suelto) es lo presentable como evidencia
  de que la carga real estuvo dentro del limite.

## 3. Contabilidad automatica (para el reporte)

Al cerrar, el runner emite `evidence/accounting.md` con: T0, fin, span
total, tabla por unidad (inicio, fin, wall, CPU del journal, rc),
presupuesto restante, y la declaracion explicita de si la ventana se
respeto. El reporte a main usa ese archivo tal cual; nada de reconstruir
tiempos a mano del journal.

## 4. Lo que NO cambia

- Limites por unidad: 1 CPU, MemoryMax=3GB, 0 swap, 256 tasks, red
  deshabilitada (unshare -n), usuario nobody, pin de commit explicito en el
  setup, probes de barrera antes del primer payload.
- Contrato de la prueba (9586b26): 4 tiers con su persistencia real
  (WORKING=snapshot disco; MEDIUM/LONG=LanceDB canonico PENDING por
  diseno; DEEP=canonico+proyeccion READY con el modelo local real);
  fases seed -> fin de proceso -> verify en proceso nuevo.
- Honestidad: cualquier frontera no verificable = BLOCKED declarado, no
  PASS; los tests no se tocan para permitir verde sin avisar a main.
- Fuera de alcance: cambios de producto (p.ej. rutas nuevas de backfill),
  E2 con Redis real, M2/M3, Nano. Foco: validar 4 tiers + reinicio y
  cerrar integralmente.
