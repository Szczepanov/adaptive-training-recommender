import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any

from .error_reporting import sanitize_text


class BaseJSONRequestHandler(BaseHTTPRequestHandler):
    """Base class for HTTP handlers that respond with JSON.

    Provides shared `_json_response` and `_error_response` utilities.
    """

    request_id: str | None = None

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
