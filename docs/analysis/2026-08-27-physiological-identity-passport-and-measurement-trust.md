# Physiological Identity Passport & Measurement Trust Analysis

**Date:** 2026-08-27  
**Scope:** shared-surface recovery observations, with Eight Sleep via Google Health as the first concrete case  
**Reviewed implementation:** PR #240, including current review-head changes through `0c3373d`  
**Related ADRs:** [ADR-0024](../adr/0024-biometric-baseline-estimator-policy.md), [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md), [ADR-0027](../adr/0027-source-aware-multisource-health-observations.md)  
**Decision proposed:** [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md)  
**Implementation plan:** [Physiological Identity Passport & Measurement Trust](../plans/physiological-identity-passport-and-measurement-trust.md)

---

## 1. Executive conclusion

PR #240 now contains the beginnings of the correct safety boundary. The latest ADR-0027 explicitly says that secondary-source identity/concordance must happen before baseline learning (`D-MS-IDENTITY`, `D-MS-PREBASE`), and the current `CoPresenceValidator` uses sleep-session overlap as well as RHR. Those are meaningful improvements over the original RHR-only implementation.

The remaining problem is no longer “there is no identity gate.” It is:

> **The repository has an identity/concordance heuristic, but not yet a durable, learnable, versioned identity-attribution model whose eligibility contract is enforced by the baseline API.**

The current implementation still uses fixed scalar defaults (`10 bpm` paired RHR delta, `14 bpm` off-wrist baseline delta, `60 min` absolute sleep overlap), although current ADR-0027 itself says arbitrary scalar identity cutoffs should not be treated as biometric authentication. More importantly, `computeSourceMetricBaseline()` still accepts raw source bundles and has no identity assessment or eligibility input, while `evaluateMultisourceFusion()` receives precomputed baselines and applies concordance filtering later. The intended pre-baseline invariant therefore exists in documentation but is not structurally impossible to bypass in the TypeScript contract.

The recommended next step is a provider-neutral **Measurement Trust Layer** with a versioned **Physiological Identity Passport**. Garmin Direct is the current personal-device anchor; Eight Sleep is a shared-surface source. The passport learns the athlete's **paired Garmin ↔ Eight Sleep relationship**, not merely an absolute “normal physiological range.”

The canonical identity state should be:

```text
USER | NOT_USER | UNCERTAIN
```

Automatic v1 behaviour should primarily produce `USER` or `UNCERTAIN`. `NOT_USER` should normally require explicit user confirmation until enough labelled negative examples exist to validate an automatic negative classifier. The user-cost of abstention is low because Garmin remains available; the system-cost of false acceptance is higher because a wrong-person night can contaminate longitudinal baselines.

---

## 2. What changed in PR #240 during this review

The branch evolved while this analysis was being prepared. The current review head should be treated as the source of truth.

### Improvements already adopted

ADR-0027 now explicitly states:

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
- returns `UNVERIFIED_OFF_WRIST` with `verifiedAthlete=false` when Garmin is missing, even if Eight Sleep RHR looks plausible relative to the athlete baseline;
- uses `DISCORDANT_SECONDARY` as the primary disagreement status, retaining `IMPOSTER_REJECTED` only as a legacy alias.

These changes close two issues from the initial implementation: timing is no longer ignored, and a near-normal mattress RHR is no longer automatically treated as verified when Garmin is absent.

### Remaining gap

The current code still does not implement the full identity-passport concept proposed here:

```text
current
  fixed timing threshold + fixed RHR threshold

proposed
  versioned personal paired relationship
  + multi-feature evidence
  + ternary abstention
  + explicit eligibility
  + labelled review loop
  + replayable passport versions
```

ADR-0028 therefore **refines and operationalizes** ADR-0027 rather than replacing its new identity decisions.

---

## 3. Empirical deployment context

The live-account evidence already collected by the multisource work makes this an unusually tractable identity-attribution problem.

