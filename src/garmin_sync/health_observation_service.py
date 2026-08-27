"""Health observation sync and persistence service (MS7/MS8/ADR-0027).

Orchestrates multi-source recovery observation ingestion, immutable raw archiving,
and idempotent Firestore day-source bundle persistence with repair sync.
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from .archive import RawArchiveStore, compute_observation_id
from .canonical import CanonicalHealthObservation
from .firestore_repository import FirestoreRecoveryRepository
from .models import HealthObservationDayBundle, HealthObservationDTO
from .provider import RecoveryObservationProvider

logger = logging.getLogger(__name__)


def observation_to_dto(
    user_id: str,
    obs: CanonicalHealthObservation,
) -> HealthObservationDTO:
    """Convert CanonicalHealthObservation to persisted HealthObservationDTO with deterministic ID."""
    obs_id = compute_observation_id(
        user_id=user_id,
        provider=obs.source.provider,
        transport=obs.source.transport,
        metric=obs.metric,
        source_record_id=obs.source.source_record_id,
        observed_start=obs.observed_start.isoformat() if obs.observed_start else None,
        observed_end=obs.observed_end.isoformat() if obs.observed_end else None,
        payload_content=obs.value,
    )

    return HealthObservationDTO(
        observationId=obs_id,
        metric=obs.metric,
        value=obs.value,
        unit=obs.unit,
        sourceRecordId=obs.source.source_record_id,
        observedStart=obs.observed_start.isoformat() if obs.observed_start else None,
        observedEnd=obs.observed_end.isoformat() if obs.observed_end else None,
        originApplication=obs.source.origin_application,
        originDevice=obs.source.origin_device,
        quality=obs.quality,
        semanticVersion=obs.semantic_version,
    )


class HealthObservationService:
    """Service orchestrating recovery observation ingestion and persistence."""

    def __init__(
        self,
        user_id: str,
        repository: FirestoreRecoveryRepository,
        archive_store: RawArchiveStore,
        providers: dict[str, RecoveryObservationProvider] | None = None,
    ):
        self.user_id = user_id
        self.repository = repository
        self.archive_store = archive_store
        self.providers = providers or {}

    def register_provider(self, name: str, provider: RecoveryObservationProvider) -> None:
        """Register a recovery observation provider."""
        self.providers[name] = provider

    def sync_date(
        self,
        logical_date_iso: str,
        previous_date_iso: str | None = None,
    ) -> dict[str, Any]:
        """Ingest and persist observations for one logical date from all registered providers."""
        if not previous_date_iso:
            curr_dt = datetime.strptime(logical_date_iso, "%Y-%m-%d")
            previous_date_iso = (curr_dt - timedelta(days=1)).strftime("%Y-%m-%d")

        results: dict[str, Any] = {}

        for provider_name, provider in self.providers.items():
            try:
                batch = provider.fetch_observations(logical_date_iso, previous_date_iso)
                if not batch.observations:
                    logger.info(
                        "No observations returned by %s for %s.", provider_name, logical_date_iso
                    )
                    results[provider_name] = {"status": "empty", "observations": 0}
                    continue

                # Convert to DTOs
                dtos = [observation_to_dto(self.user_id, o) for o in batch.observations]

                # Determine effective provider & transport from first observation or provider name
                obs_provider = batch.observations[0].source.provider
                obs_transport = batch.observations[0].source.transport

                bundle = HealthObservationDayBundle(
                    userId=self.user_id,
                    logicalDate=logical_date_iso,
                    provider=obs_provider,
                    transport=obs_transport,
                    observations=dtos,
                    sourcePayloadHash=batch.source_payload_hash,
                    rawArchiveRef=batch.raw_archive_ref,
                    schemaVersion=batch.schema_version,
                    normalizerVersion=batch.normalizer_version,
                    revision=batch.revision,
                )

                changed, revision = self.repository.save_health_observation_day_bundle(bundle)
                results[provider_name] = {
                    "status": "saved" if changed else "unchanged",
                    "observations": len(dtos),
                    "revision": revision,
                }
            except Exception as e:
                logger.error(
                    "Error syncing observations from %s for %s: %s",
                    provider_name,
                    logical_date_iso,
                    e,
                )
                results[provider_name] = {"status": "error", "error": str(e)}

        return results

    def sync_repair(
        self,
        target_date_iso: str,
        days_lookback: int = 3,
    ) -> list[dict[str, Any]]:
        """Run scheduled repair sync for [target_date - days_lookback, target_date]."""
        target_dt = datetime.strptime(target_date_iso, "%Y-%m-%d")
        summary: list[dict[str, Any]] = []

        for i in range(days_lookback + 1):
            date_dt = target_dt - timedelta(days=i)
            date_iso = date_dt.strftime("%Y-%m-%d")
            prev_iso = (date_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            date_result = self.sync_date(date_iso, prev_iso)
            summary.append({"date": date_iso, "results": date_result})

        return summary
