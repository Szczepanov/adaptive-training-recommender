"""Multisource health & recovery shadow audit (MS14/ADR-0027).

Analyzes multi-provider coverage, baseline stability, and cross-source telemetry
(Garmin Direct vs Eight Sleep) across empirical historical datasets.
"""

import math
from dataclasses import dataclass, field
from typing import Any

from .canonical import (
    METRIC_DAILY_RESPIRATION_RATE_BRPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
)
from .firestore_repository import FirestoreRecoveryRepository


@dataclass
class MultisourceAuditReport:
    startDate: str
    endDate: str
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


def run_multisource_audit(
    repository: FirestoreRecoveryRepository,
    start_date_iso: str,
    end_date_iso: str,
) -> MultisourceAuditReport:
    """Run empirical shadow audit between Garmin Direct and Eight Sleep."""
    # 1. Fetch Garmin Direct snapshots
    garmin_snaps = repository.get_historical_snapshots(start_date_iso, end_date_iso)

    # 2. Fetch Eight Sleep day bundles
    eight_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso,
        end_date_iso,
        provider="eight_sleep",
        transport="google_health",
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

        if bundle:
            for obs in bundle.get("observations", []):
                metric = obs.get("metric")
                val = obs.get("value")
                if isinstance(val, (int, float)):
                    if metric == METRIC_SLEEP_DURATION_SECONDS:
                        eight_sleep = float(val) / 60.0
                    elif metric == METRIC_HRV_RMSSD_MS:
                        eight_hrv = float(val)
                        eight_hrv_vals.append(eight_hrv)
                    elif (
                        metric == METRIC_DAILY_RESPIRATION_RATE_BRPM
                        or metric == "respiration_rate_brpm"
                    ):
                        eight_resp = float(val)
                        eight_resp_vals.append(eight_resp)

        sleep_delta = None
        if garmin_sleep is not None and eight_sleep is not None:
            sleep_delta = abs(garmin_sleep - eight_sleep)
            garmin_sleep_mins.append(garmin_sleep)
            eight_sleep_mins.append(eight_sleep)
            sleep_diffs.append(sleep_delta)

        daily_comparisons.append(
            {
                "date": d,
                "hasGarmin": has_garmin,
                "hasEightSleep": has_eight,
                "garminSleepMinutes": round(garmin_sleep, 1) if garmin_sleep else None,
                "eightSleepMinutes": round(eight_sleep, 1) if eight_sleep else None,
                "sleepDeltaMinutes": round(sleep_delta, 1) if sleep_delta is not None else None,
                "eightSleepHrv": round(eight_hrv, 1) if eight_hrv else None,
                "eightSleepRespiration": round(eight_resp, 1) if eight_resp else None,
            }
        )

    mean_sleep_diff = sum(sleep_diffs) / len(sleep_diffs) if sleep_diffs else 0.0
    sleep_corr = _calc_correlation(garmin_sleep_mins, eight_sleep_mins)

    hrv_median = _calc_median(eight_hrv_vals)
    hrv_mad = _calc_mad(eight_hrv_vals, hrv_median)

    resp_median = _calc_median(eight_resp_vals)
    resp_mad = _calc_mad(eight_resp_vals, resp_median)

    return MultisourceAuditReport(
        startDate=start_date_iso,
        endDate=end_date_iso,
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
        dailyComparisons=daily_comparisons,
    )
