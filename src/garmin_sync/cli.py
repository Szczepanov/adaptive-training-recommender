import argparse
import sys
import logging
from .config import load_settings
from .service import GarminSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_sync")


def run_daily_sync(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run daily Garmin recovery ingestion.")
    parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD (default local today in Warsaw)")
    parser.add_argument("--force", action="store_true", help="Force refresh even if snapshot is fresh")
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = service.sync_daily(target_date_str=parsed_args.date, force=parsed_args.force)
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Daily sync execution error: {e}")
        return 1


def run_backfill(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run historical Garmin backfill.")
    parser.add_argument("--days", type=int, default=56, help="Number of days to backfill (default 56)")
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
        logger.error(f"Backfill execution error: {e}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Garmin Sync Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Sync subcommand
    sync_parser = subparsers.add_parser("sync", help="Run daily sync")
    sync_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_parser.add_argument("--force", action="store_true", help="Force refresh")

    # Backfill subcommand
    backfill_parser = subparsers.add_parser("backfill", help="Run historical backfill")
    backfill_parser.add_argument("--days", type=int, default=56, help="Number of days to backfill")
    backfill_parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    backfill_parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    backfill_parser.add_argument("--force", action="store_true", help="Force re-fetch")

    args = parser.parse_args()

    if args.command == "sync":
        return run_daily_sync(sys.argv[2:])
    elif args.command == "backfill":
        return run_backfill(sys.argv[2:])
    return 1


if __name__ == "__main__":
    sys.exit(main())
