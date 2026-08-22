import os
from dataclasses import dataclass, replace
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


@dataclass
class Settings:
    app_user_id: str
    app_timezone: str = "Europe/Warsaw"
    garmin_email: str | None = None
    garmin_password: str | None = None
    garmin_token_path: str = ".garmin_tokens/garmin_tokens.json"
    garmin_token_store: str = "local"  # "local" or "gcs"
    gcp_project_id: str | None = None
    garmin_token_bucket: str | None = None
    garmin_token_object: str | None = "garmin/garmin_tokens.json"
    firestore_recovery_collection: str = "daily_recovery_snapshots"
    garmin_retry_attempts: int = 3
    garmin_retry_min_wait: float = 1.0
    garmin_retry_max_wait: float = 10.0
    garmin_verify_login: bool = True
    garmin_allow_credential_login: bool = False
    garmin_staleness_minutes: int = 60
    garmin_incomplete_staleness_minutes: int = 5
    garmin_resync_lookback_days: int = 1
    firebase_credentials_path: str | None = None
    garmin_archive_enabled: bool = False
    garmin_archive_store: str = "gcs"  # "local" or "gcs"
    garmin_archive_bucket: str | None = None  # falls back to garmin_token_bucket if unset
    garmin_archive_local_dir: str = ".garmin_archive"
    garmin_archive_prefix: str = "raw/garmin"
    garmin_activity_detail_enabled: bool = False

    def resolved_archive_bucket(self) -> str | None:
        return self.garmin_archive_bucket or self.garmin_token_bucket

    def validate(self) -> None:
        if not self.app_user_id or not self.app_user_id.strip():
            raise ValueError(
                "Configuration error: APP_USER_ID is required. "
                "Use the Firebase Authentication UID of the application user."
            )
        if self.app_user_id.strip() == "default_user":
            raise ValueError(
                "Configuration error: APP_USER_ID cannot be 'default_user'. "
                "Set APP_USER_ID to your actual Firebase Authentication UID."
            )
        try:
            ZoneInfo(self.app_timezone)
        except Exception as e:
            raise ValueError(
                f"Configuration error: Invalid APP_TIMEZONE '{self.app_timezone}': {e}"
            ) from e

        if self.garmin_token_store.lower() == "gcs" and not self.garmin_token_bucket:
            raise ValueError(
                "Configuration error: GARMIN_TOKEN_BUCKET is required when "
                "GARMIN_TOKEN_STORE is 'gcs'."
            )

        if self.garmin_archive_enabled and self.garmin_archive_store.lower() == "gcs":
            if not self.resolved_archive_bucket():
                raise ValueError(
                    "Configuration error: GARMIN_ARCHIVE_BUCKET (or GARMIN_TOKEN_BUCKET as a "
                    "fallback) is required when GARMIN_ARCHIVE_ENABLED is true and "
                    "GARMIN_ARCHIVE_STORE is 'gcs'."
                )


