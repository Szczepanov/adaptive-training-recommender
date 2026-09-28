"""Compatibility entry point for the canonical activity-response backfill CLI."""

from garmin_sync.cli import run_backfill_activity_response


if __name__ == "__main__":
    raise SystemExit(run_backfill_activity_response())
