from datetime import datetime, timedelta

from garmin_sync.canonical import (
    CanonicalHrSourceEvidence,
    HrProvenanceConfidence,
    HrSensorTechnology,
    HrSourceForActivity,
)
from garmin_sync.fit_activity import FitActivityEvidence, FitRecordSample, FitTimerEvent
from garmin_sync.hr_fidelity import activity_motion_risk_for, assess_activity_hr_fidelity

_START = datetime(2026, 8, 29, 8, 0)


def _source(
    *,
    source_for_activity: HrSourceForActivity = "wrist",
    provenance_confidence: HrProvenanceConfidence = "inferred",
    sensor_technology: HrSensorTechnology = "wrist_ppg",
) -> CanonicalHrSourceEvidence:
    return CanonicalHrSourceEvidence(
        external_hr_sensor_present=None,
        source_for_activity=source_for_activity,
        provenance_confidence=provenance_confidence,
        sensor_technology=sensor_technology,
    )


def _records(
    seconds: list[int],
    *,
    hr: float = 140,
    cadence: float | None = None,
    power: float | None = None,
) -> tuple[FitRecordSample, ...]:
    return tuple(
        FitRecordSample(
            timestamp=_START + timedelta(seconds=second),
            heart_rate_bpm=hr,
            cadence_rpm=cadence,
            power_watts=power,
        )
        for second in seconds
    )


def _evidence(
    records: tuple[FitRecordSample, ...], events: tuple[FitTimerEvent, ...] = ()
) -> FitActivityEvidence:
    return FitActivityEvidence(
        devices=(),
        records=records,
        average_heart_rate_bpm=None,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )


def _complete_events(stop_second: int) -> tuple[FitTimerEvent, ...]:
    return (
        FitTimerEvent(_START, "start"),
        FitTimerEvent(_START + timedelta(seconds=stop_second), "stop"),
    )


def test_unassessable_trace_is_unknown_not_unreliable() -> None:
    evidence = _evidence(
        (
            FitRecordSample(None, 140, None, None),
            FitRecordSample(None, 141, None, None),
        )
    )

    result = assess_activity_hr_fidelity("running", evidence, _source())

    assert result.assessment_state == "UNASSESSABLE"
    assert result.quality.measurement_confidence == "unknown"
    assert result.quality.artifact_flags == ("ASSESSMENT_UNAVAILABLE",)
    assert result.sampling_irregularity_pct is None


def test_clean_confirmed_chest_strap_trace_can_be_high_confidence() -> None:
    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(_records(list(range(121)), power=200), _complete_events(120)),
        _source(
            source_for_activity="external",
            provenance_confidence="confirmed",
            sensor_technology="electrode_chest_strap",
        ),
    )

    assert result.assessment_state == "ASSESSABLE"
    assert result.quality.measurement_confidence == "high"
    assert result.quality.signal_quality == "clean"


def test_pause_window_is_not_misclassified_as_dropout() -> None:
    evidence = _evidence(
        _records(list(range(11)) + list(range(100, 111))),
        (
            FitTimerEvent(_START, "start"),
            FitTimerEvent(_START + timedelta(seconds=10), "stop"),
            FitTimerEvent(_START + timedelta(seconds=100), "resume"),
            FitTimerEvent(_START + timedelta(seconds=110), "stop"),
        ),
    )

    result = assess_activity_hr_fidelity("running", evidence, _source())

    assert result.assessment_state == "ASSESSABLE"
    assert "DROPOUT" not in result.quality.artifact_flags
    assert result.quality.coverage_pct == 100.0


def test_leading_stop_keeps_inferred_initial_window_but_is_partial() -> None:
    evidence = _evidence(
        _records(list(range(11)) + list(range(100, 111))),
        (
            FitTimerEvent(_START + timedelta(seconds=10), "stop"),
            FitTimerEvent(_START + timedelta(seconds=100), "resume"),
            FitTimerEvent(_START + timedelta(seconds=110), "stop"),
        ),
    )

    result = assess_activity_hr_fidelity("running", evidence, _source())

    assert result.assessment_state == "PARTIALLY_ASSESSABLE"
    assert result.quality.coverage_pct == 100.0
    assert "DROPOUT" not in result.quality.artifact_flags
    assert "PARTIAL_TIMER_WINDOW" in result.quality.reasons


