from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest

import garmin_sync.anthropometry_api as anthropometry_api
from garmin_sync.anthropometry import AnthropometryEntryValidationError, validate_entry
from garmin_sync.anthropometry_api import (
    AnthropometryWriteHandler,
    AnthropometryWriteService,
    EntryNotFoundError,
    RevisionConflictError,
)

CONFORMANCE = json.loads(
    (Path(__file__).parents[1] / "contracts" / "anthropometry-validation-v1.json").read_text(
        encoding="utf-8"
    )
)


def valid_entry(*, user_id: str = "athlete-1", revision: int = 1) -> dict[str, Any]:
    return {
        "id": "entry-1",
        "userId": user_id,
        "date": "2026-09-14",
        "observedAt": "2026-09-14T06:00:00.000Z",
        "protocol": "home_anthropometry@1",
        "context": {
            "morningPostVoidPreIntake": True,
            "trainingBeforeMeasurement": False,
        },
        "measurements": [
            {
                "metricId": "waist_minimum_cm",
                "unit": "cm",
                "readings": [82.0, 82.4],
                "value": 82.2,
            }
        ],
        "schemaVersion": 1,
        "revision": revision,
        "createdAt": "2026-09-14T06:00:00.000Z",
        "updatedAt": "2026-09-14T06:00:00.000Z",
    }


class FakeRepository:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.corrected: list[dict[str, Any]] = []
        self.deleted: list[str] = []

    def create(self, entry: dict[str, Any]) -> dict[str, Any]:
        self.created.append(entry)
        return entry

    def correct(self, entry: dict[str, Any]) -> dict[str, Any]:
        self.corrected.append(entry)
        return entry

    def delete(self, entry_id: str, user_id: str) -> None:
        self.deleted.append(entry_id)


