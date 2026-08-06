import logging
from pathlib import Path
from typing import Any, Callable, Protocol
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

logger = logging.getLogger(__name__)


class GarminDataClient(Protocol):
    def get_stats(self, date_iso: str) -> dict[str, Any]: ...
    def get_sleep_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_hrv_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_activities_window(self, start_date_iso: str, end_date_iso: str) -> list[dict[str, Any]]: ...


class GarminClientWrapper:
    """Wrapper around garminconnect.Garmin supporting token-only auth and paginated activity windows."""

    def __init__(
        self,
        email: str | None = None,
        password: str | None = None,
        prompt_mfa: Callable[[], str] | None = None,
        retry_attempts: int = 3,
        retry_min_wait: float = 1.0,
        retry_max_wait: float = 10.0,
        verify_login: bool = True,
        allow_credential_login: bool = False,
    ):
        self.email = email if allow_credential_login else None
        self.password = password if allow_credential_login else None
        self.prompt_mfa = prompt_mfa
        self.retry_attempts = retry_attempts
        self.retry_min_wait = retry_min_wait
        self.retry_max_wait = retry_max_wait
        self.verify_login = verify_login
        self.allow_credential_login = allow_credential_login
        self.api: Garmin | None = None

    def login_with_tokens_or_credentials(self, token_path: Path | str) -> None:
        token_file = Path(token_path).expanduser().resolve()

        self.api = Garmin(
            email=self.email,
            password=self.password,
            prompt_mfa=self.prompt_mfa,
            retry_attempts=self.retry_attempts,
            retry_min_wait=self.retry_min_wait,
            retry_max_wait=self.retry_max_wait,
        )

        if token_file.exists():
            try:
                self.api.login(str(token_file))
                logger.info(f"Successfully logged in using token file '{token_file}'.")
                return
            except Exception as e:
                logger.warning(f"Cached token login failed ({e}).")

        if not self.allow_credential_login:
            raise GarminConnectAuthenticationError(
                f"token_rebootstrap_required: Token file '{token_file}' missing or invalid and credential login is prohibited."
            )

        if not self.email or not self.password:
            raise RuntimeError(
                "Garmin credentials (GARMIN_EMAIL, GARMIN_PASSWORD) missing and valid tokens unavailable."
            )

        logger.info("Performing full Garmin SSO credential authentication...")
        try:
            self.api.login()
            logger.info("Garmin SSO authentication completed.")
        except Exception as e:
            logger.error(f"Garmin SSO login failed: {e}")
            raise

    def get_stats(self, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_stats(date_iso) or {}

    def get_sleep_data(self, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_sleep_data(date_iso) or {}

    def get_hrv_data(self, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_hrv_data(date_iso) or {}

    def get_activities_window(self, start_date_iso: str, end_date_iso: str) -> list[dict[str, Any]]:
        """Paginate get_activities (newest first) to retrieve activities in [start_date_iso, end_date_iso]."""
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")

        activities: list[dict[str, Any]] = []
        start_index = 0
        limit = 100
        max_pages = 30

        for _ in range(max_pages):
            batch = self.api.get_activities(start_index, limit)
            if not batch:
                break
            activities.extend(batch)
            oldest_date = batch[-1].get("startTimeLocal", "")[:10]
            if oldest_date and oldest_date < start_date_iso:
                break
            start_index += limit
        else:
            logger.warning(
                f"Reached max page limit ({max_pages}) when fetching activities window {start_date_iso} -> {end_date_iso}."
            )

        window_acts = [
            act for act in activities
            if start_date_iso <= act.get("startTimeLocal", "")[:10] <= end_date_iso
        ]
        return window_acts

