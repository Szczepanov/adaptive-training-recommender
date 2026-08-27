# Physiological Identity Passport & Measurement Trust Analysis

**Date:** 2026-08-27
**Scope:** shared-surface recovery observations, with Eight Sleep via Google Health as the first concrete case
**Reviewed implementation:** `main` after merged PR #240 (`8312fe90`; implementation head `c787ecbd`)
**Related ADRs:** [ADR-0024](../adr/0024-biometric-baseline-estimator-policy.md), [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md), [ADR-0027](../adr/0027-source-aware-multisource-health-observations.md)
**Decision:** [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md)
**Implementation plan:** [Physiological Identity Passport & Measurement Trust](../plans/physiological-identity-passport-and-measurement-trust.md)

---

## 1. Executive conclusion

Merged PR #240 contains the beginnings of the correct safety boundary. ADR-0027 explicitly requires secondary-source identity/concordance before baseline learning (`D-MS-IDENTITY`, `D-MS-PREBASE`), and `CoPresenceValidator` now uses sleep-session overlap as well as RHR. Off-wrist Eight Sleep data are quarantined instead of being treated as verified.

The remaining problem is no longer “there is no identity gate.” It is:

> **The repository has a provisional concordance heuristic, but not yet a durable, learnable, versioned identity-attribution model whose evidence independence, review semantics, replay provenance and pre-baseline eligibility are structurally enforced.**

The merged implementation uses fixed defaults:

```text
minOverlapMinutes = 60
maxRhrDeltaBpm = 10
maxUnverifiedRhrDeltaBpm = 14
```

Those are reasonable temporary safety guards, not validated identity thresholds. More importantly, `computeSourceMetricBaseline()` still accepts raw source bundles and has no identity/effective-eligibility input. The ADR-level pre-baseline invariant can therefore still be bypassed by an ordinary caller.

The recommended architecture remains a provider-neutral **Measurement Trust Layer** with a versioned **Physiological Identity Passport**. Garmin Direct is the current personal-device anchor; Eight Sleep is a shared-surface source. The passport learns the athlete's **paired Garmin ↔ Eight Sleep relationship**, not merely an absolute “normal physiological range.”

The canonical automatic identity state is:

```text
USER | NOT_USER | UNCERTAIN
```

Automatic v1 should primarily produce `USER` or `UNCERTAIN`. `NOT_USER` should normally require explicit user confirmation until enough labelled negative examples exist. Abstention is cheap because Garmin normally remains available; false acceptance is expensive because wrong-person or mixed-person data can contaminate longitudinal state.

This review adds five architectural requirements that were missing from the first draft:

1. corroborating sources must be **sensor-lineage independent**, not merely different provider/transport tuples;
2. the automatic model output must remain immutable while manual corrections are append-only, with a separate **effective identity decision** consumed downstream;
3. suspected mixed occupancy cannot be cleared by a vague “it was me” confirmation — exclusive/full-interval attribution is required;
4. historical model/threshold evaluation must be **out-of-sample** rather than scoring nights with a passport fitted on those same nights;
5. replay provenance must contain **all contributing observation bundles**, feature-schema version, policy version and passport version, not only the shared-source bundle.

---

## 2. Current merged implementation state

PR #240 is merged into `main`, so PR #243 no longer depends on an unmerged branch.

### Improvements already adopted in PR #240

ADR-0027 now states the correct ordering:

```text
identity & session concordance
→ only verified/concordant secondary data
→ source-specific baseline accumulation
→ fusion/readiness
```

`CoPresenceValidator` now:

- accepts Garmin and Eight Sleep sleep intervals;
- calculates absolute overlap minutes;
- quarantines sessions with less than 60 minutes overlap;
- returns `UNVERIFIED_OFF_WRIST` with `verifiedAthlete=false` when Garmin is missing, even if Eight Sleep RHR looks plausible relative to historical RHR;
- uses `DISCORDANT_SECONDARY` as the primary disagreement status, retaining `IMPOSTER_REJECTED` only as a legacy alias.