| Property | Current evidence / deployment behaviour | Design consequence |
|---|---|---|
| Garmin overnight coverage | 60 / 60 nights (100%) in the current audit | Garmin is normally available as an independent personal-device anchor. |
| Eight Sleep coverage | 42 / 60 nights (70%) | Eight Sleep is optional evidence; its absence must not degrade the primary path. |
| Eight Sleep-only nights | 0 / 60 in the audit | There is no empirical need for uncorroborated Eight Sleep authority in v1. |
| Garmin wear habit | effectively continuous overnight wear | Missing Garmin is missing identity evidence, not a normal operating mode to optimize around. |
| Wrong-person mattress use | rare, roughly quarterly | Negative labels will be sparse; conservative abstention is more realistic than a supervised classifier now. |
| Nights away from mattress | approximately 0–5 per month | Garmin-only travel nights are expected and should be treated as normal. |
| Side assignment | athlete normally returns to the same mattress side | Useful context, but the Google Health route exposes no side/occupancy sensor signal. |
| Historical identity labels | unavailable/recollection unreliable | Historical bootstrap must tolerate sparse unknown contamination. |

The MS14 study reports 42 dual-monitored nights, Eight Sleep HRV median `57.3 ms` with MAD `8.55 ms`, and respiration median `12.8 brpm` with MAD `0.29 brpm`. Those results establish stable source-specific distributions and sufficient sample count for physiological baselines. They do **not** prove the identity of every historical night.

This distinction is important: **baseline maturity is not identity maturity**.

---

## 4. What Eight Sleep identity evidence is actually available

The PR #240 Google Health mapper preserves provider provenance and currently exposes useful nightly Eight Sleep data including:

- daily resting heart rate;
- HRV RMSSD;
- respiratory rate;
- exact sleep-session start/end timestamps;
- sleep duration;
- deep / light / REM / awake totals.

It does not expose through this route:

- raw Eight Sleep ballistocardiography waveform;
- continuous/5-minute physiological epochs;
- mattress surface temperature;
- real-time occupancy transitions;
- a reliable physical-side identity signal.

That limitation defines the model class we should build. Published research suggests that household-level identity can be feasible from **raw** bed-vibration/BCG features, but those features are absent here. We should not imitate a raw-waveform biometric classifier using nightly scalar summaries.

---

## 5. The important causal separation

The system must keep four questions separate:

