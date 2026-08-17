import argparse
import logging
import sys

from .audit import format_report, run_audit
from .config import load_settings
from .service import GarminSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_sync")


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
        success = service.sync_daily(
            target_date_str=parsed_args.date,
            force=parsed_args.force,
            resync_lookback_days=parsed_args.resync_days,
        )
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Daily sync execution error: {type(e).__name__}")
        return 1


def run_backfill(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run historical Garmin backfill.")
    parser.add_argument(
        "--days", type=int, default=56, help="Number of days to backfill (default 56)"
    )
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Force re-fetching existing records")
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = service.backfill(
            days=parsed_args.days,
            start_date_str=parsed_args.start_date,
            end_date_str=parsed_args.end_date,
            force=parsed_args.force,
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
        success = service.push_workout(date_str=parsed_args.date)
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Push workout execution error: {type(e).__name__}: {e}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Garmin Sync Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Sync subcommand
    sync_parser = subparsers.add_parser("sync", help="Run daily sync")
    sync_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_parser.add_argument("--force", action="store_true", help="Force refresh")
    sync_parser.add_argument(
        "--resync-days",
        type=int,
        default=None,
        help="Days before --date to also force-resync (default GARMIN_RESYNC_LOOKBACK_DAYS, normally 1)",
    )

    # Backfill subcommand
    backfill_parser = subparsers.add_parser("backfill", help="Run historical backfill")
    backfill_parser.add_argument("--days", type=int, default=56, help="Number of days to backfill")
    backfill_parser.add_argument(
        "--start-date", type=str, default=None, help="Start date YYYY-MM-DD"
    )
    backfill_parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    backfill_parser.add_argument("--force", action="store_true", help="Force re-fetch")

    # Audit subcommand
    audit_parser = subparsers.add_parser("audit", help="Report sync completeness")
    audit_parser.add_argument(
        "--days", type=int, default=90, help="Number of trailing days to audit"
    )
    audit_parser.add_argument(
        "--end-date", type=str, default=None, help="End date YYYY-MM-DD (default local today)"
    )

    # Rebuild subcommand
    rebuild_parser = subparsers.add_parser(
        "rebuild", help="Rebuild snapshots from the raw archive, offline"
    )
    rebuild_parser.add_argument(
        "--start-date", type=str, required=True, help="Start date YYYY-MM-DD"
    )
    rebuild_parser.add_argument("--end-date", type=str, required=True, help="End date YYYY-MM-DD")

    # Push-workout subcommand
    push_workout_parser = subparsers.add_parser(
        "push-workout", help="Upload and schedule a queued structured workout to Garmin Connect"
    )
    push_workout_parser.add_argument(
        "--date", type=str, default=None, help="Target date YYYY-MM-DD (default local today)"
    )

    args = parser.parse_args()

    if args.command == "sync":
        return run_daily_sync(sys.argv[2:])
    elif args.command == "backfill":
        return run_backfill(sys.argv[2:])
    elif args.command == "audit":
        return run_audit_cmd(sys.argv[2:])
    elif args.command == "rebuild":
        return run_rebuild_cmd(sys.argv[2:])
    elif args.command == "push-workout":
        return run_push_workout_cmd(sys.argv[2:])
    return 1


if __name__ == "__main__":
    sys.exit(main())
