# 2026-09-20 — Issue #676 remediation: hard-load density and race-week sequencing

Point-in-time record of the investigation and remediation of [Issue #676](https://github.com/Szczepanov/adaptive-training-recommender/issues/676).

## Findings

### 1. Whole-horizon recent-load sensitivity — confirmed

The external judge case `judge_load_hard_yesterday` already produced an appropriately cautious immediate response, but its 14-day forecast could accumulate more hard work than the no-load baseline. The existing rolling rule only rejected another >=0.50-systemic candidate once three hard exposures were already present in the previous six calendar days; it did not otherwise make recent load matter across the rest of the horizon.

The remediation keeps that hard gate and adds a softer product-calibration layer in `rankCandidates`: once two >=0.50 hard exposures already sit in the rolling six-day history, an additional non-anchor >=0.50 candidate receives a 0.40 benefit multiplier. Nominated anchors remain eligible when safe, but all hard recovery/taper gates still apply.

The deterministic fixture now compares all four acceptance-criterion states: no recent hard load, hard yesterday, hard two days ago, and hard three days ago. It asserts monotonic ordering of both hard-session count and cumulative systemic cost across the 14-day horizon, plus the original two-easy-day response after D-1 hard work.

### 2. Priority-A race-week quality interaction — confirmed

The final-seven-day policy had independent hard/exhaustive restrictions, but no interaction rule that prevented a new substantial race-specific/hard candidate from following recent hard work too closely.

`evaluateRecoveryConstraints` now blocks a candidate inside D-1..D-7 of an A cycling/running/triathlon event when both are true:

- the candidate is systemicCost >=0.50, or Race-Specific Endurance >0.45; and
- one of the preceding three days contains systemicCost >=0.50 work, or Race-Specific Endurance >0.45.

The second clause is intentionally symmetric. An earlier draft checked only prior `systemicCost >=0.50`, which meant a 0.46-0.49 Race-Specific exposure could trigger the candidate-side threshold but disappear from history-side interaction detection.

### 3. Severe-recovery re-entry before an event — confirmed, but narrowed

A severe adverse-recovery snapshot can conservatively constrain all five projected re-entry days. That is appropriate as a forecast safety default because those future days have no fresh readiness measurement, but an all-rest forecast can conflict with the taper objective of preserving a small amount of event-specific intensity/frequency when it can be done at low load.

The late re-entry policy therefore has one narrow exception: on offsets 4-5, before an A/B cycling/running/triathlon event, Race-Specific Endurance at systemicCost <=0.45 may be admitted on D-2 or D-3. Strength, generic Moderate Endurance, and Hard Endurance remain excluded. The forecast policy also uses effective `recover` semantics on recovery-only dates and effective `modify` semantics on graduated re-entry dates for dose selection, allocation viability, displacement diagnostics, and surfaced forecast diagnostics.

This is a product heuristic, not a claim that a wearable snapshot proves a five-day recovery timeline. Taper syntheses support volume reduction while preserving meaningful intensity/frequency on average, but do not validate the exact 0.35/0.45/0.50 cut-points or D-2/D-3 exception:
- Wang et al. 2023: https://pubmed.ncbi.nlm.nih.gov/37163550/
- Bosquet et al. 2007: https://pubmed.ncbi.nlm.nih.gov/17762369/

Likewise, HRV-guided training evidence supports contextual adjustment rather than a universal single-signal stop/resume rule:
- Düking et al. 2021: https://pubmed.ncbi.nlm.nih.gov/34489178/

### 4. Concurrent endurance-strength spacing — reported symptom confirmed, proposed global rule rejected

The issue specifically reported the interaction of a high-cost full-body strength session four days before the race followed by late sharpening after severe adversity. That race-week failure mode is already governed by two narrower authorities merged in #679:

- across the full resolved taper, nonessential Strength is limited to at most one light `systemicCost <=0.35` touch; and
- under severe adverse-recovery forecast re-entry, Strength is excluded through day 5.

The first PR draft added a new global rule requiring >=3 days between all strength sessions and >=4 days around heavy strength for every cycling/running/triathlon event, plus a ranking shortcut that could mark an unresolved strength objective as resolved after one recent session. Review removed both changes. They were broader than the issue required, and current concurrent-training evidence is context-dependent rather than support for a universal 3/4-day physiological invariant (e.g. Huiberts et al. 2024: https://pubmed.ncbi.nlm.nih.gov/37847373/).

## Policy and knowledge boundary

The exact rolling counts, systemic-cost thresholds, 0.40 multiplier, three-day race-week interaction window, five-day recovery ladder, and <=0.45 sharpening exception are registered as product-policy heuristics. The scientific taper/readiness literature informs direction and limitations; it does not masquerade as validation of those exact constants.

Behavior changes bump `POLICY_VERSION` to `2026-09-hard-load-density-race-week-sequencing-v1`, while preserving every newer historical version already present on `main`.

## Deterministic verification

The remediation adds/updates:

- `recentLoadHorizonDensity.test.ts`: no-load vs D-1/D-2/D-3 hard-load horizon ordering.
- `raceWeekInteractionsSequencing.test.ts`: hard-yesterday race week, severe adversity, combined hard-yesterday + severe adversity, bounded D-2/D-3 sharpening, and the Race-Specific 0.46-0.49 history-side interaction edge.
- `policy.test.ts`: current policy transition while retaining the policy versions already live on `main`.
- Knowledge/architecture documentation for the exact product-policy boundary.

The repository CI pipeline remains the merge gate for the integrated branch; stale test-count snapshots from the pre-`main` branch are intentionally not copied into this document.
