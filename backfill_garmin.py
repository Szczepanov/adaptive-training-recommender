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

def init_garmin(email, password):
    tokenstore = os.getenv("GARMIN_TOKENS", "~/.garminconnect")
    tokenstore = os.path.expanduser(tokenstore)
    
    # We might miss .garminconnect, ensure safe pass
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
        logger.info(f"Oauth tokens saved to directory '{tokenstore}' for future use.")
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

def fetch_garmin_backfill(days=56):
    load_dotenv()
    db = setup_firebase()
    
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        logger.error("Credentials not found in .env")
        return

    # To avoid repeated fetches of same historical raw data, we can read what is inside 'daily_recovery_snapshot'
    existing_raw = {}
    if db:
        try:
            docs = db.collection('daily_recovery_snapshot').stream()
            for doc in docs:
                data = doc.to_dict()
                if 'raw' in data:
                    existing_raw[doc.id] = data['raw']
            logger.info(f"Loaded {len(existing_raw)} existing raw snapshots from Firestore for derivation pass.")
        except Exception as e:
            logger.error(f"Error reading from Firestore: {e}")

    # Seconds to wait between dates to avoid hitting Garmin's rate limit.
    # Garmin allows ~20-30 req/min across all endpoints; we fire 4 calls per date.
    INTER_DATE_DELAY = 3   # base seconds between dates (jittered ±50%)
    MAX_RETRIES = 4
    BASE_BACKOFF = 5  # base seconds for exponential backoff (jittered ±50%)

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

    client = None
    today = datetime.date.today()
    memory_store = {}
    
    # PASS 1: Collect Raw Data
    for i in range(days):
        target_date = today - datetime.timedelta(days=i)
        target_iso = target_date.isoformat()
        
        if target_iso in existing_raw:
            logger.info(f"[{target_iso}] Raw data already exists. Using cached version.")
            memory_store[target_iso] = existing_raw[target_iso]
            continue
            
        logger.info(f"[{target_iso}] Fetching data from Garmin...")
        
        # Initialize client lazily only if we need to fetch
        if client is None:
            try:
                client = init_garmin(email, password)
            except Exception as e:
                logger.error(f"Garmin login failed: {e}")
                return
        
        yesterday_of_target = target_date - datetime.timedelta(days=1)
        three_days_ago_of_target = target_date - datetime.timedelta(days=3)
        yesterday_iso = yesterday_of_target.isoformat()
        three_days_ago_iso = three_days_ago_of_target.isoformat()

        # 1. Stats
        stats = garmin_fetch(client.get_stats, target_iso) or {}
            
        rhr = stats.get('restingHeartRate')
        total_steps = stats.get('totalSteps')
        bb_wake = stats.get('bodyBatteryAtWakeTime')

        # 2. Sleep
        sleep_obj = garmin_fetch(client.get_sleep_data, target_iso) or {}
            
        sleep_score = (
            sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
            or sleep_obj.get('overallSleepScore', {}).get('value')
        )
        sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds')
        avg_resp = sleep_obj.get('dailySleepDTO', {}).get('averageRespirationValue')

        # 3. HRV
        hrv_obj = garmin_fetch(client.get_hrv_data, target_iso) or {}
            
        hrv_last = hrv_obj.get('hrvSummary', {}).get('lastNightAvg')
        hrv_status = hrv_obj.get('hrvSummary', {}).get('status')

        # 4. Recent Training Context
        y_train = None
        hard_sessions_count = 0
        activities = garmin_fetch(client.get_activities_by_date, three_days_ago_iso, yesterday_iso, '') or []

        time.sleep(INTER_DATE_DELAY * random.uniform(0.5, 1.5))
            
        for act in activities:
            te = act.get('aerobicTrainingEffect', 0.0) or 0.0
            avg_hr = act.get('averageHeartRate', 0) or 0
            is_hard = (te >= 3.0 or avg_hr >= 145)
            if is_hard:
                hard_sessions_count += 1
                
            act_date = act.get('startTimeLocal', '')[:10]
            if act_date == yesterday_iso:
                if y_train is None:
                    y_train = {
                        "type": act.get("activityType", {}).get("typeKey", "unknown"),
                        "durationMin": round(act.get("duration", 0) / 60) if act.get("duration") else None,
                        "trainingEffect": te,
                        "intensityTag": "hard" if is_hard else "moderate/easy"
                    }

        # Store exactly matching the 'raw' schema
        memory_store[target_iso] = {
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

    # PASS 2: Compute derivations & sync
    # We sort dates chronologically (oldest first) to compute rolling baselines
    all_dates = sorted(memory_store.keys())

    for i, date_iso in enumerate(all_dates):
        raw = memory_store[date_iso]
        
        # Get historical windows (excluding current day)
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

        user_id = "default_user"

        payload = {
            "userId": user_id,
            "date": date_iso,
            "source": {
                "garminSyncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sourceSchemaVersion": SCHEMA_VERSION
            },
            "raw": raw,
            "derived": derived,
            "dataQuality": data_quality,
            "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        if date_iso not in existing_raw:
            payload["createdAt"] = payload["updatedAt"]

        if db:
            try:
                # Upsert
                doc_ref = db.collection('daily_recovery_snapshot').document(date_iso)
                doc_ref.set(payload, merge=True)
                logger.info(f"[{date_iso}] Synced enriched snapshot. (7d ready: {data_quality['baseline7dReady']}, 28d ready: {data_quality['baseline28dReady']})")
            except Exception as db_e:
                logger.error(f"[{date_iso}] Failed to sync: {db_e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Backfill Garmin data to Firestore.')
    parser.add_argument('--days', type=int, default=56, help='Number of days to look back')
    args = parser.parse_args()
    
    fetch_garmin_backfill(days=args.days)
