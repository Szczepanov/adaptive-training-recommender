import json
import sys
from unittest.mock import MagicMock, patch

import pytest

from garmin_sync.eight_sleep_probe import main


@patch("dotenv.load_dotenv")
@patch("garmin_sync.eight_sleep_probe.EightSleepSettings.from_env")
@patch("garmin_sync.eight_sleep_probe.EightSleepClient")
@patch("garmin_sync.eight_sleep_probe.map_trends_to_observation_batch")
@patch("garmin_sync.eight_sleep_probe.summarize_trends_shape")
@patch("builtins.print")
def test_main_success(
    mock_print: MagicMock,
    mock_summarize_trends_shape: MagicMock,
    mock_map_trends_to_observation_batch: MagicMock,
    mock_eight_sleep_client_class: MagicMock,
    mock_settings_from_env: MagicMock,
    mock_load_dotenv: MagicMock,
) -> None:
    # Setup mocks
    mock_settings = MagicMock()
    mock_settings.timezone = "America/New_York"
    mock_settings_from_env.return_value = mock_settings

    mock_client_instance = MagicMock()
    mock_client_instance.get_trends.return_value = {"mock": "payload"}
    mock_eight_sleep_client_class.return_value = mock_client_instance

    mock_observation1 = MagicMock()
    mock_observation1.metric = "heart_rate"
    mock_observation2 = MagicMock()
    mock_observation2.metric = "respiration_rate"

    mock_batch = MagicMock()
    mock_batch.observations = [mock_observation1, mock_observation2]
    mock_map_trends_to_observation_batch.return_value = mock_batch

    mock_summarize_trends_shape.return_value = {
        "dayCount": 2,
        "availableFields": ["heart_rate", "respiration_rate"],
    }

    test_args = ["eight_sleep_probe", "--date", "2023-10-27"]
    with patch.object(sys, "argv", test_args):
        result = main()

    # Assertions
    assert result == 0

    mock_load_dotenv.assert_called_once()
    mock_settings_from_env.assert_called_once()
    mock_eight_sleep_client_class.assert_called_once_with(mock_settings)

    mock_client_instance.get_trends.assert_called_once_with(
        from_date="2023-10-26",
        to_date="2023-10-28",
        timezone="America/New_York",
    )

    mock_map_trends_to_observation_batch.assert_called_once_with(
        {"mock": "payload"},
        logical_date="2023-10-27",
        timezone="America/New_York",
    )

    mock_summarize_trends_shape.assert_called_once_with({"mock": "payload"})

    mock_print.assert_called_once()
    printed_json = mock_print.call_args[0][0]
    printed_data = json.loads(printed_json)

    assert printed_data == {
        "authenticated": True,
        "targetDate": "2023-10-27",
        "returnedDayCount": 2,
        "availableFields": ["heart_rate", "respiration_rate"],
        "canonicalMetrics": ["heart_rate", "respiration_rate"],
        "targetObservationCount": 2,
        "provider": "eight_sleep",
        "transport": "eight_sleep_direct",
    }


@patch("dotenv.load_dotenv")
def test_main_missing_args(mock_load_dotenv: MagicMock) -> None:
    test_args = ["eight_sleep_probe"]
    with patch.object(sys, "argv", test_args):
        with pytest.raises(SystemExit):
            main()
