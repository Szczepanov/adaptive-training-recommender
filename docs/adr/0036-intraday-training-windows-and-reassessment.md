# ADR-0036: Intraday Training Windows and Post-Session Reassessment

* **Status:** Accepted
* **Date:** 2026-09-05
* **Deciders:** Codex, under the repository owner's request to take the H4 decision
* **Implementation:** Unstarted; acceptance of this design does not activate behavior.
* **Related:** [ADR-0035](./0035-explicit-rest-day-authoring.md),
  [ADR-0034](./0034-canonical-performed-training-occurrence-and-multisource-reconciliation.md),
  [ADR-0023](./0023-multidomain-session-authoring-execution-and-evidence.md),
  [ADR-0019](./0019-externally-authored-plans-and-session-adjudication.md),
  [H4 evaluation](../plans/cycling-primary-hybrid-evaluation.md),
  [implementation handoff](../plans/cycling-primary-hybrid-implementation-handoff.md).

## Context and verified boundary

`trainingCapacity.ts` `resolveTrainingCapacity` produces date/minute slots;
`weeklyDosePacking.ts` `packWeeklyDose` marks each slot used after one assignment.
Neither output identifies intraday start/end or elapsed recovery. Merely supplying two
rows for one date would duplicate the daily allowance without a shared ledger.

`externalPlacement.ts` `resolvePlacement` already moves preferred same-day bundles.
Its calendar occupancy is date-based; placement does not prove that two sessions fit
distinct windows. `Home.tsx` already adjudicates authored additional occurrences against
remaining minutes and systemic cost. H4 extends these contracts, rather than reporting
them as absent or introducing a second optimizer or readiness authority.

`SessionExecution` records `startedAt` and `completedAt`; canonical performed-fact
hydration exists in `performedTrainingFactsService.ts`. Its range has an exclusive end
date, so a history snapshot ending today is insufficient for today's AM completion.
Implementation must explicitly include today's as-of facts. Existence of these modules
does not by itself demonstrate a complete live intraday accounting path.

ADR-0035 closes an entire authored date to generated work and reserves `external-plan@3`
for rest with unchanged v2 session semantics. H4 adds different authority: the order and
feasibility of several sessions within that date. It must preserve protected rest,
immutable revisions, source-neutral execution and ordinary safety gates.

This is a software authority decision, not a physiological recommendation. No universal
recovery-hour threshold or new numerical load model is justified or introduced here.

## Options considered

1. **AM/PM labels on today's date slots.** Rejected: labels establish neither usable
   intervals nor elapsed separation, and independent budgets can overspend the day.
2. **Explicit windows, one daily ledger, sequential reassessment.** Accepted: supports
   authored doubles with traceable capacity and completion while reusing existing gates.
3. **Immediately generate automatic doubles with a new intraday optimizer.** Deferred:
   expands selection and dose policy before execution/accounting is proven. More calendar
   openings do not authorize more training or demonstrate tolerance.

## Decision

### D-WINDOW — availability and author intent have separate owners

The athlete's versioned schedule owns actual availability: stable window id, Warsaw-local
date, local start/end, optional label, and applicable equipment/environment restrictions.
Recurring availability is resolved to dated instances by the app. Windows are same-date,
positive-duration and non-overlapping; an overnight opening must be split at midnight.
AM/PM are display labels, never implicit clock ranges or physiological categories.

The plan owns the desired window, session order and dependencies. A plan request cannot
create athlete availability or broaden a clinical, equipment, time or environment gate.
The resolved placement binds an occurrence to an actual dated window, retaining both
authored request and resolved assignment. A manually authored occurrence uses the same
internal binding contract; schedule facts do not belong inside `SessionDefinition`.

The first release supports at most one training occurrence per resolved window. Multiple
sessions require separate explicit windows. Legacy date-only availability remains one
untimed slot with current behavior; missing metadata never creates an AM and PM pair.

### D-SCHEMA — new import authority belongs in v4

