"""One-off utility: dump a real get_sleep_daily / get_hrv_data_range response so the
exact field shapes can be verified before wiring up range-based backfill (these hit a
different endpoint than the per-day get_sleep_data/get_hrv_data already parsed by
mapper.extract_sleep_metrics, and the response shape wasn't verifiable from upstream
source/tests alone -- see the "do now" Garmin upgrade work).

Usage:
    uv run python scripts/dump_range_sample.py [--days 7]

Writes sleep_daily_sample.json and hrv_range_sample.json into the current directory.
These contain your own recovery data -- do not commit them (already covered by the
repo's broad `*.json` health-data ignore patterns is NOT guaranteed, so they're also
listed explicitly in .gitignore by this script's companion change... just don't add them).
"""
import argparse
import json
import sys
from pathlib import Path
from garmin_sync.config import load_settings
from garmin_sync.dates import get_date_string, local_today, n_days_ago
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.token_store import create_token_store


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump a sample range-endpoint response for shape verification.")
    parser.add_argument("--days", type=int, default=7, help="Number of trailing days to request (default 7)")
    args = parser.parse_args()

    settings = load_settings()
    token_file = Path(settings.garmin_token_path).expanduser().resolve()

    store = create_token_store(
        store_type=settings.garmin_token_store,
        local_path=settings.garmin_token_path,
        bucket_name=settings.garmin_token_bucket,
        object_name=settings.garmin_token_object,
    )
    store.restore(token_file)

    wrapper = GarminClientWrapper(
        email=settings.garmin_email,
        password=settings.garmin_password,
        retry_attempts=settings.garmin_retry_attempts,
        retry_min_wait=settings.garmin_retry_min_wait,
        retry_max_wait=settings.garmin_retry_max_wait,
        verify_login=settings.garmin_verify_login,
        allow_credential_login=settings.garmin_allow_credential_login,
    )
    wrapper.login_with_tokens_or_credentials(token_file)
    store.persist(token_file)

    today = local_today(settings.app_timezone)
    start_iso = get_date_string(n_days_ago(today, args.days))
    end_iso = get_date_string(n_days_ago(today, 1))

    print(f"Requesting get_sleep_daily({start_iso}, {end_iso})...")
    sleep_range = wrapper.api.get_sleep_daily(start_iso, end_iso)
    Path("sleep_daily_sample.json").write_text(json.dumps(sleep_range, indent=2, default=str))
    print(f"Wrote sleep_daily_sample.json ({len(sleep_range) if isinstance(sleep_range, list) else 'non-list'} items)")

    print(f"Requesting get_hrv_data_range({start_iso}, {end_iso})...")
    hrv_range = wrapper.api.get_hrv_data_range(start_iso, end_iso)
    Path("hrv_range_sample.json").write_text(json.dumps(hrv_range, indent=2, default=str))
    print("Wrote hrv_range_sample.json")

    print("\nDone. Share the two JSON files (or their contents) back so the range-based")
    print("backfill mapping can be implemented against the real shape.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
