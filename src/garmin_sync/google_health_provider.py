"""Google Health Wearable/Recovery Provider (MS3/MS6/ADR-0027).

Implements the RecoveryObservationProvider protocol to fetch raw health data points
from Google Health API and return canonical ObservationBatch objects.
"""

import logging
from datetime import datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .canonical import ObservationBatch
from .google_health_client import GoogleHealthClient
from .google_health_mapper import GoogleHealthMapper

logger = logging.getLogger(__name__)

WARSAW_TZ = ZoneInfo("Europe/Warsaw")

# Standard data types to query for recovery observations
RECOVERY_DATA_TYPES = [
    "sleep",
    "daily-heart-rate-variability",
    "daily-resting-heart-rate",
    "daily-respiratory-rate",
]


class GoogleHealthProvider:
    """Recovery observation provider backed by Google Health API."""

    def __init__(
        self,
        client: GoogleHealthClient,
        mapper: GoogleHealthMapper,
        data_types: list[str] | None = None,
    ):
        self.client = client
        self.mapper = mapper
        self.data_types = data_types or RECOVERY_DATA_TYPES
        self._cache: dict[str, ObservationBatch] = {}

    def fetch_observations(self, logical_date_iso: str, previous_date_iso: str) -> ObservationBatch:
        """Fetch recovery observations for a logical recovery date (e.g. overnight sleep and morning readings)."""
        if logical_date_iso in self._cache:
            return self._cache[logical_date_iso]

        # Convert logical date window into UTC time interval
        # Previous evening (~18:00 Warsaw) to target date noon (~14:00 Warsaw)
        prev_dt = datetime.strptime(previous_date_iso, "%Y-%m-%d")
        curr_dt = datetime.strptime(logical_date_iso, "%Y-%m-%d")

        start_local = datetime.combine(prev_dt.date(), time(18, 0), tzinfo=WARSAW_TZ)
        end_local = datetime.combine(curr_dt.date(), time(14, 0), tzinfo=WARSAW_TZ)

        start_utc = start_local.astimezone(timezone.utc).isoformat()
        end_utc = end_local.astimezone(timezone.utc).isoformat()

        all_points: list[dict[str, Any]] = []

        for dtype in self.data_types:
            try:
                points = self.client.list_data_points(
                    data_type=dtype,
                    start_time_iso=start_utc,
                    end_time_iso=end_utc,
                )
                all_points.extend(points)
            except Exception as e:
                logger.warning(
                    "Failed to query Google Health data type '%s' for %s: %s",
                    dtype,
                    logical_date_iso,
                    e,
                )

        batch = self.mapper.normalize_data_points(all_points, target_logical_date=logical_date_iso)
        self._cache[logical_date_iso] = batch
        return batch

    def clear_cache(self) -> None:
        """Clear internal cache between runs."""
        self._cache.clear()