Introduce `adaptive-training-recommender/external-plan@4`, inheriting ADR-0035's v3 rest
contract and v2 definitions. Do not amend the accepted v3 decision or widen v1/v2/v3
validators. A stable `planId` retains one increasing revision sequence across versions,
with chosen-date-forward supersession and immutable historical audits.

The v4 session placement gains an optional `intraday` object with these semantics:

```typescript
// Contract sketch for new v4 fields; not an existing exported type.
intraday?: {
  window: { startLocal: string; endLocal: string }; // HH:mm, requested interval
  bundleId: string; // explicit same-date placement unit within the plan week
  order: number; // unique nonnegative integer in the bundle
  afterSessionId?: string; // earlier required-completed predecessor in this bundle
  minimumSeparationMinutes?: number; // finite >= 0; requires afterSessionId
};
```

Dates stay week/weekday-relative to the sole authored absolute `startDate`. The app
intersects the requested interval with real athlete availability and verifies duration
fits; it never imports that interval as new availability. Bundle members must agree on
week, preferred day and flexibility; require a preferred day for an intraday bundle in
the first release. References must resolve inside the bundle, point to earlier order,
and form no cycles. Reject invalid times, zero/cross-midnight intervals, overlapping
requested windows, duplicate order, dangling references and rest/session contradictions.

Reuse session `priority: 'optional'` for whole-session optionality; do not confuse this
with optional prescription steps. `afterSessionId` means completion is required; mere
ordering does not require the earlier session to have been performed. Do not allow a
required session to depend on an optional predecessor. Plans without `intraday` retain
their legacy placement behavior and make no timing/separation promise.

### D-TIME — elapsed intervals use instants

Resolve local window boundaries in `Europe/Warsaw` to timestamps with explicit offsets.
Persist both local ownership and resolved instants. Reject nonexistent DST local times;
ambiguous repeated times require an explicit athlete-resolved offset before placement
can be executable. Do not silently choose an offset. Moving to another date resolves
the local boundaries again rather than adding 24 hours to old timestamps.

Before launch, remaining window time starts at the later of its start and the evaluation
instant. Separation is prospective start minus the predecessor's actual end instant,
not start-to-start, calendar-day distance or AM/PM label. Missing or inconsistent actual
timestamps cannot satisfy a required separation; report an unresolved timing prerequisite.
An authored minimum is a sequencing constraint, not clinical clearance. Existing spacing,
injury and readiness restrictions remain binding even after that minimum has elapsed.

### D-LEDGER — every window shares one day's capacity

Create one pure, as-of daily accounting boundary consumed by placement and adjudication.
It owns the resolved total daily minute ceiling, the resolved daily systemic-cost/load
ceiling supplied by the current capacity/adjudication authorities, completed work,
in-progress reservations, future commitments, and accepted pending session reservations.
Keep the current common cost/eligibility authorities; do not invent another fatigue-fusion
formula or a second systemic-cost scale.

For each candidate, derive both remainders from that same ledger. `remainingMinutes` is
clamped at zero after subtracting unique completed minutes and outstanding minute
reservations from the daily minute ceiling. `remainingSystemicCost` is likewise clamped
at zero after subtracting unique completed canonical cost and outstanding cost
reservations from the daily systemic-cost ceiling. Usable minutes are the minimum of the
candidate's remaining window and `remainingMinutes`, but minute availability alone is
not admission: accepted work must also fit within `remainingSystemicCost` under the
existing cost estimation/adjudication rules. If either dimension is exhausted, later
work is clipped, deferred or rejected through the common prescription gates rather than
admitted from the other dimension alone. Existing check-in `timeAvailable` keeps its
current ceiling semantics; any new athlete input for *remaining* minutes must be
separately named and validated, never silently reinterpret that field.

Fixed activities and authored/generated reservations enter the ledger once. Refactor
the existing `resolveAvailability` deductions at this boundary rather than subtracting
them again downstream. A reservation carries both its planned minute debit and the
bounded systemic-cost debit returned by current approved estimation authorities. A
pending reservation that becomes in-progress keeps the same occurrence identity and is
not charged again. Matching execution evidence reconciles that reservation; it never
adds an independent second charge.

