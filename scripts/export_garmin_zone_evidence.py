"""Stream a bounded, de-identified Garmin zone-evidence sample to stdout.

This is an explicit measurement command, not an ingestion or backfill path. It performs
three detail operations for at most ``--max-activities`` qualifying activities and emits
no Garmin activity IDs, real dates, HR values, credentials, or raw provider payloads.
Pipe it directly to ``app/scripts/measure-garmin-zone-credit.mjs``; do not archive its
intermediate output.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

from garminconnect import GarminConnectTooManyRequestsError

from garmin_sync.config import load_settings
from garmin_sync.dates import local_today
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.garmin_provider import GarminProviderAdapter, qualifies_for_activity_detail


def _zone_buckets(detail: Any) -> list[dict[str, float | int]] | None:
    if detail is None or detail.power_zones is None:
        return None
    return [
        {"zoneNumber": bucket.zone_number, "secondsInZone": bucket.seconds_in_zone}
        for bucket in detail.power_zones
    ]


def _laps(detail: Any) -> list[dict[str, float | int]] | None:
    if detail is None or detail.laps is None:
        return None
    return [
        {
            "lapIndex": lap.lap_index,
            "durationSeconds": lap.duration_seconds,
            **(
                {"averagePowerWatts": lap.average_power_watts}
                if lap.average_power_watts is not None
                else {}
            ),
        }
        for lap in detail.laps
    ]


def _deidentified_activity(ordinal: int, activity: Any, detail: Any) -> dict[str, Any]:
    """Return only fields required by the TypeScript comparison boundary."""
    return {
        "activityId": f"sample-{ordinal}",
        "date": "2000-01-01",
        "type": activity.type,
        "durationMin": activity.duration_min,
        "trainingEffectAerobic": activity.training_effect_aerobic,
        "trainingEffectAnaerobic": activity.training_effect_anaerobic,
        "averageHr": None,
        "activityTrainingLoad": activity.training_load,
        "intensityTag": activity.intensity_tag,
        **({"powerInZones": _zone_buckets(detail)} if _zone_buckets(detail) is not None else {}),
        **(
            {"normalizedPower": detail.normalized_power_watts}
            if detail is not None and detail.normalized_power_watts is not None
            else {}
        ),
        **(
            {"intensityFactor": detail.intensity_factor}
            if detail is not None and detail.intensity_factor is not None
            else {}
        ),
        **(
            {"variabilityIndex": detail.variability_index}
            if detail is not None and detail.variability_index is not None
            else {}
        ),
        **({"laps": _laps(detail)} if _laps(detail) is not None else {}),
    }


def export(days: int, max_activities: int) -> list[dict[str, Any]]:
    settings = load_settings()
    client = GarminClientWrapper(
        retry_attempts=settings.garmin_retry_attempts,
        retry_min_wait=settings.garmin_retry_min_wait,
        retry_max_wait=settings.garmin_retry_max_wait,
        verify_login=settings.garmin_verify_login,
    )
    client.login_with_tokens_or_credentials(Path(settings.garmin_token_path))
    provider = GarminProviderAdapter(client)
    end_date = local_today(settings.app_timezone)
    start_date = end_date - timedelta(days=days - 1)
    activities = provider.fetch_activities(start_date.isoformat(), end_date.isoformat()).canonical
    qualifying = [activity for activity in activities if qualifies_for_activity_detail(activity)]

    result: list[dict[str, Any]] = []
    for activity in qualifying[:max_activities]:
        if activity.activity_id is None:
            continue
        try:
            detail = provider.fetch_activity_detail(activity.activity_id).canonical
        except GarminConnectTooManyRequestsError:
            break
        except Exception as error:
            # De-identified: only the sample's ordinal position is logged, never the
            # activity ID or date. Without this, a transient detail-fetch failure is
            # indistinguishable from an activity that genuinely has no telemetry, which
            # would silently skew the eligible/fallback counts the measurement report relies
            # on. Logged to stderr so stdout stays valid JSON for the downstream pipe.
            print(
                f"warning: detail fetch failed for sample #{len(result) + 1}: {error}",
                file=sys.stderr,
            )
            detail = None
        result.append(_deidentified_activity(len(result) + 1, activity, detail))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=28)
    parser.add_argument("--max-activities", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.days <= 90:
        parser.error("--days must be in 1..90")
    if not 1 <= args.max_activities <= 12:
        parser.error("--max-activities must be in 1..12")
    json.dump(export(args.days, args.max_activities), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
