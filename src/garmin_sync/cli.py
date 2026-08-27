import argparse
import logging
import os
import sys
from collections.abc import Callable
from typing import Any

from .account_link import list_active_garmin_connections
from .audit import format_report, run_audit
from .config import load_settings, load_settings_for_user
from .coordination import GarminExecutionLease
from .error_reporting import log_exception
from .service import GarminSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("garmin_sync")


def _run_with_user_lease(
    operation_name: str,
    service: GarminSyncService,
    operation: Callable[[GarminSyncService], bool],
) -> bool:
    """Run one Garmin operation while holding the shared per-user Firestore lease.

    A busy lease is a successful no-op: another process is already doing Garmin work for
    this user, and the next scheduled tick will pick up anything still pending. Lease release
    errors intentionally propagate so Cloud Run records a failure instead of silently leaving
    the user blocked until expiry.
    """
    lease = GarminExecutionLease(
        service.repository.db,
        service.settings.app_user_id,
        operation_name,
    )
    if not lease.acquire():
        logger.info(
            "%s: skipped because another Garmin operation is already running", operation_name
        )
        return True

    try:
        return operation(service)
    finally:
        lease.release()


def _run_for_all_users(operation_name: str, operation: Callable[[GarminSyncService], bool]) -> int:
    """Run a scheduled operation for every active self-service Garmin link.

    Users are discovered from the server-only garminConnections collection and processed
    sequentially to isolate Garmin sessions and avoid multiplying API pressure. Each user
    also gets a durable Firestore lease, so separate Cloud Run executions cannot overlap
    sync/manual-sync/workout work for that same Garmin account. A failure for one user does
    not prevent later users from running, but the process returns non-zero so Cloud
    Run/Scheduler records a partial failure.
    """
    try:
        connections = list_active_garmin_connections()
    except Exception as error:
        log_exception(
            logger,
            operation_name,
            error,
            context={"stage": "linked_user_discovery"},
        )
        return 1

    if not connections:
        logger.info("%s: no active Garmin links; nothing to do", operation_name)
        return 0

    failed_count = 0
    for index, (uid, token_object) in enumerate(connections, start=1):
        try:
            logger.info("%s: starting linked user %d/%d", operation_name, index, len(connections))
            settings = load_settings_for_user(uid, token_object=token_object)
            service = GarminSyncService(settings)
            if not _run_with_user_lease(operation_name, service, operation):
                failed_count += 1
                logger.error("%s: unsuccessful linked user %d", operation_name, index)
            else:
                logger.info("%s: complete linked user %d", operation_name, index)
        except Exception as error:
            failed_count += 1
            log_exception(
                logger,
                operation_name,
                error,
                context={
                    "stage": "linked_user_execution",
                    "user_index": index,
                    "linked_user_count": len(connections),
                },
            )

    if failed_count:
        logger.error(
            "%s failed for %d/%d linked users",
            operation_name,
            failed_count,
            len(connections),
        )
        return 1
    return 0


def run_daily_sync(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run daily Garmin recovery ingestion.")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date YYYY-MM-DD (default local today in Warsaw)",
    )
    parser.add_argument(
        "--force", action="store_true", help="Force refresh even if snapshot is fresh"
    )
    parser.add_argument(
        "--resync-days",
        type=int,
        default=None,
        help="Days before --date to also force-resync (default GARMIN_RESYNC_LOOKBACK_DAYS, normally 1). "
        "Picks up late-arriving Garmin data for prior days, e.g. a training session logged after that day's own sync ran.",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "daily sync",
            service,
            lambda current_service: current_service.sync_daily(
                target_date_str=parsed_args.date,
                force=parsed_args.force,
                resync_lookback_days=parsed_args.resync_days,
                auto_backfill_cold_start=True,
            ),
        )
        return 0 if success else 1
    except Exception as error:
        log_exception(
            logger,
            "daily sync",
            error,
            context={
                "date": parsed_args.date,
                "force": parsed_args.force,
                "resync_days": parsed_args.resync_days,
            },
        )
        return 1


