"""Synthetic tests for training_occurrence_backfill (Issue #870).

No live Firestore or Garmin calls.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from garmin_sync.training_occurrence_backfill import (
    apply_training_occurrence_backfill,
    audit_training_occurrence_backfill,
    encode_source_key_for_doc_id,
    new_performed_occurrence_id,
    normalized_garmin_modality,
    plan_training_occurrence_backfill,
    provider_activity_source_key,
)


class _Snapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class _Ref:
    def __init__(self, coll: dict[str, dict[str, Any]], doc_id: str, db: _MockDb) -> None:
        self._coll = coll
        self.id = doc_id
        self._db = db

    def get(self, transaction: Any = None) -> _Snapshot:
        return _Snapshot(self.id, self._coll.get(self.id))


class _Query:
    def __init__(
        self,
        docs: dict[str, dict[str, Any]],
        db: _MockDb,
        filters: list[tuple[str, str, Any]] | None = None,
    ) -> None:
        self._docs = docs
        self._db = db
        self._filters = filters or []

    def where(self, *, filter: Any) -> _Query:  # noqa: A002
        return _Query(
            self._docs,
            self._db,
            [*self._filters, (filter.field_path, filter.op_string, filter.value)],
        )

    def order_by(self, _field: str) -> _Query:
        return self

    def stream(self) -> list[_Snapshot]:
        ops = {
            ">=": lambda a, b: a >= b,
            "<=": lambda a, b: a <= b,
            "==": lambda a, b: a == b,
            "<": lambda a, b: a < b,
            ">": lambda a, b: a > b,
        }
        return [
            _Snapshot(doc_id, data)
            for doc_id, data in sorted(self._docs.items())
            if all(
                field in data and ops[op](data[field], value) for field, op, value in self._filters
            )
        ]

    def document(self, doc_id: str) -> _Ref:
        return _Ref(self._docs, doc_id, self._db)


class _MockTransaction:
    def __init__(self, db: _MockDb) -> None:
        self._db = db
        self.operations: list[str] = []

    def create(self, ref: _Ref, data: dict[str, Any]) -> None:
        if ref.id in ref._coll:
            raise ValueError(f"Document {ref.id} already exists (create-only violation)")
        ref._coll[ref.id] = dict(data)
        self._db.write_count += 1
        self.operations.append(f"create:{ref.id}")


class _MockDb:
    def __init__(
        self, initial_data: dict[str, dict[str, dict[str, dict[str, Any]]]] | None = None
    ) -> None:
        self.users: dict[str, dict[str, dict[str, dict[str, Any]]]] = initial_data or {}
        self.touched_user_ids: list[str] = []
        self.write_count: int = 0

    def collection(self, name: str) -> Any:
        assert name == "users", "Top-level queries other than 'users' are disallowed"
        db = self

        class _Users:
            def document(self, user_id: str) -> Any:
                db.touched_user_ids.append(user_id)
                user_cols = db.users.setdefault(user_id, {})

                class _User:
                    def collection(self, col_name: str) -> _Query:
                        col_docs = user_cols.setdefault(col_name, {})
                        return _Query(col_docs, db)

                return _User()

        return _Users()

    def transaction(self) -> _MockTransaction:
        return _MockTransaction(self)


def test_contract_vectors_parity() -> None:
    """Verify Python primitives against the shared training_occurrence_contract_vectors.json fixture."""
    fixture_path = (
        Path(__file__).resolve().parent / "fixtures" / "training_occurrence_contract_vectors.json"
    )
    with open(fixture_path, encoding="utf-8") as f:
        fixture = json.load(f)

    for vector in fixture["sourceIdentityVectors"]:
        raw_key = vector.get("rawKey")
        if raw_key:
            key = raw_key
        else:
            key = provider_activity_source_key(vector["provider"], vector["activityId"])
        assert key == vector["expectedSourceKey"], f"{vector['description']}: key mismatch"
        doc_id = encode_source_key_for_doc_id(key)
        assert doc_id == vector["expectedDocId"], f"{vector['description']}: doc_id mismatch"

    for mod_vector in fixture["modalityVectors"]:
        act_type = mod_vector["activityType"]
        expected = mod_vector["expectedModality"]
        actual = normalized_garmin_modality(act_type)
        assert actual == expected, f"modality mismatch for {act_type}"


def test_occurrence_id_format() -> None:
    occ_id = new_performed_occurrence_id()
    assert occ_id.startswith("pto-")
    parts = occ_id.split("-")
    assert len(parts) >= 3
    # middle part is epoch ms
    assert int(parts[1]) > 1_700_000_000_000


def test_planning_boundaries_and_window() -> None:
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act_before": {
                        "activityId": "act_before",
                        "date": "2026-06-29",
                        "type": "cycling",
                    },
                    "act_start": {
                        "activityId": "act_start",
                        "date": "2026-06-30",
                        "type": "cycling",
                    },
                    "act_mid": {"activityId": "act_mid", "date": "2026-07-15", "type": "running"},
                    "act_end": {"activityId": "act_end", "date": "2026-09-27", "type": "strength"},
                    "act_after": {
                        "activityId": "act_after",
                        "date": "2026-09-28",
                        "type": "cycling",
                    },
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {},
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-06-30", "2026-09-27")
    assert plan.activities_scanned == 3
    assert [c.activity_id for c in plan.eligible_candidates] == ["act_start", "act_mid", "act_end"]
    assert plan.already_linked_count == 0
    assert len(plan.anomalies) == 0

    # User isolation: only 'user1' was touched
    assert db.touched_user_ids == ["user1"]


def test_user_id_and_date_validation() -> None:
    db = _MockDb()
    with pytest.raises(ValueError, match="Invalid concrete user_id"):
        plan_training_occurrence_backfill(db, "", "2026-06-30", "2026-09-27")
    with pytest.raises(ValueError, match="Invalid concrete user_id"):
        plan_training_occurrence_backfill(db, "user/1", "2026-06-30", "2026-09-27")
    with pytest.raises(ValueError, match="Invalid concrete user_id"):
        plan_training_occurrence_backfill(db, "user..1", "2026-06-30", "2026-09-27")
    with pytest.raises(ValueError, match="must be before or equal to"):
        plan_training_occurrence_backfill(db, "user1", "2026-09-28", "2026-06-30")


def test_dry_run_makes_zero_writes() -> None:
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                    "act2": {"activityId": "act2", "date": "2026-07-02", "type": "running"},
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {},
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-02")
    assert plan.would_create_count == 2
    assert db.write_count == 0


def test_idempotent_apply() -> None:
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {
                        "activityId": "act1",
                        "date": "2026-07-01",
                        "type": "cycling",
                        "startedAt": "2026-07-01T08:00:00Z",
                        "endedAt": "2026-07-01T09:00:00Z",
                    },
                    "act2": {"activityId": "act2", "date": "2026-07-02", "type": "running"},
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {},
            }
        }
    )

    plan1 = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-02")
    assert len(plan1.eligible_candidates) == 2
    res1 = apply_training_occurrence_backfill(db, plan1)
    assert res1.created == 2
    assert res1.concurrently_linked == 0
    assert res1.failed == 0

    # Verify occurrence schema
    user_data = db.users["user1"]
    occ_docs = user_data["performedTrainingOccurrences"]
    assert len(occ_docs) == 2
    act1_key = provider_activity_source_key("garmin", "act1")
    act1_doc_id = encode_source_key_for_doc_id(act1_key)
    link1 = user_data["performedOccurrenceSourceLinks"][act1_doc_id]
    assert link1["sourceKey"] == act1_key
    assert link1["sourceKind"] == "provider_activity"
    assert link1["userId"] == "user1"

    occ1 = occ_docs[link1["performedOccurrenceId"]]
    assert occ1["schemaVersion"] == 1
    assert occ1["userId"] == "user1"
    assert occ1["status"] == "active"
    assert occ1["localDate"] == "2026-07-01"
    assert occ1["startedAt"] == "2026-07-01T08:00:00Z"
    assert occ1["endedAt"] == "2026-07-01T09:00:00Z"
    assert occ1["modality"] == "cycling"
    assert occ1["sourceRefs"] == [
        {"kind": "provider_activity", "provider": "garmin", "activityId": "act1"}
    ]
    assert occ1["reconciliation"] == {"state": "single_source"}

    # Run post-backfill audit
    audit = audit_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-02")
    assert audit.audit_passed
    assert audit.missing_links == 0
    assert audit.invalid_links == 0

    # Second apply: Idempotency proof
    plan2 = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-02")
    assert plan2.activities_scanned == 2
    assert len(plan2.eligible_candidates) == 0
    assert plan2.already_linked_count == 2

    res2 = apply_training_occurrence_backfill(db, plan2)
    assert res2.created == 0
    assert res2.planned_candidates == 0
    assert len(user_data["performedTrainingOccurrences"]) == 2
    assert len(user_data["performedOccurrenceSourceLinks"]) == 2


def test_concurrency_toctou_safety() -> None:
    """If another writer creates the link before transaction commit, migration does not create a duplicate."""
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {},
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-01")
    assert len(plan.eligible_candidates) == 1

    # Before apply, simulate concurrent creation of the link
    source_key = provider_activity_source_key("garmin", "act1")
    doc_id = encode_source_key_for_doc_id(source_key)
    db.users["user1"]["performedOccurrenceSourceLinks"][doc_id] = {
        "schemaVersion": 1,
        "sourceKey": source_key,
        "sourceKind": "provider_activity",
        "userId": "user1",
        "performedOccurrenceId": "pto-concurrent",
    }
    db.users["user1"]["performedTrainingOccurrences"]["pto-concurrent"] = {
        "schemaVersion": 1,
        "performedOccurrenceId": "pto-concurrent",
        "userId": "user1",
        "status": "active",
        "localDate": "2026-07-01",
        "sourceRefs": [{"kind": "provider_activity", "provider": "garmin", "activityId": "act1"}],
        "reconciliation": {"state": "single_source"},
    }

    res = apply_training_occurrence_backfill(db, plan)
    assert res.created == 0
    assert res.concurrently_linked == 1
    # Only 1 occurrence exists (the concurrent one), no duplicate created
    assert len(db.users["user1"]["performedTrainingOccurrences"]) == 1


def test_manual_reconciliation_preservation() -> None:
    """Pre-existing links for manual unlink, keep-separate, or merges are never overwritten."""
    unlink_key = provider_activity_source_key("garmin", "act_unlinked")
    unlink_doc_id = encode_source_key_for_doc_id(unlink_key)

    merge_key = provider_activity_source_key("garmin", "act_merged")
    merge_doc_id = encode_source_key_for_doc_id(merge_key)

    original_unlink_occ = {
        "schemaVersion": 1,
        "performedOccurrenceId": "pto-unlinked-detached",
        "userId": "user1",
        "status": "active",
        "localDate": "2026-08-01",
        "sourceRefs": [
            {"kind": "provider_activity", "provider": "garmin", "activityId": "act_unlinked"}
        ],
        "reconciliation": {
            "state": "single_source",
            "manualDecision": {
                "decision": "unlink",
                "actor": "athlete",
                "decidedAt": "2026-08-01T12:00:00Z",
            },
            "excludedSourceKeys": ["structured_execution:exec-1"],
        },
    }

    original_survivor_occ = {
        "schemaVersion": 1,
        "performedOccurrenceId": "pto-survivor",
        "userId": "user1",
        "status": "active",
        "localDate": "2026-08-02",
        "sourceRefs": [
            {"kind": "structured_execution", "executionId": "exec-2"},
            {"kind": "provider_activity", "provider": "garmin", "activityId": "act_merged"},
        ],
        "reconciliation": {"state": "matched"},
    }

    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act_unlinked": {
                        "activityId": "act_unlinked",
                        "date": "2026-08-01",
                        "type": "strength",
                    },
                    "act_merged": {
                        "activityId": "act_merged",
                        "date": "2026-08-02",
                        "type": "cycling",
                    },
                    "act_new": {"activityId": "act_new", "date": "2026-08-03", "type": "running"},
                },
                "performedOccurrenceSourceLinks": {
                    unlink_doc_id: {
                        "schemaVersion": 1,
                        "sourceKey": unlink_key,
                        "sourceKind": "provider_activity",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-unlinked-detached",
                    },
                    merge_doc_id: {
                        "schemaVersion": 1,
                        "sourceKey": merge_key,
                        "sourceKind": "provider_activity",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-survivor",
                    },
                },
                "performedTrainingOccurrences": {
                    "pto-unlinked-detached": dict(original_unlink_occ),
                    "pto-survivor": dict(original_survivor_occ),
                },
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-08-01", "2026-08-03")
    assert plan.activities_scanned == 3
    assert plan.already_linked_count == 2
    assert [c.activity_id for c in plan.eligible_candidates] == ["act_new"]

    res = apply_training_occurrence_backfill(db, plan)
    assert res.created == 1

    # Verify existing unlinked and merged occurrences remained byte-for-byte intact
    user_data = db.users["user1"]
    assert user_data["performedTrainingOccurrences"]["pto-unlinked-detached"] == original_unlink_occ
    assert user_data["performedTrainingOccurrences"]["pto-survivor"] == original_survivor_occ


def test_broken_invariants_fail_closed() -> None:
    # 1. Occurrence contains Garmin source ref but source link is missing
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {
                    "pto-corrupt": {
                        "schemaVersion": 1,
                        "performedOccurrenceId": "pto-corrupt",
                        "userId": "user1",
                        "status": "active",
                        "localDate": "2026-07-01",
                        "sourceRefs": [
                            {
                                "kind": "provider_activity",
                                "provider": "garmin",
                                "activityId": "act1",
                            }
                        ],
                        "reconciliation": {"state": "single_source"},
                    }
                },
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-01")
    assert any(a.anomaly_type == "source_ref_without_source_link" for a in plan.anomalies)

    # Applying must fail closed
    with pytest.raises(ValueError, match="blocking invariant anomalies"):
        apply_training_occurrence_backfill(db, plan)


def test_partial_run_recovery() -> None:
    """If an error occurs mid-run, rerun completes the remaining records safely."""
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                    "act2": {"activityId": "act2", "date": "2026-07-02", "type": "running"},
                    "act3": {"activityId": "act3", "date": "2026-07-03", "type": "strength"},
                },
                "performedOccurrenceSourceLinks": {},
                "performedTrainingOccurrences": {},
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-03")
    assert len(plan.eligible_candidates) == 3

    # Simulate failure on candidate 2
    original_candidates = list(plan.eligible_candidates)
    plan.eligible_candidates = [original_candidates[0]]
    res1 = apply_training_occurrence_backfill(db, plan)
    assert res1.created == 1

    # Now simulate rerunning the full window
    plan_rerun = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-03")
    assert plan_rerun.activities_scanned == 3
    assert plan_rerun.already_linked_count == 1
    assert [c.activity_id for c in plan_rerun.eligible_candidates] == ["act2", "act3"]

    res2 = apply_training_occurrence_backfill(db, plan_rerun)
    assert res2.created == 2

    audit = audit_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-03")
    assert audit.audit_passed
    assert audit.verified_links == 3


def test_anomaly_classifications() -> None:
    source_key_act1 = provider_activity_source_key("garmin", "act1")
    doc_id_act1 = encode_source_key_for_doc_id(source_key_act1)

    source_key_act2 = provider_activity_source_key("garmin", "act2")
    doc_id_act2 = encode_source_key_for_doc_id(source_key_act2)

    source_key_act3 = provider_activity_source_key("garmin", "act3")
    doc_id_act3 = encode_source_key_for_doc_id(source_key_act3)

    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                    "act2": {"activityId": "act2", "date": "2026-07-02", "type": "running"},
                    "act3": {"activityId": "act3", "date": "2026-07-03", "type": "strength"},
                    "bad_act": {"activityId": "bad_act", "date": "2026-07-04"},  # missing type
                },
                "performedOccurrenceSourceLinks": {
                    # Key mismatch
                    doc_id_act1: {
                        "schemaVersion": 1,
                        "sourceKey": "different_key",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-1",
                    },
                    # Foreign user
                    doc_id_act2: {
                        "schemaVersion": 1,
                        "sourceKey": source_key_act2,
                        "userId": "other_user",
                        "performedOccurrenceId": "pto-2",
                    },
                    # Dangling link (occurrence does not exist)
                    doc_id_act3: {
                        "schemaVersion": 1,
                        "sourceKey": source_key_act3,
                        "userId": "user1",
                        "performedOccurrenceId": "pto-nonexistent",
                    },
                },
                "performedTrainingOccurrences": {
                    "pto-1": {"schemaVersion": 1, "userId": "user1", "status": "active"},
                    "pto-2": {"schemaVersion": 1, "userId": "other_user", "status": "active"},
                },
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-05")
    anomaly_types = {a.anomaly_type for a in plan.anomalies}
    assert "invalid_activity" in anomaly_types
    assert "source_link_identity_mismatch" in anomaly_types
    assert "foreign_user_source_link" in anomaly_types
    assert "dangling_source_link" in anomaly_types


def test_audit_failure_cases() -> None:
    source_key_act1 = provider_activity_source_key("garmin", "act1")
    doc_id_act1 = encode_source_key_for_doc_id(source_key_act1)

    source_key_act2 = provider_activity_source_key("garmin", "act2")
    doc_id_act2 = encode_source_key_for_doc_id(source_key_act2)

    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                    "act2": {"activityId": "act2", "date": "2026-07-02", "type": "running"},
                    "act3": {
                        "activityId": "act3",
                        "date": "2026-07-03",
                        "type": "strength",
                    },  # missing link completely
                },
                "performedOccurrenceSourceLinks": {
                    doc_id_act1: {
                        "schemaVersion": 1,
                        "sourceKey": "wrong_key",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-1",
                    },
                    doc_id_act2: {
                        "schemaVersion": 1,
                        "sourceKey": source_key_act2,
                        "userId": "user1",
                        "performedOccurrenceId": "pto-2",
                    },
                },
                "performedTrainingOccurrences": {
                    "pto-1": {
                        "schemaVersion": 1,
                        "userId": "user1",
                        "status": "active",
                        "sourceRefs": [],
                    },
                    # pto-2 does not have source ref for act2
                    "pto-2": {
                        "schemaVersion": 1,
                        "userId": "user1",
                        "status": "active",
                        "sourceRefs": [
                            {
                                "kind": "provider_activity",
                                "provider": "garmin",
                                "activityId": "other_act",
                            }
                        ],
                    },
                },
            }
        }
    )

    audit = audit_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-03")
    assert not audit.audit_passed
    assert audit.missing_links == 1  # act3
    assert audit.invalid_links >= 2  # act1 and act2


def test_any_preflight_anomaly_blocks_apply_without_partial_writes() -> None:
    """A known corrupt link must block unrelated candidate writes, not fail only post-audit."""
    corrupt_key = provider_activity_source_key("garmin", "act_corrupt")
    corrupt_doc_id = encode_source_key_for_doc_id(corrupt_key)
    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act_corrupt": {
                        "activityId": "act_corrupt",
                        "date": "2026-07-01",
                        "type": "cycling",
                    },
                    "act_new": {
                        "activityId": "act_new",
                        "date": "2026-07-02",
                        "type": "running",
                    },
                },
                "performedOccurrenceSourceLinks": {
                    corrupt_doc_id: {
                        "schemaVersion": 1,
                        "sourceKey": "provider_activity:garmin:different",
                        "sourceKind": "provider_activity",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-existing",
                    }
                },
                "performedTrainingOccurrences": {
                    "pto-existing": {
                        "schemaVersion": 1,
                        "performedOccurrenceId": "pto-existing",
                        "userId": "user1",
                        "status": "active",
                        "localDate": "2026-07-01",
                        "sourceRefs": [
                            {
                                "kind": "provider_activity",
                                "provider": "garmin",
                                "activityId": "act_corrupt",
                            }
                        ],
                        "reconciliation": {"state": "single_source"},
                    }
                },
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-02")
    assert any(a.anomaly_type == "source_link_identity_mismatch" for a in plan.anomalies)
    assert [candidate.activity_id for candidate in plan.eligible_candidates] == ["act_new"]

    with pytest.raises(ValueError, match="blocking invariant anomalies"):
        apply_training_occurrence_backfill(db, plan)

    assert db.write_count == 0
    assert "act_new" not in {
        ref.get("activityId")
        for occurrence in db.users["user1"]["performedTrainingOccurrences"].values()
        for ref in occurrence.get("sourceRefs", [])
        if isinstance(ref, dict)
    }


def test_duplicate_active_source_ownership_is_detected_preflight_and_audit() -> None:
    """The audit must scan canonical occurrences independently of the unique link index."""
    source_key = provider_activity_source_key("garmin", "act1")
    source_doc_id = encode_source_key_for_doc_id(source_key)
    source_ref = {"kind": "provider_activity", "provider": "garmin", "activityId": "act1"}

    db = _MockDb(
        {
            "user1": {
                "activities": {
                    "act1": {"activityId": "act1", "date": "2026-07-01", "type": "cycling"},
                },
                "performedOccurrenceSourceLinks": {
                    source_doc_id: {
                        "schemaVersion": 1,
                        "sourceKey": source_key,
                        "sourceKind": "provider_activity",
                        "userId": "user1",
                        "performedOccurrenceId": "pto-1",
                    }
                },
                "performedTrainingOccurrences": {
                    "pto-1": {
                        "schemaVersion": 1,
                        "performedOccurrenceId": "pto-1",
                        "userId": "user1",
                        "status": "active",
                        "localDate": "2026-07-01",
                        "sourceRefs": [dict(source_ref)],
                        "reconciliation": {"state": "single_source"},
                    },
                    "pto-2": {
                        "schemaVersion": 1,
                        "performedOccurrenceId": "pto-2",
                        "userId": "user1",
                        "status": "active",
                        "localDate": "2026-07-01",
                        "sourceRefs": [dict(source_ref)],
                        "reconciliation": {"state": "single_source"},
                    },
                },
            }
        }
    )

    plan = plan_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-01")
    anomaly_types = {anomaly.anomaly_type for anomaly in plan.anomalies}
    assert "source_link_target_mismatch" in anomaly_types
    assert "duplicate_active_source_ref" in anomaly_types

    with pytest.raises(ValueError, match="blocking invariant anomalies"):
        apply_training_occurrence_backfill(db, plan)
    assert db.write_count == 0

    audit = audit_training_occurrence_backfill(db, "user1", "2026-07-01", "2026-07-01")
    assert not audit.audit_passed
    assert audit.invalid_links >= 2
    assert any("multiple active occurrences" in issue for issue in audit.issues)

