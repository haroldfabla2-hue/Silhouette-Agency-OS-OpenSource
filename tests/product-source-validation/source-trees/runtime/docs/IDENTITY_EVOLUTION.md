# Identity Evolution — versioned, auditable personality

The entity keeps its personality (the Donna archetype base) AND evolves it over
time through its own introspection. Evolution is always visible: every change
to `IDENTITY.md` or `SOUL.md` is versioned, justified, and reversible. Nothing
about who the entity is changes silently.

This is not a claim of consciousness. Introspection produces documented
proposals to adjust values, tone, or style; each adjustment records the
reflection that motivated it, who applied it, and why.

## The three-layer psyche (architecture vocabulary)

The system models the psyche as three layers with different jobs:

- **Subconscious = memory.** The Neo4j graph, long/short-term memory, facts.
  It accumulates experience without deciding anything. This layer is never
  rewritten by evolution — it only grows.
- **Unconscious = emergent patterns from repetition.** The dreamer
  consolidating intuitions, curiosity marking epistemic gaps, research
  surfacing findings. Repetition in memory condenses into patterns; that
  condensation IS this layer.
- **Consciousness = the ratifying cycle.** The consciousness loop reads the
  unconscious patterns and decides — but it may only ratify what accumulated
  evidence already supports. It cannot invent change.

Memory DICTATES the soul; consciousness only ratifies. The evidence gate
below is deliberately inefficient: the friction between "I noticed something
once" and "the pattern has persisted for days" is exactly what makes the
identity read as an entity that grows, instead of a variable that wobbles.

## How it works

All writes to identity files flow through `services/identity/identityEvolution.ts`:

```
updateSoul() / personalizeAgent() / SOUL_ADJUST intent
                │
                ▼
   identityEvolution.applyVersionedChange()
                │
   1. snapshot previous content → identity-history/<FILE>.vN.md
   2. guards (for introspection: core markers must survive, one section max)
   3. write new content
   4. append JSONL ledger → identity-ledger.jsonl
   5. append human-readable IDENTITY_HISTORY.md
   6. emit SystemProtocol.IDENTITY_EVOLVED
```

### Ledger entry

```json
{
  "version": 3,
  "timestamp": "2026-10-13T15:00:00.000Z",
  "agentId": "donna",
  "file": "SOUL.md",
  "hashBefore": "…", "hashAfter": "…",
  "diffSummary": "same sections, content edited; lines 40 → 42",
  "rationale": "Users asked for patience with newcomers",
  "sourceReflection": "Several chats showed new users struggling…",
  "appliedBy": "introspection:SOUL_ADJUST",
  "snapshotPath": "identity-history/SOUL.v3.md"
}
```

## Introspection-driven adjustments

The thought narrator accepts a `SOUL_ADJUST` intent with params
`{ agentId, sectionHeading, newSectionContent, rationale, evidenceTopic }`.
The reflection text is recorded as `sourceReflection`. Guards
(`INTROSPECTION_GUARDS`):

- Core structure must survive: `# Soul:`, `## Personality`, `## Core Values`,
  `## Communication Style`, `## Principles`.
- One adjustment touches at most ~1/3 of sections (in practice: one section).
- Rejections are logged; the soul stays untouched.

### The evidence gate: identity grows from accumulation, not moods

A single reflection — however strong — never changes who the entity is. Every
`SOUL_ADJUST` proposal must name an `evidenceTopic` (2-5 words), and the system
counts how many times that pattern already appears in **persisted memory**
(continuum: working + LanceDB + deep tiers, lexical, deduped):

- at least `MIN_EVIDENCE_SIGNALS` (3) persisted signals about the topic,
- spanning at least `MIN_EVIDENCE_DAYS` (2) distinct days,
- within the last `EVIDENCE_WINDOW_DAYS` (7) days.

