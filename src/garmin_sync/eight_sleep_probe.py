"""Sanitized local direct Eight Sleep probe; never prints secrets or health values."""

import argparse
import json
from datetime import date, timedelta

from garmin_sync.eight_sleep_client import EightSleepClient
from garmin_sync.eight_sleep_config import EightSleepSettings
from garmin_sync.eight_sleep_mapper import map_trends_to_observation_batch, summarize_trends_shape


def main() -> int:
    from dotenv import load_dotenv

    # This entry point doesn't otherwise call load_settings()/load_dotenv() before
    # resolving credentials, so a repo-root .env would silently be ignored without this
    # explicit load (mirrors _resolve_google_health_auth_manager's Google Health path).
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    target = date.fromisoformat(args.date)
    settings = EightSleepSettings.from_env()
    client = EightSleepClient(settings)
    payload = client.get_trends(
        from_date=(target - timedelta(days=1)).isoformat(),
        to_date=(target + timedelta(days=1)).isoformat(),
        timezone=settings.timezone,
    )
    batch = map_trends_to_observation_batch(
        payload, logical_date=target.isoformat(), timezone=settings.timezone
    )
    shape = summarize_trends_shape(payload)
    print(
        json.dumps(
            {
                "authenticated": True,
                "targetDate": target.isoformat(),
                "returnedDayCount": shape["dayCount"],
                "availableFields": shape["availableFields"],
                "canonicalMetrics": sorted({o.metric for o in batch.observations}),
                "targetObservationCount": len(batch.observations),
                "provider": "eight_sleep",
                "transport": "eight_sleep_direct",
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
