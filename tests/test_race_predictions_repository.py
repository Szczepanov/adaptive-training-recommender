from unittest.mock import MagicMock

from garmin_sync.canonical import CanonicalPerformanceTargets, CanonicalRacePredictions
from garmin_sync.firestore_repository import FirestoreRecoveryRepository


def test_race_prediction_refresh_preserves_missing_distances(monkeypatch):
    monkeypatch.setattr(
        "garmin_sync.firestore_repository.firestore.transactional",
        lambda fn: fn,
    )

    existing_predictions = {
        "fiveKmSec": 1200,
        "tenKmSec": 2500,
        "halfMarathonSec": 5600,
        "marathonSec": 11900,
        "fetchedAt": "2026-08-22T06:00:00+00:00",
    }
    snapshot = MagicMock()
    snapshot.exists = True
    snapshot.to_dict.return_value = {
        "performanceProfile": {
            "garmin": {"racePredictions": dict(existing_predictions)},
            "racePredictions": dict(existing_predictions),
        }
    }

    doc_ref = MagicMock()
    doc_ref.get.return_value = snapshot
    collection = MagicMock()
    collection.document.return_value = doc_ref
    user_doc = MagicMock()
    user_doc.collection.return_value = collection
    users = MagicMock()
    users.document.return_value = user_doc
    db = MagicMock()
    db.collection.return_value = users
    transaction = MagicMock()
    db.transaction.return_value = transaction

    repo = FirestoreRecoveryRepository(user_id="uid", db=db)
    repo.upsert_garmin_performance_targets(
        CanonicalPerformanceTargets(race_predictions=CanonicalRacePredictions(five_km_sec=1185))
    )

    payload = transaction.set.call_args.args[1]
    profile = payload["performanceProfile"]
    expected = {
        "fiveKmSec": 1185,
        "tenKmSec": 2500,
        "halfMarathonSec": 5600,
        "marathonSec": 11900,
    }

    for key, value in expected.items():
        assert profile["garmin"]["racePredictions"][key] == value
        assert profile["racePredictions"][key] == value

    assert profile["garmin"]["racePredictions"]["fetchedAt"] != existing_predictions["fetchedAt"]
    assert profile["racePredictions"] == profile["garmin"]["racePredictions"]
