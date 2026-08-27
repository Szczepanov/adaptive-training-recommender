# PI — Physiological Identity Passport & Measurement Trust

* **Status:** `Approved`
* **Proposed:** 2026-08-27
* **Foundation:** PR #240 / ADR-0027 is merged on `main` (`8312fe90`); no remaining design blocker.
* **Unlocks:** identity-safe Eight Sleep use, contamination-resistant source baselines, reviewable shared-device attribution, and a provider-neutral measurement-trust layer.
* **Source analysis:** [2026-08-27 Physiological Identity Passport & Measurement Trust Analysis](../analysis/2026-08-27-physiological-identity-passport-and-measurement-trust.md)
* **Decision record:** [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md)

> **Not a top-level phase.** `PI*` is a capability plan, like `MS*`, `HA*`, `OV*`, and `SV*`.

> **Safety posture:** shared-surface data may be preserved and displayed when attribution is uncertain, but it must not influence recovery baselines or recommendation evidence until the identity gate admits it.

---

## Goal

Introduce a provider-neutral identity-attribution and measurement-trust layer between raw/source-aware health observations and downstream physiological baseline/fusion logic.

The immediate target is Eight Sleep data arriving through Google Health, where a mattress side is not cryptographic user identity. Garmin Direct is the current personal-device anchor because live-account evidence shows effectively continuous overnight availability.

The capability should answer one narrow question:

> **Is this shared-source nightly aggregate attributable to the authenticated athlete strongly enough, and purely enough, to use for recovery and baseline learning?**

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
- average raw cross-device HRV values;
- treat two transports carrying the same upstream sensor data as independent corroboration.

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
| **P-PI-9** | Missing or technically ineligible Garmin anchor is missing evidence, not negative evidence. |
| **P-PI-10** | Suspected mixed occupancy quarantines the full Eight Sleep nightly aggregate; no synthetic de-mixing. |
| **P-PI-11** | Identity scores are evidence scores, not calibrated probabilities, until labelled validation proves calibration. |
| **P-PI-12** | Source-specific physiological baselines remain separate from cross-source identity relationship models. |
| **P-PI-13** | Corroborating evidence must be provenance-lineage independent; mirrored/re-exported data cannot vote twice. |
| **P-PI-14** | Automatic assessment is immutable; effective identity/eligibility is a derived projection over assessment + append-only review events. |
| **P-PI-15** | A manual “USER” statement cannot override suspected mixed occupancy unless it explicitly attests exclusive/full-interval attribution. |
| **P-PI-16** | Historical activation metrics are out-of-sample: a night must not be evaluated by a passport that was fitted using that same night. |
| **P-PI-17** | Every replayable identity decision references all contributing observation bundles, feature-schema version, passport/policy versions, and source lineage. |

---

## Target architecture

```text
provider / Google Health
        ↓
source-aware immutable observation bundles      ADR-0027
        ↓
technical quality + provenance lineage
        ↓
night/session pairing
        ↓
Physiological Identity Passport assessment      ADR-0028
        ↓
automatic immutable assessment
        ↓
append-only review events (optional)
        ↓
effective identity + observation eligibility
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

The central migration requirement is moving effective identity eligibility **upstream of** `computeSourceMetricBaseline()`.

---

## Task board

| Item | Title | Status | Blocked by | Decision impact |
|---|---|---|---|---|
| PI0 | Freeze current co-presence heuristic as provisional | `[x]` | ADR-0028 | prevents accidental promotion |
| PI1 | Identity, eligibility, evidence and review contracts | `[x]` | PI0 | none |
| PI2 | Cross-source pairing, lineage and feature extraction | `[x]` | PI1 | none |
| PI3 | Versioned Physiological Identity Passport model + bootstrap | `[x]` | PI2 | shadow only |
| PI4 | Ternary identity evaluator with abstention | `[ ]` | PI3 | shadow only |
| PI5 | Pre-baseline effective-eligibility gate | `[ ]` | PI4 | blocks unverified Eight Sleep baseline learning |
| PI6 | Persistence, review events, replay provenance and Firestore rules | `[ ]` | PI1, PI4 | none |
| PI7 | Suspicious-night review UI | `[ ]` | PI6 | manual labels only |
| PI8 | Historical out-of-sample replay + prospective label collection | `[ ]` | PI4, PI6 | evidence only |
| PI9 | Activation decision and replacement of `CoPresenceValidator` | `[ ]` | PI5, PI7, PI8 | production identity gate |
| PI10 | Living architecture, telemetry, operations and regression suite | `[ ]` | PI9 | documentation/ops |

---

# PI0 — Freeze current co-presence heuristic as provisional

## Why

Merged PR #240 includes `app/src/engine/coPresenceValidator.ts` with provisional scalar bounds and legacy `IMPOSTER_REJECTED` vocabulary. It is safety infrastructure, not a validated biometric classifier.

The current defaults on `main` are:

```text
minOverlapMinutes = 60
maxRhrDeltaBpm = 10
maxUnverifiedRhrDeltaBpm = 14
```

## Required changes

- mark the current validator as provisional / legacy compatibility logic;
- do not describe the `60 min`, `10 bpm`, or `14 bpm` guards as validated identity thresholds;
- ensure production activation of multisource fusion cannot bypass the new pre-baseline identity gate once PI5 lands;
- add a regression test documenting that a physiological anomaly alone cannot prove another person.

## Done when

- code/docs clearly distinguish the temporary heuristic from ADR-0028 identity attribution;
- no new code depends directly on `IMPOSTER_REJECTED` or `verifiedAthlete: boolean` as permanent domain contracts.

---

# PI1 — Identity, eligibility, evidence and review contracts

Introduce provider-neutral contracts at the observation/engine boundary.

Recommended types:

```ts
export type IdentityStatus = 'USER' | 'NOT_USER' | 'UNCERTAIN';
export type IdentityConfidenceTier = 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';

