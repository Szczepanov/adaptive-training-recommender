"""Entry point for `python -m garmin_sync <command> [...]`."""

import sys

from .cli import main

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "migrate-user-data":
        from .migrate_user_data import main as migration_main

        sys.exit(migration_main(sys.argv[2:]))
    sys.exit(main())
