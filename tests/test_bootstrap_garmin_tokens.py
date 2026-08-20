import pyotp
import pytest
from bootstrap_garmin_tokens import _mfa_prompt


def test_mfa_prompt_computes_live_totp_code_when_secret_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = pyotp.random_base32()
    monkeypatch.setenv("GARMIN_TOTP_SECRET", secret)
    monkeypatch.delenv("GARMIN_MFA_CODE", raising=False)

    prompt = _mfa_prompt()

    assert prompt() == pyotp.TOTP(secret).now()


def test_mfa_prompt_falls_back_to_pre_supplied_code(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GARMIN_TOTP_SECRET", raising=False)
    monkeypatch.setenv("GARMIN_MFA_CODE", "123456")

    prompt = _mfa_prompt()

    assert prompt() == "123456"


def test_mfa_prompt_prefers_totp_secret_over_pre_supplied_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A live-computed code is never stale; a pre-typed one can already be expired by the
    # time this is reached, so the secret path takes priority when both are present.
    secret = pyotp.random_base32()
    monkeypatch.setenv("GARMIN_TOTP_SECRET", secret)
    monkeypatch.setenv("GARMIN_MFA_CODE", "000000")

    prompt = _mfa_prompt()

    assert prompt() == pyotp.TOTP(secret).now()


def test_mfa_prompt_falls_back_to_input_when_neither_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GARMIN_TOTP_SECRET", raising=False)
    monkeypatch.delenv("GARMIN_MFA_CODE", raising=False)
    monkeypatch.setattr("builtins.input", lambda _prompt: "654321")

    prompt = _mfa_prompt()

    assert prompt() == "654321"
