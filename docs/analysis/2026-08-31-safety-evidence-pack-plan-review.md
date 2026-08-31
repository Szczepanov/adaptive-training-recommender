# Safety Evidence Pack implementation-plan review — normative amendments

**Date:** 2026-08-31
**Scope:** PR #313 (`docs/knowledge`: subjective readiness + injury/pain Safety Evidence Pack)
**Status:** Review-complete addendum. These amendments are normative for SEP-A / SEP-B implementation work.
**Recommendation behavior:** unchanged by this review.

## 1. Review verdict

The parent plan is directionally strong and should remain the base implementation plan. In particular, it correctly separates:

- scientific/clinical evidence that establishes a defensible boundary;
- explicit product policy that owns exact thresholds and conservative mappings;
- runtime material-use lineage that records which policy/claim actually participated;
- behavior-changing remediation, which belongs in a separate versioned PR.

That architecture should be kept.

The review identified **seven amendments that materially improve execution quality** before SEP-A / SEP-B starts:

1. reconcile the plan with the already-merged SKR1 lineage work in PR #312;
2. reuse the already-built Phase 9 subjective-baseline/drift measurement path rather than designing a competing calibration mechanism;
3. split `painFlag`'s two live authorities (mode override vs plan envelope) instead of allowing one claim family to blur both;
4. make runtime lineage contribution-based/counterfactual where multiple policies can produce the same restriction;
5. add explicit tests for today-only tissue-derived constraints and additive explicit restrictions;
6. strengthen the evidence protocol with psychometric-quality appraisal and a claim-level evidence-sufficiency matrix;
7. refresh the search anchors with current guidelines/consensus evidence while retaining older landmark trials only for the narrow question they answer.

The goal remains the same: **close epistemic ambiguity, not manufacture green coverage.**

---

## 2. Repository-state reconciliation

### 2.1 SKR1 is no longer a future prerequisite

PR #312 is merged. The implementation should therefore treat recommendation-level knowledge lineage as an existing platform capability:

- runtime emits stable claim IDs;
- persistence freezes `{claimId, version}` centrally;
- unknown/non-active claims fail closed at the audit boundary;
- historical recommendations compare frozen lineage with the current registry.

SEP-A and SEP-B should **extend this path**, not wait for it and not invent a second safety-provenance channel.

The parent plan's phrases such as "after #312 is merged" should be read as satisfied preconditions.

### 2.2 Phase 9 subjective-baseline infrastructure already exists

The current repository already contains a deliberate measurement-only subjective drift path:

- `engine/subjectiveBaseline.ts` computes an individualized prior-history baseline;
- `DailyReadiness` can carry `subjectiveBaseline`;
- `rules.ts` exposes `SubjectiveDriftPolicy = 'off' | 'drift'`;
- the live default remains `off`;
- the reference drift path is adverse-only and cannot relax an existing absolute safety trigger;
- Phase 9.1–9.7 are documented as complete; production authorization is intentionally deferred pending prospective evidence.

**SEP-A must not create a second longitudinal subjective model.** Its job is different:

1. evidence-review the current absolute subjective policy;
2. register the scientific measurement boundary and exact live absolute product policy;
3. decide what remains calibration debt;
4. use Phase 9's existing shadow/prospective infrastructure as the preferred future calibration/remediation candidate.

Until `SubjectiveDriftPolicy` becomes live, SEP-A must not attribute a drift-policy claim to production recommendations merely because a baseline object exists.

### 2.3 Existing `readinessKnowledgeRefs` deliberately covers objective readiness only

`engine/knowledgeLineage.ts:readinessKnowledgeRefs` currently omits the uncovered subjective family by design. SEP-A should extend this pure lineage layer rather than resolving registry versions from `rules.ts`.

---

## 3. Critical semantic amendment: `painFlag` owns two separate live decisions

The parent plan correctly notices generic pain, but the current executable policy gives `painFlag` **two independent authorities**:

### Surface A — mode override

In `evaluateReadinessAndSafetyEnvelope`:

```text
painFlag -> extremeFatigue -> recover
```

This is stronger than merely contributing to the five-item readiness average. It is a hard safety override.

### Surface B — generic clinical envelope

In `evaluateEnvelopes`:

```text
painFlag -> clinicalFlagActive
painFlag -> Running added to restricted modalities
painFlag -> maxAllowableTier = Mobility
```

These are anatomically nonspecific plan restrictions.

