"""Authenticated HTTP API for server-authoritative anthropometry writes."""

from __future__ import annotations

import json
import logging
import os
import secrets
from collections.abc import Callable
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from typing import Any, ClassVar, Protocol
from urllib.parse import unquote, urlsplit

from firebase_admin import auth as firebase_auth

from .anthropometry import (
    AnthropometryEntryValidationError,
    is_valid_entry_id,
    validate_entry,
)
from .anthropometry_repository import (
    AnthropometryEntryRepository,
    EntryAlreadyExistsError,
    EntryNotFoundError,
    RevisionConflictError,
    StoredEntryIntegrityError,
)
from .base_api import BaseJSONRequestHandler
from .firestore_repository import init_firestore_client

logger = logging.getLogger("anthropometry_api")
MAX_BODY_BYTES = 32 * 1024
ENTRIES_PATH = "/api/anthropometry/entries"


class AuthenticationError(ValueError):
    """The request has no currently valid Firebase app session."""


class EntryRepository(Protocol):
    def create(self, entry: dict[str, Any]) -> dict[str, Any]: ...

    def correct(self, entry: dict[str, Any]) -> dict[str, Any]: ...

    def delete(self, entry_id: str, user_id: str) -> None: ...


def _verified_uid(authorization: str | None) -> str:
    if not authorization:
        raise AuthenticationError()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationError()
    try:
        decoded = firebase_auth.verify_id_token(token.strip(), check_revoked=True)
    except Exception as exc:
        logger.warning(
            "Anthropometry token verification failed (exception=%s).", type(exc).__name__
        )
        raise AuthenticationError() from exc
    uid = decoded.get("uid")
    if not isinstance(uid, str) or not uid:
        raise AuthenticationError()
    return uid


