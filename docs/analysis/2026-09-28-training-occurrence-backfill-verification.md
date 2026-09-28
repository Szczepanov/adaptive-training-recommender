# Training Occurrence Backfill Verification — 2026-09-28

## Executive Summary

Issue [#870](https://github.com/Szczepanov/adaptive-training-recommender/issues/870) resolves the historical canonical-coverage gap demonstrated during the TO4 baseline in PR #853 without altering live recommendation decision authority.

Prior to backfill, 54 live Garmin activities across the 90-day baseline window (`2026-06-30` to `2026-09-27`) had no canonical occurrence counterpart (`pairedLiveOnly: 54`), resulting in a -19.43 systemic-cost delta and a -3124.5 min duration delta between legacy live history and canonical derived history.

The backfill command (`python -m garmin_sync backfill-training-occurrences`) was executed in production with create-only single-source Firestore transactions and verified for idempotency:
- **73** historical activities scanned in window
- **26** activities already possessed canonical occurrence links (preserved untouched, respecting the cutover boundary)
- **47** single-source `provider_activity` `PerformedTrainingOccurrence` and `PerformedOccurrenceSourceLink` records created
- **0** transaction failures, **0** anomalies
- Post-write verification audit confirmed **73/73** eligible activities linked to valid occurrences
- Re-running the command in apply mode created **0** records (`alreadyLinkedBeforeApply: 73`), confirming strict idempotency

Subsequent execution of the TO4 evidence pipeline (`export-training-occurrence-evidence` -> `evidence:training-occurrence:prepare` -> `evidence:training-occurrence`) confirmed complete elimination of the Garmin coverage gap:
- **`liveActivitiesAbsentFromCanonical: 0`** (every historical Garmin activity is now represented canonically)
- **Derived canonical exposures increased from 22 to 69**
- **Paired matched exposures increased from 20 to 69**
- **Systemic cost delta reduced from -19.43 to -1.38**
- **Duration delta reduced from -3124.5 min to -276.5 min**
- The remaining delta consists solely of 5 non-wearable adhered recommendation records and 2 non-catalog manual executions

All applicable hard gates passed (`noCrossUserEvidenceLeakage`, `noSourceUniquenessViolations`, `deterministicReplayStable`, `noKnownFalsePositiveMerges`, `matchedOccurrenceSingleExposure`, `structuredSemanticAuthorityPreserved`, `missingDetailRemainsUnknown`).

Live recommendation authority remains **100% unchanged** (`POLICY_VERSION` untouched; legacy `buildTrainingHistorySnapshot` remains the decision authority).

---

## Provenance and Environment

- **Issue**: [#870](https://github.com/Szczepanov/adaptive-training-recommender/issues/870)
- **Corpus Window**: `2026-06-30` to `2026-09-27` (90 days)
- **Reconciliation Matcher**: `matcher-v1`
- **Reconciliation Policy**: `policy-v1`
- **Coverage Policy**: `2026-09-canonical-coverage-credit-v1`
- **FIT Fingerprint**: `fit-workout-v2`
- **Engine `POLICY_VERSION`**: `2026-09-mechanical-progression-live-wiring-v1` (unchanged)
- **Recommendation Authority**: `legacy-completed-training-events` (unchanged)

---

## Pre-occurrence Backfill Execution Record

### Dry-run (Audit)
```text
=== TRAINING OCCURRENCE BACKFILL (DRY RUN) ===
window: 2026-06-30 to 2026-09-27
activitiesScanned: 73
eligibleActivities: 47
alreadyLinked: 26
wouldCreate: 47
anomalies: 0
```

### Apply (Transactions)
```text
=== APPLYING TRAINING OCCURRENCE BACKFILL ===
window: 2026-06-30 to 2026-09-27
activitiesScanned: 73
plannedCandidates: 47
created: 47
alreadyLinkedBeforeApply: 26
concurrentlyLinked: 0
failed: 0
anomalies: 0
=== POST-WRITE VERIFICATION AUDIT ===
eligibleActivitiesChecked: 73
verifiedLinks: 73
missingLinks: 0
invalidLinks: 0
auditPassed: True
```

### Idempotency Check (Immediate Re-run)
```text
=== APPLYING TRAINING OCCURRENCE BACKFILL ===
window: 2026-06-30 to 2026-09-27
activitiesScanned: 73
plannedCandidates: 0
created: 0
alreadyLinkedBeforeApply: 73
concurrentlyLinked: 0
failed: 0
anomalies: 0
=== POST-WRITE VERIFICATION AUDIT ===
eligibleActivitiesChecked: 73
verifiedLinks: 73
missingLinks: 0
invalidLinks: 0
auditPassed: True
```

---

## TO4 Shadow Evidence Comparison

| Metric | PR #853 Baseline (Pre-Backfill) | Post-Backfill (#870) | Delta |
|---|---|---|---|
| **Performed Occurrences in Window** | 25 | 72 | +47 |
| **Garmin Activities in Window** | 73 | 73 | 0 |
| **Live Activities Absent from Canonical** | 54 | **0** | **-54** |
| **Canonical Derived Exposures** | 22 | **69** | **+47** |
| **Paired Matched Exposures** | 20 | **69** | **+49** |
| **Paired Live-Only Exposures** | 54 | **7** | **-47** |
| **Systemic Cost Total (Live / Canonical)** | 27.84 / 8.41 (Δ -19.43) | 27.84 / 26.45 (Δ **-1.38**) | **+18.05** |
| **Cardiovascular Cost Total (Live / Canonical)** | 28.68 / 8.65 (Δ -20.03) | 28.68 / 27.66 (Δ **-1.02**) | **+19.01** |
| **Lower Body Cost Total (Live / Canonical)** | 27.53 / 8.28 (Δ -19.25) | 27.53 / 26.19 (Δ **-1.33**) | **+17.92** |
| **Duration Minutes (Live / Canonical)** | 4327.5 / 1203.0 (Δ -3124.5) | 4327.5 / 4051.0 (Δ **-276.5**) | **+2848.0 min** |

### Decomposition of Remaining Gap (7 Live-Only Exposures)

The remaining 7 un-paired live exposures comprise:
1. **5 Daily Recommendations with followed adherence but no wearable activity**:
   - `2026-08-08` (`occ-0030`)
   - `2026-08-15` (`occ-0037`)
   - `2026-08-17` (`occ-0041`)
   - `2026-08-29` (`occ-0051`)
   - `2026-09-20` (`occ-0073`)
2. **2 Non-catalog manual executions**:
   - `unknownByReason.non_catalog_structured_semantics: 2`

Separately, canonical derivation reported `unknownByReason.multiple_provider_sources: 1`; that is a derivation classification, not an eighth live-only exposure.

No Garmin activity lacks canonical occurrence coverage.

---

## Hard Gates Status

| Hard Gate | Status | Detail |
|---|---|---|
| `noCrossUserEvidenceLeakage` | **PASS** | Evaluated on all 193 records, 0 cross-user records detected |
| `noSourceUniquenessViolations` | **PASS** | 0 source link conflicts across 72 active occurrences |
| `deterministicReplayStable` | **PASS** | 2 independent pairing derivations produced identical hash |
| `noKnownFalsePositiveMerges` | **PASS** | 4/4 auto-merged occurrences reviewed and verified (`correct_merge`) |
| `matchedOccurrenceSingleExposure` | **PASS** | Single canonical exposure emitted per matched occurrence |
| `structuredSemanticAuthorityPreserved` | **PASS** | Structured catalog metadata preserved without Garmin overwrites |
| `missingDetailRemainsUnknown` | **PASS** | Fail-closed on missing detail |

---

## Non-Negotiable Invariants Compliance

1. **User Isolation**: All operations restricted strictly to user-scoped path `users/{APP_USER_ID}/...`. No collection-group queries or top-level user enumeration.
2. **Timezone Semantics**: All occurrence `localDate` attributes resolved to Europe/Warsaw local calendar date matching `activity.date`.
3. **Transactions Over Batch**: Atomic single-source Firestore transactions with create-only semantics to eliminate TOCTOU races with live sync.
4. **Preservation of Manual Decisions**: The `performedOccurrenceSourceLinks` index serves as the cutover boundary; existing links (including manual unlinks, keep_separates, and merges) are never overwritten.
5. **Decision Authority Isolation**: Zero changes to live recommendation authority. `POLICY_VERSION` remains untouched.
6. **No Credential Leaks**: Artifact directories are git-ignored. No credentials, tokens, or PII committed.

---

## Post-review implementation hardening

A code-review pass after the production execution above tightened the operator implementation without changing the historical execution record or recommendation authority:

- apply now refuses **all** preflight anomalies before creating any new occurrence, rather than blocking only a subset of invariant failures;
- preflight independently verifies that each active Garmin source ref owns the corresponding source-link claim and detects duplicate active source ownership;
- the post-write audit independently scans active canonical occurrences, so a duplicate source ref cannot be hidden by the single unique source-link document;
- a concurrently-created source link is validated before being accepted as an idempotent concurrent win;
- explicit `--user-id` now works as the command's configuration identity even when `APP_USER_ID` was not already exported;
- the documented modality vocabulary now matches the canonical TypeScript reconciliation vocabulary.

The 73/73 production audit above predates these stricter checks; it remains a historical execution record and is not represented as a rerun under the hardened implementation.
