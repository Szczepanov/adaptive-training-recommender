# Cycling-primary hybrid evaluation and recommendation improvements

**Status:** In progress — H1, H2, H2b, H3 and H3-rest (ADR-0035) all delivered; H4 design
accepted as ADR-0036 with every design slice now delivered as code
(D-SCHEMA/D-LEDGER/D-TIME/D-WINDOW, D-PLACEMENT's engine plus its placement-correctness
wiring, D-REASSESS's `intradayReassessment.ts` (#442) and D-AUDIT's `intradayDecision.ts`
decision store (#443)) and issue #434's execution-binding pipeline delivered through PR 3
Phase 3 (#440, #445, #448, #450, #451, #454) and Phase 4 (#465) -- so a non-primary bundle
member is now adjudicated, reserved, surfaced as an `additionalSessions` binding, and
launchable when its verdict has a valid binding. Phase 5 now captures and persists the
post-AM `SessionResponse` completion facts, while multi-region tissue feedback remains in
the daily check-in as the canonical tissue authority. Only the
H4-specific Phase 6 policy work remains; dependent members still require the response and
separation checks before they become launchable. The broader ledger-based ranking/admission unification
and persistence of a bundle's resolved placement for display also remain; H5 design is
accepted as ADR-0037 with H5a/H5b delivered (H5c and cumulative `external-plan@5` unstarted).
**Blocked by:** Personal M00/M01 prescription requires current workload/restriction
confirmation; H4's live release is gated on PR 3 Phase 6, tracked in
[the PR 3 plan](./h4-434-pr3-bundle-second-member-launch.md). H4's remaining non-gating
work also needs its own decision-affecting PR(s): unifying `planner.ts`'s three ad hoc dedup
mechanisms onto the ledger's remainder/admission semantics as a real ranking input, and
persisting a bundle's resolved placement for display. The latter was previously blocked by
`firestore.rules`' per-request expression ceiling, but #468 reduced recommendation-audit
validation cost and closed #435, so it is now unblocked rather than complete. H5c needs the
athlete-scoped singleton progression-claim transaction design, and cumulative
`external-plan@5` acceptance is unblocked now that H4's v4 contract has landed.
**Unlocks:** Reproducible acceptance cases for equipment specificity, block authority and hybrid plan quality.

## Decision

For implementation, start with the bounded work orders and ready-to-use task prompt in
[the implementation handoff](./cycling-primary-hybrid-implementation-handoff.md).
This document remains the status and evidence record.

**Routing note for H4.** The handoff's H4 work order predates issue #434's execution-binding
pipeline and is retained for its H2/H2b/H3/H3-rest record and its still-accurate inventory of
the un-unified dedup mechanisms. For current H4 implementation work, read
[the PR 3 plan](./h4-434-pr3-bundle-second-member-launch.md) instead -- it is the
authoritative spec for the remaining Phase 6 policy transition.

Reuse the existing `cycling_primary_hybrid_advanced` persona. Add scenarios that exercise
distinct decisions and group them into focused judge families. Retain the existing seven
judge dimensions rather than adding a subjective "hybrid quality" score.

The athlete identity has a cycling performance priority, strength/muscle retention and
long-term sustainable activity. Sporting history does not override current tissue,
recovery, equipment or time constraints. Public fixtures are synthetic: no real identity,
medical timeline, measurements or actual event date is committed.

## H1 — Delivered coverage

`personaSuite.mjs` already contained five evergreen hybrid cases covering normal/adverse
recovery, local tissue conflict despite favorable wearables, today's strength preference,
and a short time window. These remain unchanged in the active 9-family/30-case suite.

`hybridScenarioFamilies.mjs` adds two opt-in families with seven cases, all using the same
persona identity and a matched synthetic 28-day history: 16 cycling exposures at 80 minutes
and eight strength exposures at 50 minutes, totaling 1,680 minutes (seven hours/week).
The history is identical across perturbations; available time and current capacity are
different inputs. The existing active history is not silently rewritten.

| Family | Cases | Decision under examination |
|---|---|---|
| `persona_hybrid_capacity_equipment` | Reference; 180-minute availability; 90-minute weekdays/20-minute weekend stress; outdoor bicycle without indoor bike | Does the plan respect actual windows/access while retaining useful cycling and strength? Does extra time invent additional capacity? |
| `persona_hybrid_event_lifecycle` | A-event build; same build/adverse recovery; explicitly authored 14-day taper | Does the same athlete enter the real structured cycling path, preserve supporting strength, tighten for recovery and honor the taper boundary? |

The 20-minute weekend is a deliberately binding stress perturbation, not a statement of
the athlete's normal weekend availability. The event and dates are synthetic. Race day is
outside the simulated taper horizon, so race participation is not being adjudicated here.

The opt-in command includes existing controls: **11 families / 37 cases**. It writes to a
separate gitignored directory so exploration cannot overwrite reviewed active-suite
artifacts or promote an unjudged baseline.

### Deterministic evidence versus AI judgment

Deterministic tests enforce fixture identity/history/commitment, branch reachability,
canonical road-race demand, equipment, effective duration caps on actual calendar dates,
binding weekend perturbation, event objectives and taper objective changes. Every new
case runs through `runScenario`, using the real planner.

The judge is responsible for qualitative hierarchy, sequencing and adequacy questions.
Only the seven opt-in H1 packets receive the additional authored-taper and training-settings
facts needed to judge those contracts; the existing 30 control packets retain the reviewed
active-suite judge-visible shape. Hidden optimizer scores remain excluded.
`deterministic-results.json` is a separate developer artifact; its modeled cost/stimulus
and objective diagnostics are not used as an answer key.

Repeated H1 judge samples cyclically rotate case presentation order. The strict response
schema is generated from that same per-sample order (including the ordered `prefixItems`
used by the local/Ollama adapter), then validation normalizes results back to canonical
case IDs before aggregation. This is a judge-reliability safeguard; it does not change
deterministic planner output.

This harness chains seven-day forecasts with synthetic completion. It is not a day-by-day
prospective athlete trial, an AM/PM execution simulator, a nutrition model, or evidence
that any intervention improves health/performance. Passing hard constraints is necessary
but not sufficient for a good program.

### Reproduced findings

1. **Outdoor-only cycling gap — fixed in H2.** The targeted outdoor-only case selected no
   Cycling across 14 forecast days despite outdoor bicycle access and the cycling-first
   identity, substituting Walking while resolving generic aerobic objectives. `end_easy_04`
   closes that catalogue/equipment gap without weakening indoor-bike or no-bike gates.
2. **More time does not alone escalate this fixture.** Reference and extra-time cases
   produced the same session choices/duration ranges in the recorded run. This is bounded
   evidence for one input family, not proof of general monotonicity or adequate training dose.
3. **Event build requires closer credit inspection.** The build report generated
   `race_specific_endurance` but reported zero fully resolved weeks of two. An unresolved
   fractional objective is not proof of zero event-specific sessions. Inspect delivered
   dose, exact coverage and typed allocation outcomes before changing any thresholds.
4. **Taper authority is reachable; taper efficacy is unproven.** The authored taper drops
   build threshold objectives. Aggregate duration ranges are not necessarily lower than
   this build fixture. There is no fixed historical pre-taper prescription here against
   which to validate a percentage reduction. H3 needs explicit authored-plan comparisons.
5. **Restricted time exposes a substitution question.** The binding weekend case can
   select short Field work. No impact restriction is present in that case, so this is not
   evidence of violating an injury gate. Judge its relevance to the cycling-first goal;
   separately retain the existing local-tissue case as the safety contract.

## H2 — Outdoor aerobic specificity (delivered)

**Dependencies:** H1 delivered; current recommendation architecture, workout-library
contracts and ADR-0004/0017 were reviewed before implementation.

`end_easy_04` (`app/src/engine/templates.ts`) is an Easy Endurance Cycling template
requiring `outdoor_bike` instead of `indoor_bike`, not event-gated. It reuses the existing
`cycling_zone2_standard_01` workout through `app/src/workouts/prescription.ts`: that workout
was already environment-agnostic (`indoor_or_outdoor`, generic `bike` equipment), so the
missing behavior was at the engine-template/equipment layer rather than the detailed
workout catalogue.

Three deterministic hybrid tests cover the outdoor-only positive path, the indoor path,
and a no-bicycle-access negative control. Safe outdoor cycling is now reachable without a
race; unavailable bicycle equipment is not fabricated; the general-health substitution
path remains available.

## H2b — Nominated anchor-date authority (delivered)

Adding a legal cheap outdoor Z2 candidate exposed a pre-existing ordering bug in
`triathlon_novice_eighth_A`: Race-Specific Endurance Cycling dropped from 3 sessions to 0
and event-specific anchor misses rose from 1 to 4 across the four-week simulation.

### Root cause

The first hypothesis was that fatigue-cost penalty overwhelmed `ANCHOR_ROLE_BOOST` and
`ANCHOR_TIMING_BENEFIT`. Source-level tracing showed the decisive issue occurred earlier in
the lexicographic ranking path.

`rankCandidates` sorts accepted candidates by `coverageNeedTier` before benefit/utility.
`coverageNeedTierForTemplate` correctly recognized the nominated `event-specific` or
`quality` role, but granted it tier 0 only while that role's **weekly minimum was still
unmet**. If an earlier exposure had already satisfied the weekly minimum, the explicitly
nominated anchor candidate lost date-level authority. A different still-unmet role such as
`aerobic_volume` could then receive a better coverage tier and win before fatigue cost or
anchor boosts were compared.

That behavior contradicted the coverage contract itself: an overdue/different role should
not steal an explicitly nominated hard anchor date. It also conflicts with the cycling
programming intent behind this evaluation, where easy volume supports rather than replaces
the small number of genuine key cycling days.

### Correction

`coverageNeedTierForTemplate` now treats a nominated anchor as a **date-level programming
role**, not merely a mechanism for repairing an unmet weekly minimum. When the active plan
contains the relevant requirement and a legal candidate exactly matches today's nominated
`outdoor_event_specific` or `sustained_quality` coverage key, that candidate retains tier 0
regardless of whether an earlier exposure already met the week's minimum.

This does **not** force unnecessary repeats on unclaimed dates. With `anchorRole === null`,
an already-met race-specific or quality role keeps its ordinary lower coverage tier and an
unmet easy-aerobic minimum can still take precedence. Safety, equipment, time, intensity,
fatigue/recovery and spacing constraints continue to run before coverage ordering.

A focused `coverageAnchorAuthority.test.ts` regression covers both `event-specific` and
`quality` anchors after their weekly minimum has already been met, and verifies the
unclaimed-date control so the fix cannot silently become "always prefer hard work".

`POLICY_VERSION` is now
`2026-09-outdoor-easy-cycling-anchor-authority-v1` because both the new outdoor candidate
and the corrected anchor ordering can change persisted recommendations. The prior
`2026-09-outdoor-easy-cycling-v1` is retained as historical.

### Validation expectation

Use the latest PR-head CI run as the authoritative validation record. In addition to the
focused unit and hybrid tests, run the full deterministic checks and scenario diff. The
specific H2b acceptance requirement is that the outdoor-bike-only triathlon scenario no
longer loses its explicitly nominated race-specific anchors while other scenario changes
remain either unchanged or explicitly explained. Do not regenerate the committed
simulation baseline merely to hide an unexplained diff.

## H3 — Executable block, deliberate rest and substitutions (investigated — no production defect found)

**Dependencies:** Reviewed near-term block; ADR-0019/0023 and existing import/occurrence
contracts. A user-specific load/impact prescription requires current-state confirmation.

### Investigation result

Each acceptance scenario from the implementation handoff was traced against the actual
`main` codebase (commit `a1685ec4`) rather than inferred from the original review prose.
The executable-session contracts are already implemented; this PR adds one focused
regression test where the prior evidence was too indirect:

1. **Genuinely unplanned date vs. externally-planned mode with a placed session.** Already
   distinct and labelled: `resolvePlanningContext` sets `externalFallback: true` only when
   the mode is selected but no session is placed for the date; the day-level evaluator
   labels the resulting catalog pick as a fallback. Covered by existing tests in
   `externallyPlannedMode.test.ts` (`resolves external only when a session is actually
   placed today`, `falls back and flags it when the mode is selected but no session is
   placed`, `still ranks a catalog pick when no session is placed today, and labels that
   fallback`, plus the ignored-mode control).
2. **A missed quality session with a later session already planned.**
   `externalPlacement.ts`'s `proposeReplacement`/`resolvePlacement` excludes occupied dates
   from replacement candidates, is proposal-only (never writes without confirmation), and
   honours each session's own `ifMissed` (`drop` / `reschedule_within_week` /
   `carry_forward`) rather than inventing catch-up debt. `externalPlacement.test.ts`
   includes `does not propose a day another session already holds` directly on point.
3. **An imported hard cycling event contributing enough typed stimulus to resolve a quality
   requirement.** `externalEventAsFixedActivity` derives typed `expectedStimulus` and an
   inferred-confidence external identity. `h3AuthoredPlanContracts.test.ts` exercises that
   adapter plus `applyFixedActivityStimulusCredit` and verifies the resulting projected
   credit resolves a `threshold_quality` objective when projected commitments are included.
   This closes the prior evidence gap in `externalEventFixedActivityCredit.test.ts`, which
   covered aerobic credit and qualification semantics only. The production evaluator in
   `rules.ts` currently performs the same fixed-activity credit step before `rankCandidates`,
   but this focused regression does **not** itself execute catalog ranking; ordering was
   source-reviewed rather than independently integration-tested here. This is also narrower
   than claiming every free-text "hard group ride" is equivalent: a non-event group ride
   must enter the typed `FixedActivity` identity/stimulus path to earn the same objective
   credit.
4. **Full and reduced session forms with correct minutes and immutable revisions.**
   Content-hash immutability (`contentHash` on `ExternalPlanContext`, verified against the
   stored revision) and reduced-dose scaling are exercised across
   `externalSession.test.ts`, `provenance.test.ts`, `replay.test.ts` and
   `externalPlanValidation.test.ts`.

No production decision logic needed changing for these executable-session scenarios.

### Open product question: explicit rest cannot currently be authored at all

The remaining scenario — an **explicitly prescribed rest date**, distinct from an
unplanned one — is a real capability gap, not a resolver defect. Both `external-plan@1`
and `external-plan@2` deliberately say "Rest days are not sessions"; omission is therefore
indistinguishable from "the plan says nothing about this day," which activates the labelled
catalog fallback.

This evaluation no longer uses external-product behavior as architecture evidence. The
rest-vs-unplanned requirement follows from the repository's own authored-instruction-vs-
absence semantics and immutable/versioned import contract; product observations, if
retained elsewhere, are non-normative research only.

**Follow-up architecture decision:** [ADR-0035](../adr/0035-explicit-rest-day-authoring.md)
(Accepted) decides a single compatibility model: protected rest is added only in
`adaptive-training-recommender/external-plan@3`, inheriting v2 session semantics unchanged,
through relative plan-level `restDays` directives (`{ id, week, day }`). v1/v2 remain
immutable and continue rejecting the new field. The ADR also separates plan intent from
readiness: authored rest blocks ordinary fallback/ranking and resolves the default planning
outcome to canonical Rest without fabricating a physiological `recover` verdict. Placement
and missed-session replacement must treat rest dates as blocked, while an explicit athlete
override remains auditable and still passes the normal safety/readiness/availability gates.

This PR intentionally does not implement that schema extension. Personal M00/M01 import
also remains blocked on current-workload/restriction confirmation.

## H4 — Intraday capacity and post-AM reassessment

**Status:** Design accepted in [ADR-0036](../adr/0036-intraday-training-windows-and-reassessment.md).
**D-SCHEMA, D-LEDGER, D-TIME and D-WINDOW delivered**; **same-day canonical
performed-fact boundary verified**; **D-PLACEMENT's bundle-placement engine delivered**
as a pure module, and its **placement-correctness wired** into
`activeExternalPlanService.ts`'s primary-session selection for v4 intraday bundles (real
`POLICY_VERSION` bump -- see the "D-PLACEMENT wiring" subsection below for exactly what
this does and does not activate). **D-REASSESS and D-AUDIT are also delivered** as pure
modules -- `engine/intradayReassessment.ts`'s `reassessDependentBundleMember` (#442) and
`engine/intradayDecision.ts`'s append-only decision store (#443) -- and issue #434's
execution-binding pipeline has since given them a live caller, through PR 3 Phase 4 (see
"Issue #434 execution-binding pipeline" below).

Still unstarted: the `dailyLedger.ts` refactor into `resolveAvailability`'s existing
deductions and `planner.ts`'s three ad hoc dedup mechanisms, recommendation-audit
persistence of a bundle's resolved placement for display, and the H4-specific Phase 6 policy
transition -- the last of which is what actually gates a live H4 release. Placement persistence was previously
blocked by the recommendation-audit rules-expression ceiling; #468 closed #435 by reducing
that evaluation cost, so it is now unblocked but not implemented.
**Dependencies:** ADR-0035 rest support (delivered). The `external-plan@4`/`dailyLedger.ts`
D-SCHEMA/D-LEDGER slice itself left `POLICY_VERSION` unchanged (neither module is
consumed by any decision path); the fixed-activity cost-reduce dedup slice bumped it
mechanically, per the drift gate's requirement, not because decision behavior actually
changed. The D-PLACEMENT wiring slice below is the first H4 slice to activate real new
decision behavior.

Decision: explicit athlete-owned windows, plan-owned sequencing in `external-plan@4`,
one shared daily minute/load ledger, and fresh post-AM reassessment before PM launch.
AM/PM labels do not prove capacity or elapsed recovery. v1/v2/v3 retain their contracts;
ADR-0035 is unchanged. Authored doubles ship first; automatic multi-window packing is a
separate follow-up after execution/accounting acceptance, without increased weekly dose.

The ADR records code evidence, alternatives, schema and authority contracts, optionality,
atomic bundle moves, launch concurrency, DST, audit/replay and deterministic acceptance.
Existing preferred bundles and authored remaining-budget handling are reused. Add a
separate execution family when the harness exposes the required facts; the current
one-session forecasts do not validate doubles.

### D-SCHEMA + D-LEDGER (delivered)

`sessions/externalPlanV4.ts` adds `external-plan@4`: the same envelope as v3 (inheriting
`restDays` unchanged) plus a session-level optional `intraday` object (`window`,
`bundleId`, `order`, `afterSessionId`, `minimumSeparationMinutes`), following the ADR's
D-SCHEMA sketch. Validation is structural/reference-only -- HH:mm format and positive
same-day duration, bundle membership agreement (`week`/`preferredDay`/`flexibility`), unique
order, no overlapping requested windows, no dangling/forward/cyclic `afterSessionId`, no
required session depending on an optional predecessor, and no intraday session date
conflicting with an authored rest directive. It does not resolve requested windows
against real availability (D-TIME) and is not wired into placement or any decision.

`engine/dailyLedger.ts` implements D-LEDGER's remainder/reconciliation math as a pure,
timestamp-agnostic module: `computeDailyLedger` (dedupes by occurrence identity/highest
revision, clamps each of minute/systemic-cost remainders at zero independently, reports
unresolved entries), `admitsCandidate` (spare minutes never substitute for exhausted cost
capacity or vice versa) and `reconcileEntry` (idempotent under stale/duplicate/replayed
evidence, never erases a reservation on overrun). It is not yet wired into
`schedule.ts`'s `resolveAvailability`/`calculateReservedCapacityProfile` or the other
fixed-activity cost/stimulus reduces in `planner.ts`/`rules.ts` -- that refactor is the
next H4 step once the same-day canonical-fact boundary is verified.

`externalPlanV4.test.ts` and `dailyLedger.test.ts` cover the ADR's deterministic list for
this slice, including the worked example (a 90-minute daily ceiling with 60-minute AM
completion leaves at most 30 minutes for PM even though both windows individually offer
90 minutes) and the exhausted-systemic-cost-blocks-admission case. `simulate:diff` and
policy-drift show no change from this slice, confirming it is inert until wired.

### D-TIME (delivered)

`engine/localInstant.ts` implements D-TIME as a pure, timestamp-only module:
`resolveLocalInstant(dateStr, timeStr, timeZone = 'Europe/Warsaw')` resolves a local
wall-clock date/time to a real instant with an explicit offset, rejecting calendar-invalid
`dateStr` values and returning `'nonexistent'` for a spring-forward gap or `'ambiguous'`
(both candidate instants) for a fall-back fold rather than silently choosing an offset;
`elapsedMinutesBetweenInstants` computes elapsed minutes between two resolved instants.
`localInstant.test.ts` verifies real 2026 DST transitions in three zones, including two
review rounds that caught and fixed real bugs (a calendar-invalid-date acceptance bug and
a DST-offset-discovery bug that only manifested for zones far from UTC -- see the module's
own header comment for why the offset-sampling window is centered on a rough estimate
rather than the naive instant). The module was initially unwired when this slice landed;
it is now consumed by D-PLACEMENT's separation checks.

### D-WINDOW (delivered, model only)

Investigated first, per the ADR's own instruction: is PR #428's `ScheduleOverlay`
(`engine/models.ts`, `services/scheduleOverlayService.ts`) the "athlete's versioned
schedule" D-WINDOW requires? No -- `ScheduleOverlay` is a date-*range* absence/trip model
(a single `dailyAvailabilityMinutes` number plus dose-scaling multipliers feeding
`applyPlanningOverlays`), with no clock-time start/end, no stable window id, and no
support for more than one window per date. D-WINDOW needs exactly what that lacks: a
stable window id, local start/end times, an optional label, and per-window
equipment/environment restrictions, with **multiple same-date windows** as the whole
point (AM/PM). No such model existed anywhere in the codebase before this slice, and
`resolveAvailability` (`schedule.ts`) still models a single per-date minute budget with no
window/clock-time concept -- confirmed by reading it, not assumed.

`engine/models.ts`'s new `ScheduleWindow` interface is that model: `id`, `userId`, `date`
(Warsaw-local `YYYY-MM-DD`), `startLocal`/`endLocal` (`HH:mm`), optional `label`/
`equipment`/`environment`, and a `revision` bumped on every update. `engine/scheduleWindows.ts`
is the pure validation/resolution module: `validateScheduleWindow` (per-document shape,
same-day positive-duration `HH:mm` interval, rejecting cross-midnight spans -- an
overnight opening must be split at midnight, matching `externalPlanV4.ts`'s `intraday`
window rule), `validateScheduleWindowSet` (cross-window non-overlap *within* a date,
correctly scoped so windows on different dates are never compared against each other),
and `resolveScheduleWindowsForDate` (returns `[]` for a date with no windows -- the
supported legacy case: callers must keep today's single untimed-slot behavior rather than
treating an empty result as "no availability", per D-WINDOW: "missing metadata never
creates an AM and PM pair"). Issue #430 replaced the former sibling-document layout with
the authoritative `users/{userId}/schedule_window_manifests/{YYYY-MM-DD}` document.
`ScheduleWindowService` transacts that one document for every create, update, date move,
and delete, so Firestore retries a concurrent writer against the current full window set.
The manifest deliberately permits at most eight windows: `firestore.rules` cannot iterate
an arbitrary list, but can validate all eight entries and all 28 pairs, including a direct
SDK write. The rules deny writes to the retired `schedule_windows` sibling collection,
require document revisions to increase exactly one per mutation, and preserve manifest
creation time. The service retains each surviving window's stable id and increments its
own revision on update. Invalid or unavailable manifests, and any retired sibling
documents awaiting explicit migration, are fail-closed: they never become the empty legacy
slot in D-PLACEMENT. Emulator tests prove overlapping concurrent
creates/moves and direct-write bypasses are rejected.

Recurring availability ("Recurring availability is resolved to dated instances by the
app", D-WINDOW) is intentionally deferred: this slice only models and persists
already-dated window instances. A future recurring-template resolver can add
`ScheduleWindow` instances without changing this file's contract, since every downstream
consumer (D-PLACEMENT included) only ever sees resolved, dated windows.

D-PLACEMENT subsequently wired these windows into bundle placement. `scheduleWindows.test.ts`,
`scheduleWindowService.test.ts`, and Firestore-rules emulator cases cover validation,
overlap detection, legacy-empty resolution, and the persisted shape/ownership/revision
contract.

Note: PR #428 ("typed schedule overlays and planned absences") merged the same day as
D-WINDOW and now feeds `ScheduleOverlay`'s `dailyAvailabilityMinutes`/cost/equipment into
`resolveAvailability`'s single per-date budget. This is unrelated to and does not conflict
with `ScheduleWindow` -- `ScheduleOverlay` still has no clock-time concept, so it narrows
the *whole day's* ceiling that D-PLACEMENT's engine (below) treats as its ledger input,
while `ScheduleWindow` is what supplies the day's individual clock-time slots.

### D-PLACEMENT's bundle-placement engine (delivered, pure module; placement-correctness wiring below)

`engine/intradayBundlePlacement.ts` resolves one v4 intraday bundle's requested windows
against real `ScheduleWindow` availability, checks the combined minute/systemic-cost
budget via `dailyLedger.ts`, respects ADR-0035 rest and fixed commitments, and computes
scheduled separation from D-TIME's resolved instants. It exposes an atomic
confirmed-proposal API analogous to `externalPlacement.ts`'s
`proposeReplacement`/`applyConfirmedProposal`, but for whole same-date bundles:

- `proposeBundlePlacement(bundleId, date, members, scheduleWindows, fixedActivities, restDates, ledger)`
  returns either `{ outcome: 'placed', bindings }` -- one `ResolvedWindowBinding` per
  member, in `order` -- or `{ outcome: 'infeasible', reason }`. It never returns a partial
  placement: "if the whole proposal cannot fit, explain the conflict and leave placement
  unchanged" (ADR). Each unstarted member's requested window is intersected against the
  date's real windows (picking the one with the greatest overlap, excluding windows
  already consumed by an earlier member or blocked by a fixed commitment); ledger
  admission is evaluated sequentially in `order` so an earlier member's consumption
  correctly reduces what a later member can draw from the same day's shared ceiling; a
  dependent's scheduled separation from its predecessor is checked via
  `resolveLocalInstant`/`elapsedMinutesBetweenInstants` on the *resolved window*
  boundaries. A date with no persisted `ScheduleWindow`s falls back to one synthetic
  whole-day slot, so a bundle needing two or more windows there is infeasible rather than
  fabricating an AM/PM pair from missing metadata.
- `dropOptionalBundleMember(members, sessionId)` is the athlete's explicit action to drop
  one optional, not-yet-started member before re-proposing the remainder -- never
  automatic, and never carries dropped work forward.
- `confirmBundlePlacement(proposal)` is the sole athlete-confirmation boundary,
  mirroring `applyConfirmedProposal`; it throws on an infeasible proposal rather than
  confirming a partial one.

A member that has already started (`started: true`) always carries its own
`existingBinding` through unchanged and keeps its window consumed for the rest of the
bundle -- "once a member starts, do not move its history" (ADR). The focused placement
tests cover the ADR's deterministic cases, including separation, legacy-slot behavior,
rest/fixed-activity conflicts, started-member preservation and DST handling.

### D-PLACEMENT wiring: placement-correctness only (delivered)

Scope decided explicitly with the repo owner after investigation surfaced that "wire the
bundle engine into `evaluateTrainingWithIntent`" split into two very differently-sized
tasks. First, plural same-day placement did not imply independent execution. Second, the
external-plan `SessionReferenceBinding` path did not yet exist at that time; issue #434
subsequently built it through PR 3 Phase 4.

`activeExternalPlanService.ts`'s `resolveIntradayBundlePlacement` detects a v4 intraday
bundle placed on a date, builds `IntradayBundleMember[]` from the plan's sessions and calls
`proposeBundlePlacement`. `placedSessionForDate` and `externalPlanContextForDate` gained an
optional `bundleContext`; when supplied and the bundle resolves feasibly, the bundle's
earliest-`order` member becomes the day's primary session rather than a priority guess.
`Home.tsx` supplies schedule-window/ledger context. PR 3 Phases 1-4 later added persisted
occurrence/window reservations, the date-level ledger aggregate, non-primary adjudication,
display and atomic launch.

Surfacing the bundle's *resolved binding data* for display in recommendation audit was
attempted and reverted in the original placement-wiring PR because an extra optional-field
check exceeded Firestore's per-request rules-expression ceiling. That was a real emulator
failure and correctly blocked the change at the time. It is no longer a current blocker:
PR #468 reduced recommendation-audit evaluation cost and closed #435. The resolved placement
is still not persisted, however, so a follow-up must reintroduce the field with schema,
rules, replay and expression-budget coverage rather than treating #468 as implementation of
the feature itself.

### Same-day canonical performed-fact boundary (verified)

`getPerformedTrainingFactsInRange`'s only caller (`trainingIntent.ts`) always passes
today's own date as the exclusive `toDateExclusive` boundary, so today is currently
excluded from every canonical-facts read the recommendation engine performs -- this was
the literal blocker named above. Investigation traced the full pipeline
(`training-occurrence/repository.ts`, `reconciliationService.ts`,
`engine/performedTrainingFacts.ts`) and found same-day identity/dedup already correct
and already tested: `reconciliationService.ts`'s candidate matching runs a `+-1
local-day` window with no wall-clock/"is this today" special-casing, and existing
`reconciliationService.test.ts` fixtures already exercise same-day auto-link and
same-day ambiguity. The missing mirror-direction case was added so same-day dedup is proven
both ways.

The one real gap was narrower than the blocker's original phrasing suggested: it was
purely the read-boundary convention, not a defect in hydration. `getPerformedTrainingFactsInRange`
itself has no date-relative assumption that data must be historical; passing tomorrow's
date as the exclusive boundary already correctly includes and hydrates today's
occurrence. `getPerformedTrainingFactsThroughToday`
(`training-occurrence/performedTrainingFactsService.ts`) makes that an explicit,
correctly-named function. It is not called from any production/decision path yet.

### Fixed-activity cost-reduce duplication unified (delivered)

`schedule.ts`'s `calculateReservedCapacityProfile`, `planner.ts`'s
`fixedActivityCostProfileForDate` (also used by `externalCritique.ts`), and `rules.ts`'s
`unrepresentedFixedActivityProjection` each hand-wrote the same six-dimension
`WorkoutCostProfile` reduce over `FixedActivity.expectedCost`. `engine/fixedActivityCostProfile.ts`'s
`sumFixedActivityCostProfiles` now supplies that reduce once; every call site keeps its
own existing date/completion filtering, so behavior is unchanged. Verified byte-identical
via `simulate:diff`. `POLICY_VERSION` was bumped mechanically because the drift gate could
not prove semantic equivalence for the restructured call sites.

The three different ad hoc dedup mechanisms across these sites (`seenOccurrences` in
`applyFixedActivityStimulusCredit`, `appliedFixedCostOccurrences`/
`appliedProjectionOccurrences` in `generateWeekAheadPlan`, and the decision-trace delta
in `unrepresentedFixedActivityProjection`) are **not yet unified** onto the ledger's
`occurrenceId`/`revision` model, and none of these call sites yet consult
`computeDailyLedger`'s remainder or `admitsCandidate` when ranking or admitting a
candidate. D-PLACEMENT's own placement-correctness wiring is delivered. The execution-
binding pipeline and D-REASSESS/D-AUDIT now have live wiring through PR 3 Phase 4; using
the ledger's remainder/admission semantics as a real ranking/admission input across these
three call sites remains separate decision-affecting work.

### Issue #434 execution-binding pipeline (delivered through PR 3 Phase 4)

The external-plan `SessionReferenceBinding` execution-binding pipeline -- identified above
as a separate multi-PR foundational project -- has been built as
[issue #434](https://github.com/Szczepanov/adaptive-training-recommender/issues/434):

| PR | Commit | Delivered |
|---|---|---|
| [#440](https://github.com/Szczepanov/adaptive-training-recommender/pull/440) | `c9cc402f` | PR 1 -- v4 primary session bound to the source-neutral launch path |
| [#445](https://github.com/Szczepanov/adaptive-training-recommender/pull/445) | `99a7638f` | PR 2 -- external-plan occurrence tracking |
| [#448](https://github.com/Szczepanov/adaptive-training-recommender/pull/448) | `ee6d132b` | PR 3 Phases 1-2 -- D-WINDOW per-window exclusivity, atomic re-import supersession, `intradayLedgerInputs.ts`, the persisted `daily_ledgers` reservation aggregate |
| [#450](https://github.com/Szczepanov/adaptive-training-recommender/pull/450) | `eddacc09` | PR 3 Phase 3 foundations -- unified `ReassessmentInputRevision`, decision-record predecessor identity, transaction-composable decision writes |
| [#451](https://github.com/Szczepanov/adaptive-training-recommender/pull/451) | `7399ec31` | PR 3 step 8 item 2a -- reject/recovery generation counters |
| [#454](https://github.com/Szczepanov/adaptive-training-recommender/pull/454) | `9f42db1e` | PR 3 Phase 3 -- `services/intradayBundleMemberAdjudication.ts` and its `Home.tsx` wiring |
| [#465](https://github.com/Szczepanov/adaptive-training-recommender/pull/465) | `a87d9d1c` | PR 3 Phase 4 -- `AdditionalSessionsCard`, atomic launch claim, rollback, and launch verification |

**What this activates:** a placed v4 bundle's non-primary member is now reassessed per
D-REASSESS, has its verdict persisted per D-AUDIT, holds (or releases) a real reservation
against the day's ledger aggregate, is emitted as an `additionalSessions` binding from
`Home.tsx`, and can be started when the verdict is `proceed` with a valid binding. The
launch path atomically validates the persisted decision and ledger state, claims the
occurrence, and rolls both claims back if execution start fails.

**What it does not yet activate:** the H4-specific Phase 6 policy transition is still open;
the current global policy version has since advanced for ADR-0038/recovery-calibration work,
but that does not constitute the H4 launch-policy bump.

**What remains:** PR 3 Phase 6 --
[the PR 3 plan](./h4-434-pr3-bundle-second-member-launch.md) is the authoritative spec.
Phase 4 is delivered in #465 and Phase 5 in #470. Phase 5 records the post-AM
`immediate` `SessionResponse`, extends the completion sheet with
`completedFraction`/`unexpectedFatigue`, and preserves the confirmation evidence linkage;
Phase 6 bumps `POLICY_VERSION` from the then-current
global value and archives that value. This is the gate on a live H4 release.

## H5 — Explicit develop/maintain intent and progression

**Status:** Design accepted in [ADR-0037](../adr/0037-block-intent-and-controlled-progression.md).
**H5a (intent contracts + canonical replay) and H5b (report-only progression review)
delivered** in `engine/blockIntent.ts`/`blockIntentReplay.ts`/`progressionReview.ts`,
per the implementation handoff's H5 work order. H5c (athlete-confirmed bounded
revisions) and cumulative `external-plan@5` are unstarted.
**Dependencies:** H5c needs the athlete-scoped singleton progression-claim transaction
design. `external-plan@5` acceptance depends on the landed H4 v4 contract, which has
landed.

Decision: per-objective `develop | maintain` intent is separate from priority and profile
commitment. Use existing plan, dose, coverage, response and outcome authorities. New import
authority belongs in `external-plan@5`; earlier schemas remain unchanged. Maintenance is
an intended outcome, not a default dose discount or an assertion of preserved performance.

H5a's delivered `engine/blockIntent.ts` is not wired into `external-plan@5` import yet
(the ADR's own note: "manual intent and report-only groundwork does not require H4
runtime release" applied only to the manual-authoring path H5a/H5b actually deliver).
H5b's `engine/progressionReview.ts` is report-only and not consulted by daily
recommendation selection; `POLICY_VERSION` is unchanged by either. H5c (athlete-confirmed
bounded revisions) is the remaining work: one active progression experiment changes one
variable within reviewed bounds, missing/adverse follow-up blocks advancement, outcome
reports retain no automatic selection authority, and hold/reduction/redirect remain
explicit alternatives. The ADR owns the complete compatibility, substitution, evidence,
confirmation and replay acceptance bar.

## Reproduction and verification

From `app/`:

```bash
npm exec vitest run scripts/ai-judge/__tests__/hybridScenarios.test.mjs
npm exec vitest run src/engine/coverageAnchorAuthority.test.ts
npm exec vitest run src/engine/h3AuthoredPlanContracts.test.ts
npm run persona:hybrid:build
npm run check
npm run build
npm run simulate:scenarios
npm run simulate:diff
node scripts/check-policy-drift.mjs <starting-commit>
```

Use the latest PR-head CI run as the authoritative full validation rather than copying a
stale test-count snapshot into this document. The focused hybrid regression suite, full
frontend checks, deterministic corpus gates, Firestore rules, simulation bounds, bundle
build and dependency audits should remain green before merge. The opt-in corpus remains
**37 cases / 11 families**; the default active suite remains **30 cases / 9 families**.
Existing knowledge coverage warnings, if any, are not new physiological validation results.

For optional local judging, use the `--hybrid-expansion` runner flag documented in
`app/scripts/ai-judge/README.md`. Review actual cases behind every complaint before
promoting any new active cases. Existing baseline update/diff commands intentionally
remain scoped to the unchanged active suite.

H1 did not change engine behavior and therefore required no policy bump. H2/H2b were
decision-affecting. H3's new test was non-decision-affecting; explicit-rest behavior had
its own policy transition. H4's fixed-activity dedup bump reflected the drift gate's
mechanical requirement, while `h4-intraday-bundle-placement-v1` was H4's first real behavior
change. PR 3 Phase 4 did not itself perform the final H4 policy transition because dependent
members still lack the Phase-5 post-AM evidence. The remaining H4 policy change must start
from the **then-current** global `POLICY_VERSION` (currently
`2026-09-recommender-recovery-calibration-v1` on `main` at `78a2e11`), not from an obsolete
H4 id. H4's ledger-based ranking/admission wiring and H5c will each require normal policy
review when they actually change decision behavior. Do not enable experimental
personalization simply to improve a judge score.
