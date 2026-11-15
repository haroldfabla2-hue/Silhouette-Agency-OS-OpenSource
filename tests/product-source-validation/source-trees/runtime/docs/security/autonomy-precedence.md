# Autonomía: matriz de precedencia y rutas (propuesta, PR #202)

Estado: PROPUESTA en rama, sin merge/deploy. No pregunta al usuario todavía;
si un tradeoff genuino de producto requiere su elección, está marcado abajo
con alternativas y consecuencias concretas.

## Autoridades existentes (hechos verificados)

1. **`silhouette.config.json` → `autonomy.*`** (archivo del operador).
   `enabled` (maestro) + sub-flags `allowEvolution`, `enableNarrative`,
   `enableIntrospection`. Antes de este PR no tenía lectores: todo corría.
2. **`powerManager` (modo de potencia)** — baseline, anterior a este PR.
   Modo default al boot: CONSCIOUS (todo activo). Cambiable por el operador
   vía `/v1/system`. Lectores reales: `isDreamerEnabled` (dreamerService),
   `isCuriosityEnabled` (curiosityService), `isEvolutionEnabled`
   (evolutionScheduler). SIN lector (baseline): `isLearningLoopEnabled`,
   `isNarrativeEnabled`, `isIntrospectionEnabled`.
3. **Autoridad humana por efecto** — `/v1/autonomy/confirmations` (solo
   sesión humana atribuida) y grants de un solo uso ligados a args exactos.

## Regla de precedencia propuesta

**Config es el techo; power mode es el acelerador/freno; el humano decide
efectos concretos.**

- `autonomy.* = false` ⇒ NADA lo re-habilita (ni power mode, ni grant, ni
  flag). El maestro `enabled=false` apaga toda autonomía proactiva y toda
  mutación autónoma aunque un sub-flag esté en true (semántica explícita,
  testeada).
- `autonomy.* = true` ⇒ power mode puede ESTRECHAR (throttle, desactivar por
  recursos) pero nunca AMPLIAR lo que el techo no autorizó.
- Efectos externos: aun con todo habilitado, cada efecto exige su autoridad
  humana por pieza (grant args-bound o confirmación). Wallet-bearing:
  hard-block hasta diseño de presupuesto/cap (restricción temporal declarada,
  código intacto).

Justificación: el archivo de config es la autoridad más fuerte (persistente,
auditada, del operador); power mode es operación diaria (intensidad); la
confirmación humana es por efecto. Invertir el orden permitiría que un modo
de runtime re-active autonomía que el operador apagó en config — eso es lo
que este PR elimina.

## Matriz de rutas

| Ruta de ejecución | Techo (config) | Freno (power) | Autoridad por efecto |
|---|---|---|---|
| Tareas proactivas del daemon (Heartbeat, Curiosity, Dreamer, Narrator, Evolution_Goals, Tool_Evolution, SelfDev) | `enabled` AND sub-flag (scheduling, unifiedDaemon) | powerManager dentro del servicio (dreamer/curiosity/evolution tienen lector) | n/a (no ejecutan efectos externos directos) |
| Mantenimiento (Janitor, Self-Healing: ingesta + análisis) | siempre (no es autonomía) | n/a | n/a |
| **Auto-aplicación de fixes (Self-Healing, Tool_Evolution)** | **`enabled` AND `allowEvolution`** (nuevo, este PR) | n/a | mutación interna; sin gasto |
| Introspección (OODA cycles) | `enabled` AND `enableIntrospection` en el chokepoint `runCognitiveCycle` (cubre daemon, heartbeat job y trigger HTTP manual; fail-closed) | `isIntrospectionEnabled` (lector real, mismo chokepoint) | n/a |
| Narrador (powerManager) | cubierto por scheduling (daemon Narrator) | `isNarrativeEnabled` lector real: pausa el batch processor por tick | n/a |
| Heartbeat job (server/jobs/heartbeat.ts, boot loader) | `enableIntrospection` (pre-check; chokepoint del engine manda) + `enabled` (Curiosity) para discovery | congestion + throttle dentro de servicios | n/a |
| Discovery auto-arranque (neuroCognitiveService constructor) | `enabled` (Curiosity) por tick, fail-closed | `isCuriosityEnabled` por tick | n/a |
| Boot loops de evolución (loaders: learningLoop + toolEvolver) | `enabled` AND `allowEvolution` (Tool_Evolution) al boot, fail-closed | `isLearningLoopEnabled` por tick (learningLoop) | n/a |
| evolutionScheduler (server/index.ts + reactivación por modo) | cada loop con su task (Tool_Evolution / Evolution_Goals), fail-closed | `isEvolutionEnabled` (preexistente) | n/a |
| Efectos externos (email, PR, generación) | no aplica | no aplica | grant/confirmación humana; paid hard-block |