def run_daily_sync_all(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run daily Garmin ingestion for linked users.")
    parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Force refresh")
    parser.add_argument("--resync-days", type=int, default=None)
    parsed_args = parser.parse_args(args)
    return _run_for_all_users(
        "daily sync",
        lambda service: service.sync_daily(
            target_date_str=parsed_args.date,
            force=parsed_args.force,
            resync_lookback_days=parsed_args.resync_days,
            auto_backfill_cold_start=True,
        ),
    )


def run_backfill(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run historical Garmin backfill.")
    parser.add_argument(
        "--days", type=int, default=56, help="Number of days to backfill (default 56)"
    )
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Force re-fetching existing records")
    parser.add_argument(
        "--include-details",
        action="store_true",
        help="Also fetch and persist power/HR zones and lap details for qualifying activities",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "backfill",
            service,
            lambda current_service: current_service.backfill(
                days=parsed_args.days,
                start_date_str=parsed_args.start_date,
                end_date_str=parsed_args.end_date,
                force=parsed_args.force,
                include_details=parsed_args.include_details,
            ),
        )
        return 0 if success else 1
    except Exception as error:
        log_exception(
            logger,
            "backfill",
            error,
            context={
                "days": parsed_args.days,
                "start_date": parsed_args.start_date,
                "end_date": parsed_args.end_date,
                "force": parsed_args.force,
                "include_details": parsed_args.include_details,
            },
        )
        return 1


def run_audit_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Report Garmin sync completeness (GarminDB-style audit)."
    )
    parser.add_argument(
        "--days", type=int, default=90, help="Number of trailing days to audit (default 90)"
    )
    parser.add_argument(
        "--end-date", type=str, default=None, help="End date YYYY-MM-DD (default local today)"
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        report = run_audit(
            settings,
            service.repository,
            service.archive_store,
            days=parsed_args.days,
            end_date_str=parsed_args.end_date,
        )
        print(format_report(report))
        return 0
    except Exception as error:
        log_exception(
            logger,
            "audit",
            error,
            context={"days": parsed_args.days, "end_date": parsed_args.end_date},
        )
        return 1


def run_rebuild_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild Firestore snapshots from the raw archive, offline (no Garmin calls)."
    )
    parser.add_argument("--start-date", type=str, required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, required=True, help="End date YYYY-MM-DD")
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = service.rebuild(parsed_args.start_date, parsed_args.end_date)
        return 0 if success else 1
    except Exception as error:
        log_exception(
            logger,
            "rebuild",
            error,
            context={"start_date": parsed_args.start_date, "end_date": parsed_args.end_date},
        )
        return 1


def run_push_workout_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Upload and schedule a queued structured workout to Garmin Connect."
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date YYYY-MM-DD (default local today in Warsaw)",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "push workout",
            service,
            lambda current_service: current_service.push_workout(date_str=parsed_args.date),
        )
        return 0 if success else 1
    except Exception as error:
        log_exception(
            logger,
            "push workout",
            error,
            context={"date": parsed_args.date},
        )
        return 1


def run_push_pending_workouts_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Poll the Firestore workout queue and push every pending item to Garmin Connect."
    )
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=14,
        help="Leave (don't push) queue items older than this many days pending (default 14)",
    )
    parsed_args = parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "push pending workouts",
            service,
            lambda current_service: current_service.push_pending_workouts(
                max_age_days=parsed_args.max_age_days
            ),
        )
        return 0 if success else 1
    except Exception as error:
        log_exception(
            logger,
            "push pending workouts",
            error,
            context={"max_age_days": parsed_args.max_age_days},
        )
        return 1


def run_push_pending_workouts_all_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Push pending workouts for linked users.")
    parser.add_argument("--max-age-days", type=int, default=14)
    parsed_args = parser.parse_args(args)
    return _run_for_all_users(
        "push pending workouts",
        lambda service: service.push_pending_workouts(max_age_days=parsed_args.max_age_days),
    )


def run_poll_manual_sync_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Poll for a manual 'Sync Now' request from the web app and run an "
        "immediate forced sync if one is pending."
    )
    parser.parse_args(args)

    try:
        settings = load_settings()
        service = GarminSyncService(settings)
        success = _run_with_user_lease(
            "poll manual sync",
            service,
            lambda current_service: current_service.poll_manual_sync_requests(),
        )
        return 0 if success else 1
    except Exception as error:
        log_exception(logger, "poll manual sync", error)
        return 1


def run_poll_manual_sync_all_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Poll manual sync requests for linked users.")
    parser.parse_args(args)
    return _run_for_all_users(
        "poll manual sync", lambda service: service.poll_manual_sync_requests()
    )


