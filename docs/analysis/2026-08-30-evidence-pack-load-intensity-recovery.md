# Evidence Pack — Load + Intensity + Recovery — 2026-08-30

## Decision summary

This is the first SKR3 evidence-migration pack after the engine-wide knowledge coverage inventory.

**Decision: preserve current recommendation behavior.** The reviewed literature supports organizing endurance intensity, respecting accumulated training stress, and accounting for residual lower-body fatigue, but it does **not** validate the engine's exact internal cut-points such as `systemicCost >= 0.5`, `systemicCost >= 0.6`, three hard sessions in six days, a universal one-day anchor gap, or universal 48-hour lower-body recovery.

The implementation therefore uses **dual lineage**:

```text
scientific claim
  = what the literature supports and where it stops

product-policy claim
  = the exact current threshold/guardrail the engine uses

coverage item
  = scientific boundary + exact product rule + code location
```

This is intentionally different from finding a related paper and attaching its authority to a product scalar the paper never tested.

## Scope

The pack reviews these coverage families:

1. `optimizer.intensity_class_thresholds`
2. `spacing.rolling_hard_cap`
3. `spacing.anchor_next_day`
4. `spacing.hard_lower_body_recovery`
5. `spacing.strength_key_cycling_adjacency`
6. `readiness.recent_hard_session_penalty`
7. `fatigue.dimension_half_lives`

It does **not** attempt to solve the broader HRV/RHR/sleep readiness model, fatigue fusion/weights, pre-event taper restrictions, optimizer utility weights, injury policy, or catalog-specific workout recovery calibration.

## Research questions and conclusions

### 1. Can research validate the engine's internal hard/moderate intensity thresholds?

**Current policy**

- hard when a hard/race-specific category applies or `systemicCost >= 0.6`;
- moderate at `systemicCost >= 0.3`;
- a hard candidate needs `plannedIntensity >= 0.8`;
- related history paths use `systemicCost` values around 0.5-0.7 for hard-load/anchor semantics.

**Evidence conclusion**

No external literature can directly validate those numbers because `systemicCost` and `plannedIntensity` are product-defined normalized scales, not physiological intensity zones.

Current endurance TID evidence does support the higher-level principle that intensity distribution matters and that effective endurance programs commonly allocate most work at lower intensity with a smaller amount of moderate/high-intensity work. Oliveira et al. found a small polarized-training advantage for VO2peak, particularly in shorter interventions and highly trained athletes, but no superiority for several other endurance outcomes. Rosenblat et al. subsequently compared training-intensity distributions using an individual-participant network meta-analysis. Neither body of evidence maps onto the product's 0..1 cost scale or supplies a universal hard-session threshold.

**Registry result**

- scientific: `performance.endurance.intensity_distribution.low_intensity_majority`
- product: `policy.load_intensity.internal_scale_thresholds_v1`
- coverage: **covered** — the exact cut-points are now correctly identified as product calibration, not as scientific zones.

### 2. Does evidence support the rolling hard-session cap of three prior >=0.5 sessions in six days?

**Current policy**

A prior session with `systemicCost >= 0.5` counts toward rolling hard density. A new candidate at `>=0.5` is rejected when three such sessions occurred in the previous six calendar days.

**Evidence conclusion**

Endurance evidence supports deliberate intensity distribution and avoiding an indiscriminately high concentration of hard work. Recovery consensus also supports balancing training/competition stress with recovery and explicitly notes substantial inter- and intra-individual variability.

However, no reviewed source establishes **three sessions in six days** as a universal physiological limit, nor does it validate `systemicCost >= 0.5` as the definition of a hard session.

The current rule is therefore defensible only as a **conservative product guardrail** whose exact operating point must ultimately be validated against product outcome/replay data.

**Registry result**

- scientific: endurance intensity distribution + stress/recovery balance
- product: `policy.load_recovery.rolling_hard_density_v1`
- coverage: **covered as product policy with scientific boundary**, not scientifically validated scalar.

### 3. Does evidence justify forbidding adjacent-day anchor/quality sessions?

**Current policy**

A candidate anchor is rejected when another anchor occurred on the previous calendar day.

**Evidence conclusion**

The recovery literature supports managing accumulated training stress and individual recovery. Training-practice literature in high-level endurance sport commonly describes hard/easy organization. That supports the *direction* of protecting key-session quality.

It does not establish a universal one-calendar-day rule across sports, athlete levels, session doses, phases or recovery states.