### Required claim/coverage ownership

Do **not** hide Surface A inside `policy.readiness.subjective_mode_thresholds_v1` while independently registering Surface B as injury/pain policy. That would make a single signal look like two unrelated evidence authorities and make future remediation difficult to version.

Preferred decomposition:

- `policy.readiness.subjective_mode_thresholds_v1`
  - fatigue, soreness, readiness, sleep quality, motivation, stress and their exact current thresholds/combinations;
  - **exclude the generic `painFlag` hard override from this product claim**.
- `policy.injury.generic_pain_recover_override_v1`
  - exact `painFlag -> recover` behavior.
- `policy.injury.generic_pain_envelope_v1`
  - exact `painFlag -> clinical flag + Running restriction + Mobility tier cap` behavior.

Coverage inventory should mirror that split. Either:

1. add a child row such as `injury.pain_recover_override` alongside `injury.pain_envelope_mapping`; or
2. make `injury.pain_envelope_mapping` an explicit umbrella with separate children for mode and envelope authority.

The first option is cleaner because the two policies can later be remediated independently.

### Runtime attribution rule

When `painFlag` is true and both surfaces are evaluated, both product-policy refs may be material. Neither path may imply a diagnosed body region.

A shoulder/wrist pain flag must never acquire knee/Achilles/ankle evidence simply because the generic rule happens to restrict Running.

---

## 4. Runtime lineage must reflect contribution, not ambient policy evaluation

Safety policy has more overlapping authority than the existing objective-readiness lineage. Input-presence attribution alone can therefore overstate what influenced a recommendation.

### 4.1 Explicit user/clinician restrictions are not region-mapping inference

`resolveInjuryRestrictions` adds `InjuryConstraint.restrictedModalities` before any region/severity switch.

Therefore:

- if an explicit restriction alone contributes `Running`, do not automatically attribute a region-mapping claim;
- if a region policy adds no new restriction/guardrail/category because the same constraint is already explicit, prefer not to claim that mapping materially changed the decision;
- explicit user/clinician-authored constraints should retain their own provenance/authority rather than inheriting scientific authority from an inferred region mapping.

### 4.2 Preferred materiality test

For injury mapping, derive lineage from **policy contribution to the effective restriction surface**, not merely from the presence of an injury input.

Conceptually:

```text
explicit restrictions
      + region mapping
      + tissue-derived severity changes
      -> effective restrictions / guardrails / categories
```

A product mapping claim is material when removing that mapping would change one of the effective decision constraints consumed downstream.

Implementation can use either:

- a pure resolver returning `{restrictions, knowledgeRefs}` while tracking contribution; or
- a pure lineage helper that computes the delta from explicit/base restrictions to final mapped restrictions.

Avoid source-text inspection or ambient global collectors.

### 4.3 Tissue-response lineage should also be contribution-aware

Do not add `policy.injury.tissue_response_severity_v1` solely because a `RegionTissueResponse` object exists.

Examples:

- all observations `normal` -> no derived severity -> no tissue-severity policy ref;
- `mild -> monitor` with no downstream restriction change -> normally no decision-authority ref unless another engine surface explicitly consumes `monitor`;
- `moderate -> limit` that creates/tightens a restriction -> tissue-severity policy is material;
- `severe -> exclude` that adds a stronger category/modality restriction -> tissue-severity policy is material.

A scientific monitoring claim may be broader than a product-action claim, but recommendation lineage should still represent claims actually consumed by the decision path.

---

## 5. Add two high-safety edge cases to SEP-B tests

### 5.1 Today-only derived constraint

Current `resolveEffectiveInjuryConstraints` can create a temporary constraint when today's tissue response produces a derived severity but no active standing constraint exists:

```text
{ region, severity: derived, reviewBy: today, note: "Derived from today's tissue check-in" }
```

SEP-B must test this explicitly:

- no standing constraint + moderate/severe response creates only today's effective restriction;
- the relevant tissue-severity and region-mapping lineage appears only if that temporary constraint materially changes the decision surface;
- the temporary value is not persisted as a standing injury;
- a later date does not inherit it unless new input/standing policy supplies it.

### 5.2 Expired standing constraint + fresh adverse tissue response

Current code intentionally allows a fresh same-day tissue response to create a bounded effective constraint even when all standing constraints for that region have expired.

Test that:

- expiry does not resurrect the old constraint;
- fresh response can still create today's restriction;
- lineage points to today's tissue policy and applicable region policy, not to the expired constraint as if it were active.

