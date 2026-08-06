"""Compatibility wrapper for historical Garmin backfill pipeline."""
import sys
from garmin_sync.cli import run_backfill

if __name__ == "__main__":
    sys.exit(run_backfill())
