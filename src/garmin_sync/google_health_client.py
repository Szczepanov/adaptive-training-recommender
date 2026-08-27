"""Google Health API raw list endpoint client (MS5/ADR-0027).

Fetches raw data points from https://health.googleapis.com/v4 with pagination,
request correlation IDs, exponential backoff, and non-sensitive logging.
"""

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from .google_health_auth import GoogleHealthAuthManager

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://health.googleapis.com/v4"
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 1.0

# AIP-160 filter field names for daily-summary data types (Google Health API v4).
# These types expose a `{field}.date` filterable field (ISO 8601 date literal); see
# https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list.
# "sleep" is a session data type with an under-documented filter syntax for this API
# surface -- left server-side-unfiltered here rather than guessing at a query that could
# 400 every sleep request; it still gets the pageSize=25 cap and the client-side date
# check below.
DAILY_SUMMARY_FILTER_FIELDS: dict[str, str] = {
    "daily-heart-rate-variability": "dailyHeartRateVariability",
    "daily-resting-heart-rate": "dailyRestingHeartRate",
    "daily-respiratory-rate": "dailyRespiratoryRate",
}


# Sub-object keys for the three daily-summary data types, each carrying a {year,month,day}
# "date" dict rather than a startTime/endTime pair (confirmed 2026-08-27 against a live
# account; see docs/plans/2026-08-27-real-google-health-ingestion.md).
_DAILY_SUMMARY_KEYS = (
    "dailyHeartRateVariability",
    "dailyRestingHeartRate",
    "dailyRespiratoryRate",
)


