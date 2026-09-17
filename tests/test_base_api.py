from __future__ import annotations

import io
import json
from http import HTTPStatus
from typing import Any

from garmin_sync.base_api import BaseJSONRequestHandler


class DummyJSONRequestHandler(BaseJSONRequestHandler):
    def __init__(
        self, request_id: str | None = None, headers: dict[str, str] | None = None
    ) -> None:
        self.request_id = request_id
        self.headers = headers or {}  # type: ignore[assignment]
        self.wfile = io.BytesIO()
        self.headers_sent: list[tuple[str, str]] = []
        self.status_sent: int | None = None
        self.headers_ended = False

    def send_response(self, code: int, message: str | None = None) -> None:
        self.status_sent = code

    def send_header(self, keyword: str, value: str) -> None:
        self.headers_sent.append((keyword, value))

    def end_headers(self) -> None:
        self.headers_ended = True


def get_header(headers: list[tuple[str, str]], name: str) -> str | None:
    name_lower = name.lower()
    for key, value in headers:
        if key.lower() == name_lower:
            return value
    return None


def test_json_response_without_request_id() -> None:
    handler = DummyJSONRequestHandler()
    payload = {"status": "ok", "items": [1, 2]}

    handler._json_response(HTTPStatus.OK, payload)

    assert handler.status_sent == 200
    headers = dict(handler.headers_sent)
    assert headers["Content-Type"] == "application/json; charset=utf-8"
    assert headers["Cache-Control"] == "no-store"
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "X-Request-ID" not in headers
    body = handler.wfile.getvalue()
    assert headers["Content-Length"] == str(len(body))
    assert handler.headers_ended is True
    assert body == b'{"status":"ok","items":[1,2]}'


def test_json_response_with_request_id() -> None:
    handler = DummyJSONRequestHandler(request_id="req-999")
    payload = {"created": True}

    handler._json_response(HTTPStatus.CREATED, payload)

    assert handler.status_sent == 201
    headers = dict(handler.headers_sent)
    assert headers["X-Request-ID"] == "req-999"
    body = handler.wfile.getvalue()
    assert headers["Content-Length"] == str(len(body))
    assert json.loads(body.decode("utf-8")) == payload


def test_json_response_unicode_encoding_and_content_length() -> None:
    handler = DummyJSONRequestHandler()
    payload = {"message": "Zażółć gęślą jaźń"}

    handler._json_response(HTTPStatus.OK, payload)

    body = handler.wfile.getvalue()
    headers = dict(handler.headers_sent)
    assert len(body) > len(payload["message"])
    assert headers["Content-Length"] == str(len(body))
    assert json.loads(body.decode("utf-8")) == payload


def test_error_response_sanitizes_payload_without_request_id() -> None:
    handler = DummyJSONRequestHandler()

    handler._error_response(
        HTTPStatus.BAD_REQUEST,
        message="Invalid email athlete@example.com provided",
        error_code="invalid_request",
        retryable=False,
    )

    assert handler.status_sent == 400
    headers = dict(handler.headers_sent)
    assert "X-Request-ID" not in headers
    body = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert body == {
        "error": "Invalid email <email-redacted> provided",
        "errorCode": "invalid_request",
        "retryable": False,
    }


def test_error_response_with_request_id() -> None:
    handler = DummyJSONRequestHandler(request_id="req-1234")

    handler._error_response(
        HTTPStatus.SERVICE_UNAVAILABLE,
        message="Upstream access_token=secret123 timeout",
        error_code="upstream_timeout",
        retryable=True,
    )

    assert handler.status_sent == 503
    headers = dict(handler.headers_sent)
    assert headers["X-Request-ID"] == "req-1234"
    body = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert body["error"] == "Upstream access_token=<redacted> timeout"
    assert body["errorCode"] == "upstream_timeout"
    assert body["retryable"] is True
    assert body["requestId"] == "req-1234"


def test_no_cors_headers_when_origin_header_missing(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyJSONRequestHandler(headers={})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})

    assert handler.status_sent == HTTPStatus.OK.value
    assert get_header(handler.headers_sent, "Access-Control-Allow-Origin") is None


def test_cors_headers_added_for_allowed_origin(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com, https://admin.example.com")
    handler = DummyJSONRequestHandler(headers={"Origin": "https://app.example.com"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})

    assert (
        get_header(handler.headers_sent, "Access-Control-Allow-Origin") == "https://app.example.com"
    )
    assert get_header(handler.headers_sent, "Vary") == "Origin"
    assert "GET, POST, OPTIONS" in (
        get_header(handler.headers_sent, "Access-Control-Allow-Methods") or ""
    )
    assert "Content-Type" in (
        get_header(handler.headers_sent, "Access-Control-Allow-Headers") or ""
    )


def test_cors_allowed_origins_from_app_base_url(monkeypatch: Any) -> None:
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("APP_BASE_URL", "https://my-app.web.app/settings")
    handler = DummyJSONRequestHandler(headers={"Origin": "https://my-app.web.app"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})

    assert (
        get_header(handler.headers_sent, "Access-Control-Allow-Origin") == "https://my-app.web.app"
    )


def test_cors_rejected_for_unallowed_origin(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyJSONRequestHandler(headers={"Origin": "https://evil.com"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})

    assert get_header(handler.headers_sent, "Access-Control-Allow-Origin") is None


def test_do_options_returns_no_content_with_cors_headers(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyJSONRequestHandler(headers={"Origin": "https://app.example.com"})
    handler.do_OPTIONS()

    assert handler.status_sent == HTTPStatus.NO_CONTENT.value
    assert get_header(handler.headers_sent, "Content-Length") == "0"
    assert (
        get_header(handler.headers_sent, "Access-Control-Allow-Origin") == "https://app.example.com"
    )


def test_error_response_includes_cors_headers(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyJSONRequestHandler(headers={"Origin": "https://app.example.com"})
    handler._error_response(
        HTTPStatus.BAD_REQUEST,
        message="Bad input",
        error_code="bad_input",
        retryable=False,
    )

    assert handler.status_sent == HTTPStatus.BAD_REQUEST.value
    assert (
        get_header(handler.headers_sent, "Access-Control-Allow-Origin") == "https://app.example.com"
    )
