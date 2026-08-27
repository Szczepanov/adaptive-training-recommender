"""HTTP service for in-app Google Health account linking (OAuth authorization-code flow).

Deliberately a *separate* Cloud Run service from garmin-account-link: Garmin's linker is
pinned to --max-instances=1 for its in-memory MFA session continuity, a constraint this
OAuth-redirect flow doesn't need and shouldn't inherit. See
docs/plans/2026-08-27-real-google-health-ingestion.md for why CASA/Restricted Scope
verification being unresolved means every linked user will see Google's "unverified app"
warning -- that's a known, accepted limitation of this phase, not a bug in this service.
"""

import json
import logging
import os
import secrets
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from firebase_admin import auth as firebase_auth

from .error_reporting import log_exception, sanitize_text
from .google_health_account_link import (
    GoogleHealthConnectionRepository,
    GoogleHealthLinkError,
    GoogleHealthLinkStateInvalidError,
    GoogleHealthLinkStateStore,
    GoogleHealthTokenExchangeError,
    build_authorize_url,
    exchange_code_for_tokens,
    persist_tokens,
)
from .google_health_auth import (
    DEFAULT_GOOGLE_HEALTH_SCOPES,
    GoogleHealthAuthManager,
    GoogleHealthTokenCredentials,
)
from .google_health_client import GoogleHealthClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("google_health_account_link")


def _verified_uid(authorization: str | None) -> str:
    """Verify the Firebase ID token on the (authenticated) start-link request.

    Unlike Garmin's optional _verified_uid (new-user signup has no prior session), Google
    Health always links to an existing app account, so this raises rather than returning
    None when there's no valid session.
    """
    if not authorization:
        raise GoogleHealthLinkError("Missing app session.")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise GoogleHealthLinkError("Invalid app authorization header.")
    try:
        decoded = firebase_auth.verify_id_token(token.strip())
    except Exception as exc:
        raise GoogleHealthLinkError("App session is invalid or expired.") from exc
    uid = decoded.get("uid")
    if not uid:
        raise GoogleHealthLinkError("App session has no user identity.")
    return str(uid)


