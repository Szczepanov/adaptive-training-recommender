import importlib.metadata
import logging
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from garminconnect import GarminConnectTooManyRequestsError

from .archive import RawArchiveStore, create_archive_store
from .canonical import CanonicalActivity, CanonicalActivityDetail, CanonicalDailyMetrics
from .config import Settings
from .dates import get_date_range, get_date_string, local_today, n_days_ago, parse_date_string
from .firestore_repository import FirestoreRecoveryRepository
from .garmin_client import GarminClientWrapper
from .garmin_provider import (
    GarminProviderAdapter,
    canonicalize_activities,
    canonicalize_from_raw,
    qualifies_for_activity_detail,
)
from .mapper import build_snapshot_from_canonical, normalize_activity
from .metrics import compute_derived_metrics
from .models import DailyRecoverySnapshot
from .provider import WearableProvider
from .token_store import create_token_store

logger = logging.getLogger(__name__)


def _new_sync_run_id(target_iso: str) -> str:
    return f"{target_iso}-{uuid.uuid4().hex[:8]}"


class GarminSyncService:
    def __init__(
        self,
        settings: Settings,
        repository: FirestoreRecoveryRepository | None = None,
        garmin_client: Any | None = None,
        archive_store: RawArchiveStore | None = None,
        provider: WearableProvider | None = None,
    ):
        self.settings = settings
        self.repository = repository or FirestoreRecoveryRepository(
            user_id=settings.app_user_id,
            collection_name=settings.firestore_recovery_collection,
            db=None,
            credentials_path=settings.firebase_credentials_path,
        )
        self.garmin_client = garmin_client
        self.provider = provider
        self.token_store = create_token_store(
            store_type=settings.garmin_token_store,
            local_path=settings.garmin_token_path,
            bucket_name=settings.garmin_token_bucket,
            object_name=settings.garmin_token_object,
        )
        self.token_file_path = Path(settings.garmin_token_path).expanduser().resolve()
        self.archive_store = archive_store or create_archive_store(
            enabled=settings.garmin_archive_enabled,
            store_type=settings.garmin_archive_store,
            local_dir=settings.garmin_archive_local_dir,
            bucket_name=settings.resolved_archive_bucket(),
            prefix=settings.garmin_archive_prefix,
        )
        try:
            self.garminconnect_version: str | None = importlib.metadata.version("garminconnect")
        except Exception:
            self.garminconnect_version = None

    def _init_garmin_client(self) -> GarminClientWrapper:
        if self.garmin_client is not None:
            return self.garmin_client

        logger.info(
            f"Restoring Garmin tokens via store backend '{self.settings.garmin_token_store}'..."
        )
        self.token_store.restore(self.token_file_path)

        wrapper = GarminClientWrapper(
            email=self.settings.garmin_email,
            password=self.settings.garmin_password,
            retry_attempts=self.settings.garmin_retry_attempts,
            retry_min_wait=self.settings.garmin_retry_min_wait,
            retry_max_wait=self.settings.garmin_retry_max_wait,
            verify_login=self.settings.garmin_verify_login,
            allow_credential_login=self.settings.garmin_allow_credential_login,
        )
        # garmin_client.py already raises correctly-typed exceptions here (a
        # token_rebootstrap_required GarminConnectAuthenticationError, or the original
        # GarminConnectTooManyRequestsError/GarminConnectConnectionError untouched) --
        # no extra wrapping needed, it would only risk re-masking a rate-limit/connection
        # failure as an auth problem.
        wrapper.login_with_tokens_or_credentials(self.token_file_path)

        self.token_store.persist(self.token_file_path)
        self.garmin_client = wrapper
        return wrapper

    def _init_provider(self) -> WearableProvider:
        """GarminSyncService depends on WearableProvider, not any specific vendor's
        client -- a fake/second provider can be injected via the constructor (see
        tests). Defaults to wrapping the Garmin client for real runs."""
        if self.provider is not None:
            return self.provider
        self.provider = GarminProviderAdapter(self._init_garmin_client())
        return self.provider

    def _archive_raw(
        self, endpoint: str, logical_date: str, payload: Any, sync_run_id: str
    ) -> None:
        """No-op when archiving is disabled (NullArchiveStore)."""
        self.archive_store.archive(
            endpoint, logical_date, payload, sync_run_id, self.garminconnect_version
        )

    def _archive_daily_payloads(
        self, raw_payloads: dict[str, Any], target_iso: str, yesterday_iso: str, sync_run_id: str
    ) -> None:
        """Archive the stats/sleep/hrv (+ fallback) payloads a fetch_daily_metrics call
        returned, remapping the fallback keys back to their real endpoint name and D-1
        logical date. Shared by sync_daily and backfill so they can't drift apart."""
        for endpoint, payload in raw_payloads.items():
            logical_date = (
                yesterday_iso if endpoint in ("stats_fallback", "sleep_fallback") else target_iso
            )
            archive_endpoint = (
                "stats"
                if endpoint == "stats_fallback"
                else ("sleep" if endpoint == "sleep_fallback" else endpoint)
            )
            self._archive_raw(archive_endpoint, logical_date, payload, sync_run_id)

    def _archive_activities(
        self,
        canonical_activities: list[CanonicalActivity],
        sync_run_id: str,
        details_by_activity_id: dict[str, CanonicalActivityDetail] | None = None,
    ) -> None:
        """Write a normalized standalone record per activity to users/{userId}/activities/.
        Safe to call unconditionally (no-op for an empty list). Activities without a
        Garmin activityId are skipped rather than written under a shared placeholder
        key, which would let one such activity silently overwrite another."""
        for activity in canonical_activities:
            if activity.activity_id is None:
                logger.warning("Skipping activity with no activityId (cannot archive safely).")
                continue
            self.repository.upsert_activity(
                activity.activity_id,
                normalize_activity(
                    activity,
                    sync_run_id,
                    (details_by_activity_id or {}).get(activity.activity_id),
                ),
            )

    def _fetch_activity_details(
        self,
        provider: WearableProvider,
        canonical_activities: list[CanonicalActivity],
        target_iso: str,
    ) -> dict[str, CanonicalActivityDetail]:
        """Best-effort live enrichment behind D-DETAIL-GATE.

        Raw detail payloads are deliberately not archived: ADR-0005's store is keyed by
        logical date, while these payloads require an activity-ID key. A failed detail
        fetch never prevents the base activity or daily snapshot from being written.
        """
        if not provider.capabilities.activity_details:
            return {}
        fetch_detail = getattr(provider, "fetch_activity_detail", None)
        if not callable(fetch_detail):
            return {}

        details: dict[str, CanonicalActivityDetail] = {}
        for activity in canonical_activities:
            # `canonical_activities` here is the full 3-day lookback window fetch_activities
            # uses for activity discovery, not just target_iso's activities. D-DETAIL-GATE is
            # explicitly scoped to "the target-date pass of sync_daily" only -- without this
            # check a qualifying D-1/D-2 activity would get (re-)fetched and re-upserted on
            # every subsequent day's sync too, well past the intended 3xN-per-run budget.
            if activity.date != target_iso or not qualifies_for_activity_detail(activity):
                continue
            assert activity.activity_id is not None
            try:
                result = fetch_detail(activity.activity_id)
                details[activity.activity_id] = result.canonical
            except GarminConnectTooManyRequestsError as error:
                logger.warning(
                    f"[{target_iso}] Garmin activity-detail rate limit reached; "
                    f"abandoning remaining detail fetches for this run: {error}"
                )
                break
            except Exception as error:
                logger.warning(
                    f"[{target_iso}] Garmin activity detail failed for "
                    f"activity=<ID-redacted>, continuing with the base record: {error}"
                )
        return details

    def _seed_prehistory(
        self, raw_memory_store: dict[str, dict[str, Any]], range_start: Any
    ) -> None:
        """Seed raw_memory_store with up to 28 days of existing Firestore history before
        range_start, so the first dates of a backfill/rebuild range get real 7d/28d
        baselines instead of starting cold."""
        pre_start_iso = get_date_string(n_days_ago(range_start, 28))
        pre_end_iso = get_date_string(n_days_ago(range_start, 1))
        logger.info(f"Seeding prehistory from Firestore ({pre_start_iso} -> {pre_end_iso})...")
        prehistory_docs = self.repository.get_historical_snapshots(pre_start_iso, pre_end_iso)
        for date_key, doc in prehistory_docs.items():
            if "raw" in doc:
                raw_memory_store[date_key] = doc["raw"]

    def _build_and_store_snapshot(
        self,
        target_iso: str,
        canonical: CanonicalDailyMetrics,
        canonical_activities: list[CanonicalActivity],
        raw_memory_store: dict[str, dict[str, Any]],
        activities_through_iso: str | None = None,
    ) -> DailyRecoverySnapshot:
        """Shared derive -> map -> store pipeline. Single source of truth for how a
        snapshot is assembled from a date's canonical metrics, used by sync_daily,
        backfill, and rebuild so they can never drift from each other."""
        target_date = parse_date_string(target_iso)
        w7_start = get_date_string(n_days_ago(target_date, 7))
        w28_start = get_date_string(n_days_ago(target_date, 28))

        sorted_history_dates = [d for d in sorted(raw_memory_store.keys()) if d < target_iso]
        window_7d = [raw_memory_store[d] for d in sorted_history_dates if d >= w7_start]
        window_28d = [raw_memory_store[d] for d in sorted_history_dates if d >= w28_start]

        dummy_current = {
            "sleepScore": canonical.sleep_score,
            "restingHr": canonical.resting_heart_rate_bpm,
            "hrvOvernightAvg": canonical.hrv_overnight_avg_ms,
            "respirationAvg": canonical.respiration_rate_brpm,
            # `steps_count` is the completed D-1 value (see metricDates.steps),
            # so it must accompany the other current metrics when deriving its
            # trailing baseline and deltas.
            "totalSteps": canonical.steps_count,
        }
        derived = compute_derived_metrics(dummy_current, window_7d, window_28d)

        snapshot = build_snapshot_from_canonical(
            user_id=self.settings.app_user_id,
            target_date_iso=target_iso,
            canonical=canonical,
            canonical_activities=canonical_activities,
            derived_metrics=derived,
            timezone_name=self.settings.app_timezone,
            garminconnect_version=self.garminconnect_version,
            activities_through_iso=activities_through_iso,
        )

        raw_memory_store[target_iso] = snapshot.raw.to_dict()
        self.repository.upsert_snapshot(target_iso, snapshot.to_dict())
        return snapshot

    def _fetch_and_store_date(
        self,
        target_date: Any,
        target_iso: str,
        include_activity_details: bool = False,
    ) -> bool:
        """Unconditional fetch -> canonicalize -> derive -> store pipeline for one date
        (no staleness check -- callers decide whether a date is worth fetching).
        Shared by sync_daily's primary target-date sync and its D-1..D-N lookback
        resync (see sync_daily) so they can never drift apart."""
        logger.info(
            f"Starting daily Garmin sync for user=<UID-redacted> date={target_iso} (tz={self.settings.app_timezone})..."
        )

        provider = self._init_provider()
        # A service (and its lazily-created provider) can be reused across multiple
        # sync_daily calls -- clear any per-date caching from a prior operation before
        # this one starts fetching, so a repeated --force run can't serve stale data.
        provider.clear_cache()
        sync_run_id = _new_sync_run_id(target_iso)

        yesterday_iso = get_date_string(n_days_ago(target_date, 1))
        three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))

        logger.info(f"[{target_iso}] Fetching stats, sleep, and HRV...")
        daily_result = provider.fetch_daily_metrics(target_iso, yesterday_iso)
        self._archive_daily_payloads(
            daily_result.raw_payloads, target_iso, yesterday_iso, sync_run_id
        )

        # Upper bound includes target_iso (not just yesterday) so a same-day activity --
        # already uploaded to Garmin by the time this sync runs -- is captured as
        # raw.todayTraining. A same-day activity uploaded to Garmin *after* this sync
        # runs still needs a re-sync to pick it up -- which is exactly what sync_daily's
        # D-1..D-N lookback resync provides the next day; see
        # DailySubjectiveCheckin.alreadyTrainedToday for the instant, sync-independent signal.
        zone4_floor = (
            daily_result.canonical.heart_rate_zones.zone4_floor
            if daily_result.canonical.heart_rate_zones
            else None
        )
        logger.info(
            f"[{target_iso}] Fetching activities window ({three_days_ago_iso} -> {target_iso})..."
        )
        activities_result = provider.fetch_activities(
            three_days_ago_iso, target_iso, zone4_floor=zone4_floor
        )
        self._archive_raw("activities", target_iso, activities_result.raw_payload, sync_run_id)
        details_by_activity_id = (
            self._fetch_activity_details(provider, activities_result.canonical, target_iso)
            if include_activity_details
            else {}
        )
        self._archive_activities(
            activities_result.canonical,
            sync_run_id,
            details_by_activity_id=details_by_activity_id,
        )

        # Persist refreshed tokens after API calls
        self.token_store.persist(self.token_file_path)

        raw_memory_store: dict[str, dict[str, Any]] = {}
        self._seed_prehistory(raw_memory_store, target_date)

        snapshot = self._build_and_store_snapshot(
            target_iso=target_iso,
            canonical=daily_result.canonical,
            canonical_activities=activities_result.canonical,
            raw_memory_store=raw_memory_store,
        )

        logger.info(
            f"sync_completed user=<UID-redacted> date={target_iso} "
            f"sleep={snapshot.dataQuality.sleepScoreAvailable} "
            f"hrv={snapshot.dataQuality.hrvAvailable} "
            f"rhr={snapshot.dataQuality.restingHrAvailable} "
            f"baseline_7d_ready={snapshot.dataQuality.baseline7dReady} "
            f"baseline_28d_ready={snapshot.dataQuality.baseline28dReady}"
        )
        return True

    def _sync_current_performance_targets(self, target_iso: str) -> None:
        """Best-effort current-profile import, deliberately outside the daily snapshot.

        Backfills and rebuilds never call this because profile targets are current
        configuration, not historical telemetry.  Non-Garmin providers/repositories
        can omit the optional capability without making recovery sync fail.
        """
        provider = self._init_provider()
        fetch_targets = getattr(provider, "fetch_performance_targets", None)
        persist_targets = getattr(self.repository, "upsert_garmin_performance_targets", None)
        if not callable(fetch_targets) or not callable(persist_targets):
            return
        try:
            result = fetch_targets()
            sync_run_id = _new_sync_run_id(f"targets-{target_iso}")
            for endpoint, payload in result.raw_payloads.items():
                if payload is not None:
                    self._archive_raw(endpoint, target_iso, payload, sync_run_id)
            persist_targets(result.canonical)
            # Profile endpoints are authenticated Garmin calls too; persist a refreshed
            # token just as the core daily metrics path does.
            self.token_store.persist(self.token_file_path)
        except Exception as e:
            # Performance targets enrich prescription but are never allowed to make a
            # recovery snapshot fail after its core data was safely persisted.
            logger.warning(
                f"[{target_iso}] Garmin performance-target import failed, continuing: {e}"
            )

    def sync_daily(
        self,
        target_date_str: str | None = None,
        force: bool = False,
        resync_lookback_days: int | None = None,
    ) -> bool:
        """Run daily sync for target date (default local_today in Europe/Warsaw).

        Garmin keeps revising a day's data well after that day ends -- a training
        session logged in the evening, totalSteps finalized overnight, a sleep score
        recomputed the next morning -- none of which is guaranteed to be present yet
        when *that* day's own sync runs (see the todayTraining note in
        _fetch_and_store_date). So this also unconditionally resyncs the preceding
        `resync_lookback_days` day(s) (default settings.garmin_resync_lookback_days,
        normally 1): an extra session logged today lands in Firestore once tomorrow's
        sync revisits today's snapshot.

        Lookback dates are resynced oldest-first, target date last. _fetch_and_store_date
        rebuilds a date's 7d/28d rolling baselines from whatever is currently in
        Firestore for the days before it -- so target_iso must be built only after any
        corrected D-1..D-N values have already landed there, or its own baselines would
        silently bake in the pre-resync (stale) history instead.
        """
        target_date = (
            parse_date_string(target_date_str)
            if target_date_str
            else local_today(self.settings.app_timezone)
        )
        target_iso = get_date_string(target_date)

        # Staleness check gates the whole operation (target date + lookback resync) --
        # a retriggered run within the staleness window is a no-op, not a chance to
        # re-hit the lookback dates too.
        if not force and self.repository.is_fresh(
            target_iso,
            staleness_minutes=self.settings.garmin_staleness_minutes,
            incomplete_staleness_minutes=self.settings.garmin_incomplete_staleness_minutes,
        ):
            logger.info(
                f"Snapshot for {target_iso} is fresh (< {self.settings.garmin_staleness_minutes}m). Skipping Garmin fetch."
            )
            return True

        lookback_days = (
            self.settings.garmin_resync_lookback_days
            if resync_lookback_days is None
            else resync_lookback_days
        )
        ok = True

        def _process_lookback(i: int) -> bool:
            lookback_date = n_days_ago(target_date, i)
            lookback_iso = get_date_string(lookback_date)
            logger.info(
                f"Revisiting D-{i} ({lookback_iso}) to pick up any late-arriving Garmin data..."
            )
            try:
                return self._fetch_and_store_date(lookback_date, lookback_iso)
            except Exception as e:
                logger.error(f"[{lookback_iso}] Lookback resync failed: {e}")
                return False

        if lookback_days > 0:
            import concurrent.futures

            # max_workers limited to a reasonable number to avoid too many parallel API calls
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=min(lookback_days, 10)
            ) as executor:
                futures = [
                    executor.submit(_process_lookback, i) for i in range(lookback_days, 0, -1)
                ]
                for future in concurrent.futures.as_completed(futures):
                    if not future.result():
                        ok = False

        # Target date is built last, after any lookback corrections above are already
        # persisted -- an exception here (unlike a lookback failure) propagates, as it
        # always has: it's the primary date the caller asked for.
        if not self._fetch_and_store_date(
            target_date,
            target_iso,
            include_activity_details=self.settings.garmin_activity_detail_enabled,
        ):
            ok = False
        else:
            self._sync_current_performance_targets(target_iso)

        return ok

    def _resolve_backfill_dates(
        self,
        today: date,
        days: int | None,
        start_date_str: str | None,
        end_date_str: str | None,
    ) -> tuple[date, date]:
        if start_date_str and end_date_str:
            return parse_date_string(start_date_str), parse_date_string(end_date_str)
        n_days = days or 56
        return n_days_ago(today, n_days - 1), today

    def _fetch_activity_details(
        self,
        provider: WearableProvider,
        all_activities_canonical: list[CanonicalActivity],
        target_iso: str | None = None,
    ) -> dict[str, CanonicalActivityDetail]:
        details_by_activity_id: dict[str, CanonicalActivityDetail] = {}
        fetch_detail = (
            getattr(provider, "fetch_activity_detail", None)
            if provider.capabilities.activity_details
            else None
        )
        if callable(fetch_detail):
            qualifying = [
                a
                for a in all_activities_canonical
                if qualifies_for_activity_detail(a) and (target_iso is None or a.date == target_iso)
            ]
            logger.info(f"Fetching activity details for {len(qualifying)} qualifying activities...")
            for activity in qualifying:
                assert activity.activity_id is not None
                try:
                    result = fetch_detail(activity.activity_id)
                    details_by_activity_id[activity.activity_id] = result.canonical
                except GarminConnectTooManyRequestsError as error:
                    logger.warning(
                        f"Garmin activity-detail rate limit reached during backfill; "
                        f"abandoning remaining detail fetches: {type(error).__name__}"
                    )
                    break
                except Exception as error:
                    logger.warning(
                        f"[{activity.date}] Garmin activity detail failed for "
                        f"activity=<ID-redacted>, continuing with the base record: {type(error).__name__}"
                    )
        return details_by_activity_id

    def _process_backfill_date(
        self,
        target_date: date,
        target_iso: str,
        force: bool,
        provider: WearableProvider,
        run_id: str,
        all_activities_raw: list[dict[str, Any]],
        raw_memory_store: dict[str, dict[str, Any]],
    ) -> bool:
        if not force:
            existing = self.repository.get_snapshot(target_iso)
            if existing and existing.get("raw"):
                raw_memory_store[target_iso] = existing["raw"]
                logger.info(
                    f"[{target_iso}] Loaded existing snapshot from Firestore. Skipping Garmin API fetch."
                )
                return True

        try:
            yesterday_iso = get_date_string(n_days_ago(target_date, 1))
            daily_result = provider.fetch_daily_metrics(target_iso, yesterday_iso)
            self._archive_daily_payloads(
                daily_result.raw_payloads, target_iso, yesterday_iso, run_id
            )

            # Archive the per-date-relevant activities slice (not the whole batch) so
            # a single date can be rebuilt independently from its own archive entry.
            # Upper bound is target_iso itself (not yesterday_iso) to match the live
            # sync_daily window and preserve that date's own todayTraining on rebuild.
            three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))
            date_activities_raw = [
                a
                for a in all_activities_raw
                if three_days_ago_iso <= a.get("startTimeLocal", "")[:10] <= target_iso
            ]
            self._archive_raw("activities", target_iso, date_activities_raw, run_id)

            zone4_floor = (
                daily_result.canonical.heart_rate_zones.zone4_floor
                if daily_result.canonical.heart_rate_zones
                else None
            )
            date_canonical_activities = canonicalize_activities(
                date_activities_raw, zone4_floor=zone4_floor
            )

            self._build_and_store_snapshot(
                target_iso=target_iso,
                canonical=daily_result.canonical,
                canonical_activities=date_canonical_activities,
                raw_memory_store=raw_memory_store,
            )
            logger.info(f"[{target_iso}] Backfill sync completed.")
            return True

        except Exception as e:
            logger.error(f"[{target_iso}] Backfill failed: {type(e).__name__}")
            return False

    def backfill(
        self,
        days: int | None = 56,
        start_date_str: str | None = None,
        end_date_str: str | None = None,
        force: bool = False,
        include_details: bool = False,
    ) -> bool:
        """Run historical backfill for date range."""
        today = local_today(self.settings.app_timezone)
        start_d, end_d = self._resolve_backfill_dates(today, days, start_date_str, end_date_str)

        target_dates = get_date_range(start_d, end_d)
        if not target_dates:
            logger.error("Backfill target date range is empty.")
            return False

        logger.info(
            f"Starting historical backfill for user=<UID-redacted> range {get_date_string(start_d)} -> {get_date_string(end_d)} ({len(target_dates)} dates)..."
        )

        batch_start_iso = get_date_string(n_days_ago(start_d, 3))
        batch_end_iso = get_date_string(end_d)

        provider = self._init_provider()
        provider.clear_cache()
        run_id = _new_sync_run_id(f"backfill-{batch_start_iso}")

        logger.info(f"Window fetching all activities {batch_start_iso} -> {batch_end_iso}...")
        activities_result = provider.fetch_activities(batch_start_iso, batch_end_iso)
        all_activities_raw = activities_result.raw_payload
        all_activities_canonical = activities_result.canonical
        logger.info(f"Retrieved {len(all_activities_raw)} activities in window.")

        details_by_activity_id: dict[str, CanonicalActivityDetail] = {}
        if include_details:
            details_by_activity_id = self._fetch_activity_details(
                provider, all_activities_canonical
            )

        self._archive_activities(
            all_activities_canonical,
            run_id,
            details_by_activity_id=details_by_activity_id,
        )

        raw_memory_store: dict[str, dict[str, Any]] = {}
        failed_dates: list[str] = []

        self._seed_prehistory(raw_memory_store, start_d)

        for target_date in target_dates:
            target_iso = get_date_string(target_date)
            success = self._process_backfill_date(
                target_date,
                target_iso,
                force,
                provider,
                run_id,
                all_activities_raw,
                raw_memory_store,
            )
            if not success:
                failed_dates.append(target_iso)

        self.token_store.persist(self.token_file_path)

        if failed_dates:
            logger.warning(f"Backfill finished with {len(failed_dates)} failures: {failed_dates}")
            return False

        logger.info("Backfill completed successfully for all requested dates.")
        return True

    def rebuild(self, start_date_str: str, end_date_str: str) -> bool:
        """Recreate normalized Firestore snapshots from archived raw payloads, without
        calling Garmin (no WearableProvider needed -- purely archive-driven, using the
        same canonicalize_from_raw/canonicalize_activities the live provider path uses,
        so this can never drift from a live sync). Dates missing any of the four
        required archived payloads (stats/sleep/hrv/activities) are skipped and
        reported, never fetched from Garmin."""
        start_d = parse_date_string(start_date_str)
        end_d = parse_date_string(end_date_str)
        target_dates = get_date_range(start_d, end_d)
        if not target_dates:
            logger.error("Rebuild target date range is empty.")
            return False

        logger.info(
            f"Starting offline rebuild for range {start_date_str} -> {end_date_str} ({len(target_dates)} dates)..."
        )

        raw_memory_store: dict[str, dict[str, Any]] = {}
        self._seed_prehistory(raw_memory_store, start_d)

        skipped_dates: list[str] = []
        rebuilt_dates: list[str] = []

        for target_date in target_dates:
            target_iso = get_date_string(target_date)
            yesterday_iso = get_date_string(n_days_ago(target_date, 1))

            raw_stats = self.archive_store.load("stats", target_iso)
            raw_sleep = self.archive_store.load("sleep", target_iso)
            raw_hrv = self.archive_store.load("hrv", target_iso)
            raw_activities = self.archive_store.load("activities", target_iso)

            if raw_stats is None or raw_sleep is None or raw_hrv is None or raw_activities is None:
                logger.warning(
                    f"[{target_iso}] Not rebuildable: missing archived payload(s) "
                    f"(stats={raw_stats is not None}, sleep={raw_sleep is not None}, "
                    f"hrv={raw_hrv is not None}, activities={raw_activities is not None}). Skipping."
                )
                skipped_dates.append(target_iso)
                # Keep history continuous: load existing Firestore raw snapshot if present
                # so downstream dates in the rebuild range still have full 7d/28d baselines.
                existing = self.repository.get_snapshot(target_iso)
                if existing and existing.get("raw"):
                    raw_memory_store[target_iso] = existing["raw"]
                continue

            stats_fallback = self.archive_store.load("stats", yesterday_iso)
            sleep_fallback = (
                self.archive_store.load("sleep", yesterday_iso) if not raw_sleep else None
            )

            # Metric enrichment (stress/body battery/training readiness/training status)
            # is best-effort here, unlike the four required payloads above -- it wasn't
            # part of the archive contract before item 4, so older archived dates simply
            # won't have it, and that must not block rebuildability.
            stress_today = self.archive_store.load("stress", target_iso)
            body_battery_today = self.archive_store.load("body_battery", target_iso)
            training_readiness_today = self.archive_store.load("training_readiness", target_iso)
            training_status_today = self.archive_store.load("training_status", target_iso)
            heart_rate_zones = self.archive_store.load("heart_rate_zones", target_iso)

            try:
                canonical = canonicalize_from_raw(
                    stats_today=raw_stats,
                    stats_fallback=stats_fallback,
                    sleep_today=raw_sleep,
                    sleep_fallback=sleep_fallback,
                    hrv_today=raw_hrv,
                    target_date_iso=target_iso,
                    yesterday_iso=yesterday_iso,
                    stress_today=stress_today,
                    body_battery_today=body_battery_today,
                    training_readiness_today=training_readiness_today,
                    training_status_today=training_status_today,
                    heart_rate_zones=heart_rate_zones,
                )
                zone4_floor = (
                    canonical.heart_rate_zones.zone4_floor if canonical.heart_rate_zones else None
                )
                canonical_activities = canonicalize_activities(
                    raw_activities, zone4_floor=zone4_floor
                )

                self._build_and_store_snapshot(
                    target_iso=target_iso,
                    canonical=canonical,
                    canonical_activities=canonical_activities,
                    raw_memory_store=raw_memory_store,
                    # Conservative: this archived "activities" entry may predate
                    # same-day activity fetching (see mapper.build_snapshot_from_canonical),
                    # so rebuild can't assert it covers through target_iso the way a live
                    # sync_daily/backfill fetch can. todayTraining itself is still
                    # populated from whatever canonical_activities actually contains --
                    # only this coverage marker is deliberately understated.
                    activities_through_iso=yesterday_iso,
                )
                rebuilt_dates.append(target_iso)
                logger.info(f"[{target_iso}] Rebuilt from archive.")
            except Exception as e:
                logger.error(f"[{target_iso}] Rebuild failed: {e}")
                skipped_dates.append(target_iso)

        logger.info(
            f"Rebuild finished: {len(rebuilt_dates)} rebuilt, {len(skipped_dates)} skipped/not rebuildable."
        )
        if skipped_dates:
            logger.warning(f"Skipped dates: {skipped_dates}")
        return len(rebuilt_dates) > 0

    def push_workout(
        self,
        date_str: str | None = None,
        workout_payload: dict[str, Any] | None = None,
    ) -> bool:
        """Upload and schedule a structured workout to Garmin Connect.

        When `workout_payload` is omitted, the queue item's own `status` gates the
        push: anything other than 'pending' (i.e. already 'synced', or 'failed' and
        not yet requeued) is treated as an idempotent no-op rather than re-uploaded.
        This is what lets `push_pending_workouts` (and any retried caller) poll/re-poll
        the queue safely without ever creating duplicate Garmin workouts.
        """
        target_date = (
            get_date_string(parse_date_string(date_str))
            if date_str
            else get_date_string(local_today(self.settings.app_timezone))
        )

        payload = workout_payload
        if not payload:
            if not self.repository.db:
                logger.warning("Firestore DB not initialized; cannot read queue.")
                return False
            queue_doc = (
                self.repository.db.collection("users")
                .document(self.settings.app_user_id)
                .collection("garmin_workout_queue")
                .document(target_date)
                .get()
            )
            if queue_doc.exists:
                data = queue_doc.to_dict() or {}
                status = data.get("status")
                if status and status != "pending":
                    logger.info(
                        f"[{target_date}] Queue item already '{status}'; skipping (idempotent no-op)."
                    )
                    return True
                payload = data.get("payload")

        if not payload:
            logger.warning(f"No workout payload found for {target_date} in Firestore queue.")
            return False

        return self._upload_and_schedule(target_date, payload)

    def push_pending_workouts(self, max_age_days: int = 14) -> bool:
        """Poll the Firestore workout queue for every 'pending' item and push each to
        Garmin Connect. Meant to run frequently (e.g. every few minutes via Cloud
        Scheduler) so a "Sync to Garmin" click in the web app reaches Garmin without a
        human ever running `push-workout` by hand for that date.

        Queue items older than `max_age_days` are left pending, not pushed -- an
        abandoned/forgotten entry shouldn't resurface on Garmin days or weeks later.
        Relies on push_workout's own status check for idempotency, so a retried poll
        (or one that overlaps a manual `push-workout` run) can never double-upload.
        """
        if not self.repository.db:
            logger.warning("Firestore DB not initialized; cannot poll queue.")
            return False

        from google.cloud.firestore_v1.base_query import FieldFilter

        queue_collection = (
            self.repository.db.collection("users")
            .document(self.settings.app_user_id)
            .collection("garmin_workout_queue")
        )
        pending_docs = list(
            queue_collection.where(filter=FieldFilter("status", "==", "pending")).stream()
        )

        if not pending_docs:
            logger.info("No pending Garmin workout queue items found.")
            return True

        oldest_allowed_iso = get_date_string(
            n_days_ago(local_today(self.settings.app_timezone), max_age_days)
        )

        ok = True
        pushed = 0
        for doc in pending_docs:
            data = doc.to_dict() or {}
            target_date = data.get("date") or doc.id
            payload = data.get("payload")

            if target_date < oldest_allowed_iso:
                logger.warning(
                    f"[{target_date}] Pending queue item is older than {max_age_days}d; "
                    "leaving pending, not pushing."
                )
                continue
            if not payload:
                logger.warning(f"[{target_date}] Pending queue item has no payload; skipping.")
                continue

            try:
                if self._upload_and_schedule(target_date, payload):
                    pushed += 1
                else:
                    ok = False
            except Exception as e:
                logger.error(f"[{target_date}] Failed to push queued workout: {e}")
                ok = False

        logger.info(
            f"push_pending_workouts finished: {pushed}/{len(pending_docs)} pending item(s) pushed."
        )
        return ok

    def _upload_and_schedule(self, target_date: str, payload: dict[str, Any]) -> bool:
        """Shared upload -> schedule -> mark-synced pipeline used by both push_workout
        (single date) and push_pending_workouts (bulk poll), so they can't drift."""
        client = self._init_garmin_client()
        from .workout_export import canonical_workout_to_garmin_payload

        athlete_ftp = payload.get("athleteFtpWatts")
        if athlete_ftp is None and self.repository.db:
            try:
                user_ref = self.repository.db.collection("users").document(
                    self.settings.app_user_id
                )
                pref_doc = user_ref.collection("preferences").document("profile").get()
                if pref_doc.exists:
                    data = pref_doc.to_dict() or {}
                    perf = data.get("performanceProfile") or {}
                    cycling = perf.get("cycling") or {}
                    athlete_ftp = cycling.get("ftpWatts") or perf.get("ftpWatts")

                if athlete_ftp is None:
                    settings_doc = user_ref.collection("trainingSettings").document("profile").get()
                    if settings_doc.exists:
                        data = settings_doc.to_dict() or {}
                        perf = data.get("performanceProfile") or {}
                        cycling = perf.get("cycling") or {}
                        athlete_ftp = cycling.get("ftpWatts") or perf.get("ftpWatts")
            except Exception as e:
                logger.debug(f"Could not load athlete FTP from Firestore profiles: {e}")

        garmin_payload = canonical_workout_to_garmin_payload(payload, athlete_ftp=athlete_ftp)

        from . import __version__ as garmin_sync_version
        from .workout_export import summarize_garmin_payload

        summary = summarize_garmin_payload(payload, garmin_payload)
        logger.info(
            "Garmin transform summary for %s: workoutId=%s modality=%s "
            "canonical_steps=%d garmin_top_level_steps=%d repeat_groups=%d "
            "recovery_steps=%d transformer_version=%s",
            target_date,
            summary["workoutId"],
            summary["modality"],
            summary["canonicalStepCount"],
            summary["garminTopLevelStepCount"],
            summary["repeatGroupCount"],
            summary["recoveryStepCount"],
            garmin_sync_version,
        )
        logger.info(
            f"Uploading workout '{garmin_payload.get('workoutName')}' to Garmin Connect for {target_date}..."
        )
        res = client.upload_workout(garmin_payload)
        workout_id = str(res.get("workoutId") or res.get("workout_id") or "")

        if workout_id:
            logger.info(f"Scheduling workout {workout_id} on {target_date}...")
            client.schedule_workout(workout_id, target_date)
            if self.repository.db:
                self.repository.db.collection("users").document(
                    self.settings.app_user_id
                ).collection("garmin_workout_queue").document(target_date).set(
                    {
                        "status": "synced",
                        "syncedAt": datetime.now(timezone.utc).isoformat(),
                        "garminWorkoutId": workout_id,
                    },
                    merge=True,
                )
            logger.info(
                f"Successfully uploaded and scheduled workout {workout_id} for {target_date}."
            )
            return True
        logger.error(f"Workout upload returned no workoutId; leaving queue pending: {res}")
        return False
