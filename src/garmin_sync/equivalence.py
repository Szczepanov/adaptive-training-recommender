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
    ObservationSource,
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


def snapshot_to_canonical_observations(
    snapshot: dict[str, Any],
) -> list[CanonicalHealthObservation]:
    """Convert a daily_recovery_snapshots document into canonical health observations."""
    date_str = snapshot.get("date", "")
    raw = snapshot.get("raw", {}) or {}
    source = ObservationSource(
        provider="garmin",
        transport="direct",
        origin_application="com.garmin.connect",
    )
    obs: list[CanonicalHealthObservation] = []

    # Resting Heart Rate
    rhr = (
        raw.get("restingHr")
        or snapshot.get("restingHeartRate")
        or snapshot.get("resting_heart_rate")
    )
    if rhr is not None:
        obs.append(
            CanonicalHealthObservation(
                metric=METRIC_DAILY_RESTING_HEART_RATE_BPM,
                value=float(rhr),
                unit="bpm",
                source=source,
                observed_start=None,
                observed_end=None,
                logical_date=date_str,
            )
        )

    # Sleep Duration
    sleep_sec = (
        raw.get("sleepDurationSec")
        or snapshot.get("sleepSeconds")
        or snapshot.get("sleepDuration")
        or snapshot.get("sleep_duration_seconds")
    )
    if sleep_sec is not None:
        obs.append(
            CanonicalHealthObservation(
                metric=METRIC_SLEEP_DURATION_SECONDS,
                value=float(sleep_sec),
                unit="seconds",
                source=source,
                observed_start=None,
                observed_end=None,
                logical_date=date_str,
            )
        )

    # Sleep Stages
    for raw_k, top_k, metric in [
        ("deepSleepSec", "deepSleepSeconds", METRIC_SLEEP_STAGE_DEEP_SECONDS),
        ("remSleepSec", "remSleepSeconds", METRIC_SLEEP_STAGE_REM_SECONDS),
        ("lightSleepSec", "lightSleepSeconds", METRIC_SLEEP_STAGE_LIGHT_SECONDS),
        ("awakeSleepSec", "awakeSleepSeconds", METRIC_SLEEP_STAGE_AWAKE_SECONDS),
    ]:
        val = raw.get(raw_k) if raw.get(raw_k) is not None else snapshot.get(top_k)
        if val is not None:
            obs.append(
                CanonicalHealthObservation(
                    metric=metric,
                    value=float(val),
                    unit="seconds",
                    source=source,
                    observed_start=None,
                    observed_end=None,
                    logical_date=date_str,
                )
            )

    # HRV RMSSD
    hrv_last = (
        raw.get("hrvOvernightAvg")
        or (
            snapshot.get("hrvSummary", {}).get("lastNightAvg")
            if isinstance(snapshot.get("hrvSummary"), dict)
            else None
        )
        or snapshot.get("hrv_rmssd_ms")
        or snapshot.get("hrvLastNightAvg")
    )
    if hrv_last is not None:
        obs.append(
            CanonicalHealthObservation(
                metric=METRIC_HRV_RMSSD_MS,
                value=float(hrv_last),
                unit="ms",
                source=source,
                observed_start=None,
                observed_end=None,
                logical_date=date_str,
            )
        )

    # Respiration
    resp = (
        raw.get("respirationAvg")
        or (
            snapshot.get("respiration", {}).get("avgSleepRespirationValue")
            if isinstance(snapshot.get("respiration"), dict)
            else None
        )
        or snapshot.get("daily_respiration_rate_brpm")
    )
    if resp is not None:
        obs.append(
            CanonicalHealthObservation(
                metric=METRIC_DAILY_RESPIRATION_RATE_BRPM,
                value=float(resp),
                unit="brpm",
                source=source,
                observed_start=None,
                observed_end=None,
                logical_date=date_str,
            )
        )

    return obs


