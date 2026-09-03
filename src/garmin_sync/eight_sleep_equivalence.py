"""Eight Sleep direct-vs-Google Health transport equivalence analyzer (ES9/ADR-0030).

Reuses MS10's generic comparison engine (`TransportEquivalenceAnalyzer`,
`bundle_to_canonical_observations`) against the two `health_observation_days` bundle types
that exist for Eight Sleep once the direct connector is registered and run:

- `provider=eight_sleep`, `transport=eight_sleep_direct` (this connector, ES4/ES8)
- `provider=eight_sleep`, `transport=google_health` (the pre-existing MS path, ADR-0027)

Unlike MS10's Garmin comparison, both sides here are `health_observation_days` bundles --
Eight Sleep has no `daily_recovery_snapshots` side -- so this module only needs the bundle
converter, not the snapshot converter `equivalence.py` also carries for Garmin.
"""

from typing import Any

from .equivalence import (
    DateEquivalenceResult,
    TransportEquivalenceAnalyzer,
    TransportEquivalenceReport,
    build_metric_summaries,
    bundle_to_canonical_observations,
    classify_overall_equivalence,
)

EIGHT_SLEEP_PROVIDER = "eight_sleep"
EIGHT_SLEEP_DIRECT_TRANSPORT = "eight_sleep_direct"
EIGHT_SLEEP_GOOGLE_TRANSPORT = "google_health"


def run_eight_sleep_equivalence_analysis(
    repository: Any,
    start_date_iso: str,
    end_date_iso: str,
) -> TransportEquivalenceReport:
    """Compare direct-Eight-Sleep vs Google-Health-transported Eight Sleep observations
    over a historical date range in Firestore (ES9). Fails closed to an empty/INCOMPLETE
    report when one or both sides have no data yet -- it never invents a comparison."""
    direct_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso,
        end_date_iso,
        provider=EIGHT_SLEEP_PROVIDER,
        transport=EIGHT_SLEEP_DIRECT_TRANSPORT,
    )
    google_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso,
        end_date_iso,
        provider=EIGHT_SLEEP_PROVIDER,
        transport=EIGHT_SLEEP_GOOGLE_TRANSPORT,
    )

    direct_bundle_map = {b.get("logicalDate", ""): b for b in direct_bundles}
    google_bundle_map = {b.get("logicalDate", ""): b for b in google_bundles}
    all_dates = sorted(set(direct_bundle_map.keys()) | set(google_bundle_map.keys()))

    analyzer = TransportEquivalenceAnalyzer(expected_provider=EIGHT_SLEEP_PROVIDER)
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
        direct_bundle = direct_bundle_map.get(d)
        google_bundle = google_bundle_map.get(d)

        if direct_bundle and google_bundle:
            overlap_count += 1
            direct_obs = bundle_to_canonical_observations(direct_bundle)
            google_obs = bundle_to_canonical_observations(google_bundle)
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

        elif direct_bundle:
            direct_only_count += 1
        elif google_bundle:
            google_only_count += 1

    overall = classify_overall_equivalence(daily_results)

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