def _extract_point_time_range(pt: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    """Best-effort (start, end) UTC instants for a raw data point, across known real/legacy
    shapes. Used only as a coarse client-side pre-filter; per-record logical-date assignment
    for persistence is done separately (see google_health_provider._extract_pt_date)."""
    interval = ((pt.get("sleep") or {}).get("interval")) or {}
    session = pt.get("sleepSession", {}) or {}
    start_str = interval.get("startTime") or session.get("startTime") or pt.get("startTime")
    end_str = interval.get("endTime") or session.get("endTime") or pt.get("endTime")
    if not start_str and not end_str:
        start_str = end_str = pt.get("createTime")

    if not start_str and not end_str:
        for key in _DAILY_SUMMARY_KEYS:
            date_dict = (pt.get(key) or {}).get("date")
            if date_dict and isinstance(date_dict, dict) and "year" in date_dict:
                try:
                    day = datetime(
                        date_dict["year"], date_dict["month"], date_dict["day"], tzinfo=UTC
                    )
                    return day, day
                except (KeyError, ValueError, TypeError):
                    return None, None

    def _parse(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    return _parse(start_str), _parse(end_str or start_str)


class GoogleHealthError(Exception):
    """Base exception for Google Health API errors."""


class GoogleHealthAuthError(GoogleHealthError):
    """Raised when authentication or authorization fails (401/403)."""


class GoogleHealthAccountNotLinkedError(GoogleHealthError):
    """Raised when the Google Account has not completed one-time Google Health onboarding."""

    def __init__(self, message: str, redirect_uri: str | None = None):
        super().__init__(message)
        self.redirect_uri = redirect_uri


class GoogleHealthRateLimitError(GoogleHealthError):
    """Raised when rate limit is exceeded (429)."""


class GoogleHealthNotFoundError(GoogleHealthError):
    """Raised when requested data type or resource is not found (404)."""


class GoogleHealthClient:
    """Client for Google Health v4 raw data points list endpoints."""

    def __init__(
        self,
        auth_manager: GoogleHealthAuthManager,
        base_url: str = DEFAULT_BASE_URL,
        session: requests.Session | None = None,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.auth_manager = auth_manager
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.max_retries = max_retries

    def get_identity(self) -> dict[str, Any]:
        """Fetch the Google Health user identity."""
        url = f"{self.base_url}/users/me/identity"
        return self._execute_request("GET", url)

    def list_data_points(
        self,
        data_type: str,
        start_time_iso: str | None = None,
        end_time_iso: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """List all raw data points for a given data type within an optional time range.

        Handles pagination automatically until all records are collected.
        """
        data_points: list[dict[str, Any]] = []
        page_token: str | None = None
        url = f"{self.base_url}/users/me/dataTypes/{data_type}/dataPoints"

        start_dt = (
            datetime.fromisoformat(start_time_iso.replace("Z", "+00:00"))
            if start_time_iso
            else None
        )
        end_dt = (
            datetime.fromisoformat(end_time_iso.replace("Z", "+00:00")) if end_time_iso else None
        )

        effective_page_size = min(page_size, 25) if data_type == "sleep" else page_size

        # Build the server-side AIP-160 filter for daily-summary types so ingestion
        # doesn't paginate through full account history on every call. end_dt is
        # exclusive of its own calendar day, so widen it by one day to keep logical_date
        # itself inside the range.
        filter_field = DAILY_SUMMARY_FILTER_FIELDS.get(data_type)
        filter_expr: str | None = None
        if filter_field and start_dt and end_dt:
            end_date_exclusive = (end_dt.date() + timedelta(days=1)).isoformat()
            filter_expr = (
                f'{filter_field}.date >= "{start_dt.date().isoformat()}" '
                f'AND {filter_field}.date < "{end_date_exclusive}"'
            )

        while True:
            params: dict[str, Any] = {"pageSize": effective_page_size}
            if filter_expr:
                params["filter"] = filter_expr
            if page_token:
                params["pageToken"] = page_token

            try:
                result = self._execute_request("GET", url, params=params)
            except GoogleHealthError as exc:
                # Only fall back for a plain rejection of the request itself (e.g. the
                # API rejects this filter syntax), on the very first page, before any
                # data has been collected. Auth/rate-limit/not-linked/not-found errors
                # are unrelated to the filter and must still propagate.
                if (
                    type(exc) is GoogleHealthError
                    and filter_expr
                    and page_token is None
                    and not data_points
                ):
                    logger.warning(
                        "Google Health rejected server-side filter for data_type=%s; "
                        "retrying without it (client-side date check still applies).",
                        data_type,
                    )
                    filter_expr = None
                    continue
                raise
            points = result.get("dataPoints", [])

            for pt in points:
                if start_dt or end_dt:
                    pt_start, pt_end = _extract_point_time_range(pt)

                    if start_dt and pt_end and pt_end < start_dt:
                        continue
                    if end_dt and pt_start and pt_start > end_dt:
                        continue

                data_points.append(pt)

            page_token = result.get("nextPageToken")
            if not page_token:
                break

        return data_points

    def _execute_request(
        self,
        method: str,
        url: str,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute an HTTP request with correlation ID and exponential backoff retry."""
        correlation_id = str(uuid.uuid4())
        backoff = INITIAL_BACKOFF_SECONDS

        for attempt in range(1, self.max_retries + 1):
            token = self.auth_manager.get_valid_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "X-Correlation-ID": correlation_id,
                "Accept": "application/json",
            }

            try:
                logger.debug(
                    "GoogleHealth API %s %s (attempt %d, correlationId=%s)",
                    method,
                    url,
                    attempt,
                    correlation_id,
                )
                response = self.session.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=params,
                    json=json_data,
                    timeout=20,
                )

                if response.status_code == 200:
                    return response.json()

                if response.status_code in (401, 403):
                    logger.warning(
                        "Google Health Auth error (HTTP %d, correlationId=%s)",
                        response.status_code,
                        correlation_id,
                    )
                    raise GoogleHealthAuthError(
                        f"Authentication failed: HTTP {response.status_code}"
                    )

                if response.status_code == 400:
                    try:
                        err_body = response.json()
                        err_info = err_body.get("error", {})
                        details = err_info.get("details", [])
                        for d in details:
                            if d.get("reason") == "ACCOUNT_NOT_LINKED":
                                redirect_uri = d.get("metadata", {}).get("redirect_uri")
                                raise GoogleHealthAccountNotLinkedError(
                                    err_info.get(
                                        "message", "The account is not linked to Google Health."
                                    ),
                                    redirect_uri=redirect_uri,
                                )
                    except (ValueError, TypeError):
                        pass
                    raise GoogleHealthError(f"Bad Request: HTTP 400 - {response.text}")

                if response.status_code == 404:
                    raise GoogleHealthNotFoundError("Resource not found: HTTP 404")

                if response.status_code == 429:
                    if attempt == self.max_retries:
                        raise GoogleHealthRateLimitError("Rate limit exceeded (HTTP 429)")
                    time.sleep(backoff)
                    backoff *= 2
                    continue

                if response.status_code >= 500:
                    if attempt == self.max_retries:
                        raise GoogleHealthError(
                            f"Server error: HTTP {response.status_code} - {response.text}"
                        )
                    time.sleep(backoff)
                    backoff *= 2
                    continue

                raise GoogleHealthError(
                    f"Unexpected response: HTTP {response.status_code} - {response.text}"
                )

            except (requests.RequestException, OSError) as e:
                if attempt == self.max_retries:
                    raise GoogleHealthError(f"Request failed: {e}") from e
                time.sleep(backoff)
                backoff *= 2

        raise GoogleHealthError("Max retries exceeded")
