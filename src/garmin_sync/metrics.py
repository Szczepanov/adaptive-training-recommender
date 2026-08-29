import math
import statistics
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .models import BASELINE_COMPUTATION_VERSION, DerivedDeltas, DerivedMetrics

# Domain intensity thresholds (temporary heuristics)
HARD_SESSION_MIN_TRAINING_EFFECT = 3.0
HARD_SESSION_MIN_AVERAGE_HR = 145


def calculate_average(values: Sequence[float | int | None], min_required: int) -> float | None:
    """Calculate mean of non-None values if count meets min_required threshold."""
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return sum(valid_values) / len(valid_values)
    return None


def calculate_delta(current: float | int | None, baseline: float | None) -> float | None:
    """Calculate signed delta (current - baseline)."""
    if current is not None and baseline is not None:
        return current - baseline
    return None


def calculate_stdev(values: Sequence[float | int | None], min_required: int) -> float | None:
    """Population stdev of non-None values if count meets min_required threshold.

    Uses the same min_required as the corresponding baseline average so a stdev is
    never reported as "ready" ahead of the average it's meant to normalize.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return statistics.pstdev(valid_values)
    return None


def calculate_median(values: Sequence[float | int | None], min_required: int) -> float | None:
    """Median of non-None values if count meets min_required threshold.

    Median is an outlier-resistant location estimator. Respiration uses it for the v3
    robust-baseline candidate because transient elevated nights can contaminate a trailing
    mean. Other metrics also persist medians for observation/comparison, but that does not
    imply median is their preferred production estimator; see ADR-0024.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return statistics.median(valid_values)
    return None


