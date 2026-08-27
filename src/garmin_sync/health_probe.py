"""Google Health source-provenance probe runner (MS0/ADR-0027).

Executes the inspection procedures described in docs/ops/google-health-source-provenance-probe.md
and produces sanitized source-matrix evidence without leaking OAuth credentials or personal
health data.
"""

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from .google_health_client import GoogleHealthAccountNotLinkedError, GoogleHealthClient
from .google_health_mapper import resolve_provider_from_package

logger = logging.getLogger(__name__)

PROBE_DATA_TYPES = [
    "sleep",
    "daily-heart-rate-variability",
    "daily-resting-heart-rate",
    "daily-respiratory-rate",
]


@dataclass
class DataTypeSourceSummary:
    dataType: str
    garminSeen: bool = False
    eightSleepSeen: bool = False
    otherSourcesSeen: list[str] = field(default_factory=list)
    hasStableRecordId: bool = False
    hasDeviceMetadata: bool = False
    totalDataPoints: int = 0
    samplePackages: list[str] = field(default_factory=list)


@dataclass
class ProbeAnalysisResult:
    timestamp: str
    scopesTested: list[str]
    eightSleepStatus: str  # "FULL_PASS", "PARTIAL_PASS", "FAIL"
    garminStatus: str  # "PRESENT", "ABSENT"
    dataTypesSummary: list[DataTypeSourceSummary] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "scopesTested": self.scopesTested,
            "eightSleepStatus": self.eightSleepStatus,
            "garminStatus": self.garminStatus,
            "dataTypesSummary": [asdict(s) for s in self.dataTypesSummary],
            "notes": self.notes,
        }


class HealthProvenanceProbe:
    """Probe runner to empirically verify Google Health data types and origin application metadata."""

    def __init__(self, client: GoogleHealthClient, scopes: list[str] | None = None):
        self.client = client
        self.scopes = scopes or []

    def run_probe(
        self,
        start_time_iso: str | None = None,
        end_time_iso: str | None = None,
    ) -> ProbeAnalysisResult:
        """Run inspection against all candidate recovery data types and build sanitized report."""
        summaries: list[DataTypeSourceSummary] = []
        eight_sleep_metrics_seen: set[str] = set()
        garmin_metrics_seen: set[str] = set()
        notes: list[str] = []

        for dtype in PROBE_DATA_TYPES:
            summary = DataTypeSourceSummary(dataType=dtype)
            packages_seen: set[str] = set()

            try:
                points = self.client.list_data_points(
                    data_type=dtype,
                    start_time_iso=start_time_iso,
                    end_time_iso=end_time_iso,
                    page_size=50,
                )
                summary.totalDataPoints = len(points)

                for pt in points:
                    ds = pt.get("dataSource", {}) or {}
                    app = ds.get("application", {}) or {}
                    pkg = app.get("packageName") or app.get("id") or "unknown"
                    packages_seen.add(pkg)

                    dev = ds.get("device", {}) or {}
                    if dev.get("model") or dev.get("id"):
                        summary.hasDeviceMetadata = True

                    if pt.get("dataPointId") or pt.get("id"):
                        summary.hasStableRecordId = True

                    provider = resolve_provider_from_package(pkg)
                    if provider == "garmin":
                        summary.garminSeen = True
                        garmin_metrics_seen.add(dtype)
                    elif provider == "eight_sleep":
                        summary.eightSleepSeen = True
                        eight_sleep_metrics_seen.add(dtype)
                    else:
                        if pkg not in summary.otherSourcesSeen:
                            summary.otherSourcesSeen.append(pkg)

                summary.samplePackages = sorted(list(packages_seen))
            except GoogleHealthAccountNotLinkedError as e:
                logger.warning(
                    "Google Health account not linked. Onboarding required: %s",
                    e.redirect_uri or "https://fitbit.google.com/auth/signup",
                )
                if not any("ACCOUNT_NOT_LINKED" in n for n in notes):
                    notes.append(
                        f"ACCOUNT_NOT_LINKED: Google account has not completed Google Health onboarding. Complete setup at: {e.redirect_uri or 'https://fitbit.google.com/auth/signup'}"
                    )
            except Exception as e:
                logger.warning("Probe query failed for %s: %s", dtype, e)

            summaries.append(summary)

        # Classify Eight Sleep result per Section 10 of probe guide
        required_eight_sleep_metrics = {
            "sleep",
            "daily-heart-rate-variability",
            "daily-resting-heart-rate",
            "daily-respiratory-rate",
        }
        if required_eight_sleep_metrics.issubset(eight_sleep_metrics_seen):
            eight_sleep_status = "FULL_PASS"
        elif len(eight_sleep_metrics_seen) > 0:
            eight_sleep_status = "PARTIAL_PASS"
        else:
            eight_sleep_status = "FAIL"

        garmin_status = "PRESENT" if len(garmin_metrics_seen) > 0 else "ABSENT"

        notes.extend(
            [
                f"Garmin observed in: {sorted(list(garmin_metrics_seen))}",
                f"Eight Sleep observed in: {sorted(list(eight_sleep_metrics_seen))}",
            ]
        )

        return ProbeAnalysisResult(
            timestamp=datetime.now(timezone.utc).isoformat(),
            scopesTested=self.scopes,
            eightSleepStatus=eight_sleep_status,
            garminStatus=garmin_status,
            dataTypesSummary=summaries,
            notes=notes,
        )
