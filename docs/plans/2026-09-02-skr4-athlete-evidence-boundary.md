# SKR4 Architecture & Implementation Plan — Athlete-Specific Evidence Boundary

**Date:** 2026-09-02
**Status:** Foundation implemented; production persistence/composition and outcome calibration deferred
**Parent Plan:** [`sports-knowledge-registry-follow-up.md`](./sports-knowledge-registry-follow-up.md) — SKR4
**Related ADRs:** ADR-0033 (§D-SKR-BOUNDARIES), ADR-0020 (§D-SUBJFLOOR), ADR-0028 (Identity Passport), ADR-0010 (Recommendation Audit)
**Branch:** `feat/skr4-athlete-evidence-boundary`

---

## 1. Purpose and scope

ADR-0033 separates three epistemic roles that must not be collapsed into one generic word, “evidence”:

1. **Sports knowledge** — generalizable scientific boundaries and product priors (`KnowledgeClaim`).
2. **Decision evidence** — acute observations available for a specific recommendation (`DailyReadiness`, decision facts).
3. **Athlete-specific evidence** — repeated, identity-scoped observations about one athlete that may refine how a general prior applies to that athlete.

SKR4 implements the **typed boundary and pure refinement primitives** for the third category. It does **not** activate live athlete-specific personalization, add a Firestore repository, infer patterns automatically, or claim that the remaining SEP calibration debt has been scientifically resolved.

That distinction is deliberate: an auditable type/policy boundary can be reviewed safely before persistence, learning/calibration, and production decision authority are introduced.

---

## 2. Boundary invariants

```text
GLOBAL SPORTS KNOWLEDGE
KnowledgeClaim (stable id + reviewed version)
        |
        | prior
        v
ATHLETE-SPECIFIC EVIDENCE
repeated observations for exactly one userId
        |
        | bounded refinement
        v
DECISION POLICY
acute decision evidence + safety gates
```

### D-ATHLETE-ISOLATION

- Personal measurements and learned response patterns never enter `sportsKnowledgeRegistry.ts`.
- Every `AthleteEvidenceRecord` carries a `userId`.
- A profile validator rejects records whose `userId` differs from the profile owner.
- The pure policy resolver also checks identity at use time; a cross-user record is ignored even if unvalidated data reaches the policy layer.
- Lineage snapshotting rejects a mixed-user record set rather than matching records only by ID.

### D-ATHLETE-SAFETY-PRESERVE

Athlete evidence is **monotonic with respect to accepted safety authority** in v1:

- it may add restricted modalities or movement patterns;
- it may lengthen a recovery prior;
- it may conservatively increase subjective soreness/fatigue values;
- it may not disable a clinical flag, red flag, clinical escalation, existing restricted modality, or existing red-flag category;
- it may not shorten a safety-linked recovery prior;
- it may not use a personal subjective baseline to lower today’s raw soreness/fatigue on a deciding path.

The last rule is not optional. ADR-0020 D-SUBJFLOOR states that the existing absolute subjective triggers remain hard floors and personal normalization may only escalate `train -> modify -> recover`. A two-sided reporting-scale calibration would require a separate accepted decision and prospective calibration evidence.

---

## 3. Data contracts

### `AthleteEvidenceRecord`

The record contains:

- stable `id` and monotonic `version`;
- strict `userId`;
- `domain` and lifecycle `status`;
- `baseKnowledgeClaimId` (and optional explicit base version);
- typed `refinementType`;
- bounded parameters;
- observation count/window and confidence;
- first/last observation dates and optional review date;
- explanatory rationale.

### Domains

- `recovery_kinetics`
- `subjective_calibration`
- `tissue_tolerance`
- `movement_contraindication`
- `sensor_fidelity`
- `modality_preference`

The first four have executable foundation helpers in this PR. The latter two are reserved domain contracts only; no production consumer is introduced here.

### Bounded parameters

- `scalarOffset`: structural range `[-2, +2]`; **subjective deciding-path records are additionally restricted to non-negative values**.
- `scalarMultiplier`: structural range `[0.75, 2.0]`; **v1 safety-linked recovery records are additionally restricted to `>= 1.0`**.
- `enforcedMinimumRecoveryHours`: `[0, 168]`.
- `additionalRestrictedModalities`: validated against the engine modality vocabulary.
- `contraindicatedMovementPatterns`: bounded string list.
- `applicableBodyRegions`: optional bounded region scope.

The validator also checks ISO dates/timestamps, record/profile identity consistency, duplicate record IDs, referential integrity against registered knowledge claim IDs when supplied, and compatible v1 domain/refinement contracts.

---

## 4. Subjective evidence: tighten-only, not baseline subtraction

The first SKR4 draft allowed a negative offset such as “habitual soreness -1”. That conflicts with accepted ADR-0020 because a lowered raw value can remove any of the absolute mode triggers, including the aggregate fatigue score.

Therefore the corrected v1 contract is:

```text
raw subjective value
    + non-negative athlete refinement
    -> same or more conservative deciding value
```

`applyAthleteSubjectiveCalibration()` contains a second fail-safe: even if an invalid negative record bypasses validation, the negative offset is a no-op and is not reported as materially applied.

This does **not** say habitual scale use is irrelevant. It says a different instrument is required if the product later wants to correct for habitual high/low reporting without weakening accepted safety floors.

---

## 5. Recovery evidence: no invented universal fast-recovery floor

The first draft permitted a personalized strenuous-lower-body recovery window to fall from 48 h to 36 h. The implementation review removed that rule.

Why:

