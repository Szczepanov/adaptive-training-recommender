import os
import datetime
import logging
import json
import argparse
import time
import random
from dotenv import load_dotenv
from garminconnect import Garmin
import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
COMPUTATION_VERSION = 1
RAW_CACHE_FILE = "raw_cache.json"


def load_raw_cache():
    """Load local JSON cache of already-fetched raw Garmin payloads."""
    if os.path.exists(RAW_CACHE_FILE):
        try:
            with open(RAW_CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not read {RAW_CACHE_FILE}: {e}")
    return {}


def save_raw_cache(cache: dict):
    """Persist the raw cache to disk."""
    try:
        with open(RAW_CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.warning(f"Could not write {RAW_CACHE_FILE}: {e}")


def init_garmin(email, password):
    tokenstore = os.getenv("GARMIN_TOKENS", ".garth")
    tokenstore = os.path.expanduser(tokenstore)
    api = Garmin(email, password)
    try:
        api.login(tokenstore)
        logger.info("Successfully logged in using cached Garmin Connect tokens.")
        return api
    except Exception:
        logger.info("Cached tokens failed/missing, performing full login...")
        api.login()
        os.makedirs(tokenstore, exist_ok=True)
        api.garth.dump(tokenstore)
        logger.info(f"OAuth tokens saved to '{tokenstore}' for future use.")
        return api


def setup_firebase():
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-service-account.json")
    if os.path.exists(cred_path):
        try:
            if not firebase_admin._apps:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
            return firestore.client()
        except Exception as db_e:
            logger.error(f"Failed to initialize Firebase: {db_e}")
            return None
    else:
        logger.warning(f"Firebase credentials not found at {cred_path}.")
        return None


def calculate_average(values, min_required):
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return sum(valid_values) / len(valid_values)
    return None


def calculate_delta(current, baseline):
    if current is not None and baseline is not None:
        return current - baseline
    return None


def fetch_garmin_backfill(days=56):
    load_dotenv()
    db = setup_firebase()

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        logger.error("Credentials not found in .env")
        return

    # Load local disk cache (survives crashes / re-runs)
    raw_cache = load_raw_cache()

    # Load existing Firestore raw snapshots — skip fetching these entirely
    existing_raw = {}
    if db:
        try:
            docs = db.collection('daily_recovery_snapshot').stream()
            for doc in docs:
                data = doc.to_dict()
                if 'raw' in data:
                    existing_raw[doc.id] = data['raw']
            logger.info(f"Loaded {len(existing_raw)} existing raw snapshots from Firestore.")
        except Exception as e:
            logger.error(f"Error reading from Firestore: {e}")

    MAX_RETRIES = 4
    BASE_BACKOFF = 5
    INTER_DATE_DELAY = 3  # seconds between per-date API calls

    def garmin_fetch(fn, *args):
        """Call a Garmin API function with exponential backoff on 429."""
        for attempt in range(MAX_RETRIES):
            try:
                return fn(*args)
            except Exception as e:
                err_str = str(e)
                if '429' in err_str or 'Too Many' in err_str:
                    wait = BASE_BACKOFF * (2 ** attempt) * random.uniform(0.5, 1.5)
                    logger.warning(f"429 rate-limited. Retrying in {wait:.1f}s... (attempt {attempt+1}/{MAX_RETRIES})")
                    time.sleep(wait)
                else:
                    raise
        logger.error(f"Giving up after {MAX_RETRIES} retries.")
        return None

    # Determine which dates actually need Garmin API calls
    today = datetime.date.today()
    all_target_dates = [today - datetime.timedelta(days=i) for i in range(days)]
    dates_to_fetch = [
        d for d in all_target_dates
        if d.isoformat() not in existing_raw and d.isoformat() not in raw_cache
    ]

    logger.info(
        f"Total dates: {len(all_target_dates)} | "
        f"Firestore cached: {len(existing_raw)} | "
        f"Local cached: {len([d for d in all_target_dates if d.isoformat() in raw_cache and d.isoformat() not in existing_raw])} | "
        f"Need Garmin fetch: {len(dates_to_fetch)}"
    )

    client = None
    memory_store = {}

    # Start with what Firestore and local cache already have
    for d in all_target_dates:
        iso = d.isoformat()
        if iso in existing_raw:
            memory_store[iso] = existing_raw[iso]
        elif iso in raw_cache:
            memory_store[iso] = raw_cache[iso]

    if dates_to_fetch:
        # Lazy init Garmin client only if we actually need it
        try:
            client = init_garmin(email, password)
        except Exception as e:
            logger.error(f"Garmin login failed: {e}")
            return

        # ── OPTIMIZATION: Fetch ALL activities in one batch call ──────────────
        # Instead of one call per date (56 calls), fetch the entire window once.
        # Extra 3 days on the start covers the training-context lookback.
        fetch_start = min(dates_to_fetch) - datetime.timedelta(days=3)
        fetch_end = max(dates_to_fetch)
        fetch_start_iso = fetch_start.isoformat()
        fetch_end_iso = fetch_end.isoformat()

        logger.info(f"Fetching all activities {fetch_start_iso} → {fetch_end_iso} in ONE batch call...")
        all_activities = garmin_fetch(client.get_activities_by_date, fetch_start_iso, fetch_end_iso, '') or []
        logger.info(f"Retrieved {len(all_activities)} activities in batch.")

        # Index activities by date for O(1) lookup per day
        activities_by_date: dict[str, list] = {}
        for act in all_activities:
            act_date = act.get('startTimeLocal', '')[:10]
            if act_date:
                activities_by_date.setdefault(act_date, []).append(act)

        # ── Per-date fetch: stats, sleep, HRV only (activities already batched) ─
        for target_date in sorted(dates_to_fetch):
            target_iso = target_date.isoformat()
            yesterday_iso = (target_date - datetime.timedelta(days=1)).isoformat()
            three_days_ago_iso = (target_date - datetime.timedelta(days=3)).isoformat()

            logger.info(f"[{target_iso}] Fetching stats / sleep / HRV from Garmin...")

            # 1. Stats (1 call)
            stats = garmin_fetch(client.get_stats, target_iso) or {}
            rhr = stats.get('restingHeartRate')
            total_steps = stats.get('totalSteps')
            bb_wake = stats.get('bodyBatteryAtWakeTime')

            # 2. Sleep (1 call)
            sleep_obj = garmin_fetch(client.get_sleep_data, target_iso) or {}
            sleep_score = (
                sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
                or sleep_obj.get('overallSleepScore', {}).get('value')
            )
            sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds')
            avg_resp = sleep_obj.get('dailySleepDTO', {}).get('averageRespirationValue')

            # 3. HRV (1 call)
            hrv_obj = garmin_fetch(client.get_hrv_data, target_iso) or {}
            hrv_last = hrv_obj.get('hrvSummary', {}).get('lastNightAvg')
            hrv_status = hrv_obj.get('hrvSummary', {}).get('status')

            # 4. Activities — from in-memory batch index, NO API call
            y_train = None
            hard_sessions_count = 0
            relevant_dates = [
                d for d in activities_by_date
                if three_days_ago_iso <= d <= yesterday_iso
            ]
            for d in relevant_dates:
                for act in activities_by_date[d]:
                    te = act.get('aerobicTrainingEffect', 0.0) or 0.0
                    avg_hr = act.get('averageHeartRate', 0) or 0
                    is_hard = (te >= 3.0 or avg_hr >= 145)
                    if is_hard:
                        hard_sessions_count += 1
                    if d == yesterday_iso and y_train is None:
                        y_train = {
                            "type": act.get("activityType", {}).get("typeKey", "unknown"),
                            "durationMin": round(act.get("duration", 0) / 60) if act.get("duration") else None,
                            "trainingEffect": te,
                            "intensityTag": "hard" if is_hard else "moderate/easy"
                        }

            raw = {
                "sleepScore": sleep_score,
                "sleepDurationSec": sleep_sec,
                "restingHr": rhr,
                "hrvOvernightAvg": hrv_last,
                "hrvStatus": hrv_status,
                "respirationAvg": avg_resp,
                "bodyBatteryWake": bb_wake,
                "bodyBatteryChange": None,
                "totalSteps": total_steps,
                "last3DaysHardSessionsCount": hard_sessions_count,
                "yesterdayTraining": y_train
            }

            memory_store[target_iso] = raw
            raw_cache[target_iso] = raw
            save_raw_cache(raw_cache)  # persist after each date (crash-safe)

            # Throttle between per-date calls (3 calls remain: stats/sleep/HRV)
            time.sleep(INTER_DATE_DELAY * random.uniform(0.5, 1.5))

    # ── PASS 2: Compute derivations & sync to Firestore ──────────────────────
    all_dates = sorted(memory_store.keys())

    for i, date_iso in enumerate(all_dates):
        raw = memory_store[date_iso]

        start_7d = max(0, i - 7)
        window_7d = [memory_store[all_dates[j]] for j in range(start_7d, i)]
        start_28d = max(0, i - 28)
        window_28d = [memory_store[all_dates[j]] for j in range(start_28d, i)]

        derived = {
            "baselineComputationVersion": COMPUTATION_VERSION,
            "sleepScore7dAvg": calculate_average([d["sleepScore"] for d in window_7d], 4),
            "sleepScore28dAvg": calculate_average([d["sleepScore"] for d in window_28d], 14),
            "restingHr7dAvg": calculate_average([d["restingHr"] for d in window_7d], 4),
            "restingHr28dAvg": calculate_average([d["restingHr"] for d in window_28d], 14),
            "hrv7dAvg": calculate_average([d["hrvOvernightAvg"] for d in window_7d], 4),
            "hrv28dAvg": calculate_average([d["hrvOvernightAvg"] for d in window_28d], 14),
            "respiration7dAvg": calculate_average([d["respirationAvg"] for d in window_7d], 4),
            "respiration28dAvg": calculate_average([d["respirationAvg"] for d in window_28d], 14),
        }

        for k, v in derived.items():
            if v is not None and isinstance(v, float) and k != 'baselineComputationVersion':
                derived[k] = round(v, 1)

        derived["deltas"] = {
            "sleepScoreVs7d": calculate_delta(raw["sleepScore"], derived["sleepScore7dAvg"]),
            "sleepScoreVs28d": calculate_delta(raw["sleepScore"], derived["sleepScore28dAvg"]),
            "restingHrVs7d": calculate_delta(raw["restingHr"], derived["restingHr7dAvg"]),
            "restingHrVs28d": calculate_delta(raw["restingHr"], derived["restingHr28dAvg"]),
            "hrvVs7d": calculate_delta(raw["hrvOvernightAvg"], derived["hrv7dAvg"]),
            "hrvVs28d": calculate_delta(raw["hrvOvernightAvg"], derived["hrv28dAvg"]),
            "respirationVs7d": calculate_delta(raw["respirationAvg"], derived["respiration7dAvg"]),
            "respirationVs28d": calculate_delta(raw["respirationAvg"], derived["respiration28dAvg"]),
        }

        for k, v in derived["deltas"].items():
            if v is not None and isinstance(v, float):
                derived["deltas"][k] = round(v, 1)

        data_quality = {
            "sleepScoreAvailable": raw["sleepScore"] is not None,
            "restingHrAvailable": raw["restingHr"] is not None,
            "hrvAvailable": raw["hrvOvernightAvg"] is not None,
            "baseline7dReady": derived["restingHr7dAvg"] is not None,
            "baseline28dReady": derived["restingHr28dAvg"] is not None
        }

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        payload = {
            "userId": "default_user",
            "date": date_iso,
            "source": {
                "garminSyncedAt": now_iso,
                "sourceSchemaVersion": SCHEMA_VERSION
            },
            "raw": raw,
            "derived": derived,
            "dataQuality": data_quality,
            "updatedAt": now_iso
        }

        if date_iso not in existing_raw:
            payload["createdAt"] = now_iso

        if db:
            try:
                doc_ref = db.collection('daily_recovery_snapshot').document(date_iso)
                doc_ref.set(payload, merge=True)
                logger.info(
                    f"[{date_iso}] Synced. "
                    f"(7d ready: {data_quality['baseline7dReady']}, "
                    f"28d ready: {data_quality['baseline28dReady']})"
                )
            except Exception as db_e:
                logger.error(f"[{date_iso}] Failed to sync: {db_e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Backfill Garmin data to Firestore.')
    parser.add_argument('--days', type=int, default=56, help='Number of days to look back')
    args = parser.parse_args()
    fetch_garmin_backfill(days=args.days)