@pytest.fixture
def write_api(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[ThreadingHTTPServer, FakeRepository]]:
    repository = FakeRepository()
    previous_repository = AnthropometryWriteHandler.repository
    AnthropometryWriteHandler.repository = repository
    monkeypatch.setattr(anthropometry_api, "_verified_uid", lambda _: "athlete-1")
    server = ThreadingHTTPServer(("127.0.0.1", 0), AnthropometryWriteHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, repository
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        AnthropometryWriteHandler.repository = previous_repository


def _request(
    server: ThreadingHTTPServer,
    method: str,
    path: str,
    *,
    payload: object | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    port = int(server.server_address[1])
    connection = HTTPConnection("127.0.0.1", port, timeout=3)
    encoded = json.dumps(payload).encode("utf-8") if payload is not None else None
    request_headers = dict(headers or {})
    if encoded is not None:
        request_headers.setdefault("Content-Type", "application/json")
    connection.request(method, path, body=encoded, headers=request_headers)
    response = connection.getresponse()
    body = response.read()
    connection.close()
    return response.status, json.loads(body) if body else {}


def test_validate_entry_canonicalizes_protocol_metadata_without_exposing_values() -> None:
    result = validate_entry(valid_entry())

    assert result["measurements"] == [
        {
            "metricId": "waist_minimum_cm",
            "unit": "cm",
            "readings": [82.0, 82.4],
            "value": 82.2,
            "repeatabilityWarning": False,
        }
    ]
    assert set(result) == {
        "id",
        "userId",
        "date",
        "observedAt",
        "protocol",
        "context",
        "measurements",
        "schemaVersion",
        "revision",
        "createdAt",
        "updatedAt",
    }


def test_validate_entry_rejects_unknown_nested_fields_without_echoing_biometric_values() -> None:
    entry = valid_entry()
    entry["measurements"][0]["untrusted"] = "secret"
    entry["measurements"][0]["value"] = 82.2

    with pytest.raises(AnthropometryEntryValidationError) as raised:
        validate_entry(entry)

    assert raised.value.fields == ("measurements[0]",)
    assert "82.2" not in str(raised.value)
    assert "secret" not in str(raised.value)


def test_validate_entry_rejects_an_observation_that_resolves_to_another_warsaw_date() -> None:
    entry = valid_entry()
    entry["observedAt"] = "2026-09-13T21:30:00.000Z"

    with pytest.raises(AnthropometryEntryValidationError) as raised:
        validate_entry(entry)

    assert raised.value.fields == ("observedAt",)


@pytest.mark.parametrize("case", CONFORMANCE["cases"], ids=lambda case: str(case["name"]))
def test_server_validation_matches_the_shared_v1_conformance_corpus(case: dict[str, Any]) -> None:
    entry = {**CONFORMANCE["baseEntry"], **case["overrides"]}
    for field in case.get("removals", []):
        entry.pop(field, None)

    if case["expectedValid"]:
        assert validate_entry(entry)
    else:
        with pytest.raises(AnthropometryEntryValidationError):
            validate_entry(entry)


def test_write_service_derives_the_persisted_user_and_timestamps_from_the_server() -> None:
    repository = FakeRepository()
    now = datetime(2026, 9, 15, 8, 30, 45, 123000, tzinfo=timezone.utc)
    service = AnthropometryWriteService(repository, now=lambda: now)
    entry = valid_entry()
    entry["createdAt"] = "2020-01-01T00:00:00.000Z"
    entry["updatedAt"] = "2020-01-01T00:00:00.000Z"

    persisted = service.create("athlete-1", entry)

    assert persisted["userId"] == "athlete-1"
    assert persisted["createdAt"] == "2026-09-15T08:30:45.123Z"
    assert persisted["updatedAt"] == "2026-09-15T08:30:45.123Z"
    assert repository.created == [persisted]


def test_write_service_rejects_a_client_supplied_user_id_mismatch_before_writing() -> None:
    repository = FakeRepository()
    service = AnthropometryWriteService(repository)

    with pytest.raises(AnthropometryEntryValidationError) as raised:
        service.create("athlete-1", valid_entry(user_id="another-athlete"))

    assert raised.value.fields == ("userId",)
    assert repository.created == []


def test_write_service_maps_revision_and_missing_entry_failures_without_values() -> None:
    class ConflictRepository(FakeRepository):
        def correct(self, entry: dict[str, Any]) -> dict[str, Any]:
            raise RevisionConflictError()

        def delete(self, entry_id: str, user_id: str) -> None:
            raise EntryNotFoundError()

    service = AnthropometryWriteService(ConflictRepository())

    with pytest.raises(RevisionConflictError):
        service.correct("athlete-1", valid_entry(revision=2), "entry-1")
    with pytest.raises(EntryNotFoundError):
        service.delete("athlete-1", "entry-1")


def test_verified_uid_requires_a_bearer_token_and_uses_revocation_checks(monkeypatch: Any) -> None:
    calls: list[tuple[str, bool]] = []

    def verify(token: str, *, check_revoked: bool) -> dict[str, str]:
        calls.append((token, check_revoked))
        return {"uid": "athlete-1"}

    monkeypatch.setattr(anthropometry_api.firebase_auth, "verify_id_token", verify)

    assert anthropometry_api._verified_uid("Bearer signed-token") == "athlete-1"  # noqa: SLF001
    assert calls == [("signed-token", True)]
    with pytest.raises(anthropometry_api.AuthenticationError):
        anthropometry_api._verified_uid(None)  # noqa: SLF001


def test_handler_persists_only_a_verified_uid_entry_and_returns_no_cached_response(
    write_api: tuple[ThreadingHTTPServer, FakeRepository],
) -> None:
    server, repository = write_api

    status, payload = _request(
        server,
        "POST",
        "/api/anthropometry/entries",
        payload={"entry": valid_entry()},
        headers={"Authorization": "Bearer test-token"},
    )

    assert status == 200
    assert payload["entry"]["userId"] == "athlete-1"
    assert payload["entry"]["createdAt"].endswith("Z")
    assert payload["entry"]["createdAt"] == payload["entry"]["updatedAt"]
    assert repository.created == [payload["entry"]]


def test_handler_rejects_invalid_protocol_body_without_echoing_measurements(
    write_api: tuple[ThreadingHTTPServer, FakeRepository],
) -> None:
    server, repository = write_api
    entry = valid_entry()
    entry["measurements"][0]["value"] = 999.0

    status, payload = _request(
        server,
        "POST",
        "/api/anthropometry/entries",
        payload={"entry": entry},
        headers={"Authorization": "Bearer test-token"},
    )

    assert status == 422
    assert payload["errorCode"] == "anthropometry.validation.invalid_entry"
    assert payload["fields"] == ["measurements[0].value"]
    assert "999" not in json.dumps(payload)
    assert repository.created == []


def test_handler_exposes_a_credential_free_health_check_and_structured_unknown_route(
    write_api: tuple[ThreadingHTTPServer, FakeRepository],
) -> None:
    server, _ = write_api

    health_status, health_payload = _request(server, "GET", "/health")
    unknown_status, unknown_payload = _request(server, "GET", "/api/anthropometry/entries")

    assert (health_status, health_payload) == (200, {"status": "ok"})
    assert unknown_status == 404
    assert unknown_payload["errorCode"] == "anthropometry.not_found"
