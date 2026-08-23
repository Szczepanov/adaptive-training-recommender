# Garmin gear mileage tracking

## Purpose

The Garmin sync imports the athlete's registered gear (for example running shoes and bikes), stores a user-scoped canonical snapshot in Firestore, and exposes current mileage plus any configured retirement-distance threshold to the preferences UI.

This is **current profile state**, not historical daily telemetry. It is refreshed after a successful live daily sync and is not replayed during historical rebuilds.

## Garmin data sources

Garmin exposes the data needed for this feature through two related calls:

1. `Garmin.get_user_profile()` resolves the `userProfilePk` required by the gear inventory endpoint.
2. `Garmin.get_gear(userProfilePk)` returns registered gear metadata such as `gearPk`, `uuid`, make/model, status, start/end dates, and `maximumMeters`.
3. `Garmin.get_gear_stats(uuid)` returns usage statistics for one gear item, including `totalDistance` in meters.

The inventory response does not reliably include accumulated mileage. `GarminClientWrapper.get_gear()` therefore enriches an inventory item with `get_gear_stats()` **only when `totalDistance` is absent**. If Garmin already includes `totalDistance`, the additional stats request is skipped.

The wrapper accepts these inventory response shapes and normalizes them to a list before the provider layer sees them:

- a list of gear objects;
- `{ "gearList": [...] }`;
- one gear object containing `gearPk`.

Unexpected shapes raise instead of being silently interpreted as an empty account.

## Failure semantics

Gear is supplementary data and must not make recovery synchronization fail.

- Low-level `GarminClientWrapper.get_gear()` does **not** convert API failures into `[]`; failures propagate to the provider enrichment boundary.
- `GarminProviderAdapter.fetch_gear()` uses the existing best-effort enrichment behavior, logs an endpoint failure, and returns no canonical gear for that attempt.
- `FirestoreRecoveryRepository.upsert_garmin_gear()` currently treats an empty canonical list as a no-op. This intentionally preserves the last successful gear snapshot when Garmin gear enrichment is unavailable.

This means a temporarily failing Garmin endpoint cannot erase previously synchronized mileage. The trade-off is that a genuinely successful account state containing zero gear items is also treated as a no-op; changing that behavior requires an explicit success/failure signal in `ProviderGearResult` rather than inferring success from an empty list.

## Canonical units and fields

`CanonicalGearItem` stores distances in kilometers:

- `total_distance_km`: Garmin `totalDistance` meters / 1000;
- `maximum_distance_km`: Garmin `maximumMeters` meters / 1000 when configured;
- `date_begin` / `date_end`: calendar-date portion (`YYYY-MM-DD`);
- `status`: normalized lowercase Garmin status.

The UI converts kilometers to miles when `preferences.preferredUnits.distance === "miles"`.

## Firestore layout

Each successful non-empty sync writes:

- `users/{userId}/gear/{gearPk}` — one document per gear item;
- `users/{userId}/preferences/profile.gearTracker` — compact list used by the preferences UI;
- `gearTracker.syncedAt` — UTC ISO timestamp for the snapshot.

Client security rules permit only the owning user to read `users/{userId}/gear/*`; client writes are denied. Sync writes are performed by the trusted backend.

## Request-volume considerations

A refresh costs one inventory call plus up to one stats call per gear item whose inventory object lacks `totalDistance`. Typical accounts contain a small number of active/retired items, but adding aggressive refresh cadences should account for this fan-out and Garmin rate limits.

## Regression coverage

`tests/test_garmin_gear_sync.py` verifies:

- automatic user-profile resolution;
- per-gear mileage enrichment from `get_gear_stats()`;
- `gearList` envelope normalization;
- skipping redundant stats calls when mileage is already present;
- propagation of low-level Garmin failures;
- end-to-end provider canonicalization from meters to kilometers.
