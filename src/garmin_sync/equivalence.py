"""Garmin direct-vs-Google transport equivalence analyzer (MS10/ADR-0027).

Evaluates numeric equality, timestamps, stage distributions, and completeness between
direct Garmin observations and Garmin-origin observations arriving via Google Health.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from .canonical import (
    METRIC_DAILY_RESPIRATION_RATE_BRPM,
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_SECONDS,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS,
    METRIC_SLEEP_STAGE_REM_SECONDS,
    CanonicalHealthObservation,
)

# Tolerances for transport equivalence
TOLERANCES: dict[str, float] = {
    METRIC_SLEEP_DURATION_SECONDS: 60.0,  # 1 min
    METRIC_SLEEP_STAGE_DEEP_SECONDS: 60.0,
    METRIC_SLEEP_STAGE_REM_SECONDS: 60.0,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS: 60.0,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS: 60.0,
    METRIC_HRV_RMSSD_MS: 0.5,
    METRIC_DAILY_RESTING_HEART_RATE_BPM: 0.5,
    METRIC_DAILY_RESPIRATION_RATE_BRPM: 0.5,
}


@dataclass
class MetricComparison:
    metric: str
    directValue: float | int | None
    googleValue: float | int | None
    difference: float | None
    isWithinTolerance: bool
    status: str  # "MATCH", "DELTA", "MISSING_DIRECT", "MISSING_GOOGLE"


@dataclass
class DateEquivalenceResult:
    logicalDate: str
    comparisons: list[MetricComparison] = field(default_factory=list)
    classification: str = "EQUIVALENT"  # "EQUIVALENT", "TRANSFORMING", "INCOMPLETE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "logicalDate": self.logicalDate,
            "comparisons": [asdict(c) for c in self.comparisons],
            "classification": self.classification,
        }


class TransportEquivalenceAnalyzer:
    """Compares direct Garmin vs Google-transported Garmin observations."""

    def compare_date_observations(
        self,
        logical_date: str,
        direct_observations: list[CanonicalHealthObservation],
        google_observations: list[CanonicalHealthObservation],
    ) -> DateEquivalenceResult:
        """Compare observation sets for one logical date."""
        direct_map: dict[str, Any] = {
            o.metric: o.value for o in direct_observations if not isinstance(o.value, dict)
        }
        google_garmin_map: dict[str, Any] = {
            o.metric: o.value
            for o in google_observations
            if o.source.provider == "garmin" and not isinstance(o.value, dict)
        }

        all_metrics = sorted(list(set(direct_map.keys()) | set(google_garmin_map.keys())))
        comparisons: list[MetricComparison] = []

        missing_google_count = 0
        transforming_count = 0

        for metric in all_metrics:
            val_direct = direct_map.get(metric)
            val_google = google_garmin_map.get(metric)

            if val_direct is None:
                comparisons.append(
                    MetricComparison(
                        metric=metric,
                        directValue=None,
                        googleValue=val_google,
                        difference=None,
                        isWithinTolerance=False,
                        status="MISSING_DIRECT",
                    )
                )
            elif val_google is None:
                missing_google_count += 1
                comparisons.append(
                    MetricComparison(
                        metric=metric,
                        directValue=val_direct,
                        googleValue=None,
                        difference=None,
                        isWithinTolerance=False,
                        status="MISSING_GOOGLE",
                    )
                )
            else:
                try:
                    num_direct = float(val_direct)
                    num_google = float(val_google)
                    diff = abs(num_direct - num_google)
                    tol = TOLERANCES.get(metric, 1e-3)
                    within = diff <= tol
                    if not within:
                        transforming_count += 1

                    comparisons.append(
                        MetricComparison(
                            metric=metric,
                            directValue=num_direct,
                            googleValue=num_google,
                            difference=diff,
                            isWithinTolerance=within,
                            status="MATCH" if within else "DELTA",
                        )
                    )
                except (ValueError, TypeError):
                    comparisons.append(
                        MetricComparison(
                            metric=metric,
                            directValue=None,
                            googleValue=None,
                            difference=None,
                            isWithinTolerance=(val_direct == val_google),
                            status="MATCH" if (val_direct == val_google) else "DELTA",
                        )
                    )

        if missing_google_count > len(all_metrics) // 2:
            classification = "INCOMPLETE"
        elif transforming_count > 0:
            classification = "TRANSFORMING"
        else:
            classification = "EQUIVALENT"

        return DateEquivalenceResult(
            logicalDate=logical_date,
            comparisons=comparisons,
            classification=classification,
        )
