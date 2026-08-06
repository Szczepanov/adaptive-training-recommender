"""CLI script to refresh/bootstrap Garmin OAuth tokens safely."""
import os
import sys
from pathlib import Path
from garmin_sync.config import load_settings
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
        token_dir = os.getenv("GARMIN_TOKENS", ".garth")
        store_type = os.getenv("GARMIN_TOKEN_STORE", "local")
        bucket = os.getenv("GARMIN_TOKEN_BUCKET")
        token_obj = os.getenv("GARMIN_TOKEN_OBJECT", "garmin_tokens.tar.gz")
        user_id = os.getenv("APP_USER_ID", "bootstrap_user")

        from garmin_sync.config import Settings
        settings = Settings(
            app_user_id=user_id,
            garmin_email=email,
            garmin_password=password,
            garmin_tokens=token_dir,
            garmin_token_store=store_type,
            garmin_token_bucket=bucket,
            garmin_token_object=token_obj,
        )

    token_dir = Path(settings.garmin_tokens).expanduser().resolve()
    store = create_token_store(
        store_type=settings.garmin_token_store,
        local_dir=settings.garmin_tokens,
        bucket_name=settings.garmin_token_bucket,
        object_name=settings.garmin_token_object,
    )

    print(f"Restoring tokens using store '{settings.garmin_token_store}'...")
    store.restore(token_dir)

    print("Authenticating with Garmin Connect...")
    wrapper = GarminClientWrapper(
        email=settings.garmin_email,
        password=settings.garmin_password,
    )
    wrapper.login_with_tokens_or_credentials(token_dir)

    print("Persisting refreshed tokens to token store...")
    wrapper.dump_tokens(token_dir)
    store.persist(token_dir)
    print("Garmin login and token persistence completed successfully!")
    return 0

if __name__ == "__main__":
    sys.exit(main())
