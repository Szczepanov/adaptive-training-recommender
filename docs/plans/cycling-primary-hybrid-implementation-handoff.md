# Cycling-primary hybrid: implementation handoff

**Status:** H1, H2 and H2b delivered; H3 investigated and contract-tested with no production defect found — explicit-rest authoring recorded as ADR-0035 (Proposed), awaiting repository-owner decision; H4/H5 are next
**Blocked by:** ADR-0035 needs repository-owner sign-off before explicit-rest implementation. H4/H5 implementation needs explicit architecture decisions recorded in the repository. Personal M00/M01 prescription needs current athlete inputs.
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
`2026-09-outdoor-easy-cycling-anchor-authority-v1`. See the evaluation plan for the root
cause, focused regression tests and required PR-head validation.

H3 was investigated (see the work order below and the evaluation plan). The unplanned-date
fallback, missed-session replacement, imported-event quality credit, and full/reduced
immutable-session contracts are implemented. Existing evidence was sufficient for three of
those; this PR adds `h3AuthoredPlanContracts.test.ts` because the prior event-credit test
only proved aerobic credit and was too indirect for the specific quality-credit claim.
No production decision logic changed.

The remaining H3 gap is explicit rest: neither external-plan schema can distinguish
"protected rest" from "no authored instruction for this date."
[ADR-0035](../adr/0035-explicit-rest-day-authoring.md) (Proposed) recommends adding that
authority only in `external-plan@3`, using relative plan-level `restDays` directives
(`{ id, week, day }`) while keeping v1/v2 immutable. It also keeps readiness separate from
plan intent: authored rest blocks ordinary generated work and resolves the default planning
outcome to canonical Rest rather than fabricating a physiological `recover` verdict. It is
awaiting the repository owner's decision; no code changes yet.

Suggested next step: get a decision on ADR-0035, or move to H4/H5 design. Both routes
should remain separate from personal M00/M01 prescription until current workload/
restriction inputs are confirmed.

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

## Work order H3 — Authored block authority, rest and replacement (investigated)

**Status:** Investigated and contract-tested. No production decision-logic change made.
Explicit-rest authoring remains a schema/authority decision. Personal prescription still
pending inputs.
**Dependencies:** Existing external-plan/session infrastructure.

Read ADR-0019/0023 and the session-execution architecture. Route through
`planningMode.ts`, `externalPlacement.ts`, `externalSession.ts`,
`sessions/externalPlanV2.ts`, `authoredSessionGates.ts`, `sessionOccurrenceService.ts`
and `Home.tsx`. Existing preferred double-day bundles and authored remaining-budget
handling are delivered capabilities, not missing features.

**Verified executable contracts:**

- unplanned dates fall back to the catalog and are explicitly labelled as external-plan
  fallback (`externallyPlannedMode.test.ts`);
- missed-session proposals respect occupied dates and per-session `ifMissed`, and only a
  confirmed proposal mutates placement (`externalPlacement.test.ts`);
- imported hard cycling events are reconciled to `FixedActivity`, retain inferred
  external-authored stimulus identity, and can contribute enough projected stimulus to
  resolve a `threshold_quality` objective when projected commitments are included
  (`h3AuthoredPlanContracts.test.ts`; the older `externalEventFixedActivityCredit.test.ts`
  still covers confidence discount and qualification refusal). The production evaluator
  currently applies fixed-activity credit before `rankCandidates`, but this focused test
  covers the credit/resolution layer rather than executing catalog ranking itself;
- full/reduced dose and immutable revision/replay behavior remain covered by
  `externalSession.test.ts`, `provenance.test.ts`, `replay.test.ts` and validation tests.

Do not broaden the event test into a claim that every free-text "hard group ride" is
interchangeable with quality. Equivalent replacement requires the ride to enter the typed
`FixedActivity` identity/stimulus path; otherwise qualified objective credit correctly
fails closed.

### Explicit-rest follow-up decision

Neither `external-plan@1` nor `external-plan@2` can represent an explicitly prescribed
rest day. Both schemas intentionally define rest as omission, so the current resolver has
no fact that can distinguish protected rest from an unplanned date.

**Status: recorded as [ADR-0035](../adr/0035-explicit-rest-day-authoring.md) (Proposed),
awaiting repository-owner decision.** The implementation contract, if accepted, is:

1. add protected rest only in `adaptive-training-recommender/external-plan@3`, inheriting
   v2's `definition`-based session contract unchanged; v1/v2 validators remain immutable
   and continue rejecting the new field;
2. represent rest as relative plan-level `restDays` directives (`{ id, week, day }`) so
   `startDate` remains the sole authored absolute date; reject duplicate/out-of-range or
   fixed-session-conflicting directives;
3. treat resolved rest dates as blocked targets for `any_day` placement and missed-session
   replacement;
4. resolve external-plan dates as `session` / `rest` / `unplanned` before fallback; only
   `unplanned` activates `externalFallback: true`;
5. keep `evaluateReadinessAndSafetyEnvelope` independent: authored rest suppresses ordinary
   generated work and resolves the default planning outcome to canonical Rest without
   rewriting a `train`/`modify` readiness verdict to physiological `recover`;
6. permit only an explicit, auditable athlete override of the authored-rest planning gate;
   requested work still passes normal safety, clinical, availability, equipment and
   readiness constraints;
7. persist/replay `planId`, plan revision, content hash, rest-directive id and resolved
   plan-local date, with an authored-rest reason/source distinct from both physiological
   `recover` and `externalFallback`;
8. update import validation, Firestore/rules, UI and `POLICY_VERSION` coverage because the
   accepted directive changes recommendation behavior.

Do not begin implementation until the ADR is accepted. External-product calendar behavior
is not part of the architecture rationale; the decision follows from this repository's own
authored-instruction-vs-absence semantics and versioned immutable import contract.

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