- recovery kinetics differ by exercise protocol, training status, and outcome measured;
- resistance exercise to failure can delay recovery versus non-failure work (PMID 28965198);
- neuromuscular recovery after heavy resistance/jump/sprint work can remain impaired across roughly 48–72 h depending on the measure (PMID 30067591);
- autonomic, perceptual, and neuromuscular recovery metrics do not necessarily recover on the same timeline (PMID 31635206).

Those data support **individualized monitoring**, but they do not validate “36 h” as a universal personalized safety floor. SKR4 v1 therefore allows a repeated athlete-specific slow-recovery pattern to **lengthen** a registered recovery prior only. A future fast-recovery hypothesis may be shadow-measured or used in non-safety ranking after a dedicated policy review; it is not silently granted authority here.

---

## 6. Tissue and movement scope

A tissue-tolerance record may declare:

- additional restricted modalities;
- contraindicated movement patterns;
- optional `applicableBodyRegions`.

When explicit current region context is supplied, a scoped record applies only if the regions intersect. When region context is unavailable, the resolver remains conservative and keeps the scoped restriction active rather than silently discarding it.

This fixes an important first-draft gap where `activeBodyRegions` existed as an option but did not affect resolution at all.

---

## 7. Audit and replay lineage

`RecommendationAudit` has a compact optional athlete-evidence lineage:

```ts
{
  recordId,
  version,
  domain,
  refinementType,
  baseKnowledgeClaimId,
}
```

The snapshotter:

- accepts only active records;
- rejects mixed-user and duplicate-ID input;
- sorts deterministically;
- caps the record count;
- excludes `userId`, raw observations, rationale, and free-text notes.

`buildRecommendationAudit()` now accepts an optional list of **materially applied** athlete-evidence records. When supplied, it:

1. snapshots the compact athlete-evidence lineage; and
2. also snapshots each record’s `baseKnowledgeClaimId` through normal Sports Knowledge lineage so the general prior version is frozen alongside the personal refinement version.

Replay comparison reports drift for:

- missing record;
- inactive/revoked record;
- version mismatch;
- same-version semantic definition mismatch (`domain`, `refinementType`, or base claim changed).

### Important activation boundary

No current production recommendation path passes athlete-evidence records into `buildRecommendationAudit()`. This PR makes the audit boundary **capable** of persisting correct lineage when a future composition layer applies such records; it does not pretend that live personalization already exists.

---

## 8. Persistence boundary

The intended ownership shape remains a user-scoped path such as:

```text
users/{userId}/athlete_evidence/{recordId}
```

but **SKR4 does not create this Firestore collection, rules, repository, or migration**. Persistence is a follow-up because it needs its own authorization, validation, retention/privacy, and lifecycle review.

Until that work exists, `AthleteEvidenceProfile` is a typed in-memory/domain contract only.

---

## 9. Relationship to the seven high-safety SEP partial families

SKR4 provides a **calibration route**, not a coverage upgrade.

| Family | SKR4 role | Status after this PR |
|---|---|---|
| `readiness.subjective_mode_thresholds` | conservative athlete-specific escalation primitive | remains partial/P0; exact cut-points and scale behavior are not validated |
| `injury.tissue_response_severity` | personal tighten-only recovery/tolerance evidence | remains partial/P0 pending prospective outcome calibration |
| `injury.region_mapping.lower_limb_impact` | scoped additional restrictions | remains partial/P0 |
| `injury.region_mapping.lower_limb_strength` | scoped movement restrictions | remains partial/P0 |
| `injury.region_mapping.lumbar_loading` | scoped movement restrictions | remains partial/P0 |
| `injury.region_mapping.upper_limb_loading` | scoped movement restrictions | remains partial/P0 |
| `injury.pain_envelope_mapping` | future personal response evidence may add context | remains partial/P0; athlete evidence cannot bypass the clinical envelope |

No knowledge-coverage row should be promoted merely because a typed personal-evidence model exists.

---

## 10. Verification

Tests cover:

- record/profile structural validation and claim-ID referential checks;
- rejection of negative subjective deciding-path offsets;
- tighten-only recovery semantics;
- invalid modality/list inputs and review-date chronology;
- cross-user fail-closed policy resolution;
- region-scoped tissue restrictions and movement-pattern restrictions;
- clinical/red-flag/restriction monotonicity;
- deterministic active-only lineage snapshots;
- mixed-user, inactive, version, and definition drift detection;
- audit persistence of compact athlete lineage plus base claim lineage without personal payloads.

Repository CI (`npm run check` through the standard pipeline) remains the merge gate.

---

## 11. Follow-up work before production activation

1. Define Firestore repository/rules and lifecycle semantics for athlete evidence.
2. Define how candidate patterns are generated and reviewed; do not infer “high confidence” from sample count alone.
3. Integrate Identity Passport provenance so observations with uncertain identity cannot train a personal pattern as if confirmed.
4. Add a composition service that validates a profile, resolves applicable records, collects **only materially applied** records, and passes them to audit construction.
5. Run shadow/simulation evaluation before any decision-changing activation.
6. For subjective evidence, retain ADR-0020’s prospective requirement; synthetic tests alone cannot justify a de-escalating or otherwise new deciding signal.
7. For recovery/tissue evidence, define outcome labels (e.g. delayed symptoms, performance recovery, tolerated repeat exposure) before learning thresholds.
8. Only then decide whether a global `POLICY_VERSION` bump is required by the activation path.

---

## 12. Non-goals

SKR4 does not:

- store personal data in the global knowledge registry;
- diagnose injury or disease;
- claim individual response patterns are externally generalizable science;
- weaken red flags or clinical escalation;
- normalize chronic soreness into “safe”;
- establish a universal 36 h recovery minimum;
- activate live athlete-specific personalization;
- close the remaining SEP P0 calibration debt by declaration.