def _resolve_google_health_auth_manager(
    parsed_args: argparse.Namespace,
) -> tuple[Any | None, str | None]:
    """Resolve Google Health AuthManager from CLI flags or environment variables."""
    import os
    import time

    from dotenv import load_dotenv

    from .google_health_auth import GoogleHealthAuthManager, GoogleHealthTokenCredentials

    # Probe/backfill-health entry points don't otherwise call load_settings()/load_dotenv()
    # before this resolves credentials, so a repo-root .env would silently be ignored without
    # this explicit load (CLI flags still take precedence below).
    load_dotenv()

    token = parsed_args.token or os.environ.get("GOOGLE_HEALTH_ACCESS_TOKEN")
    client_id = parsed_args.client_id or os.environ.get("GOOGLE_HEALTH_CLIENT_ID")
    client_secret = parsed_args.client_secret or os.environ.get("GOOGLE_HEALTH_CLIENT_SECRET")
    refresh_token = parsed_args.refresh_token or os.environ.get("GOOGLE_HEALTH_REFRESH_TOKEN")

    if not token and not (client_id and client_secret and refresh_token):
        return None, "No Google Health credentials or access token were provided."

    # Prefer the refresh-token path whenever it's fully available: it can renew itself when
    # the access token expires mid-run (confirmed live 2026-08-27: a 60-day backfill outlives
    # a raw access token's ~1hr lifetime), whereas a bare access token cannot refresh at all
    # and just starts failing partway through. Only fall back to the direct-token-only path
    # when refresh credentials aren't fully available. See
    # docs/plans/2026-08-27-real-google-health-ingestion.md.
    if client_id and client_secret and refresh_token:
        # expires_at=0.0 forces an immediate refresh on first use rather than trusting a
        # possibly-already-stale `token` value from .env/--token.
        creds = GoogleHealthTokenCredentials(
            access_token=token or "",
            refresh_token=refresh_token,
            expires_at=0.0,
        )
        return (
            GoogleHealthAuthManager(
                client_id=client_id,
                client_secret=client_secret,
                credentials=creds,
            ),
            None,
        )

    if token:
        creds = GoogleHealthTokenCredentials(
            access_token=token,
            refresh_token="",
            expires_at=time.time() + 3600,
        )
        return (
            GoogleHealthAuthManager(
                client_id="direct_token",
                client_secret="direct_token",
                credentials=creds,
            ),
            None,
        )

    creds = GoogleHealthTokenCredentials(
        access_token="",
        refresh_token=refresh_token or "",
        expires_at=0.0,
    )
    return (
        GoogleHealthAuthManager(
            client_id=client_id or "",
            client_secret=client_secret or "",
            credentials=creds,
        ),
        None,
    )


