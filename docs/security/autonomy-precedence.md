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
| Introspección | SIN lector hoy → propuesta: `enabled && enableIntrospection` en sus rutas de invocación | `isIntrospectionEnabled` (hoy muerto) → cablear como freno | n/a |
| Narrador (powerManager) | cubierto por scheduling | getter muerto → cablear en thoughtNarrator o eliminar | n/a |
| Efectos externos (email, PR, generación) | no aplica | no aplica | grant/confirmación humana; paid hard-block |

## Abiertos y tradeoffs

1. **Getters muertos de powerManager** (`isLearningLoopEnabled`,
   `isNarrativeEnabled`, `isIntrospectionEnabled`): cablear como freno en
   sus rutas (más control operador) o eliminarlos (menos superficie muerta).
   Consecuencia de cablear: un cambio de modo puede silenciar narrator/
   learning sin tocar config — hay que documentarlo en /v1/system.
2. **`enableIntrospection` sin lector**: cablear en introspectionEngine
   callers (agentStream, heartbeat job, dreamerService, ...). Consecuencia:
   introspección se apaga con config; hoy corre cuando esos callers corren.
3. **Tradeoff genuino de producto (solo si Alberto quiere decidirlo)**:
   instalación fresca con modo CONSCIOUS default = sistema "vivo" sin tocar
   config, vs "quieto por defecto" hasta que el operador habilite. Hoy el
   techo config gana (default false en schema), así que una instalación
   fresca queda QUIETA aunque power diga CONSCIOUS — coherente con CERO
   sorpresas, pero cambia el "Living OS feel" out-of-the-box. Alternativas:
   (a) techo gana (actual, propuesto); (b) primer boot escribe config con
   enabled=true explícito tras consentimiento del operador; (c) CONSCIOUS
   solo habilita tareas sin mutación (narrator/curiosity sí, evolution no).