```text
A. Provenance
   Who/device produced this observation, and how did it arrive?

B. Technical quality
   Is the record structurally/technically usable?

C. Identity attribution
   Does this shared-source night belong to the authenticated athlete?

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

A fixed athlete “normal RHR range” is therefore unsafe as an identity boundary. A real illness/recovery anomaly is exactly the case where genuine physiology may leave its usual range.

This aligns with ADR-0025: anomaly evidence should survive identity attribution rather than being censored by it.

---

## 6. External evidence and what it supports

### 6.1 Personal baselines are real, but real people leave them

A longitudinal analysis of 92,457 adults found substantially greater between-person than within-person RHR variability, supporting personal baselines. Yet 20% of participants experienced at least one week with a 10 bpm-or-greater RHR fluctuation. Personal physiology is therefore useful evidence, but “outside normal” cannot mean “not the user.”

Reference: Quer G, et al. *Inter- and intraindividual variability in daily resting heart rate...* PLOS One, 2020.  
https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709

### 6.2 Raw cross-device HRV equality is not scientifically safe

Garmin documents that its HRV status is built from overnight measurements and notes that timing and duration matter when comparing HRV measurements. A 2024 methodology review likewise identifies recording duration, respiration, time of day, posture, environment, and physiological state as meaningful HRV comparability factors.

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

Eight Sleep reports vendor-run validation of Pod HR/HRV against ECG across more than 474 nights / 163 subjects. That supports the mattress as a meaningful physiological sensor. It does not establish that a record belongs to the intended app user when another person sleeps on the same surface.

Reference: Eight Sleep, *The Eight Sleep Pod Heart Rate and Heart Rate Variability Accuracy*. 2023.  
https://www.eightsleep.com/blog/hrv-accuracy/

### 6.4 Raw bed-sensor person identification is promising but not directly available

A 2025 Sensors study demonstrated household-sized person identification using raw piezoelectric BCG frequency features in ten participants, while noting daily variation as a limitation. This supports the feasibility of the general problem, not the applicability of that method to Google Health nightly summaries.

Reference: Takahashi K, Tanno Y, Ueno H. *Identification of People in a Household Using Ballistocardiography Signals Through Deep Learning*. Sensors. 2025.  
https://pubmed.ncbi.nlm.nih.gov/40292805/

### 6.5 Abstention is a principled classification strategy

Classification with a reject option explicitly allows uncertain samples to remain unclassified to reduce error among accepted cases. That maps naturally to `UNCERTAIN`: the fallback cost is small, while wrong-person false acceptance can alter future state.

Reference: Franc V, Prusa D, Voracek V. *Optimal Strategies for Reject Option Classifiers*. JMLR. 2023.  
https://www.jmlr.org/papers/v24/21-0048.html

---

## 7. Current PR #240 findings

### PIP-1 — ADR-0027 and `CoPresenceValidator` currently disagree on scalar cutoffs

Current ADR-0027 says the system must not “hard-code arbitrary scalar cutoffs” that conflate physiological stress/illness with wrong-person identity.

Current `CoPresenceValidator` nevertheless defaults to:

```text
minOverlapMinutes = 60
maxRhrDeltaBpm = 10
maxUnverifiedRhrDeltaBpm = 14
```

The off-wrist path is now safely quarantined, so the `14 bpm` value does not grant baseline authority. However, the `10 bpm` paired RHR bound can still convert one physiological discrepancy into `DISCORDANT_SECONDARY` and exclude the entire Eight Sleep night.

**Recommendation:** treat those constants as provisional engineering guards only. Replace them with a versioned athlete-specific paired relationship derived from actual paired history, with replay evidence for the acceptance boundary.

### PIP-2 — session timing is now used, but the feature is too lossy

The current implementation uses one feature:

```text
absolute overlap minutes >= 60
```

That is better than ignoring timing, but it can miss mixed/extended occupancy. For example, Eight Sleep could record 20:30–06:00 while Garmin records 23:30–06:00 and still easily exceed 60 minutes overlap.

Use at least:

```text
start delta
end delta
duration delta
intersection / union (Jaccard)
Eight Sleep overlap fraction
Garmin overlap fraction
```

Those features distinguish “same sleep interval” from “one interval merely contains the other.”

### PIP-3 — the pre-baseline invariant is documented but not encoded in the baseline API

ADR-0027 now correctly requires identity/concordance gating before baseline accumulation.

However, `computeSourceMetricBaseline()` still accepts:

```text
bundles, metric, provider, transport, referenceDate
```

and filters only by provider/transport. It has no identity assessment or eligibility input.

At the same time, `evaluateMultisourceFusion()` receives `baselines` as already-computed input and performs current-day `CoPresenceValidator` filtering afterward.

Even if some caller prefilters correctly today, the contract does not make `D-MS-PREBASE` enforceable. A future caller can pass raw Eight Sleep history and silently violate the ADR.

**Recommendation:** make eligibility typed and explicit:

```ts
selectEligibleHealthObservationBundles(..., 'baselineLearning')
```

or require identity assessments in `computeSourceMetricBaseline()` itself.

### PIP-4 — the current identity model is one physiological dimension

The current paired physiological check uses RHR only. Yet the data contract also has respiration and HRV, and paired history is available.

A robust passport should combine available independent evidence rather than allow a single RHR discrepancy to own the identity decision.

Initial relation features:

```text
rhrResidual = EightSleepRhr - GarminRhr
respResidual = EightSleepResp - GarminResp
hrvLogResidual = log(EightSleepHrv) - log(GarminHrv)
```

Missing features remain missing; they are never zero-filled.

### PIP-5 — current statuses combine identity, availability, and policy

The current status type contains:

```text
CONCORDANT
VERIFIED
DISCORDANT_SECONDARY
IMPOSTER_REJECTED
UNVERIFIED_OFF_WRIST
NO_SECONDARY_DATA
```

This mixes:

- whether Eight Sleep exists (`NO_SECONDARY_DATA`);
- identity confidence (`CONCORDANT`, `UNVERIFIED_OFF_WRIST`);
- downstream eligibility/quarantine policy;
- legacy wording (`IMPOSTER_REJECTED`).

**Recommendation:** separate canonical identity from availability and eligibility:

```text
identityStatus = USER | NOT_USER | UNCERTAIN
eligibility = display / recovery / baselineLearning / passportLearning
reasonCodes = [...]
```

### PIP-6 — current history is enough to bootstrap a relationship, not enough to calibrate NOT_USER probability

There are ~42 paired nights but no reliable historical USER/NOT_USER labels and expected wrong-person events are rare.

That supports robust estimation of “what paired user nights usually look like,” but not a calibrated posterior `P(USER)` or a reliable supervised `NOT_USER` classifier.

**Recommendation:** call the v1 scalar an `identityScore`, not a probability. Optimize false acceptance/coverage through shadow replay and prospective labels.

---

## 8. Physiological Identity Passport definition

The passport is a versioned model of expected source-specific and cross-source relationships for one authenticated user.

It is deliberately separate from the broader athlete performance profile.

```text
PhysiologicalIdentityPassport
├── metadata
│   ├── schemaVersion
│   ├── passportVersion
│   ├── policyVersion
│   └── training-set fingerprint
├── anchorPolicy
│   └── garmin_direct = PERSONAL_DEVICE_ANCHOR (current deployment)
├── sourceProfiles
│   └── eight_sleep
│       ├── RHR robust center/scale
│       ├── respiration robust center/scale
│       ├── log-HRV robust center/scale
│       └── sleep timing/duration distributions
├── crossSourceProfiles
│   └── eight_sleep ↔ garmin_direct
│       ├── RHR residual
│       ├── respiration residual
│       ├── log-HRV residual
│       ├── start/end/duration residuals
│       └── overlap/Jaccard distributions
└── calibration
    ├── trusted USER count
    ├── manual USER count
    ├── manual NOT_USER count
    ├── UNCERTAIN count
    └── shadow window