export type IdentityReasonCode =
    | 'ANCHOR_MISSING'
    | 'ANCHOR_QUALITY_INSUFFICIENT'
    | 'EVIDENCE_LINEAGE_DEPENDENT'
    | 'INSUFFICIENT_PASSPORT_HISTORY'
    | 'MULTIPLE_PAIRING_CANDIDATES'
    | 'SESSION_TIMING_CONCORDANT'
    | 'SESSION_TIMING_DISCORDANT'
    | 'RHR_RELATION_CONCORDANT'
    | 'RHR_RELATION_DISCORDANT'
    | 'RESPIRATION_RELATION_CONCORDANT'
    | 'RESPIRATION_RELATION_DISCORDANT'
    | 'HRV_RELATION_CONCORDANT'
    | 'HRV_RELATION_DISCORDANT'
    | 'MIXED_OCCUPANCY_SUSPECTED'
    | 'SESSION_INTERVAL_INVALID';

export interface ObservationBundleRef {
    id: string;
    provider: string;
    transport: string;
    revision: number;
    sourcePayloadHash: string;
    lineageKey: string;
}

export interface ObservationEligibility {
    display: boolean;
    recovery: boolean;
    baselineLearning: boolean;
    passportLearning: boolean;
}

export interface AutomaticIdentityAssessment {
    id: string;
    sourceNightKey: string;
    sharedSource: { provider: string; transport: string };
    automaticStatus: IdentityStatus;
    identityScore: number | null; // evidence score, not calibrated probability
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly IdentityReasonCode[];
    passportVersion: string | null; // null before a usable passport exists
    policyVersion: string;
    featureSchemaVersion: string;
    assessedAt: string;
    sharedBundleRef: ObservationBundleRef;
    anchorBundleRefs: readonly ObservationBundleRef[];
}

export type OccupancyAttestation = 'EXCLUSIVE' | 'MIXED' | 'UNKNOWN';

export interface IdentityReviewEvent {
    id: string;
    assessmentId: string;
    schemaVersion: number;
    label: IdentityStatus;
    occupancyAttestation: OccupancyAttestation;
    supersedesReviewEventId: string | null; // Firestore has no `undefined`; absence of a prior event is explicit `null`
    recordedAt: string; // server-authoritative ordering
    source: 'user_ui' | 'admin_replay';
}

export interface EffectiveIdentityDecision {
    assessmentId: string;
    effectiveStatus: IdentityStatus;
    eligibility: ObservationEligibility;
    authority: 'AUTOMATIC' | 'MANUAL_REVIEW';
    reviewEventId?: string;
}
```

### Why split automatic from effective state

The automatic assessment must remain immutable for replay. A later review event changes the **effective decision**, not the historical model output. This avoids the contradiction of storing `manualOverride` or mutable eligibility on an otherwise immutable assessment.

### Contract rules

- identity is assigned at shared-source night/session level, not per metric;
- metric technical quality remains independent;
- `NOT_USER` is not synonymous with sensor error;
- `UNCERTAIN` is not synonymous with missing data;
- `identityScore` must not be named `probability` in v1;
- baseline/fusion code consumes `EffectiveIdentityDecision`, never raw automatic status alone;
- repeated user corrections remain append-only; a deterministic supersession rule derives the current effective review;
- `passportVersion=null` is valid when assessment abstains because no mature passport exists.

These two interfaces are the single canonical schema for identity records: the source analysis, ADR-0028, this plan, and every persisted-document example below must use `sourceNightKey` (not `logicalDate`) and the `IdentityReviewEvent` shape above verbatim, including `schemaVersion` and `supersedesReviewEventId: string | null`.

## Tests

- all three states serialize deterministically;
- reason codes are stable/versioned;
- automatic assessment cannot be mutated by a manual correction;
- the latest valid superseding review produces a deterministic effective decision;
- `UNCERTAIN` maps to `baselineLearning=false` and `passportLearning=false`;
- `NOT_USER` maps to `recovery=false`, `baselineLearning=false`, `passportLearning=false`;
- a mixed-occupancy attestation cannot become baseline/passport eligible;
- identity status cannot alter raw observation bytes/provenance.

---

# PI2 — Cross-source night/session pairing, lineage and feature extraction

## Pairing rule

Pair by interval overlap, not calendar date alone. Recovery nights cross midnight and upstream logical-date conventions can differ.

For Garmin interval `G=[Gs,Ge]` and Eight Sleep interval `E=[Es,Ee]` calculate:

```text
intersection = max(0, min(Ge, Ee) - max(Gs, Es))
union        = max(Ge, Ee) - min(Gs, Es)

