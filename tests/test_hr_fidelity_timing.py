from datetime import datetime, timedelta

from garmin_sync._hr_fidelity_timing import (
    analysis_windows,
    coverage,
    in_windows,
    sampling_profile,
    timestamped_records,
    unique_timestamp_count,
    valid_hr,
    window_duration,
)
from garmin_sync.fit_activity import FitActivityEvidence, FitRecordSample, FitTimerEvent
from garmin_sync.hr_fidelity import HrFidelityPolicy

_START = datetime(2026, 8, 29, 8, 0)


def _record(seconds: int, hr: float | None = 140.0) -> FitRecordSample:
    return FitRecordSample(
        timestamp=_START + timedelta(seconds=seconds),
        heart_rate_bpm=hr,
        cadence_rpm=None,
        power_watts=None,
    )


def _event(seconds: int, event_type: str | int) -> FitTimerEvent:
    return FitTimerEvent(
        timestamp=_START + timedelta(seconds=seconds),
        event_type=event_type,
    )


def _policy() -> HrFidelityPolicy:
    return HrFidelityPolicy(
        max_expected_sample_interval_seconds=10.0,
        sampling_irregularity_tolerance_ratio=0.2,
        dropout_gap_seconds=15.0,
    )

def test_timestamped_records_sorts_and_filters() -> None:
    records = (
        _record(10),
        FitRecordSample(timestamp=None, heart_rate_bpm=None, cadence_rpm=None, power_watts=None),
        _record(5),
    )
    result = timestamped_records(records)
    assert len(result) == 2
    assert result[0].timestamp == _START + timedelta(seconds=5)
    assert result[1].timestamp == _START + timedelta(seconds=10)


def test_unique_timestamp_count_returns_unique_count() -> None:
    records = [
        _record(5),
        _record(5),
        _record(10),
    ]
    assert unique_timestamp_count(records) == 2


def test_window_duration_computes_sum_of_durations() -> None:
    windows = (
        (_START, _START + timedelta(seconds=10)),
        (_START + timedelta(seconds=20), _START + timedelta(seconds=25)),
    )
    assert window_duration(windows) == 15.0


def test_window_duration_ignores_negative_durations() -> None:
    windows = (
        (_START + timedelta(seconds=10), _START),
    )
    assert window_duration(windows) == 0.0


def test_in_windows_checks_inclusion_correctly() -> None:
    windows = (
        (_START, _START + timedelta(seconds=10)),
        (_START + timedelta(seconds=20), _START + timedelta(seconds=30)),
    )

    assert in_windows(None, windows) is False
    assert in_windows(_START - timedelta(seconds=1), windows) is False
    assert in_windows(_START, windows) is True
    assert in_windows(_START + timedelta(seconds=5), windows) is True
    assert in_windows(_START + timedelta(seconds=10), windows) is True
    assert in_windows(_START + timedelta(seconds=15), windows) is False
    assert in_windows(_START + timedelta(seconds=20), windows) is True
    assert in_windows(_START + timedelta(seconds=25), windows) is True
    assert in_windows(_START + timedelta(seconds=35), windows) is False


def test_valid_hr_checks_bounds() -> None:
    assert valid_hr(None) is False
    assert valid_hr(24.9) is False
    assert valid_hr(25.0) is True
    assert valid_hr(150.0) is True
    assert valid_hr(250.0) is True
    assert valid_hr(250.1) is False


def test_analysis_windows_no_timer_events() -> None:
    records = [_record(0), _record(10)]
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=(),
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is False
    assert len(windows) == 1
    assert windows[0] == (_START, _START + timedelta(seconds=10))


def test_analysis_windows_start_stop() -> None:
    records = [_record(0), _record(5), _record(10)]
    events = (_event(0, "start"), _event(10, "stop"))
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is True
    assert len(windows) == 1
    assert windows[0] == (_START, _START + timedelta(seconds=10))


