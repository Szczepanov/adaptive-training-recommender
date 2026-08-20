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

    Median is an outlier-resistant location estimator. Respiration uses it for the v3
    robust-baseline candidate because transient elevated nights can contaminate a trailing
    mean. Other metrics also persist medians for observation/comparison, but that does not
    imply median is their preferred production estimator; see ADR-0024.
    """
    valid_values = [v for v in values if v is not None]
    if len(valid_values) >= min_required:
        return statistics.median(valid_values)
    return None


def calculate_mad(values: list[float | int | None], min_required: int) -> float | None:
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

    # Respiration's v3 robust-baseline candidate uses median so a small number of elevated
    # nights do not redefine the trailing center. Production scoring remains default-off
    # pending replay/calibration; see ADR-0006 and ADR-0024.
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
    # Respiration's candidate robust spread is persisted for comparison. Scaled MAD is
    # normal-consistent, not universally equivalent to stdev; see calculate_mad/ADR-0024.
    resp_mad28 = calculate_mad([d.get("respirationAvg") for d in window_28d_raws], 14)

    # v4: candidate median/MAD summaries alongside the existing live estimators. These are
    # observation-only. ADR-0024 explicitly rejects treating them as a presumed successor
    # for every metric (notably HRV, steps and bounded sleep score).
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

    # v5: observation-only candidate baselines for provider composites/enrichment fields.
    # These overlap upstream physiology (for example HRV/sleep/stress) and must not simply
    # become additive strain terms; ADR-0024 requires correlation/double-counting analysis.
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
        deltas=deltas,
    )