jaccard               = intersection / union
eightOverlapFraction  = intersection / duration(E)
garminOverlapFraction = intersection / duration(G)
startDeltaMinutes     = Es - Gs
endDeltaMinutes       = Ee - Ge
durationDeltaMinutes  = duration(E) - duration(G)
```

Do not rely on Jaccard alone. A long Eight Sleep session that starts hours before Garmin sleep may still have substantial overlap and should remain suspicious.

### Interval validation before feature extraction

`eightOverlapFraction` and `garminOverlapFraction` are undefined when `duration(E)` or `duration(G)` is zero. Before computing any fraction above:

```text
timestamps unparsable                  → reject pair
duration(E) <= 0 (Ee <= Es)            → reject pair
duration(G) <= 0 (Ge <= Gs)            → reject pair
```

A rejected pair emits `SESSION_INTERVAL_INVALID` and abstains (`UNCERTAIN`) rather than dividing by a zero or negative duration. This is a deterministic technical-quality rejection, independent of the anchor-eligibility checks below.

## Provenance-lineage independence

Before physiological features can corroborate identity, confirm that the anchor and shared-source observations are independent at the sensor lineage level.

```text
Garmin Direct observation
+ same Garmin observation re-exported through an aggregator
!= two independent votes
```

Provider/transport difference is useful provenance but is not, by itself, proof of independence. Preserve an origin/lineage key or equivalent provenance chain sufficient to detect mirrored or derived evidence.

If independence cannot be established:

```text
EVIDENCE_LINEAGE_DEPENDENT
→ do not count the duplicated feature as corroboration
→ UNCERTAIN if insufficient independent evidence remains
```

This follows the broader provenance principle used in health-data interoperability: trust/replay requires retaining the entities/processes that produced and transformed a resource, not only its final transport.

## Anchor technical eligibility

A present Garmin record is not automatically a usable anchor. High-confidence automatic `USER` requires an anchor that passes the relevant technical/wear/session-quality checks.

```text
anchor missing                → ANCHOR_MISSING
anchor present but ineligible → ANCHOR_QUALITY_INSUFFICIENT
```

Both abstain rather than infer `NOT_USER`.

## Physiological relation features

When semantics are available and both independent sources have technically usable data:

```text
rhrResidual     = eightSleepRhr - garminRhr
respResidual    = eightSleepResp - garminResp
hrvLogResidual  = log(eightSleepHrv) - log(garminHrv)
```

Do not require cross-device HRV equality.

## Missingness rules

- missing one physiological feature does not zero-fill it;
- session timing can still contribute when a physiology feature is absent;
- no evidence feature may be fabricated from population means;
- multiple plausible overnight pairs emit ambiguity evidence rather than being silently merged.

## Tests

Cover:

- exact overlap;
- partial overlap at start/end;
- nested intervals;
- disjoint intervals;
- timezone/UTC boundaries;
- DST transition in `Europe/Warsaw`;
- missing start/end;
- zero-length Garmin or Eight Sleep interval rejects the pair with `SESSION_INTERVAL_INVALID` instead of dividing by zero;
- reversed or unparsable interval timestamps reject the pair with `SESSION_INTERVAL_INVALID`;
- multiple sleep sessions / naps;
- deterministic pairing when multiple candidate sessions exist;
- mirrored/re-exported source lineage;
- technically present but ineligible anchor.

---

# PI3 — Versioned Physiological Identity Passport model + bootstrap

## Storage model

The passport must be source-aware, lineage-aware and versioned.

Suggested document shape:

```yaml
schemaVersion: 1
passportVersion: "2026-08-27.1"
createdAt: "..."
policyVersion: "identity-v1-shadow"
featureSchemaVersion: "identity-features-v1"

