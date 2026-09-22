import json
import os
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any

from .error_reporting import sanitize_text


def _allowed_cors_origins() -> set[str]:
    origins: set[str] = set()
    raw_allowed = os.getenv("CORS_ALLOWED_ORIGINS", "")
    if raw_allowed:
        for origin in raw_allowed.split(","):
            cleaned = origin.strip().rstrip("/")
            if cleaned:
                origins.add(cleaned)

    app_base_url = os.getenv("APP_BASE_URL", "").strip()
    if app_base_url:
        parsed = urllib.parse.urlsplit(app_base_url)
        if parsed.scheme and parsed.netloc:
            origins.add(f"{parsed.scheme}://{parsed.netloc}")

    return origins


class BaseJSONRequestHandler(BaseHTTPRequestHandler):
    """Base class for HTTP handlers that respond with JSON.

    Provides shared `_json_response` and `_error_response` utilities.
    """

    request_id: str | None = None

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if not origin:
            return

        allowed = _allowed_cors_origins()
        cleaned_origin = origin.strip().rstrip("/")
        if cleaned_origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin.strip())
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "Retry-After, X-Request-ID")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-Request-ID",
            )
            self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT.value)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json_response(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        *,
        retry_after_seconds: int | None = None,
    ) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.request_id:
            self.send_header("X-Request-ID", self.request_id)
        if retry_after_seconds is not None:
            self.send_header("Retry-After", str(retry_after_seconds))
        self._send_cors_headers()
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
        retry_after_seconds: int | None = None,
        challenge_reusable: bool | None = None,
        auth_stage: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "error": sanitize_text(message),
            "errorCode": error_code,
            "retryable": retryable,
        }
        if self.request_id:
            payload["requestId"] = self.request_id
        if challenge_reusable is not None:
            payload["challengeReusable"] = challenge_reusable
        if auth_stage is not None:
            payload["authStage"] = auth_stage
        if retry_after_seconds is not None:
            payload["retryAfterSeconds"] = retry_after_seconds
            self._json_response(status, payload, retry_after_seconds=retry_after_seconds)
        else:
            self._json_response(status, payload)
