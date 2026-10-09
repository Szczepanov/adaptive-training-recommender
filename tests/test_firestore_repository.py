from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from garmin_sync.firestore_repository import FirestoreRecoveryRepository
from garmin_sync.models import HealthObservationDayBundle


def _make_bundle(
    *, source_payload_hash: str, normalizer_version: int
) -> HealthObservationDayBundle:
    return HealthObservationDayBundle(
        userId="real_uid_456",
        logicalDate="2026-08-28",
        provider="eight_sleep",
        transport="eight_sleep_direct",
        observations=[],
        sourcePayloadHash=source_payload_hash,
        normalizerVersion=normalizer_version,
    )


def _mock_repo_with_existing_doc(
    *, existing_hash: str, existing_normalizer_version: int, existing_rev: int
) -> tuple[FirestoreRecoveryRepository, MagicMock]:
    """Forces the non-transactional fallback path (db.transaction = None) -- simpler and
    sufficient to exercise the dedup decision itself without fighting
    @firestore.transactional's expectations of a real Transaction object."""
    mock_db = MagicMock()
    mock_db.transaction = None
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "sourcePayloadHash": existing_hash,
        "normalizerVersion": existing_normalizer_version,
        "revision": existing_rev,
    }
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    return repo, doc_ref


def test_firestore_repository_rejects_default_user():
    with pytest.raises(ValueError, match="requires a valid non-default user_id"):
        FirestoreRecoveryRepository(user_id="default_user")


def test_firestore_repository_rejects_whitespace_only_user():
    with pytest.raises(ValueError, match="requires a valid non-default user_id"):
        FirestoreRecoveryRepository(user_id="   ")


def test_firestore_repository_preserves_exact_user_id():
    repo = FirestoreRecoveryRepository(user_id=" uid-with-spaces ", db=MagicMock())

    assert repo.user_id == " uid-with-spaces "


def test_firestore_repository_upsert_path_and_user_validation():
    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = False
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    valid_payload = {"userId": "real_uid_456", "date": "2026-08-06", "raw": {}}
    repo.upsert_snapshot("2026-08-06", valid_payload)

    mock_db.collection.assert_called_with("users")
    doc_ref.set.assert_called_once()
    saved_data = doc_ref.set.call_args[0][0]
    assert saved_data["userId"] == "real_uid_456"
    assert "createdAt" in saved_data
    assert "updatedAt" in saved_data


def test_firestore_repository_user_mismatch_raises_error():
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    invalid_payload = {"userId": "other_uid_789", "date": "2026-08-06", "raw": {}}
    with pytest.raises(ValueError, match="does not match configured user_id"):
        repo.upsert_snapshot("2026-08-06", invalid_payload)


def test_update_activity_enrichment_replaces_response_and_merges_sibling_fields() -> None:
    mock_db = MagicMock()
    doc_ref = MagicMock()
    activities_ref = mock_db.collection.return_value.document.return_value.collection.return_value
    activities_ref.document.return_value = doc_ref
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    repo.update_activity_enrichment(
        "activity-1",
        activity_response={
            "derivationVersion": "multi-resolution-v1",
            "segments": [],
        },
        merged_fields={
            "hrMeasurement": {
                "signalQuality": "good",
                "artifactFlags": [],
            },
            "fitWorkoutFingerprint": "fingerprint-v1",
        },
    )

    doc_ref.update.assert_called_once_with(
        {
            "activityResponse": {
                "derivationVersion": "multi-resolution-v1",
                "segments": [],
            },
            "hrMeasurement.signalQuality": "good",
            "hrMeasurement.artifactFlags": [],
            "fitWorkoutFingerprint": "fingerprint-v1",
        }
    )


