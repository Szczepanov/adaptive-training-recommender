# Python Backend (`src/garmin_sync/`)

Ingests wearable recovery and activity telemetry from Garmin Connect, Google Health, and Eight Sleep into immutable raw archives and user-scoped Firestore snapshots.

## Key Modules & Responsibilities

- `cli.py` — CLI parser and entrypoints (`sync`, `sync-all`, `backfill`, `backfill-health`, `backfill-eight-sleep-direct`, `rebuild`, `audit`, `audit-multisource`, `compare-transports`, `export-identity-replay`, `push-workout`, `poll-manual-sync`).
- `dates.py` — `Europe/Warsaw` date provider (`local_today()`). All snapshot date keys derive from this module.
- `provider.py` & `canonical.py` — Vendor-neutral `WearableProvider` / `RecoveryObservationProvider` protocols and canonical domain records (`CanonicalHealthObservation`, activity summaries).
- `garmin_client.py` & `garmin_provider.py` — Garmin API wrapper with exponential backoff and the sole adapter allowed to parse Garmin JSON shapes.
- `google_health_auth.py`, `google_health_client.py`, `google_health_mapper.py`, `google_health_provider.py` — Google Health v4 OAuth, client, and source-aware observation mapper (ADR-0027).
- `eight_sleep_client.py`, `eight_sleep_mapper.py`, `eight_sleep_provider.py` — Opt-in direct Eight Sleep transport (ADR-0030).
- `metrics.py` & `mapper.py` — Pure rolling baseline calculations (7d/28d) and provider-neutral assembly of `DailyRecoverySnapshot` (`models.py`, Schema Version 3).
- `firestore_repository.py` — User-scoped persistence under `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}` and multisource observations.
- `archive.py` — Immutable local/GCS raw payload archive supporting deterministic offline `rebuild` (ADR-0005).
- `fit_activity.py`, `fit_workout_identity.py`, `hr_fidelity.py` — Strict in-memory FIT decoding, structured workout fingerprinting (ADR-0034), and shadow exercise HR trace fidelity analysis (ADR-0031).
- `identity_eligibility.py` — Fail-closed effective-identity eligibility projection across multiple wearable sources (ADR-0028).