```

V1 should use robust statistics — median, scaled MAD, IQR, sample count — rather than a high-capacity model. Introduce per-feature minimum scale floors so near-zero historical dispersion cannot generate unstable z-scores.

A later robust multivariate/one-class method may contribute evidence after enough history exists, but anomaly novelty must not become synonymous with wrong-person identity.

---

## 9. Night/session-level identity

Identity should apply to the shared-source night/session bundle, not each scalar independently.

Prefer:

```text
Eight Sleep night = USER
```

not:

```text
RHR = USER
HRV = UNCERTAIN
respiration = USER
```

Metric-specific technical quality can still differ inside a trusted night.

This matters for partial occupancy. With only nightly aggregate physiology, a mixed night cannot be reliably separated into two people's contributions. If the session geometry suggests mixed occupancy, quarantine the complete Eight Sleep physiology bundle as `UNCERTAIN`; do not invent a corrected HRV/RHR value.

---

## 10. Ternary classification and explicit eligibility

### Identity state

| State | Meaning | V1 authority |
|---|---|---|
| `USER` | enough independent evidence that the shared-source night belongs to the athlete | high-confidence automatic concordance or manual confirmation |
| `NOT_USER` | explicitly established to belong to someone else | manual confirmation in v1 |
| `UNCERTAIN` | missing, conflicting, or insufficient identity evidence | automatic abstention |

### Eligibility

| Effective state | Display | Recovery | Baseline learning | Positive passport learning |
|---|---:|---:|---:|---:|
| manual `USER` | yes | yes | yes | yes |
| high-confidence automatic `USER` | yes | yes | after activation gate | initially conservative |
| `UNCERTAIN` | yes, badged | no | no | no |
| `NOT_USER` | audit/history | no | no | no |

This preserves raw data while making downstream authority explicit.

---

## 11. Historical bootstrap with 42 paired nights

Treat the existing paired history as **mostly-user, sparsely contaminated, unlabeled**.

Recommended bootstrap:

```text
paired sessions
→ feature extraction
→ robust preliminary center/scale
→ conservative central core
→ passport v0
→ re-score all history
→ leave suspicious historical nights UNCERTAIN
→ prospective user labels on suspicious mornings
```

Do not label historical outliers `NOT_USER` simply because they are unusual.

The passport training gate must be stricter than the daily recovery-use gate. Otherwise accepted-but-wrong observations can teach the model and create a self-reinforcing contamination loop.

---

## 12. Manual review loop

Only suspicious/uncertain mornings need user interaction:

```text
Eight Sleep data not verified

