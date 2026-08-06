"""
Helper utility to authenticate Garmin credentials locally and upload initial token archive to GCS.
"""
import argparse
import sys
from pathlib import Path
from garmin_sync.config import load_settings
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.token_store import GcsTokenStore, LocalTokenStore

def bootstrap(bucket_name: str | None = None, object_name: str = "garmin_tokens.tar.gz"):
    settings = load_settings()
    local_dir = Path(settings.garmin_tokens).expanduser().resolve()

    print(f"Authenticating Garmin account ({settings.garmin_email})...")
    wrapper = GarminClientWrapper(
        email=settings.garmin_email,
        password=settings.garmin_password,
    )
    wrapper.login_with_tokens_or_credentials(local_dir)
    wrapper.dump_tokens(local_dir)

    bucket = bucket_name or settings.garmin_token_bucket
    if not bucket:
        print(f"Tokens saved locally to '{local_dir}'. No GCS bucket provided; skipping upload.")
        return

    print(f"Uploading token archive to gs://{bucket}/{object_name}...")
    gcs_store = GcsTokenStore(bucket_name=bucket, object_name=object_name)
    gcs_store.persist(local_dir)
    print("Token bootstrap completed successfully!")

def main():
    parser = argparse.ArgumentParser(description="Bootstrap Garmin OAuth tokens to GCS.")
    parser.add_argument("--bucket", type=str, default=None, help="GCS bucket name for token storage")
    parser.add_argument("--object", type=str, default="garmin_tokens.tar.gz", help="GCS object name")
    args = parser.parse_args()

    try:
        bootstrap(bucket_name=args.bucket, object_name=args.object)
    except Exception as e:
        print(f"Bootstrap failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
