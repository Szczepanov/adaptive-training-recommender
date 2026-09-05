# ADR-0035: Explicit Rest-Day Authoring in External Plans

* **Status:** Proposed
* **Date:** 2026-09-05
* **Deciders:** Repository owner
* **Source analysis:** H3 investigation, [cycling-primary hybrid evaluation plan](../plans/cycling-primary-hybrid-evaluation.md); [PR #401](https://github.com/Szczepanov/adaptive-training-recommender/pull/401)

## Context

Both external-plan schema versions state the same rule verbatim
(`docs/external-plan-schema.md`): *"Rest days are not sessions. A week with four sessions
leaves three days open, and the engine treats an unplanned day as available — it does not
need to be told to rest."* This is a deliberate simplification, not an oversight, and it
has held up fine for every scenario H1–H3 tested: a genuinely unplanned date correctly
falls back to the evergreen planner, labelled as a fallback (`externalFallback: true` in
`planningMode.ts`), and the athlete gets a normal recommendation for that day.

The gap is narrower than "rest is broken." It is: **an athlete (or the AI authoring their
plan) has no way to say "this day is a protected rest day, do not recommend training here,"
as opposed to "I didn't get around to planning this day."** Those are different facts. A
taper week's rest day, a deliberate deload day, or a day the athlete wants held open
regardless of how good their wearable numbers look that morning cannot currently be
distinguished from an ordinary gap in the plan. Every unplanned day — rest day or not —
resolves to evergreen and may recommend training.

This matters most exactly where the athlete cares most: a taper week, a deload, or a
recovery day the plan author placed deliberately between two hard sessions. Today, the
only way to protect such a day is a favorable readiness/safety-envelope outcome landing on
`recover` mode by coincidence — which is not "protected," it is "usually fine."

### Why this needs a decision, not a resolver fix

H3 confirmed (see the evaluation plan) that everything downstream of placement — missed-
session replacement, event reconciliation, immutable revisions — is correctly built and
tested. There is no bug to fix in the resolver. Adding rest authoring means **new
authority**: a new way for an external source to constrain what the engine may recommend
on a date, which is exactly the kind of decision ADR-0019 reserved for an explicit ADR
(see its D-EXT/D-CANDIDATE/D-EVENT precedent — every new import-side capability there was
its own numbered decision, not folded into the base schema silently).

### External precedent

Treating "rest day" and "no planned workout" as distinct calendar states is not unusual
outside this repository. Garmin Coach explicitly schedules unchecked training days as
**Rest Days**; TrainingPeaks plans distinguish a scheduled **Rest Day** from **No Planned
Workouts**. Neither precedent dictates this repository's schema, but both confirm the
product requirement is coherent rather than a fabricated edge case.

- Garmin cycling-plan scheduling: https://support.garmin.com/en-IE/aviation/faq/9WEulyuZyf6aDpcxPH1PI9/
- TrainingPeaks example distinguishing `REST DAY` from `No Planned Workouts`: https://www.trainingpeaks.com/training-plans/cycling/tp-497950/consistency-intensity-volume-for-fitness-cycling

## Options considered

### Option A — Widen `AuthoredPlanBlock.phase` to include `'rest'`

Reuse the existing travel-block mechanism verbatim: `phase: 'travel' | 'rest'`, applied
through `applyPlanningOverlays` exactly like a travel block, with `volumeScale: 0`.

**Rejected as insufficient on inspection.** `applyPlanningOverlays` only scales the
evergreen `PlannedDose { volume, intensity }` target that feeds objective/coverage sizing
— it does not gate which categories `rankCandidates` may select. A `volumeScale: 0` day
lowers how much the week *wants*, but nothing stops a normal-cost Easy Endurance or
Mobility candidate from still ranking and being recommended that day, the same way a
travel block reduces but does not eliminate training. This option would ship something
that reads as "rest" in the schema but does not behave as protected rest in the product,
which is worse than the current honest gap.

### Option B — A day-level `restDates` field on the plan envelope

Add `restDates: string[]` (or a `{date, reason}[]`) to the plan document itself, parallel
to `sessions[]`, resolved against the same Monday-relative `startDate`/`weekCount`
arithmetic sessions already use. A date in this list is closed to evergreen fallback
entirely: `resolvePlanningContext` (or a new sibling resolver) returns a `recover`-tier
verdict for that date regardless of readiness, labelled as **authored rest**, distinct
from both a normal `recover`-mode day and the `externalFallback: true` label.

**Consequences to work through if chosen:**
- Precedence against `AuthoredPlanBlock` travel (can a rest date and a travel block
  coexist on the same date — travel should probably win, since it already caps
  availability by venue) and against a placed session that later moves onto that date via
  `proposeReplacement` (a rest date should almost certainly refuse to receive a moved
  session — `resolvePlacement`'s occupancy set would need to treat it as blocked, the same
  way a booked `FixedActivity` already does).
- Whether the athlete can override it on a given morning (illness/travel surprise cutting
  the other way — they *want* to train despite the plan) — ADR-0019's D-EVENT precedent
  (advisory, never a hard block on the athlete's own choice) argues for advisory framing
  here too: state clearly this date is authored rest and why, but do not make it
  impossible to see a recommendation if the athlete actively asks for one.
- v1/v2 schema compatibility: an old imported plan without `restDates` must keep behaving
  exactly as it does today (empty list, no behavior change) — this is additive, so no
  migration is needed, but `validateExternalTrainingPlan`/`validateExternalTrainingPlanV2`
  need the new optional field and its date-range/format checks.
- Persistence/audit/replay: `RecommendationAudit` needs a new source label (something like
  `'authored_rest'`) alongside the existing `externalFallback`/`externally_planned`
  labels, and `replay.ts` needs to verify against it the same way it verifies template
  identity today.
- `POLICY_VERSION` bump required — this changes what gets recommended on a date it did not
  change before.

### Option C — A new session `kind`/kind-like entry in `sessions[]` (`isRest: true`, paralleling `isEvent: true`)

Give a session entry `isRest: true` (mutually exclusive with `isEvent`), reconciled onto a
new lightweight day-level authority the same way ADR-0019 D-EVENT reconciles `isEvent`
onto the existing `FixedActivity` contract — reusing `placement`/`flexibility`/`ifMissed`
so a rest day can be moved by the same missed-session machinery a normal session uses.

**Tradeoff versus Option B:** this fits the *existing* import mental model better (a rest
day is "a session," authored the same way everything else is, with the same placement
rules) and reuses more machinery, but it stretches "session" to mean "the deliberate
absence of one," which the schema doc currently states as an anti-pattern in the opposite
direction (`ADR-0019 D-IRREDUCIBLE`'s note about not encoding a deferral as a session).
Whether that stretch is acceptable is itself part of the decision.

## Recommendation

No option is implemented by this ADR — it requires the repository owner's sign-off before
any code changes. Leaning towards **Option B** (a day-level rest directive on the plan
envelope, not a session): a rest directive has no training duration, equipment, stimulus,
execution dose or adherence occurrence, and forcing it through `ExternalPlanSession` would
pollute the source-neutral session contracts ADR-0019/0023 are trying to preserve. Option
C's better placement/`ifMissed` reuse does not outweigh that. Option A is not viable as
stated and is included only to rule it out explicitly, since it was the first thing that
looked like a free reuse.

If Option B is accepted, at minimum it needs, before implementation:
- an explicit rest directive blocks `any_day` placement and missed-session replacement
  onto that date (the occupancy set in `resolvePlacement`/`proposeReplacement` must treat
  it as taken, the same way a booked `FixedActivity` already does);
- evaluating that date does **not** fall through to evergreen discretionary training;
- unplanned dates retain the current labelled fallback — this is additive, not a
  replacement for it;
- the persisted audit/replay record identifies the plan/revision/content hash and the
  specific rest directive that owned the date;
- v1/v2 remain readable as-is; the new representation is a new schema revision, not a
  silent broadening of an immutable import contract;
- `POLICY_VERSION` bumps, with matching persistence/rules/replay test coverage, because
  the directive changes what gets recommended.

Whichever option is chosen, the athlete-override framing from ADR-0019 D-EVENT (advisory,
never removing the athlete's own agency to train anyway) should carry over: a protected
rest day changes what the app *recommends*, not what the athlete is *allowed* to do.

## Consequences

**Positive.** Closes the one real product gap H3 found. Makes taper/deload weeks and
deliberate recovery placement actually protected rather than probabilistically likely.

**Negative.** New import-side authority requires the same validation/persistence/audit/
replay/rules-test rigor as every other ADR-0019 capability — this is not a small change
regardless of which option is chosen. `POLICY_VERSION` bumps.

**Neutral.** No behavior changes for any plan that does not use the new field/flag;
existing v1/v2 plans continue exactly as today.

## Alternatives considered and rejected

**Treat a favorable `recover`-mode outcome as sufficient "protection."** Rejected: this is
what happens today, and it is precisely the gap — it depends on the morning's readiness
data, not the plan's own intent, so a taper day with strong wearable numbers can still be
offered real training.

**Infer rest from an unusually light week (fewer than N sessions on a date).** Rejected:
requires guessing intent from absence, which is the exact ambiguity this ADR exists to
remove, and would silently change behavior for every existing imported plan without an
explicit opt-in.
