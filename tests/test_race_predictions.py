from unittest.mock import MagicMock

from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.garmin_provider import GarminProviderAdapter, extract_race_predictions
from garmin_sync.provider import ProviderCapabilities


def test_race_prediction_capability_is_opt_in_and_enabled_for_garmin():
    assert ProviderCapabilities().race_predictions is False
    assert GarminProviderAdapter.capabilities.race_predictions is True


def test_extract_race_predictions_supports_current_latest_endpoint_keys():
    predictions = extract_race_predictions(
        {
            "time5K": 1273,
            "time10K": 2721,
            "timeHalfMarathon": 6167,
            "timeMarathon": 12840,
        }
    )

    assert predictions is not None
    assert predictions.five_km_sec == 1273
    assert predictions.ten_km_sec == 2721
    assert predictions.half_marathon_sec == 6167
    assert predictions.marathon_sec == 12840


def test_extract_race_predictions_returns_none_for_invalid_and_empty_inputs():
    assert extract_race_predictions(None) is None
    assert extract_race_predictions({}) is None
    assert extract_race_predictions([]) is None
    assert extract_race_predictions("invalid_string") is None


def test_extract_race_predictions_handles_list_shape_edge_cases():
    # Payload with racePredictionDtoList key, non-dict item, missing distance/time, and unmapped distance (3000m)
    payload = {
        "racePredictionDtoList": [
            "not_a_dict",
            {"distance": 5000},  # missing time
            {"time": 1200},  # missing distance
            {"distance": -5000, "time": 1200},  # negative distance
            {"distance": 5000, "time": -1200},  # negative time
            {"distance": 3000, "time": 600},  # out of target ranges
            {"distance": 5000, "time": 1250},  # valid 5k
        ]
    }
    predictions = extract_race_predictions(payload)
    assert predictions is not None
    assert predictions.five_km_sec == 1250
    assert predictions.ten_km_sec is None
    assert predictions.half_marathon_sec is None
    assert predictions.marathon_sec is None


def test_extract_race_predictions_supports_dict_key_aliases_and_filters_unmatched():
    # Key aliases '5000', '10000', '21k', '42k', as well as unrelated or invalid keys
    payload = {
        "5000": 1200,
        "10000": 2500,
        "21k": 5500,
        "42k": 11500,
        "unrelated_key": 9999,
        "invalid_5k_str": "1200",
    }
    predictions = extract_race_predictions(payload)
    assert predictions is not None
    assert predictions.five_km_sec == 1200
    assert predictions.ten_km_sec == 2500
    assert predictions.half_marathon_sec == 5500
    assert predictions.marathon_sec == 11500

    # Payload with no matching keys or positive values returns None
    assert extract_race_predictions({"unrelated": 123, "time5K": -100}) is None


def test_extract_race_predictions_ignores_non_finite_bool_and_string_values():
    predictions = extract_race_predictions(
        {
            "time5K": float("nan"),
            "time10K": True,
            "timeHalfMarathon": "6167",
            "timeMarathon": 12840,
        }
    )

    assert predictions is not None
    assert predictions.five_km_sec is None
    assert predictions.ten_km_sec is None
    assert predictions.half_marathon_sec is None
    assert predictions.marathon_sec == 12840


def test_extract_race_predictions_supports_distance_list_shape():
    predictions = extract_race_predictions(
        {
            "timePredictions": [
                {"distance": 5000, "time": 1273},
                {"distance": 10000, "predictedTime": 2721},
                {"distance": 21097.5, "timeSeconds": 6167},
                {"distance": 42195, "time": 12840},
            ]
        }
    )

    assert predictions is not None
    assert predictions.five_km_sec == 1273
    assert predictions.ten_km_sec == 2721
    assert predictions.half_marathon_sec == 6167
    assert predictions.marathon_sec == 12840


def test_garmin_client_wrapper_delegates_race_predictions():
    wrapper = GarminClientWrapper()
    api = MagicMock()
    api.get_race_predictions.return_value = {"time5K": 1273}
    wrapper.api = api

    assert wrapper.get_race_predictions() == {"time5K": 1273}
    api.get_race_predictions.assert_called_once_with()


def test_fetch_performance_targets_combines_race_predictions_and_body_composition():
    client = MagicMock()
    client.get_cycling_ftp.return_value = {}
    client.get_lactate_threshold.return_value = {}
    client.get_race_predictions.return_value = {"time5K": 1273, "timeMarathon": 12840}
    client.get_body_composition.return_value = {
        "dateWeightList": [
            {
                "weight": 90000,
                "bodyFat": 20.1,
                "calendarDate": "2026-08-23",
            }
        ]
    }
    client.get_heart_rate_zones.return_value = []

    result = GarminProviderAdapter(client).fetch_performance_targets()

    assert result.canonical.weight_kg == 90.0
    assert result.canonical.body_fat_pct == 20.1
    assert result.canonical.race_predictions is not None
    assert result.canonical.race_predictions.five_km_sec == 1273
    assert result.canonical.race_predictions.marathon_sec == 12840
    assert result.raw_payloads["race_predictions"] == {
        "time5K": 1273,
        "timeMarathon": 12840,
    }
