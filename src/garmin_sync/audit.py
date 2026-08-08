import logging
from dataclasses import dataclass

from .archive import RawArchiveStore
from .config import Settings
from .dates import get_date_range, get_date_string, local_today, n_days_ago, parse_date_string
from .firestore_repository import FirestoreRecoveryRepository

logger = logging.getLogger(__name__)

REQUIRED_ARCHIVE_ENDPOINTS = ("stats", "sleep", "hrv", "activities")


@dataclass
class AuditReport:
    start_date: str
    end_date: str
    expected_dates: int
    snapshots_present: int
    missing_snapshots: list[str]
    sleep_available: int
    hrv_available: int
    rhr_available: int
    activities_discovered: int
    archiving_enabled: bool
    raw_payloads_archived: int
    rebuildable_dates: int


def run_audit(
    settings: Settings,
    repository: FirestoreRecoveryRepository,
    archive_store: RawArchiveStore,
    days: int = 90,
    end_date_str: str | None = None,
) -> AuditReport:
    """Compute a GarminDB-style completeness report: expected vs. present snapshots,
    per-metric availability (read from already-stored dataQuality, not recomputed),
    activities discovered, and how much of the range is rebuildable from the raw
    archive without calling Garmin again. `end_date_str` defaults to local today
    (Europe/Warsaw); pass explicitly for deterministic/testable runs."""
    end_d = parse_date_string(end_date_str) if end_date_str else local_today(settings.app_timezone)
    start_d = n_days_ago(end_d, days - 1)
    start_iso = get_date_string(start_d)
    end_iso = get_date_string(end_d)

    expected_dates = get_date_range(start_d, end_d)

    missing_snapshots: list[str] = []
    sleep_available = 0
    hrv_available = 0
    rhr_available = 0
    archived_per_endpoint: dict[str, set[str]] = {}

    for endpoint in REQUIRED_ARCHIVE_ENDPOINTS:
        archived_per_endpoint[endpoint] = archive_store.list_archived_dates(endpoint, start_iso, end_iso)

    for target_date in expected_dates:
        date_iso = get_date_string(target_date)
        snapshot = repository.get_snapshot(date_iso)
        if not snapshot:
            missing_snapshots.append(date_iso)
            continue
        dq = snapshot.get("dataQuality", {})
        if dq.get("sleepScoreAvailable"):
            sleep_available += 1
        if dq.get("hrvAvailable"):
            hrv_available += 1
        if dq.get("restingHrAvailable"):
            rhr_available += 1

    rebuildable_dates = sum(
        1
        for target_date in expected_dates
        if all(get_date_string(target_date) in archived_per_endpoint[e] for e in REQUIRED_ARCHIVE_ENDPOINTS)
    )
    raw_payloads_archived = sum(len(dates) for dates in archived_per_endpoint.values())

    activities_discovered = repository.count_activities_in_range(start_iso, end_iso)

    return AuditReport(
        start_date=start_iso,
        end_date=end_iso,
        expected_dates=len(expected_dates),
        snapshots_present=len(expected_dates) - len(missing_snapshots),
        missing_snapshots=missing_snapshots,
        sleep_available=sleep_available,
        hrv_available=hrv_available,
        rhr_available=rhr_available,
        activities_discovered=activities_discovered,
        archiving_enabled=settings.garmin_archive_enabled,
        raw_payloads_archived=raw_payloads_archived,
        rebuildable_dates=rebuildable_dates,
    )


def format_report(report: AuditReport) -> str:
    lines = [
        f"Garmin sync audit: {report.start_date} -> {report.end_date}",
        "-" * 48,
        f"Expected dates:              {report.expected_dates}",
        f"Snapshots present:           {report.snapshots_present}",
        f"Missing snapshots:           {len(report.missing_snapshots)}",
        f"Sleep available:             {report.sleep_available}",
        f"HRV available:                {report.hrv_available}",
        f"RHR available:                {report.rhr_available}",
        f"Activities discovered:       {report.activities_discovered}",
    ]
    if report.archiving_enabled:
        lines.append(f"Raw payloads archived:        {report.raw_payloads_archived}")
        lines.append(f"Rebuildable dates:            {report.rebuildable_dates}")
    else:
        lines.append("Raw archive:                  disabled (GARMIN_ARCHIVE_ENABLED=false)")
    if report.missing_snapshots:
        preview = ", ".join(report.missing_snapshots[:10])
        more = f" (+{len(report.missing_snapshots) - 10} more)" if len(report.missing_snapshots) > 10 else ""
        lines.append(f"\nMissing dates: {preview}{more}")
    return "\n".join(lines)
