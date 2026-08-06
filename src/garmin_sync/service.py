import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from .config import Settings
from .dates import get_date_range, get_date_string, local_today, n_days_ago, parse_date_string
from .firestore_repository import FirestoreRecoveryRepository
from .garmin_client import GarminClientWrapper
from .mapper import extract_sleep_metrics, map_garmin_payload_to_snapshot, normalize_current_metrics
from .metrics import compute_derived_metrics
from .token_store import create_token_store

logger = logging.getLogger(__name__)


class GarminSyncService:
    def __init__(
        self,
        settings: Settings,
        repository: FirestoreRecoveryRepository | None = None,
        garmin_client: Any | None = None,
    ):
        self.settings = settings
        self.repository = repository or FirestoreRecoveryRepository(
            user_id=settings.app_user_id,
            collection_name=settings.firestore_recovery_collection,
            db=None,
            credentials_path=settings.firebase_credentials_path,
        )
        self.garmin_client = garmin_client
        self.token_store = create_token_store(
            store_type=settings.garmin_token_store,
            local_path=settings.garmin_token_path,
            bucket_name=settings.garmin_token_bucket,
            object_name=settings.garmin_token_object,
        )
        self.token_file_path = Path(settings.garmin_token_path).expanduser().resolve()

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

        client = self._init_garmin_client()

        yesterday_iso = get_date_string(n_days_ago(target_date, 1))
        three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))

        logger.info(f"[{target_iso}] Fetching stats, sleep, and HRV...")
        stats_today = client.get_stats(target_iso)
        # Always fetch D-1 stats: totalSteps must reflect the previous completed day per the
        # snapshot date contract, not just serve as an RHR fallback (see mapper.py steps semantics).
        stats_yesterday = client.get_stats(yesterday_iso)

        sleep_today = client.get_sleep_data(target_iso)
        sleep_yesterday = client.get_sleep_data(yesterday_iso) if not sleep_today else None

        hrv_today = client.get_hrv_data(target_iso)

        logger.info(f"[{target_iso}] Fetching activities window ({three_days_ago_iso} -> {yesterday_iso})...")
        activities_window = client.get_activities_window(three_days_ago_iso, yesterday_iso)

        # Persist refreshed tokens after API calls
        self.token_store.persist(self.token_file_path)

        # Load prior 28 days for baselines
        start_28d = get_date_string(n_days_ago(target_date, 28))
        prev_day = get_date_string(n_days_ago(target_date, 1))

        history_docs = self.repository.get_historical_snapshots(start_28d, prev_day)
        history_raws = {k: v.get("raw", {}) for k, v in history_docs.items() if "raw" in v}

        sorted_history_dates = sorted(history_raws.keys())
        w7_start = get_date_string(n_days_ago(target_date, 7))

        window_7d = [history_raws[d] for d in sorted_history_dates if d >= w7_start]
        window_28d = [history_raws[d] for d in sorted_history_dates]

        norm_today, _ = normalize_current_metrics(
            stats_today=stats_today,
            stats_fallback=stats_yesterday,
            sleep_today=sleep_today,
            sleep_fallback=sleep_yesterday,
            hrv_today=hrv_today,
            target_date_iso=target_iso,
            yesterday_iso=yesterday_iso,
        )
        dummy_current = {
            "sleepScore": norm_today["sleepScore"],
            "restingHr": norm_today["restingHr"],
            "hrvOvernightAvg": norm_today["hrvOvernightAvg"],
            "respirationAvg": norm_today["respirationAvg"],
        }

        derived = compute_derived_metrics(dummy_current, window_7d, window_28d)

        snapshot = map_garmin_payload_to_snapshot(
            user_id=self.settings.app_user_id,
            target_date_iso=target_iso,
            stats_today=stats_today,
            stats_fallback=stats_yesterday,
            sleep_today=sleep_today,
            sleep_fallback=sleep_yesterday,
            hrv_today=hrv_today,
            activities_window=activities_window,
            derived_metrics=derived,
            timezone_name=self.settings.app_timezone,
        )

        self.repository.upsert_snapshot(target_iso, snapshot.to_dict())
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

        client = self._init_garmin_client()

        logger.info(f"Window fetching all activities {batch_start_iso} -> {batch_end_iso}...")
        all_activities = client.get_activities_window(batch_start_iso, batch_end_iso)
        logger.info(f"Retrieved {len(all_activities)} activities in window.")

        # Process dates in chronological order
        raw_memory_store: dict[str, dict[str, Any]] = {}
        failed_dates: list[str] = []

        # Fix B: Seed prehistory from existing Firestore history prior to start_d
        pre_start_iso = get_date_string(n_days_ago(start_d, 28))
        pre_end_iso = get_date_string(n_days_ago(start_d, 1))
        logger.info(f"Seeding backfill prehistory from Firestore ({pre_start_iso} -> {pre_end_iso})...")
        prehistory_docs = self.repository.get_historical_snapshots(pre_start_iso, pre_end_iso)
        for date_key, doc in prehistory_docs.items():
            if "raw" in doc:
                raw_memory_store[date_key] = doc["raw"]

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
                stats_today = client.get_stats(target_iso)
                # Always fetch D-1 stats for correct totalSteps semantics (see sync_daily above).
                stats_yesterday = client.get_stats(yesterday_iso)
                sleep_today = client.get_sleep_data(target_iso)
                sleep_yesterday = client.get_sleep_data(yesterday_iso) if not sleep_today else None
                hrv_today = client.get_hrv_data(target_iso)

                # Compute derived metrics chronologically using raw_memory_store
                w7_start = get_date_string(n_days_ago(target_date, 7))
                w28_start = get_date_string(n_days_ago(target_date, 28))

                sorted_history_dates = [d for d in sorted(raw_memory_store.keys()) if d < target_iso]
                window_7d = [raw_memory_store[d] for d in sorted_history_dates if d >= w7_start]
                window_28d = [raw_memory_store[d] for d in sorted_history_dates if d >= w28_start]

                norm_today, _ = normalize_current_metrics(
                    stats_today=stats_today,
                    stats_fallback=stats_yesterday,
                    sleep_today=sleep_today,
                    sleep_fallback=sleep_yesterday,
                    hrv_today=hrv_today,
                    target_date_iso=target_iso,
                    yesterday_iso=yesterday_iso,
                )
                dummy_current = {
                    "sleepScore": norm_today["sleepScore"],
                    "restingHr": norm_today["restingHr"],
                    "hrvOvernightAvg": norm_today["hrvOvernightAvg"],
                    "respirationAvg": norm_today["respirationAvg"],
                }

                derived = compute_derived_metrics(dummy_current, window_7d, window_28d)

                snapshot = map_garmin_payload_to_snapshot(
                    user_id=self.settings.app_user_id,
                    target_date_iso=target_iso,
                    stats_today=stats_today,
                    stats_fallback=stats_yesterday,
                    sleep_today=sleep_today,
                    sleep_fallback=sleep_yesterday,
                    hrv_today=hrv_today,
                    activities_window=all_activities,
                    derived_metrics=derived,
                    timezone_name=self.settings.app_timezone,
                )

                raw_memory_store[target_iso] = snapshot.raw.to_dict()
                self.repository.upsert_snapshot(target_iso, snapshot.to_dict())
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
