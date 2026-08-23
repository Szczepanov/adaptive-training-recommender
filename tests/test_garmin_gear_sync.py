from unittest.mock import MagicMock

import pytest

from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.garmin_provider import GarminProviderAdapter


def _wrapper_with_api() -> tuple[GarminClientWrapper, MagicMock]:
    wrapper = GarminClientWrapper(allow_credential_login=False)
    api = MagicMock()
    wrapper.api = api
    return wrapper, api


def test_get_gear_resolves_profile_and_enriches_missing_mileage_from_stats():
    wrapper, api = _wrapper_with_api()
    api.get_user_profile.return_value = {"userProfilePk": 42}
    api.get_gear.return_value = [
        {
            "gearPk": 12345,
            "uuid": "gear-uuid-1",
            "displayName": "Daily Shoes",
            "gearTypeName": "Shoes",
            "maximumMeters": 600_000,
            "gearStatusName": "active",
        }
    ]
    api.get_gear_stats.return_value = {
        "totalDistance": 250_400.0,
        "totalActivities": 31,
    }

    gear = wrapper.get_gear()

    api.get_gear.assert_called_once_with(42)
    api.get_gear_stats.assert_called_once_with("gear-uuid-1")
    assert gear[0]["totalDistance"] == 250_400.0
    assert gear[0]["totalActivities"] == 31


def test_get_gear_normalizes_gear_list_envelope_and_preserves_existing_mileage():
    wrapper, api = _wrapper_with_api()
    api.get_gear.return_value = {
        "gearList": [
            {
                "gearPk": 12345,
                "uuid": "gear-uuid-1",
                "totalDistance": 12_345.0,
            }
        ]
    }

    gear = wrapper.get_gear(user_profile_number="42")

    assert gear == [
        {
            "gearPk": 12345,
            "uuid": "gear-uuid-1",
            "totalDistance": 12_345.0,
        }
    ]
    api.get_user_profile.assert_not_called()
    api.get_gear.assert_called_once_with("42")
    api.get_gear_stats.assert_not_called()


def test_get_gear_does_not_mask_inventory_failures_as_empty_account():
    wrapper, api = _wrapper_with_api()
    api.get_gear.side_effect = RuntimeError("Garmin unavailable")

    with pytest.raises(RuntimeError, match="Garmin unavailable"):
        wrapper.get_gear(user_profile_number=42)


def test_provider_fetch_gear_canonicalizes_enriched_stats_distance_and_threshold():
    wrapper, api = _wrapper_with_api()
    api.get_user_profile.return_value = {"userProfilePk": 42}
    api.get_gear.return_value = [
        {
            "gearPk": 12345,
            "uuid": "gear-uuid-1",
            "customMakeModel": "Nike Vaporfly 3",
            "displayName": "Race Shoes",
            "gearTypeName": "Shoes",
            "gearMakeName": "Nike",
            "gearModelName": "Vaporfly 3",
            "maximumMeters": 600_000,
            "dateBegin": "2025-01-01T00:00:00.0",
            "gearStatusName": "ACTIVE",
        }
    ]
    api.get_gear_stats.return_value = {"totalDistance": 250_400.0}

    result = GarminProviderAdapter(wrapper).fetch_gear()

    assert len(result.canonical) == 1
    item = result.canonical[0]
    assert item.gear_pk == "12345"
    assert item.total_distance_km == 250.4
    assert item.maximum_distance_km == 600.0
    assert item.date_begin == "2025-01-01"
    assert item.status == "active"
    assert result.raw_payloads["gear"][0]["totalDistance"] == 250_400.0