These changes close two earlier problems: timing is no longer ignored, and a near-normal mattress RHR is no longer automatically granted authority when Garmin is absent.

### Remaining implementation gap

The merged code still implements:

```text
fixed timing threshold + fixed RHR threshold + boolean verification
```

The target is:

```text
versioned personal paired relationship
+ provenance-lineage independence
+ anchor technical quality
+ multi-feature evidence
+ ternary abstention
+ immutable automatic assessment
+ append-only manual review
+ derived effective eligibility
+ out-of-sample validation
+ full replay provenance
```

ADR-0028 therefore refines and operationalizes ADR-0027 rather than replacing it.

---

## 3. Empirical deployment context

The live-account evidence collected by the multisource work makes this an unusually tractable identity-attribution problem.

| Property | Current evidence / deployment behaviour | Design consequence |
|---|---|---|
| Garmin overnight coverage | 60 / 60 nights in the current audit | Garmin is normally available as an independent personal-device anchor. |
| Eight Sleep coverage | 42 / 60 nights | Eight Sleep is optional evidence; its absence must not degrade the primary path. |
| Eight Sleep-only nights | 0 / 60 in the audit | There is no empirical need for uncorroborated Eight Sleep authority in v1. |
| Garmin wear habit | effectively continuous overnight wear | Missing Garmin is missing identity evidence, not a normal operating mode to optimize around. |
| Wrong-person mattress use | rare | Negative labels will be sparse; conservative abstention is more realistic than a supervised negative classifier now. |
| Nights away from mattress | expected | Garmin-only travel nights are normal and should not trigger identity warnings. |
| Side assignment | athlete normally returns to the same mattress side | Useful context, but the Google Health route exposes no reliable physical-side/occupancy signal. |
| Historical identity labels | unavailable/unreliable | Historical bootstrap must tolerate sparse unknown contamination. |

The MS14 study reports 42 dual-monitored nights and stable Eight Sleep source-specific distributions. Those data support physiological baseline maturity. They do **not** prove the identity purity of every historical night.

> **Baseline maturity is not identity maturity.**

---

## 4. What Eight Sleep identity evidence is actually available

The Google Health mapper currently exposes useful nightly Eight Sleep data including:

- resting heart rate;
- HRV RMSSD;
- respiratory rate;
- exact sleep-session start/end timestamps;
- sleep duration;
- sleep-stage totals.

It does not expose through this route:

- raw Eight Sleep ballistocardiography waveform;
- continuous/epoch-level physiological series sufficient for person-level segmentation;
- real-time occupancy transitions;
- a reliable physical-side identity signal.

Published BCG identity work shows that person identification from raw bed-vibration features can be feasible in small household settings. That does **not** justify pretending nightly scalar summaries provide the same biometric information.

This limitation is especially important for partial occupancy: when the only physiological values are whole-night aggregates, there is no defensible method to reconstruct athlete-only HRV/RHR/respiration from a mixed night.

---

## 5. The causal separation that must survive implementation

The system must keep four questions separate:

```text
A. Provenance
   Which sensor/device/provider produced the observation, and through which transformations?

B. Technical quality
   Is the record and its proposed anchor structurally/technically usable?

C. Identity attribution
   Does this shared-source aggregate belong to the authenticated athlete, and is attribution pure enough?

D. Physiological interpretation
   If it is the athlete, is the physiology normal, strained, or anomalous?
```

For example:

```text
Garmin RHR elevated
Eight Sleep RHR elevated
paired relationship remains plausible
sleep sessions align

→ identity may still be USER
→ physiological anomaly may still be TRUE
```

A fixed “normal RHR range” is unsafe as an identity boundary. A real illness/recovery anomaly is exactly the situation in which genuine physiology may leave its normal range.

This aligns with ADR-0025: anomaly evidence should survive identity attribution rather than being censored by it.

---

## 6. External evidence and what it supports

### 6.1 Personal baselines are useful, but genuine physiology leaves them

