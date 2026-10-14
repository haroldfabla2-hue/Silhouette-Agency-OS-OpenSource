# Affective Layer — a functional regulation model

The entity carries a **persistent affective state** (valence + activation) that
tags its memories and reflections and **modulates tone and priorities**. This
is a functional model of affective regulation — it is **not** a claim of
consciousness or real feelings, in code or in docs.

The design follows the measured finding (inverted-U curve): an affective state
improves performance only when it is **continuous, moderate, and modulating**.
Extremes degrade it — so extremes are unreachable by construction.

## The four invariants

1. **Persistent.** The state lives in `data/affective_state.json` (atomic
   writes) and survives restarts. A missing or corrupt file degrades honestly
   to a neutral baseline.
2. **Moderate.** Valence is clamped to [-0.6, +0.6] and activation to
   [0.15, 0.85]. No observation, however extreme, can push the state out of
   the band (`clampToModerateBand`, tested).
3. **Gradual.** Each observation is absorbed as an exponential moving average
   (alpha = 0.15). The state never jumps — it drifts, the way a person's mood
   follows sustained experience rather than single events.
4. **Modulates, never decides.** The state enters the narrator's epiphany
   prompt as tone-only context whose block carries the hard rule: it must
   never change intent, action, confidence, or safety fields. The System 2
   decision path (`rationalizeThought`) receives no affective input at all —
   pinned by test.

## How it connects to what already exists

- **Observations come from real evaluations.** After System 2 evaluates a
  thought, its existing `valence` (0..1 → -1..1) and `urgency` dimensions feed
  the state as one gradual observation. No new LLM calls, no fabricated
  signals.
- **Modulation goes into the existing narrator.** `synthesizeEpiphany` injects
  `getModulationContext()` into its prompt. There is exactly one consciousness
  loop and one narrator — the affective layer is context inside them, not a
  second system.
- **Memories are tagged, never altered.** Each stored epiphany carries an
  additive `affect: { valence, activation, at }` label (optional field on
  `MemoryNode`, optional in the Zod schema). Eternal memory invariant intact:
  nothing is deleted, rewritten, or downgraded; the tag is metadata added at
  write time.

## Honest limits

- The state is a two-dimensional summary. It does not model specific emotions.
- Tone modulation depends on the underlying model respecting the prompt rule;
  the decision-invariance guarantee is structural (no decision path reads the
  state), not prompt-dependent.
- Activation is mapped from urgency today. If a better-arousal signal appears
  (e.g. error rates, incident frequency), the mapping can be refined —
  versioned and documented, like the reputation formula.
