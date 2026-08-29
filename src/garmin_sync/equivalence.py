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
from .google_health_mapper import parse_iso_datetime

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
    # "MATCHED", "MISMATCHED", or "NOT_EVALUATED" when either transport lacks
    # observed_start/observed_end. Direct-Garmin snapshots (RawMetrics) never carry
    # interval timestamps today, so this is NOT_EVALUATED whenever the direct side is
    # involved -- an honest gap, not a silent pass.
    timestampStatus: str = "NOT_EVALUATED"


@dataclass
class DateEquivalenceResult:
    logicalDate: str
    comparisons: list[MetricComparison] = field(default_factory=list)
    classification: str = "EQUIVALENT"  # "EQUIVALENT", "TRANSFORMING", "INCOMPLETE"
    # Metrics where either side had MORE THAN ONE same-metric observation for this date
    # (e.g. Google Health emitting two separate eight_sleep sleep_duration_seconds entries
    # for one logical date -- an overnight session plus a shorter overlapping/duplicate
    # fragment). direct_map/google_garmin_map below keep only the LAST such observation per
    # metric (ordinary dict-comprehension last-wins), so a comparison against an ambiguous
    # metric is comparing against an arbitrarily-chosen one of several candidates, not
    # necessarily the "real"/main one. Surfacing this explicitly turns what would otherwise
    # look like silent measurement disagreement into a visible data-shape finding.
    ambiguousMetrics: dict[str, dict[str, int]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "logicalDate": self.logicalDate,
            "comparisons": [asdict(c) for c in self.comparisons],
            "classification": self.classification,
            "ambiguousMetrics": self.ambiguousMetrics,
        }