**Registry result**

- scientific: stress/recovery balance
- product: `policy.load_recovery.anchor_spacing_v1`
- coverage: **covered as an explicit conservative heuristic**.

### 4. Is the default two-day hard-lower-body gap evidence-based?

**Current policy**

- `lowerBodyCost >= 0.6` is treated as hard lower-body work;
- another hard-lower-body candidate defaults to a two-calendar-day minimum gap;
- workout-specific `minimumDaysAfterHardLowerBody` can override that fallback;
- authored `recoveryHours` can separately block hard/anchor work until elapsed.

**Evidence conclusion**

The evidence strongly rejects a single universal recovery duration.

Harrison et al.'s systematic review/meta-analysis of 20 studies found sprint and change-of-direction impairment and muscle-damage-related perturbations lasting up to 72 h after resistance/plyometric protocols specifically designed to induce muscle damage. This is useful evidence that demanding lower-body work can have multi-day residual consequences, but it is **not** evidence that every strength workout needs 72 h or even 48 h.

Varela-Olalla et al.'s 51-article systematic review further shows that resistance-training fatigue is substantially affected by set duration, proximity to failure, total volume and training density. Primary recovery studies also show that recovery duration changes materially with protocol dose and whether sets are taken to failure.

The correct scientific statement is therefore a **range/context claim**, not a 48-hour rule.

**Registry result**

- scientific: `recovery.lower_body.strenuous_work.residual_impairment`
- product: `policy.load_recovery.hard_lower_body_spacing_v1`
- coverage: **partial**.

Why only partial: the default `0.6` / two-day policy now has explicit lineage, but individual catalog `recoveryHours` and `minimumDaysAfterHardLowerBody` values can override it and have not been audited workout by workout. They remain P1 debt rather than silently inheriting authority from a broad review.

### 5. Does concurrent-training research justify blocking heavy strength and key cycling on the same/adjacent day?

**Current policy**

Heavy lower-body strength and key cycling sessions are blocked from the same/adjacent 0-1-day window in either order. A post-heavy-strength strength buffer also applies unless workout metadata allows a shorter interval.

**Evidence conclusion**

No. The research supports a more nuanced statement.

Huiberts et al. included 59 studies and 1,346 participants and found a small concurrent-training interference effect for lower-body strength in males but not females, with some training-status-dependent differences. Eddens et al. found exercise sequence affected lower-body dynamic-strength adaptation, while several other outcomes were not materially changed by sequence.

Most importantly for our exact rule, the 2025 elite-athlete consensus led by Bangsbo states that concurrent modalities are important to endurance performance, says different modalities can be performed on the same day without inherently reducing the effectiveness of each modality, and recommends athlete-by-athlete prescription based on background, experience and tolerability.

Therefore the current 0-1-day exclusion must **not** be represented as a scientific requirement. It is a conservative product quality-protection rule under uncertainty. A future product-calibration PR may reasonably relax it using session dose, ordering, athlete history, event phase and measured recovery — but that is a policy change and is intentionally not mixed into this evidence migration.

**Registry result**

- scientific: `performance.concurrent.strength_endurance.context_dependent`
- product: `policy.load_recovery.strength_endurance_adjacency_v1`
- coverage: **covered with an explicit counter-limitation**: science constrains the product claim rather than falsely authorizing it.

### 6. Is `>=2` hard sessions in three days -> `+1.0` readiness strain evidence-based?

**Current policy**

When the recovery snapshot reports at least two hard sessions in the previous three days, `evaluateReadinessAndSafetyEnvelope` adds 1.0 to objective strain.

**Evidence conclusion**

Stress/recovery consensus supports considering recent accumulated training stress when making readiness decisions. It does not supply the three-day window, count threshold of two, or +1.0 contribution to this product's composite strain scale.

**Registry result**

- scientific: stress/recovery balance
- product: `policy.load_recovery.recent_hard_readiness_penalty_v1`
- coverage: **covered as explicit product calibration**.

The broader readiness score remains P0 because this pack does not validate its HRV/RHR/sleep weights, absolute floors or final modify/recover cut-points.

### 7. Are the dimensional fatigue half-lives scientific recovery constants?

**Current policy**

- systemic 36 h
- cardiovascular 24 h
- lower body 48 h
- upper body 36 h
- impact tissue 48 h
- neuromuscular 36 h

with exponential decay.

**Evidence conclusion**

