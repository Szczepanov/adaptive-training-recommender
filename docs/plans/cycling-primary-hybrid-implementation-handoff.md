# Cycling-primary hybrid: implementation handoff

**Status:** Ready for H2; later stages have the dependencies below
**Blocked by:** None for H2 reproduction and outdoor aerobic specificity. H3 personal prescription needs current athlete inputs; H4/H5 implementation needs explicit architecture decisions recorded in the repository.
**Unlocks:** A cycling-first recommendation path that preserves feasible strength, respects equipment and time, and supports authored blocks without inventing capacity.

## Start here

Read `AGENTS.md`, `docs/README.md`, then the
[evaluation plan](./cycling-primary-hybrid-evaluation.md). That plan owns the H1–H5 status
and findings; this document supplies bounded implementation work orders. Read the living
recommendation architecture and the relevant ADR before changing decision behavior.
Code takes precedence over old audits and implemented plans.

The evaluation fixtures and runner are already implemented. Do not rebuild them. The
default persona suite is unchanged (9 families / 30 cases); opt-in hybrid evaluation
adds seven cases (11 families / 37 cases including controls). No live recommendation
policy has been changed for this effort. No AI-judge scores have been obtained or promoted.

Suggested first task prompt:

> Implement H2 from docs/plans/cycling-primary-hybrid-implementation-handoff.md. First
> reproduce the outdoor-only hybrid case through the current planner and trace why it
> selects no cycling. Make the smallest complete catalog/coverage/eligibility change
> that provides safe outdoor aerobic cycling without an event. Preserve equipment,
> recovery and injury gates. Add positive and negative regression coverage, run the
> required validation, update policy/replay metadata if behavior changes, and reconcile
> the H2 status and findings. Do not start H3–H5 in the same change.

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

These are product requirements, not new numerical physiological thresholds. The public
fixture uses anonymous synthetic inputs. Do not copy private medical histories, real
measurements or the personal Downloads documents into source control.

## Work order H2 — Outdoor aerobic specificity

**Status:** Ready
**Dependencies:** H1 is delivered; no personal measurements or external judge required.
**Deliverable:** One focused behavior change with tests and a reviewed simulation diff.

### H2.1 Reproduce before editing

From `app/`:

```bash
npm exec vitest run scripts/ai-judge/__tests__/hybridScenarios.test.mjs scripts/ai-judge/__tests__/personaScenarios.test.mjs
npm run persona:hybrid:build
```

Inspect `artifacts/hybrid-persona-plan-judge/latest/corpus.json` for the case
`persona_cycling_hybrid_outdoor_only` and compare it to
`persona_cycling_hybrid_capacity_reference`. Inspect `deterministic-results.json`
separately for developer diagnostics. If the current code no longer reproduces zero
Cycling, explain the intervening behavior and replace the stale finding with current evidence.

Trace the actual candidates and packing for the exact fixture through:

- `app/src/engine/templates.ts`, especially `end_easy_01` and outdoor cycling candidates;
- `app/src/engine/eligibility.ts` and `periodization.ts` for hard/phase gating;
- `app/src/engine/evergreenStrategy.ts`, `weeklyDosePacking.ts` and `coverage.ts`;
- `app/src/workouts/catalog/cycling-base.ts`, workout adapters and `prescription.ts`.

Use the catalog routing in `docs/workout-library.md`; discover the current template-to-
workout mapping instead of guessing its filename. Check both authored and effective
duration, role qualification and actual equipment at each boundary.

### H2.2 Implement the smallest coherent correction

Prefer an explicit outdoor aerobic identity through the existing catalog and coverage
contracts if that is the smallest valid design. A shared bicycle capability is an
alternative only if it preserves indoor/outdoor feasibility and does not silently weaken
requirements. Do not remove `indoor_bike` from the indoor template, lift event gating from
race-specific workouts, or increase generic Walking credit to hide the missing cycling.

