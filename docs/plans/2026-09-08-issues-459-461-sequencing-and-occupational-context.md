# Issues #459–#461: simulation fidelity, sequence intent, and occupational context

**Status:** Implemented
**Blocked by:** None
**Unlocks:** Reproducible multi-week simulation evaluation and phase-aware sequencing calibration

## Outcome

The simulation harness now rolls active dose into completed-history exposures, so chained
forecast days replay the load that was actually prescribed. Engine plan packets also carry a
SHA-256 identity computed from the generated plan before judge evaluation; existing blind and
pairwise position controls remain authoritative.

The engine resolves one immutable `SequenceIntentPolicy` from the existing periodization phase.
It records the canonical phase provenance and influences only soft candidate preferences for
quality density and long-session preservation. Clinical, injury, recovery-hour, equipment,
time, and exact-role gates remain unchanged.

Daily physical-work input remains the acute authority. `OccupationalLoadBaseline` is optional,
validated, and persisted with the check-in; when present, the resolver treats the adapted
usual portion as baseline and exposes only the excess as acute deviation. When absent, the
legacy acute calculation is preserved. Physical-work plus ambient-step surge is surfaced as an
overlap diagnostic and is not additively charged.

## Implementation evidence

- #459: `simulation/analyze.ts` `toCompletedExposure`, `effectiveDoseSimulation.test.ts`, and
  judge corpus/packet plan identities.
- #460: `sequenceIntent.ts` `resolveSequenceIntent`, `optimizer.ts` soft preference integration,
  and phase mapping tests.
- #461: `occupationalLoad.ts` `resolveOccupationalLoadContext`, model/adaptor/validation changes,
  and acute-vs-baseline/overlap tests.

## Verification

- Focused Vitest suites for effective-dose simulation, packet identity, pairwise judging,
  sequence intent, optimizer/planner behavior, occupational load, physical work, adapters, and
  validation pass.
- TypeScript project build/typecheck passes.
- Pre-commit checks pass on the implementation commits.

No occupation-title inference was added, no additive double-charge was enabled, and no live
recommendation hard gate was weakened.
