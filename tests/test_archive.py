from pathlib import Path

import pytest

from garmin_sync.archive import (
    ArchiveRecord,
    HealthArchiveRecord,
    LocalRawArchiveStore,
    NullArchiveStore,
    create_archive_store,
)


def test_local_archive_round_trip(tmp_path: Path) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)
    payload = {"restingHeartRate": 50, "totalSteps": 10000}

    object_path = store.archive(ArchiveRecord("stats", "2026-08-06", payload, "run-1", "0.3.8"))

    assert object_path is not None
    loaded = store.load("stats", "2026-08-06")
    assert loaded == payload


def test_local_archive_idempotent_skip_on_identical_payload(
    tmp_path: Path,
) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)
    payload = {"restingHeartRate": 50}

    first = store.archive(ArchiveRecord("stats", "2026-08-06", payload, "run-1", "0.3.8"))
    second = store.archive(ArchiveRecord("stats", "2026-08-06", payload, "run-2", "0.3.8"))

    assert first is not None
    assert second is None  # identical payload -> skipped, not re-uploaded


def test_local_archive_different_payload_same_date_not_skipped(
    tmp_path: Path,
) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)

    first = store.archive(
        ArchiveRecord("stats", "2026-08-06", {"restingHeartRate": 50}, "run-1", "0.3.8")
    )
    second = store.archive(
        ArchiveRecord("stats", "2026-08-06", {"restingHeartRate": 52}, "run-2", "0.3.8")
    )

    assert first is not None
    assert second is not None
    # load() returns the most recently written payload
    assert store.load("stats", "2026-08-06") == {"restingHeartRate": 52}


def test_local_archive_load_missing_returns_none(tmp_path: Path) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)
    assert store.load("stats", "2026-08-06") is None


def test_local_archive_list_archived_dates_range_filter(tmp_path: Path) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)
    store.archive(ArchiveRecord("sleep", "2026-08-01", {"a": 1}, "run-1", None))
    store.archive(ArchiveRecord("sleep", "2026-08-05", {"a": 2}, "run-2", None))
    store.archive(ArchiveRecord("sleep", "2026-08-10", {"a": 3}, "run-3", None))

    found = store.list_archived_dates("sleep", "2026-08-02", "2026-08-06")

    assert found == {"2026-08-05"}


def test_null_archive_store_is_always_a_noop(tmp_path: Path) -> None:
    store = NullArchiveStore()
    store.archive(ArchiveRecord("stats", "2026-08-06", {"x": 1}, "run-1"))
    store.load("stats", "2026-08-06")
    assert store.list_archived_dates("stats", "2026-08-01", "2026-08-31") == set()


def test_archive_rejects_path_traversal_identifiers(tmp_path: Path) -> None:
    store = LocalRawArchiveStore(base_dir=tmp_path)
    with pytest.raises(ValueError, match="endpoint"):
        store.archive(ArchiveRecord("../tokens", "2026-08-06", {"x": 1}, "run-1"))
    with pytest.raises(ValueError, match="logical date"):
        store.archive(ArchiveRecord("stats", "2026-02-30", {"x": 1}, "run-1"))
    with pytest.raises(ValueError, match="sync run ID"):
        store.archive(ArchiveRecord("stats", "2026-08-06", {"x": 1}, "../run"))


def test_local_archive_health_bundle_round_trip(tmp_path: Path) -> None:
    """Regression test: archive_health builds endpoint="health/{provider}_{transport}", which
    _object_dir validates as a single path segment and rejects because of the embedded "/" --
    this was a real bug (2026-08-27) that made every Google Health backfill archive attempt fail
    with production shapes like provider="google_health", transport="bundle". See
    docs/plans/2026-08-27-real-google-health-ingestion.md."""
    store = LocalRawArchiveStore(base_dir=tmp_path)
    record = HealthArchiveRecord(
        user_id="user123",
        provider="google_health",
        transport="bundle",
        logical_date="2026-08-07",
        payload=[{"metric": "sleep_duration_seconds", "value": 27000}],
        revision=1,
        normalizer_version=1,
    )

    object_path = store.archive_health(record)

    assert object_path is not None
    assert Path(object_path).exists()


def test_create_archive_store_disabled_returns_null_store() -> None:
    store = create_archive_store(enabled=False)
    assert isinstance(store, NullArchiveStore)


def test_create_archive_store_gcs_requires_bucket() -> None:
    import pytest

    with pytest.raises(ValueError, match="bucket"):
        create_archive_store(enabled=True, store_type="gcs", bucket_name=None)
