"""Synthetic tests for the #646 TO4/TO5 evidence extractors. No live Firestore or Garmin calls."""

import os
from datetime import datetime, timezone
from typing import Any

import pytest

from garmin_sync.cli import _active_garmin_token_object_for_user, _evidence_artifact_path
from garmin_sync.fit_activity import (
    FitActivityDecodeError,
    FitActivityEvidence,
    FitWorkoutStepEvidence,
)
from garmin_sync.training_occurrence_export import (
    FitActivityRef,
    collect_fit_identity_evidence,
    export_training_occurrence_records,
    fit_activity_refs_from_records,
)


class _Snapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class _Query:
    def __init__(
        self,
        docs: dict[str, dict[str, Any]],
        filters: list[tuple[str, str, Any]] | None = None,
        nested: dict[str, dict[str, dict[str, dict[str, Any]]]] | None = None,
    ) -> None:
        self._docs = docs
        self._filters = filters or []
        self._nested = nested or {}

    def where(self, *, filter: Any) -> "_Query":  # noqa: A002 -- mirrors the Firestore API
        return _Query(
            self._docs,
            [*self._filters, (filter.field_path, filter.op_string, filter.value)],
            self._nested,
        )

    def order_by(self, _field: str) -> "_Query":
        return self

    def stream(self) -> list[_Snapshot]:
        ops = {">=": lambda a, b: a >= b, "<": lambda a, b: a < b}
        return [
            _Snapshot(doc_id, data)
            for doc_id, data in sorted(self._docs.items())
            if all(
                field in data and ops[op](data[field], value) for field, op, value in self._filters
            )
        ]

    def document(self, doc_id: str) -> Any:
        docs = self._docs
        nested = self._nested

        class _Ref:
            def get(self) -> _Snapshot:
                return _Snapshot(doc_id, docs.get(doc_id))

            def collection(self, collection_name: str) -> _Query:
                return _Query(nested.get(doc_id, {}).get(collection_name, {}))

        return _Ref()


class _FakeDb:
    def __init__(self, users: dict[str, dict[str, dict[str, dict[str, Any]]]]) -> None:
        self.users = users
        self.touched_users: list[str] = []

    def collection(self, name: str) -> Any:
        assert name == "users"
        db = self

        class _Users:
            def document(self, user_id: str) -> Any:
                db.touched_users.append(user_id)
                collections = db.users.get(user_id, {})

                class _User:
                    def collection(self, collection_name: str) -> _Query:
                        return _Query(
                            collections.get(collection_name, {}),
                            nested=collections.get("_nested", {}).get(collection_name, {}),
                        )

                return _User()

        return _Users()


def _db() -> _FakeDb:
    occurrence = {
        "userId": "u1",
        "status": "active",
        "localDate": "2026-08-06",
        "sourceRefs": [
            {"kind": "structured_execution", "executionId": "e1"},
            {"kind": "provider_activity", "provider": "garmin", "activityId": "edge"},
        ],
        "createdAt": datetime(2026, 8, 6, tzinfo=timezone.utc),
    }
    return _FakeDb(
        {
            "u1": {
                "performedTrainingOccurrences": {
                    "p1": occurrence,
                    "old": {**occurrence, "localDate": "2026-07-01"},
                },
                "session_executions": {
                    "e1": {"userId": "u1", "executionId": "e1", "prescriptionHash": "ph1"},
                    "e2": {"userId": "u1"},
                },
                "_nested": {
                    "session_executions": {
                        "e1": {
                            "entries": {
                                "set-1": {"executionId": "e1", "payload": {"kind": "repetition"}}
                            }
                        }
                    }
                },
                "execution_prescriptions": {
                    "ph1": {
                        "prescriptionHash": "ph1",
                        "displayMetadata": {"title": "Upper Maintenance"},
                    }
                },
                "activities": {
                    "a1": {"activityId": "a1", "date": "2026-08-06"},
                    "edge": {"activityId": "edge", "date": "2026-07-31"},
                },
                "daily_recommendations": {"2026-08-06": {"userId": "u1", "date": "2026-08-06"}},
            },
            "someone-else": {"activities": {"x": {"activityId": "x", "date": "2026-08-06"}}},
        }
    )


