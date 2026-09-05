# Cycling-primary hybrid: implementation handoff

**Status:** H1, H2, H2b, H3 and H3-rest (ADR-0035) all delivered; H4/H5 are next
**Blocked by:** H4/H5 both need a recorded design decision before implementation. Personal M00/M01 prescription needs current athlete inputs.
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

The current decision policy version is
`2026-09-authored-rest-day-v1`. See the evaluation plan for the root
cause, focused regression tests and required PR-head validation.

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

Suggested next step: move to H4 or H5 design -- both need a recorded authority/schema
decision before implementation, the same way ADR-0035 did. Keep that work separate from personal
M00/M01 prescription until current workload/restriction inputs are confirmed.

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
`firestore.rules` coverage. `POLICY_VERSION` is `2026-09-authored-rest-day-v1`.

**Explicit check-in override, fully audited.** `athleteOverridesAuthoredRest` never fires
from readiness data -- only an explicit same-day request. When it does, evaluation proceeds
exactly as if no rest directive existed (full normal ranking, every safety/clinical/
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
is capped at 26 entries (one per supported week) at both the TS validator and the Firestore
rules layer (`hasValidExternalRestDirectives`, which validates each of up to 26 directives'
shape -- `id`/`week`/`day` presence, week range, weekday vocabulary, and no unrecognized
field -- individually, since Firestore rules cannot loop).

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

**Status:** Ready for design; implementation depends on a recorded authority/schema decision
**Dependencies:** H3 authority contracts and the canonical performed-occurrence boundary.
**Deliverable:** One design decision, then separately scoped implementation/test changes.

Inspect `trainingCapacity.ts`, `weeklyDosePacking.ts`, `schedule.ts`,
`externalPlacement.ts`, `authoredSessionGates.ts`, and performed-training reconciliation.
The automatic packing inspected in H1 consumes one slot per date; do not mistake a
preferred AM/PM bundle's placement support for a complete intraday capacity model.

Specify ownership for window start/end, order, optionality, elapsed separation, remaining
minutes and cumulative load. Reuse the common eligibility/dose gates. Use Warsaw local
dates for calendar ownership and timestamps for elapsed intervals; test a DST boundary
when introducing elapsed-time behavior. Unknown start times cannot prove a separation.

Acceptance cases: completed AM cannot be duplicated; newly adverse PM symptoms can defer
PM; optional PM can be dropped independently; moving a bundle remains feasible; two
sessions cannot each independently consume the whole daily budget; provider and execution
records of one occurrence count once. Add a dedicated execution harness/family only when
it can expose these inputs and outputs honestly.

Do not define a universal clinical recovery-hour threshold as a scheduling convenience.
Persisted schema changes require backward-compatible read/validation handling and rules
tests; missing window metadata must not become invented capacity.

## Work order H5 — Block intent and controlled progression

**Status:** Ready for design; automatic personalization remains evidence-gated
**Dependencies:** H3 plus existing observation/outcome and knowledge-lineage contracts.
**Deliverable:** Explicit develop/maintain intent first; later bounded progression separately.

Inspect `TrainingIntentProfile`, `planSchedule.ts`, `planningMode.ts`, `coverage.ts`,
`observations/`, `outcomes/`, `athleteEvidence.ts` and `athleteEvidencePolicy.ts`.
Do not create another planner, injury authority, testing registry or outcome store.

Define block-owned objectives, protected sessions, acceptable substitutions, dose bounds,
chosen progression variable, entry/exit criteria and hold/reduce/redirect outcomes.
Retain the existing distinction between adaptation credit and exact programming roles.
Model historical expertise and recent tolerated exposure separately. Incomplete feedback
is uncertainty, not successful tolerance. Tests are sessions and consume time/load budget.

Acceptance cases: a fresh morning alone cannot increase the weekly commitment; an added
hard event replaces quality; a completed but poorly tolerated session does not earn
automatic progression; reduced strength dose can preserve a maintenance goal without
claiming new strength gains; a repeated test with changed protocol is not silently
comparable; personalized refinement never removes standing safety restrictions.

Initial outcome reports are observational. No physiological-effect claim, automatic
threshold relaxation, or judge-baseline promotion follows from a successful unit test.

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
