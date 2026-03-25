import os
import datetime
import logging
import json
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
STALENESS_HOURS = 1  # skip all Garmin calls if today's doc was synced within this window


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
        logger.warning(f"Firebase credentials not found at {cred_path}. Cannot skip existing or save.")
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


def fetch_garmin_data():
    load_dotenv()
    db = setup_firebase()
    if not db:
        logger.error("Firebase DB not initialized. Cannot continue.")
        return

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        logger.error("Credentials not found in .env")
        return

    today = datetime.date.today()
    today_iso = today.isoformat()
    yesterday = today - datetime.timedelta(days=1)
    yesterday_iso = yesterday.isoformat()
    three_days_ago_iso = (today - datetime.timedelta(days=3)).isoformat()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    # ── STALENESS CHECK ───────────────────────────────────────────────────────
    # If Firestore already has today's snapshot synced within STALENESS_HOURS,
    # skip all Garmin API calls and just recompute derived stats from history.
    raw = None
    try:
        existing_doc = db.collection('daily_recovery_snapshot').document(today_iso).get()
        if existing_doc.exists:
            data = existing_doc.to_dict()
            synced_at_str = data.get('source', {}).get('garminSyncedAt')
            if synced_at_str:
                synced_at = datetime.datetime.fromisoformat(synced_at_str)
                age_hours = (now_utc - synced_at).total_seconds() / 3600
                if age_hours < STALENESS_HOURS:
                    logger.info(
                        f"Today's snapshot already synced {age_hours:.1f}h ago "
                        f"(< {STALENESS_HOURS}h threshold). Skipping all Garmin API calls."
                    )
                    return
                else:
                    logger.info(f"Existing snapshot is {age_hours:.1f}h old — refreshing.")
            raw = data.get('raw')  # reuse existing raw if we're just refreshing derived
    except Exception as e:
        logger.warning(f"Could not check existing Firestore doc: {e}")

    # ── LOCAL DISK CACHE ──────────────────────────────────────────────────────
    raw_cache = load_raw_cache()
    if raw is None and today_iso in raw_cache:
        logger.info(f"Using today's raw data from local cache ({RAW_CACHE_FILE}).")
        raw = raw_cache[today_iso]

    MAX_RETRIES = 4
    BASE_BACKOFF = 5

    def garmin_fetch(fn, *args):
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

    # ── GARMIN FETCH (only if raw not cached) ────────────────────────────────
    if raw is None:
        try:
            client = init_garmin(email, password)
        except Exception as e:
            logger.error(f"Garmin login failed: {e}")
            return

        logger.info(f"Fetching today's Garmin data for {today_iso}...")

        # 1. Stats
        stats = garmin_fetch(client.get_stats, today_iso) or {}
        rhr = stats.get('restingHeartRate')
        if rhr is None:
            logger.info("Today's RHR not available yet, fetching yesterday's stats as fallback.")
            stats = garmin_fetch(client.get_stats, yesterday_iso) or {}
            rhr = stats.get('restingHeartRate')
        total_steps = stats.get('totalSteps')
        bb_wake = stats.get('bodyBatteryAtWakeTime')

        # 2. Sleep
        sleep_obj = garmin_fetch(client.get_sleep_data, today_iso) or {}
        sleep_score = (
            sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
            or sleep_obj.get('overallSleepScore', {}).get('value')
        )
        sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds')
        avg_resp = sleep_obj.get('dailySleepDTO', {}).get('averageRespirationValue')
        if sleep_score is None:
            sleep_obj = garmin_fetch(client.get_sleep_data, yesterday_iso) or {}
            sleep_score = (
                sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
                or sleep_obj.get('overallSleepScore', {}).get('value')
            )
            sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds')
            avg_resp = sleep_obj.get('dailySleepDTO', {}).get('averageRespirationValue')

        # 3. HRV
        hrv_obj = garmin_fetch(client.get_hrv_data, today_iso) or {}
        hrv_last = hrv_obj.get('hrvSummary', {}).get('lastNightAvg')
        hrv_status = hrv_obj.get('hrvSummary', {}).get('status')

        # 4. Activities — one batch call covering the 3-day training context window
        logger.info(f"Fetching activities {three_days_ago_iso} → {yesterday_iso} in one call...")
        activities = garmin_fetch(client.get_activities_by_date, three_days_ago_iso, yesterday_iso, '') or []

        y_train = None
        hard_sessions_count = 0
        for act in activities:
            te = act.get('aerobicTrainingEffect', 0.0) or 0.0
            avg_hr = act.get('averageHeartRate', 0) or 0
            is_hard = (te >= 3.0 or avg_hr >= 145)
            if is_hard:
                hard_sessions_count += 1
            act_date = act.get('startTimeLocal', '')[:10]
            if act_date == yesterday_iso and y_train is None:
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

        # Save to local cache immediately
        raw_cache[today_iso] = raw
        save_raw_cache(raw_cache)

    # ── DERIVED STATS from Firestore history ─────────────────────────────────
    logger.info("Reading prior 28 days history from Firestore for baseline calculations...")
    history_docs = db.collection('daily_recovery_snapshot') \
                     .where('date', '>=', (today - datetime.timedelta(days=28)).isoformat()) \
                     .where('date', '<', today_iso) \
                     .stream()

    history = {}
    for doc in history_docs:
        doc_data = doc.to_dict()
        if 'raw' in doc_data:
            history[doc.id] = doc_data['raw']
    logger.info(f"Loaded {len(history)} historical records.")

    history_dates = sorted(history.keys())
    window_7d = [history[d] for d in history_dates if d >= (today - datetime.timedelta(days=7)).isoformat()]
    window_28d = [history[d] for d in history_dates if d >= (today - datetime.timedelta(days=28)).isoformat()]

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

    now_iso = now_utc.isoformat()
    payload = {
        "userId": "default_user",
        "date": today_iso,
        "source": {
            "garminSyncedAt": now_iso,
            "sourceSchemaVersion": SCHEMA_VERSION
        },
        "raw": raw,
        "derived": derived,
        "dataQuality": data_quality,
        "updatedAt": now_iso
    }

    try:
        doc_ref = db.collection('daily_recovery_snapshot').document(today_iso)
        doc_snap = doc_ref.get()
        if not doc_snap.exists:
            payload["createdAt"] = now_iso
        doc_ref.set(payload, merge=True)
        logger.info(f"Successfully synced {today_iso} enriched snapshot!")
    except Exception as db_e:
        logger.error(f"Failed to sync with Firebase: {db_e}")


if __name__ == "__main__":
    fetch_garmin_data()
