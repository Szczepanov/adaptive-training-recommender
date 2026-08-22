from __future__ import annotations

import pytest

from garmin_sync.config import load_settings, load_settings_for_user


@pytest.fixture(autouse=True)
def clean_user_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "APP_USER_ID",
        "APP_USER_IDS",
        "GARMIN_TOKEN_PATH",
        "GARMIN_TOKENS",
        "GARMIN_TOKEN_OBJECT",
        "GARMIN_ARCHIVE_LOCAL_DIR",
        "GARMIN_ARCHIVE_PREFIX",
        "GARMIN_EMAIL",
        "GARMIN_PASSWORD",
        "GARMIN_ALLOW_CREDENTIAL_LOGIN",
    ):
        monkeypatch.delenv(key, raising=False)


def test_linked_user_settings_isolate_token_and_archive_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")
    monkeypatch.setenv("GARMIN_EMAIL", "must-not-enter-scheduled-job@example.com")
    monkeypatch.setenv("GARMIN_PASSWORD", "must-not-enter-scheduled-job")
    monkeypatch.setenv("GARMIN_ALLOW_CREDENTIAL_LOGIN", "true")

    alpha = load_settings_for_user("alpha")
    beta = load_settings_for_user("beta")

    assert alpha.app_user_id == "alpha"
    assert beta.app_user_id == "beta"
    assert alpha.garmin_token_path == ".garmin_tokens/alpha/garmin_tokens.json"
    assert beta.garmin_token_path == ".garmin_tokens/beta/garmin_tokens.json"
    assert alpha.garmin_token_object == "garmin/users/alpha/garmin_tokens.json"
    assert beta.garmin_token_object == "garmin/users/beta/garmin_tokens.json"
    assert alpha.garmin_archive_local_dir == ".garmin_archive/alpha"
    assert beta.garmin_archive_local_dir == ".garmin_archive/beta"
    assert alpha.garmin_archive_prefix == "raw/garmin/users/alpha"
    assert beta.garmin_archive_prefix == "raw/garmin/users/beta"
    assert alpha.garmin_email is None
    assert alpha.garmin_password is None
    assert alpha.garmin_allow_credential_login is False


def test_linked_user_settings_preserve_exact_uid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    settings = load_settings_for_user(" alpha ")

    assert settings.app_user_id == " alpha "
    assert settings.garmin_token_path == ".garmin_tokens/ alpha /garmin_tokens.json"
    assert settings.garmin_token_object == "garmin/users/ alpha /garmin_tokens.json"
    assert settings.garmin_archive_local_dir == ".garmin_archive/ alpha "
    assert settings.garmin_archive_prefix == "raw/garmin/users/ alpha "


def test_linked_user_settings_reject_whitespace_only_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    with pytest.raises(ValueError, match="cannot be blank"):
        load_settings_for_user("   ")


def test_linked_user_settings_ignore_shared_token_path_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")
    monkeypatch.setenv("GARMIN_TOKEN_PATH", "/tmp/shared-token.json")
    monkeypatch.setenv("GARMIN_TOKEN_OBJECT", "shared/object.json")

    settings = load_settings_for_user("linked-user")

    assert settings.garmin_token_path == ".garmin_tokens/linked-user/garmin_tokens.json"
    assert settings.garmin_token_object == "garmin/users/linked-user/garmin_tokens.json"


def test_linked_user_settings_use_committed_token_object_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    settings = load_settings_for_user(
        "linked-user", token_object="garmin/users/linked-user/garmin_tokens-abc123.json"
    )

    assert settings.garmin_token_object == "garmin/users/linked-user/garmin_tokens-abc123.json"


def test_linked_user_settings_fall_back_to_canonical_object_without_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    settings = load_settings_for_user("linked-user", token_object=None)

    assert settings.garmin_token_object == "garmin/users/linked-user/garmin_tokens.json"


def test_linked_user_settings_reject_default_uid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    with pytest.raises(ValueError, match="default_user"):
        load_settings_for_user("default_user")


def test_single_user_load_settings_preserves_legacy_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_USER_ID", "legacy-user")
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")
    monkeypatch.setenv("GARMIN_TOKEN_PATH", "/tmp/legacy-token.json")
    monkeypatch.setenv("GARMIN_TOKEN_OBJECT", "legacy/object.json")

    settings = load_settings()

    assert settings.app_user_id == "legacy-user"
    assert settings.garmin_token_path == "/tmp/legacy-token.json"
    assert settings.garmin_token_object == "legacy/object.json"


def test_single_user_command_still_requires_app_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    with pytest.raises(ValueError, match="APP_USER_ID"):
        load_settings()