Reconciliation is per occurrence and per accounting dimension. When canonical execution
evidence reliably establishes actual performed minutes and/or systemic cost, replace the
corresponding reserved debit with the known actual debit and release only the portion
that is demonstrably unperformed. Partial and abandoned occurrences follow this same
transition: their known performed contribution remains consumed while only proven
unperformed reservation is released. If actual execution exceeds the reservation, record
the actual debit and clamp the remaining daily capacity at zero; completed work is never
retroactively erased to make a later window fit. Replayed, duplicate or reordered
completion/provider evidence must be idempotent under canonical occurrence/execution
identity and revision.

If a dimension cannot yet be reconciled because telemetry is missing, late, ambiguous or
has no bounded actual estimate, do not infer zero and do not refund it. Keep the
applicable outstanding reservation for that dimension until canonical evidence resolves
it; in-progress work therefore retains a conservative reservation. Missing cost is
uncertainty, not proof of spare capacity, and additional-session approval is withheld if
no bounded estimate exists. Later-window reassessment reads known actual consumption plus
all unresolved reservations, so partial or abandoned work cannot disappear from same-day
capacity while synchronization is incomplete.

Canonical performed occurrence identity is the deduplication authority for execution
and provider evidence. Do not build an H4-specific fuzzy matcher. Same-day work is
accounted exactly once: readiness or symptom changes may alter the next recommendation,
but they do not reset, duplicate or refund explicit ledger consumption. Unresolved
reconciliation or unavailable same-day facts must be exposed and cannot be treated as an
empty training day. Safe intraday release is blocked until the canonical boundary
supplies tested same-day identity, revision and timing evidence.

Dropping optional PM releases only its wholly unperformed reservation. It does not undo
AM credit or trigger automatic replacement work. Added windows do not raise weekly
session commitment, required dose or tolerated-load assumptions.

### D-REASSESS — PM is conditional until launch

A morning PM verdict is provisional. Before a later session starts, compose a fresh
as-of decision from current availability, today's canonical completed work, current
health/symptom inputs and the shared ledger. Require an explicit post-predecessor
symptom/response confirmation for a dependent session; absent confirmation leaves it
pending, not implicitly well tolerated. Reuse the existing health-context and response
authorities; do not create a second tissue score. Overnight recovery retains its metric
date and is not relabelled as a fresh afternoon measurement.

Run the common eligibility, readiness, dose and authored gates again. New adverse
symptoms may scale/defer PM despite favorable morning wearables. Favorable response
does not automatically increase the authored dose. A completed AM occurrence cannot be
launched again; resuming an in-progress execution preserves its execution identity.

Each accepted launch must atomically validate the current ledger/input revision and
claim or transition its existing reservation, preventing two tabs or concurrent requests
from spending the same minute or systemic-cost capacity. A stale decision must recompute.
Changes to completion, symptoms, placement, availability or reconciliation invalidate a
pending PM approval; historical decisions remain immutable and are linked by superseding
decision identity.

### D-PLACEMENT — bundles and rest remain explicit

Move unstarted bundle members as one confirmed proposal, preserving order and checking
all destination windows, combined minute and systemic-cost budget, fixed commitments,
separation and rest. If the whole proposal cannot fit, explain the conflict and leave
placement unchanged. An athlete may explicitly drop an optional member before
re-evaluating the remainder; do not silently split the bundle to make a proposal fit.

Once a member starts, do not move its history. Any remaining-session move is a separate
confirmed proposal respecting predecessor completion and existing `ifMissed` semantics.
Do not automatically carry dropped optional work forward. Preserve legacy per-session
overlays for old schemas; v4 bundle changes use the new validated proposal boundary.

ADR-0035 rest closes every window by default. Availability does not override rest, and
a PM omission on an authored session date does not become an independent evergreen
fallback request. Explicit athlete overrides remain auditable and fully gated. Event
advice retains ADR-0019's advisory contract while its time/load reservation still counts.

