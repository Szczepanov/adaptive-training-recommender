from unittest.mock import MagicMock

import pytest

from garmin_sync.google_health_auth import GoogleHealthAuthManager
from garmin_sync.google_health_client import (
    GoogleHealthAuthError,
    GoogleHealthClient,
)


def test_google_health_client_list_data_points_pagination():
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


def test_google_health_client_auth_error():
    mock_auth = MagicMock(spec=GoogleHealthAuthManager)
    mock_auth.get_valid_access_token.return_value = "mock_token"

    mock_session = MagicMock()
    resp = MagicMock()
    resp.status_code = 401
    mock_session.request.return_value = resp

    client = GoogleHealthClient(auth_manager=mock_auth, session=mock_session)
    with pytest.raises(GoogleHealthAuthError):
        client.list_data_points("sleep")
