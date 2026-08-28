"""Configuration for the opt-in direct Eight Sleep observation transport."""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo


class EightSleepConfigurationError(ValueError):
    """Raised when direct Eight Sleep is enabled but incomplete."""


@dataclass(frozen=True)
class EightSleepSettings:
    enabled: bool = False
    email: str | None = None
    password: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    user_id: str | None = None
    timezone: str = "Europe/Warsaw"
    timeout_seconds: float = 20.0
    max_retries: int = 2

    def validate(self) -> None:
        try:
            ZoneInfo(self.timezone)
        except Exception as exc:
            raise EightSleepConfigurationError(
                f"Invalid EIGHT_SLEEP_TIMEZONE {self.timezone!r}: {exc}"
            ) from exc
        if self.timeout_seconds <= 0:
            raise EightSleepConfigurationError("EIGHT_SLEEP_TIMEOUT_SECONDS must be > 0.")
        if self.max_retries < 0:
            raise EightSleepConfigurationError("EIGHT_SLEEP_MAX_RETRIES must be >= 0.")
        if not self.enabled:
            return
        missing = [
            name
            for name, value in (
                ("EIGHT_SLEEP_EMAIL", self.email),
                ("EIGHT_SLEEP_PASSWORD", self.password),
                ("EIGHT_SLEEP_CLIENT_ID", self.client_id),
                ("EIGHT_SLEEP_CLIENT_SECRET", self.client_secret),
            )
            if not value or not value.strip()
        ]
        if missing:
            raise EightSleepConfigurationError(
                "Direct Eight Sleep ingestion is enabled but required secret configuration is missing: "
                + ", ".join(missing)
                + "."
            )

    @classmethod
    def from_env(cls) -> "EightSleepSettings":
        settings = cls(
            enabled=_env_bool("EIGHT_SLEEP_DIRECT_ENABLED", False),
            email=os.getenv("EIGHT_SLEEP_EMAIL"),
            password=os.getenv("EIGHT_SLEEP_PASSWORD"),
            client_id=os.getenv("EIGHT_SLEEP_CLIENT_ID"),
            client_secret=os.getenv("EIGHT_SLEEP_CLIENT_SECRET"),
            user_id=os.getenv("EIGHT_SLEEP_USER_ID"),
            timezone=os.getenv("EIGHT_SLEEP_TIMEZONE", "Europe/Warsaw").strip(),
            timeout_seconds=float(os.getenv("EIGHT_SLEEP_TIMEOUT_SECONDS", "20")),
            max_retries=int(os.getenv("EIGHT_SLEEP_MAX_RETRIES", "2")),
        )
        settings.validate()
        return settings


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}
