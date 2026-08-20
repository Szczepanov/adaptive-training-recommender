import statistics
from typing import Any

from .models import BASELINE_COMPUTATION_VERSION, DerivedDeltas, DerivedMetrics

# Domain intensity thresholds (temporary heuristics)
HARD_SESSION_MIN_TRAINING_EFFECT = 3.0
HARD_SESSION_MIN_AVERAGE_HR = 145


def calculate_average(values: list[float | int | None], min_required: int) -> float | None:
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


def calculate_stdev(values: list[float | int | None], min_required: int) -> float | None:
    """Population stdev of non-None values if count meets min_required threshold.

    Uses the same min_required as the corresponding baseline average so a stdev is
    never reported as "ready" ahead of the average it's meant to normalize.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return statistics.pstdev(valid_values)
    return None


def calculate_median(values: list[float | int | None], min_required: int) -> float | None:
    """Median of non-None values if count meets min_required threshold.

    Used for respiration rate instead of calculate_average: a trailing window can contain
    a prior illness episode -- the exact deviation this baseline exists to detect -- and a
    mean baseline gets dragged upward by those elevated nights, blunting sensitivity for
    weeks after recovery. The median resists that contamination. See calculate_mad for the
    matching outlier-resistant spread estimator.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return statistics.median(valid_values)
    return None


