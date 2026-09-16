from __future__ import annotations

import io
import json
from http import HTTPStatus

from garmin_sync.base_api import BaseJSONRequestHandler


class DummyJSONRequestHandler(BaseJSONRequestHandler):
    def __init__(self, request_id: str | None = None) -> None:
        self.request_id = request_id
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


def test_json_response_without_request_id() -> None:
    handler = DummyJSONRequestHandler()
    payload = {"status": "ok", "items": [1, 2]}

    handler._json_response(HTTPStatus.OK, payload)

    assert handler.status_sent == 200
    headers_dict = dict(handler.headers_sent)
    assert headers_dict["Content-Type"] == "application/json; charset=utf-8"
    assert headers_dict["Cache-Control"] == "no-store"
    assert headers_dict["X-Content-Type-Options"] == "nosniff"
    assert "X-Request-ID" not in headers_dict

    body = handler.wfile.getvalue()
    assert headers_dict["Content-Length"] == str(len(body))
    assert handler.headers_ended is True
    assert body == b'{"status":"ok","items":[1,2]}'


def test_json_response_with_request_id() -> None:
    handler = DummyJSONRequestHandler(request_id="req-999")
    payload = {"created": True}

    handler._json_response(HTTPStatus.CREATED, payload)

    assert handler.status_sent == 201
    headers_dict = dict(handler.headers_sent)
    assert headers_dict["X-Request-ID"] == "req-999"
    body = handler.wfile.getvalue()
    assert headers_dict["Content-Length"] == str(len(body))
    assert json.loads(body.decode("utf-8")) == payload


def test_json_response_unicode_encoding_and_content_length() -> None:
    handler = DummyJSONRequestHandler()
    payload = {"message": "Zażółć gęślą jaźń"}

    handler._json_response(HTTPStatus.OK, payload)

    body = handler.wfile.getvalue()
    headers_dict = dict(handler.headers_sent)
    assert len(body) > len(payload["message"])  # UTF-8 byte count exceeds char count
    assert headers_dict["Content-Length"] == str(len(body))
    assert json.loads(body.decode("utf-8")) == payload


def test_error_response_without_request_id() -> None:
    handler = DummyJSONRequestHandler()

    handler._error_response(
        HTTPStatus.BAD_REQUEST,
        message="Invalid email athlete@example.com provided",
        error_code="invalid_request",
        retryable=False,
    )

    assert handler.status_sent == 400
    headers_dict = dict(handler.headers_sent)
    assert "X-Request-ID" not in headers_dict

    body = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert body["error"] == "Invalid email <email-redacted> provided"
    assert body["errorCode"] == "invalid_request"
    assert body["retryable"] is False
    assert "requestId" not in body


def test_error_response_with_request_id() -> None:
    handler = DummyJSONRequestHandler(request_id="req-1234")

    handler._error_response(
        HTTPStatus.SERVICE_UNAVAILABLE,
        message="Upstream access_token=secret123 timeout",
        error_code="upstream_timeout",
        retryable=True,
    )

    assert handler.status_sent == 503
    headers_dict = dict(handler.headers_sent)
    assert headers_dict["X-Request-ID"] == "req-1234"

    body = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert body["error"] == "Upstream access_token=<redacted> timeout"
    assert body["errorCode"] == "upstream_timeout"
    assert body["retryable"] is True
    assert body["requestId"] == "req-1234"
