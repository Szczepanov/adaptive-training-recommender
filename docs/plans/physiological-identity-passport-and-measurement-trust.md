# PI — Physiological Identity Passport & Measurement Trust

* **Status:** `Approved`
* **Proposed:** 2026-08-27
* **Blocked by:** PR #240 / ADR-0027 foundation for landing on `main`; no remaining design blocker.
* **Unlocks:** identity-safe Eight Sleep use, contamination-resistant source baselines, reviewable shared-device attribution, and a provider-neutral measurement-trust layer.
* **Source analysis:** [2026-08-27 Physiological Identity Passport & Measurement Trust Analysis](../analysis/2026-08-27-physiological-identity-passport-and-measurement-trust.md)
* **Decision record:** [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md)

> **Not a top-level phase.** `PI*` is a capability plan, like `MS*`, `HA*`, `OV*`, and `SV*`.

> **Safety posture:** shared-surface data may be preserved and displayed when identity is uncertain, but it must not influence recovery baselines or recommendation evidence until the identity gate admits it.

---

## Goal

Introduce a provider-neutral identity-attribution and measurement-trust layer between raw/source-aware health observations and all downstream physiological baseline/fusion logic.

The immediate target is Eight Sleep data arriving through Google Health, where the mattress side is not a cryptographic user identity. Garmin Direct is the current personal-device anchor because live-account evidence shows effectively continuous overnight availability.

The capability should answer one narrow question:

> **Does this shared-source night belong to the authenticated athlete strongly enough to use for recovery and baseline learning?**

It must not answer whether the athlete is healthy, fatigued, ill, overreached, or physiologically “normal.” Those are downstream interpretation questions.

---

## Non-goals

This plan does not:

- identify which family member used the mattress;
- turn physiology into account authentication;
- replace Firebase/OAuth account identity;
- create a broad athlete passport containing FTP, CPET, HR zones, 1RMs, injuries, training age, or goals;
- use population-normal physiology as identity proof;
- classify a physiologically unusual athlete night as another person;
- de-mix partial-night aggregate Eight Sleep physiology without epoch-level data;
- introduce deep learning or a one-class model as production identity authority in v1;
- make Eight Sleep required for recommendations;
- make Garmin absence evidence of `NOT_USER`;
- average raw cross-device HRV values.

---

## Governing invariants

| ID | Invariant |
|---|---|
| **P-PI-1** | ADR-0027 provenance remains authoritative: provider and transport are separate. |
| **P-PI-2** | Identity attribution is separate from technical quality and physiological anomaly interpretation. |
| **P-PI-3** | Shared-source identity is resolved before source baseline learning and before multisource fusion. |
| **P-PI-4** | `UNCERTAIN` is a valid abstention result and must safely fall back to trusted sources. |
| **P-PI-5** | Raw observations are never deleted solely because identity is uncertain or negative. |
| **P-PI-6** | Manual identity review is append-only and replayable under ADR-0010. |
| **P-PI-7** | Passport learning uses a stricter eligibility threshold than same-day recovery use. |
| **P-PI-8** | No single physiological metric may automatically produce `NOT_USER` in v1. |
| **P-PI-9** | Missing Garmin anchor is missing evidence, not negative evidence. |
| **P-PI-10** | Suspected mixed occupancy quarantines the full Eight Sleep nightly aggregate; no synthetic de-mixing. |
| **P-PI-11** | Identity scores are evidence scores, not calibrated probabilities, until labelled validation proves calibration. |
| **P-PI-12** | Source-specific physiological baselines remain separate from cross-source identity relationship models. |

---

## Target architecture

```text
provider / Google Health
        ↓
source-aware immutable observation bundle       ADR-0027
        ↓
technical quality assessment
        ↓
night/session pairing
        ↓
Physiological Identity Passport assessment      ADR-0028
        ↓
observation eligibility
   ┌──────────────┴───────────────┐
   ↓                              ↓
trusted USER                      UNCERTAIN / NOT_USER
   ↓                              ↓
source-specific baselines         preserve + audit + UI badge
   ↓                              ↓
physiological interpretation      Garmin fallback
   ↓
multisource fusion
   ↓
recommendation
```

