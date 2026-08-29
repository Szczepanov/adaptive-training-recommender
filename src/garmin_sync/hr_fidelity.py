"""Deterministic, shadow-only assessment of exercise heart-rate trace fidelity.

The evaluator consumes transient FIT evidence and emits compact, provider-neutral
quality metadata.  It deliberately has no persistence, provider, or recommendation
dependencies: a weak measurement reduces available HR evidence, never athlete state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import median
from typing import Literal

from .canonical import (
    CanonicalHrMeasurementQuality,
    CanonicalHrSourceEvidence,
    HrActivityMotionRisk,
    HrMeasurementConfidence,
    HrSignalQuality,
)
from .fit_activity import FitActivityEvidence, FitRecordSample

HrAssessmentState = Literal["ASSESSABLE", "PARTIALLY_ASSESSABLE", "UNASSESSABLE"]


@dataclass(frozen=True)
class HrFidelityPolicy:
    """All v1 detector thresholds, centralized for replayable policy evolution."""

    diagnostic_version: str = "1.0.0"
    min_timestamped_records: int = 3
    min_valid_hr_samples: int = 3
    assessable_coverage_pct: float = 90.0
    low_coverage_pct: float = 85.0
    unreliable_coverage_pct: float = 50.0
    dropout_gap_seconds: float = 30.0
    unreliable_gap_seconds: float = 120.0
    contiguous_sample_seconds: float = 10.0
    isolated_spike_bpm: float = 25.0
    isolated_neighbor_delta_bpm: float = 8.0
    abrupt_change_bpm: float = 35.0
    cadence_tolerance_bpm: float = 3.0
    harmonic_tolerance_bpm: float = 5.0
    lock_min_duration_seconds: float = 60.0
    lock_min_match_pct: float = 80.0
    plateau_min_duration_seconds: float = 180.0
    plateau_hr_range_bpm: float = 4.0
    plateau_power_range_watts: float = 100.0
    plateau_power_relative_change: float = 0.40


DEFAULT_HR_FIDELITY_POLICY = HrFidelityPolicy()


@dataclass(frozen=True)
class HrFidelityAssessment:
    assessment_state: HrAssessmentState
    quality: CanonicalHrMeasurementQuality
    gap_count: int
    sampling_interval_seconds: float | None


def assess_activity_hr_fidelity(
    activity_type: str,
    evidence: FitActivityEvidence,
    source: CanonicalHrSourceEvidence,
    *,
    policy: HrFidelityPolicy = DEFAULT_HR_FIDELITY_POLICY,
) -> HrFidelityAssessment:
    """Assess one decoded activity without interpolation or downstream authority.

    A trace with no usable timestamp/HR surface is *unassessable*.  It is intentionally
    not labelled poor or unreliable because no quality conclusion was established.
    """
    motion_risk = activity_motion_risk_for(activity_type)
    records = _timestamped_records(evidence.records)
    valid = [record for record in records if _valid_hr(record.heart_rate_bpm)]
    if len(records) < policy.min_timestamped_records or len(valid) < policy.min_valid_hr_samples:
        return _unassessable(source, motion_risk, policy)

    windows, timer_complete = _analysis_windows(records, evidence)
    active_records = [record for record in records if _in_windows(record.timestamp, windows)]
    active_valid = [record for record in active_records if _valid_hr(record.heart_rate_bpm)]
    if len(active_valid) < policy.min_valid_hr_samples:
        return _unassessable(source, motion_risk, policy)

    sample_interval = _median_interval(active_records)
    coverage_pct, longest_gap, gap_count = _coverage(
        active_records, active_valid, windows, sample_interval, policy
    )
    state: HrAssessmentState = (
        "ASSESSABLE"
        if timer_complete and coverage_pct >= policy.assessable_coverage_pct
        else "PARTIALLY_ASSESSABLE"
    )
    flags: set[str] = set()
    reasons: set[str] = set()
    if not timer_complete:
        reasons.add("PARTIAL_TIMER_WINDOW")
    if coverage_pct < policy.low_coverage_pct:
        flags.add("INSUFFICIENT_COVERAGE")
    if gap_count:
        flags.add("DROPOUT")
    flags.update(_transition_flags(active_valid, policy))
    flags.update(_workload_flags(active_valid, policy))
    flags.update(_cadence_lock_flags(activity_type, active_valid, policy))

    quality = _quality_from_evidence(
        source=source,
        motion_risk=motion_risk,
        coverage_pct=coverage_pct,
        longest_gap_seconds=longest_gap,
        flags=flags,
        reasons=reasons,
        policy=policy,
    )
    return HrFidelityAssessment(
        assessment_state=state,
        quality=quality,
        gap_count=gap_count,
        sampling_interval_seconds=sample_interval,
    )


def activity_motion_risk_for(activity_type: str) -> HrActivityMotionRisk:
    """Return a small, conservative wrist-motion prior from a Garmin activity key."""
    normalized = activity_type.strip().lower()
    if (
        normalized
        in {
            "cycling",
            "cyclocross",
            "gravel_cycling",
            "indoor_cycling",
            "mountain_biking",
            "road_biking",
            "virtual_ride",
        }
        or normalized in {"run", "running"}
        or normalized.endswith(("_run", "_running"))
    ):
        return "moderate"
    if normalized in {
        "rowing",
        "strength_training",
        "fitness_equipment",
        "elliptical",
        "soccer",
        "football",
        "basketball",
        "rugby",
        "hockey",
    }:
        return "high"
    return "unknown"


def _unassessable(
    source: CanonicalHrSourceEvidence,
    motion_risk: HrActivityMotionRisk,
    policy: HrFidelityPolicy,
) -> HrFidelityAssessment:
    return HrFidelityAssessment(
        assessment_state="UNASSESSABLE",
        quality=CanonicalHrMeasurementQuality(
            source=source,
            activity_motion_risk=motion_risk,
            coverage_pct=None,
            longest_gap_seconds=None,
            signal_quality="unknown",
            measurement_confidence="unknown",
            artifact_flags=("ASSESSMENT_UNAVAILABLE",),
            reasons=("ASSESSMENT_UNAVAILABLE",),
            diagnostic_version=policy.diagnostic_version,
        ),
        gap_count=0,
        sampling_interval_seconds=None,
    )


def _timestamped_records(records: tuple[FitRecordSample, ...]) -> list[FitRecordSample]:
    return sorted(
        (record for record in records if record.timestamp is not None),
        key=_record_timestamp,
    )


def _analysis_windows(
    records: list[FitRecordSample], evidence: FitActivityEvidence
) -> tuple[tuple[tuple[datetime, datetime], ...], bool]:
    first = _record_timestamp(records[0])
    last = _record_timestamp(records[-1])
    timer_events = sorted(
        (event for event in evidence.timer_events if event.timestamp is not None),
        key=_event_timestamp,
    )
    windows: list[tuple[datetime, datetime]] = []
    active_start: datetime | None = None
    for event in timer_events:
        timestamp = _event_timestamp(event)
        if _is_timer_start(event.event_type):
            active_start = timestamp if active_start is None else active_start
        elif _is_timer_stop(event.event_type) and active_start is not None:
            if timestamp > active_start:
                windows.append((active_start, timestamp))
            active_start = None
    if active_start is not None:
        if last > active_start:
            windows.append((active_start, last))
        return tuple(windows) or ((first, last),), False
    if windows:
        return tuple(windows), True
    return ((first, last),), False


def _is_timer_start(event_type: str | int | None) -> bool:
    return isinstance(event_type, str) and event_type.lower() in {"start", "resume"}


def _is_timer_stop(event_type: str | int | None) -> bool:
    return isinstance(event_type, str) and event_type.lower() in {
        "stop",
        "stop_all",
        "stop_disable_all",
    }


def _in_windows(timestamp: datetime | None, windows: tuple[tuple[datetime, datetime], ...]) -> bool:
    return timestamp is not None and any(start <= timestamp <= end for start, end in windows)


def _record_timestamp(record: FitRecordSample) -> datetime:
    assert record.timestamp is not None
    return record.timestamp


def _event_timestamp(event: object) -> datetime:
    timestamp = getattr(event, "timestamp", None)
    assert isinstance(timestamp, datetime)
    return timestamp


def _valid_hr(value: float | None) -> bool:
    return value is not None and 25.0 <= value <= 250.0


def _median_interval(records: list[FitRecordSample]) -> float | None:
    intervals = [
        (later.timestamp - earlier.timestamp).total_seconds()
        for earlier, later in zip(records, records[1:], strict=False)
        if earlier.timestamp is not None
        and later.timestamp is not None
        and 0 < (later.timestamp - earlier.timestamp).total_seconds() <= 10.0
    ]
    return float(median(intervals)) if intervals else None


def _coverage(
    records: list[FitRecordSample],
    valid: list[FitRecordSample],
    windows: tuple[tuple[datetime, datetime], ...],
    sample_interval: float | None,
    policy: HrFidelityPolicy,
) -> tuple[float, float, int]:
    expected_interval = sample_interval or 1.0
    duration = sum(max(0.0, (end - start).total_seconds()) for start, end in windows)
    expected = max(1, round(duration / expected_interval) + 1)
    coverage = min(100.0, (len(valid) / expected) * 100.0)
    gaps: list[float] = []
    for start, end in windows:
        valid_times = [
            _record_timestamp(record)
            for record in valid
            if _in_windows(record.timestamp, ((start, end),))
        ]
        gaps.extend(
            (later - earlier).total_seconds()
            for earlier, later in zip(valid_times, valid_times[1:], strict=False)
        )
    longest = max(gaps, default=0.0)
    # A missing record is only a dropout once it materially exceeds the observed cadence.
    threshold = max(policy.dropout_gap_seconds, expected_interval * 5.0)
    return coverage, longest, sum(gap > threshold for gap in gaps)


def _transition_flags(records: list[FitRecordSample], policy: HrFidelityPolicy) -> set[str]:
    flags: set[str] = set()
    for previous, current, following in zip(records, records[1:], records[2:], strict=False):
        if not _nearby(previous, current, policy) or not _nearby(current, following, policy):
            continue
        assert previous.heart_rate_bpm is not None
        assert current.heart_rate_bpm is not None
        assert following.heart_rate_bpm is not None
        neighbor_midpoint = (previous.heart_rate_bpm + following.heart_rate_bpm) / 2
        if (
            abs(current.heart_rate_bpm - neighbor_midpoint) >= policy.isolated_spike_bpm
            and abs(previous.heart_rate_bpm - following.heart_rate_bpm)
            <= policy.isolated_neighbor_delta_bpm
        ):
            flags.add("ISOLATED_SPIKE")
    for previous, current in zip(records, records[1:], strict=False):
        if not _nearby(previous, current, policy):
            continue
        assert previous.heart_rate_bpm is not None and current.heart_rate_bpm is not None
        delta = current.heart_rate_bpm - previous.heart_rate_bpm
        if abs(delta) >= policy.abrupt_change_bpm and _stable_independent_workload(
            previous, current
        ):
            flags.add("ABRUPT_JUMP" if delta > 0 else "ABRUPT_DROP")
    return flags


def _nearby(left: FitRecordSample, right: FitRecordSample, policy: HrFidelityPolicy) -> bool:
    return (
        left.timestamp is not None
        and right.timestamp is not None
        and 0
        < (right.timestamp - left.timestamp).total_seconds()
        <= policy.contiguous_sample_seconds
    )


def _stable_independent_workload(left: FitRecordSample, right: FitRecordSample) -> bool:
    """Only flag abrupt HR when FIT power rules out an equally abrupt work change."""
    if left.power_watts is None or right.power_watts is None:
        return False
    return abs(right.power_watts - left.power_watts) < 25.0


def _workload_flags(records: list[FitRecordSample], policy: HrFidelityPolicy) -> set[str]:
    paired = [record for record in records if record.power_watts is not None]
    if len(paired) < 2 or paired[0].timestamp is None or paired[-1].timestamp is None:
        return set()
    duration = (paired[-1].timestamp - paired[0].timestamp).total_seconds()
    powers = [record.power_watts for record in paired if record.power_watts is not None]
    heart_rates = [record.heart_rate_bpm for record in paired if record.heart_rate_bpm is not None]
    assert powers and heart_rates
    power_range = max(powers) - min(powers)
    power_base = max(1.0, float(median(powers)))
    if (
        duration < policy.plateau_min_duration_seconds
        or max(heart_rates) - min(heart_rates) > policy.plateau_hr_range_bpm
        or power_range < policy.plateau_power_range_watts
        or power_range / power_base < policy.plateau_power_relative_change
    ):
        return set()
    return {"STALE_PLATEAU", "WORKLOAD_DISCORDANCE"}


def _cadence_lock_flags(
    activity_type: str, records: list[FitRecordSample], policy: HrFidelityPolicy
) -> set[str]:
    pairs = [
        record
        for record in records
        if record.cadence_rpm is not None and record.heart_rate_bpm is not None
    ]
    if len(pairs) < 2 or pairs[0].timestamp is None or pairs[-1].timestamp is None:
        return set()
    duration = (pairs[-1].timestamp - pairs[0].timestamp).total_seconds()
    if duration < policy.lock_min_duration_seconds:
        return set()
    normalized = activity_type.strip().lower()
    if normalized in {"run", "running"} or normalized.endswith(("_run", "_running")):
        matches = sum(_running_lock_match(record, policy) for record in pairs)
        flag = "CADENCE_LOCK_SUSPECTED"
    elif normalized in {
        "cycling",
        "cyclocross",
        "gravel_cycling",
        "indoor_cycling",
        "mountain_biking",
        "road_biking",
        "virtual_ride",
    }:
        matches = sum(_cycling_lock_match(record, policy) for record in pairs)
        flag = "HARMONIC_LOCK_SUSPECTED"
    else:
        return set()
    match_pct = (matches / len(pairs)) * 100.0
    return {flag} if match_pct >= policy.lock_min_match_pct else set()


def _running_lock_match(record: FitRecordSample, policy: HrFidelityPolicy) -> bool:
    assert record.heart_rate_bpm is not None and record.cadence_rpm is not None
    return abs(record.heart_rate_bpm - record.cadence_rpm) <= policy.cadence_tolerance_bpm


def _cycling_lock_match(record: FitRecordSample, policy: HrFidelityPolicy) -> bool:
    assert record.heart_rate_bpm is not None and record.cadence_rpm is not None
    return abs(record.heart_rate_bpm - (2 * record.cadence_rpm)) <= policy.harmonic_tolerance_bpm


def _quality_from_evidence(
    *,
    source: CanonicalHrSourceEvidence,
    motion_risk: HrActivityMotionRisk,
    coverage_pct: float,
    longest_gap_seconds: float,
    flags: set[str],
    reasons: set[str],
    policy: HrFidelityPolicy,
) -> CanonicalHrMeasurementQuality:
    unreliable = (
        coverage_pct < policy.unreliable_coverage_pct
        or longest_gap_seconds > policy.unreliable_gap_seconds
    )
    suspect = bool(flags) or coverage_pct < policy.assessable_coverage_pct
    confidence: HrMeasurementConfidence = (
        "unreliable" if unreliable else "low" if suspect else "moderate"
    )
    if (
        confidence == "moderate"
        and source.source_for_activity == "external"
        and source.provenance_confidence == "confirmed"
        and source.sensor_technology == "electrode_chest_strap"
        and coverage_pct >= 95.0
    ):
        confidence = "high"
    if source.provenance_confidence in {"ambiguous", "unknown"} or source.source_for_activity in {
        "mixed_possible",
        "unknown",
    }:
        confidence = _cap(confidence, "moderate")
    if source.sensor_technology == "wrist_ppg" and motion_risk == "high":
        confidence = _cap(confidence, "moderate")
    signal_quality: HrSignalQuality = (
        "poor" if confidence == "unreliable" else "suspect" if suspect else "clean"
    )
    return CanonicalHrMeasurementQuality(
        source=source,
        activity_motion_risk=motion_risk,
        coverage_pct=round(coverage_pct, 1),
        longest_gap_seconds=round(longest_gap_seconds, 1),
        signal_quality=signal_quality,
        measurement_confidence=confidence,
        artifact_flags=tuple(sorted(flags)),
        reasons=tuple(sorted(reasons)),
        diagnostic_version=policy.diagnostic_version,
    )


def _cap(
    confidence: HrMeasurementConfidence, maximum: HrMeasurementConfidence
) -> HrMeasurementConfidence:
    order = {"unknown": 0, "unreliable": 1, "low": 2, "moderate": 3, "high": 4}
    return confidence if order[confidence] <= order[maximum] else maximum
