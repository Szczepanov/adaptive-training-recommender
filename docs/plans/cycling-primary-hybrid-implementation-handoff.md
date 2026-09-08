# Cycling-primary hybrid: implementation handoff

**Scope note:** This document supplies **bounded implementation work orders**; the
[evaluation plan](./cycling-primary-hybrid-evaluation.md) owns H1-H5 status. For H4 release
history and current follow-ups, read [the PR 3 plan](./h4-434-pr3-bundle-second-member-launch.md) --
the H4 work order below predates issue #434's execution-binding pipeline and is retained for
its record of what was investigated, not as a task list.
**Status:** H1, H2, H2b, H3 and H3-rest (ADR-0035) all delivered; H4 design accepted as
ADR-0036 with every design slice (D-SCHEMA, D-LEDGER, D-TIME, D-WINDOW, D-PLACEMENT,
D-REASSESS, D-AUDIT) delivered as code and issue #434's execution-binding pipeline delivered
through PR 3 Phase 6, including the cumulative H4 `POLICY_VERSION` transition; ledger-based
ranking/admission is still not a decision input anywhere; H5 design accepted as ADR-0037
with H5a (intent contracts, canonical replay) and H5b (report-only progression review)
delivered (H5c confirmed revisions and cumulative `external-plan@5` unstarted)
**Blocked by:** Nothing blocks starting any remaining item. H4's live release is delivered.
H5c (confirmed bounded revisions, with the athlete-scoped singleton
progression claim) and cumulative `external-plan@5` with `intentBlocks` are both ready to
start, and are independent of H4's non-gating follow-ups. Personal M00/M01 prescription needs
current athlete inputs.
**Unlocks:** A cycling-first recommendation path that preserves feasible strength, respects equipment and time, and supports authored blocks without inventing capacity.

## Start here

Read `AGENTS.md`, `docs/README.md`, then the
[evaluation plan](./cycling-primary-hybrid-evaluation.md). That plan owns the H1–H5 status
and findings; this document supplies bounded implementation work orders. Read the living
recommendation architecture and the relevant ADR before changing decision behavior.
Code takes precedence over old audits and implemented plans.

The evaluation fixtures and runner are already implemented. Do not rebuild them. The
default persona suite is unchanged (9 families / 30 cases); opt-in hybrid evaluation
adds seven cases (11 families / 37 cases including controls).

H2 is delivered: `end_easy_04` gives outdoor-bike-only athletes a real easy Cycling option
without requiring a focus event. H2b is also delivered: the new candidate exposed a
pre-existing anchor-date ordering bug in `coverageNeedTierForTemplate`, and the fix now
keeps an explicitly nominated `event-specific` or `quality` role at coverage tier 0 even
when an earlier exposure already satisfied that role's weekly minimum. On unclaimed dates,
the ordinary coverage ordering is unchanged, so an already-met hard role does not force
unnecessary repeats.

Phase 6 archived the then-current
`2026-09-simulation-sequence-occupational-context-v2` policy and activated
`2026-09-h4-intraday-bundle-member-launch-v1`. Future policy work must still read
`app/src/engine/policy.ts` rather than assuming this value remains current. See the
evaluation plan for the root cause, focused regression tests and required PR-head validation.

H3 was investigated and its executable contracts are delivered (see the work orders below
and the evaluation plan). The unplanned-date fallback, missed-session replacement,
imported-event quality credit, full/reduced immutable-session contracts, and explicit-rest
authoring are implemented. Existing evidence was sufficient for the first three of those;
the focused H3 contract coverage added `h3AuthoredPlanContracts.test.ts` because the prior
event-credit test only proved aerobic credit and was too indirect for the specific
quality-credit claim. H3-rest intentionally introduced the production decision behavior
required by ADR-0035 rather than leaving explicit rest as an unresolved schema question.

The former H3 explicit-rest gap is now closed. [ADR-0035]
(../adr/0035-explicit-rest-day-authoring.md) (Accepted) is **delivered** (work order
H3-rest below): `external-plan@3` adds relative plan-level `restDays` directives
(`{ id, week, day }`) while keeping v1/v2 immutable, and keeps readiness separate from
plan intent -- authored rest blocks ordinary generated work and resolves the default
planning outcome to canonical Rest rather than fabricating a physiological `recover`
verdict.