The central migration requirement is moving identity gating **upstream of** `computeSourceMetricBaseline()`.

---

## Task board

| Item | Title | Status | Blocked by | Decision impact |
|---|---|---|---|---|
| PI0 | Freeze current co-presence heuristic as provisional | `[ ]` | ADR-0028 | prevents accidental promotion |
| PI1 | Identity, eligibility, evidence and reason-code contracts | `[ ]` | PI0 | none |
| PI2 | Cross-source night/session pairing and feature extraction | `[ ]` | PI1 | none |
| PI3 | Versioned Physiological Identity Passport model + bootstrap | `[ ]` | PI2 | shadow only |
| PI4 | Ternary identity evaluator with abstention | `[ ]` | PI3 | shadow only |
| PI5 | Pre-baseline identity eligibility gate | `[ ]` | PI4 | blocks unverified Eight Sleep baseline learning |
| PI6 | Persistence, review events, replay provenance and Firestore rules | `[ ]` | PI1, PI4 | none |
| PI7 | Suspicious-night review UI | `[ ]` | PI6 | manual labels only |
| PI8 | 42-night historical shadow replay + prospective label collection | `[ ]` | PI4, PI6 | evidence only |
| PI9 | Activation decision and replacement of `CoPresenceValidator` | `[ ]` | PI5, PI7, PI8 | production identity gate |
| PI10 | Living architecture, telemetry, operations and regression suite | `[ ]` | PI9 | documentation/ops |

---

# PI0 — Freeze current co-presence heuristic as provisional

## Why

PR #240 currently includes `app/src/engine/coPresenceValidator.ts` with hard-coded RHR discrepancy boundaries and an `IMPOSTER_REJECTED` status. That implementation should not silently become the durable identity contract before ADR-0028 is implemented.

## Required changes

- mark the current validator as provisional / legacy compatibility logic;
- do not describe its 8 bpm / 12 bpm thresholds as validated biometric identity thresholds;
- ensure any production activation of `candidate-v1` multisource fusion does not bypass the new pre-baseline identity gate once PI5 lands;
- add a regression test documenting that a physiological anomaly alone cannot prove another person.

## Done when

- code/docs clearly distinguish the temporary heuristic from ADR-0028 identity attribution;
- no new code is allowed to depend directly on `IMPOSTER_REJECTED` as a permanent domain status.

---

# PI1 — Identity, eligibility, evidence and reason-code contracts

Introduce provider-neutral contracts in the observation/engine boundary.

Recommended types:

```ts
export type IdentityStatus = 'USER' | 'NOT_USER' | 'UNCERTAIN';

export type IdentityConfidenceTier = 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';

export type IdentityReasonCode =
    | 'MANUAL_USER_CONFIRMED'
    | 'MANUAL_NOT_USER_CONFIRMED'
    | 'ANCHOR_MISSING'
    | 'INSUFFICIENT_PASSPORT_HISTORY'
    | 'SESSION_TIMING_CONCORDANT'
    | 'SESSION_TIMING_DISCORDANT'
    | 'RHR_RELATION_CONCORDANT'
    | 'RHR_RELATION_DISCORDANT'
    | 'RESPIRATION_RELATION_CONCORDANT'
    | 'RESPIRATION_RELATION_DISCORDANT'
    | 'HRV_RELATION_CONCORDANT'
    | 'HRV_RELATION_DISCORDANT'
    | 'MIXED_OCCUPANCY_SUSPECTED';

export interface ObservationEligibility {
    display: boolean;
    recovery: boolean;
    baselineLearning: boolean;
    passportLearning: boolean;
}

export interface IdentityAssessment {
    sourceNightKey: string;
    provider: string;
    transport: string;
    status: IdentityStatus;
    identityScore: number | null;
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly IdentityReasonCode[];
    eligibility: ObservationEligibility;
    passportVersion: string;
    policyVersion: string;
    assessedAt: string;
    manualOverride?: IdentityStatus;
    observationBundleRef: {
        id: string;
        revision: number;
        sourcePayloadHash: string;
    };
}
```

### Contract rules

