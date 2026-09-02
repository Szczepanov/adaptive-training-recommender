# SKR3 Completion Plan — Migrating the Remaining High-Impact Training Policy

**Date:** 2026-09-02
**Status:** Proposed
**Parent plan:** [`sports-knowledge-registry-follow-up.md`](./sports-knowledge-registry-follow-up.md) — SKR3
**Related:** ADR-0033 (claim registry), SKR1 (persisted lineage), SKR2 (coverage inventory)
**Policy version impact:** none intended — every workstream below is behavior-preserving

## 1. Purpose

SKR3 says *"migrate high-impact training policy"* and names four remaining packs without scoping
them. This plan scopes them against the **actual** current state of the inventory, separates the
work by *kind* (registry reconciliation vs. literature review vs. product-policy registration vs.
catalog data audit), and states what SKR3 must deliberately **not** attempt.

## 2. Current state

Measured from `knowledgeCoverage.ts:summarizeKnowledgeCoverage` on `main` at the SEP-C4 merge:

| Metric | Value |
|---|---|
| Families inventoried | 53 |
| covered / partial / uncovered / not_applicable | 17 / 8 / 22 / 6 |
| Research backlog P0 / P1 / P2 / P3 | 8 / 13 / 7 / 2 |
| High-impact uncovered | 9 |
| High-safety uncovered | 0 |

Five evidence packs are complete (load/intensity/recovery, readiness/sleep/HRV/RHR/respiration,
the subjective+injury safety pack SEP-A→C4, strength/concurrent, taper/fueling). The parent plan
lists four remaining packs: periodization + event demand, stimulus/optimizer calibration,
workout-specific recovery metadata, and fueling-when-it-gains-authority.

## 3. Findings from the analysis

### F1 — The taper family is claim-backed on three surfaces and uncovered on the fourth

`periodization.taper_windows_volume` is recorded as `uncovered` with `knowledgeRefs: []`, yet the
evidence for it already exists and is already wired:

| Surface | State |
|---|---|
| Registry claims | `taperFuelingKnowledge.ts:TAPER_FUELING_CLAIM_IDS` defines both `endurancePreEventTaper` (scientific, moderate certainty) and `taperWindowsVolumePolicy` (exact product scalars) |
| SKR1 runtime lineage | `knowledgeLineage.ts:trainingIntentKnowledgeRefs` emits both for tapering endurance events |
| Alignment test | `periodizationKnowledgeAlignment.test.ts` pins the claim statement against `periodization.ts:evaluatePeriodizationPhase` output |
| SKR2 coverage inventory | **`uncovered`, zero knowledge refs, P0** |

`knowledgeLineage.ts:trainingIntentKnowledgeRefs` documents its own rule as attributing *covered*
policies only, and explicitly excludes pre-event restriction windows for being uncovered — while
attributing a family the inventory calls uncovered. One of the two surfaces is currently wrong.
This is a real inconsistency, not a cosmetic one: it is exactly the drift SKR2 exists to prevent.

### F2 — The cause is a schema rule plus a bundled family, not an oversight

`knowledgeCoverage.ts:validateKnowledgeCoverageInventory` rejects any `uncovered` item that carries
knowledge refs. So while the family stays `uncovered`, it is *structurally forbidden* from citing
the claims that already describe it. The family stays uncovered for a stated reason: its
`currentRule` bundles the taper window/volume rule (evidence-backed) with an unrelated,
independently calibrated A-event post-event recovery rule (not evidence-backed).

Those two rules are separable in code. The taper path is `taperPolicy.ts:resolveEventTaper`; the
post-event rule is an A-priority-only, completed/DNF-only, three-day 0.4/0.4 phase branch inside
`periodization.ts:evaluatePeriodizationPhase`. **Splitting the family resolves the contradiction
without weakening any epistemic claim.**

Do **not** relax the schema rule to fix this. The rule is correct — a family cannot simultaneously
declare "no coverage" and cite supporting claims. The bundling is the defect.

### F3 — Clearing one family empties the uncovered-P0 backlog

`periodization.taper_windows_volume` is the **only** remaining `uncovered` P0 family. The other
seven P0s are all `partial`. Finishing F1/F2 takes uncovered-P0 to zero.

### F4 — Seven of the eight P0s cannot be resolved by more literature

