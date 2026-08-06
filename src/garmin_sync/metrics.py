from typing import Any
from .models import DerivedMetrics, DerivedDeltas, BASELINE_COMPUTATION_VERSION

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


def classify_activity_intensity(training_effect: float, average_hr: float | None) -> tuple[bool, str]:
    """
    Classify activity intensity based on Training Effect or Average HR.
    Rule: training_effect >= 3.0 OR average_hr >= 145 -> Hard

    Provider-neutral: takes plain extracted values, not a raw provider payload, so any
    adapter can call this shared domain rule after extracting its own training-effect
    and average-HR fields.
    """
    te = training_effect or 0.0
    avg_hr = average_hr or 0
    is_hard = (te >= HARD_SESSION_MIN_TRAINING_EFFECT or avg_hr >= HARD_SESSION_MIN_AVERAGE_HR)
    intensity_tag = "hard" if is_hard else "moderate/easy"
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

    resp_7d = calculate_average([d.get("respirationAvg") for d in window_7d_raws], 4)
    resp_28d = calculate_average([d.get("respirationAvg") for d in window_28d_raws], 14)

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
        deltas=deltas,
    )
