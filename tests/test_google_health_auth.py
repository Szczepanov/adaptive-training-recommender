import time
from unittest.mock import patch

from garmin_sync.google_health_auth import (
    GoogleHealthAuthManager,
    GoogleHealthTokenCredentials,
)


def test_auth_manager_valid_token_no_refresh():
    creds = GoogleHealthTokenCredentials(
        access_token="valid_token",
        refresh_token="ref_token",
        expires_at=time.time() + 1000,
    )
    auth = GoogleHealthAuthManager("client_id", "client_secret", creds)
    token = auth.get_valid_access_token()
    assert token == "valid_token"


@patch("requests.post")
def test_auth_manager_refresh_when_expired(mock_post):
    mock_post.return_value.status_code = 200
    mock_post.return_value.json.return_value = {
        "access_token": "new_access_token",
        "expires_in": 3600,
    }

    creds = GoogleHealthTokenCredentials(
        access_token="expired_token",
        refresh_token="ref_token",
        expires_at=time.time() - 10,
    )
    auth = GoogleHealthAuthManager("client_id", "client_secret", creds)
    token = auth.get_valid_access_token()

    assert token == "new_access_token"
    assert creds.access_token == "new_access_token"
    mock_post.assert_called_once()
