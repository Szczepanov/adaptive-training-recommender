from dataclasses import replace
from datetime import datetime, timedelta, timezone

from garmin_sync.activity_response import (
    MAX_PERSISTED_SEGMENTS,
    coarsest_preserving_resolution,
    derive_activity_response,
    evaluate_activity_resolution_candidates,
    evaluate_resolution_candidates,
)
from garmin_sync.fit_activity import (
    FitActivityEvidence,
    FitLapEvidence,
    FitRecordSample,
    FitWorkoutStepEvidence,
)


def _step(index: int, intensity: str, duration: int, target: float | None = None):
    return FitWorkoutStepEvidence(
        message_index=index,
        name=f"step-{index}",
        duration_type="time",
        duration_value=float(duration),
        target_type="power" if target is not None else "open",
        target_value=0.0 if target is not None else None,
        custom_target_value_low=target,
        custom_target_value_high=target,
        intensity=intensity,
        equipment="bike",
    )


def _structured_evidence(specs):
    start = datetime(2026, 9, 18, 6, 0, tzinfo=timezone.utc)
    records = []
    laps = []
    steps = []
    elapsed = 0
    for index, spec in enumerate(specs):
        duration = spec["duration"]
        intensity = spec["intensity"]
        target = spec.get("target")
        steps.append(_step(index, intensity, duration, target))
        segment_start = start + timedelta(seconds=elapsed)
        thirds = spec.get("thirds")
        for second in range(duration):
            if thirds:
                third = min(2, int(second / duration * 3))
                power = thirds[third]
            else:
                power = spec["power"]
            records.append(
                FitRecordSample(
                    timestamp=segment_start + timedelta(seconds=second),
                    heart_rate_bpm=spec.get("hr", 130) + min(12, second / max(duration, 1) * 12),
                    cadence_rpm=spec.get("cadence", 90),
                    power_watts=power,
                    workout_step_index=index,
                )
            )
        segment_end = segment_start + timedelta(seconds=duration)
        laps.append(
            FitLapEvidence(
                message_index=index,
                start_time=segment_start,
                timestamp=segment_end,
                duration_seconds=float(duration),
                workout_step_index=index,
                average_power_watts=float(spec.get("power", thirds[1] if thirds else 0)),
                average_hr_bpm=float(spec.get("hr", 130)),
                max_hr_bpm=float(spec.get("hr", 130) + 12),
                average_cadence_rpm=float(spec.get("cadence", 90)),
                max_cadence_rpm=float(spec.get("cadence", 90) + 4),
            )
        )
        elapsed += duration
    return FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=145,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=(),
        laps=tuple(laps),
        workout_step_indices=tuple(range(len(steps))),
        workout_name="synthetic structured workout",
        workout_steps=tuple(steps),
    )


def test_threshold_fixture_keeps_exact_semantics_target_actual_and_thirds_separate():
    evidence = _structured_evidence(
        [
            {"duration": 1200, "intensity": "warmup", "power": 150, "hr": 120},
            {
                "duration": 900,
                "intensity": "active",
                "power": 229,
                "target": 230,
                "thirds": (232, 230, 225),
                "hr": 150,
            },
            {"duration": 300, "intensity": "recovery", "power": 120, "hr": 125},
            {
                "duration": 900,
                "intensity": "active",
                "power": 231,
                "target": 230,
                "thirds": (233, 231, 228),
                "hr": 152,
            },
            {"duration": 300, "intensity": "recovery", "power": 120, "hr": 126},
            {
                "duration": 900,
                "intensity": "active",
                "power": 226,
                "target": 230,
                "thirds": (230, 227, 221),
                "hr": 154,
            },
            {"duration": 1200, "intensity": "cooldown", "power": 130, "hr": 128},
        ]
    )

    response = derive_activity_response("road_biking", evidence)

    assert response is not None
    assert response.segment_count_total == 7
    assert [segment.segment_type for segment in response.segments] == [
        "warmup",
        "work",
        "recovery",
        "work",
        "recovery",
        "work",
        "cooldown",
    ]
    work = [segment for segment in response.segments if segment.segment_type == "work"]
    assert [segment.identity_source for segment in work] == ["fit_workout_step"] * 3
    assert [segment.prescribed_target.value for segment in work] == [230, 230, 230]
    assert [round(segment.average_power_watts or 0) for segment in work] == [229, 231, 226]
    assert work[0].first_third_power_watts > work[0].last_third_power_watts
    assert work[2].last_third_hr_bpm is not None
    assert response.source_resolution.power_seconds == 1.0
    assert response.power_duration_peaks
    one_second = next(peak for peak in response.power_duration_peaks if peak.duration_seconds == 1)
    five_seconds = next(
        peak for peak in response.power_duration_peaks if peak.duration_seconds == 5
    )
    assert one_second.confidence == "moderate"
    assert five_seconds.confidence == "high"


