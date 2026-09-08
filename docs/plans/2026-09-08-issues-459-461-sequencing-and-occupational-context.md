# Issues #459–#461: simulation fidelity, sequence intent, and occupational context

**Status:** Implemented
**Blocked by:** None
**Unlocks:** Reproducible multi-week simulation evaluation and phase-aware sequencing calibration

## Outcome

The simulation harness now rolls active dose into completed-history exposures, so chained
forecast days replay the load that was actually prescribed. Judge packets carry separate,
recursively canonical SHA-256 `inputId` and `planId` values computed from emitted artifacts;
the corpus builder's historical `planSha256` remains `artifactPlanId` provenance, not the
judge-facing identity. Existing blind and pairwise position controls remain authoritative.

The engine resolves one immutable `SequenceIntentPolicy` from the existing periodization phase.
It applies a bounded soft multiplier for key-session spacing and density, recovery protection,
and long-session priority; it records the canonical phase provenance with the decision.
Clinical, injury, recovery-hour, equipment, time, and exact-role gates remain unchanged.

Daily physical-work input remains the acute authority. `OccupationalLoadBaseline` is optional,
validated, and persisted with the check-in; when present, the resolver discounts only the
adapted usual portion, bounded by baseline confidence and current-to-usual load-area overlap,
then exposes the remaining acute deviation. Omitted work intensity/duration retains the
conservative moderate/medium fallback. When baseline data is absent, the legacy acute
calculation is preserved. Physical-work plus an activity-adjusted ambient-step surge is
surfaced as an overlap diagnostic and is not additively charged.

## Implementation evidence

- #459: `simulation/analyze.ts` `toCompletedExposure`, `effectiveDoseSimulation.test.ts`, and
  judge corpus/packet canonical input and plan identities with artifact provenance.
- #460: `sequenceIntent.ts` `resolveSequenceIntentPreference`, `optimizer.ts` bounded soft
  preference integration, and phase-mapping/optimizer tests.
- #461: `occupationalLoad.ts` `resolveOccupationalLoadContext`, model/adaptor/validation changes,
  and acute-vs-baseline/confidence/novelty/overlap tests.

## Verification

- Focused Vitest suites for effective-dose simulation, packet identity, pairwise judging,
  sequence intent, optimizer/planner behavior, occupational load, physical work, adapters, and
  validation pass.
- TypeScript project build/typecheck passes.
- Pre-commit checks pass on the implementation commits.

No occupation-title inference was added, no additive double-charge was enabled, and no live
recommendation hard gate was weakened.
