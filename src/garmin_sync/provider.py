"""Provider-neutral boundary the rest of the application (GarminSyncService, and
eventually the recommendation engine) depends on instead of any single vendor's client.
A second provider (real or fake-for-tests) only needs to satisfy WearableProvider."""

from dataclasses import dataclass
from typing import Any, Protocol

from .canonical import CanonicalActivity, CanonicalDailyMetrics, CanonicalPerformanceTargets


@dataclass(frozen=True)
class ProviderCapabilities:
    daily_summary: bool = True
    sleep: bool = True
    hrv: bool = True
    activities: bool = True
    activity_details: bool = False
    body_composition: bool = False
    training_readiness: bool = False
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
class ProviderPerformanceTargetsResult:
    """Current, profile-level targets and their untouched provider payloads."""

    canonical: CanonicalPerformanceTargets
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