anchorPolicy:
  primaryProvider: garmin
  primaryTransport: garmin_direct
  role: personal_wearable_anchor
  requireIndependentLineage: true

sourceProfiles:
  eight_sleep:
    trustedNightCount: 0
    restingHeartRate: { median: null, mad: null, iqr: null, n: 0 }
    respirationRate: { median: null, mad: null, iqr: null, n: 0 }
    logHrv: { median: null, mad: null, iqr: null, n: 0 }
    sleepStartMinutesLocal: { median: null, mad: null, n: 0 }
    sleepDurationMinutes: { median: null, mad: null, n: 0 }

crossSourceProfiles:
  eight_sleep__garmin_direct:
    rhrResidual: { median: null, mad: null, iqr: null, n: 0 }
    respirationResidual: { median: null, mad: null, iqr: null, n: 0 }
    hrvLogResidual: { median: null, mad: null, iqr: null, n: 0 }
    startDeltaMinutes: { median: null, mad: null, n: 0 }
    endDeltaMinutes: { median: null, mad: null, n: 0 }
    durationDeltaMinutes: { median: null, mad: null, n: 0 }
    sessionJaccard: { median: null, iqr: null, n: 0 }

calibration:
  manualUserCount: 0
  manualNotUserCount: 0
  mixedOccupancyCount: 0
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

1. compute paired features for all usable independent-lineage nights;
2. estimate robust preliminary center/scale;
3. identify a conservative central core using multi-feature concordance;
4. do not call excluded history `NOT_USER`;
5. fit passport v0 from the central core;
6. re-score history for descriptive analysis;
7. persist uncertainty, not guessed labels.

A robust bootstrap is acceptable for initializing v0 because expected contamination is rare. It is **not** sufficient evidence for production activation.

### Out-of-sample evaluation rule

A night cannot contribute to the passport that is used to evaluate that same night for activation metrics. Use one of:

- leave-one-night-out replay for the small historical paired set; or
- chronological expanding-window replay where only earlier eligible nights train the passport for a later night.

A full-sample v0 may still be used as the production/shadow model after selection, but its in-sample scores must not be reported as unbiased acceptance/coverage evidence.

## Passport eras

Create a new version/era when a material source discontinuity occurs, for example:

- Garmin device/algorithm replacement;
- Eight Sleep algorithm/API semantic change;
- Google Health mapping semantic change;
- sustained relation shift that replay shows is measurement-system rather than physiology.

Do not silently absorb material discontinuities into one eternal fingerprint.

---

# PI4 — Ternary identity evaluator with abstention

## Required automatic output

```text
USER | NOT_USER | UNCERTAIN
```

### Automatic v1 policy

- high-confidence **independent**, multi-feature agreement with a technically eligible Garmin anchor may produce `USER`;
- missing/ineligible anchor, dependent lineage, conflicting evidence, insufficient passport maturity, ambiguous pairing, or suspected mixed occupancy produces `UNCERTAIN`;
- automatic `NOT_USER` remains disabled until prospective labelled evidence supports it;
- manual `NOT_USER` is authoritative for the effective decision.

## Evidence composition

Do not hard-code the current `10 bpm` rule into the new scorer.

For each feature, calculate robust deviation relative to the passport's paired relationship. Compose evidence only from available, technically valid, provenance-independent features. Candidate score families may include:

- maximum robust residual with multi-feature guards;
- trimmed mean of absolute robust residuals;
- bounded weighted evidence score;
- robust Mahalanobis distance after enough history exists.

Replay multiple candidate score formulations and retain the simplest one that provides sufficient accepted-night coverage while conservatively surfacing discrepant nights.

Because true negative labels are initially sparse, the output score is an **evidence/ranking score**, not a posterior probability.

## Required safety properties

```text
physiology unusual + cross-source relationship concordant
→ USER can still be true
→ downstream anomaly detector sees the unusual physiology
```

```text
Eight Sleep resembles historical athlete physiology + Garmin absent/ineligible
→ UNCERTAIN
→ not USER merely because it looks normal
```

```text
same upstream signal appears through two transports
→ one lineage of evidence
→ no artificial confidence boost
```

---

# PI5 — Pre-baseline effective-eligibility gate

This is the highest-value implementation change.

## Current defect

`computeSourceMetricBaseline()` currently consumes all source bundles for a provider/transport regardless of identity. The current co-presence check happens later inside fusion.

The same defect exists on the Python side: `run_multisource_audit()` (`src/garmin_sync/multisource_audit.py`) calls `validate_co_presence()` (`src/garmin_sync/presence_filter.py`) directly and admits a night to rolling baseline statistics from `verdict.verifiedAthlete`, bypassing whatever gate the TypeScript engine enforces.

