import os
import datetime
import logging
import json
from dotenv import load_dotenv
from garminconnect import Garmin
import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def init_garmin(email, password):
    tokenstore = os.getenv("GARMIN_TOKENS", "~/.garminconnect")
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
        logger.info(f"Oauth tokens saved to directory '{tokenstore}' for future use.")
        return api

def fetch_garmin_data():
    load_dotenv()
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        logger.error("Credentials not found in .env")
        return

    try:
        client = init_garmin(email, password)
        
        today = datetime.date.today()
        yesterday = today - datetime.timedelta(days=1)
        three_days_ago = today - datetime.timedelta(days=3)
        today_iso = today.isoformat()
        yesterday_iso = yesterday.isoformat()
        three_days_ago_iso = three_days_ago.isoformat()

        # 1. Stats (RHR, Body Battery, Steps)
        stats_today = client.get_stats(today_iso) or {}
        rhr = stats_today.get('restingHeartRate')
        total_steps = stats_today.get('totalSteps')
        
        if rhr is None:
            stats = client.get_stats(yesterday_iso) or {}
            rhr = stats.get('restingHeartRate')
        else:
            stats = stats_today
            
        rhr_7d = stats.get('lastSevenDaysAvgRestingHeartRate')
        bb_wake = stats.get('bodyBatteryAtWakeTime')
        rhr_delta = round(rhr - rhr_7d, 1) if (rhr and rhr_7d) else None

        # 2. Sleep (Sleep Score, Duration)
        sleep_obj = client.get_sleep_data(today_iso) or {}
        sleep_score = (
            sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
            or sleep_obj.get('dailySleepDTO', {}).get('sleepScore', {}).get('value')
            or sleep_obj.get('overallSleepScore', {}).get('value')
            or sleep_obj.get('sleepScore')
        )
        sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds') or sleep_obj.get('sleepTimeSeconds')
        
        if sleep_score is None:
            sleep_obj = client.get_sleep_data(yesterday_iso) or {}
            sleep_score = (
                sleep_obj.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
                or sleep_obj.get('dailySleepDTO', {}).get('sleepScore', {}).get('value')
                or sleep_obj.get('overallSleepScore', {}).get('value')
                or sleep_obj.get('sleepScore')
            )
            sleep_sec = sleep_obj.get('dailySleepDTO', {}).get('sleepTimeSeconds') or sleep_obj.get('totalSleepSeconds') or sleep_obj.get('sleepTimeSeconds')
            
        sleep_min = round(sleep_sec / 60) if sleep_sec else None

        avg_resp = sleep_obj.get('dailySleepDTO', {}).get('averageRespirationValue') or sleep_obj.get('averageRespirationValue')

        # 3. HRV (Nightly + Weekly Averages)
        hrv_obj = client.get_hrv_data(today_iso) or {}
        hrv_weekly = hrv_obj.get('hrvSummary', {}).get('weeklyAvg')
        hrv_last = hrv_obj.get('hrvSummary', {}).get('lastNightAvg')
        hrv_delta = (hrv_last - hrv_weekly) if (hrv_last and hrv_weekly) else None

        # 4. Recent Training Context
        y_train = None
        hard_sessions_count = 0
        activities = client.get_activities_by_date(three_days_ago_iso, yesterday_iso, '') or []
        
        for act in activities:
            # We determine a "hard" session loosely by TE (Training effect) or Heart rate
            te = act.get('aerobicTrainingEffect', 0.0) or 0.0
            avg_hr = act.get('averageHeartRate', 0) or 0
            
            is_hard = (te >= 3.0 or avg_hr >= 145)
            if is_hard:
                hard_sessions_count += 1
                
            # Grab yesterday's training
            act_date = act.get('startTimeLocal', '')[:10]
            if act_date == yesterday_iso:
                if y_train is None:
                    y_train = {
                        "type": act.get("activityType", {}).get("typeKey", "unknown"),
                        "duration_min": round(act.get("duration", 0) / 60) if act.get("duration") else None,
                        "training_effect": te,
                        "intensity_tag": "hard" if is_hard else "moderate/easy"
                    }

        # FINAL PAYLOAD CONSTRUCTION
        payload = {
            "date": today_iso,
            "total_steps": total_steps,
            "sleep_score": sleep_score,
            "sleep_duration_min": sleep_min,
            "rhr": rhr,
            "rhr_7d_avg": rhr_7d,
            "rhr_delta": rhr_delta,
            "hrv_weekly_avg": hrv_weekly,
            "hrv_last_night": hrv_last,
            "hrv_delta": hrv_delta,
            "respiration": avg_resp,
            "body_battery_wake": bb_wake,
            "last_3_days_hard_sessions_count": hard_sessions_count,
            "yesterday_training": y_train
        }

        logger.info("--- TIER 1 METRICS PAYLOAD (UPDATED) ---")
        logger.info("\n" + json.dumps(payload, indent=2))
        logger.info("----------------------------------------")

        # 5. Push to Firebase
        cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-service-account.json")
        if os.path.exists(cred_path):
            try:
                if not firebase_admin._apps:
                    cred = credentials.Certificate(cred_path)
                    firebase_admin.initialize_app(cred)
                
                db = firestore.client()
                doc_ref = db.collection('garmin_metrics').document(today_iso)
                doc_ref.set(payload)
                logger.info(f"Successfully synced {today_iso} metrics to Firestore!")
            except Exception as db_e:
                logger.error(f"Failed to sync with Firebase: {db_e}")
        else:
            logger.warning(f"Firebase credentials not found at {cred_path}. Skipping Firestore sync.")

    except Exception as e:
        logger.error(f"Failed to fetch Garmin data: {e}")

if __name__ == "__main__":
    fetch_garmin_data()