H4's authority/schema design is the accepted ADR-0036 proposal
(`docs/adr/0036-intraday-training-windows-and-reassessment.md`). Read that artifact rather
than reconstructing its v4 contract from discussion context. Its v4 artifact has landed, so
cumulative `external-plan@5` import acceptance now has a real contract to build against.

H4 PR 3 is complete through Phase 6; see
[the PR 3 plan](./h4-434-pr3-bundle-second-member-launch.md). The remaining H4 work is
non-gating follow-up: planner-wide ledger remainder/admission unification and persistence of
resolved bundle placement for display/audit. H5c (ADR-0037 confirmed bounded revisions) is
independently startable. Keep all of those separate from personal M00/M01 prescription until
current workload/restriction inputs are confirmed.

## Stable product intent

- Cycling development is the primary sport objective during cycling-focused blocks.
- Strength and muscle retention are real secondary objectives, with dose adapted to phase.
- General athleticism and sustainable lifelong activity matter; running, soccer and impact
  are optional and depend on current capacity/restrictions.
- Equipment ownership, schedule availability, prior sporting skill, recent completed work,
  tolerated work and future training ambition are different facts.
- Airbike conditioning is not automatically equivalent to bicycle preparation or bicycle FTP.
- Favorable wearable values never override active symptoms or standing restrictions.
- More available hours do not prove greater tolerated workload. Extra quality sessions,
  dieting and impact progression are not automatic consequences of a new calendar block.
- Easy aerobic volume is supporting work; it must not displace an explicitly authored key
  cycling role merely because it is cheaper in fatigue cost.

These are product requirements, not new numerical physiological thresholds. The public
fixture uses anonymous synthetic inputs. Do not copy private medical histories, real
measurements or personal local documents into source control.

## Work order H2 — Outdoor aerobic specificity (delivered)

**Status:** Delivered.

`end_easy_04` is a non-event-gated Easy Endurance Cycling template requiring
`outdoor_bike` and reusing `cycling_zone2_standard_01`. Three deterministic hybrid tests
cover the outdoor-only positive path, the indoor path and no-bike negative control.

## Work order H2b — Nominated anchor-date authority (delivered)

**Status:** Delivered.
**Deliverable:** Focused coverage-ordering correction plus regression tests.

### What was actually wrong

The initially suspected utility/fatigue-coefficient problem was downstream of the decisive
ordering step. Accepted candidates are sorted lexicographically by `coverageNeedTier`
before benefit/utility. `coverageNeedTierForTemplate` gave the nominated anchor tier 0 only
when its weekly minimum remained unmet. Once an earlier session fulfilled that minimum, a
different unmet role such as `aerobic_volume` could outrank the explicitly nominated
anchor before `ANCHOR_ROLE_BOOST`, `ANCHOR_TIMING_BENEFIT` or fatigue-cost comparison even
participated.

### Implemented contract

When the active plan contains the nominated coverage requirement and a legal candidate
matches today's `outdoor_event_specific` or `sustained_quality` role, it receives tier 0
regardless of whether that role's weekly minimum was met earlier. Hard feasibility,
readiness, injury, time, equipment, intensity and spacing gates still run before this
ordering.

When there is no nominated anchor, the behavior is unchanged: an already-met race-specific
or quality role does not force a repeat, and unmet supporting coverage can take precedence.

`coverageAnchorAuthority.test.ts` protects both `event-specific` and `quality` cases and
includes the unclaimed-date control. Do not replace this role authority with shared
magic-number tuning unless the underlying ordering contract is intentionally redesigned.

### Completion validation

Use PR-head CI as the authoritative record. Run the focused coverage test, hybrid scenario
tests, `npm run check`, `npm run build`, `npm run simulate:scenarios`,
`npm run simulate:diff`, and policy drift validation. Do not regenerate a committed
simulation baseline merely to hide an unexplained change.

## Work order H3 — Authored block authority, rest and replacement (delivered)

**Status:** Delivered and contract-tested. Explicit-rest authoring is delivered separately
under H3-rest/ADR-0035 below. Personal prescription still pending inputs.
**Dependencies:** Existing external-plan/session infrastructure.

