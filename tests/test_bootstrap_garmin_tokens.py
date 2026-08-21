from pathlib import Path
from types import SimpleNamespace

import bootstrap_garmin_tokens
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


class _StubGarminClientWrapper:
    """Login succeeds and writes a token file, without touching the real Garmin API."""

    def __init__(self, **_kwargs) -> None:
        pass

    def login_with_tokens_or_credentials(self, token_path: Path) -> None:
        token_path = Path(token_path)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text("{}")


class _StubGcsTokenStoreUploadFails:
    """Mirrors a GcsTokenStore.persist() that ran into e.g. a 403 from a missing IAM
    binding -- returns False rather than raising, same as the real implementation."""

    def __init__(self, bucket_name: str, object_name: str) -> None:
        self.bucket_name = bucket_name
        self.object_name = object_name

    def persist(self, source: Path) -> bool:
        return False


def test_bootstrap_raises_when_gcs_upload_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A failed upload must fail the script loudly (see token_store.py's persist()) instead
    of printing 'Token bootstrap completed successfully!' with no token actually in GCS."""
    settings = SimpleNamespace(
        garmin_token_path=str(tmp_path / "tokens.json"),
        garmin_email="user@example.com",
        garmin_password="secret",
        garmin_token_bucket=None,
    )
    monkeypatch.setattr(bootstrap_garmin_tokens, "load_settings", lambda: settings)
    monkeypatch.setattr(bootstrap_garmin_tokens, "GarminClientWrapper", _StubGarminClientWrapper)
    monkeypatch.setattr(bootstrap_garmin_tokens, "GcsTokenStore", _StubGcsTokenStoreUploadFails)

    with pytest.raises(RuntimeError, match="Upload to gs://my-bucket"):
        bootstrap_garmin_tokens.bootstrap(bucket_name="my-bucket")