A longitudinal analysis of 92,457 adults found substantially greater between-person than within-person RHR variability, supporting personal baselines. Yet substantial within-person fluctuations still occurred. Personal physiology is useful evidence, but “outside normal” cannot mean “not the user.”

Reference: Quer G, et al. *Inter- and intraindividual variability in daily resting heart rate...* PLOS One. 2020.
https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709

### 6.2 Raw cross-device HRV equality is not scientifically safe

Garmin's overnight HRV semantics depend on timing, sleep period and aggregation. Methodology reviews likewise identify recording duration, respiration, time of day, posture, environment and physiological state as comparability factors.

Therefore the passport should learn:

```text
normal Eight Sleep ↔ Garmin HRV relationship
```

not require:

```text
Eight Sleep HRV == Garmin HRV
```

References:

- Garmin, *HRV Status*. https://www.garmin.com/en-US/garmin-technology/health-science/hrv-status/
- *Heart rate variability measurement and influencing factors: Towards the standardization of methodology*. 2024. https://pubmed.ncbi.nlm.nih.gov/39351472/

### 6.3 Eight Sleep measurement accuracy is not identity attribution

Eight Sleep reports vendor-run validation of Pod HR/HRV against ECG. That supports the mattress as a meaningful physiological sensor. It does not establish that a nightly record belongs exclusively to the intended app user when another person can use the same surface.

Reference: Eight Sleep, *The Eight Sleep Pod Heart Rate and Heart Rate Variability Accuracy*. 2023.
https://www.eightsleep.com/blog/hrv-accuracy/

### 6.4 Raw bed-sensor person identification is promising but not directly available here

A 2025 Sensors study demonstrated household-sized person identification using raw piezoelectric BCG frequency features. This supports feasibility of the general problem, not applicability of that method to Google Health nightly summaries.

Reference: Takahashi K, Tanno Y, Ueno H. *Identification of People in a Household Using Ballistocardiography Signals Through Deep Learning*. Sensors. 2025.
https://pubmed.ncbi.nlm.nih.gov/40292805/

### 6.5 Abstention is a principled classification strategy

Reject-option/selective classification explicitly allows uncertain samples to remain unclassified to reduce error among accepted cases. That maps naturally to `UNCERTAIN`: the fallback cost is small, while false acceptance can modify future state.

Reference: Franc V, Prusa D, Voracek V. *Optimal Strategies for Reject Option Classifiers*. JMLR. 2023.
https://www.jmlr.org/papers/v24/21-0048.html

### 6.6 Selective-classification evaluation must report risk versus coverage

Recent evaluation work on selective classifiers emphasizes that abstaining systems should not be summarized by ordinary accuracy alone; evaluation must reflect the trade-off between accepted-case risk and coverage. For this system, threshold selection should therefore compare false acceptance/review burden/coverage rather than maximize the fraction of nights automatically classified.

Reference: Traub J, et al. *Overcoming Common Flaws in the Evaluation of Selective Classification Systems*. 2024.
https://arxiv.org/abs/2407.01032

### 6.7 Historical anomaly-style evaluation must avoid self-scoring

With only ~42 paired nights, a passport fitted on all nights and then used to score those same nights will produce optimistic evidence. Leave-one-out or chronological expanding-window replay is a safer activation test.

Reference: Hennhöfer O, Preisach C. *Leave-One-Out-, Bootstrap- and Cross-Conformal Anomaly Detectors*. 2024.
https://arxiv.org/abs/2402.16388

### 6.8 Provenance is part of trust, not bookkeeping

FHIR Provenance explicitly models the entities/processes involved in producing and delivering a resource to support authenticity, trust and reproducibility. For identity fusion, this means a Garmin-derived measurement re-exported through another transport cannot be treated as independent corroborating physiology merely because the final provider/transport tuple differs.

Reference: HL7 FHIR R4, *Provenance*. https://hl7.org/fhir/R4/provenance.html

### 6.9 The passport deserves high-sensitivity privacy treatment

Under GDPR, health data are special-category personal data; physiological data processed for unique identification may also meet the biometric-data definition. The exact lawful basis is deployment-specific and is not decided here, but the architecture should minimize and tightly control this derived identity/health model.

