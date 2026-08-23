from copy import deepcopy

from garmin_sync.canonical import CanonicalPerformanceTargets
from garmin_sync.firestore_repository import FirestoreRecoveryRepository


class _Snapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return deepcopy(self._data)


class _Document:
    def __init__(self, data):
        self.data = data

    def get(self, transaction=None):
        return _Snapshot(self.data)


class _Collection:
    def __init__(self, document):
        self._document = document

    def document(self, _id):
        return self._document if _id == "profile" else self

    def collection(self, _name):
        return self


class _Transaction:
    def set(self, doc_ref, payload, merge=True):
        assert merge is True
        doc_ref.data = {**(doc_ref.data or {}), **payload}


class _Db:
    def __init__(self, profile):
        self.profile = _Document(profile)

    def collection(self, _name):
        return _Collection(self.profile)

    def transaction(self):
        return _Transaction()


def test_garmin_target_import_preserves_manual_targets_and_prior_partial_imports(monkeypatch):
    # The Firebase decorator normally retries real transactions; the fake is enough to
    # exercise the transaction body and inspect its atomic payload deterministically.
    monkeypatch.setattr("garmin_sync.firestore_repository.firestore.transactional", lambda fn: fn)
    db = _Db(
        {
            "userId": "u1",
            "performanceProfile": {
                "ftpWatts": 280,
                "lthrBpm": 165,
                "targetSources": {"ftpWatts": "manual", "lthrBpm": "garmin"},
                "garmin": {"thresholdPaceSecPerKm": 275, "fetchedAt": "old"},
            },
        }
    )
    repository = FirestoreRecoveryRepository(user_id="u1", db=db)

    repository.upsert_garmin_performance_targets(
        CanonicalPerformanceTargets(
            cycling_ftp_watts=250,
            running_lthr_bpm=170,
        )
    )

    profile = db.profile.data["performanceProfile"]
    assert profile["ftpWatts"] == 280  # manual always wins
    assert profile["lthrBpm"] == 170  # Garmin-owned value refreshes
    assert profile["garmin"]["ftpWatts"] == 250
    assert (
        profile["garmin"]["thresholdPaceSecPerKm"] == 275
    )  # partial response retains prior import
    assert profile["targetSources"]["ftpWatts"] == "manual"


def test_garmin_target_import_preserves_coach_value_and_provenance(monkeypatch):
    monkeypatch.setattr("garmin_sync.firestore_repository.firestore.transactional", lambda fn: fn)
    db = _Db(
        {
            "userId": "u1",
            "performanceProfile": {
                "weightKg": 72.0,
                "targetSources": {"weightKg": "coach"},
            },
        }
    )
    repository = FirestoreRecoveryRepository(user_id="u1", db=db)

    repository.upsert_garmin_performance_targets(
        CanonicalPerformanceTargets(
            weight_kg=74.5,
            weight_measured_at="2026-08-23",
        )
    )

    profile = db.profile.data["performanceProfile"]
    assert profile["weightKg"] == 72.0
    assert profile["targetSources"]["weightKg"] == "coach"
    assert profile["garmin"]["weightKg"] == 74.5
    assert profile["garmin"]["weightMeasuredAt"] == "2026-08-23"


def test_first_garmin_import_creates_a_complete_preferences_document(monkeypatch):
    monkeypatch.setattr("garmin_sync.firestore_repository.firestore.transactional", lambda fn: fn)
    db = _Db(None)
    repository = FirestoreRecoveryRepository(user_id="u1", db=db)

    repository.upsert_garmin_performance_targets(
        CanonicalPerformanceTargets(
            cycling_ftp_watts=250,
            weight_kg=73.5,
            body_fat_pct=14.0,
            weight_measured_at="2026-08-23",
        )
    )

    assert db.profile.data["preferredModalities"] == ["Running", "Cycling", "Strength"]
    assert db.profile.data["performanceProfile"]["ftpWatts"] == 250
    assert db.profile.data["performanceProfile"]["weightKg"] == 73.5
    assert db.profile.data["performanceProfile"]["bodyFatPct"] == 14.0
    assert db.profile.data["performanceProfile"]["targetSources"]["ftpWatts"] == "garmin"
    assert db.profile.data["performanceProfile"]["targetSources"]["weightKg"] == "garmin"
    assert db.profile.data["performanceProfile"]["garmin"]["weightKg"] == 73.5
    assert db.profile.data["performanceProfile"]["garmin"]["weightMeasuredAt"] == "2026-08-23"