Read ADR-0019/0023/0035 and the session-execution architecture. Route through
`planningMode.ts`, `externalPlacement.ts`, `externalSession.ts`,
`sessions/externalPlanV2.ts`, `sessions/externalPlanV3.ts`, `authoredSessionGates.ts`,
`sessionOccurrenceService.ts` and `Home.tsx`. Existing preferred double-day bundles,
authored remaining-budget handling, and explicit protected-rest dates are delivered
capabilities, not missing features.

**Verified executable contracts:**

- unplanned dates fall back to the catalog and are explicitly labelled as external-plan
  fallback (`externallyPlannedMode.test.ts`);
- missed-session proposals respect occupied dates, authored protected-rest dates, and
  per-session `ifMissed`; only a confirmed proposal mutates placement
  (`externalPlacement.test.ts`);
- imported hard cycling events are reconciled to `FixedActivity`, retain inferred
  external-authored stimulus identity, and can contribute enough projected stimulus to
  resolve a `threshold_quality` objective when projected commitments are included
  (`h3AuthoredPlanContracts.test.ts`; the older `externalEventFixedActivityCredit.test.ts`
  still covers confidence discount and qualification refusal). The production evaluator
  currently applies fixed-activity credit before `rankCandidates`, but this focused test
  covers the credit/resolution layer rather than executing catalog ranking itself;
- full/reduced dose and immutable revision/replay behavior remain covered by
  `externalSession.test.ts`, `provenance.test.ts`, `replay.test.ts` and validation tests;
- `external-plan@3` distinguishes authored protected rest from a genuinely unplanned day;
  v1/v2 remain unchanged and continue to reject `restDays`.

Do not broaden the event test into a claim that every free-text "hard group ride" is
interchangeable with quality. Equivalent replacement requires the ride to enter the typed
`FixedActivity` identity/stimulus path; otherwise qualified objective credit correctly
fails closed.

## Work order H3-rest — Explicit rest-day authoring (delivered)

