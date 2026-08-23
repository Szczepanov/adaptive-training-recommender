from datetime import datetime, timezone

from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    canonicalize_performance_targets,
    extract_body_composition,
)
from garmin_sync.provider import ProviderCapabilities


def test_body_composition_capability_is_opt_in_per_provider():
    assert ProviderCapabilities().body_composition is False
    assert GarminProviderAdapter.capabilities.body_composition is True


def test_extract_body_composition_selects_latest_observation_not_list_order():
    payload = {
        "dateWeightList": [
            {
                "weight": 71000.0,
                "bodyFat": 13.0,
                "calendarDate": "2026-08-23",
            },
            {
                "weight": 72000.0,
                "bodyFat": 14.0,
                "calendarDate": "2026-08-20",
            },
        ]
    }

    weight_kg, body_fat_pct, measured_at = extract_body_composition(payload)

    assert weight_kg == 71.0
    assert body_fat_pct == 13.0
    assert measured_at == "2026-08-23"


def test_extract_body_composition_supports_epoch_date_when_calendar_date_missing():
    epoch_ms = int(datetime(2026, 8, 23, tzinfo=timezone.utc).timestamp() * 1000)
    payload = {"dateWeightList": [{"weight": 70500.0, "date": epoch_ms}]}

    weight_kg, body_fat_pct, measured_at = extract_body_composition(payload)

    assert weight_kg == 70.5
    assert body_fat_pct is None
    assert measured_at == "2026-08-23"


def test_profile_targets_do_not_treat_range_average_as_latest_weight():
    targets = canonicalize_performance_targets(
        None,
        None,
        None,
        body_composition={
            "totalAverage": {
                "weight": 74500.0,
                "bodyFat": 14.2,
                "calendarDate": "2026-08-23",
            }
        },
    )

    assert targets.weight_kg is None
    assert targets.body_fat_pct is None
    assert targets.weight_measured_at is None
