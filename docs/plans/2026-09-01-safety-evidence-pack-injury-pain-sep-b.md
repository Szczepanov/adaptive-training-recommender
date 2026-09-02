# SEP-B — Injury, Tissue-Response, and Clinical-Symptom Evidence Pack

**Status:** Implemented — merged to `main` via [PR #318](https://github.com/Szczepanov/adaptive-training-recommender/pull/318)

**Prerequisite:** PR #317 (`codex/sep-a-plan-review`) merged; this work was rebased on `main` and merged

**Parent plan:** [`2026-08-31-safety-evidence-pack-subjective-readiness-injury-pain.md`](./2026-08-31-safety-evidence-pack-subjective-readiness-injury-pain.md)

**Scope:** Evidence appraisal, registry/coverage changes, policy descriptors, and behavior-identical decision lineage for the existing injury and clinical-symptom rules

**Out of scope:** Changing severity thresholds, restrictions, ceilings, red-flag handling, treatment advice, diagnosis, or return-to-sport clearance

---

## 1. Delivered outcome

SEP-B makes every scientific and product-policy premise materially used by the current injury and clinical-symptom path explicit, reviewable, and replayable without changing the selected recommendation.

The implementation was delivered in two reviewable workstreams within this stacked PR:

1. **SEP-B1 — evidence and policy inventory:** registered 48 claims and 53 sources, corrected the coverage taxonomy to 51 rows, and added alignment tests for the current policy.
2. **SEP-B2 — material-use lineage:** carries an ephemeral trace from check-in/injury composition into `RecommendationAudit.knowledgeRefs` and proves constraint/envelope/recommendation equivalence when that trace is removed.

Any executable restriction or ceiling change belongs in SEP-C. It must not be hidden inside evidence or lineage work.

---

## 2. Reconciled current behavior

These implementation facts supersede shorthand in the parent plan where wording differs.

### 2.1 Standing constraints and tissue response

`injuryPolicy.ts` `resolveEffectiveInjuryConstraints`:

- preserves or tightens an active standing constraint;
- can create a today-only constraint from tissue response when no active standing constraint exists;
- derives the worst severity across morning state, pain during training, after-training state, and next-morning reaction;
- maps severe to `exclude`, moderate to `limit`, mild to `monitor`, and normal/no response to no derived constraint;
- does not persist a today-only derived constraint.

`injuryPolicy.ts` `resolveInjuryRestrictions`:

- ignores constraints whose `reviewBy` is before the local date;
- passes through explicit restricted modalities on active constraints;
- gives `monitor` no region-derived restriction;
- gives `limit` a region-derived guardrail;
- gives `exclude` that guardrail plus only the extra restrictions encoded by the current mapping.

### 2.2 Region mapping

The current mapping contains four product-policy families:

| Family | Body regions | `limit` | Additional `exclude` effect |
|---|---|---|---|
| Lower-limb impact | knee, Achilles, ankle, calf | `avoid_high_impact` | restrict Running |
| Lower-limb strength | hamstring, quadriceps, adductor/groin, hip | `avoid_heavy_lower_body` | restrict Lower-body Strength and Full-body Strength |
| Lumbar loading | lower back | `avoid_heavy_spinal_loading` | also `avoid_heavy_lower_body` |
| Upper-limb loading | shoulder, elbow, wrist | `avoid_overhead_pressing` | restrict Upper-body Strength |

These are conservative product heuristics keyed by body region. A region label is not a diagnosis, and condition-specific rehabilitation or return-to-sport evidence does not automatically validate the exact mapping.

### 2.3 Generic clinical-symptom envelope

`adapters.ts` `mapCheckinToSubjectiveInput` sets `painFlag` when either `painOrInjury` is true or illness symptoms are present outside the allergy-like branch.

`rules.ts` `evaluateEnvelopes` then:

- adds Running to restricted modalities when `painFlag` is true;
- applies a Mobility ceiling when `painFlag` is true and the athlete has not already trained;
- applies a Rest ceiling when the athlete has already trained;
- treats any active injury restriction as a clinical flag even when `painFlag` is false.

This is therefore a **generic clinical-symptom envelope**, not a pain-only rule. SEP-B must not attach pain-specific evidence to an illness-derived decision without recording the source.

### 2.4 Composition and forecasts

- Standing constraints and today’s tissue-derived restrictions enter `UserContext.constraints` before the shared envelope runs.
- Structured tissue response and the generic boolean can both apply on the same day. They stack; structured input does not take precedence today.
- Today-only tissue responses are absent from future forecast context; active standing constraints remain applicable.
- Path A, Path B, imported sessions, and authored-session gates consume the composed restrictions or ceiling in different places. All must remain unchanged.

### 2.5 Lineage gap

The adapter keeps the restriction result but drops why it was produced. At `knowledgeLineage.ts`, the engine cannot reliably distinguish:

- standing mapping from tissue-derived mapping;
- explicit athlete restrictions from region-derived restrictions;
- pain/injury from non-allergy illness;
- `monitor` with no region restriction from a materially applied mapping.

Inferring origin later from flattened restrictions would create false lineage. SEP-B2 must carry explicit decision facts from the composition seam.

### 2.6 Governing architecture and ADR constraints

- `recommendation-engine.md` keeps the safety envelope shared across Path A and Path B; SEP-B must not create a second injury authority.
- ADR-0013 permits only explicit athlete and check-in inputs; SEP-B must not infer a diagnosis or silently decay standing constraints.
- ADR-0023 requires the same tissue and restriction authority across catalog, imported, and authored sessions.
- ADR-0032 owns cause-aware symptom mapping; the allergy-like branch must not regain illness/pain authority through lineage.
- ADR-0033 requires stable registry IDs with scientific and product-policy boundaries kept distinct.
- ADR-0010 requires persisted audit lineage and backward-compatible replay, while `POLICY_VERSION` changes remain tied to executable decision changes.

---

## 3. Decisions fixed by this review

### SEP-B-D1 — Separate science, product policy, and invariants

The exact severity translation, region mapping, and generic clinical-symptom envelope are `product_policy`, not `safety_invariant`.

Explicit restriction pass-through, standing-constraint preserve-or-tighten behavior, expiry, today-only scope for inferred constraints, deterministic deduplication, and fail-closed unsupported values remain safety invariants and require no scientific citation.

### SEP-B-D2 — Keep three semantic families independent

Tissue-response interpretation, region-to-restriction mapping, and the generic clinical-symptom envelope require separate claims, descriptors, coverage rows, and material-use tests. One source family must not imply validation of all three.

### SEP-B-D3 — Replace the aggregate region row

Retire `injury.region_restriction_mapping` and replace it with:

- `injury.region_mapping.lower_limb_impact`
- `injury.region_mapping.lower_limb_strength`
- `injury.region_mapping.lumbar_loading`
- `injury.region_mapping.upper_limb_loading`

Do not retain a counted aggregate parent without explicit non-counted aggregate semantics in the schema. Removing it avoids double counting.

### SEP-B-D4 — Preserve the pain-row ID, correct its meaning

Keep `injury.pain_envelope_mapping` as a stable inventory ID, but correct its title, `currentRule`, classification, and rationale to describe combined clinical-symptom semantics. Use a clearer clinical-symptom name for the product-policy claim.

### SEP-B-D5 — Do not over-attribute condition-specific evidence

Condition-specific guidelines may inform limitations, but must not appear in runtime lineage when the engine knows only a broad body region. Runtime attribution may include a general contextual/criteria-based assessment boundary and the exact product-policy descriptor. A condition-specific claim is eligible only when a future input contract establishes its applicability.

### SEP-B-D6 — Trace facts, not registry IDs, through composition

The composition seam should produce an optional, ephemeral trace resembling:

```ts
interface InjuryPolicyTrace {
  tissueSeverityApplied: boolean;
  regionMappingFamilies: InjuryRegionMappingFamily[];
  clinicalEnvelopeSources: Array<'pain_or_injury' | 'non_allergy_illness'>;
}
```

The final type must:

- be generated by the same pure helpers as the constraints and clinical flag;
- record only materially applied branches;
- exclude raw symptom values, free text, diagnoses, and other health detail;
- stay outside persisted user context and snapshots;
- be translated to claim IDs only in `knowledgeLineage.ts`;
- remain optional for backward-compatible replay.

### SEP-B-D7 — No silent policy-version workaround

`injuryPolicy.ts` is decision-affecting and must be added to the guarded files in `check-policy-drift.mjs`.

SEP-B2 should not bump `POLICY_VERSION` when executable outputs are identical. Add a narrow, fail-closed provenance-only path to the drift check, accepted only when:

- production changes add optional evidence/trace data;
- a decision-equivalence corpus proves identical restrictions, guardrails, categories, ceilings, modes, candidates, and recommendations;
- replay remains backward compatible; and
- no product descriptor value changes.

If any executable result changes, the exception fails and the change moves to SEP-C with the normal policy-version and simulation review.

### SEP-B-D8 — Preserve uncertainty

Expected initial outcomes are conservative:

- cross-tissue severity translation is likely `partial` / P0;
- region-only mappings are likely `partial` / P0;
- the broad generic clinical-symptom envelope is likely `partial` / P0.

Registry presence alone is not enough for `covered`. Direct support must match the exact rule granularity.

---

## 4. Evidence questions and seed sources

Each review records population, exposure/intervention, comparator, outcome, applicability, limitations, and whether a source supports science, a boundary, or only product-policy rationale.

### 4.1 Tissue response

Questions:

- Is response during activity, after activity, and next morning used to guide load progression?
- For which diagnosed tissues and populations?
- Does evidence support the exact state translation?
- Which missing or worsening signals require escalation?

Seed sources:

- Silbernagel et al., Achilles pain-monitoring model, PMID 17307888.
- Lower-limb tendinopathy load-progression systematic review, PMID 33444210.
- Living systematic review of lower-limb tendinopathy exercise, PMID 37553459.

### 4.2 Region mapping

Questions:

- Which restrictions are supported for diagnosed conditions within each family?
- Which guidance requires examination, functional criteria, or a named diagnosis?
- Is any source broad enough to validate the exact region-only mapping?
- Which mappings are conservative product defaults rather than scientific conclusions?

Seed sources:

- Team Physician Consensus Statement: Return to Sport, 2023 update, PMID 38709944.
- Return-to-sport decision-making review, PMID 38922556.
- Lateral ankle sprain CPG, PMID 33789434.
- Panther ACL return-to-sport consensus, PMID 32647735.
- Hamstring strain injury CPG, DOI 10.2519/jospt.2022.0301.
- Rotator cuff tendinopathy CPG, PMID 40165544.

### 4.3 Generic clinical symptoms

Questions:

- What does pain alone establish, and what contextual assessment is required?
- What supports reducing activity versus avoiding aggravating load?
- Does evidence support anatomy-agnostic Running restriction and Mobility ceiling?
- How must illness-derived symptoms differ from musculoskeletal pain in claims?

Seed sources:

- IOC consensus on pain management in elite athletes, PMID 28827314.
- Review distinguishing sports pain from sports injury, PMID 30482370.
- Umbrella review of exercise prescription for musculoskeletal pain, PMID 38093145.
- Team physician consensus on initial injury/illness assessment, PMID 38437494.

Seed sources are review candidates, not pre-approved support. SEP-B1 must appraise full text before registration.

---

## 5. Registry and coverage migration

### 5.1 Candidate scientific claims

Final identifiers depend on appraisal:

- `injury.symptoms.require_contextual_assessment`
- `injury.return_to_sport.criteria_based_risk_management`
- `injury.loading.symptom_guided_progression_condition_specific`
- `injury.tissue_response.temporal_monitoring_condition_specific`

Every claim must state what it does **not** support. No claim may imply the exact severity or region lookup table is externally validated unless a source directly establishes it.

### 5.2 Product-policy descriptors

Create exact, versioned descriptors:

- `policy.injury.tissue_response_severity_v1`
- `policy.injury.region_lower_limb_impact_v1`
- `policy.injury.region_lower_limb_strength_v1`
- `policy.injury.region_lumbar_loading_v1`
- `policy.injury.region_upper_limb_loading_v1`
- `policy.injury.generic_clinical_envelope_v1`

Descriptors name the trigger and result. They contain no treatment advice and claim no clinical validation.

### 5.3 Coverage rows

Start from the post-SEP-A inventory of 47 rows:

- split the tissue row into a product-policy severity row and safety-invariant preserve-or-tighten row: net +1;
- replace one aggregate region row with four family rows: net +3;
- retain and correct the pain-envelope row: net 0.

Expected structural total: **51 rows**. Tests assert the total and absence of the retired aggregate row.

| ID | Classification | Initial coverage | Priority |
|---|---|---|---|
| `injury.tissue_response_severity` | `product_policy` | `partial` unless the exact mapping is supported | P0 |
| `injury.standing_constraint_preserve_or_tighten` | `safety_invariant` | `not_applicable` | — |
| `injury.region_mapping.lower_limb_impact` | `product_policy` | `partial` | P0 |
| `injury.region_mapping.lower_limb_strength` | `product_policy` | `partial` | P0 |
| `injury.region_mapping.lumbar_loading` | `product_policy` | `partial` | P0 |
| `injury.region_mapping.upper_limb_loading` | `product_policy` | `partial` | P0 |
| `injury.pain_envelope_mapping` | `product_policy` | `partial` | P0 |

The appraisal, not these planning defaults, determines committed confidence and coverage.

---

## 6. SEP-B1 — Implemented evidence and policy inventory

### B1.1 Appraised evidence

- Retrieve full text and record metadata and tier.
- Extract claims only at supported population/condition granularity.
- Record conflicts and limitations.
- Separate diagnosis-specific guidance from broad region-level product choices.
- Complete red-flag boundary analysis without adding diagnosis or treatment behavior.

### B1.2 Registered and classified

- Add scientific claims with explicit applicability and limitations.
- Add all six product descriptors.
- Validate IDs, versions, categories, and confidence.
- Apply the 51-row migration and recompute statistics/backlog.
- Keep unsupported or partial P0 rows visible.

### B1.3 Pinned implementation alignment

Cover:

- every body region × `monitor`/`limit`/`exclude`;
- active, expired, and missing `reviewBy`;
- explicit restricted-modality pass-through;
- every tissue signal and worst-signal resolution;
- preserve-or-tighten behavior;
- structured response plus generic clinical flag;
- pain/injury, non-allergy illness, and allergy-like sources;
- today-only response absent from forecasts while standing constraints remain;
- exact descriptor/executable-mapping parity.

**B1 completion evidence**

- [x] Registry validation passes.
- [x] Coverage has 51 uniquely counted rows.
- [x] Descriptors are pinned to implementation.
- [x] `injuryPolicy.ts` is added to the policy-drift guard.
- [x] No recommendation, restriction, ceiling, or `POLICY_VERSION` change.

---

## 7. SEP-B2 — Implemented material-use lineage

### B2.1 Added behavior-neutral trace

- Refactor pure composition helpers to return the existing result plus optional trace facts.
- Preserve public behavior and backward-compatible inputs.
- Carry trace through `UserContext` only for the in-memory decision.
- Persist only resolved `KnowledgeRef` entries, never raw trace.

### B2.2 Mapped facts to refs

Extend `knowledgeLineage.ts` so:

- tissue refs appear only when tissue response creates or tightens a constraint;
- region-family policy appears only when that family produces a region-derived restriction;
- `monitor` with no region restriction gets no region policy ref;
- explicit restricted modality alone gets no region policy ref;
- generic envelope policy appears when that boolean branch applies;
- pain-context science appears only for pain/injury source;
- illness evidence, if registered, appears only for non-allergy illness source;
- both structured and generic refs appear when both branches apply;
- condition-specific science never appears from region alone.

Use existing deterministic sort, dedupe, and registry validation.

### B2.3 Proved equivalence

The frozen-oracle corpus covers the B1 matrix, shared envelope, Path A, Path B, imported sessions, authored gates, today/forecast composition, low readiness, already-trained, and no-injury controls.

Assert equality of:

- effective constraints;
- modalities, guardrails, and categories;
- ceiling and effective mode;
- eligibility and candidate set;
- recommendation and rationale, excluding new refs.

### B2.4 Verified persistence and replay

- Assert only resolved refs enter `RecommendationAudit`.
- Assert no raw tissue or source trace is persisted.
- Replay a new audit with refs.
- Replay a pre-SEP-B audit without trace or injury refs.
- Validate the provenance-only drift exception against the equivalence corpus.

**B2 completion evidence**

- [x] Material branches emit correct refs; non-material branches do not.
- [x] Decision-equivalence corpus is identical.
- [x] Replay accepts new lineage and remains backward compatible for audits without it.
- [x] Policy drift fails closed for executable differences outside the trace boundary.
- [x] `POLICY_VERSION` stays unchanged because equivalence is proven.

---

## 8. Verification

```bash
cd app
npx vitest run src/engine/injuryPolicy.test.ts
npx vitest run src/knowledge/sportsKnowledge.test.ts src/knowledge/knowledgeCoverage.test.ts
npx vitest run src/engine/knowledgeLineage.test.ts src/engine/provenance.test.ts src/engine/replay.test.ts
npm run check
npm run simulate:scenarios
npm run simulate:diff
npm run build
cd ..
make check
```

Also run `node app/scripts/check-policy-drift.mjs <base-sha>` with the actual PR base. A provenance-only pass is acceptable only after B2 equivalence succeeds.

---

## 9. Review checklist

### Evidence

- Claim scope matches population and diagnosed condition.
- Pain is not synonymous with injury.
- Region is not treated as diagnosis.
- Illness is not attributed to pain-only evidence.
- Product policy does not masquerade as scientific consensus.
- Red-flag analysis does not become diagnosis or treatment advice.

### Architecture

- Shared safety-envelope authority remains unchanged.
- Injury composition stays at `injuryPolicy.ts`/adapter boundaries.
- Knowledge IDs resolve in `knowledgeLineage.ts`, not policy logic.
- Trace is ephemeral and privacy-minimal.
- Forecast semantics remain unchanged.
- Every recommendation path remains behaviorally equivalent.

### Merge sequence

- SEP-A merged and branch rebased on `main`.
- SEP-B1 merged before SEP-B2.
- SEP-C receives every behavior-change proposal.
- Roadmap and parent plan reflect final outcomes.

---

## 10. Next action

Review and merge this stacked PR after SEP-A PR #317. Then rebase or retarget onto `main` as required by the merge order. Any policy behavior change remains SEP-C.
