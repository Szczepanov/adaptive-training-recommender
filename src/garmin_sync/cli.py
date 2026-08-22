import argparse
import logging
import sys
from collections.abc import Callable

from .account_link import list_active_garmin_user_ids
from .audit import format_report, run_audit
from .config import load_settings, load_settings_for_user
from .coordination import GarminExecutionLease
from .service import GarminSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_sync")


def _run_with_user_lease(
    operation_name: str,
    service: GarminSyncService,
    operation: Callable[[GarminSyncService], bool],
) -> bool:
    """Run one Garmin operation while holding the shared per-user Firestore lease.

    A busy lease is a successful no-op: another process is already doing Garmin work for
    this user, and the next scheduled tick will pick up anything still pending. Lease release
    errors intentionally propagate so Cloud Run records a failure instead of silently leaving
    the user blocked until expiry.
    """
    lease = GarminExecutionLease(
        service.repository.db,
        service.settings.app_user_id,
        operation_name,
    )
    if not lease.acquire():
        logger.info("%s: skipped because another Garmin operation is already running", operation_name)
        return True

    try:
        return operation(service)
    finally:
        lease.release()


def _run_for_all_users(operation_name: str, operation: Callable[[GarminSyncService], bool]) -> int:
    """Run a scheduled operation for every active self-service Garmin link.

    Users are discovered from the server-only garminConnections collection and processed
    sequentially to isolate Garmin sessions and avoid multiplying API pressure. Each user
    also gets a durable Firestore lease, so separate Cloud Run executions cannot overlap
    sync/manual-sync/workout work for that same Garmin account. A failure for one user does
    not prevent later users from running, but the process returns non-zero so Cloud
    Run/Scheduler records a partial failure.
    """
    try:
        user_ids = list_active_garmin_user_ids()
    except Exception as e:
        logger.error("%s linked-user discovery error: %s", operation_name, type(e).__name__)
        return 1

    if not user_ids:
        logger.info("%s: no active Garmin links; nothing to do", operation_name)
        return 0

    failed_count = 0
    for index, uid in enumerate(user_ids, start=1):
        try:
            logger.info("%s: starting linked user %d/%d", operation_name, index, len(user_ids))
            settings = load_settings_for_user(uid)
            service = GarminSyncService(settings)
            if not _run_with_user_lease(operation_name, service, operation):
                failed_count += 1
                logger.error("%s: unsuccessful linked user %d", operation_name, index)
            else:
                logger.info("%s: complete linked user %d", operation_name, index)
        except Exception as e:
            failed_count += 1
            logger.error(
                "%s: error linked user %d type=%s",
                operation_name,
                index,
                type(e).__name__,
            )

    if failed_count:
        logger.error(
            "%s failed for %d/%d linked users",
            operation_name,
            failed_count,
            len(user_ids),
        )
        return 1
    return 0