Reference: Regulation (EU) 2016/679, Articles 4 and 9.
https://eur-lex.europa.eu/eli/reg/2016/679/oj

---

## 7. Findings against merged PR #240

### PIP-1 — fixed 60/10/14 guards are provisional, not identity calibration

Current `CoPresenceValidator` defaults to:

```text
minOverlapMinutes = 60
maxRhrDeltaBpm = 10
maxUnverifiedRhrDeltaBpm = 14
```

The off-wrist path is safely quarantined, so the 14-bpm value does not grant baseline authority. However, the 10-bpm paired-RHR guard can still exclude an entire Eight Sleep night from one physiological discrepancy.

**Recommendation:** retain these only as compatibility/safety guards while the passport runs in shadow mode. Do not promote them to validated biometric thresholds.

### PIP-2 — session timing is used, but the feature is too lossy

Absolute overlap minutes can miss nested/mixed occupancy. Use at least:

```text
start delta
end delta
duration delta
intersection / union (Jaccard)
Eight Sleep overlap fraction
Garmin overlap fraction
```

### PIP-3 — the pre-baseline invariant is documented but not encoded in the baseline API

`computeSourceMetricBaseline()` filters by provider/transport and has no identity/effective-eligibility input.

**Recommendation:** baseline code must consume an identity-eligible projection or require effective identity decisions explicitly. `UNCERTAIN`, `NOT_USER`, and mixed-occupancy shared-source nights must be structurally unable to enter baseline learning.

### PIP-4 — one physiological dimension still dominates identity

The paired physiological check uses RHR only, while respiration and HRV are also available.

Candidate relation features:

```text
rhrResidual     = EightSleepRhr - GarminRhr
respResidual    = EightSleepResp - GarminResp
hrvLogResidual  = log(EightSleepHrv) - log(GarminHrv)
```

Missing features remain missing; never zero-fill them.

### PIP-5 — current statuses combine identity, availability and downstream policy

The current vocabulary mixes availability, concordance and quarantine. The target separates:

```text
automaticIdentity = USER | NOT_USER | UNCERTAIN
reviewEvidence = append-only events
effectiveIdentity = derived current authority
eligibility = display / recovery / baselineLearning / passportLearning
reasonCodes = evidence explanations
```

### PIP-6 — 42 paired nights can bootstrap a relationship, not a calibrated NOT_USER probability

The paired history supports robust estimation of normal cross-source relationships. Sparse/unreliable negative labels do not support a calibrated posterior `P(USER)` or reliable supervised `NOT_USER` classifier.

**Recommendation:** call the scalar an `identityScore`, not probability.

### PIP-7 — provider/transport diversity is not evidence independence

If the same sensor data can arrive through multiple transports or aggregators, naïve multisource fusion can count one physiological measurement twice.

**Recommendation:** add a provenance-lineage key/chain and require independent origin before one source can corroborate another. If independence cannot be established, do not count it as a separate vote.

### PIP-8 — immutable assessment and `manualOverride` are contradictory concepts

The first draft proposed an `IdentityAssessment` that simultaneously carried automatic status, eligibility and optional `manualOverride`, while also saying the automatic assessment must remain immutable.

**Recommendation:** split the model into:

```text
AutomaticIdentityAssessment   // immutable model output
IdentityReviewEvent[]         // append-only user/admin evidence
EffectiveIdentityDecision     // derived authority + eligibility
```

A correction appends a superseding review event. Baselines/fusion consume the effective decision.

### PIP-9 — “It was me” is insufficient for mixed occupancy

If a user was present for part of the night but another person used the mattress for another part, “It was me” is true while the aggregate remains mixed.

**Recommendation:** ask whether the measurements were the user's for the **full tracked interval**:

```text
Only me | Shared / mixed | Not me | Unsure
```

Only `USER + EXCLUSIVE` may clear a suspicious aggregate for downstream use.

### PIP-10 — historical replay needs an out-of-sample rule