def _timestamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class AnthropometryWriteService:
    """Validates input, derives trusted fields, and delegates atomic persistence."""

    def __init__(
        self,
        repository: EntryRepository,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._repository = repository
        self._now = now

    def _validated_owned_entry(
        self, uid: str, raw: object, entry_id: str | None = None
    ) -> dict[str, Any]:
        entry = validate_entry(raw)
        fields: list[str] = []
        if entry["userId"] != uid:
            fields.append("userId")
        if entry_id is not None and entry["id"] != entry_id:
            fields.append("id")
        if fields:
            raise AnthropometryEntryValidationError(fields)
        return entry

    def create(self, uid: str, raw: object) -> dict[str, Any]:
        entry = self._validated_owned_entry(uid, raw)
        if entry["revision"] != 1:
            raise AnthropometryEntryValidationError(("revision",))
        now = _timestamp(self._now())
        persisted = {**entry, "createdAt": now, "updatedAt": now}
        return self._repository.create(persisted)

    def correct(self, uid: str, raw: object, entry_id: str) -> dict[str, Any]:
        entry = self._validated_owned_entry(uid, raw, entry_id)
        persisted = {**entry, "updatedAt": _timestamp(self._now())}
        return self._repository.correct(persisted)

    def delete(self, uid: str, entry_id: str) -> None:
        if not is_valid_entry_id(entry_id):
            raise AnthropometryEntryValidationError(("id",))
        self._repository.delete(entry_id, uid)


class AnthropometryWriteHandler(BaseJSONRequestHandler):
    """Token-authenticated request adapter. It never logs request bodies or health values."""

    server_version = "AnthropometryWrite/1"
    repository: ClassVar[EntryRepository | None] = None

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("%s - %s %s", self.address_string(), self.command, self.path.split("?", 1)[0])

    def _write_error(
        self,
        status: HTTPStatus,
        *,
        message: str,
        code: str,
        retryable: bool,
        fields: tuple[str, ...] = (),
    ) -> None:
        payload: dict[str, Any] = {
            "error": message,
            "errorCode": code,
            "retryable": retryable,
        }
        if fields:
            payload["fields"] = list(fields)
        if self.request_id:
            payload["requestId"] = self.request_id
        self._json_response(status, payload)

    def _service(self) -> AnthropometryWriteService:
        if self.repository is None:
            raise RuntimeError("Anthropometry write repository is unavailable.")
        return AnthropometryWriteService(self.repository)

    def _request_entry(self) -> object:
        content_type = self.headers.get("Content-Type", "")
        if content_type.split(";", 1)[0].strip().lower() != "application/json":
            raise AnthropometryEntryValidationError(("contentType",))
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length is not None else 0
        except ValueError as exc:
            raise AnthropometryEntryValidationError(("body",)) from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise AnthropometryEntryValidationError(("body",))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AnthropometryEntryValidationError(("body",)) from exc
        if not isinstance(payload, dict) or set(payload) != {"entry"}:
            raise AnthropometryEntryValidationError(("body",))
        return payload["entry"]

    def _entry_id_from_path(self) -> str | None:
        path = urlsplit(self.path).path
        prefix = f"{ENTRIES_PATH}/"
        if not path.startswith(prefix):
            return None
        entry_id = unquote(path.removeprefix(prefix))
        return entry_id if "/" not in entry_id else None

    def _run(self, operation: Callable[[], dict[str, Any] | None]) -> None:
        try:
            result = operation()
        except AuthenticationError:
            self._write_error(
                HTTPStatus.UNAUTHORIZED,
                message="Your app session is invalid or expired. Sign in again.",
                code="anthropometry.auth.invalid_session",
                retryable=False,
            )
        except AnthropometryEntryValidationError as exc:
            self._write_error(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                message="The anthropometry entry does not meet the saved-measurement protocol.",
                code="anthropometry.validation.invalid_entry",
                retryable=False,
                fields=exc.fields,
            )
        except EntryAlreadyExistsError:
            self._write_error(
                HTTPStatus.CONFLICT,
                message="An anthropometry entry with this identifier already exists.",
                code="anthropometry.conflict.already_exists",
                retryable=False,
            )
        except RevisionConflictError:
            self._write_error(
                HTTPStatus.CONFLICT,
                message="This entry changed elsewhere. Refresh it before saving your correction.",
                code="anthropometry.conflict.revision",
                retryable=False,
            )
        except EntryNotFoundError:
            self._write_error(
                HTTPStatus.NOT_FOUND,
                message="This anthropometry entry no longer exists.",
                code="anthropometry.entry.not_found",
                retryable=False,
            )
        except StoredEntryIntegrityError:
            logger.error(
                "Anthropometry stored-entry integrity error (request_id=%s).", self.request_id
            )
            self._write_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                message="This entry cannot be safely corrected. Contact support with the request ID.",
                code="anthropometry.storage.integrity",
                retryable=False,
            )
        except Exception as exc:
            logger.error(
                "Anthropometry write failed (request_id=%s, exception=%s).",
                self.request_id,
                type(exc).__name__,
            )
            self._write_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                message="Could not save the anthropometry entry. Try again later.",
                code="anthropometry.storage.unavailable",
                retryable=True,
            )
        else:
            if result is None:
                self.send_response(HTTPStatus.NO_CONTENT.value)
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                if self.request_id:
                    self.send_header("X-Request-ID", self.request_id)
                self.end_headers()
            else:
                self._json_response(HTTPStatus.OK, {"entry": result})

    def do_POST(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        if urlsplit(self.path).path != ENTRIES_PATH:
            self._write_error(
                HTTPStatus.NOT_FOUND,
                message="Not found.",
                code="anthropometry.not_found",
                retryable=False,
            )
            return
        self._run(
            lambda: self._service().create(
                _verified_uid(self.headers.get("Authorization")), self._request_entry()
            )
        )

    def do_GET(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        if urlsplit(self.path).path == "/health":
            self._json_response(HTTPStatus.OK, {"status": "ok"})
            return
        self._write_error(
            HTTPStatus.NOT_FOUND,
            message="Not found.",
            code="anthropometry.not_found",
            retryable=False,
        )

    def do_PUT(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        entry_id = self._entry_id_from_path()
        if entry_id is None:
            self._write_error(
                HTTPStatus.NOT_FOUND,
                message="Not found.",
                code="anthropometry.not_found",
                retryable=False,
            )
            return
        self._run(
            lambda: self._service().correct(
                _verified_uid(self.headers.get("Authorization")), self._request_entry(), entry_id
            )
        )

    def do_DELETE(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        entry_id = self._entry_id_from_path()
        if entry_id is None:
            self._write_error(
                HTTPStatus.NOT_FOUND,
                message="Not found.",
                code="anthropometry.not_found",
                retryable=False,
            )
            return
        self._run(
            lambda: self._service().delete(
                _verified_uid(self.headers.get("Authorization")), entry_id
            )
        )


def main() -> int:
    port = int(os.getenv("PORT", "8080"))
    AnthropometryWriteHandler.repository = AnthropometryEntryRepository(init_firestore_client())
    server = ThreadingHTTPServer(("0.0.0.0", port), AnthropometryWriteHandler)
    logger.info("Anthropometry write service listening on port %d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