def test_record_export_is_bounded_to_one_user_and_window() -> None:
    db = _db()
    records = export_training_occurrence_records(db, "u1", "2026-08-01", "2026-08-08")

    assert set(db.touched_users) == {"u1"}
    assert [doc["id"] for doc in records["performedTrainingOccurrences"]] == ["old", "p1"]
    assert [doc["id"] for doc in records["sessionExecutions"]] == ["e1"]
    assert [doc["id"] for doc in records["sessionEntries"]] == ["set-1"]
    assert [doc["id"] for doc in records["executionPrescriptions"]] == ["ph1"]
    assert sorted(doc["id"] for doc in records["activities"]) == ["a1", "edge"]
    assert (
        records["performedTrainingOccurrences"][1]["data"]["createdAt"]
        == "2026-08-06T00:00:00+00:00"
    )
    assert records["window"] == {"startDate": "2026-08-01", "endDateExclusive": "2026-08-08"}
    assert records["schemaVersion"] == 2
    assert records["evaluationWindow"] == records["window"]
    assert records["sourceEvidenceBounds"]["dailySubjectiveCheckins"] == {
        "startDate": "2026-07-04",
        "endDateExclusive": "2026-08-08",
    }
    assert records["sourceEvidenceBounds"]["performedTrainingOccurrences"] == {
        "startDate": "2026-06-13",
        "endDateExclusive": "2026-08-08",
    }
    assert records["sourceEvidenceBounds"]["fixedActivities"] == {
        "startDate": "2026-08-01",
        "endDateExclusive": "2026-08-15",
    }


def test_export_keeps_lookbacks_and_forward_evidence_out_of_evaluation_denominator() -> None:
    db = _db()
    user = db.users["u1"]
    user["daily_subjective_checkins"] = {
        "before": {"date": "2026-07-03"},
        "first": {"date": "2026-07-04"},
        "today": {"date": "2026-08-01"},
        "outside": {"date": "2026-08-08"},
    }
    user["daily_recovery_snapshots"] = {
        "first": {"date": "2026-08-01"},
        "outside": {"date": "2026-08-08"},
    }
    user["fixed_activities"] = {
        "ahead": {"date": "2026-08-14"},
        "beyond": {"date": "2026-08-15"},
    }
    user["schedule_overlays"] = {
        "overlap": {"startDate": "2026-07-20", "endDate": "2026-08-02"},
        "old": {"startDate": "2026-07-20", "endDate": "2026-07-31"},
        "late": {"startDate": "2026-08-15", "endDate": "2026-08-20"},
    }
    user["plan_blocks"] = {"block": {"startDate": "2026-08-01", "endDate": "2026-08-14"}}
    user["schedule_window_manifests"] = {"next": {"date": "2026-08-14"}}
    user["session_occurrences"] = {"next": {"date": "2026-08-14"}}

    records = export_training_occurrence_records(db, "u1", "2026-08-01", "2026-08-08")

    assert [item["id"] for item in records["dailySubjectiveCheckins"]] == ["first", "today"]
    assert [item["id"] for item in records["dailyRecoverySnapshots"]] == ["first"]
    assert [item["id"] for item in records["fixedActivities"]] == ["ahead"]
    assert [item["id"] for item in records["scheduleOverlays"]] == ["overlap"]
    assert [item["id"] for item in records["planBlocks"]] == ["block"]
    assert [item["id"] for item in records["scheduleWindowManifests"]] == ["next"]
    assert [item["id"] for item in records["sessionOccurrences"]] == ["next"]
    assert records["evaluationWindow"] == {
        "startDate": "2026-08-01",
        "endDateExclusive": "2026-08-08",
    }
    assert records["sourceProvenance"]["scheduleOverlays"]["status"] == "unprovable"
    assert set(db.touched_users) == {"u1"}