def _resolve_date_range(parsed_args: argparse.Namespace, default_days: int = 56) -> tuple[str, str]:
    """Resolve start_date and end_date strings in YYYY-MM-DD format."""
    from datetime import datetime, timedelta

    from .dates import local_today

    end_date_str = parsed_args.end_date or local_today().strftime("%Y-%m-%d")
    if parsed_args.start_date:
        start_date_str = parsed_args.start_date
    else:
        days = getattr(parsed_args, "days", default_days) or default_days
        end_dt = datetime.strptime(end_date_str, "%Y-%m-%d")
        start_date_str = (end_dt - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    return start_date_str, end_date_str


def run_probe_health_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Google Health source-provenance probe (MS0).")
    parser.add_argument(
        "--token", type=str, default=None, help="Google OAuth access token for local-debug testing"
    )
    parser.add_argument("--client-id", type=str, default=None, help="Google OAuth Client ID")
    parser.add_argument(
        "--client-secret", type=str, default=None, help="Google OAuth Client Secret"
    )
    parser.add_argument(
        "--refresh-token", type=str, default=None, help="Google OAuth Refresh Token"
    )
    parser.add_argument("--start-time", type=str, default=None, help="Start ISO timestamp")
    parser.add_argument("--end-time", type=str, default=None, help="End ISO timestamp")
    parsed_args = parser.parse_args(args)

    from .google_health_client import GoogleHealthClient
    from .health_probe import HealthProvenanceProbe

    auth_manager, err = _resolve_google_health_auth_manager(parsed_args)
    if err or not auth_manager:
        print("\n" + "=" * 70)
        print("  GOOGLE HEALTH SOURCE-PROVENANCE PROBE (MS0)")
        print("=" * 70)
        print(f"\n{err}\n")
        print("To run the probe on your real account, choose one of these options:")
        print("\nOption A: Pass a temporary access token from Google OAuth Playground:")
        print("  uv run python -m garmin_sync probe-health --token <YOUR_ACCESS_TOKEN>\n")
        print("Option B: Pass full OAuth credentials:")
        print(
            "  uv run python -m garmin_sync probe-health --client-id <ID> --client-secret <SECRET> --refresh-token <REFRESH_TOKEN>\n"
        )
        print("Option C: Set environment variables (Recommended):")
        print("  $env:GOOGLE_HEALTH_ACCESS_TOKEN='<YOUR_ACCESS_TOKEN>'")
        print("  uv run python -m garmin_sync probe-health\n")
        print("=" * 70 + "\n")
        return 1

    try:
        client = GoogleHealthClient(auth_manager=auth_manager)
        probe = HealthProvenanceProbe(client=client)

        print("\nRunning Google Health source-provenance probe...")
        result = probe.run_probe(
            start_time_iso=parsed_args.start_time,
            end_time_iso=parsed_args.end_time,
        )

        total_pts = sum(s.totalDataPoints for s in result.dataTypesSummary)
        print("\n" + "=" * 75)
        print("  GOOGLE HEALTH SOURCE-PROVENANCE PROBE REPORT (MS0)")
        print("=" * 75)
        print(f"  Execution Time:             {result.timestamp}")
        print(f"  Eight Sleep Export Status:  {result.eightSleepStatus}")
        print(f"  Garmin Export Status:       {result.garminStatus}")
        print(f"  Total Data Points Audited:  {total_pts}")
        print("-" * 75)
        print(
            f"{'Data Type':<26} {'Points':<8} {'Garmin?':<10} {'EightSleep?':<12} {'Other Packages'}"
        )
        print("-" * 75)
        for s in result.dataTypesSummary:
            other_pkgs = ", ".join(s.otherSourcesSeen) if s.otherSourcesSeen else "none"
            garmin_str = "YES" if s.garminSeen else "NO"
            eight_str = "YES" if s.eightSleepSeen else "NO"
            print(
                f"{s.dataType:<26} {s.totalDataPoints:<8} {garmin_str:<10} {eight_str:<12} {other_pkgs}"
            )
        print("=" * 75 + "\n")
        return 0

    except Exception as error:
        log_exception(logger, "probe health", error)
        return 1


def run_backfill_health_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run historical backfill for Google Health (Eight Sleep & Garmin)."
    )
    parser.add_argument("--days", type=int, default=56, help="Number of trailing days (default 56)")
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument(
        "--token", type=str, default=None, help="Google OAuth access token for local debug"
    )
    parser.add_argument("--client-id", type=str, default=None, help="Google OAuth Client ID")
    parser.add_argument(
        "--client-secret", type=str, default=None, help="Google OAuth Client Secret"
    )
    parser.add_argument(
        "--refresh-token", type=str, default=None, help="Google OAuth Refresh Token"
    )
    parser.add_argument(
        "--user-id",
        type=str,
        default=None,
        help="Target application User ID (or APP_USER_ID env var)",
    )
    parsed_args = parser.parse_args(args)

    import os

    from .archive import create_archive_store
    from .firestore_repository import FirestoreRecoveryRepository
    from .google_health_client import GoogleHealthClient
    from .google_health_mapper import GoogleHealthMapper
    from .google_health_provider import GoogleHealthProvider
    from .health_observation_service import HealthObservationService

    if parsed_args.user_id:
        os.environ["APP_USER_ID"] = parsed_args.user_id

    auth_manager, err = _resolve_google_health_auth_manager(parsed_args)
    if err or not auth_manager:
        print("\n" + "=" * 70)
        print("  GOOGLE HEALTH BACKFILL (backfill-health)")
        print("=" * 70)
        print(f"\n{err}\n")
        print("Pass an access token or set GOOGLE_HEALTH_ACCESS_TOKEN:")
        print(
            "  uv run python -m garmin_sync backfill-health --token <ACCESS_TOKEN> --days 56 --user-id <USER_ID>\n"
        )
        print("=" * 70 + "\n")
        return 1

    try:
        settings = load_settings()
        repo = FirestoreRecoveryRepository(
            user_id=settings.app_user_id,
            collection_name=settings.firestore_recovery_collection,
            db=None,
            credentials_path=settings.firebase_credentials_path,
        )
        archive = create_archive_store(
            enabled=settings.garmin_archive_enabled,
            store_type=settings.garmin_archive_store,
            local_dir=settings.garmin_archive_local_dir,
            bucket_name=settings.resolved_archive_bucket(),
            prefix=settings.garmin_archive_prefix,
        )

        client = GoogleHealthClient(auth_manager=auth_manager)
        mapper = GoogleHealthMapper(user_id=settings.app_user_id)
        provider = GoogleHealthProvider(client=client, mapper=mapper)

        service = HealthObservationService(
            user_id=settings.app_user_id,
            repository=repo,
            archive_store=archive,
            providers={"google_health": provider},
        )

        start_date_str, end_date_str = _resolve_date_range(parsed_args, default_days=56)

        print(
            f"\nRunning Google Health backfill for {settings.app_user_id}: {start_date_str} to {end_date_str}..."
        )
        summary = service.backfill_range(start_date_str, end_date_str)

        total_obs = 0
        saved_bundles = 0
        for item in summary:
            results = item.get("results", {}).get("google_health", {})
            total_obs += results.get("totalObservations", 0)
            sources = results.get("sources", {})
            for _src_key, src_res in sources.items():
                if src_res.get("status") == "saved":
                    saved_bundles += 1

        print("\n" + "=" * 70)
        print("  GOOGLE HEALTH BACKFILL COMPLETED")
        print("=" * 70)
        print(f"  Dates Processed:      {len(summary)}")
        print(f"  Total Observations:   {total_obs}")
        print(f"  Day Bundles Saved:    {saved_bundles}")
        print("=" * 70 + "\n")
        return 0

    except Exception as error:
        log_exception(logger, "backfill health", error)
        return 1