## Target contract

Baseline input must already be filtered by the **effective** identity decision, or the baseline calculator must explicitly require effective eligibility metadata.

Preferred boundary:

```ts
const eligibleBundles = selectEligibleHealthObservationBundles(
    bundles,
    effectiveIdentityDecisions,
    'baselineLearning',
);
```

or:

```ts
computeSourceMetricBaseline({
    bundles,
    effectiveIdentityDecisions,
    requireEligibility: 'baselineLearning',
    ...
});
```

Then all source baseline callers consume only identity-eligible history — including `run_multisource_audit()`, which must resolve `EffectiveIdentityDecision` (or an equivalent fail-closed Python-side projection) instead of calling `validate_co_presence()`/`verdict.verifiedAthlete` directly. PI9's minimum activation conditions apply to this CLI audit path as well as the TypeScript baseline path, so PI8 replay evidence reflects the same identity gate that governs production baseline learning.

## Non-negotiable invariant tests

```text
UNCERTAIN Eight Sleep night
→ never changes Eight Sleep 7d/28d baseline

NOT_USER Eight Sleep night
→ never changes Eight Sleep 7d/28d baseline

manual USER + EXCLUSIVE attribution
→ may enter baseline according to normal window rules

manual USER + MIXED/UNKNOWN occupancy when mixed occupancy was suspected
→ remains baseline/passport-learning ineligible

USER but physiologically anomalous night
→ remains baseline-eligible according to normal robust baseline policy;
  identity layer does not censor physiology merely because it is unusual
```

---

# PI6 — Persistence, review events, replay provenance and Firestore rules

## Collections

Recommended paths:

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{assessmentId}
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
featureSchemaVersion
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

If all training refs would make the document unbounded, persist a deterministic training-set hash plus a bounded/replayable query contract and audit metadata rather than growing arrays indefinitely.

### `health_identity_assessments/{assessmentId}`

The assessment stores the immutable automatic model output and **all** evidence bundle refs used to derive it.

```json
{
  "sourceNightKey": "2026-08-27",
  "sharedSource": { "provider": "eight_sleep", "transport": "google_health" },
  "automaticStatus": "UNCERTAIN",
  "identityScore": 0.73,
  "confidenceTier": "MODERATE",
  "reasonCodes": ["SESSION_TIMING_DISCORDANT", "RHR_RELATION_DISCORDANT"],
  "passportVersion": "2026-08-27.1",
  "policyVersion": "identity-v1-shadow",
  "featureSchemaVersion": "identity-features-v1",
  "sharedBundleRef": {
    "id": "2026-08-27_eight_sleep_google_health",
    "provider": "eight_sleep",
    "transport": "google_health",
    "revision": 2,
    "sourcePayloadHash": "sha256:...",
    "lineageKey": "eight_sleep:pod-side:..."
  },
  "anchorBundleRefs": [
    {
      "id": "2026-08-27_garmin_garmin_direct",
      "provider": "garmin",
      "transport": "garmin_direct",
      "revision": 1,
      "sourcePayloadHash": "sha256:...",
      "lineageKey": "garmin:device:..."
    }
  ],
  "assessedAt": "..."
}
```

### `health_identity_review_events/{eventId}`

Append-only:

```json
{
  "assessmentId": "...",
  "label": "USER",
  "occupancyAttestation": "EXCLUSIVE",
  "supersedesReviewEventId": null,
  "recordedAt": "...",
  "source": "user_ui",
  "schemaVersion": 1
}
```

A correction appends another event referencing the prior event; it never mutates or deletes the original assessment/review event. Effective state is derived deterministically from the latest valid supersession chain.

## Firestore rules / write authority

- user may read their own assessments/review events;
- automatic assessments/passport versions/effective materialized projections are server-written;
- user review submission is constrained to their own assessment and allowed enum values;
- client must not forge `passportVersion`, algorithm evidence, lineage, score, reason codes, or eligibility flags;
- production baseline calculations trust server-derived effective decisions, not arbitrary client fields.

## Replay

Recommendation audit provenance should capture:

```text
identityAssessmentId
automaticStatus
effectiveStatus
reviewEventId if any
identityPolicyVersion
featureSchemaVersion
passportVersion or null
shared bundle revision/hash/lineage
anchor bundle revision/hash/lineage
selected effective source
fallback reason
```

This makes the cross-source decision actually replayable. Referencing only the shared-source bundle is insufficient because the decision also depends on the anchor observation.

---

# PI7 — Suspicious-night review UI

Only interrupt the user when action can change data authority.

