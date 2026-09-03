from dataclasses import FrozenInstanceError

import pytest

from garmin_sync.canonical import (
    CanonicalActivityDetail,
    CanonicalDailyMetrics,
    CanonicalPerformanceTargets,
)
from garmin_sync.provider import (
    ProviderActivitiesResult,
    ProviderActivityDetailResult,
    ProviderCapabilities,
    ProviderFetchResult,
    ProviderGearResult,
    ProviderPerformanceTargetsResult,
)


def test_provider_capabilities_defaults() -> None:
    capabilities = ProviderCapabilities()

    assert capabilities.daily_summary is True
    assert capabilities.sleep is True
    assert capabilities.hrv is True
    assert capabilities.activities is True
    assert capabilities.activity_details is False
    assert capabilities.activity_hr_fidelity is False
    assert capabilities.body_composition is False
    assert capabilities.race_predictions is False
    assert capabilities.training_readiness is False
    assert capabilities.gear_tracking is False
    assert capabilities.workout_publishing is False


def test_provider_capabilities_frozen() -> None:
    capabilities = ProviderCapabilities()

    with pytest.raises(FrozenInstanceError):
        capabilities.daily_summary = False  # type: ignore[misc]


def test_provider_fetch_result_instantiation() -> None:
    canonical_mock = CanonicalDailyMetrics(
        date="2023-01-01",
        resting_heart_rate_bpm=None,
        resting_heart_rate_date=None,
        hrv_overnight_avg_ms=None,
        hrv_status=None,
        hrv_date=None,
        sleep_score=None,
        sleep_duration_seconds=None,
        sleep_date=None,
        sleep_session_start=None,
        sleep_session_end=None,
        deep_sleep_seconds=None,
        rem_sleep_seconds=None,
        light_sleep_seconds=None,
        awake_sleep_seconds=None,
        restless_moments_count=None,
        awake_count=None,
        respiration_rate_brpm=None,
        body_battery_wake=None,
        body_battery_wake_date=None,
        steps_count=None,
        steps_date=None,
        weight_kg=None,
        body_fat_pct=None,
        weight_date=None,
        stress=None,
        body_battery=None,
        training_readiness=None,
        training_status=None,
        heart_rate_zones=None,
        spo2=None,
        skin_temp_deviation_celsius=None,
        recovery_time_hours=None,
    )
    raw_payloads = {"stats": {"foo": "bar"}}

    result = ProviderFetchResult(canonical=canonical_mock, raw_payloads=raw_payloads)

    assert result.canonical == canonical_mock
    assert result.raw_payloads == raw_payloads


def test_provider_activities_result_instantiation() -> None:
    result = ProviderActivitiesResult(canonical=[], raw_payload=[])

    assert result.canonical == []
    assert result.raw_payload == []


def test_provider_activity_detail_result_instantiation() -> None:
    canonical_mock = CanonicalActivityDetail(
        activity_id="123",
        power_zones=[],
        hr_zones=[],
        normalized_power_watts=None,
        intensity_factor=None,
        variability_index=None,
        laps=[],
        exercise_sets=[],
    )
    raw_payloads = {"detail": {"baz": "qux"}}

    result = ProviderActivityDetailResult(canonical=canonical_mock, raw_payloads=raw_payloads)

    assert result.canonical == canonical_mock
    assert result.raw_payloads == raw_payloads


def test_provider_performance_targets_result_instantiation() -> None:
    canonical_mock = CanonicalPerformanceTargets(
        cycling_ftp_watts=None,
        running_threshold_pace_sec_per_km=None,
        running_lthr_bpm=None,
        weight_kg=None,
        body_fat_pct=None,
        race_predictions=None,
        ftp_measured_at=None,
        threshold_measured_at=None,
        lthr_measured_at=None,
        weight_measured_at=None,
    )
    raw_payloads = {"targets": {"a": "b"}}

    result = ProviderPerformanceTargetsResult(canonical=canonical_mock, raw_payloads=raw_payloads)

    assert result.canonical == canonical_mock
    assert result.raw_payloads == raw_payloads


def test_provider_gear_result_instantiation() -> None:
    result = ProviderGearResult(canonical=[], raw_payloads={})

    assert result.canonical == []
    assert result.raw_payloads == {}
