from collections.abc import Mapping
from typing import Any

import pytest

from garmin_sync.firestore_repository import FirestoreRecoveryRepository


class _Snapshot:
    def __init__(self, value: dict[str, Any] | None):
        self._value = value
        self.exists = value is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._value


class _Document:
    def __init__(self, store: dict[str, dict[str, Any]], path: str):
        self._store = store
        self._path = path

    def collection(self, name: str) -> "_Collection":
        return _Collection(self._store, f"{self._path}/{name}")

    def get(self) -> _Snapshot:
        return _Snapshot(self._store.get(self._path))

    def set(self, value: Mapping[str, Any]) -> None:
        self._store[self._path] = dict(value)


class _Collection:
    def __init__(self, store: dict[str, dict[str, Any]], path: str):
        self._store = store
        self._path = path

    def document(self, document_id: str) -> _Document:
        return _Document(self._store, f"{self._path}/{document_id}")


class _Db:
    def __init__(self) -> None:
        self.store: dict[str, dict[str, Any]] = {}

    def collection(self, name: str) -> _Collection:
        return _Collection(self.store, name)


def _assessment() -> dict[str, Any]:
    return {
        "id": "assessment-1",
        "sourceNightKey": "2026-08-27",
        "sharedSource": {"provider": "shared_bed", "transport": "health_aggregator"},
        "automaticStatus": "UNCERTAIN",
        "reasonCodes": ["SESSION_TIMING_DISCORDANT"],
        "sharedBundleRef": {
            "id": "2026-08-27_shared_bed_health_aggregator",
            "provider": "shared_bed",
            "transport": "health_aggregator",
            "revision": 2,
            "sourcePayloadHash": "sha256:shared",
        },
    }


def test_identity_server_documents_round_trip_and_remain_immutable() -> None:
    repository = FirestoreRecoveryRepository("athlete-1", db=_Db())
    assessment = _assessment()

    assert repository.save_automatic_identity_assessment(assessment) is True
    assert repository.get_automatic_identity_assessment("assessment-1") == assessment
    assert repository.save_automatic_identity_assessment(dict(assessment)) is False
    with pytest.raises(ValueError, match="already exists with different content"):
        repository.save_automatic_identity_assessment({**assessment, "automaticStatus": "USER"})

    version = {"passportVersion": "2026-08-27.1", "trainingSetHash": "a" * 64}
    current = {"passportVersion": "2026-08-27.1", "updatedAt": "2026-08-27T07:00:00Z"}
    assert repository.save_identity_passport_version(version) is True
    repository.set_current_identity_passport(current)
    assert repository.get_identity_passport_version("2026-08-27.1") == version
    assert repository.get_current_identity_passport() == current

    event = {
        "id": "review-1",
        "assessmentId": "assessment-1",
        "schemaVersion": 1,
        "label": "USER",
        "occupancyAttestation": "EXCLUSIVE",
        "supersedesReviewEventId": None,
        "recordedAt": "2026-08-27T08:00:00.000Z",
        "source": "admin_replay",
    }
    assert repository.save_identity_review_event(event) is True
    assert repository.save_identity_review_event(event) is False


def test_repository_derives_effective_decision_index_from_persisted_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = FirestoreRecoveryRepository("athlete-1", db=_Db())
    assessment = _assessment()
    review = {
        "id": "review-1",
        "assessmentId": "assessment-1",
        "schemaVersion": 1,
        "label": "USER",
        "occupancyAttestation": "EXCLUSIVE",
        "supersedesReviewEventId": None,
        "recordedAt": "2026-08-27T08:00:00.000Z",
    }
    monkeypatch.setattr(
        repository, "get_identity_assessments_in_range", lambda _start, _end: [assessment]
    )
    monkeypatch.setattr(repository, "get_identity_review_events", lambda _assessment_id: [review])

    decisions = repository.get_effective_identity_decision_projections_in_range(
        "2026-08-27", "2026-08-27"
    )

    projection = decisions[("2026-08-27", "shared_bed", "health_aggregator")]
    assert projection.effective_status == "USER"
    assert projection.review_event_id == "review-1"
    assert projection.baseline_learning is True