def bundle_to_canonical_observations(
    bundle: dict[str, Any],
) -> list[CanonicalHealthObservation]:
    """Convert a health_observation_days bundle into canonical observations."""
    obs_list: list[CanonicalHealthObservation] = []
    bundle_provider = bundle.get("provider", "unknown")
    bundle_transport = bundle.get("transport", "unknown")
    logical_date = bundle.get("logicalDate", "")

    for raw in bundle.get("observations", []):
        source = ObservationSource(
            provider=bundle_provider,
            transport=bundle_transport,
            origin_application=raw.get("originApplication"),
            origin_device=raw.get("originDevice"),
            source_record_id=raw.get("sourceRecordId"),
        )
        obs_list.append(
            CanonicalHealthObservation(
                metric=raw.get("metric", ""),
                value=raw.get("value"),
                unit=raw.get("unit", ""),
                source=source,
                observed_start=None,
                observed_end=None,
                logical_date=logical_date,
            )
        )
    return obs_list


@dataclass
class TransportEquivalenceReport:
    startDate: str
    endDate: str
    totalOverlapDays: int
    directOnlyDays: int
    googleOnlyDays: int
    overallClassification: str
    metricSummaries: dict[str, dict[str, Any]]
    dailyResults: list[DateEquivalenceResult]

    def to_dict(self) -> dict[str, Any]:
        return {
            "startDate": self.startDate,
            "endDate": self.endDate,
            "totalOverlapDays": self.totalOverlapDays,
            "directOnlyDays": self.directOnlyDays,
            "googleOnlyDays": self.googleOnlyDays,
            "overallClassification": self.overallClassification,
            "metricSummaries": self.metricSummaries,
            "dailyResults": [d.to_dict() for d in self.dailyResults],
        }


def run_equivalence_analysis(
    repository: Any,
    start_date_iso: str,
    end_date_iso: str,
) -> TransportEquivalenceReport:
    """Run full transport equivalence audit across historical date range in Firestore."""
    direct_snapshots = repository.get_historical_snapshots(start_date_iso, end_date_iso)
    google_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso,
        end_date_iso,
        provider="garmin",
        transport="google_health",
    )

    google_bundle_map = {b.get("logicalDate", ""): b for b in google_bundles}
    all_dates = sorted(list(set(direct_snapshots.keys()) | set(google_bundle_map.keys())))

    analyzer = TransportEquivalenceAnalyzer()
    daily_results: list[DateEquivalenceResult] = []

    overlap_count = 0
    direct_only_count = 0
    google_only_count = 0

    metric_diffs: dict[str, list[float]] = {}
    metric_matches: dict[str, int] = {}
    metric_counts: dict[str, int] = {}

    for d in all_dates:
        snap = direct_snapshots.get(d)
        bundle = google_bundle_map.get(d)

        if snap and bundle:
            overlap_count += 1
            direct_obs = snapshot_to_canonical_observations(snap)
            google_obs = bundle_to_canonical_observations(bundle)
            res = analyzer.compare_date_observations(d, direct_obs, google_obs)
            daily_results.append(res)

            for comp in res.comparisons:
                m = comp.metric
                metric_counts[m] = metric_counts.get(m, 0) + 1
                if comp.status == "MATCH":
                    metric_matches[m] = metric_matches.get(m, 0) + 1
                if comp.difference is not None:
                    metric_diffs.setdefault(m, []).append(comp.difference)

        elif snap:
            direct_only_count += 1
        elif bundle:
            google_only_count += 1

    # Classify overall
    classifications = [r.classification for r in daily_results]
    if not daily_results:
        overall = "INCOMPLETE"
    elif classifications.count("INCOMPLETE") > len(daily_results) // 2:
        overall = "INCOMPLETE"
    elif classifications.count("TRANSFORMING") > 0:
        overall = "TRANSFORMING"
    else:
        overall = "EQUIVALENT"

    metric_summaries: dict[str, dict[str, Any]] = {}
    for m, count in metric_counts.items():
        matches = metric_matches.get(m, 0)
        diffs = metric_diffs.get(m, [])
        mean_diff = sum(diffs) / len(diffs) if diffs else 0.0
        max_diff = max(diffs) if diffs else 0.0
        metric_summaries[m] = {
            "totalEvaluated": count,
            "matchCount": matches,
            "matchRatePct": round(matches / count * 100.0, 1) if count > 0 else 0.0,
            "meanDifference": round(mean_diff, 3),
            "maxDifference": round(max_diff, 3),
        }

    return TransportEquivalenceReport(
        startDate=start_date_iso,
        endDate=end_date_iso,
        totalOverlapDays=overlap_count,
        directOnlyDays=direct_only_count,
        googleOnlyDays=google_only_count,
        overallClassification=overall,
        metricSummaries=metric_summaries,
        dailyResults=daily_results,
    )
