from unittest.mock import MagicMock

import pytest

from garmin_sync.google_health_auth import GoogleHealthAuthManager
from garmin_sync.google_health_client import (
    GoogleHealthAuthError,
    GoogleHealthClient,
)


def test_google_health_client_list_data_points_pagination() -> None:
    mock_auth = MagicMock(spec=GoogleHealthAuthManager)
    mock_auth.get_valid_access_token.return_value = "mock_token"

    mock_session = MagicMock()
    # Page 1 response
    page1_resp = MagicMock()
    page1_resp.status_code = 200
    page1_resp.json.return_value = {
        "dataPoints": [{"id": "pt1", "dataType": "sleep"}],
        "nextPageToken": "token2",
    }
    # Page 2 response
    page2_resp = MagicMock()
    page2_resp.status_code = 200
    page2_resp.json.return_value = {
        "dataPoints": [{"id": "pt2", "dataType": "sleep"}],
        "nextPageToken": None,
    }

    mock_session.request.side_effect = [page1_resp, page2_resp]

    client = GoogleHealthClient(auth_manager=mock_auth, session=mock_session)
    points = client.list_data_points("sleep", start_time_iso="2026-08-26T22:00:00Z")

    assert len(points) == 2
    assert points[0]["id"] == "pt1"
    assert points[1]["id"] == "pt2"
    assert mock_session.request.call_count == 2


def test_google_health_client_auth_error() -> None:
    mock_auth = MagicMock(spec=GoogleHealthAuthManager)
    mock_auth.get_valid_access_token.return_value = "mock_token"

    mock_session = MagicMock()
    resp = MagicMock()
    resp.status_code = 401
    mock_session.request.return_value = resp

    client = GoogleHealthClient(auth_manager=mock_auth, session=mock_session)
    with pytest.raises(GoogleHealthAuthError):
        client.list_data_points("sleep")


def test_google_health_client_daily_summary_sends_bounded_filter() -> None:
    """Daily-summary data types should query the API with an AIP-160 date filter
    scoped to the requested interval, not just filter locally after full pagination."""
    mock_auth = MagicMock(spec=GoogleHealthAuthManager)
    mock_auth.get_valid_access_token.return_value = "mock_token"

    mock_session = MagicMock()
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"dataPoints": [], "nextPageToken": None}
    mock_session.request.return_value = resp

    client = GoogleHealthClient(auth_manager=mock_auth, session=mock_session)
    client.list_data_points(
        "daily-heart-rate-variability",
        start_time_iso="2026-08-26T00:00:00Z",
        end_time_iso="2026-08-27T23:59:59Z",
    )

    sent_params = mock_session.request.call_args.kwargs["params"]
    assert sent_params["filter"] == (
        'dailyHeartRateVariability.date >= "2026-08-26" '
        'AND dailyHeartRateVariability.date < "2026-08-28"'
    )


def test_google_health_client_falls_back_when_filter_rejected() -> None:
    """A 400 on the filtered request retries once without the filter instead of
    failing ingestion outright."""
    mock_auth = MagicMock(spec=GoogleHealthAuthManager)
    mock_auth.get_valid_access_token.return_value = "mock_token"

    mock_session = MagicMock()
    rejected_resp = MagicMock()
    rejected_resp.status_code = 400
    rejected_resp.json.side_effect = ValueError("not json")
    rejected_resp.text = "invalid filter"

    ok_resp = MagicMock()
    ok_resp.status_code = 200
    ok_resp.json.return_value = {
        "dataPoints": [{"id": "pt1", "dataType": "dailyRestingHeartRate"}],
        "nextPageToken": None,
    }

    mock_session.request.side_effect = [rejected_resp, ok_resp]

    client = GoogleHealthClient(auth_manager=mock_auth, session=mock_session)
    points = client.list_data_points(
        "daily-resting-heart-rate",
        start_time_iso="2026-08-26T00:00:00Z",
        end_time_iso="2026-08-27T23:59:59Z",
    )

    assert len(points) == 1
    assert mock_session.request.call_count == 2
    first_params = mock_session.request.call_args_list[0].kwargs["params"]
    retry_params = mock_session.request.call_args_list[1].kwargs["params"]
    assert "filter" in first_params
    assert "filter" not in retry_params
