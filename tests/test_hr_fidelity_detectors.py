from datetime import datetime, timedelta

from garmin_sync._hr_fidelity_detectors import transition_flags
from garmin_sync.fit_activity import FitRecordSample
from garmin_sync.hr_fidelity import DEFAULT_HR_FIDELITY_POLICY

_START = datetime(2026, 8, 29, 8, 0)


def _records(seconds_hr_power: list[tuple[int, float, float]]) -> list[FitRecordSample]:
    return [
        FitRecordSample(
            timestamp=_START + timedelta(seconds=s),
            heart_rate_bpm=hr,
            cadence_rpm=None,
            power_watts=p,
        )
        for s, hr, p in seconds_hr_power
    ]


def test_transition_flags_clean() -> None:
    records = _records([(s, 140.0, 200.0) for s in range(121)])
    flags = transition_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert flags == set()


def test_transition_flags_isolated_spike() -> None:
    # Needs a 3-record window where the middle record is isolated_spike_bpm (15) away from midpoint
    # and neighbors are close (<= isolated_neighbor_delta_bpm, which is 5)
    records = _records([(0, 140.0, 200.0), (1, 170.0, 200.0), (2, 142.0, 200.0)])
    flags = transition_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert "ISOLATED_SPIKE" in flags


def test_transition_flags_abrupt_jump() -> None:
    # persistent jump
    records = _records([(s, 130.0 if s < 60 else 170.0, 200.0) for s in range(121)])
    flags = transition_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert "ABRUPT_JUMP" in flags


def test_transition_flags_abrupt_drop() -> None:
    # persistent drop
    records = _records([(s, 170.0 if s < 60 else 130.0, 200.0) for s in range(121)])
    flags = transition_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert "ABRUPT_DROP" in flags


def test_transition_flags_no_jump_without_stable_power() -> None:
    # persistent jump, but power also jumps
    records = _records(
        [(s, 130.0 if s < 60 else 170.0, 120.0 if s < 60 else 260.0) for s in range(121)]
    )
    flags = transition_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert "ABRUPT_JUMP" not in flags