- identity is assigned at source-night/session level, not per metric;
- metric technical quality remains independent;
- `NOT_USER` is not synonymous with sensor error;
- `UNCERTAIN` is not synonymous with missing data;
- `identityScore` must not be named `probability` in v1;
- eligibility is an explicit derived policy surface, not inferred ad hoc downstream.

## Tests

- all three states serialize deterministically;
- reason codes are stable/versioned;
- manual override cannot be silently lost;
- `UNCERTAIN` maps to `baselineLearning=false` and `passportLearning=false`;
- `NOT_USER` maps to `recovery=false`, `baselineLearning=false`, `passportLearning=false`;
- identity status cannot alter raw observation bytes/provenance.

---

# PI2 — Cross-source night/session pairing and feature extraction

## Pairing rule

Pair by interval overlap, not calendar date alone. Recovery nights cross midnight and upstream logical-date conventions can differ.

For Garmin interval `G=[Gs,Ge]` and Eight Sleep interval `E=[Es,Ee]` calculate:

```text
intersection = max(0, min(Ge, Ee) - max(Gs, Es))
union        = max(Ge, Ee) - min(Gs, Es)

jaccard              = intersection / union
eightOverlapFraction = intersection / duration(E)
garminOverlapFraction= intersection / duration(G)
startDeltaMinutes    = Es - Gs
endDeltaMinutes      = Ee - Ge
durationDeltaMinutes = duration(E) - duration(G)
```

Do not rely on Jaccard alone. A long Eight Sleep session that starts hours before Garmin sleep may still have substantial overlap and should remain suspicious.

## Physiological relation features

When semantics are available and both sources have data:

```text
rhrResidual = eightSleepRhr - garminRhr
respResidual = eightSleepResp - garminResp
hrvLogResidual = log(eightSleepHrv) - log(garminHrv)
```

Do not require cross-device HRV equality.

## Missingness rules

- missing Garmin anchor → `ANCHOR_MISSING`, not `NOT_USER`;
- missing one physiological feature does not zero-fill it;
- session timing can still contribute when a physiology feature is absent;
- no evidence feature may be fabricated from population means.

## Tests

Cover:

- exact overlap;
- partial overlap at start;
- partial overlap at end;
- nested intervals;
- disjoint intervals;
- timezone/UTC offset boundaries;
- DST transition in `Europe/Warsaw`;
- missing start/end;
- multiple sleep sessions / naps;
- deterministic pairing when multiple candidate sessions exist.

For multiple sessions, prefer the candidate with the strongest overnight interval overlap and retain ambiguity as evidence rather than arbitrarily merging sessions.

---

# PI3 — Versioned Physiological Identity Passport model + bootstrap

## Storage model

The passport must be source-aware and versioned.

Suggested document shape:

```yaml
schemaVersion: 1
passportVersion: "2026-08-27.1"
createdAt: "..."
policyVersion: "identity-v1-shadow"

anchorPolicy:
  primaryProvider: garmin
  primaryTransport: garmin_direct
  role: personal_wearable_anchor

sourceProfiles:
  eight_sleep:
    trustedNightCount: 0
    restingHeartRate:
      median: null
      mad: null
      iqr: null
      n: 0
    respirationRate:
      median: null
      mad: null
      iqr: null
      n: 0
    logHrv:
      median: null
      mad: null
      iqr: null
      n: 0
    sleepStartMinutesLocal:
      median: null
      mad: null
      n: 0
    sleepDurationMinutes:
      median: null
      mad: null
      n: 0

crossSourceProfiles:
  eight_sleep__garmin_direct:
    rhrResidual:
      median: null
      mad: null
      iqr: null
      n: 0
    respirationResidual:
      median: null
      mad: null
      iqr: null
      n: 0
    hrvLogResidual:
      median: null
      mad: null
      iqr: null
      n: 0
    startDeltaMinutes:
      median: null
      mad: null
      n: 0
    endDeltaMinutes:
      median: null
      mad: null
      n: 0
    durationDeltaMinutes:
      median: null
      mad: null
      n: 0
    sessionJaccard:
      median: null
      iqr: null
      n: 0

calibration:
  manualUserCount: 0
  manualNotUserCount: 0
  uncertainCount: 0
  shadowWindowStart: null
  shadowWindowEnd: null
```