The remaining P0s are the SEP outputs: `readiness.subjective_mode_thresholds`,
`injury.tissue_response_severity`, the four `injury.region_mapping.*` families, and
`injury.pain_envelope_mapping`. SEP-A/B/C already reviewed the applicable literature and concluded
the residual debt is **calibration** debt: equal-weight subjective scoring, exact 1–10 cut-points,
region-label-to-restriction mappings and the combined pain/illness flag are product constructs that
no external study validates. Searching more papers cannot move them.

They belong to simulation/athlete-outcome calibration and SKR4 (athlete-specific evidence), not to
SKR3. Attempting to "cover" them with adjacent evidence would be exactly the proximity-legitimization
error the parent plan already refused for `readiness.subjective_mode_thresholds`.

### F5 — Two more Pack-5 claims exist with no inventory row citing them

`preEventRestrictionsPolicy` and `taperSharpeningPolicy` are active claims stating the exact
scalars for `spacing.pre_event_restrictions` and `periodization.taper_sharpening_targets`. Both
families remain `uncovered` with zero refs, for the same schema reason as F2. `taperSharpeningPolicy`
is additionally already emitted by `knowledgeLineage.ts:trainingIntentKnowledgeRefs`;
`preEventRestrictionsPolicy` is not.

### F6 — The remaining uncovered families split into two different kinds of work

**Needs external evidence review** (a real literature pack): `event.demand_presets`,
`periodization.phase_boundaries_scales`, `periodization.objective_thresholds`,
`periodization.multi_event_contribution`, and the scientific half of `spacing.pre_event_restrictions`.

**Has no external evidence to find** — utility/calibration coefficients whose scale is
product-defined, so no study can validate them: `optimizer.fatigue_cost_weights`,
`optimizer.stimulus_benefit_weights`, `optimizer.event_priority_multipliers`,
`optimizer.recovery_streak_heuristics`, the four `stimulus.*` families,
`packing.legacy_session_spacing_tiebreak`, `fatigue.max_fusion_policy`,
`fatigue.ambient_step_surge`, `readiness.plan_tier_cost_ceilings`,
`readiness.post_recover_buffer`, `evergreen.training_history_qualification`,
`evergreen.default_weekly_commitment`.

Treating the second group as a literature problem wastes effort and invites dishonest citations.
They need explicit product-policy claims plus drift-proof alignment tests — and must **keep** a
research priority, because recording a number is not calibrating it.

### F7 — `spacing.hard_lower_body_recovery` is a data audit, not a reading task

It is `partial`/P1/high-safety with three claims already linked. Its unresolved surface is
per-workout catalog metadata: declared `recoveryHours` and `minimumDaysAfterHardLowerBody` values
that override the 0.6/two-day fallback, consumed by
`planningCandidate.ts:resolveRecoveryHoursForTemplate` and
`planningCandidate.ts:resolveMinimumDaysAfterHardLowerBody`. Closing it means auditing catalog
entries and adding a validator, not reviewing papers.

## 4. Scope

| In scope | Out of scope (and why) |
|---|---|
| W0 registry↔inventory↔lineage reconciliation | The seven SEP P0 partials — calibration debt, not literature debt (F4); route to SKR4 |
| W1 periodization + event-demand evidence pack | Fueling policy migration — the engine has no fueling decision authority yet; migrating it would register authority that does not exist |
| W2 optimizer/stimulus product-policy registration | Any `POLICY_VERSION`-bumping behavior change; those are separate calibration PRs |
| W3 catalog recovery-metadata audit | Relaxing `validateKnowledgeCoverageInventory` rules (F2) |

## 5. Coverage-state decision rule

To keep these workstreams from becoming coverage inflation, apply one rule consistently:

- **`covered`** requires *all three*: (a) an applicable reviewed scientific boundary claim,
  (b) an explicit product-policy claim recording the exact scalars, (c) an alignment test pinning
  claim text to the live constants. Priority becomes `none`.
- **`partial`** where a product-policy claim exists but either no scientific boundary applies, or a
  material sub-surface stays unaudited. Priority is **retained**.
- **`uncovered`** stays only where not even a product-policy claim has been written.

Recording a scalar in a claim is provenance, not validation. A family whose numbers remain
uncalibrated ends at `partial` with its priority intact — never `covered`.

## 6. Workstreams

### W0 — Reconcile the registry, the inventory and the runtime lineage

**Prerequisite for everything else.** No literature. No engine behavior change.

