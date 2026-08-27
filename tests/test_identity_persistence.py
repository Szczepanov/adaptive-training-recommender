from collections.abc import Mapping
from typing import Any

import pytest
from google.cloud.exceptions import Conflict

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

    def create(self, value: Mapping[str, Any]) -> None:
        if self._path in self._store:
            raise Conflict("document already exists")
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
        "identityScore": 0.42,
        "confidenceTier": "LOW",
        "reasonCodes": ["SESSION_TIMING_DISCORDANT"],
        "passportVersion": "2026-08-27.1",
        "policyVersion": "identity-v1-shadow",
        "featureSchemaVersion": "identity-features-v1",
        "assessedAt": "2026-08-27T06:30:00.000Z",
        "sharedBundleRef": {
            "id": "2026-08-27_shared_bed_health_aggregator",
            "provider": "shared_bed",
            "transport": "health_aggregator",
            "revision": 2,
            "sourcePayloadHash": "sha256:shared",
            "lineageKey": "shared_bed:pod-side:a",
        },
        "anchorBundleRefs": [
            {
                "id": "2026-08-27_garmin_garmin_direct",
                "provider": "garmin",
                "transport": "garmin_direct",
                "revision": 1,
                "sourcePayloadHash": "sha256:anchor",
                "lineageKey": "garmin:device:athlete",
            }
        ],
    }


def _passport_core() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "passportVersion": "2026-08-27.1",
        "createdAt": "2026-08-27T06:00:00Z",
        "policyVersion": "identity-v1-shadow",
        "featureSchemaVersion": "identity-features-v1",
        "anchorPolicy": {
            "primaryProvider": "garmin",
            "primaryTransport": "garmin_direct",
            "role": "personal_wearable_anchor",
            "requireIndependentLineage": True,
        },
        "sourceProfiles": {},
        "crossSourceProfiles": {},
        "calibration": {
            "manualUserCount": 0,
            "manualNotUserCount": 0,
            "mixedOccupancyCount": 0,
            "uncertainCount": 0,
            "shadowWindowStart": None,
            "shadowWindowEnd": None,
        },
    }


def _passport_version() -> dict[str, Any]:
    return {
        **_passport_core(),
        "trainingSetHash": "a" * 64,
        "trainingObservationCount": 1,
        "trainingWindowStart": "2026-08-01",
        "trainingWindowEnd": "2026-08-27",
        "previousVersion": None,
        "changeReason": "INITIAL_BOOTSTRAP",
        "algorithmVersion": "identity-passport-v1",
    }


def _current_passport() -> dict[str, Any]:
    return {**_passport_core(), "updatedAt": "2026-08-27T07:00:00Z"}


def _review() -> dict[str, Any]:
    return {
        "id": "review-1",
        "assessmentId": "assessment-1",
        "schemaVersion": 1,
        "label": "USER",
        "occupancyAttestation": "EXCLUSIVE",
        "supersedesReviewEventId": None,
        "recordedAt": "2026-08-27T08:00:00.000Z",
        "source": "admin_replay",
    }


def test_identity_server_documents_round_trip_and_remain_immutable() -> None:
    repository = FirestoreRecoveryRepository("athlete-1", db=_Db())
    assessment = _assessment()

    assert repository.save_automatic_identity_assessment(assessment) is True
    assert repository.get_automatic_identity_assessment("assessment-1") == assessment
    assert repository.save_automatic_identity_assessment(dict(assessment)) is False
    with pytest.raises(ValueError, match="already exists with different content"):
        repository.save_automatic_identity_assessment({**assessment, "automaticStatus": "USER"})

    version = _passport_version()
    current = _current_passport()
    assert repository.save_identity_passport_version(version) is True
    repository.set_current_identity_passport(current)
    assert repository.get_identity_passport_version("2026-08-27.1") == version
    assert repository.get_current_identity_passport() == current

    event = _review()
    assert repository.save_identity_review_event(event) is True
    assert repository.save_identity_review_event(event) is False


def test_identity_persistence_rejects_incomplete_or_malformed_documents() -> None:
    repository = FirestoreRecoveryRepository("athlete-1", db=_Db())

    assessment = _assessment()
    assessment.pop("policyVersion")
    with pytest.raises(ValueError, match="assessment does not match"):
        repository.save_automatic_identity_assessment(assessment)

    version = _passport_version()
    version.pop("algorithmVersion")
    with pytest.raises(ValueError, match="passport version does not match"):
        repository.save_identity_passport_version(version)

    current = _current_passport()
    current.pop("anchorPolicy")
    with pytest.raises(ValueError, match="Current identity passport does not match"):
        repository.set_current_identity_passport(current)

    review = _review()
    review["occupancyAttestation"] = "UNKNOWN"
    with pytest.raises(ValueError, match="review event does not match"):
        repository.save_identity_review_event(review)


def test_repository_derives_effective_decision_index_from_persisted_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = FirestoreRecoveryRepository("athlete-1", db=_Db())
    assessment = _assessment()
    review = {**_review(), "source": "user_ui"}
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
