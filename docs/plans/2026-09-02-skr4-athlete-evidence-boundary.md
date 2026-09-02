# SKR4 Architecture & Implementation Plan — Athlete-Specific Evidence Boundary

**Date:** 2026-09-02
**Status:** Implemented
**Parent Plan:** [`sports-knowledge-registry-follow-up.md`](./sports-knowledge-registry-follow-up.md) — SKR4
**Related ADRs:** ADR-0033 (§D-SKR-BOUNDARIES), ADR-0028 (Identity Passport), ADR-0010 (Recommendation Audit)
**Branch:** `feat/skr4-athlete-evidence-boundary`

---

## 1. Executive Summary

ADR-0033 (§D-SKR-BOUNDARIES) established that sports-science knowledge, acute decision evidence, and athlete-specific learned evidence have distinct epistemic roles and must not be collapsed into an ambiguous concept of "evidence":
1. **Sports Knowledge (`KnowledgeClaim`)**: Generalizable scientific boundaries and product priors stored in Git (`app/src/knowledge/`). Population-level, versioned, vendor-neutral.
2. **Acute Decision Evidence (`DecisionEvidence`, `DailyReadiness`)**: Today's point-in-time telemetry (today's HRV z-score, morning soreness check-in, acute resting HR).
3. **Athlete-Specific Evidence (`AthleteEvidenceProfile`)**: Repeated, identity-scoped personal response patterns learned over longitudinal observation of one athlete (e.g. personal recovery kinetics, chronic soreness baseline shifts, tissue vulnerabilities).

In SKR3, all 15 heuristic policy families were migrated to registered claims with exact alignment tests, zeroing high-impact and high-safety uncovered risk debt. The remaining 7 high-safety P0 families in `knowledgeCoverage.ts` (subjective mode thresholds, tissue response severity, 4 regional loading restrictions, and pain envelope mapping) represent **athlete-outcome calibration debt**, not missing population literature.

SKR4 designs and delivers the typed data model, schema validator, policy refinement engine, and audit lineage for athlete-specific evidence, allowing personal calibrations to refine general knowledge priors without polluting the global registry.

---

## 2. The Tripartite Evidence Boundary

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           GLOBAL SPORTS KNOWLEDGE                                │
│  (app/src/knowledge/ — Git-backed, universal, population priors & boundaries)   │
│  e.g. modeThresholdsPolicy, strenuousLowerBodyResidualFatigue, tissueSeverity   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼ [Prior]
┌──────────────────────────────────────────────────────────────────────────────────┐
│                       ATHLETE-SPECIFIC EVIDENCE (SKR4)                           │
│  (users/{userId}/athlete_evidence/ — personal longitudinal response patterns)   │
│  - Habitual soreness baseline shift (-1.0 offset)                                │
│  - Individual lower-body recovery kinetics (1.25x multiplier, 54h minimum)       │
│  - Chronic Achilles tissue irritability (Running restriction tightening)         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼ [Posterior Refinement]
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         TODAY'S DECISION ENGINE                                  │
│  Acute Decision Evidence: today's sleep, HRV z-score, check-in, acute soreness    │
│  Result: Personalized recommendation with immutable RecommendationAudit          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Boundary Invariants
1. **Registry Isolation:** Personal measurements and learned athlete patterns are strictly **prohibited** from being committed to `sportsKnowledgeRegistry.ts`.
2. **User Isolation:** All athlete-specific evidence records belong to a specific `userId` and are stored in user-scoped persistence (`users/{userId}/athlete_evidence/{patternId}`).
3. **Priors vs Refinements:** General sports knowledge claims act as priors. Athlete-specific evidence acts as an empirical posterior refinement over a specific `baseKnowledgeClaimId`.

---

## 3. Data Contracts & Schema Validation

### 3.1 Domain Model (`app/src/knowledge/athleteEvidence.ts`)
- **`AthleteEvidenceDomain`**:
  - `recovery_kinetics`: Personal recovery half-life or recovery window modifier.
  - `subjective_calibration`: Personal reporting baseline shift (e.g., chronic soreness baseline).
  - `tissue_tolerance`: Chronic regional tissue tolerance / vulnerability (e.g., Achilles, patella).
  - `movement_contraindication`: Individualized exercise or movement pattern intolerance.
  - `sensor_fidelity`: Athlete-specific sensor fidelity and concordance patterns.
  - `modality_preference`: Athlete-specific cross-training / active recovery tolerance.
