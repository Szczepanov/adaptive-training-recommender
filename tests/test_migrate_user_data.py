from __future__ import annotations

from typing import Any

import pytest

from garmin_sync.migrate_user_data import MigrationError, UserDataMigrator, _rewrite_uid


def test_rewrite_uid_rehomes_exact_ids_and_user_paths_only() -> None:
    source = "legacy-uid"
    target = "garmin-uid"
    payload = {
        "userId": source,
        "nested": {
            "owner": source,
            "path": f"users/{source}/daily_recovery_snapshots/2026-08-23",
            "note": f"athlete={source}-suffix",
        },
        "list": [source, "unchanged"],
    }

    rewritten = _rewrite_uid(payload, source, target)

    assert rewritten["userId"] == target
    assert rewritten["nested"]["owner"] == target
    assert rewritten["nested"]["path"] == (f"users/{target}/daily_recovery_snapshots/2026-08-23")
    assert rewritten["nested"]["note"] == f"athlete={source}-suffix"
    assert rewritten["list"] == [target, "unchanged"]


def test_user_authored_merge_prefers_legacy_source_fields() -> None:
    payload = UserDataMigrator._merged_payload(  # noqa: SLF001 - migration contract
        {"userId": "old", "preference": "legacy", "legacyOnly": 1},
        {"userId": "new", "preference": "new-default", "targetOnly": 2},
        "old",
        "new",
        target_wins=False,
    )

    assert payload == {
        "userId": "new",
        "preference": "legacy",
        "legacyOnly": 1,
        "targetOnly": 2,
    }


def test_garmin_owned_merge_preserves_existing_target_fields() -> None:
    payload = UserDataMigrator._merged_payload(  # noqa: SLF001 - migration contract
        {"userId": "old", "restingHr": 50, "legacyOnly": 1},
        {"userId": "new", "restingHr": 47, "targetOnly": 2},
        "old",
        "new",
        target_wins=True,
    )

    assert payload == {
        "userId": "new",
        "restingHr": 47,
        "legacyOnly": 1,
        "targetOnly": 2,
    }


class _Snapshot:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self.exists = data is not None
        self._data = data

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class _Doc:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self._data = data

    def get(self) -> _Snapshot:
        return _Snapshot(self._data)


class _Collection:
    def __init__(self, documents: dict[str, dict[str, Any] | None]) -> None:
        self._documents = documents

    def document(self, doc_id: str) -> _Doc:
        return _Doc(self._documents.get(doc_id))


class _Db:
    def __init__(self, connections: dict[str, dict[str, Any] | None]) -> None:
        self.connections = connections

    def collection(self, name: str) -> _Collection:
        if name != "garminConnections":
            raise AssertionError(f"unexpected collection {name}")
        return _Collection(self.connections)


class _Connections:
    def __init__(self, active: list[str]) -> None:
        self.active = active

    def list_active_connections(self) -> list[tuple[str, None]]:
        return [(uid, None) for uid in self.active]


def _migrator(connections: dict[str, dict[str, Any] | None], active: list[str]) -> UserDataMigrator:
    migrator = object.__new__(UserDataMigrator)
    migrator.db = _Db(connections)
    migrator.connection_repository = _Connections(active)
    return migrator


def test_target_auto_resolution_selects_only_active_garmin_account_other_than_source() -> None:
    migrator = _migrator(
        {
            "old": None,
            "garmin": {"status": "active"},
        },
        ["garmin"],
    )

    assert migrator.resolve_target_uid("old", None) == "garmin"


def test_target_auto_resolution_refuses_to_guess_between_multiple_active_accounts() -> None:
    migrator = _migrator(
        {
            "old": None,
            "garmin-a": {"status": "active"},
            "garmin-b": {"status": "active"},
        },
        ["garmin-a", "garmin-b"],
    )

    with pytest.raises(MigrationError, match="More than one active"):
        migrator.resolve_target_uid("old", None)


def test_migration_refuses_when_source_is_still_an_active_garmin_owner() -> None:
    migrator = _migrator(
        {
            "old": {"status": "active"},
            "garmin": {"status": "active"},
        },
        ["old", "garmin"],
    )

    with pytest.raises(MigrationError, match="legacy Firebase user is still actively linked"):
        migrator.resolve_target_uid("old", "garmin")