## Lifecycle/imports (CI teardown crash)

Diagnóstico CANDIDATO (mecanismo plausible verificado en código + timing
consistente; SIN traza A-B ni reproducción controlada — la causalidad exacta
del crash no está probada): `continuumMemory` y `contextAssembler` abrían
conexión Redis real en CONSTRUCTOR de singleton = en IMPORT. Sin Redis en
CI, connect() hace 3 reintentos (~5-14s) antes del fallback; si el worker
de vitest terminaba en esa ventana, el cierre de rpc con operación pendiente
es consistente con el fallo observado ("Closing rpc while fetch was
pending", intermitente — un rerun del MISMO código salió verde, lo que
confirma la intermitencia y a la vez limita la fuerza de corridas verdes
como evidencia). Además el Dreaming loop arrancaba como efecto oculto del
import de continuum.

Rootfix (sin mocks, sin fabricar verde): redisClient conecta LAZY en la
primera operación real (ensureConnected en get/set/del; connect sigue
siendo idempotente y no lanza); constructores ya no tocan red; el Dreaming
loop arranca explícito en server/loaders/index.ts (idempotente,
PowerManager-gated, mismo comportamiento en prod que ya lo conecta vía
dbLoader). Comportamiento real preservado; el import queda puro.

## Resueltos en esta iteración (cobertura de autonomía)

1. **Getters muertos de powerManager**: cableados como FRENO (throttle), no
   eliminados — `isLearningLoopEnabled` (tick de learningLoop),
   `isNarrativeEnabled` (tick del batch processor de narrativeService),
   `isIntrospectionEnabled` (chokepoint de runCognitiveCycle). Diseño:
   config=techo (autoridad, fail-closed), power=freno (recursos, fail-open a
   capacidad plena). Consecuencia declarada: un cambio de modo vía
   /v1/system puede pausar narrator/learning/introspección sin tocar config;
   es la semántica pretendida del freno y conserva toda la capacidad en
   modo CONSCIOUS (default todo activo).
2. **`enableIntrospection` sin lector**: ahora gobierna el chokepoint
   `introspectionEngine.runCognitiveCycle` (`Introspection` en
   PROACTIVE_TASK_FLAGS). Toda ruta al engine queda cubierta: tarea daemon
   Evolution_Goals, heartbeat job, y el trigger manual HTTP
   /v1/introspection/cognitive-cycle. Fail-closed.
3. **Rutas no-daemon auditadas y cerradas**: heartbeat job (ciclo OODA 120s
   + discovery), auto-arranque del heartbeat de neuroCognitiveService
   (constructor +30s), boot loops de evolución en loaders (learningLoop,
   toolEvolver, análisis inicial), evolutionScheduler (boot en index.ts y
   reactivación por cambio de modo — ambas rutas pasan por
   activateScheduler, que ahora agenda solo loops permitidos por task).
4. **cognitiveScheduler (services/cognitive/cognitiveScheduler.ts)**: NO es
   un agujero — `start()` está deprecado (no-op con warning) y sus métodos
   run* no tienen callers (verificado por búsqueda estática). Código muerto
   documentado; se conserva (eliminarlo es decisión de limpieza ajena al
   rootfix).
5. Loops internos: estas rutas mueven trabajo cognitivo interno (ciclos
   OODA, discovery, análisis); no se demostró nuevo gasto externo asociado.

## Abiertos y tradeoffs

1. **Tradeoff genuino de producto (solo si Alberto quiere decidirlo)**:
   instalación fresca con modo CONSCIOUS default = sistema "vivo" sin tocar
   config, vs "quieto por defecto" hasta que el operador habilite. Hoy el
   techo config gana (default false en schema), así que una instalación
   fresca queda QUIETA aunque power diga CONSCIOUS — coherente con CERO
   sorpresas, pero cambia el "Living OS feel" out-of-the-box. Alternativas:
   (a) techo gana (actual, propuesto); (b) primer boot escribe config con
   enabled=true explícito tras consentimiento del operador; (c) CONSCIOUS
   solo habilita tareas sin mutación (narrator/curiosity sí, evolution no).