### 5.3 Explicit restrictions remain additive under `monitor`

Because explicit restricted modalities are added before the `severity === 'monitor'` short-circuit, a monitor-level injury may still have a user/clinician-authored modality restriction.

Add a policy-alignment test so a future refactor does not accidentally make `monitor` erase explicit restrictions.

---

## 6. Evidence protocol amendment: measurement quality is a first-class evidence question

The original source hierarchy is sensible, but SEP-A should make **psychometric validity** an explicit gate rather than merely a field in source appraisal.

### 6.1 Why this matters

A COSMIN-based systematic review of athlete-reported outcome measures found that most measurement properties of multi-item instruments were acceptable with important gaps, while the commonly used single-item athlete measures had essentially no validity evidence beyond a small amount of reliability/responsiveness work. That is directly relevant to this product because its daily subjective inputs are single-item 1–10 ratings.

Therefore SEP-A must distinguish:

1. **practical monitoring prevalence** — a measure is commonly used;
2. **responsiveness/association** — it moves with training/load/context;
3. **measurement validity/reliability** — the score measures a stable interpretable construct;
4. **decision validity** — using that score to change training improves outcomes or safety;
5. **numeric threshold validity** — a specific cut-point has prospective action validity.

Evidence at level 1 or 2 must never be promoted directly to level 4 or 5.

### 6.2 Required subjective evidence anchors

Add these to SEP-A reconnaissance/appraisal:

#### Jeffries et al., 2020 — COSMIN systematic review

- PMID `32957081`
- DOI `10.1123/ijspp.2020-0386`
- relevance: measurement-property quality of athlete-reported monitoring tools; especially important caution for single-item measures.

#### Duignan et al., 2020 — single-item athlete wellbeing systematic review

- PMID `32991706`
- PMCID `PMC7534939`
- DOI `10.4085/1062-6050-0528.19`
- relevance: single-item fatigue/soreness/sleep/stress/mood associations with load varied from none to large and were often trivial-to-moderate in larger datasets; supports contextual rather than universal action interpretation.

#### 2025 football load-response meta-analysis

- PMID `40159621`
- relevance: pooled short-term associations with wellbeing/fatigue/soreness/sleep/stress exist, but heterogeneity, bias and imprecision led to very-low-certainty evidence. This is useful evidence **against false precision** in fixed cross-athlete cut-points.

Keep Saw et al. 2016/2017 as important prior syntheses/implementation guidance, but appraise them alongside these newer measurement-quality results.

---

## 7. Evidence protocol amendment: refresh clinical anchors and preserve condition specificity

The 2007 Achilles pain-monitoring RCT remains a useful landmark primary study, but it should no longer be the primary current clinical anchor for Achilles management.

### 7.1 Current higher-level anchors to add

#### Midportion Achilles tendinopathy CPG revision — 2024

- PMID `39611662`
- DOI `10.2519/jospt.2024.0302`
- use: current condition-specific management boundary for Achilles tendinopathy.
- limitation: does not validate a generic `achilles` region rule for rupture, insertional pathology, acute trauma or every calf/ankle presentation.

#### Team Physician Return-to-Sport consensus update — 2024 publication

- PMID `38616326`
- DOI `10.1249/MSS.0000000000003371`
- use: current broad return-to-sport decision framework.
- limitation: consensus architecture, not validation of this product's exact restriction state machine.

#### London International Consensus on hamstring injuries, part 3 — 2023

- PMID `36650032`
- DOI `10.1136/bjsports-2021-105384`
- use: strong example that progression is individualized, capacity/symptom based and activity-specific; the panel explicitly did not establish one universal pain threshold across rehabilitation tasks.
- limitation: hamstring-specific expert consensus.

#### Bern shoulder consensus — 2022

- PMID `34972489`
- DOI `10.2519/jospt.2022.10952`
- use: upper-extremity return-to-sport/load/risk-management boundary.
- limitation: explicitly notes absence of high-quality evidence and supports principle-based rather than one-size-fits-all rules.

#### Lateral ankle sprain CPG — 2021

- PMID `33789434`
- DOI `10.2519/jospt.2021.0302`
- keep as a diagnosis-specific lower-leg anchor.

#### Low-back-pain CPG — 2021