def test_partial_semantic_lap_linkage_falls_back_instead_of_dropping_steps():
    evidence = _structured_evidence(
        [
            {"duration": 300, "intensity": "warmup", "power": 150},
            {"duration": 900, "intensity": "active", "power": 230},
            {"duration": 300, "intensity": "recovery", "power": 120},
            {"duration": 900, "intensity": "active", "power": 228},
        ]
    )
    laps = list(evidence.laps)
    laps[2] = replace(laps[2], workout_step_index=None)
    response = derive_activity_response("road_biking", replace(evidence, laps=tuple(laps)))

    assert response is not None
    # Complete record-level linkage is preferred over a partial Lap mapping. Most
    # importantly, the unlinked recovery is not silently dropped from the semantic set.
    assert response.segment_count_total == 4
    assert [segment.segment_type for segment in response.segments] == [
        "warmup",
        "work",
        "recovery",
        "work",
    ]
    assert all(segment.identity_source == "fit_workout_step" for segment in response.segments)


def test_semantic_30_30_recoveries_are_not_work_segments():
    specs = [{"duration": 300, "intensity": "warmup", "power": 150}]
    for _ in range(6):
        specs.extend(
            [
                {"duration": 30, "intensity": "interval", "power": 360, "target": 360},
                {"duration": 30, "intensity": "recovery", "power": 120},
            ]
        )
    response = derive_activity_response("indoor_cycling", _structured_evidence(specs))
    assert response is not None
    assert len([segment for segment in response.segments if segment.segment_type == "work"]) == 6
    assert (
        len([segment for segment in response.segments if segment.segment_type == "recovery"]) == 6
    )


def test_lap_record_windows_do_not_double_count_the_next_segment_boundary():
    evidence = _structured_evidence(
        [
            {"duration": 10, "intensity": "interval", "power": 700, "cadence": 120},
            {"duration": 60, "intensity": "recovery", "power": 100, "cadence": 80},
        ]
    )
    evidence = replace(
        evidence,
        records=tuple(replace(record, workout_step_index=None) for record in evidence.records),
    )

    response = derive_activity_response("road_biking", evidence)

    assert response is not None
    sprint = next(segment for segment in response.segments if segment.segment_type == "sprint")
    recovery = next(
        segment for segment in response.segments if segment.segment_type == "recovery"
    )
    assert sprint.average_power_watts == 700.0
    assert recovery.average_power_watts == 100.0


def test_six_ten_second_sprints_preserve_short_power_and_cadence():
    specs = [{"duration": 180, "intensity": "warmup", "power": 150}]
    for index in range(6):
        specs.extend(
            [
                {
                    "duration": 10,
                    "intensity": "interval",
                    "power": 700 - index * 20,
                    "target": 700,
                    "cadence": 118 - index,
                },
                {"duration": 60, "intensity": "recovery", "power": 100, "cadence": 80},
            ]
        )
    response = derive_activity_response("road_biking", _structured_evidence(specs))
    assert response is not None
    sprints = [segment for segment in response.segments if segment.segment_type == "sprint"]
    assert len(sprints) == 6
    assert all(segment.peak_5s_power_watts is not None for segment in sprints)
    assert all(segment.peak_10s_power_watts is not None for segment in sprints)
    assert all(segment.max_cadence_rpm is not None for segment in sprints)
    assert sprints[-1].average_power_watts < sprints[0].average_power_watts


def test_four_by_four_retains_interval_means_and_bounded_intra_rep_trajectory():
    specs = [{"duration": 600, "intensity": "warmup", "power": 150, "hr": 120}]
    for index in range(4):
        specs.extend(
            [
                {
                    "duration": 240,
                    "intensity": "active",
                    "power": 330 - index * 3,
                    "thirds": (334 - index * 3, 330 - index * 3, 326 - index * 3),
                    "hr": 155 + index,
                },
                {"duration": 180, "intensity": "recovery", "power": 120, "hr": 130},
            ]
        )
    response = derive_activity_response("indoor_cycling", _structured_evidence(specs))
    assert response is not None
    work = [segment for segment in response.segments if segment.segment_type == "work"]
    assert len(work) == 4
    assert [round(segment.average_power_watts or 0) for segment in work] == [330, 327, 324, 321]
    assert all(segment.first_third_power_watts is not None for segment in work)
    assert all(segment.last_third_power_watts is not None for segment in work)
    assert work[0].first_third_power_watts > work[0].last_third_power_watts


def test_missing_power_and_cadence_remain_explicitly_unavailable():
    start = datetime(2026, 9, 18, 6, 0, tzinfo=timezone.utc)
    records = tuple(
        FitRecordSample(
            timestamp=start + timedelta(seconds=index),
            heart_rate_bpm=125 + index / 60,
            cadence_rpm=None,
            power_watts=None,
        )
        for index in range(180)
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=records,
        average_heart_rate_bpm=127,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=(),
    )

    response = derive_activity_response("road_biking", evidence)

    assert response is not None
    assert response.source_resolution.power_seconds is None
    assert response.source_resolution.cadence_seconds is None
    assert response.source_resolution.hr_seconds == 1.0
    assert response.power_duration_peaks == ()