No. Recovery literature supports heterogeneous time courses, not six universal exponential half-lives. Strenuous lower-body studies make it plausible that some performance/fatigue effects persist for 24-72 h, while protocol dose, training status and the measured outcome materially affect the observed duration.

The exponential model is useful as a deterministic latent-state approximation. Its exact half-lives are product calibration and should eventually be challenged against replay/outcome data rather than claimed as direct physiological estimates.

**Registry result**

- scientific: stress/recovery balance + strenuous lower-body residual fatigue
- product: `policy.load_recovery.fatigue_decay_half_lives_v1`
- coverage: **covered as a documented model assumption**.

## Evidence table

| Source | Design / synthesis | Stable IDs | What it supports here | Important limitation |
|---|---|---|---|---|
| Oliveira, Boppre & Fonseca 2024 | Systematic review + meta-analysis, 17 studies / 437 participants; GRADE used | PMID 38717713; PMCID PMC11329428; DOI 10.1007/s40279-024-02034-z; PROSPERO CRD42022365117 | Comparative endurance TID; polarized vs other distributions | Small/conditional advantages; no universal hard-session count; does not map to `systemicCost` |
| Rosenblat et al. 2025 | Systematic review + individual-participant network meta-analysis | PMID 39888556; DOI 10.1007/s40279-024-02149-3 | Distribution-level endurance programming | Does not validate internal intensity scale or rolling count |
| Kellmann et al. 2018 | Multidisciplinary consensus statement | PMID 29345524; DOI 10.1123/ijspp.2017-0759 | Stress-recovery balance, monitoring, inter/intra-individual variability | Consensus-level framework; no numeric spacing rule |
| Harrison et al. 2024 | Systematic review + meta-analysis, 20 studies | PMID 38952917; PMCID PMC11167466; DOI 10.5114/biolsport.2024.131823 | Residual sprint/COD/neuromuscular effects after damaging resistance/plyometric work | Deliberately muscle-damaging protocols; not all strength sessions |
| Varela-Olalla et al. 2025 | Systematic review, 51 articles | PMID 40644670; DOI 10.1519/JSC.0000000000005194 | Fatigue depends on volume, density, proximity to failure, set duration | Acute fatigue literature; no universal recovery clock |
| Huiberts et al. 2024 | Systematic review + meta-analysis, 59 studies / 1,346 participants | PMID 37847373; PMCID PMC10933151; DOI 10.1007/s40279-023-01943-9; PROSPERO CRD42022370894 | Context-dependent concurrent-training interference | Sex/status evidence uneven; does not set daily spacing |
| Eddens et al. 2018 | Systematic review + meta-analysis, 10 studies | PMID 28917030; PMCID PMC5752732; DOI 10.1007/s40279-017-0784-1 | Sequence can affect lower-body dynamic strength | Several other outcomes unaffected; intra-session question is not a one-day spacing rule |
| Bangsbo et al. 2025 | Elite-athlete evidence-based consensus | PMID 40781883; PMCID PMC12334928; DOI 10.1111/sms.70112 | Concurrent modalities can be used same day; individualize by context/tolerability | Most directly applicable to trained/elite athletes; consensus acknowledges evidence gaps |

## Evidence-certainty decisions

The four external scientific claims are registered as `maturity=supported`, `evidenceCertainty=moderate` rather than automatically upgraded to high certainty because a meta-analysis exists.

Reasons:

- applicability varies across sport, athlete level, sex, training status and protocol;
- several product questions are more specific than the review questions;
- TID outcomes are not uniformly superior under one distribution;
- lower-body recovery evidence is strongly protocol-dependent;
- concurrent-training evidence argues against a universal separation rule;
- consensus statements are useful applied syntheses but do not create exact cut-points.

All seven exact current engine rules are separately registered as `maturity=heuristic`, `evidenceCertainty=not_applicable`, with `PRODUCT-LOAD-INTENSITY-RECOVERY-V1` as the product-policy source.

## Implementation

### Registry

Adds four scientific claims:

- `performance.endurance.intensity_distribution.low_intensity_majority`
- `recovery.training.stress_recovery_balance`
- `recovery.lower_body.strenuous_work.residual_impairment`
- `performance.concurrent.strength_endurance.context_dependent`

Adds seven product-policy claims:

