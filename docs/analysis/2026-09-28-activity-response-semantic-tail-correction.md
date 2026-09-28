# Activity-Response Semantic Tail Correction — 2026-09-28

## Scope

This is a follow-up to
[`2026-09-27-activity-response-preservation-evidence.md`](./2026-09-27-activity-response-preservation-evidence.md).
That dated evidence file is retained unchanged as a point-in-time record.

A real `Aerobic Engine 3x15` activity exposed one false-positive classification that the
27 September harness did not cover: a terminal 12:54 rollout (67 W actual, 140–175 W
prescribed) arrived with generic FIT `active` intensity and was carried as a fourth
semantic `work` repetition. That manufactured a false late-collapse result.

## Review findings

1. Garmin FIT defines workout-step intensity independently from target values. `Active`
   (0), `Rest` (1), `Warmup` (2), `Cooldown` (3), `Recovery` (4), `Interval` (5)
   and `Other` (6) are distinct roles. A fallback for ambiguous `Active` must therefore
   not overwrite explicit `Interval` work. See
   https://developer.garmin.com/fit/articles/file-types/workout.html.
2. Performed power is outcome evidence, not semantic identity. A low-power final repetition
   without prescription evidence may be a genuine failed repetition, so power alone must
   not relabel it as cooldown.
3. The context-brief compatibility guard must stay narrower than general target clustering.
   High-target terminal work and internal lower-target work are valid mixed/progressive
   workout structures and must remain visible.
4. `docs/analysis/` is immutable point-in-time evidence in repository governance. The
   correction belongs in this new dated record rather than as an erratum edit to the
   27 September analysis.

## Corrected contract

- Specific FIT intensity roles win over targets and names.
- Step-name refinement is allowed only for generic/absent intensity.
- Terminal cooldown fallback is limited to generic `Active` work on a complete,
  untruncated semantic sequence with at least two preceding work segments and a clearly
  lower **prescribed** power target (>15% below the preceding median) or Z1/Z2 after a
  preceding Z3+ set.
- Performed power alone never changes semantic role.
- The display-only context-brief guard handles already-persisted bad semantics by trimming
  only a final lower-prescription tail after a coherent preceding set. It does not remove
  high-target or internal mixed-target work.

## Regression coverage added/adjusted

Python coverage verifies:

- the 234 / 231 / 228 W main set plus 67 W, 140–175 W terminal rollout;
- explicit cooldown intensity with a bounded target;
- terminal Z2 after Z4 work;
- explicit FIT `interval` intensity is not downgraded by a lower target;
- an unprescribed low-power final repetition remains work;
- a same-target low-power final repetition remains work.

Frontend coverage verifies:

- the real 27 September tail is excluded from the primary-set response summary;
- Z2 terminal tail after a Z3+ set is excluded;
- higher-target terminal work remains visible;
- internal lower-target work remains visible when an explicit cooldown follows;
- same-target low performed power can still produce a genuine late-collapse flag.

## Authority

This changes bounded activity-response telemetry and display-only context-brief response
features. It does not change recommendation selection, eligibility, dose, or weekly
allocation authority, so no `POLICY_VERSION` bump is required.
