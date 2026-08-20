"""
Helper utility to authenticate Garmin credentials locally and upload initial token JSON file to GCS.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Callable

from garmin_sync.config import load_settings
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.token_store import GcsTokenStore


def _mfa_prompt() -> Callable[[], str]:
    """Prefers a live-computed TOTP code over one typed in advance.

    A code entered ahead of time (e.g. as a CI workflow input) can expire before this
    point is ever reached -- checkout, auth, dependency install all happen first. When
    GARMIN_TOTP_SECRET (the authenticator app's base32 shared secret, not a single code)
    is set, the code is generated at the exact moment Garmin actually asks for one, which
    eliminates that race entirely. Falls back to a pre-supplied GARMIN_MFA_CODE (piped
    stdin in CI, or a plain prompt locally) when no TOTP secret is configured.
    """
    totp_secret = os.getenv("GARMIN_TOTP_SECRET")
    if totp_secret:
        import pyotp

        totp = pyotp.TOTP(totp_secret)
        return lambda: totp.now()

    pre_supplied = os.getenv("GARMIN_MFA_CODE")
    if pre_supplied:
        return lambda: pre_supplied
    return lambda: input("Garmin MFA code: ")


def bootstrap(bucket_name: str | None = None, object_name: str = "garmin/garmin_tokens.json"):
    settings = load_settings()
    local_file = Path(settings.garmin_token_path).expanduser().resolve()

    print(f"Authenticating Garmin account ({settings.garmin_email})...")
    wrapper = GarminClientWrapper(
        email=settings.garmin_email,
        password=settings.garmin_password,
        prompt_mfa=_mfa_prompt(),
        allow_credential_login=True,
    )
    wrapper.login_with_tokens_or_credentials(local_file)

    bucket = bucket_name or settings.garmin_token_bucket
    if not bucket:
        print(f"Tokens saved locally to '{local_file}'. No GCS bucket provided; skipping upload.")
        return

    print(f"Uploading token file to gs://{bucket}/{object_name}...")
    gcs_store = GcsTokenStore(bucket_name=bucket, object_name=object_name)
    gcs_store.persist(local_file)
    print("Token bootstrap completed successfully!")


def main():
    parser = argparse.ArgumentParser(description="Bootstrap Garmin OAuth tokens to GCS.")
    parser.add_argument(
        "--bucket", type=str, default=None, help="GCS bucket name for token storage"
    )
    parser.add_argument(
        "--object", type=str, default="garmin/garmin_tokens.json", help="GCS object name"
    )
    args = parser.parse_args()

    try:
        bootstrap(bucket_name=args.bucket, object_name=args.object)
    except Exception as e:
        print(f"Bootstrap failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
