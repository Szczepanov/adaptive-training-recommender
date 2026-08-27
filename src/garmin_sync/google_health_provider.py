"""Google Health Wearable/Recovery Provider (MS3/MS6/ADR-0027).

Implements the RecoveryObservationProvider protocol to fetch raw health data points
from Google Health API and return canonical ObservationBatch objects.
"""

import logging
from typing import Any
from zoneinfo import ZoneInfo

from .canonical import ObservationBatch
from .google_health_client import GoogleHealthClient
from .google_health_mapper import (
    GoogleHealthMapper,
    derive_warsaw_logical_date,
    parse_iso_datetime,
)

logger = logging.getLogger(__name__)

WARSAW_TZ = ZoneInfo("Europe/Warsaw")

# Standard data types to query for recovery observations
RECOVERY_DATA_TYPES = [
    "sleep",
    "daily-heart-rate-variability",
    "daily-resting-heart-rate",
    "daily-respiratory-rate",
]


def _extract_pt_date(pt: dict[str, Any]) -> str | None:
    """Extract Warsaw logical date from either sub-object date dict or session timestamps."""
    for key in ("dailyHeartRateVariability", "dailyRestingHeartRate", "dailyRespiratoryRate"):
        d = pt.get(key, {}).get("date")
        if d and isinstance(d, dict) and "year" in d:
            return f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}"

    session = pt.get("sleepSession", {}) or {}
    end_str = session.get("endTime") or pt.get("endTime")
    start_str = session.get("startTime") or pt.get("startTime")
    if end_str or start_str:
        end_dt = parse_iso_datetime(end_str)
        start_dt = parse_iso_datetime(start_str)
        return derive_warsaw_logical_date(end_dt, start_dt)
    return None


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
        self._raw_points_cache: dict[str, list[dict[str, Any]]] = {}

    def fetch_observations(self, logical_date_iso: str, previous_date_iso: str) -> ObservationBatch:
        """Fetch recovery observations for a logical recovery date (e.g. overnight sleep and morning readings)."""
        if logical_date_iso in self._cache:
            return self._cache[logical_date_iso]

        all_points: list[dict[str, Any]] = []

        for dtype in self.data_types:
            try:
                if dtype not in self._raw_points_cache:
                    self._raw_points_cache[dtype] = self.client.list_data_points(data_type=dtype)

                raw_pts = self._raw_points_cache[dtype]
                for pt in raw_pts:
                    pt_date = _extract_pt_date(pt)
                    if pt_date == logical_date_iso:
                        all_points.append(pt)

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
        self._raw_points_cache.clear()