## Robust estimators

Use median + scaled MAD (`1.4826 × median absolute deviation`) for scalar residuals, plus IQR and sample count for diagnostics.

Introduce explicit minimum-scale floors per feature so near-zero historical dispersion cannot create numerically explosive z-scores. The floors are measurement/semantic safeguards, not identity thresholds, and must be documented/tested.

## Historical bootstrap

The existing 42 paired nights are **mostly-user unlabeled history**, not guaranteed positive labels.

Bootstrap v0 as follows:

1. compute paired features for all usable nights;
2. estimate robust center/scale from the whole sample;
3. identify a conservative central core using multi-feature concordance;
4. do not call excluded history `NOT_USER`;
5. fit passport v0 from the central core;
6. re-score the whole history in shadow mode;
7. persist uncertainty, not guessed labels.

A robust bootstrap is acceptable because expected contamination is rare. It is not a substitute for prospective labelled validation.

## Passport eras

The model must support a new version/era when a material source discontinuity occurs, for example:

- Garmin device/algorithm replacement;
- Eight Sleep algorithm/API semantic change;
- Google Health mapping semantic change;
- sustained baseline shift that replay shows is measurement-system rather than physiology.

Do not silently absorb material discontinuities into one eternal fingerprint.

---

# PI4 — Ternary identity evaluator with abstention

## Required output

```text
USER | NOT_USER | UNCERTAIN
```

### Automatic v1 policy

- high-confidence multi-feature agreement with a present Garmin anchor may produce `USER`;
- missing anchor, conflicting multi-feature evidence, insufficient passport maturity, or suspected mixed occupancy produce `UNCERTAIN`;
- automatic `NOT_USER` remains disabled until prospective labelled evidence supports it;
- manual `NOT_USER` is authoritative.

## Evidence composition

Do not hard-code the current 8 bpm rule into the new scorer.

For each feature, calculate robust deviation relative to the passport's paired relationship. Compose evidence only from available features. Candidate score families may include:

- maximum robust residual with multi-feature guards;
- trimmed mean of absolute robust residuals;
- bounded weighted evidence score;
- robust Mahalanobis distance after enough history exists.

The implementation should replay multiple candidate score formulations and retain the simplest one that provides sufficient accepted-night coverage while conservatively surfacing discrepant nights.

Because true negative labels are initially sparse, the output score is an **evidence/ranking score**, not a posterior probability.

## Required safety properties

```text
physiology unusual + cross-source relationship concordant
→ USER can still be true
→ downstream anomaly detector sees the unusual physiology
```

and:

```text
Eight Sleep resembles historical athlete physiology + Garmin absent
→ UNCERTAIN
→ not USER merely because it looks normal
```

---

# PI5 — Pre-baseline identity eligibility gate

This is the highest-value implementation change.

## Current defect

`computeSourceMetricBaseline()` currently consumes all source bundles for a provider/transport regardless of identity. The current co-presence check happens later inside fusion.

## Target contract

Baseline input must already be identity-filtered, or the baseline calculator must explicitly require eligibility metadata.

Preferred boundary:

```ts
computeSourceMetricBaseline({
    bundles,
    identityAssessments,
    requireEligibility: 'baselineLearning',
    ...
})
```

or an upstream projection:

```ts
const eligibleBundles = selectEligibleHealthObservationBundles(
    bundles,
    identityAssessments,
    'baselineLearning',
);
```

Then all source baseline callers consume only `eligibleBundles`.

## Non-negotiable invariant tests

```text
UNCERTAIN Eight Sleep night
→ never changes Eight Sleep 7d/28d baseline

NOT_USER Eight Sleep night
→ never changes Eight Sleep 7d/28d baseline

manual USER night
→ may enter baseline according to normal window rules

USER but physiologically anomalous night
→ remains baseline-eligible according to the normal robust baseline policy;
  identity layer does not censor physiology just because it is unusual
```

The last invariant prevents identity logic from becoming a hidden anomaly censor.

