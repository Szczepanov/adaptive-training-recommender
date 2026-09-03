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
    ) -> None:
        self.user_id = user_id
        self.repository = repository
        self.archive_store = archive_store
        self.providers = providers or {}
        # Last-observed set of (source) transports each registered provider actually
        # produced observations under. Populated whenever a provider returns a non-empty
        # batch; used to scope reconciliation when that same provider later returns an
        # empty batch (see _reconcile_missing_sources).
        self._provider_transports: dict[str, set[str]] = {}

    def register_provider(self, name: str, provider: RecoveryObservationProvider) -> None:
        """Register a recovery observation provider."""
        self.providers[name] = provider

    def _reconcile_missing_sources(
        self,
        logical_date_iso: str,
        provider_transports: set[str],
        current_keys: set[tuple[str, str]],
    ) -> list[str]:
        """Delete previously stored day-source bundles whose (provider, transport) key
        falls under this recovery provider's own transport(s) but is absent from the
        batch just fetched -- e.g. Eight Sleep dropping out of a mixed Google Health
        batch, or a provider returning zero observations after previously reporting
        some. A stale bundle left in place would remain queryable by fusion/audit code
        even though its source no longer confirms the reading.

        Scoped strictly to `provider_transports` (this provider's own known transport
        identities) so a stored bundle written by a *different* registered provider is
        never touched just because this provider's batch didn't mention it.
        """
        if not provider_transports:
            return []

        stale_ids: list[str] = []
        keys_to_delete: list[tuple[str, str, str]] = []
        existing = self.repository.get_health_observation_bundles_in_range(
            logical_date_iso, logical_date_iso
        )

        for doc in existing:
            doc_provider = doc.get("provider")
            doc_transport = doc.get("transport")
            if not doc_provider or not doc_transport:
                continue
            key = (doc_provider, doc_transport)
            if key[1] not in provider_transports or key in current_keys:
                continue

            keys_to_delete.append((logical_date_iso, key[0], key[1]))
            stale_ids.append(f"{key[0]}_{key[1]}")

        if keys_to_delete:
            self.repository.delete_health_observation_day_bundles_batch(keys_to_delete)
            for logical_date, doc_provider, doc_transport in keys_to_delete:
                logger.info(
                    "Tombstoned stale health observation bundle %s_%s_%s: absent from "
                    "current batch for transports %s.",
                    logical_date,
                    doc_provider,
                    doc_transport,
                    sorted(provider_transports),
                )

        return stale_ids

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
                    logger.debug(
                        "No observations returned by %s for %s.", provider_name, logical_date_iso
                    )
                    reconciled = self._reconcile_missing_sources(
                        logical_date_iso,
                        provider_transports=self._provider_transports.get(provider_name, set()),
                        current_keys=set(),
                    )
                    results[provider_name] = {
                        "status": "empty",
                        "observations": 0,
                        "reconciledStale": reconciled,
                    }
                    continue

                # Group observations by (provider, transport) so that e.g. Eight Sleep and Garmin
                # within Google Health get their own separate day-source bundles.
                grouped: dict[tuple[str, str], list[CanonicalHealthObservation]] = {}
                for o in batch.observations:
                    key = (o.source.provider, o.source.transport)
                    grouped.setdefault(key, []).append(o)

                current_transports = {transport for _, transport in grouped}
                self._provider_transports[provider_name] = current_transports

                # Archive raw health observations if archive store is configured
                archive_ref = batch.raw_archive_ref
                if hasattr(self.archive_store, "archive_health"):
                    import dataclasses

                    from .archive import HealthArchiveRecord

                    try:
                        archive_rec = HealthArchiveRecord(
                            user_id=self.user_id,
                            provider=provider_name,
                            transport="bundle",
                            logical_date=logical_date_iso,
                            payload=[dataclasses.asdict(o) for o in batch.observations],
                            revision=batch.revision,
                            normalizer_version=batch.normalizer_version,
                        )
                        stored_ref = self.archive_store.archive_health(archive_rec)
                        if stored_ref:
                            archive_ref = stored_ref
                    except Exception as arch_err:
                        logger.warning("Failed to archive raw health observations: %s", arch_err)

                provider_results: dict[str, Any] = {}
                for (obs_provider, obs_transport), source_obs in grouped.items():
                    dtos = [observation_to_dto(self.user_id, o) for o in source_obs]

                    bundle = HealthObservationDayBundle(
                        userId=self.user_id,
                        logicalDate=logical_date_iso,
                        provider=obs_provider,
                        transport=obs_transport,
                        observations=dtos,
                        sourcePayloadHash=batch.source_payload_hash,
                        rawArchiveRef=archive_ref,
                        schemaVersion=batch.schema_version,
                        normalizerVersion=batch.normalizer_version,
                        revision=batch.revision,
                    )

                    changed, revision = self.repository.save_health_observation_day_bundle(bundle)
                    provider_key = f"{obs_provider}_{obs_transport}"
                    provider_results[provider_key] = {
                        "status": "saved" if changed else "unchanged",
                        "observations": len(dtos),
                        "revision": revision,
                    }

                reconciled = self._reconcile_missing_sources(
                    logical_date_iso,
                    provider_transports=current_transports,
                    current_keys=set(grouped.keys()),
                )

                results[provider_name] = {
                    "status": "success",
                    "sources": provider_results,
                    "totalObservations": len(batch.observations),
                    "reconciledStale": reconciled,
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

    def backfill_range(
        self,
        start_date_iso: str,
        end_date_iso: str,
    ) -> list[dict[str, Any]]:
        """Run historical backfill for date range [start_date_iso, end_date_iso] (inclusive)."""
        start_dt = datetime.strptime(start_date_iso, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date_iso, "%Y-%m-%d")

        if start_dt > end_dt:
            raise ValueError(f"Start date {start_date_iso} is after end date {end_date_iso}")

        summary: list[dict[str, Any]] = []
        curr_dt = start_dt

        logger.info(
            "Starting historical health observation backfill for range [%s, %s]...",
            start_date_iso,
            end_date_iso,
        )

        while curr_dt <= end_dt:
            date_iso = curr_dt.strftime("%Y-%m-%d")
            prev_iso = (curr_dt - timedelta(days=1)).strftime("%Y-%m-%d")

            date_result = self.sync_date(date_iso, prev_iso)
            summary.append({"date": date_iso, "results": date_result})
            curr_dt += timedelta(days=1)

        logger.info(
            "Completed health observation backfill: %d dates processed.",
            len(summary),
        )
        return summary
