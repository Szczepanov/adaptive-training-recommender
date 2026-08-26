import json
import logging
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from firebase_admin import auth as firebase_auth

from .account_link import (
    GarminAccountLinkService,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
    GarminLinkConfigurationError,
    GarminLinkConflictError,
)
from .error_reporting import log_exception, sanitize_text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_account_link")

MAX_BODY_BYTES = 16 * 1024
RATE_LIMIT_WINDOW_SECONDS = 10 * 60
RATE_LIMIT_ATTEMPTS = 5


class LoginRateLimiter:
    """Small in-memory guard against accidental credential brute forcing.

    The production service is intentionally capped at one Cloud Run instance, so this
    process-local limiter covers the private/family deployment without introducing a
    datastore containing login-attempt metadata.
    """

    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - RATE_LIMIT_WINDOW_SECONDS
        with self._lock:
            # Prune every expired bucket before looking up the current key. Apart from
            # bounding long-lived memory, this avoids keeping one deque forever for each
            # client address that has ever touched the login endpoint.
            for candidate_key, candidate_attempts in list(self._attempts.items()):
                while candidate_attempts and candidate_attempts[0] < cutoff:
                    candidate_attempts.popleft()
                if not candidate_attempts:
                    del self._attempts[candidate_key]

            attempts = self._attempts[key]
            if len(attempts) >= RATE_LIMIT_ATTEMPTS:
                return False
            attempts.append(now)
            return True


RATE_LIMITER = LoginRateLimiter()
_SERVICE: GarminAccountLinkService | None = None
_SERVICE_LOCK = threading.Lock()


def _service() -> GarminAccountLinkService:
    global _SERVICE
    with _SERVICE_LOCK:
        if _SERVICE is None:
            _SERVICE = GarminAccountLinkService(os.getenv("GARMIN_TOKEN_BUCKET", ""))
        return _SERVICE


def _verified_uid(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise GarminConnectAuthenticationError("Invalid app authorization header.")
    try:
        decoded = firebase_auth.verify_id_token(token.strip())
    except Exception as exc:
        raise GarminConnectAuthenticationError("App session is invalid or expired.") from exc
    uid = decoded.get("uid")
    if not uid:
        raise GarminConnectAuthenticationError("App session has no user identity.")
    return str(uid)


class GarminAccountLinkHandler(BaseHTTPRequestHandler):
    server_version = "GarminAccountLink/1"
    request_id: str | None = None

    def log_message(self, format: str, *args: Any) -> None:
        # BaseHTTPRequestHandler includes the path but never request bodies. Keep logs
        # intentionally free of Garmin email, password, MFA code, challenge ID and tokens.
        logger.info("%s - %s", self.address_string(), format % args)

    def _json_response(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.request_id:
            self.send_header("X-Request-ID", self.request_id)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error_response(
        self,
        status: HTTPStatus,
        *,
        message: str,
        error_code: str,
        retryable: bool,
    ) -> None:
        payload: dict[str, Any] = {
            "error": sanitize_text(message),
            "errorCode": error_code,
            "retryable": retryable,
        }
        if self.request_id:
            payload["requestId"] = self.request_id
        self._json_response(status, payload)

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length.") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body is empty or too large.")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("Request body must be valid JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _client_key(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            forwarded_hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if len(forwarded_hops) >= 2:
                # Google external HTTP(S) load balancing appends a trusted pair:
                #   ..., <client-ip>, <load-balancer-ip>
                # Existing left-hand values are caller-controlled, while the final value
                # identifies the load balancer itself. The penultimate hop is therefore
                # the client address observed by Google's trusted edge.
                return forwarded_hops[-2]
            if forwarded_hops:
                return forwarded_hops[-1]
        return self.client_address[0]

    def do_GET(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        if self.path == "/health":
            self._json_response(HTTPStatus.OK, {"status": "ok"})
            return
        self._error_response(
            HTTPStatus.NOT_FOUND,
            message="Not found.",
            error_code="garmin_link.not_found",
            retryable=False,
        )

    def do_POST(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        try:
            if self.path == "/api/garmin/login":
                self._handle_login()
                return
            if self.path == "/api/garmin/mfa":
                self._handle_mfa()
                return
            self._error_response(
                HTTPStatus.NOT_FOUND,
                message="Not found.",
                error_code="garmin_link.not_found",
                retryable=False,
            )
        except GarminLinkConflictError as exc:
            self._error_response(
                HTTPStatus.CONFLICT,
                message=str(exc),
                error_code="garmin_link.conflict",
                retryable=False,
            )
        except ValueError as exc:
            self._error_response(
                HTTPStatus.BAD_REQUEST,
                message=str(exc),
                error_code="garmin_link.validation",
                retryable=False,
            )
        except GarminConnectTooManyRequestsError as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
                level=logging.WARNING,
            )
            self._error_response(
                HTTPStatus.TOO_MANY_REQUESTS,
                message="Garmin is rate limiting login attempts. Try again later.",
                error_code=report.code,
                retryable=report.retryable,
            )
        except GarminConnectAuthenticationError as exc:
            self._error_response(
                HTTPStatus.UNAUTHORIZED,
                message=str(exc),
                error_code="garmin_link.authentication",
                retryable=False,
            )
        except GarminLinkConfigurationError as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            self._error_response(
                HTTPStatus.SERVICE_UNAVAILABLE,
                message="Garmin linking is temporarily unavailable.",
                error_code=report.code,
                retryable=report.retryable,
            )
        except GarminConnectConnectionError as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            self._error_response(
                HTTPStatus.BAD_GATEWAY,
                message="Garmin could not be reached. Try again shortly.",
                error_code=report.code,
                retryable=report.retryable,
            )
        except Exception as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            self._error_response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                message="Garmin linking failed unexpectedly.",
                error_code=report.code,
                retryable=report.retryable,
            )

    def _handle_login(self) -> None:
        client_key = self._client_key()
        if not RATE_LIMITER.allow(client_key):
            self._error_response(
                HTTPStatus.TOO_MANY_REQUESTS,
                message="Too many login attempts. Try again later.",
                error_code="garmin_link.rate_limited",
                retryable=True,
            )
            return
        payload = self._read_json()
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            raise ValueError("Garmin email and password must be strings.")
        email_key = f"account:{email.strip().lower()}"
        if not RATE_LIMITER.allow(email_key):
            self._error_response(
                HTTPStatus.TOO_MANY_REQUESTS,
                message="Too many login attempts. Try again later.",
                error_code="garmin_link.rate_limited",
                retryable=True,
            )
            return
        requested_uid = _verified_uid(self.headers.get("Authorization"))
        result = _service().start_login(email, password, requested_uid=requested_uid)
        self._json_response(HTTPStatus.OK, result)

    def _handle_mfa(self) -> None:
        payload = self._read_json()
        challenge_id = payload.get("challengeId")
        code = payload.get("code")
        if not isinstance(challenge_id, str) or not isinstance(code, str):
            raise ValueError("MFA challenge and code must be strings.")
        result = _service().complete_mfa(challenge_id, code)
        self._json_response(HTTPStatus.OK, result)


def main() -> int:
    port = int(os.getenv("PORT", "8080"))
    # Fail at startup rather than accepting credentials and discovering after Garmin login
    # that there is nowhere safe to persist the refresh token.
    _service()
    server = ThreadingHTTPServer(("0.0.0.0", port), GarminAccountLinkHandler)
    logger.info("Garmin account-link service listening on port %d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