---

# PI6 — Persistence, review events, replay provenance and Firestore rules

## Collections

Recommended paths:

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{nightKey_provider_transport}
users/{uid}/health_identity_review_events/{eventId}
```

All remain user-scoped per ADR-0002.

### `physiological_identity_passports/current`

A small pointer/current materialized model for online assessment.

Fields:

```text
schemaVersion
passportVersion
policyVersion
anchorPolicy
sourceProfiles
crossSourceProfiles
calibration
createdAt
updatedAt
```

### `physiological_identity_passport_versions/{version}`

Immutable/replayable passport snapshot.

Fields additionally include:

```text
trainingObservationRefs[] or compact training-set fingerprint
trainingSetHash
previousVersion
changeReason
algorithmVersion
```

If storing all training refs would make the document unbounded, persist a deterministic training-set hash plus a bounded/replayable query contract and audit metadata rather than growing arrays indefinitely.

### `health_identity_assessments/{nightKey_provider_transport}`

```json
{
  "logicalDate": "2026-08-27",
  "provider": "eight_sleep",
  "transport": "google_health",
  "status": "UNCERTAIN",
  "identityScore": 0.73,
  "confidenceTier": "MODERATE",
  "reasonCodes": [
    "SESSION_TIMING_DISCORDANT",
    "RHR_RELATION_DISCORDANT"
  ],
  "eligibility": {
    "display": true,
    "recovery": false,
    "baselineLearning": false,
    "passportLearning": false
  },
  "passportVersion": "2026-08-27.1",
  "policyVersion": "identity-v1-shadow",
  "observationBundleRef": {
    "id": "2026-08-27_eight_sleep_google_health",
    "revision": 2,
    "sourcePayloadHash": "sha256:..."
  },
  "assessedAt": "..."
}
```

### `health_identity_review_events/{eventId}`

Append-only:

```json
{
  "assessmentRef": "...",
  "logicalDate": "2026-08-27",
  "provider": "eight_sleep",
  "label": "NOT_USER",
  "previousStatus": "UNCERTAIN",
  "reviewedAt": "...",
  "source": "user_ui",
  "schemaVersion": 1
}
```

Never mutate away the previous automatic assessment.

## Firestore rules

- client may read its own assessments/review events;
- user may create a review event only under its own UID and only for an assessment it owns;
- passport versions should be server-written;
- client must not be able to forge `passportVersion`, algorithm evidence, or eligibility flags;
- production baseline calculations trust server-owned assessment state, not arbitrary client fields.

## Replay

Recommendation audit provenance should capture:

```text
identityAssessmentId
identityAssessmentStatus
identityPolicyVersion
passportVersion
observation bundle revision/hash
selected effective source
fallback reason
```

---

# PI7 — Suspicious-night review UI

Only interrupt the user when action can change data authority.

Recommended copy:

```text
Eight Sleep data not verified

Tonight's Eight Sleep measurements did not agree strongly enough with your
independently worn Garmin record. They were not used for recovery or baseline learning.