### D-AUDIT — snapshot the intraday decision, not just its date

Version affected schedule, placement, occurrence and decision persistence explicitly.
Keep user-scoped paths and backward-compatible readers; exact storage layout is an
implementation detail, but a daily document must not overwrite AM evidence with PM.
Record decision id/as-of instant, policy version, plan id/revision/hash, occurrence and
prescription identities, requested/resolved window and offsets, bundle/order/dependency,
availability revision, completed-fact revision and source ids, response/check-in snapshot
identity, daily ledger ceilings/inputs/reservations/reconciled actuals, elapsed-separation
evidence, result/reasons, and any override or superseded decision id. Retain immutable
replay inputs, not only pointers to mutable latest records.

Replay verifies all identity bindings and recomputes against those saved inputs.
Missing inputs or any identity/hash/date/window mismatch is unreplayable, never repaired
with today's plan, clock or wearable sync. Runtime activation requires a policy bump
and matching schema, import, Firestore rules, replay and UI coverage.

## Delivery boundary and acceptance

Implement authored/imported window placement and execution first. Automatic multi-window
packing is a separate follow-up after the ledger and reassessment release passes its
acceptance bar; it must reuse these contracts and preserve existing weekly dose limits.
Do not claim current single-session persona forecasts validate doubles.

The implementation must demonstrate deterministic cases for:

- v1/v2/v3 unchanged, valid v4 round-trip/hash, invalid intraday fields/references rejected,
  cross-version revision ordering and historical supersession preserved;
- legacy missing windows stay single-slot; requested windows cannot create availability;
  overlaps, elapsed-window expiry and equipment/context intersections fail correctly;
- a 90-minute daily ceiling with 60-minute AM completion leaves at most 30 minutes for
  PM even if both windows individually offer 90 minutes;
- a candidate with spare minutes but exhausted daily systemic-cost capacity is not
  admitted; completed cost and outstanding cost reservations reduce the same clamped
  load remainder and are never independently double-counted;
- execution plus provider evidence for AM counts once and completion reconciles rather
  than stacks on its reservation; partial completion retains known consumption and
  releases only proven unperformed reservation; abandoned work follows the same rule;
- missing/late/ambiguous actual duration or cost retains the unresolved reservation,
  delayed reconciliation cannot create fictitious capacity, and repeated reconciliation
  or provider evidence is idempotent;
- an execution overrun replaces its reservation with actual consumption and clamps later
  capacity at zero rather than erasing performed work;
- completed AM cannot relaunch; concurrent PM launches cannot double-reserve minutes or
  systemic cost; stale approval recomputes; unknown actual end cannot satisfy a required
  separation;
- new adverse symptoms defer/scale PM through common gates; missing post-AM confirmation
  remains pending; favorable response cannot automatically expand dose or reset ledger
  consumption;
- optional PM drops independently without replacement, while feasible bundle moves are
  atomic across both capacity dimensions and infeasible or started-bundle moves preserve
  completed history;
- Warsaw spring-forward nonexistent boundaries and fall-back ambiguous boundaries,
  plus actual elapsed intervals across an offset change;
- authored rest closes all windows, unplanned-date legacy fallback survives, event
  commitments count, and overrides remain visible and gated;
- immutable AM/PM audits independently replay; each altered identity/input binding is
  rejected; cross-user writes and invalid persisted window/ledger data are denied.

Add a dedicated execution scenario family exposing these inputs and outcomes before
judge evaluation. Run focused tests, full frontend checks/build, Firestore rules tests,
scenario simulation/diff and policy drift checks on implementation. This documentation
decision itself requires no production policy bump or runtime test run.

## Consequences

The chosen scope makes authored doubles reviewable without granting extra capacity from
labels or favorable readiness. It preserves ADR-0035 and existing session identity, but
requires a new import version, shared accounting, launch concurrency control and richer
replay snapshots. H4 design is complete; safe implementation still depends on rest-day
support and verified same-day canonical performed facts. H5 progression remains separate.