def calculate_mad(values: list[float | int | None], min_required: int) -> float | None:
    """Median absolute deviation of non-None values, scaled by 1.4826 (the consistency
    constant for a normal distribution) so it's comparable in magnitude to calculate_stdev's
    population stdev and usable as a drop-in noise-floor denominator the same way (see
    metricStrain in app/src/engine/rules.ts). A few elevated nights from a prior illness
    episode barely move it, unlike population stdev, which those same nights inflate --
    widening the "normal" band and desensitizing z-score-style strain detection.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        med = statistics.median(valid_values)
        mad = statistics.median([abs(v - med) for v in valid_values])
        return mad * 1.4826
    return None


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


def compute_derived_metrics(
    raw_current: dict[str, Any],
    window_7d_raws: list[dict[str, Any]],
    window_28d_raws: list[dict[str, Any]],
) -> DerivedMetrics:
    """
    Compute 7-day and 28-day historical baselines and deltas.
    - 7-day baseline requires >= 4 valid points
    - 28-day baseline requires >= 14 valid points
    - Current day must be excluded from windows
    """
    sleep_7d = calculate_average([d.get("sleepScore") for d in window_7d_raws], 4)
    sleep_28d = calculate_average([d.get("sleepScore") for d in window_28d_raws], 14)

    rhr_7d = calculate_average([d.get("restingHr") for d in window_7d_raws], 4)
    rhr_28d = calculate_average([d.get("restingHr") for d in window_28d_raws], 14)

    hrv_7d = calculate_average([d.get("hrvOvernightAvg") for d in window_7d_raws], 4)
    hrv_28d = calculate_average([d.get("hrvOvernightAvg") for d in window_28d_raws], 14)

    # Median, not mean -- see calculate_median's docstring: a mean baseline gets dragged
    # upward by a prior illness episode sitting inside the trailing window, which is
    # exactly the deviation this baseline exists to detect.
    resp_7d = calculate_median([d.get("respirationAvg") for d in window_7d_raws], 4)
    resp_28d = calculate_median([d.get("respirationAvg") for d in window_28d_raws], 14)

    steps_7d = calculate_average([d.get("totalSteps") for d in window_7d_raws], 4)
    steps_28d = calculate_average([d.get("totalSteps") for d in window_28d_raws], 14)

    # 28-day trailing stdev per metric -- this person's own night-to-night noise floor,
    # consumed by the engine to normalize deltas instead of comparing against a single
    # fixed absolute threshold for everyone (see DerivedMetrics.hrv28dStdev docstring).
    hrv_sd28 = calculate_stdev([d.get("hrvOvernightAvg") for d in window_28d_raws], 14)
    rhr_sd28 = calculate_stdev([d.get("restingHr") for d in window_28d_raws], 14)
    sleep_sd28 = calculate_stdev([d.get("sleepScore") for d in window_28d_raws], 14)
    steps_sd28 = calculate_stdev([d.get("totalSteps") for d in window_28d_raws], 14)
    # MAD, not population stdev -- see calculate_mad's docstring: it stays stable across a
    # prior illness episode inside the window instead of being widened by it.
    resp_mad28 = calculate_mad([d.get("respirationAvg") for d in window_28d_raws], 14)

    # v4 (docs/adr/0006 amendment): median/MAD computed *alongside* the existing mean/stdev
    # for sleep, RHR, HRV, and steps -- observation-only, exactly like respiration was
    # before its own v3 cutover. Not read by rules.ts/fatigue.ts yet; these exist so a
    # comparison harness can measure how often/how much a median/MAD baseline would change
    # `mode` before any of these four metrics' live mean/stdev gets replaced (see ADR-0014's
    # precedent: a live decision function only changes after a recorded comparison).
    sleep_7d_median = calculate_median([d.get("sleepScore") for d in window_7d_raws], 4)
    sleep_28d_median = calculate_median([d.get("sleepScore") for d in window_28d_raws], 14)
    rhr_7d_median = calculate_median([d.get("restingHr") for d in window_7d_raws], 4)
    rhr_28d_median = calculate_median([d.get("restingHr") for d in window_28d_raws], 14)
    hrv_7d_median = calculate_median([d.get("hrvOvernightAvg") for d in window_7d_raws], 4)
    hrv_28d_median = calculate_median([d.get("hrvOvernightAvg") for d in window_28d_raws], 14)
    steps_7d_median = calculate_median([d.get("totalSteps") for d in window_7d_raws], 4)
    steps_28d_median = calculate_median([d.get("totalSteps") for d in window_28d_raws], 14)

    sleep_mad28 = calculate_mad([d.get("sleepScore") for d in window_28d_raws], 14)
    rhr_mad28 = calculate_mad([d.get("restingHr") for d in window_28d_raws], 14)
    hrv_mad28 = calculate_mad([d.get("hrvOvernightAvg") for d in window_28d_raws], 14)
    steps_mad28 = calculate_mad([d.get("totalSteps") for d in window_28d_raws], 14)

    # v5 (docs/adr/0006 amendment): observation-only 7d/28d median + 28d MAD baselines for
    # body battery wake and the "metric enrichment" fields (stress avg/max, training
    # readiness score) -- unlike v4's sleep/RHR/HRV/steps, none of these had *any* baseline
    # (mean or median) before this. Not read by rules.ts/fatigue.ts yet -- same
    # observation-before-wiring posture CanonicalDailyMetrics's own docstring already
    # applies to stress/training readiness/training status/heart rate zones.
    def _stress_avg(d: dict[str, Any]) -> float | int | None:
        return (d.get("stress") or {}).get("avg")

    def _stress_max(d: dict[str, Any]) -> float | int | None:
        return (d.get("stress") or {}).get("max")

    def _training_readiness_score(d: dict[str, Any]) -> float | int | None:
        return (d.get("trainingReadiness") or {}).get("score")

    bb_wake_7d_median = calculate_median([d.get("bodyBatteryWake") for d in window_7d_raws], 4)
    bb_wake_28d_median = calculate_median([d.get("bodyBatteryWake") for d in window_28d_raws], 14)
    bb_wake_mad28 = calculate_mad([d.get("bodyBatteryWake") for d in window_28d_raws], 14)

    stress_avg_7d_median = calculate_median([_stress_avg(d) for d in window_7d_raws], 4)
    stress_avg_28d_median = calculate_median([_stress_avg(d) for d in window_28d_raws], 14)
    stress_avg_mad28 = calculate_mad([_stress_avg(d) for d in window_28d_raws], 14)

    stress_max_7d_median = calculate_median([_stress_max(d) for d in window_7d_raws], 4)
    stress_max_28d_median = calculate_median([_stress_max(d) for d in window_28d_raws], 14)
    stress_max_mad28 = calculate_mad([_stress_max(d) for d in window_28d_raws], 14)

    readiness_7d_median = calculate_median(
        [_training_readiness_score(d) for d in window_7d_raws], 4
    )
    readiness_28d_median = calculate_median(
        [_training_readiness_score(d) for d in window_28d_raws], 14
    )
    readiness_mad28 = calculate_mad([_training_readiness_score(d) for d in window_28d_raws], 14)

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
        # v4: observation-only median/MAD baselines -- see the comment above compute_derived_metrics.
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
        # v5: observation-only median/MAD baselines -- see the v5 comment above.
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
        deltas=deltas,
    )
