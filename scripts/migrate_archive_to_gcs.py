"""
Migrate local .garmin_archive raw payloads and metadata to Google Cloud Storage.
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from google.cloud import storage

from garmin_sync.config import load_settings


def migrate_file(
    bucket: Any,
    archive_root: Path,
    gz_path: Path,
) -> tuple[str, bool, str | None]:
    rel_path = gz_path.relative_to(archive_root).as_posix()
    blob = bucket.blob(rel_path)

    # Check companion metadata file
    meta_path = gz_path.with_name(gz_path.stem.split(".")[0] + ".meta.json")
    if not meta_path.exists():
        # Fallback to companion name replacing .json.gz with .meta.json
        meta_path = gz_path.parent / (gz_path.name[:-8] + ".meta.json")

    metadata: dict[str, str] = {}
    if meta_path.exists():
        try:
            raw_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            metadata = {str(k): str(v) if v is not None else "" for k, v in raw_meta.items()}
        except Exception:
            pass

    # If missing metadata, derive from path: raw/garmin/{endpoint}/{year}/{month}/{logical_date}/{sync_run_id}.json.gz
    if not metadata:
        parts = rel_path.split("/")
        if len(parts) >= 6:
            endpoint = parts[2]
            logical_date = parts[5]
            sync_run_id = parts[6].split(".")[0]
            metadata = {
                "provider": "garmin_connect_unofficial",
                "endpoint": endpoint,
                "logicalDate": logical_date,
                "syncRunId": sync_run_id,
            }

    blob.metadata = metadata
    blob.content_encoding = "gzip"

    with open(gz_path, "rb") as f:
        data = f.read()

    blob.upload_from_string(data, content_type="application/json")
    return rel_path, True, None


def main():
    parser = argparse.ArgumentParser(description="Migrate local archive to GCS.")
    parser.add_argument(
        "--bucket",
        type=str,
        default=None,
        help="Target GCS bucket name (default from settings: GARMIN_ARCHIVE_BUCKET)",
    )
    parser.add_argument(
        "--source-dir",
        type=str,
        default=".garmin_archive",
        help="Local archive root directory (default: .garmin_archive)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=32,
        help="Number of concurrent upload worker threads (default: 32)",
    )
    args = parser.parse_args()

    settings = load_settings()
    bucket_name = args.bucket or settings.resolved_archive_bucket()
    if not bucket_name:
        print("Error: Target bucket name not provided and not set in environment.")
        sys.exit(1)

    archive_root = Path(args.source_dir).expanduser().resolve()
    if not archive_root.exists():
        print(f"Error: Source directory '{archive_root}' does not exist.")
        sys.exit(1)

    print(f"Scanning '{archive_root}' for .json.gz archive files...")
    gz_files = list(archive_root.glob("**/*.json.gz"))
    total_files = len(gz_files)
    print(f"Found {total_files} archive files to migrate.")

    if total_files == 0:
        print("Nothing to migrate.")
        return

    print(f"Uploading to gs://{bucket_name}/ using {args.workers} worker threads...")
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    start_time = time.time()
    uploaded = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(migrate_file, bucket, archive_root, gz): gz for gz in gz_files}

        for future in as_completed(futures):
            gz = futures[future]
            try:
                rel_path, ok, err = future.result()
                uploaded += 1
            except Exception as e:
                failed += 1
                print(f"Failed to upload {gz.name}: {e}")

            if (uploaded + failed) % 1000 == 0 or (uploaded + failed) == total_files:
                elapsed = time.time() - start_time
                rate = (uploaded + failed) / elapsed if elapsed > 0 else 0
                pct = ((uploaded + failed) / total_files) * 100
                print(
                    f"Progress: {uploaded + failed}/{total_files} ({pct:.1f}%) - "
                    f"{rate:.1f} files/sec - Elapsed: {elapsed:.1f}s"
                )

    elapsed = time.time() - start_time
    print(f"\nMigration finished in {elapsed:.1f}s! Uploaded: {uploaded}, Failed: {failed}.")


if __name__ == "__main__":
    main()