- PMID `34719942`
- PMCID `PMC10508241`
- DOI `10.2519/jospt.2021.0304`
- use: important counterexample to treating a body-region pain label as a scientific mandate to avoid loading; management uses condition/function/context-specific non-pharmacologic interventions.

### 7.2 Evidence-use rule

A region child family may cite multiple condition-specific sources to define **what the product cannot safely infer from region alone**. Those sources do not jointly create a universal region contraindication by accumulation.

For each candidate claim, state the direction explicitly:

```text
SUPPORTED: what this condition-specific evidence permits us to say.
NOT SUPPORTED: what it does not authorize the generic product mapping to claim scientifically.
PRODUCT POLICY: the conservative mapping retained because diagnosis/function detail is unavailable.
```

---

## 8. Add a claim-level evidence-sufficiency matrix

Each SEP-A / SEP-B analysis should contain a machine-reviewable-looking table (plain Markdown is sufficient) with one row per candidate claim or policy family.

Minimum columns:

| Field | Meaning |
|---|---|
| `claim/policy id` | proposed stable ID |
| `decision surface` | exact engine behavior it can authorize |
| `population/condition` | evidence scope |
| `best source type` | guideline/review/RCT/consensus/product policy |
| `directness` | direct / partially direct / indirect |
| `measurement validated?` | yes/no/not applicable |
| `action rule validated?` | whether changing training based on the signal was tested |
| `numeric threshold validated?` | whether the exact product scalar/cut-point was tested |
| `contradictory evidence` | short summary or none found |
| `product fallback` | retained heuristic/invariant/remediation |
| `coverage outcome` | covered/partial/uncovered/not-applicable |
| `lineage eligibility` | exact material-use condition |

This matrix should be the evidence-review handoff into implementation. It reduces the risk that prose nuance disappears when claims are encoded.

---

## 9. Reproducibility: require an explicit search log

The parent plan says the search should be reproducible; make that operational.

For each workstream record:

- database/search surface (at minimum PubMed/MEDLINE; add SPORTDiscus/Scopus/Web of Science when available and useful);
- final search date;
- exact query strings;
- language/date filters, if any;
- inclusion/exclusion criteria;
- duplicate handling;
- count screened/selected at a practical level appropriate for an engineering evidence pack;
- reason a key source was included;
- explicit negative search for exact live thresholds/cut-points;
- date/version of guidelines.

A full publication-grade PRISMA process is not required for every product claim, but the pack must leave enough record that another engineer can reproduce the evidence boundary rather than trust a citation list.

Preferred artifacts:

```text
docs/analysis/<date>-evidence-pack-subjective-readiness.md
docs/analysis/<date>-evidence-pack-subjective-readiness-search-log.md

docs/analysis/<date>-evidence-pack-injury-pain.md
docs/analysis/<date>-evidence-pack-injury-pain-search-log.md
```

A search-log section embedded in each analysis is acceptable if it remains structured and complete.

---

## 10. Revised SEP-A scope

SEP-A remains the correct first implementation PR, with these amendments.

### 10.1 Scientific boundary claims

Retain the proposed categories, but strengthen them with measurement-quality language:

- contextual/longitudinal value of athlete self-report;
- psychometric/administration limitations of single-item measures;
- non-equivalence of fatigue, soreness, stress, sleep quality, motivation and perceived readiness;
- absence (if the search confirms it) of validated universal product-matching 1–10 action cut-points.

### 10.2 Product policy representation

Create a normalized, testable representation of the **non-pain** absolute subjective rule:

- five-item aggregate dimensions and inversion directions;
- `>5` / `>7` transitions;
- soreness/fatigue independent thresholds;
- stress/readiness/fatigue combinations.

The policy representation should be imported by or generated from named constants where a behavior-identical refactor is safe. Avoid brittle tests that grep source code text.

### 10.3 Phase 9 integration

SEP-A should reference Phase 9 as calibration infrastructure:

- do not duplicate its 7/28 baseline estimator;
- do not make the default-off drift policy live;
- do not add drift lineage to production decisions while the selector remains off;
- use Phase 9.0/9.8 prospective evidence as a natural future input to threshold/drift calibration;
- any later live cutover requires its own policy/version decision and semantic regression review.

### 10.4 Likely disposition

Do not pre-decide coverage.

A reasonable expected outcome is **retain + calibrate** if the exact absolute thresholds remain intentionally conservative product policy but lack direct external cut-point validation. `covered` is acceptable only if repository semantics are satisfied by an explicit scientific boundary + explicit reviewed product policy + policy-alignment tests + documented calibration debt. If safety reviewers do not accept the threshold rationale, keep the family `partial`.

