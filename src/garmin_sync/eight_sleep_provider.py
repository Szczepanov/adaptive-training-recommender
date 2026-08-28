"""RecoveryObservationProvider adapter for direct Eight Sleep ingestion."""

from datetime import date, timedelta

from garmin_sync.canonical import ObservationBatch
from garmin_sync.eight_sleep_client import EightSleepClient
from garmin_sync.eight_sleep_mapper import map_trends_to_observation_batch


class EightSleepDirectProvider:
    def __init__(self, client: EightSleepClient, *, timezone: str = "Europe/Warsaw") -> None:
        self.client = client
        self.timezone = timezone
        self._cache: dict[str, ObservationBatch] = {}

    def fetch_observations(self, logical_date_iso: str, previous_date_iso: str) -> ObservationBatch:
        if logical_date_iso in self._cache:
            return self._cache[logical_date_iso]
        target = date.fromisoformat(logical_date_iso)
        payload = self.client.get_trends(
            from_date=previous_date_iso,
            to_date=(target + timedelta(days=1)).isoformat(),
            timezone=self.timezone,
        )
        batch = map_trends_to_observation_batch(
            payload, logical_date=logical_date_iso, timezone=self.timezone
        )
        self._cache[logical_date_iso] = batch
        return batch

    def clear_cache(self) -> None:
        self._cache.clear()
        self.client.clear_token()