def test_timer_events_are_clamped_to_record_span() -> None:
    records = tuple(
        FitRecordSample(_START + timedelta(seconds=second), 140, None, 200)
        for second in range(5, 116)
    )
    events = (
        FitTimerEvent(_START, "start"),
        FitTimerEvent(_START + timedelta(seconds=120), "stop"),
    )

    result = assess_activity_hr_fidelity("cycling", _evidence(records, events), _source())

    assert result.assessment_state == "ASSESSABLE"
    assert result.quality.coverage_pct == 100.0


def test_clean_30_second_fit_recording_is_not_treated_as_one_hz_dropout() -> None:
    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(_records([0, 30, 60, 90, 120], power=200), _complete_events(120)),
        _source(),
    )

    assert result.assessment_state == "ASSESSABLE"
    assert result.sampling_interval_seconds == 30.0
    assert result.sampling_irregularity_pct == 0.0
    assert result.quality.coverage_pct == 100.0
    assert "INSUFFICIENT_COVERAGE" not in result.quality.artifact_flags


def test_smart_recording_irregularity_is_reported_without_penalizing_complete_hr() -> None:
    records = _records([0, 1, 3, 4, 7, 8, 10, 11, 14, 15], power=200)

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(records, _complete_events(15)), _source()
    )

    assert result.sampling_irregularity_pct is not None
    assert result.sampling_irregularity_pct > 0
    assert result.quality.coverage_pct == 100.0
    assert "INSUFFICIENT_COVERAGE" not in result.quality.artifact_flags


def test_assessed_severe_long_gap_is_unreliable_without_inventing_missing_records() -> None:
    result = assess_activity_hr_fidelity(
        "running",
        _evidence(
            _records(list(range(11)) + list(range(180, 191))),
            _complete_events(190),
        ),
        _source(),
    )

    assert result.quality.measurement_confidence == "unreliable"
    assert "DROPOUT" in result.quality.artifact_flags
    assert "INSUFFICIENT_COVERAGE" not in result.quality.artifact_flags


def test_invalid_hr_prefix_is_counted_as_boundary_dropout() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            None if second < 60 else 140,
            None,
            200,
        )
        for second in range(121)
    )

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(records, _complete_events(120)), _source()
    )

    assert "DROPOUT" in result.quality.artifact_flags
    assert result.quality.longest_gap_seconds == 60.0
    assert result.quality.coverage_pct == 50.4


def test_isolated_spike_is_kept_as_specific_artifact_evidence() -> None:
    records = list(_records(list(range(121)), power=200))
    records[60] = FitRecordSample(_START + timedelta(seconds=60), 190, None, 200)

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(tuple(records), _complete_events(120)), _source()
    )

    assert "ISOLATED_SPIKE" in result.quality.artifact_flags
    assert result.quality.measurement_confidence == "low"


def test_persistent_abrupt_jump_requires_stable_independent_workload() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            130 if second < 60 else 170,
            None,
            200,
        )
        for second in range(121)
    )

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(records, _complete_events(120)), _source()
    )

    assert "ABRUPT_JUMP" in result.quality.artifact_flags


def test_normal_power_backed_interval_transition_is_not_an_abrupt_hr_artifact() -> None:
    records = [
        FitRecordSample(
            _START + timedelta(seconds=second),
            110 if second < 60 else 155,
            None,
            120 if second < 60 else 260,
        )
        for second in range(121)
    ]

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(tuple(records), _complete_events(120)), _source()
    )

    assert "ABRUPT_JUMP" not in result.quality.artifact_flags


def test_stale_hr_with_large_sustained_power_change_is_suspect() -> None:
    records = [
        FitRecordSample(
            _START + timedelta(seconds=second),
            140,
            None,
            100 if second < 120 else 250,
        )
        for second in range(241)
    ]

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(tuple(records), _complete_events(240)), _source()
    )

    assert {"STALE_PLATEAU", "WORKLOAD_DISCORDANCE"} <= set(result.quality.artifact_flags)


