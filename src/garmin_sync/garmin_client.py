import logging
from pathlib import Path
from typing import Any, Callable, Protocol

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

logger = logging.getLogger(__name__)


class GarminDataClient(Protocol):
    def get_stats(self, date_iso: str) -> dict[str, Any]: ...
    def get_sleep_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_hrv_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_activities_window(
        self, start_date_iso: str, end_date_iso: str
    ) -> list[dict[str, Any]]: ...
    def get_stress_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_respiration_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_body_battery(self, date_iso: str) -> list[dict[str, Any]]: ...
    def get_training_readiness(self, date_iso: str) -> list[dict[str, Any]]: ...
    def get_training_status(self, date_iso: str) -> dict[str, Any]: ...
    def get_heart_rate_zones(self) -> list[dict[str, Any]]: ...
    def get_cycling_ftp(self) -> dict[str, Any] | list[dict[str, Any]]: ...
    def get_lactate_threshold(self) -> dict[str, Any]: ...
    def get_activity_power_zones(self, activity_id: str) -> list[dict[str, Any]]: ...
    def get_activity_hr_zones(self, activity_id: str) -> list[dict[str, Any]]: ...
    def get_activity_splits(self, activity_id: str) -> dict[str, Any]: ...
    def upload_workout(self, workout_json: dict[str, Any]) -> dict[str, Any]: ...
    def schedule_workout(self, workout_id: str, date_iso: str) -> dict[str, Any]: ...


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
        """Log in via garminconnect's own load-or-refresh-or-fresh-login flow.

        `Garmin.login(token_file)` transparently: loads and validates a cached token if
        present, refreshes it if needed, falls back to a full credential (+ MFA) login
        when credentials are set and the cached token is missing/invalid, and persists
        the resulting (possibly refreshed) token back to `token_file` on every success
        path -- upstream only calls its internal dump() when a tokenstore path was
        actually passed in, so this must always be a single call with that path, not a
        separate argless fallback call (which would authenticate but never save).
        """
        token_file = Path(token_path).expanduser().resolve()
        token_file.parent.mkdir(parents=True, exist_ok=True)

        if self.allow_credential_login and not (self.email and self.password):
            raise RuntimeError(
                "Garmin credentials (GARMIN_EMAIL, GARMIN_PASSWORD) are required when "
                "credential login is enabled but were not provided."
            )

        self.api = Garmin(
            email=self.email,
            password=self.password,
            prompt_mfa=self.prompt_mfa,
            retry_attempts=self.retry_attempts,
            retry_min_wait=self.retry_min_wait,
            retry_max_wait=self.retry_max_wait,
            verify_login=self.verify_login,
        )

        try:
            self.api.login(str(token_file))
            logger.info(f"Garmin login succeeded; tokens persisted to '{token_file}'.")
        except (GarminConnectTooManyRequestsError, GarminConnectConnectionError):
            # Transient/infra failure, not a token problem -- surface as-is rather than
            # falling through to a credential-login retry right after a 429/5xx.
            raise
        except GarminConnectAuthenticationError:
            raise
        except Exception as e:
            if not self.allow_credential_login:
                raise GarminConnectAuthenticationError(
                    f"token_rebootstrap_required: token-only login failed for '{token_file}': {e}"
                ) from e
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

    def get_stress_data(self, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_all_day_stress(date_iso) or {}

    def get_respiration_data(self, date_iso: str) -> dict[str, Any]:
        """The dedicated all-day respiration endpoint. Unlike `dailySleepDTO`'s single
        (coarser) `averageRespirationValue` summary field, this carries the full
        `respirationValuesArray` of ~2-minute-interval readings, which
        garmin_provider.average_sleep_respiration_from_intervals uses to compute a more
        precise sleep-window average."""
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_respiration_data(date_iso) or {}

    def get_body_battery(self, date_iso: str) -> list[dict[str, Any]]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_body_battery(date_iso, date_iso) or []

    def get_training_readiness(self, date_iso: str) -> list[dict[str, Any]]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_training_readiness(date_iso) or []

    def get_training_status(self, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_training_status(date_iso) or {}

    def get_heart_rate_zones(self) -> list[dict[str, Any]]:
        """Configured HR zones per sport profile -- not date-scoped, this is a profile
        setting Garmin recomputes on demand (from either a measured/estimated max HR or
        a manually entered one), not per-day telemetry."""
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_heart_rate_zones() or []

    def get_cycling_ftp(self) -> dict[str, Any] | list[dict[str, Any]]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_cycling_ftp() or {}

    def get_lactate_threshold(self) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_lactate_threshold(latest=True) or {}

    def get_activity_power_zones(self, activity_id: str) -> list[dict[str, Any]]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_activity_power_in_timezones(activity_id) or []

    def get_activity_hr_zones(self, activity_id: str) -> list[dict[str, Any]]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_activity_hr_in_timezones(activity_id) or []

    def get_activity_splits(self, activity_id: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.get_activity_splits(activity_id) or {}

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
            act
            for act in activities
            if start_date_iso <= act.get("startTimeLocal", "")[:10] <= end_date_iso
        ]
        return window_acts

    def upload_workout(self, workout_json: dict[str, Any]) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.upload_workout(workout_json) or {}

    def schedule_workout(self, workout_id: str, date_iso: str) -> dict[str, Any]:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")
        return self.api.schedule_workout(workout_id, date_iso) or {}