def calculate_mad(values: Sequence[float | int | None], min_required: int) -> float | None:
    """Return the median absolute deviation scaled by the normal-consistency factor 1.4826.

    Under an approximately Gaussian distribution this scaled MAD has a magnitude comparable
    to standard deviation while retaining strong resistance to outliers. It is *not* a
    universal drop-in replacement for standard deviation on bounded, skewed, multimodal or
    quantized wearable metrics. Ties can also yield MAD == 0; any downstream floor then
    becomes an explicit modelling assumption rather than measured variability. See ADR-0024.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        med = statistics.median(valid_values)
        mad = statistics.median([abs(v - med) for v in valid_values])
        return mad * 1.4826
    return None


def minutes_of_day_local(dt_iso: str | None, timezone_name: str) -> float | None:
    """Convert a UTC ISO-8601 datetime string to minutes since local midnight
    (0.0-1439.999...) in the given timezone. None for missing, malformed, or
    offset-less input -- an offset-less timestamp can't be unambiguously localized."""
    if not dt_iso:
        return None
    try:
        dt = datetime.fromisoformat(dt_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        return None
    local_dt = dt.astimezone(ZoneInfo(timezone_name))
    return local_dt.hour * 60 + local_dt.minute + local_dt.second / 60.0


def sleep_midpoint_iso(start_iso: str | None, end_iso: str | None) -> str | None:
    """Real datetime midpoint between sleep start and end -- exact interval arithmetic on
    absolute timestamps, not a circular average of two already-converted time-of-day
    values (which would be ambiguous: two clock times alone don't say which direction is
    "through the night"). None for missing/malformed input or a non-positive interval."""
    if not start_iso or not end_iso:
        return None
    try:
        start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        return None
    return (start + (end - start) / 2).isoformat()


def calculate_circular_mean_minutes(
    values: Sequence[float | None], min_required: int
) -> float | None:
    """Circular mean of time-of-day values (minutes since local midnight, 0-1440),
    correctly handling wraparound -- e.g. bedtimes of 23:50 (1430min) and 00:10 (10min)
    average to ~00:00, not ~12:00 the way a naive linear mean would. Standard
    circular-statistics technique: treat each value as an angle on a 24h circle, average
    the unit vectors, then convert the resultant angle back to minutes. Deliberately mean,
    not median (unlike the rest of this module's v3+ baselines) -- there's no single
    universally-agreed circular median, while circular mean via vector averaging is
    well-defined and standard for time-of-day/circadian-phase data. Returns None if fewer
    than min_required valid values, or if they're spread so evenly around the circle that
    no meaningful mean direction exists (resultant vector length ~0)."""
    valid = [v for v in values if v is not None]
    if len(valid) < min_required:
        return None
    angles = [2 * math.pi * v / 1440.0 for v in valid]
    sum_cos = sum(math.cos(a) for a in angles)
    sum_sin = sum(math.sin(a) for a in angles)
    if math.isclose(sum_cos, 0.0, abs_tol=1e-9) and math.isclose(sum_sin, 0.0, abs_tol=1e-9):
        return None
    mean_angle = math.atan2(sum_sin, sum_cos)
    return (mean_angle / (2 * math.pi) * 1440.0) % 1440.0


def calculate_circular_delta_minutes(current: float | None, baseline: float | None) -> float | None:
    """Signed shortest-arc difference (current - baseline) in minutes on a 24h circle,
    in (-720, 720]. Positive = later than baseline, negative = earlier. E.g. current=00:10
    (10min) vs baseline=23:50 (1430min) -> +20min (20 minutes later), not the -1420min a
    naive linear subtraction would give."""
    if current is None or baseline is None:
        return None
    return (current - baseline + 720.0) % 1440.0 - 720.0


def calculate_accumulated_deficit(
    values: Sequence[float | int | None], baseline: float | None, n: int
) -> float | None:
    """Sum of (baseline - actual) over the most recent `n` window entries that have a
    value -- signed: positive = net shortfall vs baseline over those nights, negative =
    net surplus. "Most recent n WITH data" tolerates a sync gap the same way
    calculate_median/calculate_average already do elsewhere in this module, so this is not
    strictly the last n *calendar* nights when there's a gap. Requires baseline and at
    least n valid values, else None -- a partial sum would silently understate a real
    multi-night deficit."""
    if baseline is None:
        return None
    valid = [v for v in values if v is not None]
    if len(valid) < n:
        return None
    return sum(baseline - v for v in valid[-n:])


def classify_activity_intensity(
    training_effect: float,
    average_hr: float | None,
    zone4_floor: int | float | None = None,
) -> tuple[bool, str]:
    """
    Classify activity intensity based on Training Effect or Average HR.
    Rule: training_effect >= 3.0 OR average_hr >= threshold -> Hard
    Where threshold is zone4_floor (if provided and > 0) or HARD_SESSION_MIN_AVERAGE_HR (145).

    Provider-neutral: takes plain extracted values, not a raw provider payload, so any
    adapter can call this shared domain rule after extracting its own training-effect
    and average-HR fields.
    """
    te = training_effect or 0.0
    avg_hr = average_hr or 0
    hr_threshold = (
        zone4_floor
        if (zone4_floor is not None and zone4_floor > 0)
        else HARD_SESSION_MIN_AVERAGE_HR
    )
    is_hard = te >= HARD_SESSION_MIN_TRAINING_EFFECT or avg_hr >= hr_threshold
    if is_hard:
        intensity_tag = "hard"
    elif te < 2.0:
        intensity_tag = "easy"
    else:
        intensity_tag = "moderate"
    return is_hard, intensity_tag


def _extract_window_metrics(
    raws: list[dict[str, Any]], timezone_name: str
) -> dict[str, list[float | int]]:
    """Extract non-None metric series from a window in a single pass."""
    metrics: dict[str, list[float | int]] = {
        "sleepScore": [],
        "restingHr": [],
        "hrvOvernightAvg": [],
        "respirationAvg": [],
        "totalSteps": [],
        "bodyBatteryWake": [],
        "stressAvg": [],
        "stressMax": [],
        "trainingReadiness": [],
        "sleepDurationSec": [],
        "bedtimeMinutes": [],
        "wakeTimeMinutes": [],
        "sleepMidpointMinutes": [],
    }
    for d in raws:
        if (v := d.get("sleepScore")) is not None:
            metrics["sleepScore"].append(v)
        if (v := d.get("restingHr")) is not None:
            metrics["restingHr"].append(v)
        if (v := d.get("hrvOvernightAvg")) is not None:
            metrics["hrvOvernightAvg"].append(v)
        if (v := d.get("respirationAvg")) is not None:
            metrics["respirationAvg"].append(v)
        if (v := d.get("totalSteps")) is not None:
            metrics["totalSteps"].append(v)
        if (v := d.get("bodyBatteryWake")) is not None:
            metrics["bodyBatteryWake"].append(v)
        if stress := d.get("stress"):
            if isinstance(stress, dict):
                if (v := stress.get("avg")) is not None:
                    metrics["stressAvg"].append(v)
                if (v := stress.get("max")) is not None:
                    metrics["stressMax"].append(v)
        if readiness := d.get("trainingReadiness"):
            if isinstance(readiness, dict) and (v := readiness.get("score")) is not None:
                metrics["trainingReadiness"].append(v)
        if (v := d.get("sleepDurationSec")) is not None:
            metrics["sleepDurationSec"].append(v)
        session_start = d.get("sleepSessionStart")
        session_end = d.get("sleepSessionEnd")
        if (bedtime := minutes_of_day_local(session_start, timezone_name)) is not None:
            metrics["bedtimeMinutes"].append(bedtime)
        if (wake_time := minutes_of_day_local(session_end, timezone_name)) is not None:
            metrics["wakeTimeMinutes"].append(wake_time)
        midpoint_iso = sleep_midpoint_iso(session_start, session_end)
        if (midpoint := minutes_of_day_local(midpoint_iso, timezone_name)) is not None:
            metrics["sleepMidpointMinutes"].append(midpoint)
    return metrics


def compute_derived_metrics(
    raw_current: dict[str, Any],
    window_7d_raws: list[dict[str, Any]],
    window_28d_raws: list[dict[str, Any]],
    timezone_name: str = "Europe/Warsaw",
) -> DerivedMetrics:
    """
    Compute 7-day and 28-day historical baselines and deltas.
    - 7-day baseline requires >= 4 valid points
    - 28-day baseline requires >= 14 valid points
    - Current day must be excluded from windows

    `timezone_name` localizes v6's bedtime/wake-time/sleep-midpoint circular baselines
    (sleepSessionStart/End are UTC timestamps; clock-time-of-day only means something in a
    specific timezone). Defaults to Europe/Warsaw, this app's single supported timezone
    (see CLAUDE.md), so existing callers that don't pass it explicitly are unaffected.
    """
    w7 = _extract_window_metrics(window_7d_raws, timezone_name)
    w28 = _extract_window_metrics(window_28d_raws, timezone_name)

    sleep_7d = calculate_average(w7["sleepScore"], 4)
    sleep_28d = calculate_average(w28["sleepScore"], 14)

    rhr_7d = calculate_average(w7["restingHr"], 4)
    rhr_28d = calculate_average(w28["restingHr"], 14)

    hrv_7d = calculate_average(w7["hrvOvernightAvg"], 4)
    hrv_28d = calculate_average(w28["hrvOvernightAvg"], 14)

    # Respiration's v3 robust-baseline candidate uses median so a small number of elevated
    # nights do not redefine the trailing center. Production scoring remains default-off
    # pending replay/calibration; see ADR-0006 and ADR-0024.
    resp_7d = calculate_median(w7["respirationAvg"], 4)
    resp_28d = calculate_median(w28["respirationAvg"], 14)

    steps_7d = calculate_average(w7["totalSteps"], 4)
    steps_28d = calculate_average(w28["totalSteps"], 14)

    # 28-day trailing stdev per metric -- this person's own night-to-night noise floor,
    # consumed by the engine to normalize deltas instead of comparing against a single
    # fixed absolute threshold for everyone (see DerivedMetrics.hrv28dStdev docstring).
    hrv_sd28 = calculate_stdev(w28["hrvOvernightAvg"], 14)
    rhr_sd28 = calculate_stdev(w28["restingHr"], 14)
    sleep_sd28 = calculate_stdev(w28["sleepScore"], 14)
    steps_sd28 = calculate_stdev(w28["totalSteps"], 14)
    # Respiration's candidate robust spread is persisted for comparison. Scaled MAD is
    # normal-consistent, not universally equivalent to stdev; see calculate_mad/ADR-0024.
    resp_mad28 = calculate_mad(w28["respirationAvg"], 14)

    # v4: candidate median/MAD summaries alongside the existing live estimators. These are
    # observation-only. ADR-0024 explicitly rejects treating them as a presumed successor
    # for every metric (notably HRV, steps and bounded sleep score).
    sleep_7d_median = calculate_median(w7["sleepScore"], 4)
    sleep_28d_median = calculate_median(w28["sleepScore"], 14)
    rhr_7d_median = calculate_median(w7["restingHr"], 4)
    rhr_28d_median = calculate_median(w28["restingHr"], 14)
    hrv_7d_median = calculate_median(w7["hrvOvernightAvg"], 4)
    hrv_28d_median = calculate_median(w28["hrvOvernightAvg"], 14)
    steps_7d_median = calculate_median(w7["totalSteps"], 4)
    steps_28d_median = calculate_median(w28["totalSteps"], 14)

    sleep_mad28 = calculate_mad(w28["sleepScore"], 14)
    rhr_mad28 = calculate_mad(w28["restingHr"], 14)
    hrv_mad28 = calculate_mad(w28["hrvOvernightAvg"], 14)
    steps_mad28 = calculate_mad(w28["totalSteps"], 14)

    # v5: observation-only candidate baselines for provider composites/enrichment fields.
    # These overlap upstream physiology (for example HRV/sleep/stress) and must not simply
    # become additive strain terms; ADR-0024 requires correlation/double-counting analysis.
    bb_wake_7d_median = calculate_median(w7["bodyBatteryWake"], 4)
    bb_wake_28d_median = calculate_median(w28["bodyBatteryWake"], 14)
    bb_wake_mad28 = calculate_mad(w28["bodyBatteryWake"], 14)

    stress_avg_7d_median = calculate_median(w7["stressAvg"], 4)
    stress_avg_28d_median = calculate_median(w28["stressAvg"], 14)
    stress_avg_mad28 = calculate_mad(w28["stressAvg"], 14)

    stress_max_7d_median = calculate_median(w7["stressMax"], 4)
    stress_max_28d_median = calculate_median(w28["stressMax"], 14)
    stress_max_mad28 = calculate_mad(w28["stressMax"], 14)

    readiness_7d_median = calculate_median(w7["trainingReadiness"], 4)
    readiness_28d_median = calculate_median(w28["trainingReadiness"], 14)
    readiness_mad28 = calculate_mad(w28["trainingReadiness"], 14)

    # v6: sleep-duration median/MAD baselines, plus a 2d/3d accumulated deficit against the
    # 28d median (see calculate_accumulated_deficit's docstring for the signed-sum and
    # gap-tolerance semantics).
    sleep_duration_7d_median = calculate_median(w7["sleepDurationSec"], 4)
    sleep_duration_28d_median = calculate_median(w28["sleepDurationSec"], 14)
    sleep_duration_mad28 = calculate_mad(w28["sleepDurationSec"], 14)
    sleep_duration_accumulated_2d = calculate_accumulated_deficit(
        w28["sleepDurationSec"], sleep_duration_28d_median, 2
    )
    sleep_duration_accumulated_3d = calculate_accumulated_deficit(
        w28["sleepDurationSec"], sleep_duration_28d_median, 3
    )

    # v6: bedtime/wake-time/sleep-midpoint circular-mean baselines (minutes since local
    # midnight) -- see calculate_circular_mean_minutes's docstring for why mean, not median.
    bedtime_7d_mean = calculate_circular_mean_minutes(w7["bedtimeMinutes"], 4)
    bedtime_28d_mean = calculate_circular_mean_minutes(w28["bedtimeMinutes"], 14)
    wake_time_7d_mean = calculate_circular_mean_minutes(w7["wakeTimeMinutes"], 4)
    wake_time_28d_mean = calculate_circular_mean_minutes(w28["wakeTimeMinutes"], 14)
    sleep_midpoint_7d_mean = calculate_circular_mean_minutes(w7["sleepMidpointMinutes"], 4)
    sleep_midpoint_28d_mean = calculate_circular_mean_minutes(w28["sleepMidpointMinutes"], 14)

    current_bedtime_minutes = minutes_of_day_local(
        raw_current.get("sleepSessionStart"), timezone_name
    )
    current_wake_time_minutes = minutes_of_day_local(
        raw_current.get("sleepSessionEnd"), timezone_name
    )
    current_midpoint_minutes = minutes_of_day_local(
        sleep_midpoint_iso(
            raw_current.get("sleepSessionStart"), raw_current.get("sleepSessionEnd")
        ),
        timezone_name,
    )

    current_stress = raw_current.get("stress") or {}
    current_readiness = raw_current.get("trainingReadiness") or {}

    def _round(val: float | None) -> float | None:
        return round(val, 1) if val is not None else None

    deltas = DerivedDeltas(
        sleepScoreVs7d=_round(calculate_delta(raw_current.get("sleepScore"), sleep_7d)),
        sleepScoreVs28d=_round(calculate_delta(raw_current.get("sleepScore"), sleep_28d)),
        restingHrVs7d=_round(calculate_delta(raw_current.get("restingHr"), rhr_7d)),
        restingHrVs28d=_round(calculate_delta(raw_current.get("restingHr"), rhr_28d)),
        hrvVs7d=_round(calculate_delta(raw_current.get("hrvOvernightAvg"), hrv_7d)),
        hrvVs28d=_round(calculate_delta(raw_current.get("hrvOvernightAvg"), hrv_28d)),
        respirationVs7d=_round(calculate_delta(raw_current.get("respirationAvg"), resp_7d)),
        respirationVs28d=_round(calculate_delta(raw_current.get("respirationAvg"), resp_28d)),
        stepsVs7d=_round(calculate_delta(raw_current.get("totalSteps"), steps_7d)),
        stepsVs28d=_round(calculate_delta(raw_current.get("totalSteps"), steps_28d)),
        # v4: median-baseline deltas, observation-only -- see the median/MAD comment above.
        sleepScoreVs7dMedian=_round(
            calculate_delta(raw_current.get("sleepScore"), sleep_7d_median)
        ),
        sleepScoreVs28dMedian=_round(
            calculate_delta(raw_current.get("sleepScore"), sleep_28d_median)
        ),
        restingHrVs7dMedian=_round(calculate_delta(raw_current.get("restingHr"), rhr_7d_median)),
        restingHrVs28dMedian=_round(calculate_delta(raw_current.get("restingHr"), rhr_28d_median)),
        hrvVs7dMedian=_round(calculate_delta(raw_current.get("hrvOvernightAvg"), hrv_7d_median)),
        hrvVs28dMedian=_round(calculate_delta(raw_current.get("hrvOvernightAvg"), hrv_28d_median)),
        stepsVs7dMedian=_round(calculate_delta(raw_current.get("totalSteps"), steps_7d_median)),
        stepsVs28dMedian=_round(calculate_delta(raw_current.get("totalSteps"), steps_28d_median)),
        # v5: median-baseline deltas for body battery wake / stress / training readiness,
        # observation-only -- see the v5 comment above.
        bodyBatteryWakeVs7dMedian=_round(
            calculate_delta(raw_current.get("bodyBatteryWake"), bb_wake_7d_median)
        ),
        bodyBatteryWakeVs28dMedian=_round(
            calculate_delta(raw_current.get("bodyBatteryWake"), bb_wake_28d_median)
        ),
        stressAvgVs7dMedian=_round(
            calculate_delta(current_stress.get("avg"), stress_avg_7d_median)
        ),
        stressAvgVs28dMedian=_round(
            calculate_delta(current_stress.get("avg"), stress_avg_28d_median)
        ),
        stressMaxVs7dMedian=_round(
            calculate_delta(current_stress.get("max"), stress_max_7d_median)
        ),
        stressMaxVs28dMedian=_round(
            calculate_delta(current_stress.get("max"), stress_max_28d_median)
        ),
        trainingReadinessScoreVs7dMedian=_round(
            calculate_delta(current_readiness.get("score"), readiness_7d_median)
        ),
        trainingReadinessScoreVs28dMedian=_round(
            calculate_delta(current_readiness.get("score"), readiness_28d_median)
        ),
        # v6: sleep-duration median-baseline deltas and circular time-of-day deviations --
        # see the v6 comment above. Circular deltas use calculate_circular_delta_minutes
        # (shortest-arc, signed), not calculate_delta (which would give a huge, wrong value
        # whenever the baseline and current straddle midnight).
        sleepDurationVs7dMedian=_round(
            calculate_delta(raw_current.get("sleepDurationSec"), sleep_duration_7d_median)
        ),
        sleepDurationVs28dMedian=_round(
            calculate_delta(raw_current.get("sleepDurationSec"), sleep_duration_28d_median)
        ),
        bedtimeDeviationVs7dMinutes=_round(
            calculate_circular_delta_minutes(current_bedtime_minutes, bedtime_7d_mean)
        ),
        bedtimeDeviationVs28dMinutes=_round(
            calculate_circular_delta_minutes(current_bedtime_minutes, bedtime_28d_mean)
        ),
        wakeTimeDeviationVs7dMinutes=_round(
            calculate_circular_delta_minutes(current_wake_time_minutes, wake_time_7d_mean)
        ),
        wakeTimeDeviationVs28dMinutes=_round(
            calculate_circular_delta_minutes(current_wake_time_minutes, wake_time_28d_mean)
        ),
        sleepMidpointDeviationVs7dMinutes=_round(
            calculate_circular_delta_minutes(current_midpoint_minutes, sleep_midpoint_7d_mean)
        ),
        sleepMidpointDeviationVs28dMinutes=_round(
            calculate_circular_delta_minutes(current_midpoint_minutes, sleep_midpoint_28d_mean)
        ),
    )

    return DerivedMetrics(
        baselineComputationVersion=BASELINE_COMPUTATION_VERSION,
        sleepScore7dAvg=_round(sleep_7d),
        sleepScore28dAvg=_round(sleep_28d),
        restingHr7dAvg=_round(rhr_7d),
        restingHr28dAvg=_round(rhr_28d),
        hrv7dAvg=_round(hrv_7d),
        hrv28dAvg=_round(hrv_28d),
        respiration7dAvg=_round(resp_7d),
        respiration28dAvg=_round(resp_28d),
        hrv28dStdev=_round(hrv_sd28),
        restingHr28dStdev=_round(rhr_sd28),
        sleepScore28dStdev=_round(sleep_sd28),
        respiration28dMad=_round(resp_mad28),
        steps7dAvg=_round(steps_7d),
        steps28dAvg=_round(steps_28d),
        steps28dStdev=_round(steps_sd28),
        # v4: observation-only median/MAD baselines -- see ADR-0024 for metric-specific candidates.
        sleepScore7dMedian=_round(sleep_7d_median),
        sleepScore28dMedian=_round(sleep_28d_median),
        sleepScore28dMad=_round(sleep_mad28),
        restingHr7dMedian=_round(rhr_7d_median),
        restingHr28dMedian=_round(rhr_28d_median),
        restingHr28dMad=_round(rhr_mad28),
        hrv7dMedian=_round(hrv_7d_median),
        hrv28dMedian=_round(hrv_28d_median),
        hrv28dMad=_round(hrv_mad28),
        steps7dMedian=_round(steps_7d_median),
        steps28dMedian=_round(steps_28d_median),
        steps28dMad=_round(steps_mad28),
        # v5: observation-only median/MAD baselines -- keep composite signals non-additive.
        bodyBatteryWake7dMedian=_round(bb_wake_7d_median),
        bodyBatteryWake28dMedian=_round(bb_wake_28d_median),
        bodyBatteryWake28dMad=_round(bb_wake_mad28),
        stressAvg7dMedian=_round(stress_avg_7d_median),
        stressAvg28dMedian=_round(stress_avg_28d_median),
        stressAvg28dMad=_round(stress_avg_mad28),
        stressMax7dMedian=_round(stress_max_7d_median),
        stressMax28dMedian=_round(stress_max_28d_median),
        stressMax28dMad=_round(stress_max_mad28),
        trainingReadinessScore7dMedian=_round(readiness_7d_median),
        trainingReadinessScore28dMedian=_round(readiness_28d_median),
        trainingReadinessScore28dMad=_round(readiness_mad28),
        # v6: sleep-duration median/MAD, accumulated deficit, and circular time-of-day
        # baselines -- see the v6 comment above.
        sleepDuration7dMedian=_round(sleep_duration_7d_median),
        sleepDuration28dMedian=_round(sleep_duration_28d_median),
        sleepDuration28dMad=_round(sleep_duration_mad28),
        sleepDurationAccumulated2dDeficitSec=_round(sleep_duration_accumulated_2d),
        sleepDurationAccumulated3dDeficitSec=_round(sleep_duration_accumulated_3d),
        bedtime7dCircularMeanMinutes=_round(bedtime_7d_mean),
        bedtime28dCircularMeanMinutes=_round(bedtime_28d_mean),
        wakeTime7dCircularMeanMinutes=_round(wake_time_7d_mean),
        wakeTime28dCircularMeanMinutes=_round(wake_time_28d_mean),
        sleepMidpoint7dCircularMeanMinutes=_round(sleep_midpoint_7d_mean),
        sleepMidpoint28dCircularMeanMinutes=_round(sleep_midpoint_28d_mean),
        deltas=deltas,
    )
