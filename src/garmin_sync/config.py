import os
import sys
from dataclasses import dataclass
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
    firebase_credentials_path: str | None = None
    garmin_archive_enabled: bool = False
    garmin_archive_store: str = "gcs"  # "local" or "gcs"
    garmin_archive_bucket: str | None = None  # falls back to garmin_token_bucket if unset
    garmin_archive_local_dir: str = ".garmin_archive"
    garmin_archive_prefix: str = "raw/garmin"

    def resolved_archive_bucket(self) -> str | None:
        return self.garmin_archive_bucket or self.garmin_token_bucket

    def validate(self) -> None:
        if not self.app_user_id:
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

        if self.garmin_token_store.lower() == "gcs":
            if not self.garmin_token_bucket:
                raise ValueError(
                    "Configuration error: GARMIN_TOKEN_BUCKET is required when GARMIN_TOKEN_STORE is 'gcs'."
                )

        if self.garmin_archive_enabled and self.garmin_archive_store.lower() == "gcs":
            if not self.resolved_archive_bucket():
                raise ValueError(
                    "Configuration error: GARMIN_ARCHIVE_BUCKET (or GARMIN_TOKEN_BUCKET as a fallback) "
                    "is required when GARMIN_ARCHIVE_ENABLED is true and GARMIN_ARCHIVE_STORE is 'gcs'."
                )


def load_settings(env_file: str | None = None) -> Settings:
    load_dotenv(dotenv_path=env_file)

    user_id = os.getenv("APP_USER_ID", "").strip()
    tz = os.getenv("APP_TIMEZONE", "Europe/Warsaw").strip()
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    token_path = os.getenv("GARMIN_TOKEN_PATH", os.getenv("GARMIN_TOKENS", ".garmin_tokens/garmin_tokens.json")).strip()
    token_store = os.getenv("GARMIN_TOKEN_STORE", "local").strip().lower()
    project_id = os.getenv("GCP_PROJECT_ID")
    bucket = os.getenv("GARMIN_TOKEN_BUCKET")
    token_obj = os.getenv("GARMIN_TOKEN_OBJECT", "garmin/garmin_tokens.json")
    collection = os.getenv("FIRESTORE_RECOVERY_COLLECTION", "daily_recovery_snapshots")
    retry_attempts = int(os.getenv("GARMIN_RETRY_ATTEMPTS", "3"))
    retry_min_wait = float(os.getenv("GARMIN_RETRY_MIN_WAIT", "1.0"))
    retry_max_wait = float(os.getenv("GARMIN_RETRY_MAX_WAIT", "10.0"))
    verify_login = os.getenv("GARMIN_VERIFY_LOGIN", "true").lower() in ("true", "1", "yes")
    allow_credential_login = os.getenv("GARMIN_ALLOW_CREDENTIAL_LOGIN", "false").lower() in ("true", "1", "yes")
    staleness = int(os.getenv("GARMIN_STALENESS_MINUTES", "60"))
    firebase_cred = os.getenv("FIREBASE_CREDENTIALS_PATH")
    archive_enabled = os.getenv("GARMIN_ARCHIVE_ENABLED", "false").lower() in ("true", "1", "yes")
    archive_store = os.getenv("GARMIN_ARCHIVE_STORE", "gcs").strip().lower()
    archive_bucket = os.getenv("GARMIN_ARCHIVE_BUCKET")
    archive_local_dir = os.getenv("GARMIN_ARCHIVE_LOCAL_DIR", ".garmin_archive").strip()
    archive_prefix = os.getenv("GARMIN_ARCHIVE_PREFIX", "raw/garmin").strip()

    settings = Settings(
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
        firebase_credentials_path=firebase_cred,
        garmin_archive_enabled=archive_enabled,
        garmin_archive_store=archive_store,
        garmin_archive_bucket=archive_bucket,
        garmin_archive_local_dir=archive_local_dir,
        garmin_archive_prefix=archive_prefix,
    )
    settings.validate()
    return settings