[ It was me ]  [ Not me ]  [ Unsure ]
```

Progressive disclosure may show reason codes in user language:

```text
Why?
• sleep interval differed from Garmin
• resting-heart-rate relationship differed from your usual paired pattern
```

Avoid:

- “imposter detected”;
- “sensor bad”;
- naming spouse/child/guest;
- presenting an uncalibrated identity score as a percentage probability.

### Review semantics

`It was me`:
- append `USER` review event;
- recompute effective identity state;
- optionally rebuild affected source baseline/recommendation history under explicit user action/policy;
- make it eligible for future passport learning only under the passport-learning policy.

`Not me`:
- append `NOT_USER` event;
- permanently exclude shared-source night from recovery/baseline learning;
- retain as a negative label for future classifier evaluation.

`Unsure`:
- append optional acknowledgement or simply keep `UNCERTAIN`;
- do not force a label.

---

# PI8 — Historical shadow replay + prospective label collection

## Historical replay

Run the existing 60-day / 42 paired-night window through:

- session pairing;
- passport v0 bootstrap;
- identity assessment;
- eligibility projection.

Report at least:

```text
paired nights
USER count / coverage
UNCERTAIN count / coverage
reason-code distribution
single-feature vs multi-feature disagreement
number of historical nights whose inclusion would change the current Eight Sleep 28d baseline
baseline median/MAD before vs after identity gating
fusion-output deltas before vs after identity gating
```

Do not report historical `NOT_USER` count unless it comes from actual labels.

## Prospective evidence

Collect user reviews only on `UNCERTAIN` nights and voluntary manual corrections.

Required evaluation metrics before auto-`NOT_USER` is considered:

```text
accepted USER precision among reviewed nights
false acceptance count
false rejection / unnecessary UNCERTAIN rate
review burden per month
coverage of automatic USER
reason-code stability
baseline contamination incidents
```

The primary optimization objective is **minimize false acceptance of shared-source wrong-person data subject to acceptable coverage**, not maximize classification rate.

---

# PI9 — Activation decision and replacement of `CoPresenceValidator`

Production activation is a separate decision after PI8 evidence.

## Minimum activation conditions

- identity gate is upstream of all shared-source baseline learning;
- no known path can use an `UNCERTAIN` or `NOT_USER` Eight Sleep night in baseline/fusion;
- automatic `USER` rules are replayable and versioned;
- manual review events work end-to-end;
- Garmin fallback produces the same recommendation inputs as Eight Sleep-disabled behaviour;
- no physiological anomaly test is suppressed by identity heuristics;
- at least the historical 42-night shadow replay is reviewed;
- prospective suspicious-night labels begin accumulating;
- current hard-coded 8/12 bpm `IMPOSTER_REJECTED` semantics are removed or isolated behind a legacy adapter.

## Suggested migration

```text
coPresenceValidator.ts
    ↓ temporary adapter/deprecated
