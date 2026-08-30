# Engine Knowledge Coverage Inventory — 2026-08-30

## Purpose

This audit implements SKR2 from `docs/plans/sports-knowledge-registry-follow-up.md` after ADR-0033 established the Sports Knowledge Registry.

The question is not "how many citations does the repository contain?" It is:

> Which assumptions can materially change a recommendation, and which of those assumptions have an explicit reviewed knowledge basis?

The machine-readable source of truth is `app/src/knowledge/knowledgeCoverage.ts`. This document records scope, interpretation and the initial research order; it intentionally does not duplicate every scalar from that file.

## Scope and method

The audit follows the recommendation path across Evergreen dose, readiness/safety, fatigue, injury restrictions, spacing/recovery gates, optimizer ranking, periodization/tapering, event demand, stimulus credit, planning capacity and data-trust boundaries.

A policy family is included when changing it can change at least one of:

- recommendation mode (`train` / `modify` / `recover`);
- eligibility or a hard safety/recovery exclusion;
- planned or execution dose;
- weekly adaptation/objective requirements;
- periodization/taper behavior;
- candidate ordering in a way that can change the selected session;
- credit assigned to completed work and therefore future unresolved objectives;
- admission of physiological observations to decision-producing baselines/recovery inputs.

Related constants implementing one model are grouped into one item. For example, the HRV/RHR/sleep/respiration readiness weights, variability floors, z cap and chronic multiplier are one `readiness.physiological_strain_model` family rather than many artificial independent claims.

Pure date arithmetic, rendering, deterministic identifiers and computational search mechanics are not treated as missing sports science. A small number are recorded as `not_applicable` when making that boundary explicit prevents future misclassification.

## Classification

Every item has independent fields for:

- `classification`: `scientific_claim`, `product_heuristic`, `athlete_specific_rule`, `safety_invariant`, or `implementation_constant`;
- `coverage`: `covered`, `partial`, `uncovered`, or `not_applicable`;
- decision impact: low / moderate / high;
- safety impact: low / moderate / high;
- research priority: P0-P3 or none;
- exact current rule, including material thresholds;
- code-owner references;
- Sports Knowledge Registry claim references, when present;
- a rationale explaining the remaining gap or why scientific coverage does not apply.

`uncovered` does **not** mean false. It means the current engine depends on the assumption but has no adequate registered knowledge claim yet.

## Baseline coverage

Initial inventory:

| Metric | Count |
| --- | ---: |
| Policy families | 47 |
| Covered | 4 |
| Partial | 0 |
| Uncovered | 38 |
| Not applicable | 5 |
| P0 research | 16 |
| P1 research | 13 |
| P2 research | 7 |
| P3 research | 2 |
| High-impact uncovered | 25 |
| High-safety uncovered | 7 |

The four covered families are the already-migrated Evergreen claims:

1. adult aerobic health-volume range;
2. adult muscle-strengthening frequency;
3. Evergreen three-session strength upper target, explicitly a product heuristic;
4. conditional Evergreen one-to-two high-intensity weekly prior, explicitly a product heuristic.

The coverage percentage is intentionally not promoted as a quality score. A repository can have many low-impact covered items while one high-safety readiness threshold remains unreviewed. Priority/risk counts are more actionable than a single percentage.

## P0 research backlog

### Readiness and recovery

- `readiness.physiological_strain_model` — HRV/RHR/sleep/respiration weights, variability floors, z cap and chronic multiplier.
- `readiness.subjective_mode_thresholds` — subjective fatigue/readiness/soreness/stress cut-points.
- `readiness.absolute_device_floors` — Garmin sleep score and Body Battery absolute actions.
- `readiness.acute_biometric_floors` — +6 bpm RHR / -15 ms HRV hard modify floors and contribution cut-points.
- `readiness.recent_hard_session_penalty` — two hard sessions in three days -> +1.0 strain.
- `readiness.mode_score_thresholds` — composite modify/recover boundaries at 1.0/2.2.

These should be reviewed as a *model*, not as isolated searches for a paper supporting each magic number. The likely outcome may be that literature supports within-athlete trends but does not justify universal cut-points; in that case the registry should say so and calibration/personalization should remain product evidence.

### Fatigue/load model

- `fatigue.dimension_half_lives` — 24-48 hour dimension-specific exponential recovery.
- `fatigue.internal_response_model` — internal strain normalization and weighting.

The production `max` fusion policy and ambient-step surge model remain P1 because they are important but are downstream of the more fundamental recovery/readiness assumptions.

### Injury and pain safety

- `injury.tissue_response_severity` — mild/moderate/severe -> monitor/limit/exclude and preserve-or-tighten behavior.
- `injury.region_restriction_mapping` — body-region -> impact/strength/spinal/pressing restrictions.
- `injury.pain_envelope_mapping` — generic pain -> Running restriction and Mobility ceiling.