def run_compare_transports_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Garmin direct vs Google Health transport equivalence analysis (MS10)."
    )
    parser.add_argument("--days", type=int, default=60, help="Number of trailing days (default 60)")
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--user-id", type=str, default=None, help="Application User ID")
    parsed_args = parser.parse_args(args)

    import os

    from .equivalence import run_equivalence_analysis
    from .firestore_repository import FirestoreRecoveryRepository

    if parsed_args.user_id:
        os.environ["APP_USER_ID"] = parsed_args.user_id

    try:
        settings = load_settings()
        repo = FirestoreRecoveryRepository(
            user_id=settings.app_user_id,
            collection_name=settings.firestore_recovery_collection,
            db=None,
            credentials_path=settings.firebase_credentials_path,
        )

        start_date_str, end_date_str = _resolve_date_range(parsed_args, default_days=56)

        print(
            f"\nRunning Garmin transport equivalence analysis for {settings.app_user_id}: {start_date_str} to {end_date_str}..."
        )
        report = run_equivalence_analysis(repo, start_date_str, end_date_str)

        print("\n" + "=" * 80)
        print("  GARMIN DIRECT VS GOOGLE HEALTH TRANSPORT EQUIVALENCE REPORT (MS10)")
        print("=" * 80)
        print(f"  Date Range:                 {report.startDate} to {report.endDate}")
        print(f"  Overlapping Dates:          {report.totalOverlapDays}")
        print(f"  Direct-Only Dates:          {report.directOnlyDays}")
        print(f"  Google-Only Dates:          {report.googleOnlyDays}")
        print(f"  Overall Classification:     {report.overallClassification}")
        print("-" * 80)
        print(
            f"{'Metric':<34} {'Evaluated':<10} {'Matches':<10} {'Match %':<10} {'Mean Delta':<12}"
        )
        print("-" * 80)
        for m, s in report.metricSummaries.items():
            print(
                f"{m:<34} {s['totalEvaluated']:<10} {s['matchCount']:<10} {s['matchRatePct']:<9}% {s['meanDifference']:<12}"
            )
        print("=" * 80 + "\n")
        return 0

    except Exception as error:
        log_exception(logger, "compare transports", error)
        return 1