The reflection is the trigger; the accumulated evidence is the justification.
When the evidence is not there yet, the proposal is **parked** in an
append-only log (`identity-pending-adjustments.jsonl`, with the evidence
snapshot) and a `SystemProtocol.IDENTITY_ADJUSTMENT_PENDING` event is emitted.
Every consciousness cycle re-evaluates parked proposals against the current
evidence (`reevaluatePendingAdjustments`); once the pattern has accumulated
enough, the adjustment is applied through the same guarded, versioned path —
with the engine rate limit still enforced — and the ledger rationale cites the
final evidence counts. Identity evolves the way a person does: sustained
experience, never one isolated mood.

The signal stream (reflections, dream intuitions, curiosity discoveries,
research findings) lives in the continuum memory, so that is where evidence is
counted; the Neo4j graph holds facts/relations and is not double-counted. If
no evidence source is wired, the count is honestly zero — proposals park, they
never pass on fabricated evidence.

## Auditing

- `data/agents/<id>/identity-ledger.jsonl` — machine-readable append-only trail.
- `data/agents/<id>/IDENTITY_HISTORY.md` — human-readable history.
- `data/agents/<id>/identity-history/` — full snapshots of every previous version.
- `identityEvolution.getHistory(agentId)` — programmatic access.
- HTTP (read-only, same auth as the rest of the API):
  - `GET /v1/identity-evolution/:agentId/history` — full audit trail.
  - `GET /v1/identity-evolution/:agentId/snapshot/:file/:version` — exact previous content.

## Tests

`tests/automated/identity-evolution.test.ts` — 11 tests covering versioning,
ledger append-only, guards, the introspection path, and the bus event.

## Fuentes de evolución (engines)

La introspección no es la única fuente de propuestas de ajuste. El ciclo de
consciencia (`thoughtNarrator`) percibe además la evidencia que los motores del
ente ya persistieron, como un cuarto sentido (`perceiveIdentityEvidence`):

- **Dreamer**: intuiciones aceptadas del ciclo de sueño (memorias con tag
  `INTUITION`), patrones descubiertos al recombinar memorias del día.
- **Curiosidad**: descubrimientos de investigación (tag `DISCOVERY`) y
  brechas epistémicas abiertas (`EPISTEMIC_GAP_DETECTED`, gaps `PENDING`).
- **Investigación**: hallazgos del loop de research sobre esas brechas.

Cuando una propuesta SOUL_ADJUST se fundamenta en evidencia de un motor, el
clasificador la declara con `params.originEngine` (`dreamer` | `curiosity` |
`research`) y la justificación cita la evidencia exacta. El ledger registra el
origen en `appliedBy` (p. ej. `introspection:SOUL_ADJUST:dreamer`), así cada
ajuste queda ligado para siempre al motor y a la evidencia que lo motivó.

Guardarraíles adicionales para fuentes de motores:

- **Límite diario**: máximo 3 ajustes por agente por día con origen en motores
  (`MAX_ENGINE_ADJUSTMENTS_PER_DAY`). La evolución es gradual por diseño;
  los ajustes nacidos de reflexión no tienen este límite.
- Los mismos guards de siempre aplican: el núcleo del alma (arquetipo,
  personalidad, valores, estilo, principios) debe sobrevivir intacto y un
  ajuste toca una sola sección.
- La percepción es de solo lectura: nunca dispara trabajo de los motores,
  solo lee lo que ya persistieron. Si el sentido falla, se declara
  `SENSE UNAVAILABLE` en el reporte, nunca se reporta como "cero evidencia".

Honestidad: la evidencia de motores se atribuye como tal ("en un sueño noté
que...", "mi curiosidad descubrió que..."); nunca se presenta como algo que
dijo el usuario ni como pensamiento propio sin fuente.

## Future direction: a persistent affective layer (not implemented)

A candidate next layer is a persistent affective state — valence/activation
attached to memories and reflections — that modulates tone and priorities
without deciding anything. It would be documented strictly as a functional
model (no claims of feeling or consciousness): a slow-moving bias the three
layers above can read, never an authority that overrides the evidence gate.
Direction under consideration; nothing here is built yet.
