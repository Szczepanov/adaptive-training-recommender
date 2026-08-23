from unittest.mock import MagicMock, patch

import pytest
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)

from garmin_sync.garmin_client import GarminClientWrapper


def test_login_success_persists_via_single_call(tmp_path):
    """login() must be called exactly once, with the token file path, so garminconnect's
    own internal dump() (which only fires when a tokenstore path is passed) is the sole
    persistence mechanism -- no separate argless fallback call that would authenticate
    but silently fail to save anything to disk."""
    token_file = tmp_path / "garmin_tokens.json"

    with patch("garmin_sync.garmin_client.Garmin") as mock_garmin_cls:
        mock_instance = MagicMock()
        mock_garmin_cls.return_value = mock_instance

        wrapper = GarminClientWrapper(
            email="user@example.com",
            password="secret",
            allow_credential_login=True,
            verify_login=True,
        )
        wrapper.login_with_tokens_or_credentials(token_file)

        mock_garmin_cls.assert_called_once()
        assert mock_garmin_cls.call_args.kwargs["verify_login"] is True
        mock_instance.login.assert_called_once_with(str(token_file))


def test_login_propagates_rate_limit_untouched(tmp_path):
    """A 429 during login must surface as GarminConnectTooManyRequestsError, not get
    misclassified as an auth/token problem or trigger a second login attempt."""
    token_file = tmp_path / "garmin_tokens.json"

    with patch("garmin_sync.garmin_client.Garmin") as mock_garmin_cls:
        mock_instance = MagicMock()
        mock_instance.login.side_effect = GarminConnectTooManyRequestsError("rate limited")
        mock_garmin_cls.return_value = mock_instance

        wrapper = GarminClientWrapper(allow_credential_login=False)

        with pytest.raises(GarminConnectTooManyRequestsError):
            wrapper.login_with_tokens_or_credentials(token_file)

        mock_instance.login.assert_called_once_with(str(token_file))


def test_login_token_only_wraps_unexpected_failure_as_rebootstrap(tmp_path):
    """In token-only mode (allow_credential_login=False), a non-typed login failure
    (missing/invalid token, no credentials to fall back to) must be surfaced as a clear
    token_rebootstrap_required signal instead of an opaque exception."""
    token_file = tmp_path / "garmin_tokens.json"

    with patch("garmin_sync.garmin_client.Garmin") as mock_garmin_cls:
        mock_instance = MagicMock()
        mock_instance.login.side_effect = ValueError("no valid token and no credentials")
        mock_garmin_cls.return_value = mock_instance

        wrapper = GarminClientWrapper(allow_credential_login=False)

        with pytest.raises(GarminConnectAuthenticationError, match="token_rebootstrap_required"):
            wrapper.login_with_tokens_or_credentials(token_file)


def test_login_credential_mode_requires_email_and_password(tmp_path):
    token_file = tmp_path / "garmin_tokens.json"
    wrapper = GarminClientWrapper(email=None, password=None, allow_credential_login=True)

    with pytest.raises(RuntimeError, match="GARMIN_EMAIL"):
        wrapper.login_with_tokens_or_credentials(token_file)


def test_get_sleep_data_unauthenticated():
    wrapper = GarminClientWrapper(allow_credential_login=False)
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated. Call login first."):
        wrapper.get_sleep_data("2023-10-10")


def test_get_stats_unauthenticated():
    wrapper = GarminClientWrapper(allow_credential_login=False)
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated. Call login first."):
        wrapper.get_stats("2023-10-10")


def test_get_spo2_data_uses_supported_garmin_method():
    wrapper = GarminClientWrapper(allow_credential_login=False)
    wrapper.api = MagicMock()
    wrapper.api.get_spo2_data.return_value = {
        "calendarDate": "2026-08-23",
        "averageSpO2": 96.5,
        "lowestSpO2": 92.0,
    }

    result = wrapper.get_spo2_data("2026-08-23")

    assert result["averageSpO2"] == 96.5
    wrapper.api.get_spo2_data.assert_called_once_with("2026-08-23")


def test_get_spo2_data_does_not_hide_dependency_contract_failure():
    class ApiWithoutSpo2:
        pass

    wrapper = GarminClientWrapper(allow_credential_login=False)
    wrapper.api = ApiWithoutSpo2()  # type: ignore[assignment]

    with pytest.raises(AttributeError):
        wrapper.get_spo2_data("2026-08-23")


@pytest.mark.parametrize(
    "method_name",
    ["get_activity_power_zones", "get_activity_hr_zones", "get_activity_splits"],
)
def test_activity_detail_methods_require_login(method_name):
    wrapper = GarminClientWrapper(allow_credential_login=False)
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated"):
        getattr(wrapper, method_name)("123")


def test_activity_detail_methods_tolerate_empty_response():
    wrapper = GarminClientWrapper(allow_credential_login=False)
    wrapper.api = MagicMock()
    wrapper.api.get_activity_power_in_timezones.return_value = None
    wrapper.api.get_activity_hr_in_timezones.return_value = None
    wrapper.api.get_activity_splits.return_value = None

    assert wrapper.get_activity_power_zones("123") == []
    assert wrapper.get_activity_hr_zones("123") == []
    assert wrapper.get_activity_splits("123") == {}


def test_body_composition_methods():
    wrapper = GarminClientWrapper(allow_credential_login=False)
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated"):
        wrapper.get_body_composition("2026-08-01", "2026-08-23")

    with pytest.raises(RuntimeError, match="Garmin client is not authenticated"):
        wrapper.get_daily_weigh_ins("2026-08-23")

    wrapper.api = MagicMock()
    wrapper.api.get_body_composition.return_value = {"dateWeightList": [{"weight": 74500}]}
    wrapper.api.get_daily_weigh_ins.return_value = {"dateWeightList": [{"weight": 74500}]}

    assert wrapper.get_body_composition("2026-08-01", "2026-08-23") == {
        "dateWeightList": [{"weight": 74500}]
    }
    assert wrapper.get_daily_weigh_ins("2026-08-23") == {"dateWeightList": [{"weight": 74500}]}