These are high-safety. Evidence review must not convert generic literature into false clinical precision. Where a rule is intentionally conservative software policy rather than a clinically validated return-to-sport protocol, it should be registered as product/safety authority with explicit limitations.

### Session density and spacing

- `spacing.anchor_next_day` — no adjacent-day anchors.
- `spacing.rolling_hard_cap` — systemicCost >=0.5, three hard sessions in the previous six days blocks another.
- `spacing.hard_lower_body_recovery` — lower-body cost >=0.6, default two-day gap, plus workout recovery-hour metadata.
- `spacing.strength_key_cycling_adjacency` — lower-body strength/key cycling adjacency restrictions.

These are ideal candidates for the first evidence pack because they combine direct training consequences with researchable questions about high-intensity distribution, concurrent training, recovery kinetics and strength/endurance sequencing.

### Taper

- `periodization.taper_windows_volume` — race-week/14-day/5-day taper windows, maintained intensity, volume reduction toward 60%, and three-day post-A-event recovery.

This should be separated into atomic claims during SKR3: taper duration, volume reduction, intensity maintenance and post-event recovery are related but not identical questions.

## Important P1/P2 families

The next layer includes:

- phase boundaries and Base/Build/Specificity scaling;
- demand-to-objective inclusion thresholds;
- taper sharpening and race-week strength-primer targets;
- pre-event strength/hard/exhaustive restrictions;
- internal systemic-cost intensity cut-points;
- optimizer fatigue cost weights;
- recovery/streak ranking heuristics;
- event-specific demand vectors for cycling, running, triathlon and strength events;
- stimulus-confidence discounts and race-specific objective-credit formulas;
- event-priority/horizon utility multipliers;
- multi-event contribution windows and conflict rules.

Some will yield scientific claims; others should become explicit product-policy claims plus simulation/calibration evidence. The registry must not upgrade a product scalar to scientific certainty merely because related literature exists.

## Explicit non-scientific boundaries

Five current families are marked `not_applicable` rather than `uncovered`:

- missing/incomplete minimum safety check-in -> provisional Rest;
- already trained today -> no additional normal recommendation;
- applying user-authored time/equipment/environment feasibility;
- deterministic weekly search-budget bounds;
- fail-closed identity gating for configured shared health sources.

These are software/safety contracts, not physiological claims. They still need tests and auditability, but attaching a meta-analysis would not make them more correct.

## Reviewed but excluded shadow/observability models

The audit deliberately does **not** count provisional thresholds from the following as live knowledge debt while they remain non-authoritative:

- `sleepRecoveryEvidence.ts` — shadow-only sleep recovery classifier;
- `dataConfidence.ts` — dashboard observability only;
- `healthAnomaly.ts` — shadow/replay candidate thresholds pending activation evidence;
- `activityHrFidelity.ts` — shadow HR-use authority pending live consumers;
- `identityAttribution.ts` — shadow physiological identity classifier pending activation/calibration;
- subjective-drift experimental scoring — production default remains off.

If any of these gains recommendation authority, its decision-affecting policy families must move into `ENGINE_KNOWLEDGE_COVERAGE` in the same PR that activates it.

## CI contract

`validateKnowledgeCoverageInventory` verifies structural and epistemic consistency:

- stable unique inventory IDs;
- non-empty decision rule, code references and rationale;
- `covered`/`partial` records must reference active Sports Knowledge claims;
- `uncovered` records cannot pretend to have claim coverage and must carry a research priority;
- `not_applicable` is restricted to implementation constants and non-scientific safety invariants;
- covered items cannot remain in the research backlog;
- high-impact and high-safety uncovered assumptions are emitted as warnings, not CI failures.

The warnings are deliberate. CI should prevent false provenance and inventory corruption; it should not make existing scientific debt impossible to commit. The debt is the output of this audit and will be reduced through subsequent evidence/migration PRs.

## Next implementation order

1. **Evidence Pack 1 — hard-session density, recovery and strength/endurance spacing.** Split current P0 families into atomic research questions and review high-quality systematic reviews/meta-analyses, consensus/guidelines where available, and direct primary studies where required.
2. **Evidence Pack 2 — readiness, HRV/RHR/sleep and recovery decision authority.** Expect the distinction between population evidence and individual calibration to be central.
3. **Evidence Pack 3 — taper/event preparation.** Replace monolithic taper defaults with claim-linked policy where evidence is sufficiently direct.
4. **Evidence Pack 4 — injury/pain safety boundaries.** Treat as high-safety and avoid overclaiming clinical applicability.
5. Continue P1/P2 migrations: event demand profiles, periodization objectives, stimulus credit and optimizer calibration.

Each evidence migration should preserve behavior unless the evidence review explicitly justifies a separate policy-change PR and recommendation `POLICY_VERSION` bump.