def _env(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        raise GoogleHealthLinkError(f"Server misconfiguration: {name} is not set.")
    return value


class GoogleHealthAccountLinkHandler(BaseHTTPRequestHandler):
    server_version = "GoogleHealthAccountLink/1"
    request_id: str | None = None

    def log_message(self, format: str, *args: Any) -> None:
        # Never log query strings here -- the callback URL carries `code`/`state`, both of
        # which are effectively bearer credentials for this flow.
        logger.info("%s - %s %s", self.address_string(), self.command, self.path.split("?")[0])

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
        self, status: HTTPStatus, *, message: str, error_code: str, retryable: bool
    ) -> None:
        payload: dict[str, Any] = {
            "error": sanitize_text(message),
            "errorCode": error_code,
            "retryable": retryable,
        }
        if self.request_id:
            payload["requestId"] = self.request_id
        self._json_response(status, payload)

    def _redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND.value)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _app_redirect(self, *, success: bool, reason: str | None = None) -> None:
        base = os.getenv("APP_BASE_URL", "").rstrip("/")
        params = {"googleHealthLinked": "success" if success else "error"}
        if reason:
            params["reason"] = reason
        query = urllib.parse.urlencode(params)
        self._redirect(f"{base}/settings?{query}" if base else f"/settings?{query}")

    def do_GET(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._json_response(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/api/google-health/callback":
            self._handle_callback()
            return
        self._error_response(
            HTTPStatus.NOT_FOUND,
            message="Not found.",
            error_code="google_health_link.not_found",
            retryable=False,
        )

    def do_POST(self) -> None:  # noqa: N802
        self.request_id = secrets.token_hex(8)
        try:
            if self.path == "/api/google-health/start-link":
                self._handle_start_link()
                return
            self._error_response(
                HTTPStatus.NOT_FOUND,
                message="Not found.",
                error_code="google_health_link.not_found",
                retryable=False,
            )
        except GoogleHealthLinkError as exc:
            report = log_exception(
                logger,
                "google health link start",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            self._error_response(
                HTTPStatus.BAD_REQUEST,
                message=str(exc),
                error_code=report.code,
                retryable=report.retryable,
            )
        except Exception as exc:
            report = log_exception(
                logger,
                "google health link start",
                exc,
                context={"path": self.path, "request_id": self.request_id},
            )
            self._error_response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                message="Google Health linking failed unexpectedly.",
                error_code=report.code,
                retryable=report.retryable,
            )

    def _handle_start_link(self) -> None:
        uid = _verified_uid(self.headers.get("Authorization"))
        client_id = _env("GOOGLE_HEALTH_CLIENT_ID")
        redirect_uri = _env("GOOGLE_HEALTH_REDIRECT_URI")

        state = GoogleHealthLinkStateStore().create(uid)
        authorize_url = build_authorize_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            scopes=DEFAULT_GOOGLE_HEALTH_SCOPES,
            state=state,
        )
        self._json_response(HTTPStatus.OK, {"authorizeUrl": authorize_url})

    def _handle_callback(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)

        def _first(key: str) -> str | None:
            values = query.get(key)
            return values[0] if values else None

        code = _first("code")
        state = _first("state")
        google_error = _first("error")

        try:
            if google_error:
                # The user declined consent, or Google itself errored -- not a bug here.
                logger.info("Google Health OAuth callback carried an error: %s", google_error)
                self._app_redirect(success=False, reason="google_declined")
                return
            if not code or not state:
                self._app_redirect(success=False, reason="missing_code_or_state")
                return

            uid = GoogleHealthLinkStateStore().consume(state)

            client_id = _env("GOOGLE_HEALTH_CLIENT_ID")
            client_secret = _env("GOOGLE_HEALTH_CLIENT_SECRET")
            redirect_uri = _env("GOOGLE_HEALTH_REDIRECT_URI")
            bucket_name = _env("GOOGLE_HEALTH_TOKEN_BUCKET")

            tokens = exchange_code_for_tokens(
                code=code,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
            )
            token_object = persist_tokens(bucket_name=bucket_name, uid=uid, tokens=tokens)

            health_user_id: str | None = None
            try:
                probe_manager = GoogleHealthAuthManager(
                    client_id=client_id,
                    client_secret=client_secret,
                    credentials=GoogleHealthTokenCredentials(
                        access_token=tokens.access_token,
                        refresh_token=tokens.refresh_token,
                        expires_at=0.0,
                    ),
                )
                identity = GoogleHealthClient(auth_manager=probe_manager).get_identity()
                health_user_id = identity.get("healthUserId")
            except Exception as identity_exc:
                # Non-fatal: the link itself already succeeded (tokens are persisted).
                # healthUserId is only used to map a future webhook notification back to
                # this account -- worth logging, not worth failing the whole link over.
                logger.warning("Could not resolve Google Health identity: %s", identity_exc)

            GoogleHealthConnectionRepository().save_connection(
                uid,
                health_user_id=health_user_id,
                granted_scopes=tokens.scopes,
                token_object=token_object,
            )
            self._app_redirect(success=True)

        except GoogleHealthLinkStateInvalidError as exc:
            logger.info("Google Health link callback rejected: %s", exc)
            self._app_redirect(success=False, reason="invalid_state")
        except GoogleHealthTokenExchangeError as exc:
            log_exception(
                logger,
                "google health token exchange",
                exc,
                context={"request_id": self.request_id},
            )
            self._app_redirect(success=False, reason="token_exchange_failed")
        except Exception as exc:
            log_exception(
                logger,
                "google health link callback",
                exc,
                context={"request_id": self.request_id},
            )
            self._app_redirect(success=False, reason="unexpected_error")


def main() -> int:
    port = int(os.getenv("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), GoogleHealthAccountLinkHandler)
    logger.info("Google Health account-link service listening on port %d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
