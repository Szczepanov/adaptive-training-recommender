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
):
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


def test_save_health_observation_day_bundle_skips_when_hash_and_version_unchanged():
    repo, doc_ref = _mock_repo_with_existing_doc(
        existing_hash="sha256:abc", existing_normalizer_version=2, existing_rev=3
    )
    bundle = _make_bundle(source_payload_hash="sha256:abc", normalizer_version=2)

    changed, revision = repo.save_health_observation_day_bundle(bundle)

    assert (changed, revision) == (False, 3)
    doc_ref.set.assert_not_called()


def test_save_health_observation_day_bundle_persists_when_normalizer_version_bumped():
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


def test_save_health_observation_day_bundle_persists_when_hash_changed_regardless_of_version():
    """The original behavior (payload actually changed) must still work unchanged."""
    repo, doc_ref = _mock_repo_with_existing_doc(
        existing_hash="sha256:old", existing_normalizer_version=2, existing_rev=3
    )
    bundle = _make_bundle(source_payload_hash="sha256:new", normalizer_version=2)

    changed, revision = repo.save_health_observation_day_bundle(bundle)

    assert (changed, revision) == (True, 4)
    doc_ref.set.assert_called_once()
