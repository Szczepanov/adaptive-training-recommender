import pytest

from garmin_sync.eight_sleep_config import EightSleepConfigurationError, EightSleepSettings


def test_disabled_settings_do_not_require_secrets() -> None:
    EightSleepSettings(enabled=False).validate()


def test_enabled_settings_require_secrets() -> None:
    with pytest.raises(EightSleepConfigurationError, match="EIGHT_SLEEP_CLIENT_SECRET"):
        EightSleepSettings(enabled=True, email="a@b.test", password="x", client_id="id").validate()