def test_d_minus_one_recommendation_revisions_and_raw_singletons_are_read_only() -> None:
    db = _db()
    user = db.users["u1"]
    user["daily_recommendations"]["2026-07-31"] = {
        "date": "2026-07-31",
        "revision": 3,
        "mode": "train",
    }
    user["daily_recommendations"]["2026-08-07"] = {
        "date": "2026-08-07",
        "revision": 2,
        "mode": "recover",
    }
    user["_nested"].setdefault("daily_recommendations", {}).update(
        {
            "2026-07-31": {
                "revisions": {
                    "1": {"revision": 1, "mode": "recover"},
                    "2": {"revision": 2, "mode": "modify"},
                    "3": {"revision": 3, "mode": "train"},
                }
            },
            "2026-08-07": {"revisions": {"1": {"revision": 1, "mode": "modify"}}},
        }
    )
    user["trainingSettings"] = {"profile": {"userId": "u1", "schemaVersion": 3}}
    user["preferences"] = {"profile": {"userId": "u1"}}
    user["training_intent"] = {"profile": {"userId": "u1"}}

    records = export_training_occurrence_records(db, "u1", "2026-08-01", "2026-08-08")

    assert [item["id"] for item in records["dailyRecommendations"]] == [
        "2026-07-31",
        "2026-08-06",
        "2026-08-07",
    ]
    assert {
        (item["recommendationId"], item["id"]) for item in records["dailyRecommendationRevisions"]
    } == {("2026-07-31", "1"), ("2026-07-31", "2"), ("2026-08-07", "1")}
    assert records["trainingSettings"] == [
        {"id": "profile", "data": {"userId": "u1", "schemaVersion": 3}}
    ]
    assert records["sourceProvenance"]["trainingSettings"]["status"] == "unprovable"
    assert set(db.touched_users) == {"u1"}


def test_export_reads_only_exact_referenced_external_plan_revision() -> None:
    db = _db()
    user = db.users["u1"]
    user["session_occurrences"] = {
        "external": {
            "date": "2026-08-06",
            "externalPlanRef": {"planId": "plan-1", "revision": 2, "sessionId": "s1"},
        },
        "unsafe": {
            "date": "2026-08-06",
            "externalPlanRef": {"planId": "other/plan", "revision": 1},
        },
    }
    user["external_plans"] = {"plan-1": {"revision": 3, "userId": "u1"}}
    user["_nested"]["external_plans"] = {
        "plan-1": {
            "revisions": {"1": {"revision": 1}, "2": {"revision": 2}, "3": {"revision": 3}},
            "placement": {"current": {"revision": 2}},
        }
    }

    records = export_training_occurrence_records(db, "u1", "2026-08-01", "2026-08-08")

    assert [row["id"] for row in records["externalPlanHeaders"]] == ["plan-1"]
    assert [(row["planId"], row["id"]) for row in records["externalPlanRevisions"]] == [
        ("plan-1", "2")
    ]
    assert [(row["planId"], row["id"]) for row in records["externalPlanPlacements"]] == [
        ("plan-1", "current")
    ]
    assert records["sourceProvenance"]["externalPlans"]["status"] == "unprovable"


@pytest.mark.parametrize(
    ("user_id", "start", "end"),
    [
        ("", "2026-08-01", "2026-08-08"),
        ("a/b", "2026-08-01", "2026-08-08"),
        ("u1", "2026-08-08", "2026-08-01"),
        ("u1", "2024-01-01", "2026-08-01"),
    ],
)
def test_record_export_rejects_unbounded_or_ambiguous_scope(
    user_id: str, start: str, end: str
) -> None:
    with pytest.raises(ValueError):
        export_training_occurrence_records(_db(), user_id, start, end)


def _evidence(**overrides: Any) -> FitActivityEvidence:
    values: dict[str, Any] = {
        "devices": (),
        "records": (),
        "average_heart_rate_bpm": None,
        "lap_average_heart_rate_bpm": (),
        "time_in_hr_zone_seconds": (),
        "timer_events": (),
    }
    values.update(overrides)
    return FitActivityEvidence(**values)


