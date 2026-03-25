"""
Run this once to refresh your Garmin OAuth tokens.
Running fetch_garmin.py or backfill_garmin.py after this should work without prompts.

If you get 429 Too Many Requests, Garmin has rate-limited your IP.
Wait at least 30-60 minutes before retrying.
"""
import os
import sys
from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()
email = os.getenv("GARMIN_EMAIL")
password = os.getenv("GARMIN_PASSWORD")
tokenstore = os.getenv("GARMIN_TOKENS", ".garth")

api = Garmin(email, password)

# Try loading cached tokens first - avoids unnecessary login requests
if os.path.isdir(tokenstore):
    try:
        api.login(tokenstore)
        print(f"Loaded existing tokens from '{tokenstore}'. Testing connectivity...")
        # Light validation: fetch user profile
        profile = api.get_full_name()
        print(f"Tokens valid! Logged in as: {profile}")
        api.garth.dump(tokenstore)  # Refresh token if needed
        sys.exit(0)
    except Exception as e:
        print(f"Cached tokens invalid or expired ({e}), performing full login...")

# Full login (only when tokens are missing or expired)
print("Performing full Garmin SSO login...")
try:
    api.login()
except Exception as e:
    print(f"\nLogin failed: {e}")
    print("\n⚠️  If you see 429 Too Many Requests:")
    print("   - Garmin has rate-limited your IP due to too many login attempts.")
    print("   - Wait 30-60 minutes before trying again.")
    print("   - Do NOT keep retrying - it extends the block period.")
    sys.exit(1)

os.makedirs(tokenstore, exist_ok=True)
api.garth.dump(tokenstore)
print(f"Tokens saved to '{tokenstore}'. You can now run backfill_garmin.py or fetch_garmin.py.")