def test_get_snapshots_batch_chunks_merges_and_filters_user_id() -> None:
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    date_isos = [(date(2024, 1, 1) + timedelta(days=index)).isoformat() for index in range(805)]
    repo._get_doc_ref = MagicMock(side_effect=lambda date_iso: SimpleNamespace(id=date_iso))
    excluded_dates = {date_isos[401], date_isos[800]}

    def get_all(refs: list[SimpleNamespace]) -> list[SimpleNamespace]:
        snapshots = []
        for ref in refs:
            if ref.id == date_isos[800]:
                snapshots.append(SimpleNamespace(id=ref.id, exists=False))
                continue
            user_id = "other_uid_789" if ref.id == date_isos[401] else repo.user_id
            data = {"userId": user_id, "date": ref.id}
            snapshots.append(
                SimpleNamespace(id=ref.id, exists=True, to_dict=lambda data=data: data)
            )
        return snapshots

    mock_db.get_all.side_effect = get_all

    snapshots = repo.get_snapshots_batch(date_isos)

    assert snapshots == {
        date_iso: {"userId": repo.user_id, "date": date_iso}
        for date_iso in date_isos
        if date_iso not in excluded_dates
    }
    chunks = [call.args[0] for call in mock_db.get_all.call_args_list]
    assert sorted(len(chunk) for chunk in chunks) == [5, 400, 400]
    assert {ref.id for chunk in chunks for ref in chunk} == set(date_isos)


def test_get_snapshots_batch_propagates_chunk_failure() -> None:
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    date_isos = [(date(2024, 1, 1) + timedelta(days=index)).isoformat() for index in range(401)]
    repo._get_doc_ref = MagicMock(side_effect=lambda date_iso: SimpleNamespace(id=date_iso))

    def get_all(refs: list[SimpleNamespace]) -> list[SimpleNamespace]:
        if refs[0].id == date_isos[400]:
            raise RuntimeError("synthetic Firestore failure")
        return []

    mock_db.get_all.side_effect = get_all

    with pytest.raises(RuntimeError, match="synthetic Firestore failure"):
        repo.get_snapshots_batch(date_isos)

    assert sorted(len(call.args[0]) for call in mock_db.get_all.call_args_list) == [1, 400]


def test_is_snapshot_complete_all_metrics_present():
    from garmin_sync.firestore_repository import is_snapshot_complete

    complete_snapshot = {
        "raw": {
            "sleepScore": 85,
            "sleepDurationSec": 28800,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        }
    }
    assert is_snapshot_complete(complete_snapshot) is True


def test_is_snapshot_complete_sleep_duration_fallback():
    from garmin_sync.firestore_repository import is_snapshot_complete

    snapshot = {
        "raw": {
            "sleepScore": None,
            "sleepDurationSec": 28800,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        }
    }
    assert is_snapshot_complete(snapshot) is True


@pytest.mark.parametrize(
    "missing_field",
    [
        "restingHr",
        "hrvOvernightAvg",
        "respirationAvg",
        "bodyBatteryWake",
        "totalSteps",
    ],
)
def test_is_snapshot_complete_missing_metric_returns_false(missing_field: str):
    from garmin_sync.firestore_repository import is_snapshot_complete

    snapshot = {
        "raw": {
            "sleepScore": 85,
            "sleepDurationSec": 28800,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        }
    }
    snapshot["raw"][missing_field] = None
    assert is_snapshot_complete(snapshot) is False


def test_is_snapshot_complete_missing_both_sleep_fields():
    from garmin_sync.firestore_repository import is_snapshot_complete

    snapshot = {
        "raw": {
            "sleepScore": None,
            "sleepDurationSec": None,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        }
    }
    assert is_snapshot_complete(snapshot) is False