def test_single_power_spike_does_not_create_workload_discordance() -> None:
    records = [
        FitRecordSample(
            _START + timedelta(seconds=second),
            140,
            None,
            250 if second == 120 else 150,
        )
        for second in range(241)
    ]

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(tuple(records), _complete_events(240)), _source()
    )

    assert "WORKLOAD_DISCORDANCE" not in result.quality.artifact_flags


def test_workload_detector_does_not_bridge_pause_windows() -> None:
    records = tuple(
        [
            FitRecordSample(_START + timedelta(seconds=second), 140, None, 100)
            for second in range(121)
        ]
        + [
            FitRecordSample(_START + timedelta(seconds=second), 140, None, 250)
            for second in range(300, 421)
        ]
    )
    events = (
        FitTimerEvent(_START, "start"),
        FitTimerEvent(_START + timedelta(seconds=120), "stop"),
        FitTimerEvent(_START + timedelta(seconds=300), "resume"),
        FitTimerEvent(_START + timedelta(seconds=420), "stop"),
    )

    result = assess_activity_hr_fidelity("cycling", _evidence(records, events), _source())

    assert "WORKLOAD_DISCORDANCE" not in result.quality.artifact_flags


def test_running_cadence_lock_uses_fit_stride_cadence_and_independent_power() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            2 * (80 + second // 15),
            80 + second // 15,
            200,
        )
        for second in range(61)
    )

    running = assess_activity_hr_fidelity(
        "running", _evidence(records, _complete_events(60)), _source()
    )
    cycling = assess_activity_hr_fidelity(
        "cycling", _evidence(records, _complete_events(60)), _source()
    )

    assert "CADENCE_LOCK_SUSPECTED" in running.quality.artifact_flags
    assert "CADENCE_LOCK_SUSPECTED" not in cycling.quality.artifact_flags


def test_constant_cadence_and_matching_hr_is_not_enough_for_lock() -> None:
    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(
            _records(list(range(61)), hr=180, cadence=90, power=200),
            _complete_events(60),
        ),
        _source(),
    )

    assert "HARMONIC_LOCK_SUSPECTED" not in result.quality.artifact_flags


def test_cycling_harmonic_lock_and_ambiguous_source_cannot_be_high() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            2 * (85 + second // 15),
            85 + second // 15,
            200,
        )
        for second in range(61)
    )

    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(records, _complete_events(60)),
        _source(
            source_for_activity="mixed_possible",
            provenance_confidence="ambiguous",
            sensor_technology="external_unknown",
        ),
    )

    assert "HARMONIC_LOCK_SUSPECTED" in result.quality.artifact_flags
    assert result.quality.measurement_confidence != "high"
    assert "PROVENANCE_AMBIGUOUS" in result.quality.reasons


def test_sparse_cadence_coverage_does_not_trigger_lock() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            160,
            80 if second % 10 == 0 else None,
            200,
        )
        for second in range(121)
    )

    result = assess_activity_hr_fidelity(
        "running", _evidence(records, _complete_events(120)), _source()
    )

    assert "CADENCE_LOCK_SUSPECTED" not in result.quality.artifact_flags


def test_variable_cadence_match_without_independent_power_stays_unflagged() -> None:
    records = tuple(
        FitRecordSample(
            _START + timedelta(seconds=second),
            2 * (80 + second // 15),
            80 + second // 15,
            None,
        )
        for second in range(61)
    )

    result = assess_activity_hr_fidelity(
        "running", _evidence(records, _complete_events(60)), _source()
    )

    assert "CADENCE_LOCK_SUSPECTED" not in result.quality.artifact_flags


def test_raw_fit_timer_enum_values_are_supported() -> None:
    events = (
        FitTimerEvent(_START, 0),
        FitTimerEvent(_START + timedelta(seconds=60), 9),
    )

    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(_records(list(range(61)), power=200), events),
        _source(),
    )

    assert result.assessment_state == "ASSESSABLE"
    assert "PARTIAL_TIMER_WINDOW" not in result.quality.reasons


def test_motion_risk_mapping_is_small_and_conservative() -> None:
    assert activity_motion_risk_for("running") == "moderate"
    assert activity_motion_risk_for("strength_training") == "high"
    assert activity_motion_risk_for("swimming") == "unknown"
