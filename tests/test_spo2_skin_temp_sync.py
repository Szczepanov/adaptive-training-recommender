from unittest.mock import MagicMock

import pytest

from garmin_sync.canonical import CanonicalDailyMetrics, CanonicalSpo2
from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    canonicalize_from_raw,
    extract_skin_temp_deviation,
    extract_spo2,
)
from garmin_sync.mapper import build_snapshot_from_canonical
from garmin_sync.models import DerivedMetrics


def test_extracts_spo2_and_skin_temp_from_real_garmin_shapes():
    # garminconnect.get_spo2_data() returns the daily summary at the root.
    spo2_raw = {
        "calendarDate": "2026-08-23",
        "averageSpO2": 96.5,
        "lowestSpO2": 92.0,
    }
    # Garmin sleep responses expose skin-temperature deviation at the top level.
    sleep_raw = {
        "avgSkinTempDeviationC": 0.35,
        "dailySleepDTO": {
            "averageSpO2Value": 96.0,
            "lowestSpO2Value": 91.0,
        },
    }

    spo2 = extract_spo2(spo2_raw, sleep_raw)

    assert spo2 is not None
    assert spo2.avg_pct == 96.5
    assert spo2.min_pct == 92.0
    assert spo2.sleep_avg_pct == 96.0
    assert extract_skin_temp_deviation(sleep_raw) == 0.35


def test_spo2_sources_are_not_synthesized_from_each_other():
    sleep_only = extract_spo2(
        None,
        {"dailySleepDTO": {"averageSpO2Value": 95.0, "lowestSpO2Value": 90.0}},
    )
    assert sleep_only is not None
    assert sleep_only.avg_pct is None
    assert sleep_only.min_pct is None
    assert sleep_only.sleep_avg_pct == 95.0

    daily_only = extract_spo2({"averageSpO2": 97.0, "lowestSpO2": 93.0}, None)
    assert daily_only is not None
    assert daily_only.avg_pct == 97.0
    assert daily_only.min_pct == 93.0
    assert daily_only.sleep_avg_pct is None


def test_spo2_accepts_observed_key_case_variant_and_rejects_invalid_percentages():
    variant = extract_spo2({"averageSpo2": 97.0, "lowestSpo2": 92.0}, None)
    assert variant is not None
    assert variant.avg_pct == 97.0
    assert variant.min_pct == 92.0

    assert extract_spo2({"averageSpO2": 101.0, "lowestSpO2": 0.0}, None) is None


def test_skin_temp_zero_deviation_is_not_treated_as_missing():
    assert extract_skin_temp_deviation({"avgSkinTempDeviationC": 0.0}) == 0.0


def test_sleep_fallback_keeps_overnight_metrics_on_one_logical_date():
    fallback_sleep = {
        "avgSkinTempDeviationC": -0.25,
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 78}},
            "sleepTimeSeconds": 28_800,
            "averageSpO2Value": 95.0,
            "lowestSpO2Value": 90.0,
        },
    }

    canonical = canonicalize_from_raw(
        stats_today={},
        stats_fallback=None,
        sleep_today={},
        sleep_fallback=fallback_sleep,
        hrv_today={},
        target_date_iso="2026-08-23",
        yesterday_iso="2026-08-22",
        # This belongs to the target date and must not be mixed into the selected
        # D-1 sleep record.
        spo2_today={"averageSpO2": 99.0, "lowestSpO2": 98.0},
    )

    assert canonical.sleep_date == "2026-08-22"
    assert canonical.spo2 is not None
    # Daily Pulse Ox belongs to D and is deliberately suppressed when D-1 sleep is
    # selected. Only the sleep-derived SpO2 value follows the fallback night.
    assert canonical.spo2.avg_pct is None
    assert canonical.spo2.min_pct is None
    assert canonical.spo2.sleep_avg_pct == 95.0
    assert canonical.skin_temp_deviation_celsius == -0.25


def test_snapshot_records_fallback_provenance_and_sleep_only_availability():
    canonical = CanonicalDailyMetrics(
        date="2026-08-23",
        sleep_score=78,
        sleep_date="2026-08-22",
        spo2=CanonicalSpo2(sleep_avg_pct=95.0),
        skin_temp_deviation_celsius=0.0,
    )

    snapshot = build_snapshot_from_canonical(
        user_id="uid-1",
        target_date_iso="2026-08-23",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
        synced_at_iso="2026-08-23T05:00:00+00:00",
    )

    assert snapshot.source.metricDates.spo2 == "2026-08-22"
    assert snapshot.source.metricDates.skinTempDeviation == "2026-08-22"
    assert snapshot.dataQuality.spo2Available is True
    assert snapshot.dataQuality.skinTempAvailable is True


def _daily_client() -> MagicMock:
    client = MagicMock()
    client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 9_000}
    client.get_sleep_data.return_value = {
        "avgSkinTempDeviationC": 0.4,
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 85}},
            "averageSpO2Value": 96.0,
            "lowestSpO2Value": 91.0,
        },
    }
    client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 62}}
    client.get_stress_data.return_value = {}
    client.get_respiration_data.return_value = {}
    client.get_body_battery.return_value = []
    client.get_training_readiness.return_value = []
    client.get_training_status.return_value = {}
    client.get_heart_rate_zones.return_value = []
    client.get_daily_weigh_ins.return_value = {}
    return client


def test_daily_fetch_uses_spo2_endpoint_but_skin_temp_from_sleep_payload():
    client = _daily_client()
    client.get_spo2_data.return_value = {
        "calendarDate": "2026-08-23",
        "averageSpO2": 96.5,
        "lowestSpO2": 92.0,
    }

    result = GarminProviderAdapter(client).fetch_daily_metrics("2026-08-23", "2026-08-22")

    client.get_spo2_data.assert_called_once_with("2026-08-23")
    client.get_skin_temp_data.assert_not_called()
    assert "skin_temperature" not in result.raw_payloads
    assert result.canonical.spo2 is not None
    assert result.canonical.spo2.avg_pct == 96.5
    assert result.canonical.skin_temp_deviation_celsius == 0.4


def test_daily_fetch_surfaces_missing_spo2_dependency_contract():
    client = _daily_client()
    client.get_spo2_data.side_effect = AttributeError("get_spo2_data is unavailable")

    with pytest.raises(AttributeError, match="get_spo2_data"):
        GarminProviderAdapter(client).fetch_daily_metrics("2026-08-23", "2026-08-22")