Bootstrapping passport v0 from all 42 paired nights and then scoring those same 42 nights is useful descriptively but optimistic for activation decisions.

**Recommendation:** use leave-one-night-out or chronological expanding-window replay for threshold/model selection and risk/coverage reporting.

### PIP-11 — replay provenance currently under-specifies the evidence graph

A cross-source identity decision depends on both the shared-source bundle and anchor bundle(s). Referencing only the Eight Sleep bundle is not enough to reproduce the result.

**Recommendation:** persist:

```text
shared bundle id/revision/hash/lineage
all anchor bundle ids/revisions/hashes/lineages
featureSchemaVersion
passportVersion (nullable before maturity)
policyVersion
identityScore/tier/reasons
automaticStatus
reviewEvent used for effective state
```

### PIP-12 — anchor presence must be distinguished from anchor quality

A Garmin bundle may exist but still be unsuitable as identity anchor evidence because of wear/session/technical quality.

**Recommendation:** distinguish:

```text
ANCHOR_MISSING
ANCHOR_QUALITY_INSUFFICIENT
```

Both abstain rather than infer `NOT_USER`.

---

## 8. Revised Physiological Identity Passport definition

The passport is a versioned model of expected source-specific and cross-source relationships for one authenticated user.

```text
PhysiologicalIdentityPassport
├── metadata
│   ├── schemaVersion
│   ├── passportVersion
│   ├── policyVersion
│   ├── featureSchemaVersion
│   └── training-set fingerprint
├── anchorPolicy
│   ├── configured anchor source
│   ├── technical eligibility requirements
│   └── independent-lineage requirement
├── sourceProfiles
│   └── Eight Sleep supporting distributions
├── crossSourceProfiles
│   └── Eight Sleep ↔ Garmin residual/timing distributions
└── calibration
    ├── manual USER count
    ├── manual NOT_USER count
    ├── mixed occupancy count
    ├── UNCERTAIN count
    └── shadow/evaluation metadata
```

V1 should use robust statistics — median, scaled MAD, IQR and sample count — rather than a high-capacity model. Per-feature scale floors prevent near-zero dispersion from creating unstable scores.

A later robust multivariate/one-class method may contribute evidence after enough history exists, but anomaly novelty must never become synonymous with wrong-person identity.

---

## 9. Revised identity and review data model

```ts
type IdentityStatus = 'USER' | 'NOT_USER' | 'UNCERTAIN';
type OccupancyAttestation = 'EXCLUSIVE' | 'MIXED' | 'UNKNOWN';

interface ObservationBundleRef {
    id: string;
    provider: string;
    transport: string;
    revision: number;
    sourcePayloadHash: string;
    lineageKey: string;
}

interface AutomaticIdentityAssessment {
    id: string;
    sourceNightKey: string;
    automaticStatus: IdentityStatus;
    identityScore: number | null;
    confidenceTier: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
    reasonCodes: readonly string[];
    passportVersion: string | null;
    policyVersion: string;
    featureSchemaVersion: string;
    assessedAt: string;
    sharedBundleRef: ObservationBundleRef;
    anchorBundleRefs: readonly ObservationBundleRef[];
}

interface IdentityReviewEvent {
    id: string;
    assessmentId: string;
    label: IdentityStatus;
    occupancyAttestation: OccupancyAttestation;
    supersedesReviewEventId?: string;
    recordedAt: string;
}

interface EffectiveIdentityDecision {
    assessmentId: string;
    effectiveStatus: IdentityStatus;
    authority: 'AUTOMATIC' | 'MANUAL_REVIEW';
    eligibility: {
        display: boolean;
        recovery: boolean;
        baselineLearning: boolean;
        passportLearning: boolean;
    };
    reviewEventId?: string;
}
```

Do not add permanent vendor-named identity fields to `DailyRecoverySnapshot`; keep the provider-neutral observation boundary established by ADR-0027.

---

## 10. Historical bootstrap and evaluation

Treat the existing paired history as **mostly-user, sparsely contaminated, unlabeled**.

Bootstrap:

