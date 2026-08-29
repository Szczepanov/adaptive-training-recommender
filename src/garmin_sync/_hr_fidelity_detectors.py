"""Deterministic artifact candidates for HRF3."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta
from statistics import median
from typing import Protocol

from ._hr_fidelity_timing import record_timestamp
from .canonical import HrActivityMotionRisk
from .fit_activity import FitRecordSample

_CYCLING_TYPES = frozenset(
    {
        "cycling",
        "cyclocross",
        "gravel_cycling",
        "indoor_cycling",
        "mountain_biking",
        "road_biking",
        "virtual_ride",
    }
)
_HIGH_MOTION_TYPES = frozenset(
    {
        "rowing",
        "strength_training",
        "fitness_equipment",
        "elliptical",
        "soccer",
        "football",
        "basketball",
        "rugby",
        "hockey",
    }
)


class ArtifactPolicy(Protocol):
    @property
    def contiguous_sample_seconds(self) -> float: ...

    @property
    def isolated_spike_bpm(self) -> float: ...

    @property
    def isolated_neighbor_delta_bpm(self) -> float: ...

    @property
    def abrupt_change_bpm(self) -> float: ...

    @property
    def abrupt_context_seconds(self) -> float: ...

    @property
    def abrupt_persistence_seconds(self) -> float: ...

    @property
    def abrupt_workload_context_seconds(self) -> float: ...

    @property
    def abrupt_stable_power_delta_watts(self) -> float: ...

    @property
    def abrupt_min_power_coverage_pct(self) -> float: ...

    @property
    def cadence_tolerance_bpm(self) -> float: ...

    @property
    def harmonic_tolerance_bpm(self) -> float: ...

    @property
    def lock_min_duration_seconds(self) -> float: ...

    @property
    def lock_min_match_pct(self) -> float: ...

    @property
    def lock_min_cadence_coverage_pct(self) -> float: ...

    @property
    def lock_min_samples(self) -> int: ...

    @property
    def lock_min_target_range_bpm(self) -> float: ...

    @property
    def lock_min_power_coverage_pct(self) -> float: ...

    @property
    def lock_stable_power_delta_watts(self) -> float: ...

    @property
    def lock_stable_power_relative_delta(self) -> float: ...

    @property
    def plateau_min_duration_seconds(self) -> float: ...

    @property
    def plateau_hr_range_bpm(self) -> float: ...

    @property
    def plateau_power_range_watts(self) -> float: ...

    @property
    def plateau_power_relative_change(self) -> float: ...

    @property
    def plateau_min_power_samples_per_third(self) -> int: ...


def activity_motion_risk(activity_type: str) -> HrActivityMotionRisk:
    normalized = activity_type.strip().lower()
    if normalized in _CYCLING_TYPES or _is_running_type(normalized):
        return "moderate"
    if normalized in _HIGH_MOTION_TYPES:
        return "high"
    return "unknown"


def transition_flags(records: list[FitRecordSample], policy: ArtifactPolicy) -> set[str]:
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

    for index in range(1, len(records)):
        previous = records[index - 1]
        current = records[index]
        if not _nearby(previous, current, policy):
            continue
        assert previous.heart_rate_bpm is not None
        assert current.heart_rate_bpm is not None
        if abs(current.heart_rate_bpm - previous.heart_rate_bpm) < policy.abrupt_change_bpm:
            continue

        transition = record_timestamp(current)
        before = [
            record
            for record in records[:index]
            if 0
            <= (transition - record_timestamp(record)).total_seconds()
            <= policy.abrupt_context_seconds
        ]
        after = [
            record
            for record in records[index:]
            if 0
            <= (record_timestamp(record) - transition).total_seconds()
            <= policy.abrupt_context_seconds
        ]
        if not _has_persistent_context(before, after, policy):
            continue
        delta = median(_hr_values(after)) - median(_hr_values(before))
        if abs(delta) < policy.abrupt_change_bpm:
            continue
        if not _stable_independent_workload(records, transition, policy):
            continue
        flags.add("ABRUPT_JUMP" if delta > 0 else "ABRUPT_DROP")
    return flags


def workload_flags(records: list[FitRecordSample], policy: ArtifactPolicy) -> set[str]:
    if len(records) < 2:
        return set()
    first = record_timestamp(records[0])
    last = record_timestamp(records[-1])
    if (last - first).total_seconds() < policy.plateau_min_duration_seconds:
        return set()

    for block in _rolling_time_blocks(
        records,
        policy.plateau_min_duration_seconds,
        policy.plateau_min_duration_seconds / 3.0,
    ):
        if _stale_plateau_block(block, policy):
            return {"STALE_PLATEAU", "WORKLOAD_DISCORDANCE"}
    return set()


def cadence_lock_flags(
    activity_type: str,
    records: list[FitRecordSample],
    policy: ArtifactPolicy,
) -> set[str]:
    pairs = [
        record
        for record in records
        if record.cadence_rpm is not None and record.heart_rate_bpm is not None
    ]
    if len(pairs) < policy.lock_min_samples or not records:
        return set()
    if (len(pairs) / len(records)) * 100.0 < policy.lock_min_cadence_coverage_pct:
        return set()
    duration = (record_timestamp(pairs[-1]) - record_timestamp(pairs[0])).total_seconds()
    if duration < policy.lock_min_duration_seconds:
        return set()

    normalized = activity_type.strip().lower()
    if _is_running_type(normalized):
        # FIT running cadence is strides/min; displayed running cadence is steps/min.
        target = [_twice_cadence(record) for record in pairs]
        tolerance = policy.cadence_tolerance_bpm
        flag = "CADENCE_LOCK_SUSPECTED"
    elif normalized in _CYCLING_TYPES:
        target = [_twice_cadence(record) for record in pairs]
        tolerance = policy.harmonic_tolerance_bpm
        flag = "HARMONIC_LOCK_SUSPECTED"
    else:
        return set()

    if max(target) - min(target) < policy.lock_min_target_range_bpm:
        return set()
    if not _cadence_context_is_suspicious(pairs, policy):
        return set()

    matches = 0
    for record, expected in zip(pairs, target, strict=True):
        assert record.heart_rate_bpm is not None
        if abs(record.heart_rate_bpm - expected) <= tolerance:
            matches += 1
    return {flag} if (matches / len(pairs)) * 100.0 >= policy.lock_min_match_pct else set()


def _is_running_type(normalized: str) -> bool:
    return normalized in {"run", "running"} or normalized.endswith(("_run", "_running"))


def _nearby(
    left: FitRecordSample,
    right: FitRecordSample,
    policy: ArtifactPolicy,
) -> bool:
    return (
        left.timestamp is not None
        and right.timestamp is not None
        and 0
        < (right.timestamp - left.timestamp).total_seconds()
        <= policy.contiguous_sample_seconds
    )


def _has_persistent_context(
    before: list[FitRecordSample],
    after: list[FitRecordSample],
    policy: ArtifactPolicy,
) -> bool:
    if len(before) < 2 or len(after) < 2:
        return False
    before_duration = (record_timestamp(before[-1]) - record_timestamp(before[0])).total_seconds()
    after_duration = (record_timestamp(after[-1]) - record_timestamp(after[0])).total_seconds()
    return (
        before_duration >= policy.abrupt_persistence_seconds
        and after_duration >= policy.abrupt_persistence_seconds
    )


def _hr_values(records: list[FitRecordSample]) -> list[float]:
    values = [record.heart_rate_bpm for record in records if record.heart_rate_bpm is not None]
    assert values
    return values


def _stable_independent_workload(
    records: list[FitRecordSample],
    transition: datetime,
    policy: ArtifactPolicy,
) -> bool:
    before = [
        record
        for record in records
        if 0
        < (transition - record_timestamp(record)).total_seconds()
        <= policy.abrupt_workload_context_seconds
    ]
    after = [
        record
        for record in records
        if 0
        <= (record_timestamp(record) - transition).total_seconds()
        <= policy.abrupt_workload_context_seconds
    ]
    before_power = _covered_power_median(before, policy.abrupt_min_power_coverage_pct)
    after_power = _covered_power_median(after, policy.abrupt_min_power_coverage_pct)
    if before_power is None or after_power is None:
        return False
    return abs(after_power - before_power) <= policy.abrupt_stable_power_delta_watts


def _covered_power_median(records: list[FitRecordSample], min_coverage_pct: float) -> float | None:
    if not records:
        return None
    powers: list[float] = []
    for record in records:
        if record.power_watts is not None:
            powers.append(record.power_watts)
    if (len(powers) / len(records)) * 100.0 < min_coverage_pct:
        return None
    return float(median(powers))


def _rolling_time_blocks(
    records: list[FitRecordSample],
    window_seconds: float,
    step_seconds: float,
) -> Iterator[list[FitRecordSample]]:
    if not records:
        return
    block_start = record_timestamp(records[0])
    last = record_timestamp(records[-1])
    start_index = 0
    end_index = 0
    while block_start + timedelta(seconds=window_seconds) <= last:
        block_end = block_start + timedelta(seconds=window_seconds)
        while start_index < len(records) and record_timestamp(records[start_index]) < block_start:
            start_index += 1
        end_index = max(end_index, start_index)
        while end_index < len(records) and record_timestamp(records[end_index]) <= block_end:
            end_index += 1
        if end_index > start_index:
            yield records[start_index:end_index]
        block_start += timedelta(seconds=step_seconds)


def _stale_plateau_block(records: list[FitRecordSample], policy: ArtifactPolicy) -> bool:
    if len(records) < 2:
        return False
    heart_rates = _hr_values(records)
    if max(heart_rates) - min(heart_rates) > policy.plateau_hr_range_bpm:
        return False

    start = record_timestamp(records[0])
    end = record_timestamp(records[-1])
    duration = (end - start).total_seconds()
    if duration < policy.plateau_min_duration_seconds * 0.95:
        return False

    third = duration / 3.0
    power_medians: list[float] = []
    for third_index in range(3):
        lower = start + timedelta(seconds=third * third_index)
        upper = start + timedelta(seconds=third * (third_index + 1))
        powers: list[float] = []
        for record in records:
            if record.power_watts is not None and lower <= record_timestamp(record) <= upper:
                powers.append(record.power_watts)
        if len(powers) < policy.plateau_min_power_samples_per_third:
            return False
        power_medians.append(float(median(powers)))

    power_range = max(power_medians) - min(power_medians)
    power_base = max(1.0, float(median(power_medians)))
    return (
        power_range >= policy.plateau_power_range_watts
        and power_range / power_base >= policy.plateau_power_relative_change
    )


def _cadence_context_is_suspicious(records: list[FitRecordSample], policy: ArtifactPolicy) -> bool:
    """Require independent stable workload before calling cadence crossover."""
    if len(records) < 3:
        return False
    chunk_size = max(1, len(records) // 3)
    chunks = (
        records[:chunk_size],
        records[chunk_size : 2 * chunk_size],
        records[-chunk_size:],
    )
    power_medians = [
        _covered_power_median(chunk, policy.lock_min_power_coverage_pct) for chunk in chunks
    ]
    if any(value is None for value in power_medians):
        return False
    values = [float(value) for value in power_medians if value is not None]
    delta = max(values) - min(values)
    relative = delta / max(1.0, float(median(values)))
    return (
        delta <= policy.lock_stable_power_delta_watts
        and relative <= policy.lock_stable_power_relative_delta
    )


def _twice_cadence(record: FitRecordSample) -> float:
    assert record.cadence_rpm is not None
    return 2.0 * record.cadence_rpm