def run_audit_multisource_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run multisource shadow audit between Garmin Direct and Eight Sleep (MS14)."
    )
    parser.add_argument("--days", type=int, default=60, help="Number of trailing days (default 60)")
    parser.add_argument("--start-date", type=str, default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--user-id", type=str, default=None, help="Application User ID")
    parsed_args = parser.parse_args(args)

    from .firestore_repository import FirestoreRecoveryRepository
    from .multisource_audit import run_multisource_audit

    if parsed_args.user_id:
        os.environ["APP_USER_ID"] = parsed_args.user_id

    try:
        settings = load_settings()
        repo = FirestoreRecoveryRepository(
            user_id=settings.app_user_id,
            collection_name=settings.firestore_recovery_collection,
            db=None,
            credentials_path=settings.firebase_credentials_path,
        )

        start_date_str, end_date_str = _resolve_date_range(parsed_args, default_days=60)

        print(
            f"\nRunning multisource shadow audit for {settings.app_user_id}: {start_date_str} to {end_date_str}..."
        )
        report = run_multisource_audit(repo, start_date_str, end_date_str)

        print("\n" + "=" * 80)
        print("  MULTISOURCE SHADOW AUDIT REPORT (GARMIN DIRECT VS EIGHT SLEEP) — MS14")
        print("=" * 80)
        print(
            f"  Date Range:                 {report.startDate} to {report.endDate} ({report.totalDays} days)"
        )
        both_pct = (
            round(report.bothSourcesDays / report.totalDays * 100, 1)
            if report.totalDays > 0
            else 0.0
        )
        print(f"  Both Sources Available:     {report.bothSourcesDays} nights ({both_pct}%)")
        print(f"  Garmin Direct Only:         {report.garminOnlyDays} nights")
        print(f"  Eight Sleep Only:           {report.eightSleepOnlyDays} nights")
        print(f"  Neither Source:             {report.neitherDays} nights")
        print("-" * 80)
        print("  CROSS-SOURCE AGREEMENT TELEMETRY:")
        print(f"  Sleep Duration Mean Delta:  {report.sleepDurationMeanDiffMinutes} minutes")
        print(
            f"  Sleep Duration Correlation: {report.sleepDurationCorrelation if report.sleepDurationCorrelation is not None else 'N/A'}"
        )
        print("-" * 80)
        print("  EIGHT SLEEP ROLLING BASELINE TELEMETRY:")
        print(
            f"  HRV RMSSD (N={report.eightSleepHrvCount}):           Median = {report.eightSleepHrvMedian} ms, MAD = {report.eightSleepHrvMad} ms"
        )
        print(
            f"  Respiration Rate (N={report.eightSleepRespCount}):    Median = {report.eightSleepRespMedian} brpm, MAD = {report.eightSleepRespMad} brpm"
        )
        print("=" * 80 + "\n")
        return 0

    except Exception as error:
        log_exception(logger, "audit multisource", error)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Garmin Sync Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser("sync", help="Run daily sync for APP_USER_ID")
    sync_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_parser.add_argument("--force", action="store_true", help="Force refresh")
    sync_parser.add_argument("--resync-days", type=int, default=None)

    sync_all_parser = subparsers.add_parser(
        "sync-all", help="Run daily sync for every active Garmin link"
    )
    sync_all_parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD")
    sync_all_parser.add_argument("--force", action="store_true", help="Force refresh")
    sync_all_parser.add_argument("--resync-days", type=int, default=None)

    backfill_parser = subparsers.add_parser("backfill", help="Run historical backfill")
    backfill_parser.add_argument("--days", type=int, default=56, help="Number of days to backfill")
    backfill_parser.add_argument(
        "--start-date", type=str, default=None, help="Start date YYYY-MM-DD"
    )
    backfill_parser.add_argument("--end-date", type=str, default=None, help="End date YYYY-MM-DD")
    backfill_parser.add_argument("--force", action="store_true", help="Force re-fetch")
    backfill_parser.add_argument("--include-details", action="store_true")

    backfill_health_parser = subparsers.add_parser(
        "backfill-health", help="Run historical backfill for Google Health (Eight Sleep & Garmin)"
    )
    backfill_health_parser.add_argument("--days", type=int, default=56)
    backfill_health_parser.add_argument("--start-date", type=str, default=None)
    backfill_health_parser.add_argument("--end-date", type=str, default=None)
    backfill_health_parser.add_argument("--token", type=str, default=None)
    backfill_health_parser.add_argument("--client-id", type=str, default=None)
    backfill_health_parser.add_argument("--client-secret", type=str, default=None)
    backfill_health_parser.add_argument("--refresh-token", type=str, default=None)
    backfill_health_parser.add_argument("--user-id", type=str, default=None)

    audit_parser = subparsers.add_parser("audit", help="Report sync completeness")
    audit_parser.add_argument("--days", type=int, default=90)
    audit_parser.add_argument("--end-date", type=str, default=None)

    rebuild_parser = subparsers.add_parser("rebuild", help="Rebuild snapshots from raw archive")
    rebuild_parser.add_argument("--start-date", type=str, required=True)
    rebuild_parser.add_argument("--end-date", type=str, required=True)

    probe_health_parser = subparsers.add_parser(
        "probe-health", help="Run Google Health source-provenance probe (MS0)"
    )
    probe_health_parser.add_argument("--token", type=str, default=None)
    probe_health_parser.add_argument("--client-id", type=str, default=None)
    probe_health_parser.add_argument("--client-secret", type=str, default=None)
    probe_health_parser.add_argument("--refresh-token", type=str, default=None)
    probe_health_parser.add_argument("--start-time", type=str, default=None)
    probe_health_parser.add_argument("--end-time", type=str, default=None)

    compare_transports_parser = subparsers.add_parser(
        "compare-transports",
        help="Run Garmin direct vs Google Health transport equivalence analysis (MS10)",
    )
    compare_transports_parser.add_argument("--days", type=int, default=60)
    compare_transports_parser.add_argument("--start-date", type=str, default=None)
    compare_transports_parser.add_argument("--end-date", type=str, default=None)
    compare_transports_parser.add_argument("--user-id", type=str, default=None)

    audit_multisource_parser = subparsers.add_parser(
        "audit-multisource",
        help="Run multisource shadow audit between Garmin Direct and Eight Sleep (MS14)",
    )
    audit_multisource_parser.add_argument("--days", type=int, default=60)
    audit_multisource_parser.add_argument("--start-date", type=str, default=None)
    audit_multisource_parser.add_argument("--end-date", type=str, default=None)
    audit_multisource_parser.add_argument("--user-id", type=str, default=None)

    push_workout_parser = subparsers.add_parser("push-workout", help="Push one queued workout")
    push_workout_parser.add_argument("--date", type=str, default=None)

    push_pending_parser = subparsers.add_parser(
        "push-pending-workouts", help="Push pending workouts for APP_USER_ID"
    )
    push_pending_parser.add_argument("--max-age-days", type=int, default=14)

    push_pending_all_parser = subparsers.add_parser(
        "push-pending-workouts-all", help="Push pending workouts for every active Garmin link"
    )
    push_pending_all_parser.add_argument("--max-age-days", type=int, default=14)

    subparsers.add_parser("poll-manual-sync", help="Poll manual sync for APP_USER_ID")
    subparsers.add_parser(
        "poll-manual-sync-all", help="Poll manual sync for every active Garmin link"
    )

    args = parser.parse_args()

    if args.command == "sync":
        return run_daily_sync(sys.argv[2:])
    if args.command == "sync-all":
        return run_daily_sync_all(sys.argv[2:])
    if args.command == "backfill":
        return run_backfill(sys.argv[2:])
    if args.command == "backfill-health":
        return run_backfill_health_cmd(sys.argv[2:])
    if args.command == "compare-transports":
        return run_compare_transports_cmd(sys.argv[2:])
    if args.command == "audit-multisource":
        return run_audit_multisource_cmd(sys.argv[2:])
    if args.command == "audit":
        return run_audit_cmd(sys.argv[2:])
    if args.command == "rebuild":
        return run_rebuild_cmd(sys.argv[2:])
    if args.command == "probe-health":
        return run_probe_health_cmd(sys.argv[2:])
    if args.command == "push-workout":
        return run_push_workout_cmd(sys.argv[2:])
    if args.command == "push-pending-workouts":
        return run_push_pending_workouts_cmd(sys.argv[2:])
    if args.command == "push-pending-workouts-all":
        return run_push_pending_workouts_all_cmd(sys.argv[2:])
    if args.command == "poll-manual-sync":
        return run_poll_manual_sync_cmd(sys.argv[2:])
    if args.command == "poll-manual-sync-all":
        return run_poll_manual_sync_all_cmd(sys.argv[2:])
    return 1


if __name__ == "__main__":
    sys.exit(main())
