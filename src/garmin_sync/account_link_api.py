import json
import logging
import math
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from typing import Any

from firebase_admin import auth as firebase_auth
from garminconnect import GarminConnectTooManyRequestsError

from .account_link import (
    UPSTREAM_RETRY_AFTER_SECONDS,
    GarminAccountLinkService,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminLinkConfigurationError,
    GarminLinkConflictError,
)
from .base_api import BaseJSONRequestHandler
from .connection_status import reconcile_garmin_connection_status
from .error_reporting import log_exception
from .login_rate_limit import FirestoreLoginRateLimiter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_account_link")

MAX_BODY_BYTES = 16 * 1024
RATE_LIMIT_WINDOW_SECONDS = 10 * 60
RATE_LIMIT_ATTEMPTS = 5


def _is_upstream_waf_signal(exc: GarminConnectConnectionError) -> bool:
    """Recognize explicit Garmin bot-challenge messages without classifying generic 403s."""
    message = str(exc).lower()
    return any(signal in message for signal in ("cloudflare", "captcha", "bot challenge"))


class LoginRateLimiter:
    """Small in-memory guard for local development and compatibility tests."""

    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int | None]:
        """Record an allowed attempt or return its retry delay atomically."""
        with self._lock:
            # Sample time only after acquiring the lock so pruning, retry delay, and
            # the recorded attempt all use the same current point in the window.
            now = time.monotonic()
            cutoff = now - RATE_LIMIT_WINDOW_SECONDS
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
                remaining = attempts[0] + RATE_LIMIT_WINDOW_SECONDS - now
                retry_after_seconds = max(1, min(RATE_LIMIT_WINDOW_SECONDS, math.ceil(remaining)))
                return False, retry_after_seconds
            attempts.append(now)
            return True, None

    def allow(self, key: str) -> bool:
        """Compatibility wrapper for callers that only need the allow decision."""
        allowed, _ = self.check(key)
        return allowed


RATE_LIMITER: LoginRateLimiter | FirestoreLoginRateLimiter = LoginRateLimiter()
_MFA_ACCOUNT_KEYS: dict[str, tuple[str, float]] = {}
_MFA_ACCOUNT_LOCK = threading.Lock()
_SERVICE: GarminAccountLinkService | None = None
_SERVICE_LOCK = threading.Lock()


def _service() -> GarminAccountLinkService:
    global _SERVICE
    with _SERVICE_LOCK:
        if _SERVICE is None:
            _SERVICE = GarminAccountLinkService(os.getenv("GARMIN_TOKEN_BUCKET", ""))
        return _SERVICE


def _remember_mfa_account(challenge_id: str, account_key: str) -> None:
    """Keep a short-lived in-process association; MFA sessions cannot survive a restart."""
    with _MFA_ACCOUNT_LOCK:
        now = time.monotonic()
        for key, (_, expires_at) in list(_MFA_ACCOUNT_KEYS.items()):
            if expires_at <= now:
                del _MFA_ACCOUNT_KEYS[key]
        _MFA_ACCOUNT_KEYS[challenge_id] = (account_key, now + 300)


def _mfa_account_key(challenge_id: str) -> str | None:
    with _MFA_ACCOUNT_LOCK:
        value = _MFA_ACCOUNT_KEYS.get(challenge_id)
        if value is None:
            return None
        account_key, expires_at = value
        if expires_at <= time.monotonic():
            del _MFA_ACCOUNT_KEYS[challenge_id]
            return None
        return account_key


def _verified_uid(
    authorization: str | None,
    *,
    require_verified_email: bool = True,
) -> str | None:
    """Return the UID from a valid, unrevoked app token.

    Password-provider sessions require verified email ownership by default. Callers may
    opt out only when the operation is safe for an authenticated-but-unverified account;
    Garmin status reconciliation is one such case because it is scoped solely by the UID
    from the validated token and cannot bind external credentials to that UID.
    """
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise GarminConnectAuthenticationError("Invalid app authorization header.")
    try:
        decoded = firebase_auth.verify_id_token(token.strip(), check_revoked=True)
    except Exception as exc:
        raise GarminConnectAuthenticationError("App session is invalid or expired.") from exc
    uid = decoded.get("uid")
    if not uid:
        raise GarminConnectAuthenticationError("App session has no user identity.")
    firebase_claim = decoded.get("firebase")
    sign_in_provider = (
        firebase_claim.get("sign_in_provider") if isinstance(firebase_claim, dict) else None
    )
    if (
        require_verified_email
        and sign_in_provider == "password"
        and decoded.get("email_verified") is not True
    ):
        raise GarminConnectAuthenticationError("Verify your email before linking Garmin.")
    return str(uid)


