import pytest

from garmin_sync.archive import LocalRawArchiveStore, NullArchiveStore, create_archive_store


def test_local_archive_round_trip(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)
    payload = {"restingHeartRate": 50, "totalSteps": 10000}

    object_path = store.archive("stats", "2026-08-06", payload, "run-1", "0.3.8")

    assert object_path is not None
    loaded = store.load("stats", "2026-08-06")
    assert loaded == payload


def test_local_archive_idempotent_skip_on_identical_payload(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)
    payload = {"restingHeartRate": 50}

    first = store.archive("stats", "2026-08-06", payload, "run-1", "0.3.8")
    second = store.archive("stats", "2026-08-06", payload, "run-2", "0.3.8")

    assert first is not None
    assert second is None  # identical payload -> skipped, not re-uploaded


def test_local_archive_different_payload_same_date_not_skipped(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)

    first = store.archive("stats", "2026-08-06", {"restingHeartRate": 50}, "run-1", "0.3.8")
    second = store.archive("stats", "2026-08-06", {"restingHeartRate": 52}, "run-2", "0.3.8")

    assert first is not None
    assert second is not None
    # load() returns the most recently written payload
    assert store.load("stats", "2026-08-06") == {"restingHeartRate": 52}


def test_local_archive_load_missing_returns_none(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)
    assert store.load("stats", "2026-08-06") is None


def test_local_archive_list_archived_dates_range_filter(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)
    store.archive("sleep", "2026-08-01", {"a": 1}, "run-1", None)
    store.archive("sleep", "2026-08-05", {"a": 2}, "run-2", None)
    store.archive("sleep", "2026-08-10", {"a": 3}, "run-3", None)

    found = store.list_archived_dates("sleep", "2026-08-02", "2026-08-06")

    assert found == {"2026-08-05"}


def test_null_archive_store_is_always_a_noop(tmp_path):
    store = NullArchiveStore()
    assert store.archive("stats", "2026-08-06", {"x": 1}, "run-1") is None
    assert store.load("stats", "2026-08-06") is None
    assert store.list_archived_dates("stats", "2026-08-01", "2026-08-31") == set()


def test_archive_rejects_path_traversal_identifiers(tmp_path):
    store = LocalRawArchiveStore(base_dir=tmp_path)
    with pytest.raises(ValueError, match="endpoint"):
        store.archive("../tokens", "2026-08-06", {"x": 1}, "run-1")
    with pytest.raises(ValueError, match="logical date"):
        store.archive("stats", "2026-02-30", {"x": 1}, "run-1")
    with pytest.raises(ValueError, match="sync run ID"):
        store.archive("stats", "2026-08-06", {"x": 1}, "../run")


def test_create_archive_store_disabled_returns_null_store():
    store = create_archive_store(enabled=False)
    assert isinstance(store, NullArchiveStore)


def test_create_archive_store_gcs_requires_bucket():
    import pytest

    with pytest.raises(ValueError, match="bucket"):
        create_archive_store(enabled=True, store_type="gcs", bucket_name=None)