```text
paired independent-lineage sessions
→ robust preliminary center/scale
→ conservative central core
→ passport v0
→ suspicious history remains UNCERTAIN
```

For **activation evidence**, evaluate out of sample:

```text
leave-one-night-out
or
chronological expanding-window replay
```

Report risk/coverage sensitivity, changed baseline nights, reason-code distributions, and downstream fusion deltas. Do not report historical `NOT_USER` unless labels actually exist.

The passport-learning gate must be stricter than daily recovery use. Automatic self-training should remain disabled until separately validated to avoid a self-reinforcing contamination/confirmation loop.

---

## 11. Manual review loop

Only uncertain/suspicious mornings need interaction:

```text
Eight Sleep data not verified

Were these measurements yours for the full tracked sleep period?

[ Only me ] [ Shared / mixed ] [ Not me ] [ Unsure ]
```

Semantics:

- **Only me** → append `USER + EXCLUSIVE`; may become downstream eligible;
- **Shared / mixed** → append `UNCERTAIN + MIXED`; whole aggregate remains quarantined;
- **Not me** → append `NOT_USER`; exclude from recovery/baseline/passport-positive learning;
- **Unsure** → preserve `UNCERTAIN`.

The review event never overwrites the original automatic assessment. Later corrections append superseding events.

---

## 12. Firestore and replay direction

Recommended user-scoped ownership:

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{assessmentId}
users/{uid}/health_identity_review_events/{eventId}
```

Automatic assessments/passport state are server-owned. Client review writes are constrained to user-scoped allowed labels/attestations; clients cannot forge evidence, eligibility, score, version or lineage fields.

Recommendation/audit provenance should be able to answer:

```text
Why was Eight Sleep ignored?
→ automaticStatus=UNCERTAIN
→ effectiveStatus=UNCERTAIN
→ reasonCodes=[...]
→ shared bundle revision/hash/lineage=...
→ Garmin anchor bundle revision/hash/lineage=...
→ featureSchemaVersion=...
→ passportVersion=...
→ policyVersion=...
→ fallback=garmin_direct
```

---

## 13. Privacy and telemetry direction

The passport is derived from health physiology and is intentionally used to confirm whether measurements belong to a person. Treat it as highly sensitive derived data.

Design requirements:

- minimize stored features to those necessary for attribution;
- user-scoped access control;
- server-owned evidence/model state;
- retention, deletion and export support;
- encryption/pseudonymisation where appropriate;
- no raw HRV/RHR/respiration, residual vectors, lineage identifiers, payload hashes or identity scores in generic analytics label dimensions;
- do not model named household members.

This is an engineering privacy posture, not a statement of deployment-specific GDPR lawful basis.

---

## 14. Risks and mitigations

| Risk | Failure mode | Mitigation |
|---|---|---|
| false acceptance | wrong household member enters Eight Sleep baseline | abstention, typed pre-baseline eligibility, manual review |
| mixed occupancy | athlete present but nightly aggregate contains another person too | explicit occupancy attestation; whole-night quarantine |
| false rejection | real athlete anomaly rejected as identity mismatch | relational multi-feature model; anomaly separate from identity |
| self-contamination | accepted suspect nights teach passport | stricter passport-learning gate; no automatic self-training initially |
| duplicated evidence | same upstream sensor arrives through two transports and is counted twice | provenance-lineage independence |
| HRV protocol mismatch | same units treated as same construct | source-specific baselines + learned paired relation/log residual |
| sparse negatives | supervised NOT_USER model overfits | manual NOT_USER in v1; no fake probability |
| anchor quality failure | technically bad Garmin record treated as ground truth | explicit anchor technical eligibility |
| optimistic replay | passport evaluates its own training samples | leave-one-out / chronological replay |
| incomplete audit | identity decision cannot be reconstructed | persist all evidence refs + feature/policy/passport versions |
| source/algorithm drift | relation changes after source update | passport versions/eras + replay |
| privacy expansion | classifier learns specific household identities | USER/NOT_USER/UNCERTAIN only; minimize derived data |

---

## 15. What v1 should not build

Do not build:

- spouse/child/guest classification;
- deep-learning identity authority;
- raw BCG identity logic without raw BCG data;
- population-normal identity ranges;
- automatic `NOT_USER` from one metric;
- de-mixing of aggregate partial-night physiology;
- cross-provider raw HRV averaging;
- a unified identity + illness classifier;
- duplicated confidence from mirrored transports;
- automatic recursive self-training from its own accepted labels;
- a passport containing FTP, CPET, HR zones, 1RMs, injury constraints, or coaching goals.

---

## 16. Recommended architecture

```text
provider / Google Health
        ↓
