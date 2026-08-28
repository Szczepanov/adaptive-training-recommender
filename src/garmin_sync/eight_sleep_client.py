"""Minimal read-only client for Eight Sleep's unsupported private API."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from garmin_sync.eight_sleep_config import EightSleepSettings

AUTH_URL = "https://auth-api.8slp.net/v1/tokens"
CLIENT_API_BASE_URL = "https://client-api.8slp.net/v1"


class EightSleepError(RuntimeError):
    pass


class EightSleepAuthenticationError(EightSleepError):
    pass


class EightSleepRateLimitError(EightSleepError):
    pass


class EightSleepApiError(EightSleepError):
    pass


class EightSleepSchemaError(EightSleepError):
    pass


@dataclass(frozen=True)
class EightSleepToken:
    access_token: str
    expires_at: datetime
    user_id: str | None = None

    def is_valid(self, now: datetime | None = None) -> bool:
        return bool(self.access_token) and (now or datetime.now(UTC)) < self.expires_at - timedelta(
            seconds=60
        )


@dataclass(frozen=True)
class EightSleepHttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class EightSleepHttpTransport(Protocol):
    def request(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        data: bytes | None,
        timeout: float,
    ) -> EightSleepHttpResponse: ...


class UrllibEightSleepTransport:
    def request(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        data: bytes | None,
        timeout: float,
    ) -> EightSleepHttpResponse:
        # Authorization must never survive a redirect to a different origin --
        # urlopen forwards regular Request headers across redirects, so it's added
        # unredirected (stripped before any redirected request is built) instead of
        # via the constructor's headers dict, which are all redirect-following.
        redirect_safe_headers = {k: v for k, v in headers.items() if k.lower() != "authorization"}
        request = Request(url=url, data=data, headers=redirect_safe_headers, method=method)
        auth_value = headers.get("Authorization") or headers.get("authorization")
        if auth_value:
            request.add_unredirected_header("Authorization", auth_value)
        try:
            with urlopen(request, timeout=timeout) as response:  # noqa: S310 -- fixed HTTPS API endpoints
                return EightSleepHttpResponse(
                    response.status, dict(response.headers.items()), response.read()
                )
        except HTTPError as exc:
            return EightSleepHttpResponse(exc.code, dict(exc.headers.items()), exc.read())
        except URLError as exc:
            raise EightSleepApiError(f"Eight Sleep network request failed: {exc.reason}") from exc


class EightSleepClient:
    """Read-only private-API client with in-memory token reuse and bounded retry."""

    def __init__(
        self,
        settings: EightSleepSettings,
        *,
        transport: EightSleepHttpTransport | None = None,
        sleep_fn: Any = time.sleep,
        now_fn: Any = lambda: datetime.now(UTC),
    ) -> None:
        settings.validate()
        if not settings.enabled:
            raise EightSleepAuthenticationError("Direct Eight Sleep ingestion is disabled.")
        self.settings = settings
        self.transport = transport or UrllibEightSleepTransport()
        self._sleep = sleep_fn
        self._now = now_fn
        self._token: EightSleepToken | None = None

    def clear_token(self) -> None:
        self._token = None

    def authenticate(self, *, force: bool = False) -> EightSleepToken:
        if not force and self._token and self._token.is_valid(self._now()):
            return self._token
        data = urlencode(
            {
                "grant_type": "password",
                "username": self.settings.email or "",
                "password": self.settings.password or "",
                "client_id": self.settings.client_id or "",
                "client_secret": self.settings.client_secret or "",
            }
        ).encode()
        response = self.transport.request(
            method="POST",
            url=AUTH_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=data,
            timeout=self.settings.timeout_seconds,
        )
        if response.status in (401, 403):
            raise EightSleepAuthenticationError(
                f"Eight Sleep authentication rejected credentials (HTTP {response.status})."
            )
        if response.status == 429:
            raise EightSleepRateLimitError(
                "Eight Sleep authentication was rate limited (HTTP 429)."
            )
        if not 200 <= response.status < 300:
            raise EightSleepApiError(f"Eight Sleep authentication failed (HTTP {response.status}).")
        body = _decode_json(response.body, "authentication")
        if not isinstance(body, dict):
            raise EightSleepSchemaError("Eight Sleep authentication response must be an object.")
        access = _string(body.get("access_token") or body.get("accessToken"))
        if not access:
            raise EightSleepSchemaError("Eight Sleep authentication response has no access token.")
        try:
            expires = max(120, int(body.get("expires_in") or body.get("expiresIn") or 3600))
        except (TypeError, ValueError) as exc:
            raise EightSleepSchemaError("Eight Sleep token expiry is not numeric.") from exc
        user_id = _string(body.get("userId") or body.get("user_id") or body.get("userID"))
        self._token = EightSleepToken(access, self._now() + timedelta(seconds=expires), user_id)
        return self._token

    def get_user_id(self) -> str:
        if configured := _string(self.settings.user_id):
            return configured
        token = self.authenticate()
        if token.user_id:
            return token.user_id
        body = self._authorized_json(f"{CLIENT_API_BASE_URL}/users/me")
        if not isinstance(body, dict):
            raise EightSleepSchemaError("Eight Sleep /users/me response must be an object.")
        nested = body.get("user")
        nested_id = nested.get("userId") if isinstance(nested, dict) else None
        user_id = _string(body.get("userId") or body.get("user_id") or body.get("id") or nested_id)
        if not user_id:
            raise EightSleepSchemaError("Eight Sleep /users/me response has no user ID.")
        return user_id

    def get_trends(self, *, from_date: str, to_date: str, timezone: str) -> Any:
        query = urlencode(
            {
                "from": from_date,
                "to": to_date,
                "tz": timezone,
                "include-main": "false",
                "include-all-sessions": "true",
                "model-version": "v2",
            }
        )
        return self._authorized_json(
            f"{CLIENT_API_BASE_URL}/users/{self.get_user_id()}/trends?{query}"
        )

    def _authorized_json(self, url: str) -> Any:
        reauthed = False
        retries = 0
        while True:
            token = self.authenticate()
            response = self.transport.request(
                method="GET",
                url=url,
                headers={
                    "Authorization": f"Bearer {token.access_token}",
                    "Accept": "application/json",
                },
                data=None,
                timeout=self.settings.timeout_seconds,
            )
            if response.status == 401 and not reauthed:
                self.clear_token()
                reauthed = True
                continue
            if response.status in (401, 403):
                raise EightSleepAuthenticationError(
                    f"Eight Sleep API authorization failed (HTTP {response.status})."
                )
            if response.status == 429 or 500 <= response.status < 600:
                if retries >= self.settings.max_retries:
                    if response.status == 429:
                        raise EightSleepRateLimitError(
                            "Eight Sleep API remained rate limited after bounded retries."
                        )
                    raise EightSleepApiError(
                        f"Eight Sleep API failed after bounded retries (HTTP {response.status})."
                    )
                self._sleep(_retry_delay(response.headers, retries))
                retries += 1
                continue
            if not 200 <= response.status < 300:
                raise EightSleepApiError(
                    f"Eight Sleep API request failed (HTTP {response.status})."
                )
            return _decode_json(response.body, "API")


def _decode_json(raw: bytes, context: str) -> Any:
    try:
        return json.loads(raw.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EightSleepSchemaError(f"Eight Sleep {context} response was not valid JSON.") from exc


def _retry_delay(headers: Mapping[str, str], attempt: int) -> float:
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw:
        try:
            return min(60.0, max(0.0, float(raw)))
        except ValueError:
            pass
        # RFC 9110 10.2.3: Retry-After is either delay-seconds (handled above) or an
        # HTTP-date. Eight Sleep's real format is unconfirmed, so both are honored
        # rather than silently falling back to a short exponential delay that could
        # retry sooner than the server actually asked for.
        try:
            retry_at = parsedate_to_datetime(raw)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=UTC)
            return min(60.0, max(0.0, (retry_at - datetime.now(UTC)).total_seconds()))
        except (TypeError, ValueError):
            pass
    return min(8.0, float(2**attempt))


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