Keep authored template identity stable when dose is reduced; materialize effective dose
through existing prescription/adjustment boundaries. Equipment is a hard gate, while
modality preference only ranks valid choices. Do not promote broad conditioning into
exact race-specific coverage.

### H2.3 Acceptance matrix

| Input | Required result |
|---|---|
| Outdoor bicycle, no indoor bicycle, evergreen hybrid, normal recovery | Some useful outdoor aerobic Cycling is selected across the fixture horizon; no race is invented |
| No bicycle access | No bicycle-dependent prescription; a feasible alternative or explicit shortfall |
| Indoor-only bicycle access | Existing indoor cycling remains feasible; no outdoor-only requirement is bypassed |
| Short window | Effective prescribed duration fits the actual date's cap |
| Adverse recovery or local restrictions | Existing tightening remains effective; new outdoor workout cannot bypass it |
| General-health athlete | Transferable aerobic alternatives remain available; no forced sport specialization |
| Event-directed cycling | Existing event-specific role identity, dose and taper behavior remain intact |

Assert actual selected prescriptions, not only that a template exists or that the engine
does not crash. Do not demand a particular number of cycling sessions unless that number
is backed by the active plan contract. Safety tests passing alone does not close H2.

### H2.4 Verification and completion

Run focused tests, `npm run build`, `npm run simulate:scenarios`, and
`npm run simulate:diff` from `app/`. Inspect relevant scenario changes; do not regenerate
the committed simulation baseline merely to make a failure disappear. Rebuild the hybrid
corpus and compare every new case, including equipment/time negative controls.

Capture the starting Git commit before editing. For a decision-affecting change, update
`POLICY_VERSION` and historical-policy/replay handling according to the current repository
contract, then run `node scripts/check-policy-drift.mjs <starting-commit>` from `app/`.
Add replay coverage appropriate to the actual change. Firestore rule/emulator tests are
required if persistence validation changes, not for a catalog-only fix.

Mark H2 implemented only when outdoor selection is demonstrated, negative controls pass,
and the simulation diff is explained. Update the evaluation plan's reproduced finding so
it no longer reads as an open defect. Report changes, validation and remaining limitations.

## Work order H3 — Authored block authority, rest and replacement

**Status:** Ready for synthetic contract investigation; personal prescription pending inputs
**Dependencies:** Existing external-plan/session infrastructure; H2 is not required for
read-only investigation. Do not couple a discovered rest defect to the outdoor catalog PR.
**Deliverable:** Small contract-focused changes, split from any personal plan import.

Read ADR-0019/0023 and the session-execution architecture. Route through
`planningMode.ts`, `externalPlacement.ts`, `externalSession.ts`,
`sessions/externalPlanV2.ts`, `authoredSessionGates.ts`, `sessionOccurrenceService.ts`
and `Home.tsx`. Existing preferred double-day bundles and authored remaining-budget
handling are delivered capabilities, not missing features.

First determine how explicit rest is currently represented. The known fallback is an
external mode with **no placed session** resolving to evergreen; this does not prove
that a correctly represented rest session is broken. Create separate fixtures for:

1. A genuinely unplanned date, with labeled fallback.
2. An explicitly prescribed rest date.
3. A missed quality session with a later quality session already planned.
4. A race/hard group ride replacing quality rather than being added to it.
5. Full and reduced session forms with correct actual minutes and immutable revisions.

Fix only demonstrated authority problems through the existing resolver. Acceptance:
planned rest remains rest, unplanned dates retain their intended fallback, missed work
does not create automatic catch-up debt, and the persisted audit can identify/replay the
actual source and revision. Cover import validation and persistence rules if their schemas
change. Test safety after replacement; calendar placement alone is insufficient.

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
local model is required to reproduce H2. Provider credentials or model setup should not
block deterministic implementation.

At each work-order finish, update status, replace fixed problem statements with outcomes,
record evidence and leave a precise next task. Keep each behavior change reviewable and
avoid combining catalog repair, persistence redesign and experimental physiology in one PR.
