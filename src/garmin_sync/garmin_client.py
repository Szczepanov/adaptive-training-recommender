import logging
import random
import time
from pathlib import Path
from typing import Any, Callable, Protocol
from garminconnect import Garmin

logger = logging.getLogger(__name__)


class GarminDataClient(Protocol):
    def get_stats(self, date_iso: str) -> dict[str, Any]: ...
    def get_sleep_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_hrv_data(self, date_iso: str) -> dict[str, Any]: ...
    def get_activities_batch(self, start_date_iso: str, end_date_iso: str) -> list[dict[str, Any]]: ...
    def dump_tokens(self, destination: Path | str) -> None: ...


class GarminClientWrapper:
    """Wrapper around garminconnect.Garmin with rate-limiting backoff and token dump support."""

    def __init__(
        self,
        email: str | None = None,
        password: str | None = None,
        max_retries: int = 4,
        base_backoff: float = 5.0,
    ):
        self.email = email
        self.password = password
        self.max_retries = max_retries
        self.base_backoff = base_backoff
        self.api: Garmin | None = None

    def login_with_tokens_or_credentials(self, token_dir: Path | str) -> None:
        token_path = Path(token_dir).expanduser().resolve()
        token_path.mkdir(parents=True, exist_ok=True)

        self.api = Garmin(self.email, self.password)

        if token_path.exists() and any(token_path.iterdir()):
            try:
                self.api.login(str(token_path))
                logger.info(f"Successfully logged in using cached tokens in '{token_path}'.")
                return
            except Exception as e:
                logger.warning(f"Cached token login failed ({e}). Attempting full credential login...")

        if not self.email or not self.password:
            raise RuntimeError(
                "Garmin credentials (GARMIN_EMAIL, GARMIN_PASSWORD) missing and valid tokens unavailable."
            )

        logger.info("Performing full Garmin SSO authentication...")
        try:
            self.api.login()
            self.dump_tokens(token_path)
            logger.info(f"Saved refreshed tokens to '{token_path}'.")
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "Too Many" in err_str:
                logger.error("Garmin rate-limited SSO login. Wait 30-60 minutes before retrying.")
            raise RuntimeError(f"Garmin SSO login failed: {e}") from e

    def _execute_with_backoff(self, fn: Callable, *args: Any) -> Any:
        if not self.api:
            raise RuntimeError("Garmin client is not authenticated. Call login first.")

        for attempt in range(self.max_retries):
            try:
                return fn(*args)
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "Too Many" in err_str or "Rate limit" in err_str:
                    wait = self.base_backoff * (2 ** attempt) * random.uniform(0.5, 1.5)
                    logger.warning(
                        f"Garmin 429 rate-limited. Retrying in {wait:.1f}s... (attempt {attempt + 1}/{self.max_retries})"
                    )
                    time.sleep(wait)
                else:
                    logger.error(f"Garmin API call error: {e}")
                    raise
        logger.error(f"Exhausted {self.max_retries} retries on Garmin API call.")
        raise RuntimeError(
            f"Garmin API call failed after {self.max_retries} retries due to rate limiting."
        )

    def get_stats(self, date_iso: str) -> dict[str, Any]:
        return self._execute_with_backoff(self.api.get_stats, date_iso) or {}

    def get_sleep_data(self, date_iso: str) -> dict[str, Any]:
        return self._execute_with_backoff(self.api.get_sleep_data, date_iso) or {}

    def get_hrv_data(self, date_iso: str) -> dict[str, Any]:
        return self._execute_with_backoff(self.api.get_hrv_data, date_iso) or {}

    def get_activities_batch(self, start_date_iso: str, end_date_iso: str) -> list[dict[str, Any]]:
        return self._execute_with_backoff(
            self.api.get_activities_by_date, start_date_iso, end_date_iso, ""
        ) or []

    def dump_tokens(self, destination: Path | str) -> None:
        if self.api and hasattr(self.api, "garth"):
            dest_path = Path(destination).expanduser().resolve()
            dest_path.mkdir(parents=True, exist_ok=True)
            self.api.garth.dump(str(dest_path))
