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
    garmin_tokens: str = ".garth"
    garmin_token_store: str = "local"  # "local" or "gcs"
    gcp_project_id: str | None = None
    garmin_token_bucket: str | None = None
    garmin_token_object: str | None = "garmin_tokens.tar.gz"
    firestore_recovery_collection: str = "daily_recovery_snapshots"
    garmin_max_retries: int = 4
    garmin_base_backoff_seconds: float = 5.0
    garmin_staleness_minutes: int = 60
    firebase_credentials_path: str | None = None

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


def load_settings(env_file: str | None = None) -> Settings:
    load_dotenv(dotenv_path=env_file)

    user_id = os.getenv("APP_USER_ID", "").strip()
    tz = os.getenv("APP_TIMEZONE", "Europe/Warsaw").strip()
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    tokens = os.getenv("GARMIN_TOKENS", ".garth").strip()
    token_store = os.getenv("GARMIN_TOKEN_STORE", "local").strip().lower()
    project_id = os.getenv("GCP_PROJECT_ID")
    bucket = os.getenv("GARMIN_TOKEN_BUCKET")
    token_obj = os.getenv("GARMIN_TOKEN_OBJECT", "garmin_tokens.tar.gz")
    collection = os.getenv("FIRESTORE_RECOVERY_COLLECTION", "daily_recovery_snapshots")
    max_retries = int(os.getenv("GARMIN_MAX_RETRIES", "4"))
    backoff = float(os.getenv("GARMIN_BASE_BACKOFF_SECONDS", "5.0"))
    staleness = int(os.getenv("GARMIN_STALENESS_MINUTES", "60"))
    firebase_cred = os.getenv("FIREBASE_CREDENTIALS_PATH")

    settings = Settings(
        app_user_id=user_id,
        app_timezone=tz,
        garmin_email=email,
        garmin_password=password,
        garmin_tokens=tokens,
        garmin_token_store=token_store,
        gcp_project_id=project_id,
        garmin_token_bucket=bucket,
        garmin_token_object=token_obj,
        firestore_recovery_collection=collection,
        garmin_max_retries=max_retries,
        garmin_base_backoff_seconds=backoff,
        garmin_staleness_minutes=staleness,
        firebase_credentials_path=firebase_cred,
    )
    settings.validate()
    return settings
