import pytest

from garmin_sync.config import (
    Settings,
    _scoped_for_user,
    load_settings,
    load_settings_for_user,
)


def test_settings_initialization_success() -> None:
    settings = Settings(app_user_id="test_user")
    assert settings.app_user_id == "test_user"
    assert settings.app_timezone == "Europe/Warsaw"
    # Should not raise
    settings.validate()


def test_settings_validation_fails_empty_user() -> None:
    for invalid_user in ("", "   ", None):
        # We need to bypass typing for None case
        settings = Settings(app_user_id=invalid_user)  # type: ignore
        with pytest.raises(ValueError, match="APP_USER_ID is required"):
            settings.validate()


def test_settings_validation_fails_default_user() -> None:
    settings = Settings(app_user_id="default_user")
    with pytest.raises(ValueError, match="APP_USER_ID cannot be 'default_user'"):
        settings.validate()


def test_settings_validation_invalid_timezone() -> None:
    settings = Settings(app_user_id="test_user", app_timezone="Invalid/Timezone")
    with pytest.raises(ValueError, match="Invalid APP_TIMEZONE 'Invalid/Timezone'"):
        settings.validate()


def test_settings_validation_negative_backfill_delays() -> None:
    settings = Settings(
        app_user_id="test_user",
        garmin_backfill_delay_min_seconds=-1.0,
        garmin_backfill_delay_max_seconds=2.0,
    )
    with pytest.raises(ValueError, match="must not be negative"):
        settings.validate()

    settings = Settings(
        app_user_id="test_user",
        garmin_backfill_delay_min_seconds=1.0,
        garmin_backfill_delay_max_seconds=-2.0,
    )
    with pytest.raises(ValueError, match="must not be negative"):
        settings.validate()


def test_settings_validation_backfill_delays_min_greater_than_max() -> None:
    settings = Settings(
        app_user_id="test_user",
        garmin_backfill_delay_min_seconds=5.0,
        garmin_backfill_delay_max_seconds=3.0,
    )
    with pytest.raises(ValueError, match="must not exceed"):
        settings.validate()


def test_settings_validation_gcs_token_missing_bucket() -> None:
    settings = Settings(
        app_user_id="test_user",
        garmin_token_store="gcs",
        garmin_token_bucket=None,
    )
    with pytest.raises(ValueError, match="GARMIN_TOKEN_BUCKET is required"):
        settings.validate()


def test_settings_validation_gcs_archive_missing_bucket() -> None:
    settings = Settings(
        app_user_id="test_user",
        garmin_archive_enabled=True,
        garmin_archive_store="gcs",
        garmin_archive_bucket=None,
        garmin_token_bucket=None,
    )
    with pytest.raises(ValueError, match="GARMIN_ARCHIVE_BUCKET \\(or GARMIN_TOKEN_BUCKET"):
        settings.validate()


def test_resolved_archive_bucket() -> None:
    # Uses garmin_archive_bucket if present
    settings_with_archive_bucket = Settings(
        app_user_id="test_user",
        garmin_archive_bucket="my-archive-bucket",
        garmin_token_bucket="my-token-bucket",
    )
    assert settings_with_archive_bucket.resolved_archive_bucket() == "my-archive-bucket"

    # Falls back to garmin_token_bucket
    settings_with_token_bucket = Settings(
        app_user_id="test_user",
        garmin_archive_bucket=None,
        garmin_token_bucket="my-fallback-bucket",
    )
    assert settings_with_token_bucket.resolved_archive_bucket() == "my-fallback-bucket"

    # Returns None if neither are present
    settings_no_buckets = Settings(
        app_user_id="test_user",
        garmin_archive_bucket=None,
        garmin_token_bucket=None,
    )
    assert settings_no_buckets.resolved_archive_bucket() is None


def test_scoped_for_user() -> None:
    settings = Settings(
        app_user_id="user_123",
        garmin_email="test@example.com",
        garmin_password="secretpassword",
        garmin_allow_credential_login=True,
    )
    scoped_settings = _scoped_for_user(settings)

    # Scoped paths
    assert scoped_settings.garmin_token_path == ".garmin_tokens/user_123/garmin_tokens.json"
    assert scoped_settings.garmin_token_object == "garmin/users/user_123/garmin_tokens.json"
    assert scoped_settings.garmin_archive_local_dir == ".garmin_archive/user_123"
    assert scoped_settings.garmin_archive_prefix == "raw/garmin/users/user_123"

    # Credentials removed
    assert scoped_settings.garmin_email is None
    assert scoped_settings.garmin_password is None
    assert scoped_settings.garmin_allow_credential_login is False

    # Original fields preserved
    assert scoped_settings.app_user_id == "user_123"


def test_load_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    # Test missing APP_USER_ID
    monkeypatch.setattr("garmin_sync.config.load_dotenv", lambda **kwargs: None)
    monkeypatch.delenv("APP_USER_ID", raising=False)
    with pytest.raises(ValueError, match="APP_USER_ID is required for this single-user command"):
        load_settings()

    # Test loading with env var
    monkeypatch.setenv("APP_USER_ID", "env_user")
    monkeypatch.setenv("GARMIN_TOKEN_BUCKET", "env-bucket")
    settings = load_settings()
    assert settings.app_user_id == "env_user"
    assert settings.garmin_token_bucket == "env-bucket"


def test_load_settings_for_user() -> None:
    # Test blank user
    with pytest.raises(ValueError, match="linked Firebase user ID cannot be blank"):
        load_settings_for_user("")

    # Test successful load and scoping
    settings = load_settings_for_user("my_user")
    assert settings.app_user_id == "my_user"
    assert settings.garmin_token_path == ".garmin_tokens/my_user/garmin_tokens.json"

    # Test with overridden token_object
    settings_override = load_settings_for_user("my_user", token_object="custom/path.json")
    assert settings_override.garmin_token_object == "custom/path.json"
