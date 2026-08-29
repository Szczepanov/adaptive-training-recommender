from datetime import datetime, timedelta

from garmin_sync.canonical import CanonicalHrSourceEvidence
from garmin_sync.fit_activity import FitActivityEvidence, FitRecordSample, FitTimerEvent
from garmin_sync.hr_fidelity import activity_motion_risk_for, assess_activity_hr_fidelity

_START = datetime(2026, 8, 29, 8, 0)


def _source(
    *,
    source_for_activity: str = "wrist",
    provenance_confidence: str = "inferred",
    sensor_technology: str = "wrist_ppg",
) -> CanonicalHrSourceEvidence:
    return CanonicalHrSourceEvidence(
        external_hr_sensor_present=None,
        source_for_activity=source_for_activity,  # type: ignore[arg-type]
        provenance_confidence=provenance_confidence,  # type: ignore[arg-type]
        sensor_technology=sensor_technology,  # type: ignore[arg-type]
    )


def _records(
    seconds: list[int], *, hr: float = 140, cadence: float | None = None, power: float | None = None
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


def test_unassessable_trace_is_unknown_not_unreliable():
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


def test_clean_confirmed_chest_strap_trace_can_be_high_confidence():
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


def test_pause_window_is_not_misclassified_as_dropout():
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


def test_assessed_long_gap_is_unreliable():
    result = assess_activity_hr_fidelity(
        "running",
        _evidence(_records(list(range(11)) + list(range(60, 71))), _complete_events(70)),
        _source(),
    )

    assert result.quality.measurement_confidence == "unreliable"
    assert {"DROPOUT", "INSUFFICIENT_COVERAGE"} <= set(result.quality.artifact_flags)


def test_isolated_spike_is_kept_as_specific_artifact_evidence():
    records = list(_records(list(range(121)), power=200))
    records[60] = FitRecordSample(_START + timedelta(seconds=60), 190, None, 200)

    result = assess_activity_hr_fidelity(
        "cycling", _evidence(tuple(records), _complete_events(120)), _source()
    )

    assert "ISOLATED_SPIKE" in result.quality.artifact_flags
    assert result.quality.measurement_confidence == "low"


def test_normal_power_backed_interval_transition_is_not_an_abrupt_hr_artifact():
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


def test_stale_hr_with_large_power_change_is_suspect():
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


def test_cadence_lock_is_modality_specific():
    records = _records(list(range(61)), hr=160, cadence=160)

    running = assess_activity_hr_fidelity(
        "running", _evidence(records, _complete_events(60)), _source()
    )
    cycling = assess_activity_hr_fidelity(
        "cycling", _evidence(records, _complete_events(60)), _source()
    )

    assert "CADENCE_LOCK_SUSPECTED" in running.quality.artifact_flags
    assert "CADENCE_LOCK_SUSPECTED" not in cycling.quality.artifact_flags


def test_cycling_harmonic_lock_and_ambiguous_source_cannot_be_high():
    result = assess_activity_hr_fidelity(
        "cycling",
        _evidence(_records(list(range(61)), hr=180, cadence=90), _complete_events(60)),
        _source(
            source_for_activity="mixed_possible",
            provenance_confidence="ambiguous",
            sensor_technology="external_unknown",
        ),
    )

    assert "HARMONIC_LOCK_SUSPECTED" in result.quality.artifact_flags
    assert result.quality.measurement_confidence != "high"


def test_motion_risk_mapping_is_small_and_conservative():
    assert activity_motion_risk_for("running") == "moderate"
    assert activity_motion_risk_for("strength_training") == "high"
    assert activity_motion_risk_for("swimming") == "unknown"
