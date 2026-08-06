"""Compatibility wrapper for daily Garmin sync pipeline."""
import sys
from garmin_sync.cli import run_daily_sync

if __name__ == "__main__":
    sys.exit(run_daily_sync())