def test_native_resolution_does_not_manufacture_unsupported_short_mmp():
    start = datetime(2026, 9, 18, 6, 0, tzinfo=timezone.utc)
    records = tuple(
        FitRecordSample(
            timestamp=start + timedelta(seconds=index * 10),
            heart_rate_bpm=130,
            cadence_rpm=90,
            power_watts=200 + (100 if index == 5 else 0),
        )
        for index in range(120)
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=records,
        average_heart_rate_bpm=130,
        lap_average_heart_rate_bpm=(),
        time_in_hr_zone_seconds=(),
        timer_events=(),
    )
    response = derive_activity_response("road_biking", evidence)
    assert response is not None
    assert response.source_resolution.power_seconds == 10.0
    durations = {peak.duration_seconds for peak in response.power_duration_peaks}
    assert 1 not in durations
    assert 5 not in durations
    assert 10 not in durations
    assert 30 not in durations
    assert 60 in durations


def test_segment_storage_is_bounded():
    specs = [
        {"duration": 30, "intensity": "interval", "power": 300 + (index % 2) * 10}
        for index in range(MAX_PERSISTED_SEGMENTS + 10)
    ]
    response = derive_activity_response("indoor_cycling", _structured_evidence(specs))
    assert response is not None
    assert response.segment_count_total == MAX_PERSISTED_SEGMENTS + 10
    assert len(response.segments) == MAX_PERSISTED_SEGMENTS
    assert response.segments_truncated is True


def test_feature_family_resolution_harness_reports_threshold_tolerances_and_coarsest_pass():
    evidence = _structured_evidence(
        [
            {"duration": 300, "intensity": "warmup", "power": 150, "hr": 120},
            {
                "duration": 900,
                "intensity": "active",
                "power": 230,
                "thirds": (232, 230, 228),
                "hr": 150,
            },
            {"duration": 300, "intensity": "recovery", "power": 120, "hr": 125},
            {
                "duration": 900,
                "intensity": "active",
                "power": 228,
                "thirds": (231, 228, 225),
                "hr": 152,
            },
            {"duration": 300, "intensity": "recovery", "power": 120, "hr": 126},
            {
                "duration": 900,
                "intensity": "active",
                "power": 224,
                "thirds": (228, 224, 220),
                "hr": 154,
            },
        ]
    )

    results = evaluate_activity_resolution_candidates("road_biking", evidence)
    one_second = next(result for result in results if result.candidate_seconds == 1)
    assert one_second.passes_required_rate is True
    assert any(
        feature.feature == "work_first_to_last_fade"
        and feature.error_unit == "percentage_points"
        and feature.tolerance_value == 1.0
        for feature in one_second.features
    )
    assert any(
        feature.feature.endswith("_average_hr")
        and feature.error_unit == "bpm"
        and feature.tolerance_value == 1.0
        for feature in one_second.features
    )
    assert coarsest_preserving_resolution(results) is not None


def test_feature_family_resolution_harness_requires_fine_source_for_sprint_peaks():
    evidence = _structured_evidence(
        [
            {"duration": 10, "intensity": "interval", "power": 720, "cadence": 122},
            {"duration": 60, "intensity": "recovery", "power": 100, "cadence": 80},
            {"duration": 10, "intensity": "interval", "power": 700, "cadence": 120},
        ]
    )

    results = evaluate_activity_resolution_candidates("road_biking", evidence)
    one_second = next(result for result in results if result.candidate_seconds == 1)
    two_seconds = next(result for result in results if result.candidate_seconds == 2)
    assert one_second.passes_required_rate is True
    assert any(
        feature.feature.endswith("_peak_5s_power")
        and feature.tolerance_value == 2.0
        and feature.state == "preserved"
        for feature in one_second.features
    )
    assert any(
        feature.feature.endswith("_peak_5s_power") and feature.state == "feature_unavailable"
        for feature in two_seconds.features
    )
    assert two_seconds.passes_required_rate is False


def test_resolution_harness_reports_candidate_degradation_separately_from_source_limits():
    start = datetime(2026, 9, 18, 6, 0, tzinfo=timezone.utc)
    records = []
    for second in range(600):
        power = 180.0
        if 100 <= second < 110:
            power = 700.0
        records.append(
            FitRecordSample(
                timestamp=start + timedelta(seconds=second),
                heart_rate_bpm=None,
                cadence_rpm=None,
                power_watts=power,
            )
        )

    results = evaluate_resolution_candidates(tuple(records))
    by_resolution = {result.candidate_seconds: result for result in results}
    assert by_resolution[1].passes_required_rate is True
    assert by_resolution[10].passes_required_rate is False
    assert any(
        feature.state in {"feature_unavailable", "degraded"}
        for feature in by_resolution[10].features
    )
    assert len(results) == 10