[ It was me ] [ Not me ] [ Unsure ]
```

Semantics:

- **It was me** → append manual `USER` label;
- **Not me** → append manual `NOT_USER` label, exclude Eight Sleep from recovery/baseline learning;
- **Unsure** → preserve `UNCERTAIN`.

The review event is append-only and replayable. It does not overwrite the original automatic assessment.

Use “unverified” / “discrepant,” not “imposter,” because the sensor can be correct while the attribution is wrong.

---

## 13. Data-model direction

Identity should be a sidecar to the source-aware observation bundle.

```ts
type IdentityStatus = 'USER' | 'NOT_USER' | 'UNCERTAIN';

type IdentityConfidenceTier = 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';

interface ObservationEligibility {
    display: boolean;
    recovery: boolean;
    baselineLearning: boolean;
    passportLearning: boolean;
}

interface IdentityAssessment {
    sourceNightKey: string;
    provider: string;
    transport: string;
    status: IdentityStatus;
    identityScore: number | null; // evidence score, not calibrated probability
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly string[];
    eligibility: ObservationEligibility;
    passportVersion: string;
    policyVersion: string;
    assessedAt: string;
    observationBundleRef: {
        id: string;
        revision: number;
        sourcePayloadHash: string;
    };
    manualOverride?: IdentityStatus;
}
```

Do not add permanent vendor-named identity fields to `DailyRecoverySnapshot`; keep the provider-neutral observation boundary established by ADR-0027.

---

## 14. Firestore direction

Recommended user-scoped ownership:

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{nightKey_provider_transport}
users/{uid}/health_identity_review_events/{eventId}
```

Recommendation/audit provenance should be able to answer:

```text
Why was Eight Sleep ignored?
→ identityStatus=UNCERTAIN
→ reasonCodes=[SESSION_TIMING_DISCORDANT, RHR_RELATION_DISCORDANT]
→ fallback=garmin_direct
→ passportVersion=...
→ policyVersion=...
→ source bundle revision/hash=...
```

Passport versions should be server-owned and immutable/rebuildable; client review writes should be constrained to append-only user-scoped review events.

---

## 15. Risks and mitigations

| Risk | Failure mode | Mitigation |
|---|---|---|
| false acceptance | wrong household member enters Eight Sleep baseline | abstention, typed pre-baseline eligibility, manual review |
| false rejection | real athlete anomaly rejected as identity mismatch | relational multi-feature model; anomaly separated from identity |
| self-contamination | accepted suspect nights teach passport | stricter passport-learning gate |
| HRV protocol mismatch | same units treated as same construct | source-specific baselines + learned paired relation/log residual |
| sparse negatives | supervised NOT_USER model overfits | manual NOT_USER in v1; no fake probability |
| mixed occupancy | aggregate is a two-person mixture | whole-night quarantine; no de-mixing |
| missing anchor | shared source looks normal but cannot be independently tied to athlete | `UNCERTAIN` |
| source/algorithm drift | cross-source relation changes after update | passport versions/eras + replay |
| privacy expansion | classifier learns individual family members | never model named household identities |

---

## 16. What v1 should not build

Do not build:

- wife/son/daughter/guest classification;
- deep-learning identity authority;
- raw BCG identity logic without raw BCG data;
- population-normal identity ranges;
- automatic `NOT_USER` from one metric;
- de-mixing of aggregate partial-night physiology;
- cross-provider raw HRV averaging;
- a unified identity + illness classifier;
- a passport containing FTP, CPET, HR zones, 1RMs, injury constraints, or coaching goals.

---

## 17. Recommended architecture

```text
provider / Google Health
        ↓
source-aware immutable observation bundle          ADR-0027
        ↓
technical quality
        ↓
night/session pairing
        ↓
Physiological Identity Passport assessment         ADR-0028
        ↓
explicit eligibility
   ┌──────────────┴───────────────┐
   ↓                              ↓
USER-eligible                     UNCERTAIN / NOT_USER
   ↓                              ↓
source-specific baseline          preserve + audit + UI review
   ↓                              ↓
physiological interpretation      trusted-source fallback
   ↓
multisource fusion
   ↓
recommendation
```

ADR-0027 already chose the pre-baseline ordering. ADR-0028 should make that choice **enforceable, learnable, replayable, and user-correctable**.

---

## 18. References

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