Copy is selected by the assessment's leading reason code — the discrepant-evidence wording below is only accurate when a Garmin record actually exists and disagreed. `ANCHOR_MISSING`/`ANCHOR_QUALITY_INSUFFICIENT` nights use different wording because no usable independent record was compared.

Default copy (`SESSION_TIMING_DISCORDANT`, `RHR_RELATION_DISCORDANT`, `RESPIRATION_RELATION_DISCORDANT`, `HRV_RELATION_DISCORDANT`, or `MIXED_OCCUPANCY_SUSPECTED`):

```text
Eight Sleep data not verified

Tonight's Eight Sleep measurements did not agree strongly enough with your
independently worn Garmin record. They were not used for recovery or baseline learning.

Were these measurements yours for the full tracked sleep period?

[ Only me ]  [ Shared / mixed ]  [ Not me ]  [ Unsure ]
```

`ANCHOR_MISSING` copy:

```text
Eight Sleep data not verified

We couldn't find a Garmin record to confirm tonight's Eight Sleep measurements
were yours, so they were not used for recovery or baseline learning.

Were these measurements yours for the full tracked sleep period?

[ Only me ]  [ Shared / mixed ]  [ Not me ]  [ Unsure ]
```

`ANCHOR_QUALITY_INSUFFICIENT` copy:

```text
Eight Sleep data not verified

Tonight's Garmin record wasn't complete enough to confirm tonight's Eight Sleep
measurements were yours, so they were not used for recovery or baseline learning.

Were these measurements yours for the full tracked sleep period?

[ Only me ]  [ Shared / mixed ]  [ Not me ]  [ Unsure ]
```

Every variant preserves the same review question and response options; only the explanatory line changes.

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

Any review event that changes `EffectiveIdentityDecision` for a night already reflected in a materialized 7d/28d baseline is **not** optional to reconcile: invalidate and rebuild the affected source baseline (and any recommendation history derived from it), or enforce an equivalent versioned read barrier, before serving further recovery/recommendation decisions from that baseline. This applies whenever a review admits a previously-excluded night (`Only me`) or removes a previously-admitted night (`Shared / mixed`, `Not me`).

`Only me`:
- append `USER` + `EXCLUSIVE` review event;
- recompute effective identity/eligibility;
- require baseline/recommendation-history invalidation and rebuild (or a versioned read barrier) covering the newly admitted night — this is mandatory, not optional, per the rule above;
- make it eligible for future passport learning only under the stricter passport-learning policy.

`Shared / mixed`:
- append `UNCERTAIN` + `MIXED` review event;
- keep the complete nightly aggregate quarantined;
- never de-mix the scalar physiology.

`Not me`:
- append `NOT_USER` review event;
- exclude shared-source night from recovery/baseline/passport-positive learning;
- retain as a negative label for future classifier evaluation.

`Unsure`:
- preserve `UNCERTAIN` + `UNKNOWN`;
- do not force a label.

If the user later corrects a review, append a superseding event instead of editing the previous event.

---

# PI8 — Historical out-of-sample shadow replay + prospective label collection

## Historical replay

Run the existing 60-day / 42 paired-night window through:

- session pairing;
- lineage/anchor-quality checks;
- passport bootstrap;
- **leave-one-night-out or chronological expanding-window assessment**;
- effective eligibility projection without manual labels unless real labels exist.

Report at least:

```text
paired nights
automatic USER count / coverage
UNCERTAIN count / coverage
reason-code distribution
lineage/anchor-quality abstentions
single-feature vs multi-feature disagreement
number of historical nights whose inclusion changes the Eight Sleep 28d baseline
baseline median/MAD before vs after identity gating
fusion-output deltas before vs after identity gating
risk/coverage or acceptance/coverage sensitivity across candidate thresholds
```

Do not report historical `NOT_USER` count unless it comes from actual labels. Do not use full-sample in-sample scores as activation evidence.

## Prospective evidence

Collect user reviews on `UNCERTAIN` nights and voluntary manual corrections.

Required evaluation metrics before auto-`NOT_USER` is considered:

```text
accepted USER precision among reviewed nights
false acceptance count
false rejection / unnecessary UNCERTAIN rate
review burden per month
coverage of automatic USER
reason-code stability
baseline contamination incidents
mixed-occupancy incidents
```

The primary objective is **minimize false acceptance of wrong-person or mixed shared-source aggregates subject to acceptable coverage**, not maximize classification rate.

Because selective classifiers explicitly trade coverage for accepted-case risk, keep the threshold-selection evidence as a risk/coverage artifact rather than one headline accuracy number.

---

# PI9 — Activation decision and replacement of `CoPresenceValidator`

Production activation is a separate decision after PI8 evidence.

## Minimum activation conditions

