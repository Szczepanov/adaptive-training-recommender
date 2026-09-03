"""Tests for HR fidelity deterministic artifact detectors."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest

from garmin_sync._hr_fidelity_detectors import (
    activity_motion_risk,
    cadence_lock_flags,
    transition_flags,
    workload_flags,
)
from garmin_sync.fit_activity import FitRecordSample


@dataclass(frozen=True)
class MockArtifactPolicy:
    """A mock implementation of ArtifactPolicy for testing."""

    contiguous_sample_seconds: float = 5.0
    isolated_spike_bpm: float = 10.0
    isolated_neighbor_delta_bpm: float = 5.0
    abrupt_change_bpm: float = 15.0
    abrupt_context_seconds: float = 10.0
    abrupt_persistence_seconds: float = 5.0
    abrupt_workload_context_seconds: float = 10.0
    abrupt_stable_power_delta_watts: float = 20.0
    abrupt_min_power_coverage_pct: float = 50.0
    cadence_tolerance_bpm: float = 5.0
    harmonic_tolerance_bpm: float = 5.0
    lock_min_duration_seconds: float = 10.0
    lock_min_match_pct: float = 80.0
    lock_min_cadence_coverage_pct: float = 80.0
    lock_min_samples: int = 3
    lock_min_target_range_bpm: float = 10.0
    lock_min_power_coverage_pct: float = 50.0
    lock_stable_power_delta_watts: float = 20.0
    lock_stable_power_relative_delta: float = 0.2
    plateau_min_duration_seconds: float = 30.0
    plateau_hr_range_bpm: float = 5.0
    plateau_power_range_watts: float = 30.0
    plateau_power_relative_change: float = 0.2
    plateau_min_power_samples_per_third: int = 1


@pytest.mark.parametrize(
    ("activity_type", "expected"),
    [
        ("cycling", "moderate"),
        ("indoor_cycling", "moderate"),
        ("run", "moderate"),
        ("treadmill_running", "moderate"),
        ("rowing", "high"),
        ("strength_training", "high"),
        ("yoga", "unknown"),
        ("walking", "unknown"),
    ],
)
def test_activity_motion_risk(activity_type: str, expected: str) -> None:
    assert activity_motion_risk(activity_type) == expected


def _sample(
    timestamp: datetime,
    hr: float | None,
    power: float | None = 150.0,
    cadence: float | None = 85.0,
) -> FitRecordSample:
    return FitRecordSample(
        timestamp=timestamp, heart_rate_bpm=hr, power_watts=power, cadence_rpm=cadence
    )


def test_transition_flags_isolated_spike() -> None:
    policy = MockArtifactPolicy(isolated_spike_bpm=10.0, isolated_neighbor_delta_bpm=5.0)
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    # 150 -> 180 -> 152 (midpoint 151). 180 is isolated spike.
    records = [
        _sample(base_time, hr=150.0),
        _sample(base_time + timedelta(seconds=1), hr=180.0),
        _sample(base_time + timedelta(seconds=2), hr=152.0),
    ]
    assert transition_flags(records, policy) == {"ISOLATED_SPIKE"}


def test_transition_flags_abrupt_jump() -> None:
    policy = MockArtifactPolicy(
        abrupt_change_bpm=15.0,
        abrupt_context_seconds=10.0,
        abrupt_persistence_seconds=3.0,
        abrupt_workload_context_seconds=10.0,
        abrupt_min_power_coverage_pct=0.0,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # 4 seconds before (persistence met, median 130)
    for i in range(4):
        records.append(_sample(base_time + timedelta(seconds=i), hr=130.0))

    # Jump up
    base_time += timedelta(seconds=4)
    # 4 seconds after (persistence met, median 150)
    for i in range(4):
        records.append(_sample(base_time + timedelta(seconds=i), hr=150.0))

    assert "ABRUPT_JUMP" in transition_flags(records, policy)


def test_transition_flags_abrupt_drop() -> None:
    policy = MockArtifactPolicy(
        abrupt_change_bpm=15.0,
        abrupt_context_seconds=10.0,
        abrupt_persistence_seconds=3.0,
        abrupt_workload_context_seconds=10.0,
        abrupt_min_power_coverage_pct=0.0,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # 4 seconds before (median 150)
    for i in range(4):
        records.append(_sample(base_time + timedelta(seconds=i), hr=150.0))

    # Jump down
    base_time += timedelta(seconds=4)
    # 4 seconds after (median 130)
    for i in range(4):
        records.append(_sample(base_time + timedelta(seconds=i), hr=130.0))

    assert "ABRUPT_DROP" in transition_flags(records, policy)


def test_transition_flags_clean() -> None:
    policy = MockArtifactPolicy()
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []
    for i in range(10):
        records.append(_sample(base_time + timedelta(seconds=i), hr=130.0 + (i * 0.1)))
    assert not transition_flags(records, policy)


def test_workload_flags_stale_plateau() -> None:
    policy = MockArtifactPolicy(
        plateau_min_duration_seconds=30.0,
        plateau_hr_range_bpm=5.0,
        plateau_power_range_watts=30.0,
        plateau_power_relative_change=0.2,
        plateau_min_power_samples_per_third=1,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # Needs to be >30s. We'll do 33 seconds (3 parts of 11 seconds)
    # HR must be very stable (range <= 5)

    # Third 1: Power ~100
    for i in range(11):
        records.append(_sample(base_time + timedelta(seconds=i), hr=150.0, power=100.0))

    # Third 2: Power ~150 (satisfies range 30 and relative change)
    base_time += timedelta(seconds=11)
    for i in range(11):
        records.append(_sample(base_time + timedelta(seconds=i), hr=151.0, power=150.0))

    # Third 3: Power ~100
    base_time += timedelta(seconds=11)
    for i in range(11):
        records.append(_sample(base_time + timedelta(seconds=i), hr=152.0, power=100.0))

    flags = workload_flags(records, policy)
    assert flags == {"STALE_PLATEAU", "WORKLOAD_DISCORDANCE"}


def test_workload_flags_clean() -> None:
    policy = MockArtifactPolicy(plateau_min_duration_seconds=30.0)
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # >30s, but HR varies significantly
    for i in range(35):
        records.append(_sample(base_time + timedelta(seconds=i), hr=130.0 + i, power=100.0))

    assert not workload_flags(records, policy)


def test_cadence_lock_flags_running() -> None:
    policy = MockArtifactPolicy(
        lock_min_duration_seconds=10.0,
        lock_min_samples=3,
        lock_min_cadence_coverage_pct=80.0,
        cadence_tolerance_bpm=5.0,
        lock_min_target_range_bpm=5.0,  # Make this small enough to pass
        lock_stable_power_delta_watts=20.0,
        lock_stable_power_relative_delta=0.2,
        lock_min_match_pct=80.0,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # We need duration > 10s. So 11 samples, 1s apart.
    # Cadence for running is multiplied by 2.
    # e.g., Cadence 80 => Target HR 160.
    # We also need a target range >= lock_min_target_range_bpm, so we'll vary cadence from 80 to 83.
    # Stable power across 3 chunks is required for `_cadence_context_is_suspicious`.

    for i in range(11):
        cad = 80.0 if i < 5 else 85.0
        # HR matches 2x cadence exactly
        records.append(
            _sample(base_time + timedelta(seconds=i), hr=cad * 2.0, power=100.0, cadence=cad)
        )

    flags = cadence_lock_flags("run", records, policy)
    assert "CADENCE_LOCK_SUSPECTED" in flags


def test_cadence_lock_flags_cycling() -> None:
    policy = MockArtifactPolicy(
        lock_min_duration_seconds=10.0,
        lock_min_samples=3,
        lock_min_cadence_coverage_pct=80.0,
        harmonic_tolerance_bpm=5.0,
        lock_min_target_range_bpm=5.0,
        lock_stable_power_delta_watts=20.0,
        lock_stable_power_relative_delta=0.2,
        lock_min_match_pct=80.0,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # Same setup but for cycling. Cadence * 2 = Harmonic lock.
    for i in range(11):
        cad = 80.0 if i < 5 else 85.0
        records.append(
            _sample(base_time + timedelta(seconds=i), hr=cad * 2.0, power=100.0, cadence=cad)
        )

    flags = cadence_lock_flags("cycling", records, policy)
    assert "HARMONIC_LOCK_SUSPECTED" in flags


def test_cadence_lock_flags_clean() -> None:
    policy = MockArtifactPolicy(lock_min_duration_seconds=10.0)
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = []

    # Cadence is 80 (target 160), HR is 130. They don't match.
    for i in range(11):
        records.append(
            _sample(base_time + timedelta(seconds=i), hr=130.0, power=100.0, cadence=80.0)
        )

    assert not cadence_lock_flags("run", records, policy)


def test_activity_motion_risk_normalizes_and_covers_known_variants() -> None:
    assert activity_motion_risk("  cyCling  ") == "moderate"
    assert activity_motion_risk("gravel_cycling") == "moderate"
    assert activity_motion_risk("  Trail_Running  ") == "moderate"
    assert activity_motion_risk("SOCCER") == "high"


def test_workload_flags_ignores_insufficient_duration() -> None:
    policy = MockArtifactPolicy(plateau_min_duration_seconds=180.0)
    records = [
        _sample(datetime(2025, 1, 1, 10, 0), hr=140.0),
        _sample(datetime(2025, 1, 1, 10, 2), hr=140.0),
    ]
    assert workload_flags(records, policy) == set()


def test_transition_flags_does_not_call_power_change_an_hr_artifact() -> None:
    policy = MockArtifactPolicy(
        abrupt_change_bpm=15.0,
        abrupt_context_seconds=10.0,
        abrupt_persistence_seconds=3.0,
        abrupt_workload_context_seconds=10.0,
        abrupt_min_power_coverage_pct=0.0,
    )
    base_time = datetime(2025, 1, 1, 10, 0, 0)
    records = [
        _sample(
            base_time + timedelta(seconds=second),
            hr=130.0 if second < 60 else 170.0,
            power=120.0 if second < 60 else 260.0,
        )
        for second in range(121)
    ]

    assert "ABRUPT_JUMP" not in transition_flags(records, policy)