- `policy.load_intensity.internal_scale_thresholds_v1`
- `policy.load_recovery.rolling_hard_density_v1`
- `policy.load_recovery.anchor_spacing_v1`
- `policy.load_recovery.hard_lower_body_spacing_v1`
- `policy.load_recovery.strength_endurance_adjacency_v1`
- `policy.load_recovery.recent_hard_readiness_penalty_v1`
- `policy.load_recovery.fatigue_decay_half_lives_v1`

### Coverage inventory

Before this pack:

- 4 covered
- 0 partial
- 38 uncovered
- 5 not applicable
- P0 / P1 / P2 / P3 = 16 / 13 / 7 / 2
- 25 high-impact uncovered
- 7 high-safety uncovered

After this pack:

- **10 covered**
- **1 partial**
- **31 uncovered**
- **5 not applicable**
- P0 / P1 / P2 / P3 = **10 / 13 / 7 / 2**
- **18 high-impact uncovered**
- **5 high-safety uncovered**

The hard-lower-body family intentionally remains partial/P1.

### Validation hardening

A `partial` coverage item must now retain a non-`none` research priority. High-impact/high-safety partial items emit warnings, preventing partial migration from becoming a way to hide unresolved debt.

Focused tests also pin several claim statements to the current public engine behavior at the exact thresholds. This means a future threshold change that leaves the product knowledge claim stale will fail tests even though this evidence pack itself does not modify recommendation code.

## Why no `POLICY_VERSION` bump

This PR changes knowledge metadata, coverage status, validation and tests. It **does not modify recommendation decision logic or any numeric engine rule**. The live decision function remains identical, so the global recommendation `POLICY_VERSION` should not change.

If a follow-up uses this evidence to relax strength/cycling adjacency, alter hard-session density, change recovery spacing, or recalibrate fatigue half-lives, that is a separate behavior-changing policy PR and must evaluate/bump `POLICY_VERSION` under the repository drift gate.

## Follow-up decisions

### P1: catalog recovery metadata audit

`spacing.hard_lower_body_recovery` cannot become fully covered until active workout catalog values are audited:

- `loadProfile.recoveryHours`
- `eligibility.minimumDaysAfterHardLowerBody`

The audit should group workouts by dose/mechanical demands rather than search for a paper matching every integer. Where literature cannot establish a precise duration, the value should remain explicit product calibration with replay/simulation evidence.

### Next evidence pack

Proceed to **Readiness + HRV/RHR/Sleep + Internal Fatigue**:

- `readiness.physiological_strain_model`
- `readiness.subjective_mode_thresholds`
- `readiness.absolute_device_floors`
- `readiness.acute_biometric_floors`
- `readiness.mode_score_thresholds`
- `fatigue.internal_response_model`

The expected architectural challenge is even stronger there: evidence may support within-athlete signal interpretation but not universal device-score or biomarker cut-points, so product calibration and athlete-specific evidence must remain separate from general sports knowledge.

## References

- Oliveira PS, Boppre G, Fonseca H. *Sports Medicine*. 2024. PMID 38717713. https://pubmed.ncbi.nlm.nih.gov/38717713/
- Rosenblat MA, Watt JA, Arnold JI, et al. *Sports Medicine*. 2025. PMID 39888556. https://pubmed.ncbi.nlm.nih.gov/39888556/
- Kellmann M, Bertollo M, Bosquet L, et al. *International Journal of Sports Physiology and Performance*. 2018. PMID 29345524. https://pubmed.ncbi.nlm.nih.gov/29345524/
- Harrison DC, Doma K, Rush C, Connor JD. *Biology of Sport*. 2024. PMID 38952917. https://pubmed.ncbi.nlm.nih.gov/38952917/
- Varela-Olalla D, del Campo-Vecino J, Balsalobre-Fernandez C. *Journal of Strength and Conditioning Research*. 2025. PMID 40644670. https://pubmed.ncbi.nlm.nih.gov/40644670/
- Huiberts RO, Wust RCI, van der Zwaard S. *Sports Medicine*. 2024. PMID 37847373. https://pubmed.ncbi.nlm.nih.gov/37847373/
- Eddens L, van Someren K, Howatson G. *Sports Medicine*. 2018. PMID 28917030. https://pubmed.ncbi.nlm.nih.gov/28917030/
- Bangsbo J, Hostrup M, Hellsten Y, et al. *Scandinavian Journal of Medicine & Science in Sports*. 2025. PMID 40781883. https://pubmed.ncbi.nlm.nih.gov/40781883/
