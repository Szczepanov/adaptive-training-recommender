from unittest.mock import MagicMock, call, patch

import pytest
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectInvalidFileFormatError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

from garmin_sync.garmin_client import GarminClientConfig, GarminClientWrapper


def test_garmin_client_config_initialization():
    config = GarminClientConfig(
        email="user@example.com",
        password="password123",
        retry_attempts=5,
        verify_login=False,
        allow_credential_login=True,
    )
    wrapper = GarminClientWrapper(config=config)
    assert wrapper.config == config
    assert wrapper.email == "user@example.com"
    assert wrapper.password == "password123"
    assert wrapper.retry_attempts == 5
    assert wrapper.verify_login is False
    assert wrapper.allow_credential_login is True


def test_backfill_paces_each_wrapper_request_including_activity_pages(monkeypatch):
    clock = [100.0]
    sleeps = []
    monkeypatch.setattr("garmin_sync.garmin_client.time.monotonic", lambda: clock[0])

    def sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr("garmin_sync.garmin_client.time.sleep", sleep)
    monkeypatch.setattr("garmin_sync.garmin_client.random.uniform", lambda low, high: low)
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activities.side_effect = [[{"startTimeLocal": "2026-08-10"}], []]
    wrapper.configure_backfill_pacing(1.5, 4.0)

    wrapper.get_stats("2026-08-10")
    wrapper.get_activities_window("2026-08-10", "2026-08-10")
    assert sleeps == [1.5, 1.5]
    wrapper.configure_backfill_pacing(0.0, 0.0)
    wrapper.get_stats("2026-08-11")
    assert sleeps == [1.5, 1.5]


@pytest.mark.parametrize(
    "error,response_status",
    [
        (GarminConnectConnectionError("API Error 429 - Too Many Requests"), None),
        (GarminConnectConnectionError("wrapped HTTP error"), 429),
    ],
)
def test_wrapped_http_429_becomes_typed_rate_limit_error(error, response_status):
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_stats.side_effect = error
    if response_status is not None:
        error.response = MagicMock(status_code=response_status)

    with pytest.raises(GarminConnectTooManyRequestsError):
        wrapper.get_stats("2026-08-10")


def test_wrapped_non_429_http_error_remains_connection_error():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_stats.side_effect = GarminConnectConnectionError("API Error 403 - Forbidden")

    with pytest.raises(GarminConnectConnectionError):
        wrapper.get_stats("2026-08-10")


