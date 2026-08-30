"""Provider-neutral boundary the rest of the application (GarminSyncService, and
eventually the recommendation engine) depends on instead of any single vendor's client.
A second provider (real or fake-for-tests) only needs to satisfy WearableProvider."""

from dataclasses import dataclass
from typing import Any, Protocol

from .canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalDailyMetrics,
    CanonicalGearItem,
    CanonicalPerformanceTargets,
    ObservationBatch,
)


@dataclass(frozen=True)
class ProviderCapabilities:
    daily_summary: bool = True
    sleep: bool = True
    hrv: bool = True
    activities: bool = True
    activity_details: bool = False
    activity_hr_fidelity: bool = False
    body_composition: bool = False
    race_predictions: bool = False
    training_readiness: bool = False
    gear_tracking: bool = False
    workout_publishing: bool = False  # no adapter in this codebase exposes mutations


@dataclass
class ProviderFetchResult:
    """Canonical output plus the raw payloads that produced it, so callers (the raw
    archive) can persist provider-specific data verbatim without the WearableProvider
    boundary itself leaking provider-specific parsing -- callers never inspect
    raw_payloads, only pass them through to archive.py."""

    canonical: CanonicalDailyMetrics
    raw_payloads: dict[
        str, Any
    ]  # keys: "stats", "stats_fallback", "sleep", "sleep_fallback", "hrv"


@dataclass
class ProviderActivitiesResult:
    canonical: list[CanonicalActivity]
    raw_payload: list[dict[str, Any]]


@dataclass
class ProviderActivityDetailResult:
    canonical: CanonicalActivityDetail
    raw_payloads: dict[str, Any]


@dataclass
class ProviderPerformanceTargetsResult:
    """Current, profile-level targets and their untouched provider payloads."""

    canonical: CanonicalPerformanceTargets
    raw_payloads: dict[str, Any]


@dataclass
class ProviderGearResult:
    """Athlete equipment and gear mileage records."""

    canonical: list[CanonicalGearItem]
    raw_payloads: dict[str, Any]


class WearableProvider(Protocol):
    capabilities: ProviderCapabilities

    def fetch_daily_metrics(
        self, target_date_iso: str, yesterday_iso: str
    ) -> ProviderFetchResult: ...

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult: ...

    def clear_cache(self) -> None:
        """Clear any internal per-date caching. GarminSyncService calls this at the
        start of each sync_daily/backfill operation so a provider instance reused
        across separate operations (e.g. two --force sync_daily calls on one service)
        never serves stale cached data from an earlier operation -- providers that
        don't cache anything can no-op."""
        ...


class RecoveryObservationProvider(Protocol):
    """Capability-specific provider boundary for source-aware recovery observations (MS3/ADR-0027).

    Google Health, Garmin, Eight Sleep, or any future source implements this protocol to
    produce standardized ObservationBatch records without needing to provide activities or profile targets.
    """

    def fetch_observations(
        self, logical_date_iso: str, previous_date_iso: str
    ) -> ObservationBatch: ...

    def clear_cache(self) -> None: ...


class ActivityProvider(Protocol):
    """Capability-specific provider boundary for workouts and recorded activities."""

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult: ...


class ProfileProvider(Protocol):
    """Capability-specific provider boundary for user performance targets and gear."""

    def fetch_performance_targets(self) -> ProviderPerformanceTargetsResult: ...

    def fetch_gear(self) -> ProviderGearResult: ...