**Status:** Delivered. `external-plan@3` (`src/sessions/externalPlanV3.ts`) with relative
`restDays` directives, occupancy blocking in `externalPlacement.ts`, a dedicated
`authoredRestRecommendation` path in `rules.ts` (canonical Rest, `mode` left as the genuine
readiness verdict rather than forced to `'recover'`, an `athleteOverridesAuthoredRest`
escape hatch), `ExternalRestProvenance` persistence/audit/replay
(`models.ts`/`provenance.ts`/`replay.ts`'s fail-closed `externalRestErrors`), and matching
`firestore.rules` coverage. That release used policy id `2026-09-authored-rest-day-v1`;
`app/src/engine/policy.ts` is authoritative for the current global version.

**Explicit check-in override, fully audited.** `athleteOverridesAuthoredRest` never fires
from readiness data -- only an explicit same-day request. Production recognizes two
routes to that explicit request: the boolean parameter itself, or a non-empty
`readiness.subjective.preferredModalityToday` answer on that same day's check-in --
typing a specific workout request is itself treated as asking to train instead of resting
(`rules.ts`'s `athleteRequestedWorkoutOnRest`). Favorable readiness/wearable data alone
never triggers either route. When either fires, evaluation proceeds exactly as if no rest
directive existed (full normal ranking, every safety/clinical/
availability/equipment/readiness gate applies), but the persisted `externalRest` provenance
still names the directive that was present and adds an `overridden: true` marker
(`externalRestProvenance.ts`'s `ExternalRestDecisionProvenance`). Replay branches on that
marker: an overridden decision replays through the ordinary ranked-decision checks
(`authoredOccurrenceDecisionErrors`), not the canonical-Rest/empty-candidates checks a
default authored-rest decision requires. `firestore.rules` mirrors the same branch --
`candidateScores` and `templateId` are unconstrained precisely when
`audit.externalRest.overridden == true`, otherwise the default authored-rest constraints
(empty candidates, `templateId == 'rest_01'`) still apply; `overridden` is only ever
accepted as the literal `true`.

**Storage bounds aligned end to end.** A rest directive `id` is bounded to 64 characters at
import validation (`externalPlanV3.ts`), matching the bound `firestore.rules` already
enforced on the persisted `externalRest.restDirectiveId` -- a directive that passed import
could previously exceed the audit's own bound and fail to persist later. `restDays` itself
is capped at up to 26 directives across the plan (not one per week -- the TS validator
allows multiple directives in the same week as long as their `(week, day)` pairs differ,
and rejects duplicate pairs) at both the TS validator and the Firestore rules layer
(`hasValidExternalRestDirectives`, which validates each of up to 26 directives' shape --
`id`/`week`/`day` presence, week range, weekday vocabulary, and no unrecognized field --
individually, since Firestore rules cannot loop).

The import authoring prompt now emits `external-plan@3`, requires `restDays` (an empty list
is valid), spells out relative `{ id, week, day }` semantics and explicitly distinguishes
protected rest from an omitted/unplanned day. This prevents the product's own published
prompt from continuing to generate v2 documents that cannot author the new capability.

**Deferred, not attempted:** multi-day forecast/critique-layer rest awareness (the
`D-CRITIQUE` "review the imported week" surface in `planner.ts` is separate from this
ADR's single-day resolver contract) and dedicated UI rendering of `restDays` in the import
preview/diff views (`ExternalPlanImport.tsx`/`externalPlanDiff.ts` type-check against the
widened `AnyExternalTrainingPlan` union but do not yet render rest-specific content).
Neither changes recommendation behavior, so neither blocks this work order being complete.

Validation: use the PR-head checks as the authoritative record. Required coverage includes
`npm run check`, `npm run build`, `npm run test:rules`,
`npm run simulate:scenarios`/`simulate:diff`, and policy-drift validation. Focused regression
coverage now also includes malformed v3 rest directives, fully occupied weeks, external
provenance mutual exclusion, and Firestore authored-rest storage invariants. Do not keep
fixed test-count numbers in this handoff because focused regression additions legitimately
change them.

For a personal M00/M01 artifact, first confirm representative current workload, current
restrictions/symptoms and actual bicycle setup. The prior review's example week is an
illustration, not authorization to infer clinical clearance or import a live prescription.
Useful synthetic software work can proceed without those personal answers.

## Work order H4 — Intraday windows and post-AM response

> **Superseded for implementation.** This work order was written before issue #434's
> execution-binding pipeline existed and its numbered steps below no longer describe the
> work that remains. Read
> [`h4-434-pr3-bundle-second-member-launch.md`](./h4-434-pr3-bundle-second-member-launch.md)
> for the authoritative current spec (Phase 6). What is still worth reading here: step 2's
> **inventory of the three un-unified ad hoc dedup mechanisms**, which remains accurate and
> is still an open H4 task.

**Status:** Design accepted in [ADR-0036](../adr/0036-intraday-training-windows-and-reassessment.md).
By capability, **every ADR-0036 design slice is now delivered as code**: D-SCHEMA,
D-LEDGER (pure module), D-TIME, D-WINDOW, D-PLACEMENT's engine
(`engine/intradayBundlePlacement.ts`) plus its placement-correctness wiring into
`activeExternalPlanService.ts`'s primary-session selection, D-REASSESS
(`engine/intradayReassessment.ts`, #442) and D-AUDIT (`engine/intradayDecision.ts`, #443);
the same-day canonical performed-fact boundary is verified. The external-plan
`SessionReferenceBinding` execution-binding pipeline -- called out below as a separate
multi-PR foundational project -- became issue #434 and is delivered through PR 3 Phase 6
(#440, #445, #448, #450, #451, #454, #465, #470, #472), giving D-REASSESS/D-AUDIT a
launchable non-primary member, post-AM response evidence, and the cumulative H4 policy
transition through the source-neutral execution path.

Still outstanding: unifying `planner.ts`'s three ad hoc dedup mechanisms onto the ledger's
remainder/admission semantics
as a real ranking/admission input; and persisting a bundle's resolved placement for display.
The placement-display work was previously blocked by Firestore's per-request rules-expression
ceiling; #468 reduced recommendation-audit evaluation cost and closed #435, so that work is
now unblocked but remains unimplemented and non-gating for PR 3.
**Dependencies:** ADR-0035 rest support (delivered). Same-day canonical performed
identity/revision/timing inputs are verified (see below); D-TIME, D-WINDOW, D-PLACEMENT and
the #434 pipeline through PR 3 Phase 6 are all delivered.
**Deliverable:** Authored intraday placement and reassessed execution, followed separately
by automatic multi-window packing after the initial acceptance bar passes.

The accepted implementation sequence below is numbered by planned PR, not by capability --
step 1's schema landed first, D-WINDOW's athlete-schedule model (also part of step 1's
scope) landed in a later, separate PR after step 2's ledger module, and D-TIME (not its
own numbered step) landed between them. Read the **Status** line above for current
capability delivery; do not infer from a step's number alone whether everything named in
its description has actually shipped.

1. **Schema delivered; athlete schedule windows delivered separately (see below).**
   Version `external-plan@4` intraday placement; keep v1/v2/v3 immutable. `sessions/externalPlanV4.ts` adds the session-level
   `intraday` object (window/bundleId/order/afterSessionId/minimumSeparationMinutes) on
   top of v3's unchanged envelope/`restDays`, validating intervals, bundle
   membership/order/dependency shape, and rejecting invalid references -- see the
   evaluation plan's H4 section for the full delivered-contract list. Cross-version
   revision ordering/supersession reuses the existing `ExternalPlanService` dispatch
   (now including v4) unchanged. `sessions/externalPlanV4.test.ts` covers the ADR's
   schema-level deterministic cases.
2. **Ledger delivered as a pure module. The duplicated six-dimension cost reduce is
   now unified; using the ledger's remainder/admission semantics for actual ranking
   decisions is still the next task.** `engine/dailyLedger.ts` implements one daily
   ledger's remainder/reconciliation math (`computeDailyLedger`, `admitsCandidate`,
   `reconcileEntry`), covered by `engine/dailyLedger.test.ts` including the ADR's
   90-minute-ceiling/60-minute-AM worked example and the exhausted-systemic-cost case.
   `engine/fixedActivityCostProfile.ts`'s `sumFixedActivityCostProfiles` now replaces the
   three near-identical inline reduces in `schedule.ts`'s
   `calculateReservedCapacityProfile`, `planner.ts`'s `fixedActivityCostProfileForDate`
   (also used by `externalCritique.ts`), and `rules.ts`'s
   `unrepresentedFixedActivityProjection` -- a pure duplication-removal refactor, each
   call site's own date/completion filtering left untouched, verified byte-identical via
   `simulate:diff` (no new drift) and the full test suite (`POLICY_VERSION` bumped
   because the gate can only mechanically prove comment-only equivalence, not semantic
   equivalence across a restructured call site -- not because output actually changed).
   **Not yet done:** the three still-separate ad hoc dedup mechanisms
   (`seenOccurrences` in `applyFixedActivityStimulusCredit`,
   `appliedFixedCostOccurrences`/`appliedProjectionOccurrences` in
   `generateWeekAheadPlan`, and the decision-trace delta in
   `unrepresentedFixedActivityProjection`) are not yet unified onto the ledger's
   `occurrenceId`/`revision` model, and none of these call sites yet consult
   `computeDailyLedger`'s remainder or `admitsCandidate` when ranking/admitting a
   candidate -- D-LEDGER's remainder-based admission is not yet a decision input
   anywhere. Resolving real windows and reserving minutes/cost against actual instants
   also needs D-TIME (delivered, see below) and D-WINDOW (delivered, see below).

   **D-TIME delivered.** `engine/localInstant.ts`'s `resolveLocalInstant`/
   `elapsedMinutesBetweenInstants` resolve Warsaw-local wall-clock times to real instants
   with explicit offsets, rejecting calendar-invalid dates and surfacing (never silently
   resolving) spring-forward-gap and fall-back-fold local times. Verified against real
   2026 DST transitions in three zones; two review rounds caught and fixed real bugs (a
   calendar-invalid-date acceptance bug and a far-from-UTC offset-discovery bug). The pure
   module is now consumed by D-PLACEMENT's bundle-separation checks; the historical note
   that it was initially unwired refers only to its landing slice.

   **D-WINDOW's athlete-schedule model delivered.** Investigated first, per the
   ADR: PR #428's `ScheduleOverlay` is a date-range absence/trip model with a single daily
   minutes number, not the same-date-multi-window model D-WINDOW requires -- confirmed by
   reading its diff and `schedule.ts`'s `resolveAvailability` (no window/clock-time
   concept exists anywhere in that legacy path). `engine/models.ts`'s new `ScheduleWindow`
   (stable id, Warsaw-local date, `startLocal`/`endLocal` HH:mm, optional label/equipment/
   environment, a `revision` bumped on update) plus `engine/scheduleWindows.ts` (pure
   per-document and cross-window-non-overlap validation, `resolveScheduleWindowsForDate`
   returning `[]` for the legacy single-untimed-slot case) and
   `services/scheduleWindowService.ts` (`users/{userId}/schedule_windows/{windowId}`,
   rejecting an overlapping create/update client-side -- a best-effort, non-atomic check;
   Firestore's client transactions cannot read an arbitrary query, so this cannot fully
   close the race against concurrent writers, and full enforcement needs a trusted server
   boundary, out of scope here) are the delivered contract. `firestore.rules` validates
   per-document shape/ownership/revision-increase/`createdAt`-immutability (including
   each `equipment` item's own type/length, not just the list's size), mirroring
   `hasValidFixedActivity`. Recurring-template resolution to dated instances is
   deliberately deferred to a future slice; only already-dated window instances are
   modeled here, which is all D-PLACEMENT needs to consume.
3. **Delivered as a pure module; placement-correctness wired (see below).**
   `engine/intradayBundlePlacement.ts` adds atomic, confirmed bundle
   placement against all destination `ScheduleWindow`s and ADR-0035 rest, using
   D-LEDGER's remainder/admission math (sequentially per member, so an earlier member's
   consumption reduces what a later one can draw from the same day) and D-TIME's
   elapsed-instant semantics for a dependent's *scheduled* separation from its
   predecessor (not an actual performed timestamp -- that recomputation is D-REASSESS,
   not this step). `proposeBundlePlacement` never returns a partial placement; a date
   with no persisted `ScheduleWindow`s falls back to one synthetic whole-day slot, and
   since at most one occurrence binds to any one slot, a bundle needing two or more
   windows there is correctly infeasible rather than fabricating an AM/PM pair.
   `dropOptionalBundleMember` is the athlete's explicit, non-automatic drop action and
   preserves the "no required session depends on an optional predecessor" invariant;
   `confirmBundlePlacement` is the sole confirmation boundary and writes nothing (no
   persisted recommendation-audit bundle-binding field exists yet).
   `intradayBundlePlacement.test.ts` covers the ADR's D-PLACEMENT-relevant deterministic
   cases, including a real argument-order bug in the `elapsedMinutesBetweenInstants` call
   (`start - end`, not `end - start`) that its own separation tests caught before merge.
   When it landed, this engine was not wired into `evaluateTrainingWithIntent`;
   `POLICY_VERSION` was unchanged and `simulate:diff`/policy-drift confirmed no output
   change. Its placement-correctness wiring landed separately (see below).

   **Placement-correctness wiring: delivered.** Scoped explicitly with the repo owner
   after investigation split "wire the bundle engine into `evaluateTrainingWithIntent`"
   into two very differently-sized tasks: even v1-v3 "double days" already collapse to
   one visible session today (`placedSessionForDate`'s existing priority tie-break, and
   `externalPlanContextsForDate`'s own doc comment warning against treating plural
   placement as evidence of independent adjudication), and -- more fundamentally --
   `SessionSourceRef`'s `kind: 'external_plan'` variant was declared but not constructed
   anywhere at that point. Issue #434 subsequently built that execution-binding pipeline,
   including a launchable non-primary member through Phase 4.

   `activeExternalPlanService.ts`'s `resolveIntradayBundlePlacement` builds
   `IntradayBundleMember[]` from a date's placed v4 sessions (reusing
   `authoredSessionGates.ts`'s `estimateAuthoredSessionSystemicCost`/
   `SessionDefinition.duration` for cost/duration) and calls `proposeBundlePlacement`.
   `placedSessionForDate`/`externalPlanContextForDate` gained an optional `bundleContext`
   parameter: when supplied and the bundle resolves feasibly, the earliest-`order` member
   becomes primary instead of a priority guess. `Home.tsx` supplies the schedule-window and
   ledger context. PR 3 Phases 1-4 later added persisted occurrence/window reservations,
   the `daily_ledgers` aggregate, non-primary adjudication, display and atomic launch.

   Surfacing the bundle's resolved binding in recommendation audit for display was attempted
   and reverted in the earlier placement slice because even a minimal optional-field check
   exceeded Firestore's per-request rule-evaluation ceiling. That statement is now
   **historical**: #468 reduced recommendation-audit evaluation cost and closed #435. The
   field has not yet been reintroduced, so persistence still needs its own schema/rules/
   replay PR, but rule headroom is no longer its blocker.
4. At PM launch, capture current symptoms/response, same-day work and availability, rerun
   common gates, and atomically validate the input/ledger revision before reserving.
   A morning PM approval is provisional; missing prerequisite evidence remains pending.
   The launch/claim portion was delivered in PR 3 Phase 4; post-predecessor confirmation
   capture was delivered in Phase 5 (#470).
5. Persist independent immutable intraday decisions and replay snapshots, show provisional,
   pending, dropped and completed states, and implement the ADR's deterministic test matrix.
   D-AUDIT persistence and the Phase-4 launch snapshot are delivered; completion-response
   evidence was delivered in Phase 5 (#470).
6. Run focused tests, full frontend checks/build, Firestore rules, simulations/diff and
   policy drift validation. Phase 6 completed the required `POLICY_VERSION` transition from
   the then-current global value in #472. Introduce an execution scenario family only when
   it can represent the required inputs and outputs.

Read ADR-0036 for the binding contract and full acceptance bar. This work does not add a
universal recovery-hour threshold, automatically increase weekly dose, or authorize H5
progression. Automatic packing must later reuse the same ledger/window boundaries;
adding duplicate date slots to `packWeeklyDose` is not a valid implementation.

**Same-day canonical performed-fact boundary: verified.** Investigation traced the full
pipeline (`training-occurrence/repository.ts`, `reconciliationService.ts`,
`engine/performedTrainingFacts.ts`) and found same-day identity/dedup already correct
and already tested -- `reconciliationService.ts`'s candidate matching runs a `+-1
local-day` window with no wall-clock/"is this today" special-casing, and existing tests
already covered same-day auto-link and same-day ambiguity in both source orders (a new
`'structured-first, Garmin arrives later'` case was added to close the one missing
mirror direction). The real gap was purely the read-boundary convention:
`getPerformedTrainingFactsInRange`'s only production caller (`trainingIntent.ts`)
always passes today as the exclusive boundary, so today was structurally excluded from
every canonical-facts read -- not a hydration defect, since the function itself has no
date-relative assumption that data must be historical.
`getPerformedTrainingFactsThroughToday` (`training-occurrence/performedTrainingFactsService.ts`)
now makes "through today, inclusive" an explicit, correctly-named function rather than
relying on callers to remember the pass-tomorrow-as-exclusive trick.
`performedTrainingFactsService.sameDay.test.ts` proves same-day hydration (structured,
Garmin, and both-sourced) with `startedAt`/`endedAt` intact for later D-TIME use, plus a
pinning test confirming `getPerformedTrainingFactsInRange`'s existing behavior and
`trainingIntent.ts`'s call site are unchanged.

D-PLACEMENT's placement-correctness wiring and issue #434's execution-binding pipeline
through Phase 6 are delivered. Remaining H4 work therefore separates into two independent,
non-gating tracks: (a) unifying `planner.ts`'s remaining ad hoc dedup /
remainder-admission paths onto D-LEDGER as a real ranking input; and (b) recommendation-audit
persistence of resolved bundle placement for display, now unblocked by #468/#435 but still
unimplemented. Do not resurrect the older roadmap that placed the execution-binding pipeline
or D-REASSESS/D-AUDIT after D-PLACEMENT; those have already landed.

## Work order H5 — Block intent and controlled progression

**Status:** Design accepted in [ADR-0037](../adr/0037-block-intent-and-controlled-progression.md).
**H5a and H5b delivered** (`engine/blockIntent.ts`, `engine/blockIntentReplay.ts`,
`engine/progressionReview.ts`); H5c and cumulative `external-plan@5` unstarted.
**Dependencies:** H5c needs the athlete-scoped singleton progression-claim transaction
design. `external-plan@5` import depends on the concrete inherited v3/v4 contracts;
ADR-0036's v4 artifact has landed, so it is a real dependency to build against rather
than a discussion-context reconstruction.
**Deliverable:** H5a explicit intent, H5b report-only review, H5c confirmed bounded revisions.

1. **H5a — Intent contracts (delivered).** `engine/blockIntent.ts` provides explicit
   per-objective `develop | maintain` intent and typed objective priority, typed dose
   envelopes and coverage-role vocabulary, protected roles, bounded substitution rules,
   prospective success criteria, entry prerequisites and exit criteria, a Phase-1
   progression-variable registry (`duration_min -> minutes`), and fail-closed validation
   (source-plan identity/revision, calendar dates, review timing, finite bounds,
   unit/envelope compatibility, substitution qualification, prerequisites, duplicate
   IDs, per-plan block overlap). `engine/blockIntentReplay.ts` builds the
   `treatment_intent_replay_v1` canonical SHA-256-hashed projection, pinning source plan
   identity/revision/provenance, the evaluated `TrainingIntentProfile` snapshot, block
   interval/review timing, and every H5a/progression-rule field; presentation-only
   fields are excluded and non-finite numbers are rejected rather than silently
   collapsing to JSON `null`. `blockIntent.test.ts`/`blockIntentReplay.test.ts` cover
   the deterministic/replay-mutation matrix, including fixtures that mutate `priorities`
   and each `weeklyCommitment` field independently and confirm replay fails closed.
   Read the actual delivered code and its ADR references rather than re-deriving the
   contract from this summary alone.
2. **H5b — Evidence review (delivered).** `engine/progressionReview.ts` derives only
   `advance_proposal | hold | reduce_proposal | redirect`, report-only, and fails closed
   on evidence identity: authored observation-window lower bound, dedup by canonical
   `performedOccurrenceId`, exact target-role coverage or a proven exact substitution,
   a pinned current-prescription match (same variable/unit/value/source revision),
   follow-up counted only from joined target evidence, adverse/caution safety evidence
   still applied from partial/mismatched attempts, missing follow-up blocks advancement,
   full frozen evaluation-reference matching, authored trend/prerequisites/max-duration/
   end-of-block redirect enforcement, and no implicit "N bad responses" redirect
   threshold. `progressionReview.test.ts` covers this. Not wired into daily
   recommendation selection; `POLICY_VERSION` unchanged.
3. **H5c — Confirmed revision (design notes; unstarted).** Show concrete before/after dose and affected future work.
   Confirmation must revalidate source revisions, safety and capacity and atomically create
   one new authored revision. Enforce the one-confirmed-active-experiment-per-athlete rule
   with an athlete-scoped singleton claim/sentinel acquired in the same Firestore transaction
   (or equivalent serializable compare-and-set) as activation; never query then create across
   blocks. Stale/repeated confirmation cannot apply an increment twice. Release uses matching
   compare-and-clear semantics so stale cleanup cannot erase a newer claim. Outcome reports
   remain outside automatic engine selection; no unattended progression.
4. **Verification.** Implement ADR-0037's complete deterministic matrix, immutable replay,
   user isolation/rules and architecture boundary tests. Replay fixtures must mutate each
   semantic binding (including source identity/revision, effective bounds, intent, protected
   roles, substitution rules, success criteria, review timing, prerequisites and progression
   rules) and prove a digest/mismatch failure. Also prove canonical ordering stability and
   display-only exclusion. Concurrency tests must run competing confirmations in parallel and
   prove exactly one activation, idempotent same-proposal retries, stale-source rejection,
   stale-release protection and no orphan claim/partial revision after transaction failure.
   Run focused tests, full frontend checks/build, rules, simulations/diff and policy drift
   checks with behavior changes. Preserve intraday evidence when H4 applies; do not collapse
   AM/PM decisions into a daily reporting row. Keep active judge baselines unchanged unless
   separately evaluated.

A reduced maintenance prescription is a process target; physiological preservation needs
suitable comparable outcome evidence. Do not fabricate strength/muscle metrics, convert
airbike results into bicycle performance, or enable experimental personalization to improve
a judge score. Personal M00/M01 prescriptions still require current athlete inputs.

## Evaluation discipline and handoff completion

Use existing judge dimensions: safety/recovery fit, goal/event fit, sequencing,
periodization/taper, preference/capacity fit, robustness and overall quality. Add families
for distinct controlled comparisons, not a new persona for every constraint.

Run deterministic checks before using local/provider judging. When judging is useful,
use the documented targeted runner; inspect the actual case behind every complaint.
The targeted artifacts are separate from active baseline promotion. No external API or
local model is required to reproduce H2/H2b/H3 contract tests. Provider credentials or
model setup should not block deterministic implementation.

At each work-order finish, update status, replace fixed problem statements with outcomes,
record evidence and leave a precise next task. Keep each behavior change reviewable and
avoid combining catalogue repair, persistence redesign and experimental physiology in one PR.