def _load_base_settings(user_id: str) -> Settings:
    tz = os.getenv("APP_TIMEZONE", "Europe/Warsaw").strip()
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    token_path = os.getenv(
        "GARMIN_TOKEN_PATH", os.getenv("GARMIN_TOKENS", ".garmin_tokens/garmin_tokens.json")
    ).strip()
    token_store = os.getenv("GARMIN_TOKEN_STORE", "local").strip().lower()
    project_id = os.getenv("GCP_PROJECT_ID")
    bucket = os.getenv("GARMIN_TOKEN_BUCKET")
    token_obj = os.getenv("GARMIN_TOKEN_OBJECT", "garmin/garmin_tokens.json")
    collection = os.getenv("FIRESTORE_RECOVERY_COLLECTION", "daily_recovery_snapshots")
    retry_attempts = int(os.getenv("GARMIN_RETRY_ATTEMPTS", "3"))
    retry_min_wait = float(os.getenv("GARMIN_RETRY_MIN_WAIT", "1.0"))
    retry_max_wait = float(os.getenv("GARMIN_RETRY_MAX_WAIT", "10.0"))
    verify_login = os.getenv("GARMIN_VERIFY_LOGIN", "true").lower() in ("true", "1", "yes")
    allow_credential_login = os.getenv("GARMIN_ALLOW_CREDENTIAL_LOGIN", "false").lower() in (
        "true",
        "1",
        "yes",
    )
    staleness = int(os.getenv("GARMIN_STALENESS_MINUTES", "60"))
    incomplete_staleness = int(os.getenv("GARMIN_INCOMPLETE_STALENESS_MINUTES", "5"))
    resync_lookback_days = int(os.getenv("GARMIN_RESYNC_LOOKBACK_DAYS", "1"))
    firebase_cred = os.getenv("FIREBASE_CREDENTIALS_PATH")
    archive_enabled = os.getenv("GARMIN_ARCHIVE_ENABLED", "false").lower() in ("true", "1", "yes")
    archive_store = os.getenv("GARMIN_ARCHIVE_STORE", "gcs").strip().lower()
    archive_bucket = os.getenv("GARMIN_ARCHIVE_BUCKET")
    archive_local_dir = os.getenv("GARMIN_ARCHIVE_LOCAL_DIR", ".garmin_archive").strip()
    archive_prefix = os.getenv("GARMIN_ARCHIVE_PREFIX", "raw/garmin").strip()
    activity_detail_enabled = os.getenv("GARMIN_ACTIVITY_DETAIL_ENABLED", "false").lower() in (
        "true",
        "1",
        "yes",
    )

    return Settings(
        app_user_id=user_id,
        app_timezone=tz,
        garmin_email=email,
        garmin_password=password,
        garmin_token_path=token_path,
        garmin_token_store=token_store,
        gcp_project_id=project_id,
        garmin_token_bucket=bucket,
        garmin_token_object=token_obj,
        firestore_recovery_collection=collection,
        garmin_retry_attempts=retry_attempts,
        garmin_retry_min_wait=retry_min_wait,
        garmin_retry_max_wait=retry_max_wait,
        garmin_verify_login=verify_login,
        garmin_allow_credential_login=allow_credential_login,
        garmin_staleness_minutes=staleness,
        garmin_incomplete_staleness_minutes=incomplete_staleness,
        garmin_resync_lookback_days=resync_lookback_days,
        firebase_credentials_path=firebase_cred,
        garmin_archive_enabled=archive_enabled,
        garmin_archive_store=archive_store,
        garmin_archive_bucket=archive_bucket,
        garmin_archive_local_dir=archive_local_dir,
        garmin_archive_prefix=archive_prefix,
        garmin_activity_detail_enabled=activity_detail_enabled,
    )


def _scoped_for_user(settings: Settings) -> Settings:
    """Isolate all Garmin token/archive state for one linked Firebase UID."""
    uid = settings.app_user_id
    return replace(
        settings,
        garmin_token_path=f".garmin_tokens/{uid}/garmin_tokens.json",
        garmin_token_object=f"garmin/users/{uid}/garmin_tokens.json",
        garmin_archive_local_dir=f".garmin_archive/{uid}",
        garmin_archive_prefix=f"raw/garmin/users/{uid}",
        # Scheduled jobs authenticate only from the token written by the self-service
        # account-link flow. Plaintext Garmin credentials never enter scheduled jobs.
        garmin_email=None,
        garmin_password=None,
        garmin_allow_credential_login=False,
    )


def load_settings_for_user(user_id: str, env_file: str | None = None) -> Settings:
    """Load token-only settings for one app user discovered from garminConnections."""
    load_dotenv(dotenv_path=env_file)
    if not user_id or not user_id.strip():
        raise ValueError("Configuration error: linked Firebase user ID cannot be blank.")
    settings = _scoped_for_user(_load_base_settings(user_id))
    settings.validate()
    return settings


def load_settings(env_file: str | None = None) -> Settings:
    """Load legacy/manual single-user settings from APP_USER_ID.

    This remains useful for local backfill/audit/recovery operations. Production scheduled
    jobs do not read a static user list; they discover active Garmin links in Firestore and
    call load_settings_for_user() for each owner UID.
    """
    load_dotenv(dotenv_path=env_file)
    user_id = os.getenv("APP_USER_ID", "")
    if not user_id or not user_id.strip():
        raise ValueError(
            "Configuration error: APP_USER_ID is required for this single-user command. "
            "Scheduled *-all commands discover linked users automatically."
        )
    settings = _load_base_settings(user_id)
    settings.validate()
    return settings
