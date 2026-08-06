"""Entry point for `python -m garmin_sync <sync|backfill> [...]`."""
import sys
from .cli import main

if __name__ == "__main__":
    sys.exit(main())
