"""
Legacy Firestore Recovery Snapshot Migration Utility.
Migrates documents from legacy collection `daily_recovery_snapshot/{date}`
to user-scoped collection `users/{userId}/daily_recovery_snapshots/{date}`.
"""
import argparse
import logging
import sys
from typing import Any
import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate_snapshots")


def setup_firestore(cred_path: str | None = None) -> firestore.firestore.Client:
    if not firebase_admin._apps:
        if cred_path:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def migrate_snapshots(
    user_id: str,
    dry_run: bool = True,
    start_date: str | None = None,
    end_date: str | None = None,
    delete_source: bool = False,
    cred_path: str | None = None,
) -> None:
    if not user_id or user_id.strip() == "default_user":
        raise ValueError("A valid non-default Firebase Auth UID (--user-id) is required for migration.")

    db = setup_firestore(cred_path)

    query = db.collection("daily_recovery_snapshot")
    if start_date:
        query = query.where("date", ">=", start_date)
    if end_date:
        query = query.where("date", "<=", end_date)

    legacy_docs = list(query.stream())

    scanned = len(legacy_docs)
    eligible = 0
    copied = 0
    skipped = 0
    conflicted = 0
    failed = 0

    logger.info(f"Scanned {scanned} legacy snapshots. Starting migration (dry_run={dry_run})...")

    for doc in legacy_docs:
        date_id = doc.id
        data = doc.to_dict()

        target_ref = db.collection("users").document(user_id).collection("daily_recovery_snapshots").document(date_id)
        target_snap = target_ref.get()

        if target_snap.exists:
            target_data = target_snap.to_dict()
            # If user-scoped doc already exists and updated_at is newer, skip to prevent overwriting
            target_updated = target_data.get("updatedAt", "")
            legacy_updated = data.get("updatedAt", "")
            if target_updated and legacy_updated and target_updated > legacy_updated:
                logger.info(f"[{date_id}] Target user-scoped document is newer than legacy doc. Skipping.")
                conflicted += 1
                continue

        eligible += 1

        # Prepare updated payload
        migrated_payload = dict(data)
        migrated_payload["userId"] = user_id

        source_meta = dict(migrated_payload.get("source", {}))
        source_meta["migratedFromLegacy"] = True
        source_meta["legacyDocumentPath"] = f"daily_recovery_snapshot/{date_id}"
        migrated_payload["source"] = source_meta

        if dry_run:
            logger.info(f"[DRY-RUN] Would write legacy snapshot '{date_id}' to users/{user_id}/daily_recovery_snapshots/{date_id}")
            copied += 1
        else:
            try:
                target_ref.set(migrated_payload, merge=True)
                copied += 1
                logger.info(f"[{date_id}] Successfully migrated to users/{user_id}/daily_recovery_snapshots/{date_id}")

                if delete_source:
                    doc.reference.delete()
                    logger.info(f"[{date_id}] Deleted legacy source document.")
            except Exception as e:
                logger.error(f"[{date_id}] Migration failed: {e}")
                failed += 1

    logger.info("=== Migration Summary ===")
    logger.info(f"Scanned:    {scanned}")
    logger.info(f"Eligible:   {eligible}")
    logger.info(f"Copied:     {copied}")
    logger.info(f"Skipped:    {skipped}")
    logger.info(f"Conflicted: {conflicted}")
    logger.info(f"Failed:     {failed}")
    if dry_run:
        logger.info("=== Note: This was a DRY-RUN. No data was modified. ===")


def main():
    parser = argparse.ArgumentParser(description="Migrate legacy Firestore recovery snapshots to user-scoped path.")
    parser.add_argument("--user-id", type=str, required=True, help="Target application Firebase Auth UID")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Simulate migration without writing (default True)")
    parser.add_argument("--no-dry-run", action="store_false", dest="dry_run", help="Execute actual migration writes")
    parser.add_argument("--start-date", type=str, default=None, help="Optional start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="Optional end date YYYY-MM-DD")
    parser.add_argument("--delete-source", action="store_true", help="Delete legacy source documents after copying")
    parser.add_argument("--credentials", type=str, default=None, help="Path to firebase service account json")

    args = parser.parse_args()

    try:
        migrate_snapshots(
            user_id=args.user_id,
            dry_run=args.dry_run,
            start_date=args.start_date,
            end_date=args.end_date,
            delete_source=args.delete_source,
            cred_path=args.credentials,
        )
    except Exception as e:
        logger.error(f"Migration script error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
