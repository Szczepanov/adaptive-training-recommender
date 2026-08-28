"""Multisource health & recovery shadow audit (MS14/ADR-0027).

Analyzes multi-provider coverage, baseline stability, and cross-source telemetry
(Garmin Direct vs Eight Sleep) across empirical historical datasets.

PI5/ADR-0028: rolling baseline admission consumes an exact fail-closed
`EffectiveIdentityDecisionProjection`; it never calls the provisional co-presence heuristic.
Until PI6 persistence supplies a projection, a shared-source night remains preserved/descriptive
but cannot enter HRV/respiration baseline statistics.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Mapping

from .canonical import (
    METRIC_DAILY_RESPIRATION_RATE_BRPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_SESSION,
)
from .firestore_repository import FirestoreRecoveryRepository
from .identity_eligibility import (
    EffectiveIdentityDecisionProjection,
    IdentityBundleKey,
    is_bundle_baseline_eligible,
    resolve_bundle_identity_projection,
)


@dataclass
class MultisourceAuditReport:
    startDate: str
    endDate: str
    eightSleepTransport: str
    totalDays: int
    bothSourcesDays: int
    garminOnlyDays: int
    eightSleepOnlyDays: int
    neitherDays: int
    sleepDurationMeanDiffMinutes: float
    sleepDurationCorrelation: float | None
    eightSleepHrvCount: int
    eightSleepHrvMedian: float | None
    eightSleepHrvMad: float | None
    eightSleepRespCount: int
    eightSleepRespMedian: float | None
    eightSleepRespMad: float | None
    eightSleepIdentityEligibleDays: int
    eightSleepIdentityExcludedDays: int
    # Sleep-session timing coverage per source (D-EIGHT-SLEEP-INGEST): counted only over
    # nights where that source has sleep data at all, so a source with no sleep record
    # that night doesn't get counted as a "missing timestamp" day. Any future provider
    # follows the same pattern -- see _bundle_sleep_timing_available, which works off the
    # provider-neutral health_observation_days bundle shape.
    garminSleepTimingDays: int
    garminSleepMissingTimingDates: list[str]
    eightSleepSleepTimingDays: int
    eightSleepMissingTimingDates: list[str]
    dailyComparisons: list[dict[str, Any]] = field(default_factory=list)


def _calc_median(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_v = sorted(values)
    n = len(sorted_v)
    mid = n // 2
    if n % 2 == 1:
        return sorted_v[mid]
    return (sorted_v[mid - 1] + sorted_v[mid]) / 2.0


def _calc_mad(values: list[float], median: float | None) -> float | None:
    if not values or median is None:
        return None
    devs = [abs(v - median) for v in values]
    raw_mad = _calc_median(devs)
    return raw_mad * 1.4826 if raw_mad is not None else None


def _calc_correlation(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=False))
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if var_x <= 0 or var_y <= 0:
        return None
    return cov / math.sqrt(var_x * var_y)


def _garmin_sleep_timing_available(snap: dict[str, Any] | None) -> bool:
    """True when the Garmin daily_recovery_snapshots document has both ends of the
    sleep-session window (RawMetrics.sleepSessionStart/End -- see mapper.py)."""
    if not snap:
        return False
    raw = snap.get("raw", {}) or {}
    return bool(raw.get("sleepSessionStart")) and bool(raw.get("sleepSessionEnd"))


def _bundle_sleep_timing_available(bundle: dict[str, Any] | None) -> bool:
    """True when a health_observation_days bundle carries a sleep observation with both
    observedStart and observedEnd set. Provider-neutral -- works for eight_sleep today
    and any future provider that publishes to health_observation_days the same way."""
    if not bundle:
        return False
    for obs in bundle.get("observations", []):
        if (
            obs.get("metric") in (METRIC_SLEEP_DURATION_SECONDS, METRIC_SLEEP_SESSION)
            and obs.get("observedStart")
            and obs.get("observedEnd")
        ):
            return True
    return False


def run_multisource_audit(
    repository: FirestoreRecoveryRepository,
    start_date_iso: str,
    end_date_iso: str,
    effective_identity_decisions: Mapping[IdentityBundleKey, EffectiveIdentityDecisionProjection]
    | None = None,
    eight_sleep_transport: str = "google_health",
) -> MultisourceAuditReport:
    """Run empirical shadow audit between Garmin Direct and Eight Sleep.

    Two independent devices/sensors, not a transport-fidelity check like MS10/ES9's
    TransportEquivalenceAnalyzer -- correlation and mean delta are the right comparison here
    (D-MS-NOAVG: cross-device raw values are not expected to match exactly, so this
    deliberately doesn't tolerance-match them the way the same-device transport comparators
    do). `eight_sleep_transport` defaults to "google_health" (this audit's original MS14
    scope, predating the direct connector); pass "eight_sleep_direct" to compare against
    Garmin Direct with Google Health removed from both sides of the comparison entirely --
    the cleanest read on genuine cross-device agreement, free of any Google Health mapping
    confound (see the ES9 sleep-duration mapper fix in google_health_mapper.py).

    Missing effective-identity projections fail closed for baseline admission. The raw bundle
    remains available to descriptive coverage/session-delta telemetry.
    """
    identity_decisions = (
        repository.get_effective_identity_decision_projections_in_range(
            start_date_iso, end_date_iso
        )
        if effective_identity_decisions is None
        else effective_identity_decisions
    )
    # 1. Fetch Garmin Direct snapshots
    garmin_snaps = repository.get_historical_snapshots(start_date_iso, end_date_iso)

    # 2. Fetch Eight Sleep day bundles
    eight_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso,
        end_date_iso,
        provider="eight_sleep",
        transport=eight_sleep_transport,
    )

    eight_map: dict[str, dict[str, Any]] = {
        b.get("logicalDate", ""): b for b in eight_bundles if b.get("logicalDate")
    }

    # Generate all dates in range
    from datetime import datetime, timedelta

    start_dt = datetime.strptime(start_date_iso, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_iso, "%Y-%m-%d")

    all_dates: list[str] = []
    curr = start_dt
    while curr <= end_dt:
        all_dates.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)

    both_count = 0
    garmin_only_count = 0
    eight_only_count = 0
    neither_count = 0

    garmin_sleep_mins: list[float] = []
    eight_sleep_mins: list[float] = []
    sleep_diffs: list[float] = []

    eight_hrv_vals: list[float] = []
    eight_resp_vals: list[float] = []
    identity_eligible_days = 0
    identity_excluded_days = 0

    garmin_sleep_timing_days = 0
    garmin_missing_timing_dates: list[str] = []
    eight_sleep_timing_days = 0
    eight_missing_timing_dates: list[str] = []

    daily_comparisons: list[dict[str, Any]] = []

    for d in all_dates:
        snap = garmin_snaps.get(d)
        bundle = eight_map.get(d)

        has_garmin = snap is not None
        has_eight = bundle is not None

        if has_garmin and has_eight:
            both_count += 1
        elif has_garmin:
            garmin_only_count += 1
        elif has_eight:
            eight_only_count += 1
        else:
            neither_count += 1

        garmin_sleep = None
        if snap:
            raw = snap.get("raw", {}) or {}
            sec = raw.get("sleepDurationSec") or snap.get("sleepSeconds")
            if sec:
                garmin_sleep = float(sec) / 60.0

        eight_sleep = None
        eight_hrv = None
        eight_resp = None
        admitted_to_baseline = False
        effective_identity_status = "UNCERTAIN"

        if bundle:
            # D-PID-PREBASE: exact effective decision before baseline accumulation. Missing or
            # stale projections fail closed; no legacy physiological heuristic can admit a night.
            admitted_to_baseline = is_bundle_baseline_eligible(bundle, identity_decisions)
            identity_projection = resolve_bundle_identity_projection(bundle, identity_decisions)
            if identity_projection is not None:
                effective_identity_status = identity_projection.effective_status
            if admitted_to_baseline:
                identity_eligible_days += 1
            else:
                identity_excluded_days += 1

            for obs in bundle.get("observations", []):
                metric = obs.get("metric")
                val = obs.get("value")
                if isinstance(val, (int, float)):
                    if metric == METRIC_SLEEP_DURATION_SECONDS:
                        eight_sleep = float(val) / 60.0
                    elif metric == METRIC_HRV_RMSSD_MS:
                        eight_hrv = float(val)
                        if admitted_to_baseline:
                            eight_hrv_vals.append(eight_hrv)
                    elif (
                        metric == METRIC_DAILY_RESPIRATION_RATE_BRPM
                        or metric == "respiration_rate_brpm"
                    ):
                        eight_resp = float(val)
                        if admitted_to_baseline:
                            eight_resp_vals.append(eight_resp)

        sleep_delta = None
        if garmin_sleep is not None and eight_sleep is not None:
            sleep_delta = abs(garmin_sleep - eight_sleep)
            garmin_sleep_mins.append(garmin_sleep)
            eight_sleep_mins.append(eight_sleep)
            sleep_diffs.append(sleep_delta)

        # Timing coverage per source, only over nights that source actually has sleep
        # data for -- a source with no sleep record that night is a coverage gap
        # (garminOnlyDays/eightSleepOnlyDays/neitherDays above), not a missing-timestamp bug.
        garmin_timing_ok = _garmin_sleep_timing_available(snap)
        if garmin_sleep is not None:
            if garmin_timing_ok:
                garmin_sleep_timing_days += 1
            else:
                garmin_missing_timing_dates.append(d)

        eight_timing_ok = _bundle_sleep_timing_available(bundle)
        if eight_sleep is not None:
            if eight_timing_ok:
                eight_sleep_timing_days += 1
            else:
                eight_missing_timing_dates.append(d)

        daily_comparisons.append(
            {
                "date": d,
                "hasGarmin": has_garmin,
                "hasEightSleep": has_eight,
                "garminSleepMinutes": round(garmin_sleep, 1) if garmin_sleep else None,
                "eightSleepMinutes": round(eight_sleep, 1) if eight_sleep else None,
                "sleepDeltaMinutes": round(sleep_delta, 1) if sleep_delta is not None else None,
                "garminSleepTimingAvailable": garmin_timing_ok if snap else None,
                "eightSleepTimingAvailable": eight_timing_ok if bundle else None,
                "eightSleepHrv": round(eight_hrv, 1) if eight_hrv else None,
                "eightSleepRespiration": round(eight_resp, 1) if eight_resp else None,
                "effectiveIdentityStatus": effective_identity_status if bundle else None,
                "identityBaselineEligible": admitted_to_baseline if bundle else None,
            }
        )

    mean_sleep_diff = sum(sleep_diffs) / len(sleep_diffs) if sleep_diffs else 0.0
    sleep_corr = _calc_correlation(garmin_sleep_mins, eight_sleep_mins)

    # 28-day rolling window baseline statistics (using latest 28 eligible daily samples)
    recent_hrv = eight_hrv_vals[-28:] if len(eight_hrv_vals) >= 28 else eight_hrv_vals
    hrv_median = _calc_median(recent_hrv)
    hrv_mad = _calc_mad(recent_hrv, hrv_median)

    recent_resp = eight_resp_vals[-28:] if len(eight_resp_vals) >= 28 else eight_resp_vals
    resp_median = _calc_median(recent_resp)
    resp_mad = _calc_mad(recent_resp, resp_median)

    return MultisourceAuditReport(
        startDate=start_date_iso,
        endDate=end_date_iso,
        eightSleepTransport=eight_sleep_transport,
        totalDays=len(all_dates),
        bothSourcesDays=both_count,
        garminOnlyDays=garmin_only_count,
        eightSleepOnlyDays=eight_only_count,
        neitherDays=neither_count,
        sleepDurationMeanDiffMinutes=round(mean_sleep_diff, 1),
        sleepDurationCorrelation=round(sleep_corr, 3) if sleep_corr is not None else None,
        eightSleepHrvCount=len(eight_hrv_vals),
        eightSleepHrvMedian=round(hrv_median, 1) if hrv_median is not None else None,
        eightSleepHrvMad=round(hrv_mad, 2) if hrv_mad is not None else None,
        eightSleepRespCount=len(eight_resp_vals),
        eightSleepRespMedian=round(resp_median, 1) if resp_median is not None else None,
        eightSleepRespMad=round(resp_mad, 2) if resp_mad is not None else None,
        eightSleepIdentityEligibleDays=identity_eligible_days,
        eightSleepIdentityExcludedDays=identity_excluded_days,
        garminSleepTimingDays=garmin_sleep_timing_days,
        garminSleepMissingTimingDates=garmin_missing_timing_dates,
        eightSleepSleepTimingDays=eight_sleep_timing_days,
        eightSleepMissingTimingDates=eight_missing_timing_dates,
        dailyComparisons=daily_comparisons,
    )