def test_get_activities_window_filters_paginated_plain_list_response():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activities.side_effect = [
        [
            {"activityId": 3, "startTimeLocal": "2026-08-23 09:00:00"},
            {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"},
        ],
        [{"activityId": 1, "startTimeLocal": "2026-08-20 09:00:00"}],
    ]

    result = wrapper.get_activities_window("2026-08-21", "2026-08-23")

    assert result == [
        {"activityId": 3, "startTimeLocal": "2026-08-23 09:00:00"},
        {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"},
    ]
    assert wrapper.api.get_activities.call_args_list == [
        call(0, 100),
        call(100, 100),
    ]


def test_get_activities_window_accepts_activity_list_envelope():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activities.side_effect = [
        {
            "activityList": [
                {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"},
                {"activityId": 1, "startTimeLocal": "2026-08-20 09:00:00"},
            ]
        }
    ]

    assert wrapper.get_activities_window("2026-08-21", "2026-08-23") == [
        {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"}
    ]


def test_get_activities_window_ignores_malformed_activity_entries():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activities.side_effect = [
        [
            "not-an-activity",
            {"activityId": 1, "startTimeLocal": None},
            {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"},
        ],
        [],
    ]

    assert wrapper.get_activities_window("2026-08-21", "2026-08-23") == [
        {"activityId": 2, "startTimeLocal": "2026-08-22 09:00:00"}
    ]


@pytest.mark.parametrize("response", [{"activityList": "not-a-list"}, {"other": []}, None, "bad"])
def test_get_activities_window_ignores_malformed_response_envelopes(response):
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activities.return_value = response

    assert wrapper.get_activities_window("2026-08-21", "2026-08-23") == []


def test_login_success_persists_via_single_call(tmp_path):
    """login() must be called exactly once, with the token file path, so garminconnect's
    own internal dump() (which only fires when a tokenstore path is passed) is the sole
    persistence mechanism -- no separate argless fallback call that would authenticate
    but silently fail to save anything to disk."""
    token_file = tmp_path / "garmin_tokens.json"

    with patch("garmin_sync.garmin_client.Garmin") as mock_garmin_cls:
        mock_instance = MagicMock()
        mock_garmin_cls.return_value = mock_instance

        config = GarminClientConfig(
            email="user@example.com",
            password="secret",
            allow_credential_login=True,
            verify_login=True,
        )
        wrapper = GarminClientWrapper(config=config)
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

        wrapper = GarminClientWrapper()

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

        wrapper = GarminClientWrapper()

        with pytest.raises(GarminConnectAuthenticationError, match="token_rebootstrap_required"):
            wrapper.login_with_tokens_or_credentials(token_file)


def test_login_credential_mode_requires_email_and_password(tmp_path):
    token_file = tmp_path / "garmin_tokens.json"
    config = GarminClientConfig(email=None, password=None, allow_credential_login=True)
    wrapper = GarminClientWrapper(config=config)

    with pytest.raises(RuntimeError, match="GARMIN_EMAIL"):
        wrapper.login_with_tokens_or_credentials(token_file)


def test_get_sleep_data_unauthenticated():
    wrapper = GarminClientWrapper()
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated. Call login first."):
        wrapper.get_sleep_data("2023-10-10")


def test_get_stats_unauthenticated():
    wrapper = GarminClientWrapper()
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated. Call login first."):
        wrapper.get_stats("2023-10-10")


def test_get_spo2_data_uses_supported_garmin_method():
    wrapper = GarminClientWrapper()
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

    wrapper = GarminClientWrapper()
    wrapper.api = ApiWithoutSpo2()  # type: ignore[assignment]

    with pytest.raises(AttributeError):
        wrapper.get_spo2_data("2026-08-23")


@pytest.mark.parametrize(
    "method_name",
    ["get_activity_power_zones", "get_activity_hr_zones", "get_activity_splits"],
)
def test_activity_detail_methods_require_login(method_name):
    wrapper = GarminClientWrapper()
    with pytest.raises(RuntimeError, match="Garmin client is not authenticated"):
        getattr(wrapper, method_name)("123")


def test_activity_detail_methods_tolerate_empty_response():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.get_activity_power_in_timezones.return_value = None
    wrapper.api.get_activity_hr_in_timezones.return_value = None
    wrapper.api.get_activity_splits.return_value = None

    assert wrapper.get_activity_power_zones("123") == []
    assert wrapper.get_activity_hr_zones("123") == []
    assert wrapper.get_activity_splits("123") == {}


def test_download_activity_original_uses_verified_upstream_enum():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.download_activity.return_value = b"original-bytes"

    assert wrapper.download_activity_original("123") == b"original-bytes"
    wrapper.api.download_activity.assert_called_once_with(
        "123", dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
    )


def test_download_activity_original_returns_none_only_for_not_found():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.download_activity.side_effect = GarminConnectNotFoundError("not found")

    assert wrapper.download_activity_original("123") is None


@pytest.mark.parametrize(
    "error", [GarminConnectAuthenticationError("auth"), GarminConnectTooManyRequestsError("rate")]
)
def test_download_activity_original_preserves_operational_errors(error):
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.download_activity.side_effect = error

    with pytest.raises(type(error)):
        wrapper.download_activity_original("123")


def test_download_activity_original_rejects_non_binary_success():
    wrapper = GarminClientWrapper()
    wrapper.api = MagicMock()
    wrapper.api.download_activity.return_value = None

    with pytest.raises(GarminConnectInvalidFileFormatError):
        wrapper.download_activity_original("123")


def test_body_composition_methods():
    wrapper = GarminClientWrapper()
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
