import importlib.metadata
import logging
import uuid
from pathlib import Path
from typing import Any
from .archive import RawArchiveStore, create_archive_store
from .canonical import CanonicalActivity, CanonicalDailyMetrics
from .config import Settings
from .dates import get_date_range, get_date_string, local_today, n_days_ago, parse_date_string
from .firestore_repository import FirestoreRecoveryRepository
from .garmin_client import GarminClientWrapper
from .garmin_provider import GarminProviderAdapter, canonicalize_activities, canonicalize_from_raw
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

        logger.info(f"Restoring Garmin tokens via store backend '{self.settings.garmin_token_store}'...")
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

    def _archive_raw(self, endpoint: str, logical_date: str, payload: Any, sync_run_id: str) -> None:
        """No-op when archiving is disabled (NullArchiveStore)."""
        self.archive_store.archive(endpoint, logical_date, payload, sync_run_id, self.garminconnect_version)

    def _archive_daily_payloads(self, raw_payloads: dict[str, Any], target_iso: str, yesterday_iso: str, sync_run_id: str) -> None:
        """Archive the stats/sleep/hrv (+ fallback) payloads a fetch_daily_metrics call
        returned, remapping the fallback keys back to their real endpoint name and D-1
        logical date. Shared by sync_daily and backfill so they can't drift apart."""
        for endpoint, payload in raw_payloads.items():
            logical_date = yesterday_iso if endpoint in ("stats_fallback", "sleep_fallback") else target_iso
            archive_endpoint = "stats" if endpoint == "stats_fallback" else ("sleep" if endpoint == "sleep_fallback" else endpoint)
            self._archive_raw(archive_endpoint, logical_date, payload, sync_run_id)

    def _archive_activities(self, canonical_activities: list[CanonicalActivity], sync_run_id: str) -> None:
        """Write a normalized standalone record per activity to users/{userId}/activities/.
        Safe to call unconditionally (no-op for an empty list). Activities without a
        Garmin activityId are skipped rather than written under a shared placeholder
        key, which would let one such activity silently overwrite another."""
        for activity in canonical_activities:
            if activity.activity_id is None:
                logger.warning("Skipping activity with no activityId (cannot archive safely).")
                continue
            self.repository.upsert_activity(activity.activity_id, normalize_activity(activity, sync_run_id))

    def _seed_prehistory(self, raw_memory_store: dict[str, dict[str, Any]], range_start: Any) -> None:
        """Seed raw_memory_store with up to 28 days of existing Firestore history before
        range_start, so the first dates of a backfill/rebuild range get real 7d/28d
        baselines instead of starting cold (Fix B)."""
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
        backfill, and rebuild so they can never drift from each other (Fix A)."""
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

    def sync_daily(self, target_date_str: str | None = None, force: bool = False) -> bool:
        """Run daily sync for target date (default local_today in Europe/Warsaw)."""
        target_date = parse_date_string(target_date_str) if target_date_str else local_today(self.settings.app_timezone)
        target_iso = get_date_string(target_date)

        logger.info(f"Starting daily Garmin sync for user=<UID-redacted> date={target_iso} (tz={self.settings.app_timezone})...")

        # Staleness check
        if not force and self.repository.is_fresh(target_iso, self.settings.garmin_staleness_minutes):
            logger.info(
                f"Snapshot for {target_iso} is fresh (< {self.settings.garmin_staleness_minutes}m). Skipping Garmin fetch."
            )
            return True

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
        self._archive_daily_payloads(daily_result.raw_payloads, target_iso, yesterday_iso, sync_run_id)

        # Upper bound includes target_iso (not just yesterday) so a same-day activity --
        # already uploaded to Garmin by the time this sync runs -- is captured as
        # raw.todayTraining. Requires a re-sync after training to pick it up; see
        # DailySubjectiveCheckin.alreadyTrainedToday for the instant, sync-independent signal.
        logger.info(f"[{target_iso}] Fetching activities window ({three_days_ago_iso} -> {target_iso})...")
        activities_result = provider.fetch_activities(three_days_ago_iso, target_iso)
        self._archive_raw("activities", target_iso, activities_result.raw_payload, sync_run_id)
        self._archive_activities(activities_result.canonical, sync_run_id)

        # Persist refreshed tokens after API calls
        self.token_store.persist(self.token_file_path)

        # Load prior 28 days for baselines
        start_28d = get_date_string(n_days_ago(target_date, 28))
        prev_day = get_date_string(n_days_ago(target_date, 1))
        history_docs = self.repository.get_historical_snapshots(start_28d, prev_day)
        raw_memory_store = {k: v["raw"] for k, v in history_docs.items() if "raw" in v}

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

    def backfill(
        self,
        days: int | None = 56,
        start_date_str: str | None = None,
        end_date_str: str | None = None,
        force: bool = False,
    ) -> bool:
        """Run historical backfill for date range."""
        today = local_today(self.settings.app_timezone)

        if start_date_str and end_date_str:
            start_d = parse_date_string(start_date_str)
            end_d = parse_date_string(end_date_str)
        else:
            n_days = days or 56
            end_d = today
            start_d = n_days_ago(today, n_days - 1)

        target_dates = get_date_range(start_d, end_d)
        if not target_dates:
            logger.error("Backfill target date range is empty.")
            return False

        logger.info(
            f"Starting historical backfill for user=<UID-redacted> range {get_date_string(start_d)} -> {get_date_string(end_d)} ({len(target_dates)} dates)..."
        )

        # Batch fetch all activities upfront to save API calls
        batch_start_iso = get_date_string(n_days_ago(start_d, 3))
        batch_end_iso = get_date_string(end_d)

        provider = self._init_provider()
        # See sync_daily: clear any per-date caching from a prior operation before this
        # backfill starts. Caching is only safe *within* this run's chronological date
        # loop, populated fresh below.
        provider.clear_cache()
        run_id = _new_sync_run_id(f"backfill-{batch_start_iso}")

        logger.info(f"Window fetching all activities {batch_start_iso} -> {batch_end_iso}...")
        activities_result = provider.fetch_activities(batch_start_iso, batch_end_iso)
        all_activities_raw = activities_result.raw_payload
        all_activities_canonical = activities_result.canonical
        logger.info(f"Retrieved {len(all_activities_raw)} activities in window.")
        self._archive_activities(all_activities_canonical, run_id)

        # Process dates in chronological order
        raw_memory_store: dict[str, dict[str, Any]] = {}
        failed_dates: list[str] = []

        # Fix B: Seed prehistory from existing Firestore history prior to start_d
        self._seed_prehistory(raw_memory_store, start_d)

        for target_date in target_dates:
            target_iso = get_date_string(target_date)

            if not force:
                existing = self.repository.get_snapshot(target_iso)
                if existing and existing.get("raw"):
                    raw_memory_store[target_iso] = existing["raw"]
                    logger.info(f"[{target_iso}] Loaded existing snapshot from Firestore. Skipping Garmin API fetch.")
                    continue

            try:
                yesterday_iso = get_date_string(n_days_ago(target_date, 1))
                daily_result = provider.fetch_daily_metrics(target_iso, yesterday_iso)
                self._archive_daily_payloads(daily_result.raw_payloads, target_iso, yesterday_iso, run_id)

                # Archive the per-date-relevant activities slice (not the whole batch) so
                # a single date can be rebuilt independently from its own archive entry.
                # Upper bound is target_iso itself (not yesterday_iso) to match the live
                # sync_daily window and preserve that date's own todayTraining on rebuild.
                three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))
                date_activities_raw = [
                    a for a in all_activities_raw
                    if three_days_ago_iso <= a.get("startTimeLocal", "")[:10] <= target_iso
                ]
                self._archive_raw("activities", target_iso, date_activities_raw, run_id)

                self._build_and_store_snapshot(
                    target_iso=target_iso,
                    canonical=daily_result.canonical,
                    canonical_activities=all_activities_canonical,
                    raw_memory_store=raw_memory_store,
                )
                logger.info(f"[{target_iso}] Backfill sync completed.")

            except Exception as e:
                logger.error(f"[{target_iso}] Backfill failed: {e}")
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

        logger.info(f"Starting offline rebuild for range {start_date_str} -> {end_date_str} ({len(target_dates)} dates)...")

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
                continue

            stats_fallback = self.archive_store.load("stats", yesterday_iso)
            sleep_fallback = self.archive_store.load("sleep", yesterday_iso) if not raw_sleep else None

            # Metric enrichment (stress/body battery/training readiness/training status)
            # is best-effort here, unlike the four required payloads above -- it wasn't
            # part of the archive contract before item 4, so older archived dates simply
            # won't have it, and that must not block rebuildability.
            stress_today = self.archive_store.load("stress", target_iso)
            body_battery_today = self.archive_store.load("body_battery", target_iso)
            training_readiness_today = self.archive_store.load("training_readiness", target_iso)
            training_status_today = self.archive_store.load("training_status", target_iso)

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
                )
                canonical_activities = canonicalize_activities(raw_activities)

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

        logger.info(f"Rebuild finished: {len(rebuilt_dates)} rebuilt, {len(skipped_dates)} skipped/not rebuildable.")
        if skipped_dates:
            logger.warning(f"Skipped dates: {skipped_dates}")
        return len(rebuilt_dates) > 0
