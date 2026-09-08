from unittest.mock import MagicMock

import pytest

from garmin_sync.canonical import ObservationBatch
from garmin_sync.google_health_client import GoogleHealthClient
from garmin_sync.google_health_mapper import GoogleHealthMapper
from garmin_sync.google_health_provider import (
    GoogleHealthProvider,
    _extract_pt_date,
)


def test_extract_pt_date_daily_summary() -> None:
    pt = {"dailyHeartRateVariability": {"date": {"year": 2026, "month": 8, "day": 26}}}
    assert _extract_pt_date(pt) == "2026-08-26"


def test_extract_pt_date_sleep_interval() -> None:
    pt = {
        "sleep": {
            "interval": {
                "startTime": "2026-08-26T22:00:00Z",
                "endTime": "2026-08-27T06:00:00Z",
            }
        }
    }
    assert _extract_pt_date(pt) == "2026-08-27"


def test_extract_pt_date_legacy_sleep_session() -> None:
    pt = {
        "sleepSession": {
            "startTime": "2026-08-26T22:00:00Z",
            "endTime": "2026-08-27T06:00:00Z",
        }
    }
    assert _extract_pt_date(pt) == "2026-08-27"


def test_extract_pt_date_root_timestamps() -> None:
    pt = {
        "startTime": "2026-08-26T22:00:00Z",
        "endTime": "2026-08-27T06:00:00Z",
    }
    assert _extract_pt_date(pt) == "2026-08-27"


def test_extract_pt_date_none() -> None:
    assert _extract_pt_date({}) is None
    assert _extract_pt_date({"some_other_key": "value"}) is None
    # Partially missing date keys should also return None for daily summary
    assert (
        _extract_pt_date({"dailyHeartRateVariability": {"date": {"month": 8, "day": 26}}}) is None
    )
    # No start or end time
    assert _extract_pt_date({"sleep": {"interval": {}}}) is None


def test_provider_fetch_observations_uses_cache() -> None:
    mock_client = MagicMock(spec=GoogleHealthClient)
    mock_mapper = MagicMock(spec=GoogleHealthMapper)
    provider = GoogleHealthProvider(client=mock_client, mapper=mock_mapper)

    mock_batch = MagicMock(spec=ObservationBatch)
    logical_date = "2026-08-27"
    provider._cache[logical_date] = mock_batch

    result = provider.fetch_observations(logical_date, "2026-08-26")
    assert result == mock_batch
    mock_client.list_data_points.assert_not_called()
    mock_mapper.normalize_data_points.assert_not_called()


def test_provider_clear_cache() -> None:
    provider = GoogleHealthProvider(client=MagicMock(), mapper=MagicMock())
    provider._cache["2026-08-27"] = MagicMock(spec=ObservationBatch)
    provider._raw_points_cache["key"] = [{"data": "point"}]

    provider.clear_cache()

    assert len(provider._cache) == 0
    assert len(provider._raw_points_cache) == 0


def test_provider_fetch_observations_success() -> None:
    mock_client = MagicMock(spec=GoogleHealthClient)
    # Give us one matching point and one non-matching point for sleep, and no points for HRV
    # The default data types are [sleep, daily-heart-rate-variability, daily-resting-heart-rate, daily-respiratory-rate]
    matching_pt = {
        "sleep": {
            "interval": {
                "startTime": "2026-08-26T22:00:00Z",
                "endTime": "2026-08-27T06:00:00Z",
            }
        }
    }
    non_matching_pt = {
        "sleep": {
            "interval": {
                "startTime": "2026-08-25T22:00:00Z",
                "endTime": "2026-08-26T06:00:00Z",
            }
        }
    }

    def side_effect(data_type: str, start_time_iso: str, end_time_iso: str) -> list[dict]:
        if data_type == "sleep":
            return [matching_pt, non_matching_pt]
        return []

    mock_client.list_data_points.side_effect = side_effect

    mock_mapper = MagicMock(spec=GoogleHealthMapper)
    mock_batch = MagicMock(spec=ObservationBatch)
    mock_mapper.normalize_data_points.return_value = mock_batch

    provider = GoogleHealthProvider(client=mock_client, mapper=mock_mapper)
    result = provider.fetch_observations("2026-08-27", "2026-08-26")

    # Assert correct response
    assert result == mock_batch

    # Assert client was called for each data type with correct bounds
    assert mock_client.list_data_points.call_count == 4
    for dtype in provider.data_types:
        mock_client.list_data_points.assert_any_call(
            data_type=dtype,
            start_time_iso="2026-08-26T00:00:00Z",
            end_time_iso="2026-08-27T23:59:59Z",
        )

    # Assert mapper was called ONLY with the matching point
    mock_mapper.normalize_data_points.assert_called_once_with(
        [matching_pt], target_logical_date="2026-08-27"
    )


def test_provider_fetch_observations_propagates_error() -> None:
    mock_client = MagicMock(spec=GoogleHealthClient)
    mock_client.list_data_points.side_effect = ValueError("Network failure")

    mock_mapper = MagicMock(spec=GoogleHealthMapper)

    provider = GoogleHealthProvider(client=mock_client, mapper=mock_mapper)
    with pytest.raises(ValueError, match="Network failure"):
        provider.fetch_observations("2026-08-27", "2026-08-26")
