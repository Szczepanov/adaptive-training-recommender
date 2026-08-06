"""CLI script to refresh/bootstrap Garmin OAuth tokens safely."""
import os
import sys
from pathlib import Path
from garmin_sync.config import load_settings, Settings
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.token_store import create_token_store

def main():
    try:
        settings = load_settings()
    except Exception:
        # Fall back to env loading if APP_USER_ID is not set for bootstrapping
        from dotenv import load_dotenv
        load_dotenv()
        email = os.getenv("GARMIN_EMAIL")
        password = os.getenv("GARMIN_PASSWORD")
        token_path = os.getenv("GARMIN_TOKEN_PATH", os.getenv("GARMIN_TOKENS", ".garmin_tokens/garmin_tokens.json")).strip()
        store_type = os.getenv("GARMIN_TOKEN_STORE", "local").strip().lower()
        bucket = os.getenv("GARMIN_TOKEN_BUCKET")
        token_obj = os.getenv("GARMIN_TOKEN_OBJECT", "garmin/garmin_tokens.json")
        user_id = os.getenv("APP_USER_ID", "bootstrap_user")

        settings = Settings(
            app_user_id=user_id,
            garmin_email=email,
            garmin_password=password,
            garmin_token_path=token_path,
            garmin_token_store=store_type,
            garmin_token_bucket=bucket,
            garmin_token_object=token_obj,
            garmin_allow_credential_login=True,
        )

    token_file = Path(settings.garmin_token_path).expanduser().resolve()
    store = create_token_store(
        store_type=settings.garmin_token_store,
        local_path=settings.garmin_token_path,
        bucket_name=settings.garmin_token_bucket,
        object_name=settings.garmin_token_object,
    )

    print(f"Restoring token file using store '{settings.garmin_token_store}'...")
    store.restore(token_file)

    print("Authenticating with Garmin Connect...")
    wrapper = GarminClientWrapper(
        email=settings.garmin_email,
        password=settings.garmin_password,
        prompt_mfa=lambda: input("Garmin MFA code: "),
        allow_credential_login=True,
    )
    wrapper.login_with_tokens_or_credentials(token_file)

    print("Persisting refreshed tokens to token store...")
    store.persist(token_file)
    print("Garmin login and token persistence completed successfully!")
    return 0

if __name__ == "__main__":
    sys.exit(main())