source-aware immutable observation bundles         ADR-0027
        ↓
technical quality + provenance lineage
        ↓
night/session pairing
        ↓
Physiological Identity Passport assessment         ADR-0028
        ↓
immutable automatic assessment
        ↓
append-only review events
        ↓
effective identity + explicit eligibility
   ┌──────────────┴───────────────┐
   ↓                              ↓
USER + eligible                   UNCERTAIN / NOT_USER / MIXED
   ↓                              ↓
source-specific baseline          preserve + audit + UI review
   ↓                              ↓
physiological interpretation      trusted-source fallback
   ↓
multisource fusion
   ↓
recommendation
```

ADR-0027 already chose the pre-baseline ordering. ADR-0028 makes that choice **enforceable, independent-evidence-aware, learnable, replayable and user-correctable**.

---

## 17. References

### Repository

- [ADR-0010 — Decision Provenance and Audit Replay](../adr/0010-decision-provenance-and-audit-replay.md)
- [ADR-0024 — Biometric Baseline Estimator Policy](../adr/0024-biometric-baseline-estimator-policy.md)
- [ADR-0025 — Physiological Anomaly and Possible-Illness Signals](../adr/0025-physiological-anomaly-and-possible-illness-signals.md)
- [ADR-0027 — Source-Aware Multisource Health Observations](../adr/0027-source-aware-multisource-health-observations.md)
- [MS14 multisource shadow study](./2026-08-27-multisource-shadow-study.md)
- `app/src/engine/coPresenceValidator.ts`
- `app/src/engine/multisourceBaselines.ts`
- `app/src/engine/multisourceFusion.ts`
- `app/src/observations/models.ts`
- `src/garmin_sync/google_health_mapper.py`

### External

- Quer G, Gouda P, Galarnyk M, Topol EJ, Steinhubl SR. *Inter- and intraindividual variability in daily resting heart rate and its associations with age, sex, sleep, BMI, and time of year*. PLOS One. 2020. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709
- Garmin. *HRV Status*. https://www.garmin.com/en-US/garmin-technology/health-science/hrv-status/
- *Heart rate variability measurement and influencing factors: Towards the standardization of methodology*. 2024. https://pubmed.ncbi.nlm.nih.gov/39351472/
- Eight Sleep. *The Eight Sleep Pod Heart Rate and Heart Rate Variability Accuracy*. 2023. https://www.eightsleep.com/blog/hrv-accuracy/
- Takahashi K, Tanno Y, Ueno H. *Identification of People in a Household Using Ballistocardiography Signals Through Deep Learning*. Sensors. 2025. https://pubmed.ncbi.nlm.nih.gov/40292805/
- Franc V, Prusa D, Voracek V. *Optimal Strategies for Reject Option Classifiers*. JMLR. 2023. https://www.jmlr.org/papers/v24/21-0048.html
- Traub J, et al. *Overcoming Common Flaws in the Evaluation of Selective Classification Systems*. 2024. https://arxiv.org/abs/2407.01032
- Hennhöfer O, Preisach C. *Leave-One-Out-, Bootstrap- and Cross-Conformal Anomaly Detectors*. 2024. https://arxiv.org/abs/2402.16388
- HL7 FHIR R4. *Provenance*. https://hl7.org/fhir/R4/provenance.html
- Regulation (EU) 2016/679 (GDPR), Articles 4 and 9. https://eur-lex.europa.eu/eli/reg/2016/679/oj