def test_analysis_windows_start_pause_resume_stop() -> None:
    records = [_record(0), _record(5), _record(10), _record(15), _record(20)]
    events = (
        _event(0, "start"),
        _event(5, "stop"),
        _event(15, "resume"),
        _event(20, "stop_all"),
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is True
    assert len(windows) == 2
    assert windows[0] == (_START, _START + timedelta(seconds=5))
    assert windows[1] == (_START + timedelta(seconds=15), _START + timedelta(seconds=20))


def test_analysis_windows_malformed_multiple_starts() -> None:
    records = [_record(0), _record(10)]
    events = (_event(0, "start"), _event(5, "start"), _event(10, "stop"))
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is False
    assert len(windows) == 1


def test_analysis_windows_unknown_transition() -> None:
    records = [_record(0), _record(10)]
    events = (_event(0, "start"), _event(5, "lap"), _event(10, "stop"))
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is False


def test_analysis_windows_leading_stop_preserves_inferable_segment() -> None:
    records = [_record(0), _record(10)]
    events = (_event(5, "stop"),)
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )
    windows, complete = analysis_windows(records, evidence)
    assert complete is False
    assert len(windows) == 1
    assert windows[0] == (_START, _START + timedelta(seconds=5))


def test_sampling_profile_calculates_correctly() -> None:
    records = [_record(0), _record(10), _record(20), _record(30)]
    windows = ((_START, _START + timedelta(seconds=30)),)
    observed, irregularity = sampling_profile(records, windows, _policy())

    assert observed == 10.0
    assert irregularity == 0.0


def test_sampling_profile_detects_irregularity() -> None:
    # Intervals: 10, 10, 10, 20, 10
    records = [_record(0), _record(10), _record(20), _record(30), _record(50), _record(60)]
    windows = ((_START, _START + timedelta(seconds=60)),)

    observed, irregularity = sampling_profile(records, windows, _policy())

    assert observed == 10.0
    # 5 intervals total. One is 20, which is > (1 + 0.2) * 10. So 1 irregular out of 5 = 20%.
    assert irregularity == 20.0


def test_sampling_profile_empty_records() -> None:
    windows = ((_START, _START + timedelta(seconds=30)),)
    observed, irregularity = sampling_profile([], windows, _policy())
    assert observed is None
    assert irregularity is None


def test_coverage_calculates_sample_coverage_and_max_gap() -> None:
    records = [_record(0), _record(10), _record(20), _record(30), _record(40)]
    valid = [_record(0), _record(10), _record(40)]
    windows = ((_START, _START + timedelta(seconds=40)),)

    sample_coverage, max_gap, dropout_count = coverage(records, valid, windows, 1.0, _policy())

    assert sample_coverage == 60.0  # 3 valid / 5 active
    assert max_gap == 30.0  # Gap from 10 to 40
    # threshold = max(15.0, 10.0 * 5.0) = 50.0. 30.0 is not > 50.0, so 0 dropouts
    assert dropout_count == 0


def test_coverage_detects_dropout() -> None:
    records = [_record(0), _record(10), _record(20), _record(30), _record(40), _record(50), _record(60), _record(70)]
    valid = [_record(0), _record(70)]
    windows = ((_START, _START + timedelta(seconds=70)),)

    sample_coverage, max_gap, dropout_count = coverage(records, valid, windows, 1.0, _policy())

    assert sample_coverage == 25.0
    assert max_gap == 70.0  # Gap from 0 to 70
    # threshold = max(15.0, 10.0 * 5.0) = 50.0. 70.0 > 50.0, so 1 dropout
    assert dropout_count == 1


def test_coverage_empty_valid() -> None:
    records = [_record(0), _record(10), _record(20)]
    windows = ((_START, _START + timedelta(seconds=20)),)

    sample_coverage, max_gap, dropout_count = coverage(records, [], windows, 1.0, _policy())

    assert sample_coverage == 0.0
    assert max_gap == 20.0
    # threshold = max(15.0, 10.0 * 5.0) = 50.0. 20.0 is not > 50.0
    assert dropout_count == 0
