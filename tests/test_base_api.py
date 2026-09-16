import io
from http import HTTPStatus
from typing import Any

from garmin_sync.base_api import BaseJSONRequestHandler


class DummyRequestHandler(BaseJSONRequestHandler):

    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = headers or {}  # type: ignore[assignment]
        self.wfile = io.BytesIO()
        self.sent_status: int | None = None
        self.sent_headers: list[tuple[str, str]] = []

    def send_response(self, code: int, message: str | None = None) -> None:
        self.sent_status = code

    def send_header(self, keyword: str, value: str) -> None:
        self.sent_headers.append((keyword, value))

    def end_headers(self) -> None:
        pass


def get_header(headers: list[tuple[str, str]], name: str) -> str | None:
    name_lower = name.lower()
    for k, v in headers:
        if k.lower() == name_lower:
            return v
    return None


def test_no_cors_headers_when_origin_header_missing(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyRequestHandler(headers={})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})  # noqa: SLF001

    assert handler.sent_status == HTTPStatus.OK.value
    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") is None


def test_cors_headers_added_for_allowed_origin(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com, https://admin.example.com")
    handler = DummyRequestHandler(headers={"Origin": "https://app.example.com"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})  # noqa: SLF001

    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") == "https://app.example.com"
    assert get_header(handler.sent_headers, "Vary") == "Origin"
    assert "GET, POST, OPTIONS" in (get_header(handler.sent_headers, "Access-Control-Allow-Methods") or "")
    assert "Content-Type" in (get_header(handler.sent_headers, "Access-Control-Allow-Headers") or "")


def test_cors_allowed_origins_from_app_base_url(monkeypatch: Any) -> None:
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("APP_BASE_URL", "https://my-app.web.app/settings")
    handler = DummyRequestHandler(headers={"Origin": "https://my-app.web.app"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})  # noqa: SLF001

    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") == "https://my-app.web.app"


def test_cors_rejected_for_unallowed_origin(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyRequestHandler(headers={"Origin": "https://evil.com"})
    handler._json_response(HTTPStatus.OK, {"status": "ok"})  # noqa: SLF001

    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") is None


def test_do_options_returns_no_content_with_cors_headers(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyRequestHandler(headers={"Origin": "https://app.example.com"})
    handler.do_OPTIONS()

    assert handler.sent_status == HTTPStatus.NO_CONTENT.value
    assert get_header(handler.sent_headers, "Content-Length") == "0"
    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") == "https://app.example.com"


def test_error_response_includes_cors_headers(monkeypatch: Any) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    handler = DummyRequestHandler(headers={"Origin": "https://app.example.com"})
    handler._error_response(  # noqa: SLF001
        HTTPStatus.BAD_REQUEST,
        message="Bad input",
        error_code="bad_input",
        retryable=False,
    )

    assert handler.sent_status == HTTPStatus.BAD_REQUEST.value
    assert get_header(handler.sent_headers, "Access-Control-Allow-Origin") == "https://app.example.com"