- **`AthleteRefinementType`**:
  - `tighten_constraint`: Narrows allowable tier, modality, or volume.
  - `calibrate_scalar`: Offsets or scales a parameter within safe, bounded limits.
  - `prioritize_candidate`: Boosts candidate utility for demonstrated positive adaptations.
  - `abstain_general_rule`: Declares a general product heuristic inapplicable with typed rationale.
- **`AthleteEvidenceRecord`**: Stable `id`, `userId`, `domain`, `status` (`active | provisional | superseded | revoked`), `version`, `baseKnowledgeClaimId`, `parameters`, `sampleSize`, `observationWindowDays`, `confidence` (`high | moderate | low`), `firstObservedDate`, `lastObservedDate`, `rationale`.
- **`AthleteEvidenceProfile`**: User aggregate with `schemaVersion: 1`, `updatedAt`, and `records: AthleteEvidenceRecord[]`.

### 3.2 Safety Monotonicity Invariant (`D-ATHLETE-SAFETY-PRESERVE`)
Athlete-specific evidence can **tighten** constraints, **personalize** recovery durations, or **calibrate** scalars within bounded physiological intervals, but it **MUST NEVER weaken or disable** core safety gates:
- Cannot weaken `clinicalEscalationRequired` or bypass `RedFlagFinding`.
- Cannot bypass `SafetyEnvelope.clinicalFlagActive` or override medical clearance referral.
- Severe soreness ($\ge 8/10$) or severe fatigue cannot be calibrated into green/normal territory ($< 6/10$).
- Recovery hours for strenuous lower-body work ($\ge 48\text{h}$) cannot be compressed below 36 hours.
- Scalar offsets are strictly clamped to $[-2.0, +2.0]$ on the 1–10 scale; recovery multipliers are clamped to $[0.75, 2.0]$.

---

## 4. Resolving the 7 SEP P0 Calibration Debt Items

| Inventory Family | General Claim Prior | Athlete Evidence Domain | Refinement Mechanism |
| :--- | :--- | :--- | :--- |
| `readiness.subjective_mode_thresholds` | `modeThresholdsPolicy` | `subjective_calibration` | Offsets personal reporting baseline within $[-2, +2]$ while protecting severe soreness ($\ge 8$). |
| `injury.tissue_response_severity` | `tissueResponseSeverityPolicy` | `tissue_tolerance` | Adjusts tissue irritability settlement duration (e.g. requiring 48h monitor instead of 24h). |
| `injury.region_mapping.lower_limb_impact` | `lowerLimbImpactPolicy` | `tissue_tolerance` / `movement_contraindication` | Adds individualized impact restrictions or tolerated low-impact running drills. |
| `injury.region_mapping.lower_limb_strength` | `lowerLimbStrengthPolicy` | `movement_contraindication` | Narrows specific heavy lower-body lifts (e.g. squat vs hip thrust) for athlete anatomy. |
| `injury.region_mapping.lumbar_loading` | `lumbarLoadingPolicy` | `movement_contraindication` | Refines axial spinal loading tolerances based on personal lumbar history. |
| `injury.region_mapping.upper_limb_loading` | `upperLimbLoadingPolicy` | `movement_contraindication` | Refines overhead pressing restrictions based on shoulder impingement history. |
| `injury.pain_envelope_mapping` | `genericClinicalEnvelopePolicy` | `tissue_tolerance` | Distinguishes benign chronic discomfort from acute flare-up requiring Mobility/Rest cap. |

---

## 5. Audit & Replay Lineage (`RecommendationAudit`)

To guarantee deterministic replay and decision provenance:
1. `RecommendationAudit` includes `athleteEvidenceLineage?: AthleteEvidenceLineageRef[]` where each entry records:
   - `recordId`: The stable pattern ID.
   - `version`: The version of the athlete evidence record.
   - `domain`: The evidence domain.
   - `refinementType`: The refinement applied.
   - `baseKnowledgeClaimId`: The underlying sports knowledge claim prior.
2. `snapshotAthleteEvidenceLineage()` and `compareAthleteEvidenceLineage()` in `knowledgeLineage.ts` verify that historical decisions can be audited for drift against current athlete profiles.

---

## 6. Verification & Test Coverage

- `app/src/knowledge/athleteEvidence.test.ts`: 9 tests verifying structural schema compliance, referential integrity against registry claim IDs, parameter bounding, and duplicate rejection.
- `app/src/knowledge/athleteEvidencePolicy.test.ts`: 11 tests verifying pure policy refinements, subjective calibration, recovery kinetics scaling, tissue tolerance restrictions, and safety monotonicity assertions.
- `app/src/engine/athleteEvidenceLineage.test.ts`: 7 tests verifying snapshotting, maximum ref cap (16), and replay drift detection.