def run_daily_sync(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run daily Garmin recovery ingestion.")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date YYYY-MM-DD (default local today in Warsaw)",
    )
    parser.add_argument(
        "--force", action="store_true", help="Force refresh even if snapshot is fresh"
    )
    parser.add_argument(
        "--resync-days",
        type=int,
        default=None,
        help="Days before --date to also force-resync (default GARMIN_RESYNC_LOOKBACK_DAYS, normally 1). "
        "Picks up late-arriving Garmin data for prior days, e.g. a training session logged after that day's own sync ran.",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "daily sync",
            service,
            lambda current_service: current_service.sync_daily(
                target_date_str=parsed_args.date,
                force=parsed_args.force,
                resync_lookback_days=parsed_args.resync_days,
            ),
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Daily sync execution error: {type(e).__name__}")
        return 1


def run_daily_sync_all(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run daily Garmin ingestion for linked users.")
    parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Force refresh")
    parser.add_argument("--resync-days", type=int, default=None)
    parsed_args = parser.parse_args(args)
    return _run_for_all_users(
        "daily sync",
        lambda service: service.sync_daily(
            target_date_str=parsed_args.date,
            force=parsed_args.force,
            resync_lookback_days=parsed_args.resync_days,
        ),
    )


def run_backfill(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run historical Garmin backfill.")
    parser.add_argument(
        "--days", type=int, default=56, help="Number of days to backfill (default 56)"
    )
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Force re-fetching existing records")
    parser.add_argument(
        "--include-details",
        action="store_true",
        help="Also fetch and persist power/HR zones and lap details for qualifying activities",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "backfill",
            service,
            lambda current_service: current_service.backfill(
                days=parsed_args.days,
                start_date_str=parsed_args.start_date,
                end_date_str=parsed_args.end_date,
                force=parsed_args.force,
                include_details=parsed_args.include_details,
            ),
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Backfill execution error: {type(e).__name__}")
        return 1


def run_audit_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Report Garmin sync completeness (GarminDB-style audit)."
    )
    parser.add_argument(
        "--days", type=int, default=90, help="Number of trailing days to audit (default 90)"
    )
    parser.add_argument(
        "--end-date", type=str, default=None, help="End date YYYY-MM-DD (default local today)"
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        report = run_audit(
            settings,
            service.repository,
            service.archive_store,
            days=parsed_args.days,
            end_date_str=parsed_args.end_date,
        )
        print(format_report(report))
        return 0
    except Exception as e:
        logger.error(f"Audit execution error: {type(e).__name__}")
        return 1


def run_rebuild_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild Firestore snapshots from the raw archive, offline (no Garmin calls)."
    )
    parser.add_argument("--start-date", type=str, required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, required=True, help="End date YYYY-MM-DD")
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = service.rebuild(parsed_args.start_date, parsed_args.end_date)
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Rebuild execution error: {type(e).__name__}")
        return 1


def run_push_workout_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Upload and schedule a queued structured workout to Garmin Connect."
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date YYYY-MM-DD (default local today in Warsaw)",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "push workout",
            service,
            lambda current_service: current_service.push_workout(date_str=parsed_args.date),
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Push workout execution error: {type(e).__name__}: {e}")
        return 1


def run_push_pending_workouts_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Poll the Firestore workout queue and push every pending item to Garmin Connect."
    )
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=14,
        help="Leave (don't push) queue items older than this many days pending (default 14)",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "push pending workouts",
            service,
            lambda current_service: current_service.push_pending_workouts(
                max_age_days=parsed_args.max_age_days
            ),
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Push pending workouts execution error: {type(e).__name__}: {e}")
        return 1


def run_push_pending_workouts_all_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Push pending workouts for linked users.")
    parser.add_argument("--max-age-days", type=int, default=14)
    parsed_args = parser.parse_args(args)
    return _run_for_all_users(
        "push pending workouts",
        lambda service: service.push_pending_workouts(max_age_days=parsed_args.max_age_days),
    )


def run_poll_manual_sync_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Poll for a manual 'Sync Now' request from the web app and run an "
        "immediate forced sync if one is pending."
    )
    parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "poll manual sync",
            service,
            lambda current_service: current_service.poll_manual_sync_requests(),
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Poll manual sync execution error: {type(e).__name__}: {e}")
        return 1


def run_poll_manual_sync_all_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Poll manual sync requests for linked users.")
    parser.parse_args(args)
    return _run_for_all_users(
        "poll manual sync", lambda service: service.poll_manual_sync_requests()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Garmin Sync Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser("sync", help="Run daily sync for APP_USER_ID")
    sync_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_parser.add_argument("--force", action="store_true", help="Force refresh")
    sync_parser.add_argument("--resync-days", type=int, default=None)

    sync_all_parser = subparsers.add_parser(
        "sync-all", help="Run daily sync for every active Garmin link"
    )
    sync_all_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_all_parser.add_argument("--force", action="store_true", help="Force refresh")
    sync_all_parser.add_argument("--resync-days", type=int, default=None)

    backfill_parser = subparsers.add_parser("backfill", help="Run historical backfill")
    backfill_parser.add_argument("--days", type=int, default=56, help="Number of days to backfill")
    backfill_parser.add_argument(
        "--start-date", type=str, default=None, help="Start date YYYY-MM-DD"
    )
    backfill_parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    backfill_parser.add_argument("--force", action="store_true", help="Force re-fetch")
    backfill_parser.add_argument("--include-details", action="store_true")

    audit_parser = subparsers.add_parser("audit", help="Report sync completeness")
    audit_parser.add_argument("--days", type=int, default=90)
    audit_parser.add_argument("--end-date", type=str, default=None)

    rebuild_parser = subparsers.add_parser("rebuild", help="Rebuild snapshots from raw archive")
    rebuild_parser.add_argument("--start-date", type=str, required=True)
    rebuild_parser.add_argument("--end-date", type=str, required=True)

    push_workout_parser = subparsers.add_parser("push-workout", help="Push one queued workout")
    push_workout_parser.add_argument("--date", type=str, default=None)

    push_pending_parser = subparsers.add_parser(
        "push-pending-workouts", help="Push pending workouts for APP_USER_ID"
    )
    push_pending_parser.add_argument("--max-age-days", type=int, default=14)

    push_pending_all_parser = subparsers.add_parser(
        "push-pending-workouts-all", help="Push pending workouts for every active Garmin link"
    )
    push_pending_all_parser.add_argument("--max-age-days", type=int, default=14)

    subparsers.add_parser("poll-manual-sync", help="Poll manual sync for APP_USER_ID")
    subparsers.add_parser(
        "poll-manual-sync-all", help="Poll manual sync for every active Garmin link"
    )

    args = parser.parse_args()

    if args.command == "sync":
        return run_daily_sync(sys.argv[2:])
    if args.command == "sync-all":
        return run_daily_sync_all(sys.argv[2:])
    if args.command == "backfill":
        return run_backfill(sys.argv[2:])
    if args.command == "audit":
        return run_audit_cmd(sys.argv[2:])
    if args.command == "rebuild":
        return run_rebuild_cmd(sys.argv[2:])
    if args.command == "push-workout":
        return run_push_workout_cmd(sys.argv[2:])
    if args.command == "push-pending-workouts":
        return run_push_pending_workouts_cmd(sys.argv[2:])
    if args.command == "push-pending-workouts-all":
        return run_push_pending_workouts_all_cmd(sys.argv[2:])
    if args.command == "poll-manual-sync":
        return run_poll_manual_sync_cmd(sys.argv[2:])
    if args.command == "poll-manual-sync-all":
        return run_poll_manual_sync_all_cmd(sys.argv[2:])
    return 1


if __name__ == "__main__":
    sys.exit(main())