---

## 11. Revised SEP-B scope

### 11.1 Keep the region-family decomposition

The four proposed region clusters remain useful as **product policy families**, not as diagnoses.

### 11.2 Add pain-mode override as its own child family

As described in section 3, model `painFlag -> recover` separately from `painFlag -> Mobility/Running envelope`.

### 11.3 Add contribution-aware provenance

Tests must prove:

- explicit restriction only -> no unrelated inferred mapping lineage;
- knee mapping -> lower-leg policy only;
- shoulder mapping -> upper-extremity policy only;
- generic pain -> generic pain policies only, never region evidence;
- tissue response with no effective change -> no product-action lineage;
- tissue response that tightens/creates restrictions -> tissue severity + applicable region policy;
- expired injury without fresh tissue input -> no active region lineage;
- expired injury + fresh adverse response -> today-only lineage for the fresh path;
- duplicates are deterministically removed before audit snapshotting.

### 11.4 Generic pain likely deserves remediation review even if retained temporarily

The current boolean has no location, mechanism, severity, function, swelling/instability or neurological context. A product may intentionally fail closed, but that should be recorded as an explicit temporary safety policy with a measurable false-conservative cost.

SEP-B should therefore produce one of:

- `retain + calibrate/UX debt`, with a named review trigger; or
- `partial/remediate`, opening a structured pain-context feature.

Do not let adding a product-policy citation turn this issue into permanent closed debt by default.

---

## 12. Validation gates — strengthened

In addition to the parent plan's tests, require:

### Documentation/evidence

- search log complete;
- evidence-sufficiency matrix complete;
- every high-safety scientific claim has a directness statement and condition/population scope;
- every product-policy claim says which exact code surface it represents;
- single-item subjective measurement validity is not assumed from popularity/use;
- guideline/consensus recommendation strength is not promoted to causal outcome certainty.

### Policy alignment

- exact constants/combinations match executable code;
- `painFlag` mode override and plan envelope are separately represented;
- explicit restricted modalities remain additive;
- monitor/limit/exclude ordering and region effects remain unchanged;
- today-only tissue constraints and expiry semantics are preserved.

### Runtime lineage

- active claim lookup remains fail-closed;
- claim versions are still frozen only at the central audit boundary;
- no default-off Phase 9 subjective-drift refs appear in production lineage;
- no region evidence leaks into generic pain lineage;
- no region policy is attributed when it contributed no restriction relative to explicit/base constraints;
- lineage remains deterministic and under the global ref-count cap.

### Behavior preservation

Evidence migration PRs must still show zero semantic recommendation delta. A refactor made solely to expose named policy constants must be proved behavior-identical before merge.

---

## 13. Revised execution sequence

### Phase 0 — now satisfied / reconcile

- PR #312 is merged: mark SKR1 prerequisite satisfied.
- Read current `rules.ts`, `injuryPolicy.ts`, `knowledgeLineage.ts`, `subjectiveBaseline.ts`, Phase 9 plan and coverage inventory before implementing claims.
- Record the two pain decision surfaces separately.

### SEP-A — subjective readiness evidence + absolute policy lineage

1. run reproducible psychometric + athlete-monitoring evidence search;
2. explicitly search for product-matching absolute thresholds;
3. build evidence-sufficiency matrix;
4. register narrow scientific boundary claims;
5. register exact non-pain subjective product policy;
6. add normalized policy-alignment tests;
7. update coverage honestly;
8. add material-use lineage for the live absolute subjective family only;
9. connect calibration debt to existing Phase 9 shadow/prospective infrastructure;
10. prove zero recommendation delta.

### SEP-B — injury/pain evidence + mapping decomposition + lineage

1. review current RTS consensus and condition-specific guidelines by region cluster;
2. appraise symptom-guided loading by condition/tissue;
3. split generic pain mode override from generic pain envelope;
4. build evidence-sufficiency matrix;
5. register product policy families separately;
6. add contribution-aware lineage;
7. add today-only/expired/explicit-restriction edge-case tests;
8. update parent/child coverage;
9. create remediation issue/PR where generic region or pain abstractions remain unsafe/over-broad;
10. prove zero recommendation delta.

### SEP-C1+ — behavior remediation