def test_is_fresh_complete_snapshot(monkeypatch):
    from datetime import datetime

    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    complete_doc = {
        "source": {"garminSyncedAt": "2026-08-19T06:30:00+00:00"},
        "raw": {
            "sleepScore": 85,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        },
    }
    repo.get_snapshot = MagicMock(return_value=complete_doc)

    # Synced 30 mins ago -> Fresh under 60m threshold
    now_30m_later = datetime.fromisoformat("2026-08-19T07:00:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_30m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert repo.is_fresh("2026-08-19", staleness_minutes=60, incomplete_staleness_minutes=5) is True

    # Synced 70 mins ago -> Stale (> 60m)
    now_70m_later = datetime.fromisoformat("2026-08-19T07:40:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_70m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert (
        repo.is_fresh("2026-08-19", staleness_minutes=60, incomplete_staleness_minutes=5) is False
    )


def test_is_fresh_incomplete_snapshot_short_cooldown(monkeypatch):
    from datetime import datetime

    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    # Incomplete snapshot (sleep and HRV missing)
    incomplete_doc = {
        "source": {"garminSyncedAt": "2026-08-19T06:30:00+00:00"},
        "raw": {
            "sleepScore": None,
            "restingHr": 48,
            "hrvOvernightAvg": None,
            "respirationAvg": None,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        },
    }
    repo.get_snapshot = MagicMock(return_value=incomplete_doc)

    # Synced 2 mins ago -> Within incomplete cooldown (5m) -> True (rate-limit guard)
    now_2m_later = datetime.fromisoformat("2026-08-19T06:32:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_2m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert repo.is_fresh("2026-08-19", staleness_minutes=60, incomplete_staleness_minutes=5) is True

    # Synced 15 mins ago -> Exceeds incomplete cooldown (5m), even though < 60m -> False (triggers refetch!)
    now_15m_later = datetime.fromisoformat("2026-08-19T06:45:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_15m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert (
        repo.is_fresh("2026-08-19", staleness_minutes=60, incomplete_staleness_minutes=5) is False
    )


def test_is_fresh_snapshot_missing_or_no_timestamp():
    repo = FirestoreRecoveryRepository(user_id="real_uid_456")

    # Snapshot is None
    repo.get_snapshot = MagicMock(return_value=None)
    assert repo.is_fresh("2026-08-19") is False

    # Snapshot missing garminSyncedAt and updatedAt
    repo.get_snapshot = MagicMock(return_value={"source": {}, "raw": {}})
    assert repo.is_fresh("2026-08-19") is False


def test_is_fresh_invalid_synced_at_timestamp():
    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    doc_invalid_timestamp = {
        "source": {"garminSyncedAt": "not-an-iso-timestamp"},
        "raw": {},
    }
    repo.get_snapshot = MagicMock(return_value=doc_invalid_timestamp)
    assert repo.is_fresh("2026-08-19") is False


def test_is_fresh_exception_during_synced_at_parsing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import logging
    from unittest.mock import MagicMock

    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    doc_valid_str_trigger_exception = {
        "source": {"garminSyncedAt": "2026-08-19T06:30:00+00:00"},
        "raw": {},
    }
    repo.get_snapshot = MagicMock(return_value=doc_valid_str_trigger_exception)

    def mock_fromisoformat(_: str) -> None:
        raise RuntimeError("Unexpected datetime parsing error")

    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(fromisoformat=mock_fromisoformat),
    )

    with caplog.at_level(logging.WARNING):
        assert repo.is_fresh("2026-08-19") is False

    assert (
        "Failed to parse synced_at timestamp '2026-08-19T06:30:00+00:00': Unexpected datetime parsing error"
        in caplog.text
    )


def test_is_fresh_updated_at_fallback_and_naive_timestamp(monkeypatch):
    from datetime import datetime

    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    # garminSyncedAt missing, falls back to updatedAt which is naive ISO format
    doc_updated_at_fallback = {
        "updatedAt": "2026-08-19T06:30:00",
        "raw": {
            "sleepScore": 85,
            "restingHr": 48,
            "hrvOvernightAvg": 62,
            "respirationAvg": 14.5,
            "bodyBatteryWake": 90,
            "totalSteps": 10500,
        },
    }
    repo.get_snapshot = MagicMock(return_value=doc_updated_at_fallback)

    now_30m_later = datetime.fromisoformat("2026-08-19T07:00:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_30m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert repo.is_fresh("2026-08-19", staleness_minutes=60) is True


def test_is_fresh_incomplete_snapshot_require_complete_false(monkeypatch):
    from datetime import datetime

    repo = FirestoreRecoveryRepository(user_id="real_uid_456")
    incomplete_doc = {
        "source": {"garminSyncedAt": "2026-08-19T06:30:00+00:00"},
        "raw": {
            "sleepScore": None,
            "restingHr": 48,
        },
    }
    repo.get_snapshot = MagicMock(return_value=incomplete_doc)

    # Synced 30 mins ago -> With require_complete=False, incomplete snapshot uses full staleness_minutes (60m)
    now_30m_later = datetime.fromisoformat("2026-08-19T07:00:00+00:00")
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.datetime",
        MagicMock(
            now=MagicMock(return_value=now_30m_later),
            fromisoformat=datetime.fromisoformat,
        ),
    )
    assert (
        repo.is_fresh(
            "2026-08-19",
            staleness_minutes=60,
            incomplete_staleness_minutes=5,
            require_complete=False,
        )
        is True
    )


def test_save_health_observation_day_bundle_skips_when_hash_and_version_unchanged() -> None:
    repo, doc_ref = _mock_repo_with_existing_doc(
        existing_hash="sha256:abc", existing_normalizer_version=2, existing_rev=3
    )
    bundle = _make_bundle(source_payload_hash="sha256:abc", normalizer_version=2)

    changed, revision = repo.save_health_observation_day_bundle(bundle)

    assert (changed, revision) == (False, 3)
    doc_ref.set.assert_not_called()


def test_save_health_observation_day_bundle_persists_when_normalizer_version_bumped() -> None:
    """Regression: a mapper logic change (e.g. eight_sleep_mapper.py's ES-EXT extraction)
    must actually get re-persisted for already-fetched dates, even though the underlying
    raw payload -- and therefore sourcePayloadHash -- is unchanged. Before this fix, the
    dedup check only compared sourcePayloadHash, so a richer mapper output for the exact
    same upstream response was silently never written (confirmed against real data:
    'Day Bundles Saved: 0' despite genuinely new observations being computed)."""
    repo, doc_ref = _mock_repo_with_existing_doc(
        existing_hash="sha256:abc", existing_normalizer_version=1, existing_rev=3
    )
    bundle = _make_bundle(source_payload_hash="sha256:abc", normalizer_version=2)

    changed, revision = repo.save_health_observation_day_bundle(bundle)

    assert (changed, revision) == (True, 4)
    doc_ref.set.assert_called_once()


def test_save_health_observation_day_bundle_persists_when_hash_changed_regardless_of_version() -> (
    None
):
    """The original behavior (payload actually changed) must still work unchanged."""
    repo, doc_ref = _mock_repo_with_existing_doc(
        existing_hash="sha256:old", existing_normalizer_version=2, existing_rev=3
    )
    bundle = _make_bundle(source_payload_hash="sha256:new", normalizer_version=2)

    changed, revision = repo.save_health_observation_day_bundle(bundle)

    assert (changed, revision) == (True, 4)
    doc_ref.set.assert_called_once()


def _bundle_for(provider: str, *, source_payload_hash: str, normalizer_version: int = 2) -> Any:
    bundle = _make_bundle(
        source_payload_hash=source_payload_hash, normalizer_version=normalizer_version
    )
    bundle.provider = provider
    bundle.transport = "google_health"
    return bundle


def _snapshot(doc_id: str, data: dict[str, Any] | None) -> SimpleNamespace:
    return SimpleNamespace(id=doc_id, exists=data is not None, to_dict=lambda: data)


def _mock_bundle_db(snapshots: list[SimpleNamespace]) -> tuple[MagicMock, MagicMock]:
    """A db whose document refs are distinguishable by id, and whose reads (both
    db.get_all and txn.get_all) return the given snapshots in reverse request order --
    get_all does not promise request order, so results must be matched by id."""
    mock_db = MagicMock()
    collection_ref = mock_db.collection.return_value.document.return_value.collection.return_value
    collection_ref.document.side_effect = lambda doc_id: SimpleNamespace(id=doc_id)
    mock_db.get_all.return_value = list(reversed(snapshots))
    txn = MagicMock()
    txn.get_all.return_value = list(reversed(snapshots))
    mock_db.transaction.return_value = txn
    return mock_db, txn


_UNCHANGED_ID = "2026-08-28_garmin_google_health"
_NEW_ID = "2026-08-28_eight_sleep_google_health"
_HASH_CHANGED_ID = "2026-08-28_oura_google_health"
_NORMALIZER_BUMPED_ID = "2026-08-28_whoop_google_health"


def _mixed_bundles_and_snapshots() -> tuple[list[Any], list[SimpleNamespace]]:
    bundles = [
        _bundle_for("garmin", source_payload_hash="sha256:same"),
        _bundle_for("eight_sleep", source_payload_hash="sha256:new"),
        _bundle_for("oura", source_payload_hash="sha256:changed"),
        _bundle_for("whoop", source_payload_hash="sha256:same", normalizer_version=3),
    ]
    stored = {"sourcePayloadHash": "sha256:same", "normalizerVersion": 2}
    snapshots = [
        _snapshot(_UNCHANGED_ID, {**stored, "revision": 2}),
        _snapshot(_NEW_ID, None),
        _snapshot(_HASH_CHANGED_ID, {**stored, "revision": 4}),
        _snapshot(_NORMALIZER_BUMPED_ID, {**stored, "revision": 7}),
    ]
    return bundles, snapshots


def test_save_health_observation_day_bundles_batch_is_one_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The read-compare-write must stay transactional (the single-bundle save's guard
    against two concurrent syncs both claiming revision N+1), with one read and one
    commit for every bundle of the provider-date."""
    monkeypatch.setattr("garmin_sync.firestore_repository.firestore.transactional", lambda fn: fn)
    bundles, snapshots = _mixed_bundles_and_snapshots()
    mock_db, txn = _mock_bundle_db(snapshots)
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    results = repo.save_health_observation_day_bundles_batch(bundles)

    assert results == [(False, 2), (True, 1), (True, 5), (True, 8)]
    mock_db.transaction.assert_called_once()
    txn.get_all.assert_called_once()
    assert [ref.id for ref in txn.get_all.call_args[0][0]] == [
        _UNCHANGED_ID,
        _NEW_ID,
        _HASH_CHANGED_ID,
        _NORMALIZER_BUMPED_ID,
    ]
    written = {call.args[0].id: call.args[1] for call in txn.set.call_args_list}
    assert set(written) == {_NEW_ID, _HASH_CHANGED_ID, _NORMALIZER_BUMPED_ID}
    assert written[_HASH_CHANGED_ID]["revision"] == 5
    mock_db.get_all.assert_not_called()
    mock_db.batch.assert_not_called()


def test_save_health_observation_day_bundles_batch_non_transactional_fallback() -> None:
    bundles, snapshots = _mixed_bundles_and_snapshots()
    mock_db, _ = _mock_bundle_db(snapshots)
    mock_db.transaction = None
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    results = repo.save_health_observation_day_bundles_batch(bundles)

    assert results == [(False, 2), (True, 1), (True, 5), (True, 8)]
    mock_db.get_all.assert_called_once()
    batch = mock_db.batch.return_value
    assert batch.set.call_count == 3
    batch.commit.assert_called_once()


def test_save_health_observation_day_bundles_batch_skips_commit_when_nothing_changed() -> None:
    mock_db, _ = _mock_bundle_db(
        [
            _snapshot(
                _UNCHANGED_ID,
                {"sourcePayloadHash": "sha256:same", "normalizerVersion": 2, "revision": 2},
            )
        ]
    )
    mock_db.transaction = None
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    results = repo.save_health_observation_day_bundles_batch(
        [_bundle_for("garmin", source_payload_hash="sha256:same")]
    )

    assert results == [(False, 2)]
    mock_db.batch.return_value.commit.assert_not_called()


def test_save_health_observation_day_bundles_batch_chunks_at_firestore_commit_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("garmin_sync.firestore_repository.firestore.transactional", lambda fn: fn)
    mock_db, txn = _mock_bundle_db([])
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    bundles = [_bundle_for(f"p{i}", source_payload_hash="sha256:new") for i in range(501)]

    results = repo.save_health_observation_day_bundles_batch(bundles)

    assert results == [(True, 1)] * 501
    assert mock_db.transaction.call_count == 2
    assert [len(call.args[0]) for call in txn.get_all.call_args_list] == [500, 1]
    assert txn.set.call_count == 501


def test_save_health_observation_day_bundles_batch_rejects_duplicate_documents() -> None:
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    bundles = [
        _bundle_for("garmin", source_payload_hash="sha256:a"),
        _bundle_for("garmin", source_payload_hash="sha256:b"),
    ]

    with pytest.raises(ValueError, match="duplicate"):
        repo.save_health_observation_day_bundles_batch(bundles)

    mock_db.transaction.assert_not_called()


def test_save_health_observation_day_bundles_batch_empty_is_a_no_op() -> None:
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    assert repo.save_health_observation_day_bundles_batch([]) == []
    mock_db.collection.assert_not_called()


def test_delete_health_observation_day_bundles_batch_chunks_writes() -> None:
    mock_db = MagicMock()
    mock_batch = MagicMock()
    mock_db.batch.return_value = mock_batch
    collection_ref = MagicMock()
    mock_db.collection.return_value.document.return_value.collection.return_value = collection_ref
    collection_ref.document.side_effect = lambda doc_id: MagicMock(name=doc_id)

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    keys = [(f"2026-08-{(index % 28) + 1:02d}", "garmin", "google_health") for index in range(501)]

    assert repo.delete_health_observation_day_bundles_batch(keys) == 501
    assert mock_db.batch.call_count == 2
    assert mock_batch.delete.call_count == 501
    assert mock_batch.commit.call_count == 2


def test_delete_health_observation_day_bundles_batch_empty_is_noop() -> None:
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    assert repo.delete_health_observation_day_bundles_batch([]) == 0
    mock_db.batch.assert_not_called()


def test_get_snapshot_returns_data_when_doc_exists_and_matches_user() -> None:
    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {"userId": "real_uid_456", "date": "2026-08-06", "raw": {}}
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    res = repo.get_snapshot("2026-08-06")

    assert res == {"userId": "real_uid_456", "date": "2026-08-06", "raw": {}}


def test_get_snapshot_returns_none_when_doc_does_not_exist() -> None:
    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = False
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    res = repo.get_snapshot("2026-08-06")

    assert res is None


def test_get_snapshot_logs_warning_and_returns_none_on_user_mismatch(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {"userId": "other_uid_789", "date": "2026-08-06"}
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    with caplog.at_level(logging.WARNING):
        res = repo.get_snapshot("2026-08-06")

    assert res is None
    assert "Error reading Firestore snapshot for user real_uid_456 date 2026-08-06" in caplog.text
    assert "does not match repository user_id" in caplog.text


def test_get_snapshot_logs_warning_and_returns_none_on_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_ref.get.side_effect = RuntimeError("Firestore connection timeout")
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)
    with caplog.at_level(logging.WARNING):
        res = repo.get_snapshot("2026-08-06")

    assert res is None
    assert "Error reading Firestore snapshot for user real_uid_456 date 2026-08-06" in caplog.text
    assert "Firestore connection timeout" in caplog.text
