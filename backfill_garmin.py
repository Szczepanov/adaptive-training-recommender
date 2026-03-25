import os
import datetime
import logging
import json
import argparse
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

def fetch_garmin_backfill(days=30):
    load_dotenv()
    db = setup_firebase()
    
    existing_dates = set()
    if db:
        try:
            # Get all document IDs currently in 'garmin_metrics' collection
            # To avoid large data loads, we fetch minimally by selecting an empty set of fields if possible, 
            # but standard get() is okay for a few hundred records. 
            docs = db.collection('garmin_metrics').stream()
            for doc in docs:
                existing_dates.add(doc.id)
            logger.info(f"Found {len(existing_dates)} existing records in Firestore.")
        except Exception as e:
            logger.error(f"Error reading from Firestore: {e}")

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        logger.error("Credentials not found in .env")
        return

    try:
        client = init_garmin(email, password)
        
        today = datetime.date.today()
        
        for i in range(days):
            target_date = today - datetime.timedelta(days=i)
            target_iso = target_date.isoformat()
            
            if target_iso in existing_dates:
                logger.info(f"Skipping {target_iso} - already exists in Firestore.")
                continue
                
            logger.info(f"Fetching data for {target_iso}...")
            
            yesterday_of_target = target_date - datetime.timedelta(days=1)
            three_days_ago_of_target = target_date - datetime.timedelta(days=3)
            
            target_iso_str = target_iso
            yesterday_iso = yesterday_of_target.isoformat()
            three_days_ago_iso = three_days_ago_of_target.isoformat()

            # 1. Stats (RHR, Body Battery, Steps)
            try:
                stats = client.get_stats(target_iso_str) or {}
            except Exception as e:
                logger.error(f"Failed to get stats for {target_iso_str}: {e}")
                stats = {}
                
            rhr = stats.get('restingHeartRate')
            total_steps = stats.get('totalSteps')
            
            rhr_7d = stats.get('lastSevenDaysAvgRestingHeartRate')
            bb_wake = stats.get('bodyBatteryAtWakeTime')
            rhr_delta = round(rhr - rhr_7d, 1) if (rhr and rhr_7d) else None

            # 2. Sleep (Sleep Score, Duration)
            try:
                sleep_obj = client.get_sleep_data(target_iso_str) or {}
            except Exception:
                sleep_obj = {}
                
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
            try:
                hrv_obj = client.get_hrv_data(target_iso_str) or {}
            except Exception:
                hrv_obj = {}
                
            hrv_weekly = hrv_obj.get('hrvSummary', {}).get('weeklyAvg')
            hrv_last = hrv_obj.get('hrvSummary', {}).get('lastNightAvg')
            hrv_delta = (hrv_last - hrv_weekly) if (hrv_last and hrv_weekly) else None

            # 4. Recent Training Context
            y_train = None
            hard_sessions_count = 0
            try:
                activities = client.get_activities_by_date(three_days_ago_iso, yesterday_iso, '') or []
            except Exception:
                activities = []
                
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
                            "duration_min": round(act.get("duration", 0) / 60) if act.get("duration") else None,
                            "training_effect": te,
                            "intensity_tag": "hard" if is_hard else "moderate/easy"
                        }

            # FINAL PAYLOAD CONSTRUCTION
            payload = {
                "date": target_iso_str,
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

            # 5. Push to Firebase
            if db:
                try:
                    doc_ref = db.collection('garmin_metrics').document(target_iso_str)
                    doc_ref.set(payload)
                    logger.info(f"Successfully synced {target_iso_str} metrics to Firestore!")
                    existing_dates.add(target_iso_str)
                except Exception as db_e:
                    logger.error(f"Failed to sync {target_iso_str} with Firebase: {db_e}")

    except Exception as e:
        logger.error(f"Failed during backfill: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Backfill Garmin data to Firestore.')
    parser.add_argument('--days', type=int, default=30, help='Number of days to look back')
    args = parser.parse_args()
    
    fetch_garmin_backfill(days=args.days)