class GarminAccountLinkHandler(BaseJSONRequestHandler):
    server_version = "GarminAccountLink/1"

    def log_message(self, format: str, *args: Any) -> None:
        # BaseHTTPRequestHandler includes the path but never request bodies. Keep logs
        # intentionally free of Garmin email, password, MFA code, challenge ID and tokens.
        message = format % args
        if hasattr(self, "path") and self.path and "?" in self.path:
            sanitized_path = self.path.split("?", 1)[0]
            message = message.replace(self.path, sanitized_path)
        logger.info("%s - %s", self.address_string(), message)

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
            if self.path == "/api/garmin/status":
                self._handle_status()
                return
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
                **self._mfa_error_metadata(exc),
            )
        except ValueError as exc:
            self._error_response(
                HTTPStatus.BAD_REQUEST,
                message=str(exc),
                error_code="garmin_link.validation",
                retryable=False,
                **self._mfa_error_metadata(exc),
            )
        except GarminConnectTooManyRequestsError as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
                level=logging.WARNING,
            )
            retry_after_seconds = UPSTREAM_RETRY_AFTER_SECONDS
            account_key = getattr(self, "_rate_limit_account_key", None)
            if isinstance(RATE_LIMITER, FirestoreLoginRateLimiter) and account_key:
                try:
                    retry_after_seconds = RATE_LIMITER.record_upstream_rate_limit(account_key)
                except Exception as persist_exc:
                    log_exception(
                        logger,
                        "garmin link rate-limit persistence",
                        persist_exc,
                        context={"request_id": self.request_id},
                    )
            self._error_response(
                HTTPStatus.TOO_MANY_REQUESTS,
                message="Garmin is rate limiting login attempts. Try again later.",
                error_code=report.code,
                retryable=report.retryable,
                retry_after_seconds=retry_after_seconds,
                **self._mfa_error_metadata(exc),
            )
        except GarminConnectAuthenticationError as exc:
            self._error_response(
                HTTPStatus.UNAUTHORIZED,
                message=str(exc),
                error_code="garmin_link.authentication",
                retryable=False,
                **self._mfa_error_metadata(exc),
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
                **self._mfa_error_metadata(exc),
            )
        except GarminConnectConnectionError as exc:
            report = log_exception(
                logger,
                "garmin link",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            account_key = getattr(self, "_rate_limit_account_key", None)
            if (
                _is_upstream_waf_signal(exc)
                and isinstance(RATE_LIMITER, FirestoreLoginRateLimiter)
                and account_key
            ):
                try:
                    retry_after_seconds = RATE_LIMITER.record_upstream_rate_limit(account_key)
                except Exception as persist_exc:
                    log_exception(
                        logger,
                        "garmin link rate-limit persistence",
                        persist_exc,
                        context={"request_id": self.request_id},
                    )
                    retry_after_seconds = UPSTREAM_RETRY_AFTER_SECONDS
                self._error_response(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    message="Garmin is rate limiting login attempts. Try again later.",
                    error_code="garmin_link.rate_limited",
                    retryable=True,
                    retry_after_seconds=retry_after_seconds,
                    **self._mfa_error_metadata(exc),
                )
                return
            self._error_response(
                HTTPStatus.BAD_GATEWAY,
                message="Garmin could not be reached. Try again shortly.",
                error_code=report.code,
                retryable=report.retryable,
                **self._mfa_error_metadata(exc),
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
                **self._mfa_error_metadata(exc),
            )

    def _mfa_error_metadata(self, exc: Exception) -> dict[str, Any]:
        if self.path != "/api/garmin/mfa":
            return {}
        reusable = getattr(exc, "challenge_reusable", None)
        stage = getattr(exc, "auth_stage", None)
        if isinstance(reusable, bool) and stage in {"pre_authentication", "post_authentication"}:
            return {"challenge_reusable": reusable, "auth_stage": stage}
        return {}

    def _handle_status(self) -> None:
        uid = _verified_uid(
            self.headers.get("Authorization"),
            require_verified_email=False,
        )
        if not uid:
            raise GarminConnectAuthenticationError("App authentication is required.")
        result = reconcile_garmin_connection_status(uid)
        self._json_response(HTTPStatus.OK, result)

    def _handle_login(self) -> None:
        self._rate_limit_account_key = None
        limiter = RATE_LIMITER
        if isinstance(limiter, FirestoreLoginRateLimiter):
            provider_allowed, provider_retry = limiter.check_provider()
            if not provider_allowed:
                self._rate_limited_response(provider_retry or 1)
                return

        client_key = self._client_key()
        if not isinstance(limiter, FirestoreLoginRateLimiter):
            allowed, retry_after_seconds = limiter.check(client_key)
            if not allowed:
                self._rate_limited_response(retry_after_seconds or 1)
                return

        payload = self._read_json()
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            raise ValueError("Garmin email and password must be strings.")
        email_key = f"account:{email.strip().lower()}"
        self._rate_limit_account_key = email_key
        requested_uid = _verified_uid(
            self.headers.get("Authorization"),
            require_verified_email=True,
        )

        if isinstance(limiter, FirestoreLoginRateLimiter):
            uid_key = f"uid:{requested_uid}" if requested_uid else None
            allowed, retry_after_seconds = limiter.check_login(client_key, email_key, uid_key)
        else:
            allowed, retry_after_seconds = limiter.check(email_key)
        if not allowed:
            self._rate_limited_response(retry_after_seconds or 1)
            return

        result = _service().start_login(email, password, requested_uid=requested_uid)
        if (
            isinstance(limiter, FirestoreLoginRateLimiter)
            and result.get("status") == "mfa_required"
            and isinstance(result.get("challengeId"), str)
        ):
            _remember_mfa_account(result["challengeId"], email_key)
        self._json_response(HTTPStatus.OK, result)

    def _rate_limited_response(self, retry_after_seconds: int) -> None:
        self._error_response(
            HTTPStatus.TOO_MANY_REQUESTS,
            message="Too many login attempts. Try again later.",
            error_code="garmin_link.rate_limited",
            retryable=True,
            retry_after_seconds=retry_after_seconds,
        )

    def _handle_mfa(self) -> None:
        payload = self._read_json()
        challenge_id = payload.get("challengeId")
        code = payload.get("code")
        if not isinstance(challenge_id, str) or not isinstance(code, str):
            raise ValueError("MFA challenge and code must be strings.")
        if isinstance(RATE_LIMITER, FirestoreLoginRateLimiter):
            account_key = _mfa_account_key(challenge_id)
            self._rate_limit_account_key = account_key
            if account_key is not None:
                allowed, retry_after_seconds = RATE_LIMITER.check(account_key)
                if not allowed:
                    self._rate_limited_response(retry_after_seconds or 1)
                    return
        result = _service().complete_mfa(challenge_id, code)
        with _MFA_ACCOUNT_LOCK:
            _MFA_ACCOUNT_KEYS.pop(challenge_id, None)
        self._json_response(HTTPStatus.OK, result)


def main() -> int:
    global RATE_LIMITER

    port = int(os.getenv("PORT", "8080"))
    store_mode = os.getenv("GARMIN_RATE_LIMIT_STORE", "").strip().lower()
    if store_mode == "firestore":
        RATE_LIMITER = FirestoreLoginRateLimiter(
            os.getenv("GARMIN_RATE_LIMIT_HMAC_KEY", ""),
            window_seconds=RATE_LIMIT_WINDOW_SECONDS,
            max_attempts=RATE_LIMIT_ATTEMPTS,
            upstream_cooldown_seconds=UPSTREAM_RETRY_AFTER_SECONDS,
        )
    elif store_mode or os.getenv("K_SERVICE"):
        raise GarminLinkConfigurationError(
            "Cloud Run account linking requires GARMIN_RATE_LIMIT_STORE=firestore."
        )
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
