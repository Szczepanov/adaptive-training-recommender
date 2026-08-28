"""Retroactive Garmin Direct sleep session timing backfill.

Real Garmin sleep API responses have always included `dailySleepDTO.sleepStartTimestampGMT`/
`sleepEndTimestampGMT`, and every raw response has always been archived (`service.py`'s
`_archive_daily_payloads`, `endpoint="sleep"`) -- but nothing ever persisted those two fields into
`daily_recovery_snapshots`, so nights synced before that plumbing gap was closed (see
`garmin_provider.py`'s `_sleep_window_gmt_ms`/`_epoch_ms_to_utc_iso`, `models.py`'s
`RawMetrics.sleepStartTimeGmt`/`sleepEndTimeGmt`) have no session timing and `identityReplay.ts`
input rows built from them show `garminSessions: []` for a reason that no longer reflects reality
going forward.

This module closes that gap for already-collected history without re-fetching anything from
Garmin's live API: the exact same raw sleep payload used at sync time is still sitting in the raw
archive (GCS or local, per `RawArchiveStore`), so it can be read back and re-derived.

This is a targeted field patch, not a resync: `patch_sleep_timing_for_range` only ever writes
`raw.sleepStartTimeGmt`/`raw.sleepEndTimeGmt`, via `FirestoreRecoveryRepository.
patch_snapshot_fields`'s explicit dotted-field-path `update()` -- not `upsert_snapshot`'s
`set(..., merge=True)`, whose nested-map merge semantics are the wrong tool for touching exactly
two fields on a document that also carries restingHr/hrvOvernightAvg/sleepScore/etc. Never touches
any other field, and never creates a document that doesn't already exist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .archive import RawArchiveStore
from .firestore_repository import FirestoreRecoveryRepository
from .garmin_provider import _epoch_ms_to_utc_iso, _sleep_window_gmt_ms


@dataclass
class SleepTimingBackfillResult:
    datesChecked: int = 0
    datesPatched: int = 0
    datesSkippedNoArchive: int = 0
    datesSkippedNoTimestamps: int = 0
    datesSkippedAlreadyPresent: int = 0
    patchedDates: list[str] = field(default_factory=list)


def _iter_dates(start_date_iso: str, end_date_iso: str) -> list[str]:
    start_dt = datetime.strptime(start_date_iso, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_iso, "%Y-%m-%d")
    dates: list[str] = []
    curr = start_dt
    while curr <= end_dt:
        dates.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
    return dates


def patch_sleep_timing_for_range(
    repository: FirestoreRecoveryRepository,
    archive_store: RawArchiveStore,
    start_date_iso: str,
    end_date_iso: str,
    *,
    overwrite_existing: bool = False,
) -> SleepTimingBackfillResult:
    """Re-derives and patches sleepStartTimeGmt/sleepEndTimeGmt onto existing
    daily_recovery_snapshots documents from the already-archived raw sleep payload.

    A date is skipped (not patched) when: there's no existing snapshot document for it (nothing to
    patch -- this never creates a snapshot), no archived "sleep" payload exists for it, the archived
    payload has no parseable sleepStartTimestampGMT/sleepEndTimestampGMT (e.g. a sleep_fallback-only
    day whose fallback record predates this backfill's own D-1 resolution -- real, honest gaps, not
    errors), or the document already has both fields and `overwrite_existing` is False (default:
    this backfill is additive, not a correction tool for already-patched data).
    """
    result = SleepTimingBackfillResult()
    existing_snapshots = repository.get_historical_snapshots(start_date_iso, end_date_iso)
    archived_dates = archive_store.list_archived_dates("sleep", start_date_iso, end_date_iso)

    for date in _iter_dates(start_date_iso, end_date_iso):
        result.datesChecked += 1
        snapshot = existing_snapshots.get(date)
        if snapshot is None:
            continue

        raw = snapshot.get("raw", {}) if isinstance(snapshot.get("raw"), dict) else {}
        if not overwrite_existing and raw.get("sleepStartTimeGmt") and raw.get("sleepEndTimeGmt"):
            result.datesSkippedAlreadyPresent += 1
            continue

        if date not in archived_dates:
            result.datesSkippedNoArchive += 1
            continue

        payload = archive_store.load("sleep", date)
        start_ms, end_ms = _sleep_window_gmt_ms(payload if isinstance(payload, dict) else {})
        start_iso = _epoch_ms_to_utc_iso(start_ms)
        end_iso = _epoch_ms_to_utc_iso(end_ms)
        if not start_iso or not end_iso:
            result.datesSkippedNoTimestamps += 1
            continue

        patched = repository.patch_snapshot_fields(
            date,
            {
                "raw.sleepStartTimeGmt": start_iso,
                "raw.sleepEndTimeGmt": end_iso,
            },
        )
        if patched:
            result.datesPatched += 1
            result.patchedDates.append(date)

    return result