- identity gate is upstream of all shared-source baseline learning, including the Python `run_multisource_audit()` / `validate_co_presence()` shadow-audit path, not only the TypeScript engine;
- no known path can use an `UNCERTAIN`, `NOT_USER`, or mixed-occupancy Eight Sleep night in baseline/fusion;
- automatic `USER` rules require technically eligible, provenance-independent anchor evidence;
- automatic assessment and effective decision are separate/replayable;
- every assessment records all contributing bundle refs and feature schema;
- manual review/correction events work end-to-end without mutating automatic history;
- Garmin fallback produces the same recommendation inputs as Eight Sleep-disabled behaviour;
- no physiological anomaly test is suppressed by identity heuristics;
- historical evaluation is out-of-sample, not self-scored;
- at least the historical 42-night shadow replay is reviewed;
- prospective suspicious-night labels begin accumulating;
- current hard-coded `60 min` / `10 bpm` / `14 bpm` and legacy `IMPOSTER_REJECTED` semantics are removed or isolated behind a compatibility adapter.

## Suggested migration

```text
coPresenceValidator.ts
    ↓ temporary adapter/deprecated
identityLineage.ts
identityFeatures.ts
identityPassport.ts
identityAttribution.ts
identityEligibility.ts
identityReviewService.ts
```

Do not preserve `verifiedAthlete: boolean` as the primary contract. A boolean cannot represent abstention safely.

---

# PI10 — Living architecture, telemetry, privacy and regression suite

After production activation:

- update `docs/architecture/ingestion-pipeline.md` with the identity gate location;
- document operational passport rebuild/versioning commands;
- document how to replay one night's identity decision including all evidence refs;
- add telemetry for assessment coverage/status/reasons without leaking health values or identity fingerprints into general logs;
- add a runbook for reverting to Garmin-only recovery authority;
- update PR/README wording so “imposter protection” means the ADR-0028 implementation, not the initial RHR heuristic;
- document retention/deletion/export behaviour for passport versions and review labels as sensitive derived health/identity data.

Recommended privacy-safe telemetry:

```text
identity_assessment_total{provider,status,policyVersion}
identity_review_total{label,occupancyAttestation}
identity_fallback_total{provider,reasonCode}
identity_passport_version_change_total{reason}
identity_baseline_exclusion_total{provider,status}
```

Do not emit raw HRV/RHR/respiration values, feature residuals, source-payload hashes, lineage identifiers, or identity scores into analytics label dimensions.

### Privacy posture

The passport is derived from health physiology and is explicitly used to confirm whether measurements belong to a person. Treat it as highly sensitive by design. In deployments subject to GDPR, health data are special-category data and physiological features used for unique identification can meet the biometric-data definition. The exact lawful basis depends on deployment and is outside this ADR, but data minimization, access control, purpose limitation, retention controls, encryption/pseudonymisation where appropriate, and auditable deletion/export should be design requirements rather than later documentation work.

---

## Acceptance scenarios

The following scenarios must be explicit tests or replay fixtures.

### A. Ordinary athlete night

```text
eligible independent Garmin anchor present
Eight Sleep present
sessions aligned
paired physiology relation plausible
→ automatic USER
→ Eight Sleep eligible according to activation policy
```

### B. Genuine illness / recovery anomaly