class TransportEquivalenceAnalyzer:
    """Compares one provider's directly-ingested observations against the same provider's
    observations arriving through Google Health. Defaults to Garmin (MS10's original scope);
    pass `expected_provider="eight_sleep"` to reuse this for the Eight Sleep direct-vs-Google
    comparison (ES9) instead of duplicating the comparison engine."""

    def __init__(self, expected_provider: str = "garmin") -> None:
        self.expected_provider = expected_provider

    def compare_date_observations(
        self,
        logical_date: str,
        direct_observations: list[CanonicalHealthObservation],
        google_observations: list[CanonicalHealthObservation],
    ) -> DateEquivalenceResult:
        """Compare observation sets for one logical date."""
        direct_candidates = [o for o in direct_observations if not isinstance(o.value, dict)]
        google_candidates = [
            o
            for o in google_observations
            if o.source.provider == self.expected_provider and not isinstance(o.value, dict)
        ]
        direct_map: dict[str, CanonicalHealthObservation] = {o.metric: o for o in direct_candidates}
        google_garmin_map: dict[str, CanonicalHealthObservation] = {
            o.metric: o for o in google_candidates
        }

        ambiguous_metrics: dict[str, dict[str, int]] = {}
        for side_name, candidates in (("direct", direct_candidates), ("google", google_candidates)):
            counts: dict[str, int] = {}
            for o in candidates:
                counts[o.metric] = counts.get(o.metric, 0) + 1
            for metric, count in counts.items():
                if count > 1:
                    ambiguous_metrics.setdefault(metric, {})[side_name] = count

        all_metrics = sorted(list(set(direct_map.keys()) | set(google_garmin_map.keys())))
        comparisons: list[MetricComparison] = []

        missing_google_count = 0
        transforming_count = 0
        paired_metric_count = 0

        for metric in all_metrics:
            obs_direct = direct_map.get(metric)
            obs_google = google_garmin_map.get(metric)

            if obs_direct is None and obs_google is not None:
                g_val = (
                    float(obs_google.value) if isinstance(obs_google.value, (int, float)) else None
                )
                comparisons.append(
                    MetricComparison(
                        metric=metric,
                        directValue=None,
                        googleValue=g_val,
                        difference=None,
                        isWithinTolerance=False,
                        status="MISSING_DIRECT",
                    )
                )
            elif obs_google is None and obs_direct is not None:
                missing_google_count += 1
                d_val = (
                    float(obs_direct.value) if isinstance(obs_direct.value, (int, float)) else None
                )
                comparisons.append(
                    MetricComparison(
                        metric=metric,
                        directValue=d_val,
                        googleValue=None,
                        difference=None,
                        isWithinTolerance=False,
                        status="MISSING_GOOGLE",
                    )
                )
            elif obs_direct is not None and obs_google is not None:
                paired_metric_count += 1
                val_direct = obs_direct.value
                val_google = obs_google.value

                # Date alignment verification
                dates_match = obs_direct.logical_date == obs_google.logical_date

                # Timestamp alignment: only evaluated when both transports actually
                # supply observed_start/observed_end. A mismatch here fails the
                # comparison; a missing side is reported explicitly as NOT_EVALUATED
                # rather than silently treated as a match.
                if (
                    obs_direct.observed_start is not None
                    and obs_direct.observed_end is not None
                    and obs_google.observed_start is not None
                    and obs_google.observed_end is not None
                ):
                    timestamps_match = (
                        obs_direct.observed_start == obs_google.observed_start
                        and obs_direct.observed_end == obs_google.observed_end
                    )
                    timestamp_status = "MATCHED" if timestamps_match else "MISMATCHED"
                else:
                    timestamp_status = "NOT_EVALUATED"

                try:
                    if isinstance(val_direct, (int, float, str)) and isinstance(
                        val_google, (int, float, str)
                    ):
                        num_direct = float(val_direct)
                        num_google = float(val_google)
                        diff = abs(num_direct - num_google)
                        tol = TOLERANCES.get(metric, 1e-3)
                        within = (diff <= tol) and dates_match and timestamp_status != "MISMATCHED"
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
                                timestampStatus=timestamp_status,
                            )
                        )
                    else:
                        raise ValueError("Non-numeric value")
                except (ValueError, TypeError):
                    match_nonnumeric = (
                        (val_direct == val_google)
                        and dates_match
                        and timestamp_status != "MISMATCHED"
                    )
                    if not match_nonnumeric:
                        transforming_count += 1
                    comparisons.append(
                        MetricComparison(
                            metric=metric,
                            directValue=None,
                            googleValue=None,
                            difference=None,
                            isWithinTolerance=match_nonnumeric,
                            status="MATCH" if match_nonnumeric else "DELTA",
                            timestampStatus=timestamp_status,
                        )
                    )

        # A date with metrics on both sides but zero of them actually paired up (e.g. the
        # direct transport only ever supplies sleeping_heart_rate_bpm while Google Health
        # only ever supplies sleep_session for the same provider -- a real gap for Eight
        # Sleep, where the two transports' metric surfaces barely overlap) previously fell
        # through to EQUIVALENT: missing_google_count/transforming_count are both computed
        # only from metrics that were actually evaluated one way or another, so zero paired
        # metrics left both at a value too low to trip either branch. Fail closed instead --
        # zero real cross-transport evidence is not equivalence.
        if paired_metric_count == 0:
            classification = "INCOMPLETE"
        elif missing_google_count > len(all_metrics) // 2:
            classification = "INCOMPLETE"
        elif transforming_count > 0:
            classification = "TRANSFORMING"
        else:
            classification = "EQUIVALENT"

        return DateEquivalenceResult(
            logicalDate=logical_date,
            comparisons=comparisons,
            classification=classification,
            ambiguousMetrics=ambiguous_metrics,
        )


def snapshot_to_canonical_observations(
    snapshot: dict[str, Any],
) -> list[CanonicalHealthObservation]:
    """Convert a daily_recovery_snapshots document into canonical health observations.

    observed_start/observed_end are populated for the sleep observation from
    `raw.sleepSessionStart`/`sleepSessionEnd` (see models.py RawMetrics) when the
    direct-Garmin ingestion path captured a sleep-session timing window; they're None
    for older snapshots synced before that field existed, or for any night where
    Garmin's raw sleep payload didn't include a timing window. compare_date_observations
    reports timestamp equivalence as NOT_EVALUATED for these observations instead of
    silently treating the missing side as a match.
    """
    date_str = snapshot.get("date", "")
    raw = snapshot.get("raw", {}) or {}
    source = ObservationSource(
        provider="garmin",
        transport="direct",
        origin_application="com.garmin.connect",
    )
    sleep_session_start = parse_iso_datetime(raw.get("sleepSessionStart"))
    sleep_session_end = parse_iso_datetime(raw.get("sleepSessionEnd"))
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
                observed_start=sleep_session_start,
                observed_end=sleep_session_end,
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
                observed_start=parse_iso_datetime(raw.get("observedStart")),
                observed_end=parse_iso_datetime(raw.get("observedEnd")),
                logical_date=logical_date,
            )
        )
    return obs_list


