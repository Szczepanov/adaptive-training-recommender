"""Google Health OAuth 2.0 connection model and token management (MS4/ADR-0027).

Manages OAuth tokens, token refresh with mutual exclusion locks to prevent race
conditions, and user connection metadata in Firestore without logging or leaking credentials.
"""

import logging
import threading
import time
from dataclasses import asdict, dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

# Minimal read-only scopes (MS4 / ADR-0027)
SCOPE_SLEEP_READONLY = "https://www.googleapis.com/auth/googlehealth.sleep.readonly"
SCOPE_HEALTH_METRICS_READONLY = (
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly"
)

DEFAULT_GOOGLE_HEALTH_SCOPES = [
    SCOPE_SLEEP_READONLY,
    SCOPE_HEALTH_METRICS_READONLY,
]

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"


@dataclass
class GoogleHealthConnectionMetadata:
    status: str  # "active", "disconnected", "error", "pending"
    healthUserId: str | None = None
    grantedScopes: list[str] | None = None
    linkedAt: str | None = None
    refreshedAt: str | None = None
    lastSuccessfulSyncAt: str | None = None
    lastErrorClass: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class GoogleHealthTokenCredentials:
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_at: float = 0.0  # epoch seconds
    scopes: list[str] | None = None
    health_user_id: str | None = None


class GoogleHealthAuthManager:
    """Thread-safe OAuth 2.0 token and connection manager for Google Health API."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        credentials: GoogleHealthTokenCredentials | None = None,
    ):
        if not client_id or not client_secret:
            raise ValueError(
                "GoogleHealthAuthManager requires non-empty client_id and client_secret."
            )
        self.client_id = client_id
        self.client_secret = client_secret
        self.credentials = credentials
        self._lock = threading.Lock()

    def get_valid_access_token(self) -> str:
        """Return a valid access token, refreshing it if expired or expiring within 60 seconds."""
        if not self.credentials:
            raise ValueError("No credentials configured for Google Health.")

        with self._lock:
            now = time.time()
            if self.credentials.expires_at > now + 60:
                return self.credentials.access_token

            self._refresh_token_locked()
            return self.credentials.access_token

    def _refresh_token_locked(self) -> None:
        """Perform token refresh while holding the thread lock."""
        if not self.credentials or not self.credentials.refresh_token:
            raise ValueError("Cannot refresh without a refresh_token.")

        logger.info("Refreshing Google Health access token...")
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.credentials.refresh_token,
            "grant_type": "refresh_token",
        }

        response = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=15)
        if response.status_code != 200:
            logger.error("Failed to refresh Google Health token: HTTP %d", response.status_code)
            raise RuntimeError(f"Google Health token refresh failed: HTTP {response.status_code}")

        data = response.json()
        expires_in = data.get("expires_in", 3600)
        self.credentials.access_token = data["access_token"]
        self.credentials.expires_at = time.time() + expires_in
        if "refresh_token" in data:
            self.credentials.refresh_token = data["refresh_token"]

        logger.info("Google Health access token refreshed successfully.")

    def revoke(self) -> bool:
        """Revoke the current refresh token."""
        if not self.credentials or not self.credentials.refresh_token:
            return False

        with self._lock:
            try:
                resp = requests.post(
                    GOOGLE_REVOKE_URL,
                    params={"token": self.credentials.refresh_token},
                    headers={"content-type": "application/x-www-form-urlencoded"},
                    timeout=10,
                )
                success = resp.status_code == 200
                if success:
                    self.credentials = None
                return success
            except Exception as e:
                logger.error("Error revoking Google Health token: %s", e)
                return False
