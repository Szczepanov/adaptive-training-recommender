"""Google Health API raw list endpoint client (MS5/ADR-0027).

Fetches raw data points from https://health.googleapis.com/v4 with pagination,
request correlation IDs, exponential backoff, and non-sensitive logging.
"""

import logging
import time
import uuid
from datetime import datetime
from typing import Any

import requests

from .google_health_auth import GoogleHealthAuthManager

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://health.googleapis.com/v4"
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 1.0


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
    ):
        self.auth_manager = auth_manager
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.max_retries = max_retries

    def get_identity(self) -> dict[str, Any]:
        """Fetch the Google Health user identity."""
        url = f"{self.base_url}/users/me"
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

        while True:
            params: dict[str, Any] = {"pageSize": page_size}
            if page_token:
                params["pageToken"] = page_token

            result = self._execute_request("GET", url, params=params)
            points = result.get("dataPoints", [])

            for pt in points:
                if start_dt or end_dt:
                    pt_start_str = pt.get("startTime") or pt.get("createTime")
                    pt_end_str = pt.get("endTime") or pt_start_str
                    try:
                        pt_start = (
                            datetime.fromisoformat(pt_start_str.replace("Z", "+00:00"))
                            if pt_start_str
                            else None
                        )
                        pt_end = (
                            datetime.fromisoformat(pt_end_str.replace("Z", "+00:00"))
                            if pt_end_str
                            else None
                        )
                    except (ValueError, TypeError):
                        pt_start = pt_end = None

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
