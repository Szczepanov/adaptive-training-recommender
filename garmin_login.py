"""
Run this once to refresh your Garmin OAuth tokens.
Running fetch_garmin.py or backfill_garmin.py after this should work without prompts.
"""
import os
from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()
email = os.getenv("GARMIN_EMAIL")
password = os.getenv("GARMIN_PASSWORD")
tokenstore = os.getenv("GARMIN_TOKENS", ".garth")

api = Garmin(email, password)
api.login()
os.makedirs(tokenstore, exist_ok=True)
api.garth.dump(tokenstore)
print(f"Tokens saved to '{tokenstore}'. You can now run backfill_garmin.py or fetch_garmin.py.")
