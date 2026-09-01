from datetime import date

import pytest


@pytest.fixture(autouse=True)
def _freeze_sync_service_fixture_clock(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """Keep sync-service tests with fixed 2026 fixture dates deterministic.

    Several tests in test_sync_service.py intentionally use August/September 2026
    dates. Production rejects queued workouts older than 14 days, so allowing those
    fixtures to depend on the wall clock makes the suite fail simply because time
    passes. Freeze the service's local calendar for that module instead of moving the
    fixture dates forward whenever CI crosses the cutoff.
    """
    if request.path.name != "test_sync_service.py":
        return

    monkeypatch.setattr(
        "garmin_sync.service.local_today",
        lambda _timezone: date(2026, 9, 1),
    )