```text
Garmin RHR high vs athlete baseline
Eight Sleep RHR high vs its baseline
cross-source relation remains plausible
→ USER can remain true
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

### E. User confirms unusual true, exclusively attributable night

```text
previous automatic state = UNCERTAIN
manual label = USER
occupancyAttestation = EXCLUSIVE
→ effective state USER
→ downstream anomaly logic may still flag physiology
```

### F. Garmin unexpectedly missing

```text
Eight Sleep present
Garmin anchor missing
→ UNCERTAIN in v1
→ no Eight Sleep baseline/recovery authority
```

### G. Garmin present but technically ineligible

```text
Garmin bundle exists
wear/session quality insufficient for identity anchor
→ ANCHOR_QUALITY_INSUFFICIENT
→ UNCERTAIN
```

### H. Travel

```text
Garmin present
Eight Sleep absent
→ no identity problem
→ Garmin authoritative
→ no review banner
```

### I. Partial/mixed occupancy

```text
Eight Sleep session materially extends before/after Garmin sleep
nightly metrics are aggregate only
→ MIXED_OCCUPANCY_SUSPECTED
→ UNCERTAIN
→ whole Eight Sleep night quarantined
```

### J. User confirms mixed occupancy

```text
manual review = USER present but MIXED occupancy
→ effective identity remains non-authoritative for the aggregate
→ recovery/baseline/passportLearning=false
```

### K. Mirrored evidence

```text
Garmin Direct anchor
same upstream Garmin measurement re-exported by another transport
→ dependent lineage
→ cannot increase identity confidence as an independent source
```

### L. Review correction

```text
review event 1 = NOT_USER
later correction = USER + EXCLUSIVE, supersedes event 1
→ both events preserved
→ latest valid supersession determines effective decision
```

---

## Verification matrix

### Unit tests

- interval feature math;
- lineage-independence evaluation;
- anchor-quality gate;
- robust median/MAD and scale floors;
- log-HRV guards for non-positive/invalid input;
- reason-code composition;
- automatic → effective eligibility mapping;
- review supersession semantics;
- mixed-occupancy attestation semantics;
- passport version determinism.

### Property/invariant tests

- `UNCERTAIN` can never enter `baselineLearning`;
- `NOT_USER` can never enter recovery/baseline/passport-positive learning;
- mixed occupancy can never enter recovery/baseline/passport-positive learning;
- raw observation count is unchanged by identity classification;
- missing/ineligible anchor never becomes `NOT_USER` automatically;
- dependent-lineage evidence cannot be counted twice;
- single physiological anomaly never becomes automatic `NOT_USER`;
- manual labels change effective state without mutating automatic assessment;
- replay with same policy/passport/feature schema/all bundle revisions is deterministic;
- changing passport version is visible in audit provenance.

### Integration tests

- Firestore round-trip of assessment/review event;
- user isolation rules;
- review correction/supersession;
- baseline calculation with mixed eligibility history;
- multisource fusion sees only eligible shared-source bundles;
- Garmin fallback path is equivalent to Eight Sleep unavailable path;
- UI review updates effective identity state without rewriting model output.

### Replay tests

At minimum use the existing 60-day history to compare:

```text
current merged PR #240 baseline/fusion
vs
identity-gated baseline/fusion
```

For threshold/model selection use leave-one-out or chronological replay. Report changed nights and explain every difference.

---

## Rollout strategy

### Stage 1 — shadow only

- compute immutable automatic identity assessments;
- persist results and all evidence refs;
- do not alter baseline/fusion;
- inspect out-of-sample historical replay and new mornings.

### Stage 2 — baseline protection

- derive effective decisions;
- exclude `UNCERTAIN`/`NOT_USER`/mixed Eight Sleep nights from baseline learning;
- keep current recommendation authority conservative;
- monitor baseline deltas.

### Stage 3 — recommendation eligibility

- use Eight Sleep only on effective `USER` + purity-eligible nights;
- Garmin remains fallback for `UNCERTAIN`;
- show review banner when actionable.

### Stage 4 — adaptive passport learning

- permit only the strictest trusted USER subset to update passport automatically;
- manual `USER + EXCLUSIVE` remains strongest positive training evidence;
- version every material model change;
- prevent self-confirming automatic labels from recursively training without a separately approved policy.

### Stage 5 — consider automatic `NOT_USER`

Only after sufficient labelled negative/positive nights exist to evaluate false acceptance. This is optional; a permanent `USER`/`UNCERTAIN` automatic classifier with manual `NOT_USER` may already be the better risk/complexity trade-off.

---

## Exit criteria

The capability is implemented when:

- ADR-0028 invariants are represented in code;
- shared-source identity is evaluated before baseline learning;
- `USER | NOT_USER | UNCERTAIN` is the canonical identity status;
- Garmin is a configured current anchor, not a hard-coded universal assumption;
- anchor technical quality and evidence lineage are explicit;
- paired temporal/RHR/respiration/HRV relation features are available where semantics permit;
- the passport is versioned and replayable;
- automatic assessments are immutable and effective state is derived from append-only review evidence;
- suspect history cannot train the passport by default;
- mixed occupancy cannot be promoted by a vague “it was me” confirmation;
- baseline/fusion/recommendation paths consume explicit effective eligibility;
- production can fall back cleanly to Garmin-only recovery;
- historical activation evidence is out-of-sample;
- historical and prospective shadow evidence is documented before stronger automation is enabled.

---

## References

### Repository

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

### External

- HL7 FHIR. *Provenance Resource* — provenance as a basis for authenticity, trust and reproducibility. https://hl7.org/fhir/R4/provenance.html
- Regulation (EU) 2016/679 (GDPR), Articles 4 and 9. https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Franc V, Prusa D, Voracek V. *Optimal Strategies for Reject Option Classifiers*. JMLR. 2023. https://www.jmlr.org/papers/v24/21-0048.html
- Traub J et al. *Overcoming Common Flaws in the Evaluation of Selective Classification Systems*. 2024. https://arxiv.org/abs/2407.01032
- Hennhöfer O, Preisach C. *Leave-One-Out-, Bootstrap- and Cross-Conformal Anomaly Detectors*. 2024. https://arxiv.org/abs/2402.16388
