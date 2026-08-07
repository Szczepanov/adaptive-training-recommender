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
    except ValueError as e:
        # Handle case where APP_USER_ID is missing during initial local bootstrapping
        if "APP_USER_ID is required" in str(e):
            os.environ["APP_USER_ID"] = "bootstrap_user"
            settings = load_settings()
        else:
            raise

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
