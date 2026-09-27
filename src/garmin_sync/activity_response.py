"""Decision-relevant multi-resolution session analysis (issue #850).

Raw FIT records remain transient. This module consumes the already-decoded in-memory
FitActivityEvidence and returns only bounded, provider-neutral summaries suitable for
standalone activity persistence and context export.

The extractor deliberately separates source resolution, feature analysis windows and
bounded semantic export. Structured workout semantics outrank manual laps. A workout
fingerprint by itself is not segment identity: a semantic segment requires performed
Lap/Record execution linkage to an actual FIT Workout Step definition.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median
from typing import Callable, Iterable

from .canonical import (
    CanonicalActivityResponseTelemetry,
    CanonicalActivitySegmentSummary,
    CanonicalPowerDurationPeak,
    CanonicalPrescribedTarget,
    CanonicalSignalResolution,
    CanonicalSteadyHalfSummary,
)
from .fit_activity import (
    FitActivityEvidence,
    FitLapEvidence,
    FitRecordSample,
    FitWorkoutStepEvidence,
)

DERIVATION_VERSION = "multi-resolution-v1"
MAX_PERSISTED_SEGMENTS = 64
POWER_DURATION_WINDOWS_SECONDS = (1, 5, 10, 30, 60, 180, 300, 1200)
RESOLUTION_CANDIDATES_SECONDS = (1, 2, 5, 10, 15, 30, 60, 120, 300, 600)
_CYCLING_TYPES = {
    "cycling",
    "cyclocross",
    "gravel_cycling",
    "indoor_cycling",
    "mountain_biking",
    "road_biking",
    "virtual_ride",
}


def _finite_number(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return float(value)


def _normalized_identifier(value: str | int | None) -> str:
    if isinstance(value, str):
        return value.strip().casefold()
    return str(value) if value is not None else ""


def _timestamped_values(
    records: Iterable[FitRecordSample],
    read: Callable[[FitRecordSample], float | None],
) -> list[tuple[datetime, float]]:
    values: list[tuple[datetime, float]] = []
    for record in records:
        value = _finite_number(read(record))
        if record.timestamp is not None and value is not None:
            values.append((record.timestamp, value))
    values.sort(key=lambda item: item[0])
    return values


def _resolution_seconds(
    records: Iterable[FitRecordSample],
    read: Callable[[FitRecordSample], float | None],
) -> float | None:
    values = _timestamped_values(records, read)
    if len(values) < 3:
        return None
    deltas = [
        (current[0] - previous[0]).total_seconds()
        for previous, current in zip(values, values[1:])
    ]
    positive = [delta for delta in deltas if math.isfinite(delta) and delta > 0]
    if len(positive) < 2:
        return None
    return round(float(median(positive)), 3)


def _source_resolution(records: tuple[FitRecordSample, ...]) -> CanonicalSignalResolution:
    return CanonicalSignalResolution(
        power_seconds=_resolution_seconds(records, lambda row: row.power_watts),
        hr_seconds=_resolution_seconds(records, lambda row: row.heart_rate_bpm),
        cadence_seconds=_resolution_seconds(records, lambda row: row.cadence_rpm),
    )


def _mean(values: Iterable[float | None]) -> float | None:
    finite = [float(value) for value in values if value is not None and math.isfinite(value)]
    return sum(finite) / len(finite) if finite else None


def _max(values: Iterable[float | None]) -> float | None:
    finite = [float(value) for value in values if value is not None and math.isfinite(value)]
    return max(finite) if finite else None


def _rounded(value: float | None, places: int = 1) -> float | None:
    return None if value is None else round(value, places)


def _records_between(
    records: tuple[FitRecordSample, ...],
    start: datetime | None,
    end: datetime | None,
) -> tuple[FitRecordSample, ...]:
    if start is None or end is None:
        return ()
    try:
        if end < start:
            return ()
    except TypeError:
        return ()
    selected: list[FitRecordSample] = []
    for record in records:
        if record.timestamp is None:
            continue
        try:
            if start <= record.timestamp <= end:
                selected.append(record)
        except TypeError:
            return ()
    return tuple(selected)


def _lap_bounds(lap: FitLapEvidence) -> tuple[datetime | None, datetime | None]:
    start = lap.start_time
    end = lap.timestamp
    if start is None and end is not None and lap.duration_seconds is not None:
        start = end - timedelta(seconds=lap.duration_seconds)
    if end is None and start is not None and lap.duration_seconds is not None:
        end = start + timedelta(seconds=lap.duration_seconds)
    return start, end


def _peak_power(
    records: Iterable[FitRecordSample],
    duration_seconds: int,
    source_resolution_seconds: float | None,
    activity_start: datetime | None = None,
    activity_end: datetime | None = None,
) -> tuple[float, float | None, str | None] | None:
    """Return mean peak power plus elapsed/half context for a supported window."""
    values = _timestamped_values(records, lambda row: row.power_watts)
    resolution = source_resolution_seconds
    if not values or resolution is None or resolution <= 0:
        return None
    max_supported_resolution = 1.0 if duration_seconds == 1 else duration_seconds / 5
    if resolution > max_supported_resolution + 1e-9:
        return None

    required = max(1, int(round(duration_seconds / resolution)))
    if len(values) < required:
        return None

    best_power: float | None = None
    best_start: datetime | None = None
    for index in range(0, len(values) - required + 1):
        window = values[index : index + required]
        if len(window) > 1:
            gaps = [
                (current[0] - previous[0]).total_seconds()
                for previous, current in zip(window, window[1:])
            ]
            if any(gap <= 0 or gap > resolution * 2.5 for gap in gaps):
                continue
            observed_span = (window[-1][0] - window[0][0]).total_seconds() + resolution
            if observed_span < duration_seconds * 0.8 or observed_span > duration_seconds * 1.25:
                continue
        value = sum(item[1] for item in window) / len(window)
        if best_power is None or value > best_power:
            best_power = value
            best_start = window[0][0]

    if best_power is None:
        return None

    elapsed: float | None = None
    half: str | None = None
    if best_start is not None and activity_start is not None:
        try:
            elapsed = max(0.0, (best_start - activity_start).total_seconds())
            if activity_end is not None and activity_end > activity_start:
                midpoint = activity_start + (activity_end - activity_start) / 2
                half = "first" if best_start < midpoint else "second"
        except TypeError:
            elapsed = None
            half = None
    return best_power, elapsed, half


def _power_duration_peaks(
    records: tuple[FitRecordSample, ...],
    source_resolution_seconds: float | None,
) -> tuple[CanonicalPowerDurationPeak, ...]:
    timestamped = [record.timestamp for record in records if record.timestamp is not None]
    if not timestamped:
        return ()
    activity_start = min(timestamped)
    activity_end = max(timestamped)
    peaks: list[CanonicalPowerDurationPeak] = []
    for duration in POWER_DURATION_WINDOWS_SECONDS:
        result = _peak_power(
            records,
            duration,
            source_resolution_seconds,
            activity_start=activity_start,
            activity_end=activity_end,
        )
        if result is None:
            continue
        power, elapsed, half = result
        confidence = (
            "high"
            if source_resolution_seconds is not None and source_resolution_seconds <= 1.1
            else "moderate"
        )
        peaks.append(
            CanonicalPowerDurationPeak(
                duration_seconds=duration,
                power_watts=round(power, 1),
                confidence=confidence,
                elapsed_before_seconds=_rounded(elapsed),
                activity_half=half,
            )
        )
    return tuple(peaks)


def _segment_type(step: FitWorkoutStepEvidence | None, duration_seconds: float) -> str:
    if step is None:
        return "unknown"
    intensity = _normalized_identifier(step.intensity)
    if intensity in {"1", "rest", "4", "recovery", "recover"}:
        return "recovery"
    if intensity in {"2", "warmup", "warm_up"}:
        return "warmup"
    if intensity in {"3", "cooldown", "cool_down"}:
        return "cooldown"
    if intensity in {"0", "active", "5", "interval"}:
        return "sprint" if duration_seconds <= 20 else "work"
    return "unknown"


def _prescribed_target(step: FitWorkoutStepEvidence | None) -> CanonicalPrescribedTarget | None:
    if step is None:
        return None
    target_type = _normalized_identifier(step.target_type)
    low = _finite_number(step.custom_target_value_low)
    high = _finite_number(step.custom_target_value_high)
    target = _finite_number(step.target_value)
    if target_type in {"4", "power"}:
        if low is not None or high is not None:
            if low is not None and high is not None and math.isclose(low, high):
                return CanonicalPrescribedTarget(kind="power_watts", value=low)
            return CanonicalPrescribedTarget(kind="power_range_watts", low=low, high=high)
        if target is not None:
            return CanonicalPrescribedTarget(kind="power_zone", value=target)
    if target_type:
        return CanonicalPrescribedTarget(
            kind=f"{target_type}_target",
            value=target,
            low=low,
            high=high,
        )
    return None


def _third_means(
    records: tuple[FitRecordSample, ...],
    start: datetime | None,
    end: datetime | None,
    read: Callable[[FitRecordSample], float | None],
) -> tuple[float | None, float | None, float | None]:
    if start is None or end is None:
        return None, None, None
    try:
        if end <= start:
            return None, None, None
        duration = (end - start).total_seconds()
    except TypeError:
        return None, None, None
    buckets: list[list[float]] = [[], [], []]
    for record in records:
        if record.timestamp is None:
            continue
        value = _finite_number(read(record))
        if value is None:
            continue
        try:
            relative = (record.timestamp - start).total_seconds()
        except TypeError:
            return None, None, None
        if relative < 0 or relative > duration:
            continue
        bucket = min(2, int((relative / duration) * 3))
        buckets[bucket].append(value)
    return _mean(buckets[0]), _mean(buckets[1]), _mean(buckets[2])


def _summarize_segment(
    segment_index: int,
    identity_source: str,
    step: FitWorkoutStepEvidence | None,
    duration_seconds: float,
    start: datetime | None,
    end: datetime | None,
    records: tuple[FitRecordSample, ...],
    resolution: CanonicalSignalResolution,
    fallback_power: float | None = None,
    fallback_hr: float | None = None,
    fallback_max_hr: float | None = None,
    fallback_cadence: float | None = None,
    fallback_max_cadence: float | None = None,
    activity_start: datetime | None = None,
) -> CanonicalActivitySegmentSummary:
    samples = _records_between(records, start, end)
    average_power = _mean(record.power_watts for record in samples)
    average_hr = _mean(record.heart_rate_bpm for record in samples)
    average_cadence = _mean(record.cadence_rpm for record in samples)
    max_hr = _max(record.heart_rate_bpm for record in samples)
    max_cadence = _max(record.cadence_rpm for record in samples)
    power_thirds = _third_means(samples, start, end, lambda row: row.power_watts)
    hr_thirds = _third_means(samples, start, end, lambda row: row.heart_rate_bpm)

    end_hr: float | None = None
    hr_samples = _timestamped_values(samples, lambda row: row.heart_rate_bpm)
    if hr_samples:
        tail_count = max(
            1,
            min(len(hr_samples), int(round(30 / (resolution.hr_seconds or 1)))),
        )
        end_hr = _mean(value for _, value in hr_samples[-tail_count:])

    peak_values: dict[int, float | None] = {}
    for duration in (1, 5, 10):
        result = _peak_power(samples, duration, resolution.power_seconds)
        peak_values[duration] = result[0] if result is not None else None

    offset: float | None = None
    if activity_start is not None and start is not None:
        try:
            offset = max(0.0, (start - activity_start).total_seconds())
        except TypeError:
            offset = None

    has_aligned_samples = bool(samples)
    confidence = (
        "high"
        if identity_source == "fit_workout_step" and has_aligned_samples
        else "moderate"
        if identity_source == "fit_workout_step"
        else "low"
    )

    return CanonicalActivitySegmentSummary(
        segment_index=segment_index,
        segment_type=_segment_type(step, duration_seconds),
        identity_source=identity_source,
        duration_seconds=round(duration_seconds, 1),
        evidence_confidence=confidence,
        start_offset_seconds=_rounded(offset),
        prescribed_target=_prescribed_target(step),
        average_power_watts=_rounded(
            average_power if average_power is not None else fallback_power
        ),
        peak_1s_power_watts=_rounded(peak_values[1]),
        peak_5s_power_watts=_rounded(peak_values[5]),
        peak_10s_power_watts=_rounded(peak_values[10]),
        average_hr_bpm=_rounded(average_hr if average_hr is not None else fallback_hr),
        end_hr_bpm=_rounded(end_hr),
        max_hr_bpm=_rounded(max_hr if max_hr is not None else fallback_max_hr),
        average_cadence_rpm=_rounded(
            average_cadence if average_cadence is not None else fallback_cadence
        ),
        max_cadence_rpm=_rounded(
            max_cadence if max_cadence is not None else fallback_max_cadence
        ),
        first_third_power_watts=_rounded(power_thirds[0]),
        middle_third_power_watts=_rounded(power_thirds[1]),
        last_third_power_watts=_rounded(power_thirds[2]),
        last_third_hr_bpm=_rounded(hr_thirds[2]),
    )


def _workout_step_map(
    steps: tuple[FitWorkoutStepEvidence, ...],
) -> dict[int, FitWorkoutStepEvidence]:
    result: dict[int, FitWorkoutStepEvidence] = {}
    for step in steps:
        if step.message_index is None or step.message_index in result:
            continue
        result[step.message_index] = step
    return result


def _semantic_lap_segments(
    evidence: FitActivityEvidence,
    resolution: CanonicalSignalResolution,
) -> list[CanonicalActivitySegmentSummary]:
    steps = _workout_step_map(evidence.workout_steps)
    if not steps:
        return []
    timestamped = [record.timestamp for record in evidence.records if record.timestamp is not None]
    activity_start = min(timestamped) if timestamped else None
    segments: list[CanonicalActivitySegmentSummary] = []
    for lap in evidence.laps:
        if lap.workout_step_index is None or lap.workout_step_index not in steps:
            continue
        duration = lap.duration_seconds
        start, end = _lap_bounds(lap)
        if duration is None and start is not None and end is not None:
            duration = (end - start).total_seconds()
        if duration is None or duration <= 0:
            continue
        segments.append(
            _summarize_segment(
                segment_index=len(segments) + 1,
                identity_source="fit_workout_step",
                step=steps[lap.workout_step_index],
                duration_seconds=duration,
                start=start,
                end=end,
                records=evidence.records,
                resolution=resolution,
                fallback_power=lap.average_power_watts,
                fallback_hr=lap.average_hr_bpm,
                fallback_max_hr=lap.max_hr_bpm,
                fallback_cadence=lap.average_cadence_rpm,
                fallback_max_cadence=lap.max_cadence_rpm,
                activity_start=activity_start,
            )
        )
    return segments


def _semantic_record_segments(
    evidence: FitActivityEvidence,
    resolution: CanonicalSignalResolution,
) -> list[CanonicalActivitySegmentSummary]:
    steps = _workout_step_map(evidence.workout_steps)
    records = [
        record
        for record in evidence.records
        if record.timestamp is not None
        and record.workout_step_index is not None
        and record.workout_step_index in steps
    ]
    if not records:
        return []
    records.sort(key=lambda row: row.timestamp or datetime.min)
    activity_start = records[0].timestamp
    groups: list[list[FitRecordSample]] = []
    for record in records:
        if not groups or groups[-1][-1].workout_step_index != record.workout_step_index:
            groups.append([record])
        else:
            groups[-1].append(record)

    segments: list[CanonicalActivitySegmentSummary] = []
    for group in groups:
        start = group[0].timestamp
        end = group[-1].timestamp
        if start is None or end is None:
            continue
        local_resolution = (
            resolution.power_seconds
            or resolution.hr_seconds
            or resolution.cadence_seconds
            or 1
        )
        duration = max(local_resolution, (end - start).total_seconds() + local_resolution)
        step_index = group[0].workout_step_index
        assert step_index is not None
        segments.append(
            _summarize_segment(
                segment_index=len(segments) + 1,
                identity_source="fit_workout_step",
                step=steps[step_index],
                duration_seconds=duration,
                start=start,
                end=end,
                records=tuple(group),
                resolution=resolution,
                activity_start=activity_start,
            )
        )
    return segments


def _manual_lap_segments(
    evidence: FitActivityEvidence,
    resolution: CanonicalSignalResolution,
) -> list[CanonicalActivitySegmentSummary]:
    timestamped = [record.timestamp for record in evidence.records if record.timestamp is not None]
    activity_start = min(timestamped) if timestamped else None
    segments: list[CanonicalActivitySegmentSummary] = []
    for lap in evidence.laps:
        duration = lap.duration_seconds
        start, end = _lap_bounds(lap)
        if duration is None and start is not None and end is not None:
            duration = (end - start).total_seconds()
        if duration is None or duration <= 0:
            continue
        segments.append(
            _summarize_segment(
                segment_index=len(segments) + 1,
                identity_source="manual_lap",
                step=None,
                duration_seconds=duration,
                start=start,
                end=end,
                records=evidence.records,
                resolution=resolution,
                fallback_power=lap.average_power_watts,
                fallback_hr=lap.average_hr_bpm,
                fallback_max_hr=lap.max_hr_bpm,
                fallback_cadence=lap.average_cadence_rpm,
                fallback_max_cadence=lap.max_cadence_rpm,
                activity_start=activity_start,
            )
        )
    return segments


def _steady_halves(records: tuple[FitRecordSample, ...]) -> CanonicalSteadyHalfSummary | None:
    timestamped = [record for record in records if record.timestamp is not None]
    if len(timestamped) < 10:
        return None
    timestamped.sort(key=lambda row: row.timestamp or datetime.min)
    start = timestamped[0].timestamp
    end = timestamped[-1].timestamp
    if start is None or end is None or (end - start).total_seconds() < 45 * 60:
        return None
    midpoint = start + (end - start) / 2
    first = [row for row in timestamped if row.timestamp is not None and row.timestamp < midpoint]
    second = [row for row in timestamped if row.timestamp is not None and row.timestamp >= midpoint]
    if not first or not second:
        return None
    return CanonicalSteadyHalfSummary(
        first_power_watts=_rounded(_mean(row.power_watts for row in first)),
        second_power_watts=_rounded(_mean(row.power_watts for row in second)),
        first_hr_bpm=_rounded(_mean(row.heart_rate_bpm for row in first)),
        second_hr_bpm=_rounded(_mean(row.heart_rate_bpm for row in second)),
        first_cadence_rpm=_rounded(_mean(row.cadence_rpm for row in first)),
        second_cadence_rpm=_rounded(_mean(row.cadence_rpm for row in second)),
    )


def derive_activity_response(
    activity_type: str,
    evidence: FitActivityEvidence,
) -> CanonicalActivityResponseTelemetry | None:
    """Derive bounded session evidence from one already-decoded original FIT file."""
    if activity_type.strip().lower() not in _CYCLING_TYPES:
        return None
    if not evidence.records and not evidence.laps:
        return None

    resolution = _source_resolution(evidence.records)
    segments = _semantic_lap_segments(evidence, resolution)
    if not segments:
        segments = _semantic_record_segments(evidence, resolution)
    if not segments:
        segments = _manual_lap_segments(evidence, resolution)

    total_segments = len(segments)
    return CanonicalActivityResponseTelemetry(
        source_resolution=resolution,
        segments=tuple(segments[:MAX_PERSISTED_SEGMENTS]),
        power_duration_peaks=_power_duration_peaks(
            evidence.records,
            resolution.power_seconds,
        ),
        steady_halves=_steady_halves(evidence.records),
        segment_count_total=total_segments,
        segments_truncated=total_segments > MAX_PERSISTED_SEGMENTS,
        derivation_version=DERIVATION_VERSION,
    )


@dataclass(frozen=True)
class ResolutionFeatureError:
    feature: str
    reference_value: float | None
    candidate_value: float | None
    relative_error_pct: float | None
    tolerance_pct: float
    state: str


@dataclass(frozen=True)
class ResolutionCandidateResult:
    candidate_seconds: int
    features: tuple[ResolutionFeatureError, ...]
    eligible_feature_count: int
    preserved_feature_count: int
    preservation_rate_pct: float | None
    passes_required_rate: bool | None


def _downsample_power(
    records: tuple[FitRecordSample, ...],
    bucket_seconds: int,
) -> tuple[FitRecordSample, ...]:
    values = _timestamped_values(records, lambda row: row.power_watts)
    if not values:
        return ()
    start = values[0][0]
    buckets: dict[int, list[tuple[datetime, float]]] = {}
    for timestamp, power in values:
        index = int((timestamp - start).total_seconds() // bucket_seconds)
        buckets.setdefault(index, []).append((timestamp, power))
    downsampled: list[FitRecordSample] = []
    for index in sorted(buckets):
        bucket = buckets[index]
        downsampled.append(
            FitRecordSample(
                timestamp=bucket[0][0],
                heart_rate_bpm=None,
                cadence_rpm=None,
                power_watts=sum(value for _, value in bucket) / len(bucket),
            )
        )
    return tuple(downsampled)


def evaluate_resolution_candidate(
    records: tuple[FitRecordSample, ...],
    candidate_seconds: int,
    *,
    required_preservation_rate_pct: float = 95.0,
    tolerances_pct: dict[int, float] | None = None,
) -> ResolutionCandidateResult:
    """Compare fixed power-duration features against native-source analysis.

    This is a calibration harness, not runtime selection policy. Features unsupported
    by native source cadence are reported separately and excluded from the denominator.
    """
    tolerances = tolerances_pct or {
        1: 5.0,
        5: 4.0,
        10: 4.0,
        30: 3.0,
        60: 3.0,
        180: 2.5,
        300: 2.5,
        1200: 2.0,
    }
    native_resolution = _resolution_seconds(records, lambda row: row.power_watts)
    candidate_records = _downsample_power(records, candidate_seconds)
    candidate_resolution = _resolution_seconds(candidate_records, lambda row: row.power_watts)
    features: list[ResolutionFeatureError] = []
    eligible = 0
    preserved = 0

    for duration in POWER_DURATION_WINDOWS_SECONDS:
        tolerance = tolerances.get(duration, 5.0)
        native = _peak_power(records, duration, native_resolution)
        if native is None:
            features.append(
                ResolutionFeatureError(
                    feature=f"mmp_{duration}s",
                    reference_value=None,
                    candidate_value=None,
                    relative_error_pct=None,
                    tolerance_pct=tolerance,
                    state="source_insufficient",
                )
            )
            continue
        candidate = _peak_power(candidate_records, duration, candidate_resolution)
        eligible += 1
        if candidate is None:
            features.append(
                ResolutionFeatureError(
                    feature=f"mmp_{duration}s",
                    reference_value=round(native[0], 2),
                    candidate_value=None,
                    relative_error_pct=None,
                    tolerance_pct=tolerance,
                    state="feature_unavailable",
                )
            )
            continue
        error = abs(candidate[0] - native[0]) / max(abs(native[0]), 1e-9) * 100
        state = "preserved" if error <= tolerance else "degraded"
        if state == "preserved":
            preserved += 1
        features.append(
            ResolutionFeatureError(
                feature=f"mmp_{duration}s",
                reference_value=round(native[0], 2),
                candidate_value=round(candidate[0], 2),
                relative_error_pct=round(error, 2),
                tolerance_pct=tolerance,
                state=state,
            )
        )

    rate = None if eligible == 0 else preserved / eligible * 100
    return ResolutionCandidateResult(
        candidate_seconds=candidate_seconds,
        features=tuple(features),
        eligible_feature_count=eligible,
        preserved_feature_count=preserved,
        preservation_rate_pct=None if rate is None else round(rate, 1),
        passes_required_rate=None if rate is None else rate >= required_preservation_rate_pct,
    )


def evaluate_resolution_candidates(
    records: tuple[FitRecordSample, ...],
) -> tuple[ResolutionCandidateResult, ...]:
    """Evaluate the issue #850 candidate resolution ladder deterministically."""
    return tuple(
        evaluate_resolution_candidate(records, candidate)
        for candidate in RESOLUTION_CANDIDATES_SECONDS
    )
