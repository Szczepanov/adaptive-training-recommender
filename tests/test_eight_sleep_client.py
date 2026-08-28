from collections import deque
from datetime import UTC, datetime
from typing import Mapping
from unittest.mock import patch
from urllib.parse import parse_qs

import pytest

from garmin_sync.eight_sleep_client import (
    AUTH_URL,
    CLIENT_API_BASE_URL,
    EightSleepAuthenticationError,
    EightSleepClient,
    EightSleepHttpResponse,
    EightSleepRateLimitError,
    UrllibEightSleepTransport,
    _retry_delay,
)
from garmin_sync.eight_sleep_config import EightSleepSettings


class FakeTransport:
    def __init__(self, responses: list[EightSleepHttpResponse]) -> None:
        self.responses = deque(responses)
        self.calls: list[dict[str, object]] = []

    def request(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        data: bytes | None,
        timeout: float,
    ) -> EightSleepHttpResponse:
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "data": data})
        return self.responses.popleft()


def r(status: int, body: str, **headers: str) -> EightSleepHttpResponse:
    return EightSleepHttpResponse(status, headers, body.encode())


def settings(*, max_retries: int = 2) -> EightSleepSettings:
    return EightSleepSettings(
        enabled=True,
        email="a@b.test",
        password="pw",
        client_id="cid",
        client_secret="cs",
        user_id="u",
        max_retries=max_retries,
    )


def test_auth_uses_explicit_client_credentials_and_reuses_token() -> None:
    t = FakeTransport(
        [
            r(200, '{"access_token":"a","expires_in":3600,"userId":"u"}'),
            r(200, '{"days":[]}'),
            r(200, '{"days":[]}'),
        ]
    )
    c = EightSleepClient(
        settings(),
        transport=t,
        sleep_fn=lambda _: None,
        now_fn=lambda: datetime(2026, 8, 28, tzinfo=UTC),
    )
    c.get_trends(from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw")
    c.get_trends(from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw")
    form = parse_qs((t.calls[0]["data"] or b"").decode())
    assert (
        t.calls[0]["url"] == AUTH_URL
        and form["client_secret"] == ["cs"]
        and sum(x["url"] == AUTH_URL for x in t.calls) == 1
    )


def test_trends_endpoint_and_query() -> None:
    t = FakeTransport(
        [r(200, '{"access_token":"a","expires_in":3600,"userId":"u"}'), r(200, '{"days":[]}')]
    )
    EightSleepClient(settings(), transport=t, sleep_fn=lambda _: None).get_trends(
        from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw"
    )
    url = str(t.calls[1]["url"])
    assert url.startswith(f"{CLIENT_API_BASE_URL}/users/u/trends?") and "model-version=v2" in url


def test_401_reauthenticates_once_then_fails_closed() -> None:
    t = FakeTransport(
        [
            r(200, '{"access_token":"a","expires_in":3600,"userId":"u"}'),
            r(401, "{}"),
            r(200, '{"access_token":"b","expires_in":3600,"userId":"u"}'),
            r(401, "{}"),
        ]
    )
    c = EightSleepClient(settings(), transport=t, sleep_fn=lambda _: None)
    with pytest.raises(EightSleepAuthenticationError):
        c.get_trends(from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw")


def test_429_retry_is_bounded() -> None:
    t = FakeTransport(
        [
            r(200, '{"access_token":"a","expires_in":3600,"userId":"u"}'),
            r(429, "{}", **{"Retry-After": "0"}),
            r(429, "{}"),
        ]
    )
    c = EightSleepClient(settings(max_retries=1), transport=t, sleep_fn=lambda _: None)
    with pytest.raises(EightSleepRateLimitError):
        c.get_trends(from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw")


def test_authorization_header_is_not_forwarded_on_redirect() -> None:
    """A regular (redirect-following) Request header would leak the bearer token to
    a different origin if Eight Sleep's API ever issued a redirect. `Authorization`
    must be unredirected -- everything else can stay regular."""
    captured: dict[str, object] = {}

    class _FakeUrlopenResponse:
        status = 200
        headers = {}

        def read(self) -> bytes:
            return b"{}"

        def __enter__(self) -> "_FakeUrlopenResponse":
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_urlopen(request: object, timeout: float) -> _FakeUrlopenResponse:
        captured["request"] = request
        return _FakeUrlopenResponse()

    with patch("garmin_sync.eight_sleep_client.urlopen", fake_urlopen):
        UrllibEightSleepTransport().request(
            method="GET",
            url="https://client-api.8slp.net/v1/x",
            headers={"Authorization": "Bearer secret", "Accept": "application/json"},
            data=None,
            timeout=5.0,
        )

    request = captured["request"]
    assert "Authorization" not in request.headers  # type: ignore[attr-defined]
    assert request.unredirected_hdrs.get("Authorization") == "Bearer secret"  # type: ignore[attr-defined]
    assert request.headers.get("Accept") == "application/json"  # type: ignore[attr-defined]


def test_retry_delay_parses_numeric_seconds() -> None:
    assert _retry_delay({"Retry-After": "5"}, attempt=0) == 5.0


def test_retry_delay_parses_http_date() -> None:
    from email.utils import format_datetime

    future = datetime(2026, 8, 28, 12, 0, 30, tzinfo=UTC)
    with patch("garmin_sync.eight_sleep_client.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 8, 28, 12, 0, 0, tzinfo=UTC)
        delay = _retry_delay({"Retry-After": format_datetime(future, usegmt=True)}, attempt=0)
    assert delay == pytest.approx(30.0, abs=1.0)


def test_retry_delay_falls_back_on_garbage_header() -> None:
    assert _retry_delay({"Retry-After": "not-a-date"}, attempt=0) == 1.0


def test_401_reauth_followed_by_429_retry_reuses_token() -> None:
    t = FakeTransport(
        [
            r(200, '{"access_token":"a","expires_in":3600,"userId":"u"}'),
            r(401, "{}"),
            r(200, '{"access_token":"b","expires_in":3600,"userId":"u"}'),
            r(429, "{}", **{"Retry-After": "0"}),
            r(200, '{"days":[]}'),
        ]
    )
    c = EightSleepClient(settings(max_retries=1), transport=t, sleep_fn=lambda _: None)
    data = c.get_trends(from_date="2026-08-27", to_date="2026-08-29", timezone="Europe/Warsaw")
    assert data == {"days": []}
    auth_calls = [x for x in t.calls if x["url"] == AUTH_URL]
    api_calls = [x for x in t.calls if x["url"] != AUTH_URL]
    assert len(auth_calls) == 2
    assert len(api_calls) == 3
    assert api_calls[0]["headers"]["Authorization"] == "Bearer a"  # type: ignore[index]
    assert api_calls[1]["headers"]["Authorization"] == "Bearer b"  # type: ignore[index]
    assert api_calls[2]["headers"]["Authorization"] == "Bearer b"  # type: ignore[index]