identityAttribution.ts
identityFeatures.ts
identityPassport.ts
identityEligibility.ts
identityReviewService.ts
```

Do not preserve `verifiedAthlete: boolean` as the primary contract. A boolean cannot represent abstention safely.

---

# PI10 — Living architecture, telemetry, operations and regression suite

After production activation:

- update `docs/architecture/ingestion-pipeline.md` with the identity gate location;
- document operational passport rebuild/versioning commands;
- document how to replay one night's identity decision;
- add telemetry for assessment coverage/status/reasons without leaking health values into general logs;
- add a runbook for reverting to Garmin-only recovery authority;
- update PR/README wording so “imposter protection” means the ADR-0028 implementation, not the initial RHR heuristic.

Recommended privacy-safe telemetry:

```text
identity_assessment_total{provider,status,policyVersion}
identity_review_total{label}
identity_fallback_total{provider,reasonCode}
identity_passport_version_change_total{reason}
identity_baseline_exclusion_total{provider,status}
```

Do not emit raw HRV/RHR/respiration values into analytics/log labels.

---

## Acceptance scenarios

The following scenarios must be explicit tests or replay fixtures.

### A. Ordinary athlete night

```text
Garmin present
Eight Sleep present
sessions aligned
paired physiology relation plausible
→ USER
→ Eight Sleep eligible
```

### B. Genuine illness / recovery anomaly

```text
Garmin RHR high vs athlete baseline
Eight Sleep RHR high vs its baseline
cross-source relation remains plausible
→ USER
→ physiological anomaly remains visible downstream
```

### C. Family member on mattress while athlete sleeps elsewhere

```text
Garmin present on athlete
Eight Sleep present from another sleeper
session and/or paired physiology strongly discrepant
→ UNCERTAIN automatically
→ Eight Sleep excluded
→ Garmin recovery path
→ review offered
```

### D. User confirms wrong person

```text
previous automatic state = UNCERTAIN
manual label = NOT_USER
→ effective state NOT_USER
→ append review event
→ no Eight Sleep baseline/passport-positive learning
```

### E. User confirms unusual true night

```text
previous automatic state = UNCERTAIN
manual label = USER
→ identity USER
→ downstream anomaly logic still allowed to flag physiology
```

### F. Garmin unexpectedly missing

```text
Eight Sleep present
Garmin anchor missing
→ UNCERTAIN in v1
→ no Eight Sleep baseline/recovery authority
```

### G. Travel

```text
Garmin present
Eight Sleep absent
→ no identity problem
→ Garmin authoritative
→ no review banner
```

### H. Partial/mixed occupancy

```text
Eight Sleep session materially extends before/after Garmin sleep
nightly metrics are aggregate only
→ MIXED_OCCUPANCY_SUSPECTED
→ UNCERTAIN
→ whole Eight Sleep night quarantined
```

---

## Verification matrix

### Unit tests

- interval feature math;
- robust median/MAD and scale floors;
- log-HRV guards for non-positive/invalid input;
- reason-code composition;
- eligibility mapping;
- manual override semantics;
- passport version determinism.

### Property/invariant tests

- `UNCERTAIN` can never enter `baselineLearning`;
- `NOT_USER` can never enter recovery/baseline/passport-positive learning;
- raw observation count is unchanged by identity classification;
- missing anchor never becomes `NOT_USER`;
- single physiological anomaly never becomes automatic `NOT_USER`;
- manual labels dominate automatic state without deleting original assessment;
- replay with same passport/policy/bundle revision is deterministic;
- changing passport version is visible in audit provenance.

### Integration tests

- Firestore round-trip of assessment/review event;
- user isolation rules;
- baseline calculation with mixed eligibility history;
- multisource fusion sees only eligible shared-source bundles;
- Garmin fallback path is equivalent to Eight Sleep unavailable path;
- UI review updates effective identity state.

### Replay tests

At minimum use the existing 60-day history to compare:

```text
current PR #240 baseline/fusion
vs
identity-gated baseline/fusion
```

Report changed nights and explain every difference.

---

## Rollout strategy

### Stage 1 — shadow only

- compute identity assessments;
- persist results;
- do not alter baseline/fusion;
- inspect 42-night history and new mornings.

### Stage 2 — baseline protection

- exclude `UNCERTAIN`/`NOT_USER` Eight Sleep nights from baseline learning;
- keep current recommendation authority conservative;
- monitor baseline deltas.

### Stage 3 — recommendation eligibility

- use Eight Sleep only on `USER` nights;
- Garmin remains fallback for `UNCERTAIN`;
- show review banner when actionable.

### Stage 4 — adaptive passport learning

- permit only the strictest trusted USER subset to update passport automatically;
- manual USER remains strongest positive training evidence;
- version every material model change.

### Stage 5 — consider automatic `NOT_USER`

Only after sufficient labelled negative/positive nights exist to evaluate false acceptance. This is optional; a permanent `USER`/`UNCERTAIN` automatic classifier with manual `NOT_USER` may already be the better risk/complexity trade-off.

---

## Exit criteria

The capability is implemented when:

- ADR-0028 invariants are represented in code;
- shared-source identity is evaluated before baseline learning;
- `USER | NOT_USER | UNCERTAIN` is the canonical identity status;
- Garmin is the configured current anchor, not a hard-coded universal architectural assumption;
- paired temporal/RHR/respiration/HRV relation features are available where data permits;
- the passport is versioned and replayable;
- suspect history cannot train the passport by default;
- manual review produces append-only labelled evidence;
- baseline/fusion/recommendation paths consume explicit eligibility;
- mixed occupancy does not trigger invented de-mixing;
- production can fall back cleanly to Garmin-only recovery;
- historical and prospective shadow evidence is documented before stronger automation is enabled.

---

## References

- [Physiological Identity Passport analysis](../analysis/2026-08-27-physiological-identity-passport-and-measurement-trust.md)
- [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md)
- [ADR-0027](../adr/0027-source-aware-multisource-health-observations.md)
- [MS multisource implementation plan](./multisource-health-and-recovery-ingestion.md)
- [MS14 shadow study](../analysis/2026-08-27-multisource-shadow-study.md)
- `app/src/engine/coPresenceValidator.ts`
- `app/src/engine/multisourceBaselines.ts`
- `app/src/engine/multisourceFusion.ts`
- `app/src/observations/models.ts`
- `src/garmin_sync/google_health_mapper.py`