_STEP = FitWorkoutStepEvidence(
    0, "warm up", "time", 600.0, "heart_rate", 2.0, None, None, "warmup", None
)


class _Downloader:
    def __init__(self, originals: dict[str, bytes | None | Exception]) -> None:
        self.originals = originals
        self.calls: list[str] = []

    def download_activity_original(self, activity_id: str) -> bytes | None:
        self.calls.append(activity_id)
        value = self.originals[activity_id]
        if isinstance(value, Exception):
            raise value
        return value


def _decoder(outputs: dict[bytes, list[FitActivityEvidence | Exception]]) -> Any:
    def decode(original: bytes) -> FitActivityEvidence:
        value = outputs[original].pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    return decode


def test_fit_evidence_counts_each_outcome_separately_and_never_keeps_bytes() -> None:
    semantic = _evidence(workout_name="Tempo", workout_steps=(_STEP,))
    index_only = _evidence(workout_step_indices=(0, 1, 2))
    downloader = _Downloader(
        {
            "sem": b"sem-bytes",
            "idx": b"idx-bytes",
            "none": b"none-bytes",
            "gone": None,
            "bad": b"bad-bytes",
            "err": RuntimeError("transport"),
            "flaky": b"flaky-bytes",
        }
    )
    decode = _decoder(
        {
            b"sem-bytes": [semantic, semantic],
            b"idx-bytes": [index_only, index_only],
            b"none-bytes": [_evidence(), _evidence()],
            b"bad-bytes": [FitActivityDecodeError("crc")],
            b"flaky-bytes": [
                _evidence(workout_step_indices=(0,)),
                _evidence(workout_step_indices=(1,)),
            ],
        }
    )
    refs = [
        FitActivityRef("sem", "2026-08-06", in_matched_structured_occurrence=True),
        FitActivityRef("idx", "2026-08-06"),
        FitActivityRef("none", "2026-08-07"),
        FitActivityRef("gone", "2026-08-07"),
        FitActivityRef("bad", "2026-08-08"),
        FitActivityRef("err", "2026-08-08"),
        FitActivityRef("flaky", "2026-08-09"),
    ]
    result = collect_fit_identity_evidence(downloader, refs, "salt", decode=decode)

    assert result.aggregate["activitiesExamined"] == 7
    assert result.aggregate["originalFitAvailable"] == 5
    assert result.aggregate["originalFitUnavailable"] == 1
    assert result.aggregate["downloadFailure"] == 1
    assert result.aggregate["decodeSuccess"] == 4
    assert result.aggregate["decodeFailure"] == 1
    assert result.aggregate["malformedCount"] == 1
    assert result.aggregate["semanticDefinitionFingerprintCount"] == 1
    assert result.aggregate["observedIndexFallbackFingerprintCount"] == 2
    assert result.aggregate["noWorkoutEvidenceCount"] == 1
    assert result.aggregate["deterministicRepeatDecodeMismatches"] == 1
    assert result.aggregate["canonicalMatchedWithFitFingerprint"] == 1
    assert result.aggregate["discriminationImprovedCount"] == 1
    rendered = repr(result)
    assert "bytes" not in rendered and "sem" not in {row["alias"] for row in result.private_rows}


def test_fit_rate_limit_stops_downloads_and_reports_remaining_as_not_examined() -> None:
    class RateLimited(Exception):
        pass

    downloader = _Downloader({"a": RateLimited(), "b": b"x"})
    result = collect_fit_identity_evidence(
        downloader,
        [FitActivityRef("a", "2026-08-06"), FitActivityRef("b", "2026-08-07")],
        "salt",
        is_rate_limit=lambda error: isinstance(error, RateLimited),
    )
    assert downloader.calls == ["a"]
    assert result.aggregate["notExaminedRateLimited"] == 2
    assert result.aggregate["activitiesExamined"] == 0


