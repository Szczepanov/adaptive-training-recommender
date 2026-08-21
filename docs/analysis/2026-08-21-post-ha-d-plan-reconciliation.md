# Post-HA-D plan reconciliation

**Date:** 2026-08-21
**Scope:** `docs/plans/` status against current `main` after HA-D merge
**Purpose:** point-in-time audit of what is actually actionable after PR #171; this document does not create new recommendation authority.

## Executive status

The repository is no longer primarily blocked on missing architecture. The core roadmap through Phase 8 is implemented, Phase 9's candidate machinery is built default-off, Multidomain's active product chain through M5.3 is delivered, and OV's engineering path through OV6.1 is merged. The remaining roadmap is dominated by operational/prospective evidence gates and deliberately-triggered capabilities.

One canonical-plan status changed after the last reconciliation: **HA-D / HA5 merged to `main` in PR #171 on 2026-08-21**. The current `docs/plans/README.md` and HA plan still describe HA5 as unmerged, so those lines are stale relative to code. HA6.1–HA6.3 are now the next unblocked HA implementation increment. HA6.4 remains an evidence-volume decision rather than work to start by default.

## Findings

### R1 — HA5 is implemented; HA6.1–HA6.3 are now startable

PR #171 delivered the reconciled HA-D slice on current `main`:

- explicit fail-closed runtime selection that permits only `shadow-v1` for this rollout;
- shadow assessment collection that cannot affect recommendation selection;
- Detailed Data health-anomaly trace;
- historical replay using the production HA feature mapper/evaluator;
- future 24/48/72h symptoms joined only as retrospective labels in replay;
- JSON/Markdown evidence tooling.

Therefore the earlier HA blocker, "HA5 must land on current `main`", is satisfied. The next useful code work is the prospective label loop:

1. HA6.1 — low-friction episode outcome capture;
2. HA6.2 — approximate symptom-onset capture when symptoms develop;
3. HA6.3 — optional positive/negative respiratory-test confirmation as a distinct label source.

Do **not** start HA8 visible warning copy or HA9 training gating. Both remain downstream of HA7 prospective/replay evidence and explicit release decisions. Do not start HA6.4's personal expected-response model merely because HA5 exists; it needs enough labelled personal history to evaluate without fitting sparse noise.

### R2 — Phase 9's task board is accurate, but some acceptance checkboxes are stale

The Phase 9 task board correctly records 9.1–9.7 as complete and 9.8 as the only remaining item. Some acceptance bullets below it have not been mechanically reconciled with the implementation.

Example: the acceptance line requiring a regression that decision date `D` never contributes to decision `D`'s subjective baseline remains unchecked, while `app/src/engine/subjectiveBaseline.test.ts` already contains the explicit `D-SUBJHIST` regression (`excludes a check-in dated exactly asOfDate`) and a future-date exclusion case.

Treat unchecked acceptance prose as an audit prompt, not automatically as missing implementation. Reconcile the plan when the next Phase 9 documentation change lands rather than creating duplicate tests blindly.

### R3 — Phase 9.0.1 remains the critical operational prerequisite

Phase 9.0 code through 9.0.6 is built. The unresolved critical path is operational 9.0.1:

- deploy the Cloud Run job and morning Cloud Scheduler polling window documented by the plan (`*/15 5-9 * * *`, `Europe/Warsaw`);
- run the 56-day Garmin backfill;
- run the ingestion audit and record coverage;
- demonstrate seven consecutive unattended days before treating the prospective shadow block as valid evidence.

Until that gate is satisfied, daily app use is useful product testing, but ingestion gaps can confound the formal Phase 9.0 comparison. This is not a reason to add more recommendation code.

### R4 — the legacy Strength runner is genuine residual implementation debt

M3.4 records generic `SessionRunner` Strength parity, while the Multidomain acceptance contract says manual, imported and catalog sessions should share one runner. Current `app/src/App.tsx` still maintains two execution stacks:

- `StrengthSessionRunner` + `strengthSessionService` + `activeStrengthSession` on the `strength` route;
- generic `SessionRunner` + `sessionExecutionService` + `activeStructuredSession` on the structured-session/testing routes.

The legacy component `app/src/components/StrengthSessionRunner.tsx` also remains present. This is not merely stale markdown: two runtime/resume lifecycles are still live after parity.

The desired follow-up is a **separate cutover PR**, preserving the permanent Strength-v1 read compatibility model while routing new Strength execution through the generic runner. Do not delete historical `strength_sessions` reads or overload history as part of that cutover.

Before removal, explicitly cover:

- a catalog Strength recommendation starts through the generic runner;
- in-progress resume works after reload;
- RIR/RPE/velocity-loss/technical gauges remain available;
- last comparable set context remains visible;
- completion still applies derived 1RM writeback;
- Strength-v1 historical records remain readable through the compatibility read model;
- no second active-session banner/lifecycle remains.

### R5 — remaining unchecked M/OV/S items are mostly intentional gates

Do not turn capability numbering into a delivery queue.

- **S:** all numbered implementation work exists; manual Strength load remains default-off until real logged-history evidence supports activation.
- **M6:** start only after a recurring real session proves generic inputs lose a named athlete-facing field/speed/power fact.
- **M8:** evidence candidates may be measured, but M8 must not pull M6/OV work forward merely to enrich its harness.
- **M9:** remains behind its named aliases/prose-import/device triggers.
- **OV4.4:** needs real close-spaced repeat trials.
- **OV6.2:** needs repeated report use that proves a UI question.
- **OV7:** is now the value-bearing path on the actual event/block timeline.
- **Phase 9.8:** requires prospective Phase 9.0 evidence; synthetic success cannot authorize subjective-drift activation.

## Recommended implementation order from this snapshot

1. **HA-E: HA6.1–HA6.3 prospective outcome labels.** Keep them evidence-only and outside immutable assessment revisions.
2. **Strength generic-runner cutover.** Remove the duplicate live execution lifecycle while retaining historical compatibility reads.
3. **Operational Phase 9.0.1 and evidence accumulation.** This is an operations/evidence task rather than another engine feature PR.
4. **OV7 on the real cycling timeline.** Capture ecological event outcome, establish the next-block baseline protocol after recovery, repeat after the block, and generate the first block readout.
5. Revisit default-off candidates only when their own evidence gate is actually satisfied.

## Explicit non-actions

This audit does **not** authorize:

- enabling subjective drift;
- enabling manual Strength-derived fatigue/stimulus;
- enabling Garmin zone-derived credit;
- HA visible illness/systemic-stress wording;
- HA training suppression;
- M6 taxonomy/cards without a recorded usage gap;
- M9 custom movement/parser/device work without its trigger;
- automatic outcome-to-planning authority from OV reports.

Those remain governed by their existing ADR/evidence gates.

## Follow-up documentation reconciliation

The next canonical-plan maintenance should update:

- `docs/plans/README.md`: HA5 merged / HA6.1–HA6.3 startable;
- `docs/plans/health-anomaly-and-illness-risk-alerting.md`: HA-D accepted on `main`, HA6 is the current implementation slice;
- `docs/plans/phase-9-subjective-baselines.md`: mechanically reconcile acceptance checkboxes already proved by the shipped tests;
- `docs/plans/multidomain-session-authoring-execution-and-evidence.md`: make the temporary dual-runner state explicit until the cutover lands, then record the one-runner outcome.

This dated analysis remains immutable even after those living plans are updated.