def build_metric_summaries(
    metric_counts: dict[str, int],
    metric_matches: dict[str, int],
    metric_diffs: dict[str, list[float]],
    metric_paired_counts: dict[str, int],
    ambiguous_date_counts: dict[str, int],
) -> dict[str, dict[str, Any]]:
    """Shared metric-summary builder for both the Garmin (MS10) and Eight Sleep (ES9)
    reports. `meanDifference`/`maxDifference` are `None` -- not `0.0` -- when a metric was
    never actually paired (e.g. a metric only one transport ever emits, like Garmin/Eight
    Sleep's own single-sided fields): a 0.0 default there previously read as "these values
    are identical" when it actually meant "zero real comparisons happened," which looks
    identical to a genuine perfect match in a printed report. `ambiguousDateCount` surfaces
    how many dates had more than one same-metric source observation (see
    DateEquivalenceResult.ambiguousMetrics) -- a comparison against an ambiguous metric on a
    given date used an arbitrary (last-in-list) pick among several candidates, not
    necessarily the physiologically-relevant one."""
    summaries: dict[str, dict[str, Any]] = {}
    for m, count in metric_counts.items():
        matches = metric_matches.get(m, 0)
        diffs = metric_diffs.get(m, [])
        summaries[m] = {
            "totalEvaluated": count,
            "pairedCount": metric_paired_counts.get(m, 0),
            "matchCount": matches,
            "matchRatePct": round(matches / count * 100.0, 1) if count > 0 else 0.0,
            "meanDifference": round(sum(diffs) / len(diffs), 3) if diffs else None,
            "maxDifference": round(max(diffs), 3) if diffs else None,
            "ambiguousDateCount": ambiguous_date_counts.get(m, 0),
        }
    return summaries


def format_metric_summaries_table(metric_summaries: dict[str, dict[str, Any]]) -> str:
    """Shared CLI table formatter for both the Garmin (MS10) and Eight Sleep (ES9) reports.
    Prints "Paired" (comparisons where BOTH sides actually had this metric) separately from
    "Evaluated" (also counts MISSING_DIRECT/MISSING_GOOGLE one-sided occurrences), and "N/A"
    rather than a misleading 0.0 for a metric with zero paired comparisons -- a metric only
    one transport ever emits (e.g. Garmin's RHR vs Eight Sleep's sleeping-HR-only surface)
    will always show 0% match / N/A delta, which reads as "not comparable," not "identical."
    A trailing "Ambiguous dates" section lists any metric where a date's source data had more
    than one same-metric observation on either side (see DateEquivalenceResult.ambiguousMetrics)
    -- that comparison used an arbitrary pick among candidates, not necessarily the
    physiologically-relevant one, and is worth investigating at the mapper level rather than
    trusting the delta at face value."""
    lines = [
        f"{'Metric':<34} {'Evaluated':<10} {'Paired':<8} {'Matches':<9} {'Match %':<9} {'Mean Delta':<12}",
        "-" * 80,
    ]
    ambiguous_lines = []
    for m, s in metric_summaries.items():
        mean_disp = s["meanDifference"] if s["meanDifference"] is not None else "N/A"
        lines.append(
            f"{m:<34} {s['totalEvaluated']:<10} {s['pairedCount']:<8} {s['matchCount']:<9} "
            f"{s['matchRatePct']:<8}% {mean_disp!s:<12}"
        )
        if s.get("ambiguousDateCount", 0) > 0:
            ambiguous_lines.append(
                f"  {m}: {s['ambiguousDateCount']} date(s) had multiple same-metric source "
                f"observations on one side -- comparison used an arbitrary (last) pick"
            )
    if ambiguous_lines:
        lines.append("-" * 80)
        lines.append("AMBIGUOUS METRICS (investigate at the mapper level, not the comparison):")
        lines.extend(ambiguous_lines)
    return "\n".join(lines)


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
    metric_paired_counts: dict[str, int] = {}
    ambiguous_date_counts: dict[str, int] = {}

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
                if comp.status in ("MATCH", "DELTA"):
                    metric_paired_counts[m] = metric_paired_counts.get(m, 0) + 1
                if comp.status == "MATCH":
                    metric_matches[m] = metric_matches.get(m, 0) + 1
                if comp.difference is not None:
                    metric_diffs.setdefault(m, []).append(comp.difference)

            for m in res.ambiguousMetrics:
                ambiguous_date_counts[m] = ambiguous_date_counts.get(m, 0) + 1

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

    metric_summaries = build_metric_summaries(
        metric_counts, metric_matches, metric_diffs, metric_paired_counts, ambiguous_date_counts
    )

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
