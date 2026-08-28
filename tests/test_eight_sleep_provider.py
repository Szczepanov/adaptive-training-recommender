import pytest

from garmin_sync.eight_sleep_client import EightSleepApiError
from garmin_sync.eight_sleep_provider import EightSleepDirectProvider


class FakeClient:
    def __init__(self, payload: object | None = None, error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error
        self.calls = []
        self.cleared = 0

    def get_trends(self, *, from_date: str, to_date: str, timezone: str) -> object:
        self.calls.append((from_date, to_date, timezone))
        if self.error:
            raise self.error
        return self.payload

    def clear_token(self) -> None:
        self.cleared += 1


def test_provider_caches_success() -> None:
    c = FakeClient(
        {
            "days": [
                {
                    "day": "2026-08-28",
                    "presenceStart": "2026-08-27T22:00:00+02:00",
                    "sleepDurationSeconds": 27000,
                }
            ]
        }
    )
    p = EightSleepDirectProvider(c)  # type: ignore[arg-type]
    assert (
        p.fetch_observations("2026-08-28", "2026-08-27")
        is p.fetch_observations("2026-08-28", "2026-08-27")
        and len(c.calls) == 1
    )


def test_provider_propagates_failure() -> None:
    p = EightSleepDirectProvider(FakeClient(error=EightSleepApiError("down")))  # type: ignore[arg-type]
    with pytest.raises(EightSleepApiError):
        p.fetch_observations("2026-08-28", "2026-08-27")
