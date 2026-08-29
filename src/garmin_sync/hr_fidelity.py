"""Deterministic, shadow-only assessment of exercise heart-rate trace fidelity.

The evaluator consumes transient FIT evidence and emits compact, provider-neutral
quality metadata. It deliberately has no persistence, provider, or recommendation
dependencies: a weak measurement reduces available HR evidence, never athlete state.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ._hr_fidelity_detectors import (
    activity_motion_risk,
    cadence_lock_flags,
    transition_flags,
    workload_flags,
)
from ._hr_fidelity_timing import (
    analysis_windows,
    coverage,
    in_windows,
    sampling_profile,
    timestamped_records,
    unique_timestamp_count,
    valid_hr,
    window_duration,
)
from .canonical import (
    CanonicalHrMeasurementQuality,
    CanonicalHrSourceEvidence,
    HrActivityMotionRisk,
    HrMeasurementConfidence,
    HrSignalQuality,
)
from .fit_activity import FitActivityEvidence

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
    max_expected_sample_interval_seconds: float = 30.0
    sampling_irregularity_tolerance_ratio: float = 0.25
    dropout_gap_seconds: float = 30.0
    unreliable_gap_seconds: float = 120.0
    contiguous_sample_seconds: float = 10.0
    isolated_spike_bpm: float = 25.0
    isolated_neighbor_delta_bpm: float = 8.0
    abrupt_change_bpm: float = 35.0
    abrupt_context_seconds: float = 10.0
    abrupt_persistence_seconds: float = 5.0
    abrupt_workload_context_seconds: float = 30.0
    abrupt_stable_power_delta_watts: float = 25.0
    abrupt_min_power_coverage_pct: float = 60.0
    cadence_tolerance_bpm: float = 3.0
    harmonic_tolerance_bpm: float = 5.0
    lock_min_duration_seconds: float = 60.0
    lock_min_match_pct: float = 80.0
    lock_min_cadence_coverage_pct: float = 70.0
    lock_min_samples: int = 12
    lock_min_target_range_bpm: float = 8.0
    lock_min_power_coverage_pct: float = 60.0
    lock_stable_power_delta_watts: float = 30.0
    lock_stable_power_relative_delta: float = 0.15
    plateau_min_duration_seconds: float = 180.0
    plateau_hr_range_bpm: float = 4.0
    plateau_power_range_watts: float = 100.0
    plateau_power_relative_change: float = 0.40
    plateau_min_power_samples_per_third: int = 3


DEFAULT_HR_FIDELITY_POLICY = HrFidelityPolicy()


@dataclass(frozen=True)
class HrFidelityAssessment:
    assessment_state: HrAssessmentState
    quality: CanonicalHrMeasurementQuality
    gap_count: int
    sampling_interval_seconds: float | None
    sampling_irregularity_pct: float | None


def assess_activity_hr_fidelity(
    activity_type: str,
    evidence: FitActivityEvidence,
    source: CanonicalHrSourceEvidence,
    *,
    policy: HrFidelityPolicy = DEFAULT_HR_FIDELITY_POLICY,
) -> HrFidelityAssessment:
    """Assess one decoded activity without interpolation or downstream authority."""
    motion_risk = activity_motion_risk_for(activity_type)
    records = timestamped_records(evidence.records)
    valid = [record for record in records if valid_hr(record.heart_rate_bpm)]
    if (
        unique_timestamp_count(records) < policy.min_timestamped_records
        or unique_timestamp_count(valid) < policy.min_valid_hr_samples
    ):
        return _unassessable(source, motion_risk, policy)

    windows, timer_complete = analysis_windows(records, evidence)
    if window_duration(windows) <= 0:
        return _unassessable(source, motion_risk, policy)

    active_records = [record for record in records if in_windows(record.timestamp, windows)]
    active_valid = [record for record in active_records if valid_hr(record.heart_rate_bpm)]
    if unique_timestamp_count(active_valid) < policy.min_valid_hr_samples:
        return _unassessable(source, motion_risk, policy)

    sample_interval, sampling_irregularity = sampling_profile(active_records, windows, policy)
    coverage_pct, longest_gap, gap_count = coverage(
        active_records,
        active_valid,
        windows,
        sample_interval,
        policy,
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

    # Artifact context must never cross a stopped/paused timer window.
    for window in windows:
        window_valid = [
            record for record in active_valid if in_windows(record.timestamp, (window,))
        ]
        flags.update(transition_flags(window_valid, policy))
        flags.update(workload_flags(window_valid, policy))
        flags.update(cadence_lock_flags(activity_type, window_valid, policy))

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
        sampling_interval_seconds=(
            round(sample_interval, 3) if sample_interval is not None else None
        ),
        sampling_irregularity_pct=(
            round(sampling_irregularity, 1) if sampling_irregularity is not None else None
        ),
    )


def activity_motion_risk_for(activity_type: str) -> HrActivityMotionRisk:
    """Return a small, conservative wrist-motion prior from an activity key."""
    return activity_motion_risk(activity_type)


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
        sampling_irregularity_pct=None,
    )


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

    if (
        source.source_for_activity == "mixed_possible"
        or source.provenance_confidence == "ambiguous"
    ):
        reasons.add("PROVENANCE_AMBIGUOUS")
    if source.source_for_activity == "unknown" or source.provenance_confidence == "unknown":
        reasons.add("SOURCE_UNKNOWN")
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
    confidence: HrMeasurementConfidence,
    maximum: HrMeasurementConfidence,
) -> HrMeasurementConfidence:
    order = {"unknown": 0, "unreliable": 1, "low": 2, "moderate": 3, "high": 4}
    return confidence if order[confidence] <= order[maximum] else maximum
