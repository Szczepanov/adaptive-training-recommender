# ADR-0002: User-Scoped Firestore Isolation & Schema Version 3

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

Initially, early prototypes saved daily recovery snapshots under top-level root Firestore collections such as `daily_recovery_snapshot/{YYYY-MM-DD}` or utilized generic placeholder user IDs like `"default_user"`.

As the system moved towards multi-user support, authentication integration, and security rules enforcement, root-level collections posed severe privacy, isolation, and access control risks:
1. User data could bleed across tenants or be overwritten.
2. Firestore Security Rules could not easily restrict document access based on `request.auth.uid`.
3. Ingestion pipelines running with administrative SDK privileges risked writing improperly scoped records.

---

## Decision Outcome

We decided to enforce **strict user-scoped Firestore path hierarchies** across all storage operations:

1. **Path Hierarchy**: All daily recovery snapshots MUST be written under the user document hierarchy:
   ```text
   users/{firebaseUid}/daily_recovery_snapshots/{YYYY-MM-DD}
   ```
2. **Activity Subcollection**: Normalized activity records MUST be stored under:
   ```text
   users/{firebaseUid}/activities/{activityId}
   ```
3. **Prohibition of Default Users**: Hard enforcement in code that rejects `userId == "default_user"` or empty user IDs in [`FirestoreRecoveryRepository`](../../src/garmin_sync/firestore_repository.py).
4. **Schema Version 3 & Provenance**: Snapshots record schema version `3` along with explicit field-level source dates (`metricsDates`) tracking exact dates for sleep, HRV, resting HR, waking body battery, and step count.

---

## Code References

* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — Enforces `userId` validation and constructs paths `users/{userId}/daily_recovery_snapshots/{date_iso}`.
* [`src/garmin_sync/models.py`](../../src/garmin_sync/models.py) — Defines Domain Schema Version 3 models and `MetricsDates` provenance structure.

---

## Consequences

### Positive
* Enables clean, standard Firebase Security Rules (`match /users/{userId}/{document=**} { allow read, write: if request.auth.uid == userId; }`).
* Prevents data pollution between multiple users.
* Explicit `metricsDates` provenance makes debugging missing or delayed Garmin metrics straightforward.

### Negative
* Queries across multiple users require collection group indexes or separate administrative worker logic.
