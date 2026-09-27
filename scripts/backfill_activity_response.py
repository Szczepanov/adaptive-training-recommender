"""Backfill activityResponse telemetry for user activities in Firestore (issue #850).

Fetches historical cycling activities from Firestore for a given date range (default 20 days),
downloads each activity's original FIT file with safe API pacing, decodes it strictly in memory,
derives CanonicalActivityResponseTelemetry, and updates the Firestore activity document.

In-memory transient handling is enforced: raw FIT bytes are dropped immediately after decoding.
User isolation is maintained: writes only to users/{APP_USER_ID}/activities/{activityId}.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timezone
from typing import Any

from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

from garmin_sync._hr_fidelity_devices import source_evidence_from_fit_devices
from garmin_sync.activity_response import _CYCLING_TYPES, derive_activity_response
from garmin_sync.config import load_settings
from garmin_sync.dates import get_date_string, local_today, n_days_ago
from garmin_sync.fit_activity import decode_activity_original
from garmin_sync.fit_workout_identity import compute_fit_workout_fingerprint
from garmin_sync.hr_fidelity import assess_activity_hr_fidelity
from garmin_sync.mapper import serialize_activity_response, serialize_hr_measurement
from garmin_sync.service import GarminSyncService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill_activity_response")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill activityResponse telemetry for cycling activities in Firestore."
    )
    parser.add_argument(
        "--days",
        type=int,
        default=20,
        help="Number of trailing days to scan (default: 20)",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="Start date YYYY-MM-DD (overrides --days if provided with --end-date)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="End date YYYY-MM-DD (overrides --days if provided with --start-date)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-derive and update even if activityResponse already exists on document",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and derive without committing changes to Firestore",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Delay in seconds between Garmin API calls to avoid 429s (default: 2.0s)",
    )
    return parser.parse_args(argv)


def backfill_activity_response(
    days: int = 20,
    start_date: str | None = None,
    end_date: str | None = None,
    force: bool = False,
    dry_run: bool = False,
    delay: float = 2.0,
) -> int:
    settings = load_settings()
    service = GarminSyncService(settings)
    client = service._init_garmin_client()

    today = local_today(settings.app_timezone)
    if start_date and end_date:
        start_iso = start_date
        end_iso = end_date
    else:
        start_iso = get_date_string(n_days_ago(today, days))
        end_iso = get_date_string(today)

    logger.info(
        "Scanning activities for user=<UID-redacted> between %s and %s...",
        start_iso,
        end_iso,
    )
    activities = service.repository.get_activities_in_range(start_iso, end_iso)
    logger.info("Found %d total activities in range.", len(activities))

    qualifying_activities: list[dict[str, Any]] = []
    for act in activities:
        act_type = str(act.get("type", "")).strip().lower()
        if act_type not in _CYCLING_TYPES:
            continue
        if not force and "activityResponse" in act and act.get("activityResponse") is not None:
            logger.info(
                "Activity %s (%s, %s) already has activityResponse, skipping (use --force to re-process).",
                act.get("activityId"),
                act.get("date"),
                act_type,
            )
            continue
        qualifying_activities.append(act)

    logger.info(
        "Identified %d qualifying cycling activities to process.",
        len(qualifying_activities),
    )
    if not qualifying_activities:
        logger.info("No activities require backfill. Done.")
        return 0

    success_count = 0
    skipped_count = 0

    for idx, act in enumerate(qualifying_activities, start=1):
        activity_id = act.get("activityId")
        if not activity_id:
            continue
        act_id_str = str(activity_id)
        act_type = str(act.get("type", "")).strip().lower()
        act_date = str(act.get("date", ""))

        logger.info(
            "[%d/%d] Fetching original FIT for activity %s (%s, %s)...",
            idx,
            len(qualifying_activities),
            act_id_str,
            act_date,
            act_type,
        )

        try:
            raw_fit = client.download_activity_original(act_id_str)
        except GarminConnectTooManyRequestsError as err:
            logger.error("Garmin rate limit (429) hit: %s. Stopping further fetches.", err)
            break
        except GarminConnectAuthenticationError:
            logger.error("Garmin authentication error. Aborting.")
            raise
        except Exception as err:
            logger.warning("Failed to download original FIT for activity %s: %s", act_id_str, err)
            skipped_count += 1
            time.sleep(delay)
            continue

        if not raw_fit:
            logger.warning("Original FIT payload empty/missing for activity %s.", act_id_str)
            skipped_count += 1
            time.sleep(delay)
            continue

        try:
            evidence = decode_activity_original(raw_fit)
        except Exception as err:
            logger.warning("Failed to decode FIT for activity %s: %s", act_id_str, err)
            skipped_count += 1
            time.sleep(delay)
            continue
        finally:
            del raw_fit

        response = derive_activity_response(act_type, evidence)
        if response is None:
            logger.info(
                "No activityResponse derived for activity %s (insufficient records/laps).",
                act_id_str,
            )
            skipped_count += 1
            time.sleep(delay)
            continue

        updates: dict[str, Any] = {
            "activityResponse": serialize_activity_response(response),
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Also enrich hrMeasurement if missing
        if "hrMeasurement" not in act and evidence.records:
            try:
                fidelity = assess_activity_hr_fidelity(
                    act_type,
                    evidence,
                    source_evidence_from_fit_devices(evidence.devices),
                )
                updates["hrMeasurement"] = serialize_hr_measurement(fidelity.quality)
            except Exception as err:
                logger.debug("Could not assess HR fidelity: %s", err)

        # Also enrich fitWorkoutFingerprint if missing
        if (
            "fitWorkoutFingerprint" not in act
            and evidence.workout_name
            and evidence.workout_step_indices
        ):
            fp = compute_fit_workout_fingerprint(
                evidence.workout_name, evidence.workout_step_indices
            )
            if fp is not None:
                updates["fitWorkoutFingerprint"] = fp

        segment_count = len(response.segments)
        peak_count = len(response.power_duration_peaks)
        work_segments = sum(1 for s in response.segments if s.segment_type == "work")
        sprint_segments = sum(1 for s in response.segments if s.segment_type == "sprint")

        logger.info(
            "Derived activityResponse for %s: %d segments (work=%d, sprint=%d), %d MMP peaks, steadyHalves=%s",
            act_id_str,
            segment_count,
            work_segments,
            sprint_segments,
            peak_count,
            response.steady_halves is not None,
        )

        if not dry_run:
            service.repository.upsert_activity(act_id_str, updates)
            logger.info(
                "Successfully updated Firestore document users/<UID-redacted>/activities/%s",
                act_id_str,
            )
        else:
            logger.info(
                "[dry-run] Would update Firestore document users/<UID-redacted>/activities/%s",
                act_id_str,
            )

        success_count += 1
        service.token_store.persist(service.token_file_path)

        if idx < len(qualifying_activities):
            time.sleep(delay)

    logger.info(
        "Backfill completed: %d updated, %d skipped, %d total qualifying.",
        success_count,
        skipped_count,
        len(qualifying_activities),
    )
    return 0


def main() -> None:
    args = parse_args()
    sys.exit(
        backfill_activity_response(
            days=args.days,
            start_date=args.start_date,
            end_date=args.end_date,
            force=args.force,
            dry_run=args.dry_run,
            delay=args.delay,
        )
    )


if __name__ == "__main__":
    main()