1. Split `periodization.taper_windows_volume`:
   - `periodization.taper_windows_volume` → `covered`, refs `endurancePreEventTaper` +
     `taperWindowsVolumePolicy`, priority `none`. It satisfies all three `covered` conditions today.
   - New `periodization.post_event_recovery_window` → `uncovered`, `product_heuristic`, P1,
     decision impact `moderate`, safety impact `moderate`, codeRef
     `periodization.ts:evaluatePeriodizationPhase`, rationale recording that the A-only,
     three-day, 0.4/0.4 window is independently calibrated and unsupported by taper meta-analysis.
     (The §6 target figures below assume `moderate` decision impact; scoring it `high` instead
     leaves high-impact uncovered at 8 rather than 7.)
2. `periodization.taper_sharpening_targets` → `partial` + `taperSharpeningPolicy`, priority P2.
   Product claim exists; the specific stimulus target values are not derivable from taper evidence.
3. `spacing.pre_event_restrictions` → `partial` + `preEventRestrictionsPolicy`, priority P1 retained
   (its scientific half is W1's job).
4. Correct the `knowledgeLineage.ts:trainingIntentKnowledgeRefs` doc comment so its stated rule
   matches reality, and decide explicitly whether `preEventRestrictionsPolicy` should now be
   emitted for tapering endurance events (recommended: yes, once the family is `partial`).
5. Update the totals asserted in `knowledgeCoverage.test.ts` and the inventory figures quoted in
   `sports-knowledge-registry-follow-up.md` and
   `docs/analysis/2026-08-30-engine-knowledge-coverage-inventory.md`.

**Target end state (subject to review):** 54 families — covered 18, partial 10, uncovered 20,
not_applicable 6; P0 **7**, P1 13, P2 8, P3 2; high-impact uncovered 9 → **7**; uncovered-P0 → **0**.

**Acceptance:** `npm run check` green; `validate:knowledge-coverage` reports the new totals; no
change to any file in the `check-policy-drift.mjs` decision-file list.

### W1 — Evidence Pack 6: periodization objectives and event demand

**Families:** `periodization.phase_boundaries_scales`, `periodization.objective_thresholds`,
`periodization.multi_event_contribution`, `event.demand_presets`, and the scientific half of
`spacing.pre_event_restrictions`.

**Method:** define the atomic claim first, then search evidence (the parent plan's rule). Expect
periodization-structure syntheses and sport-demand characterization literature to support
*boundaries* — that structured phase progression and event-specific demand profiling are legitimate
—without validating 35/84-day cut-offs, 0.6/1.1/0.9 scalars, the 0..1 demand vectors, or the
0.4/0.5/0.6/0.7 objective thresholds.

**Honest expected outcome:** mostly `partial`. `event.demand_presets` is currently classified
`scientific_claim`; the analysis should reclassify it as `product_heuristic` with a scientific
boundary, because the authored 0..1 vectors are a product encoding, not a measured constant. The
same reclassification question applies to `periodization.taper_windows_volume` and should be
settled in W0.

**Deliverables:** `docs/analysis/<date>-evidence-pack-periodization-event-demand.md`; a new
`periodizationEventDemandKnowledge.ts` module registered in `sportsKnowledgeRegistry.ts`; claim and
alignment tests; inventory updates; optional lineage wiring for newly non-uncovered families.

### W2 — Product-policy registration for optimizer, stimulus and unclaimed heuristics

**Families:** the F6 second group (15 families — the largest workstream by count, and the lowest
per-family cost).

**Method:** no literature search. For each family author a `policy.*` claim with
`evidenceCertainty: 'not_applicable'` stating the exact live constants, then add an alignment test
that fails if code and claim diverge. Where a genuinely applicable boundary already exists in the
registry (e.g. `trainingStressRecoveryBalance` and `fatigueDecayHalfLives` for the fatigue-cost
weights), link it as context — not as validation of the coefficients.

**Every family in W2 ends `partial` with its priority retained.** The deliverable is provenance and
drift protection, not discharged calibration debt. State this explicitly in each
`coverageRationale`, otherwise the summary will read as if optimizer tuning had been validated.

**Sequencing note:** split into at least two PRs (optimizer scoring; stimulus credit + remaining
heuristics) — 15 families in one review is too large for the alignment tests to be read carefully.

### W3 — Workout-specific recovery metadata audit

**Family:** `spacing.hard_lower_body_recovery` (`partial`/P1/high-safety).

1. Enumerate every catalog workout declaring `recoveryHours` or `minimumDaysAfterHardLowerBody`.
2. For each, record whether the value is justified by the registered residual-fatigue boundary or
   is an unaudited authored override.
3. Add a validator (alongside `validate-workouts.ts`) asserting declared values stay inside a
   documented band and that overrides carry a rationale field.
4. Only then consider `covered` — and only if no unaudited override remains.

**Note:** this is the one workstream that can plausibly surface a *behavior* problem (an override
weakening a high-safety spacing rule). If it does, that fix is a separate `POLICY_VERSION`-bumping
PR with simulation, not part of the registry work.

### W4 — Fueling (deferred, unchanged)

Claims already exist from Pack 5. No coverage family should be created until a fueling surface
gains live decision authority. Re-evaluate when that ships.

## 7. Sequencing

```text
W0 (reconciliation)  ──►  W1 (periodization/event pack)
        │                        │
        ├──────────────────►  W2a (optimizer)  ──►  W2b (stimulus + rest)
        │
        └──────────────────►  W3 (catalog audit)
```

W0 first: it is the only workstream that changes what "uncovered" currently means, and both W1 and
W2 add inventory rows whose totals would otherwise need updating twice. W1 and W2 are independent.
W3 is independent of both but shares the alignment-test pattern, so it benefits from following W2a.

Suggested PRs: W0 (1 PR) → W1 (1 analysis PR + 1 implementation PR) → W2a, W2b (2 PRs) → W3
(1 audit PR + possibly 1 behavior PR).

## 8. Per-family migration recipe

Derived from the completed packs; follow it for every family in W1–W3.

1. Write the family's exact current rule from the code, including every material scalar.
2. Decide the honest claim shape: scientific boundary, product policy, or both.
3. Search evidence **after** the claim is defined, never to justify a number already chosen.
4. Register claims and sources in a focused `*Knowledge.ts` module; export through
   `sportsKnowledgeRegistry.ts` so cross-module identity stays validated.
5. Add a claim test (registry shape) and an alignment test (claim text ↔ live constants).
6. Update the `ENGINE_KNOWLEDGE_COVERAGE` row: coverage state per §5, refs, and a rationale that
   names what remains unvalidated.
7. Wire `knowledgeLineage.ts` only for families that are no longer `uncovered`, and only on paths
   actually evaluated for the supplied inputs.

## 9. Verification and guardrails

Required for every PR in this plan:

- `npm run check` — typecheck, lint, vitest, `validate:knowledge`, `validate:knowledge-coverage`,
  `validate:workouts`.
- Updated totals in `knowledgeCoverage.test.ts` whenever the inventory changes.
- `node scripts/check-policy-drift.mjs <base-sha>`.

**Drift-safe surfaces** (editable without a `POLICY_VERSION` bump): `app/src/knowledge/**`,
`app/src/engine/knowledgeLineage.ts`, docs, tests.

**Guarded decision files** — `optimizer.ts`, `periodization.ts`, `rules.ts`, `fatigue.ts`,
`microcycle.ts` and the rest of the `check-policy-drift.mjs` list — must not change executably in
this plan. Comment-only edits are permitted (the gate compares normalized syntax with comments
removed), which is how the W0 lineage-comment correction and any clarifying code comments should
land. Anything else means the work stopped being behavior-preserving and needs its own PR.

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Coverage inflation** — recording scalars reads as validating them | §5 decision rule; W2 families stay `partial` with priorities retained; rationales state the residual debt |
| **Proximity legitimization** — citing adjacent evidence for a product number | Claim-first authoring (recipe step 3); the parent plan already rejected this for subjective thresholds |
| **Scope creep into SEP P0s** | Explicitly out of scope (F4); route to SKR4/calibration |
| **Accidental behavior change** | Drift gate + guarded-file rule (§9); W3 escalates to a separate PR if it finds a real defect |
| **Double-counted totals** | W0 lands before W1/W2; a single totals update per PR |
| **Family splits break audit identity** | Coverage ids are stable audit identity — the new `periodization.post_event_recovery_window` is additive; the retained `periodization.taper_windows_volume` id keeps its meaning narrowed, and this must be recorded in the W0 analysis note |

## 11. Definition of done for SKR3

- Uncovered-P0 backlog is zero and stays zero.
- Every family with live decision authority holds at least a product-policy claim, so no decision
  path is completely unattributed.
- Every registered scalar is protected by an alignment test.
- The remaining backlog is honestly labelled calibration debt (`partial` + priority), not absence
  of provenance — and the families that need athlete data rather than literature are handed to SKR4
  rather than being closed prematurely.