def test_repeated_identical_fingerprints_are_counted_not_labelled_collisions() -> None:
    same = _evidence(workout_name="Tempo", workout_steps=(_STEP,))
    downloader = _Downloader({"a": b"a", "b": b"b"})
    decode = _decoder({b"a": [same, same], b"b": [same, same]})
    result = collect_fit_identity_evidence(
        downloader,
        [FitActivityRef("a", "2026-08-06"), FitActivityRef("b", "2026-08-07")],
        "salt",
        decode=decode,
    )
    assert result.aggregate["repeatedFingerprintCount"] == 1
    assert "reviewedCollisionCount" not in result.aggregate


def test_fit_refs_flag_only_active_structured_matches() -> None:
    records = export_training_occurrence_records(_db(), "u1", "2026-08-01", "2026-08-08")
    refs = fit_activity_refs_from_records(records)
    assert refs == [FitActivityRef("a1", "2026-08-06", False)]


class _ConnectionDb:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self.data = data

    def collection(self, name: str) -> Any:
        assert name == "garminConnections"
        data = self.data

        class _Connections:
            def document(self, user_id: str) -> Any:
                class _Ref:
                    def get(self) -> _Snapshot:
                        return _Snapshot(user_id, data)

                return _Ref()

        return _Connections()


def test_explicit_fit_user_uses_exact_active_connection_token_object() -> None:
    db = _ConnectionDb(
        {
            "status": "active",
            "userId": "u1",
            "tokenObject": "garmin/users/u1/garmin_tokens-abc.json",
        }
    )
    assert (
        _active_garmin_token_object_for_user(db, "u1") == "garmin/users/u1/garmin_tokens-abc.json"
    )


@pytest.mark.parametrize(
    "data",
    [
        None,
        {
            "status": "inactive",
            "userId": "u1",
            "tokenObject": "garmin/users/u1/token.json",
        },
        {
            "status": "active",
            "userId": "u2",
            "tokenObject": "garmin/users/u2/token.json",
        },
        {"status": "active", "userId": "u1"},
    ],
)
def test_explicit_fit_user_rejects_unbound_or_mismatched_connection(
    data: dict[str, Any] | None,
) -> None:
    with pytest.raises(ValueError):
        _active_garmin_token_object_for_user(_ConnectionDb(data), "u1")


def test_evidence_outputs_are_anchored_to_the_repository_not_the_working_directory(
    tmp_path: Any, monkeypatch: Any
) -> None:
    from garmin_sync.cli import EVIDENCE_ARTIFACT_DIR

    anchored = os.path.join(EVIDENCE_ARTIFACT_DIR, "raw", "records.json")
    monkeypatch.chdir(tmp_path)
    assert _evidence_artifact_path(anchored) == os.path.realpath(anchored)
    # From any other directory the relative default no longer resolves into the ignored root.
    (tmp_path / "app" / "artifacts" / "training-occurrence").mkdir(parents=True)
    for rejected in (
        "app/artifacts/training-occurrence/raw/records.json",
        "docs/analysis/records.json",
        os.path.join(EVIDENCE_ARTIFACT_DIR, "..", "records.json"),
        EVIDENCE_ARTIFACT_DIR,
    ):
        with pytest.raises(ValueError):
            _evidence_artifact_path(rejected)


def test_export_includes_bounded_immutable_contexts_and_parentless_safety_outcomes() -> None:
    db = _db()
    user = db.users["u1"]
    user["_nested"]["daily_recommendations"] = {
        day: {
            "decision_contexts": {
                revision: {"userId": "u1", "date": day, "recommendationRevision": int(revision)}
            }
        }
        for day, revision in [
            ("2026-07-31", "1"),
            ("2026-08-01", "0"),
            ("2026-08-06", "1"),
            ("2026-08-08", "1"),
        ]
    }
    records = export_training_occurrence_records(db, "u1", "2026-08-01", "2026-08-08")
    assert [(row["recommendationId"], row["id"]) for row in records["decisionContexts"]] == [
        ("2026-08-01", "0"),
        ("2026-08-06", "1"),
    ]
    assert records["sourceProvenance"]["decisionContexts"] == {"status": "exact_revision"}
    assert set(db.touched_users) == {"u1"}
