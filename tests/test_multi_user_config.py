from __future__ import annotations

import pytest

from garmin_sync.config import load_settings, load_user_ids, load_user_settings


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
    ):
        monkeypatch.delenv(key, raising=False)


def test_load_user_ids_prefers_ordered_deduplicated_multi_user_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_USER_ID", "legacy")
    monkeypatch.setenv("APP_USER_IDS", " alpha, beta,alpha ,, gamma ")

    assert load_user_ids() == ["alpha", "beta", "gamma"]


def test_load_user_ids_falls_back_to_legacy_single_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_USER_ID", "legacy-user")

    assert load_user_ids() == ["legacy-user"]


def test_load_user_ids_requires_a_real_uid(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="APP_USER_IDS"):
        load_user_ids()

    monkeypatch.setenv("APP_USER_IDS", "default_user")
    with pytest.raises(ValueError, match="default_user"):
        load_user_ids()


def test_multi_user_settings_isolate_token_and_archive_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_USER_IDS", "alpha,beta")
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")
    monkeypatch.setenv("GARMIN_EMAIL", "must-not-enter-scheduled-job@example.com")
    monkeypatch.setenv("GARMIN_PASSWORD", "must-not-enter-scheduled-job")

    alpha, beta = load_user_settings()

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


def test_single_user_command_rejects_ambiguous_multi_user_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_USER_IDS", "alpha,beta")
    monkeypatch.setenv("GARMIN_TOKEN_STORE", "local")

    with pytest.raises(ValueError, match="sync-all"):
        load_settings()