Unchanged in principle: one behavior family per reviewable PR, explicit old/new policy table, `POLICY_VERSION` decision, deterministic simulation/judge comparison, safety corpus, UX impact and lineage changes.

---

## 14. Research interpretation summary

The deeper evidence review supports the **epistemic architecture** of PR #313 but argues for even more caution about translating measurement into action:

- athlete self-report is useful context, but common single-item measures have important validation gaps;
- short-term training-load relationships with subjective wellbeing exist but are heterogeneous and low-certainty;
- contemporary return-to-sport guidance is criteria-, function-, sport- and condition-specific rather than a universal pain threshold/state machine;
- selected rehabilitation contexts tolerate or deliberately use graded loading with symptoms, so "pain exists" is not scientific proof of universal rest;
- current product safety mappings may still be intentionally conservative, but their authority must be labeled **product policy**, and their usability/safety cost should remain measurable debt rather than being laundered into clinical fact.

That conclusion strengthens the original plan's core rule:

> **Scientific evidence defines what may be claimed. Product policy owns exact conservative behavior. Runtime lineage records only the policy/claim that actually contributed. Behavior changes are reviewed separately.**

---

## 15. References added by this review

1. Jeffries AC, Wallace L, Coutts AJ, McLaren SJ, McCall A, Impellizzeri FM. *Athlete-Reported Outcome Measures for Monitoring Training Responses: A Systematic Review of Risk of Bias and Measurement Property Quality According to the COSMIN Guidelines.* Int J Sports Physiol Perform. 2020. PMID 32957081. DOI 10.1123/ijspp.2020-0386. https://pubmed.ncbi.nlm.nih.gov/32957081/
2. Duignan C, Doherty C, Caulfield B, Blake C. *Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing and Their Relationship With Training Load: A Systematic Review.* J Athl Train. 2020. PMID 32991706. PMCID PMC7534939. DOI 10.4085/1062-6050-0528.19. https://pubmed.ncbi.nlm.nih.gov/32991706/
3. *The short-term relation between load and acute psychophysiological responses in football: a meta-analysis and methodological considerations.* 2025. PMID 40159621. https://pubmed.ncbi.nlm.nih.gov/40159621/
4. Chimenti RL, Neville C, Houck J, et al. *Achilles Pain, Stiffness, and Muscle Power Deficits: Midportion Achilles Tendinopathy Revision - 2024.* J Orthop Sports Phys Ther. 2024. PMID 39611662. DOI 10.2519/jospt.2024.0302. https://pubmed.ncbi.nlm.nih.gov/39611662/
5. Herring SA, Putukian M, Kibler WB, et al. *Team Physician Consensus Statement: Return to Sport/Return to Play and the Team Physician: A Team Physician Consensus Statement-2023 Update.* Med Sci Sports Exerc. 2024. PMID 38616326. DOI 10.1249/MSS.0000000000003371. https://pubmed.ncbi.nlm.nih.gov/38616326/
6. Paton BM, Read P, van Dyk N, et al. *London International Consensus and Delphi study on hamstring injuries part 3: rehabilitation, running and return to sport.* Br J Sports Med. 2023. PMID 36650032. DOI 10.1136/bjsports-2021-105384. https://pubmed.ncbi.nlm.nih.gov/36650032/
7. Schwank A, Blazey P, Asker M, et al. *2022 Bern Consensus Statement on Shoulder Injury Prevention, Rehabilitation, and Return to Sport for Athletes at All Participation Levels.* J Orthop Sports Phys Ther. 2022. PMID 34972489. DOI 10.2519/jospt.2022.10952. https://pubmed.ncbi.nlm.nih.gov/34972489/
8. Martin RL, Davenport TE, Fraser JJ, et al. *Ankle Stability and Movement Coordination Impairments: Lateral Ankle Ligament Sprains Revision 2021.* J Orthop Sports Phys Ther. 2021. PMID 33789434. DOI 10.2519/jospt.2021.0302. https://pubmed.ncbi.nlm.nih.gov/33789434/
9. George SZ, Fritz JM, Silfies SP, et al. *Interventions for the Management of Acute and Chronic Low Back Pain: Revision 2021.* J Orthop Sports Phys Ther. 2021. PMID 34719942. PMCID PMC10508241. DOI 10.2519/jospt.2021.0304. https://pubmed.ncbi.nlm.nih.gov/34719942/

These sources are **review anchors**, not automatic active claims. SEP-A/SEP-B still require source-by-source appraisal and claim wording no broader than direct support.
