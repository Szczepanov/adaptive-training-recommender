from __future__ import annotations

from pathlib import Path
from typing import Any

from garmin_sync.account_link import GarminAccountLinkService, PendingLoginStore


class FakeGarminClient:
    def __init__(self) -> None:
        self.dumped_paths: list[str] = []

    def dump(self, path: str) -> None:
        self.dumped_paths.append(path)
        Path(path).write_text("{}", encoding="utf-8")


class FakeGarmin:
    def __init__(self, *, needs_mfa: bool, **kwargs: Any) -> None:
        self.password = kwargs.get("password")
        self.needs_mfa = needs_mfa
        self.client = FakeGarminClient()
        self.resumed_codes: list[str] = []

    def login(self, _token_path: str) -> tuple[str | None, None]:
        return ("needs_mfa", None) if self.needs_mfa else (None, None)

    def resume_login(self, _client_state: dict[str, Any], code: str) -> tuple[None, None]:
        self.resumed_codes.append(code)
        return None, None


class DummyRepository:
    pass


def test_clean_login_dumps_tokens_and_clears_password_before_finalize(
    monkeypatch: Any,
) -> None:
    created: list[FakeGarmin] = []

    def factory(**kwargs: Any) -> FakeGarmin:
        api = FakeGarmin(needs_mfa=False, **kwargs)
        created.append(api)
        return api

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    def finalize(api: Any, token_path: Path, temp_dir: Path, requested_uid: str | None) -> dict[str, Any]:
        assert api.password is None
        assert api.client.dumped_paths == [str(token_path)]
        assert token_path.exists()
        assert temp_dir.exists()
        assert requested_uid == "existing-uid"
        return {"status": "authenticated", "customToken": "token", "isNewUser": False}

    monkeypatch.setattr(service, "_finalize", finalize)
    result = service.start_login("person@example.com", "secret", requested_uid="existing-uid")

    assert result["status"] == "authenticated"
    assert created[0].password is None


def test_mfa_challenge_keeps_session_but_not_plaintext_password(monkeypatch: Any) -> None:
    created: list[FakeGarmin] = []

    def factory(**kwargs: Any) -> FakeGarmin:
        api = FakeGarmin(needs_mfa=True, **kwargs)
        created.append(api)
        return api

    store = PendingLoginStore(ttl_seconds=300)
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    def finalize(api: Any, token_path: Path, _temp_dir: Path, requested_uid: str | None) -> dict[str, Any]:
        assert api.password is None
        assert api.client.dumped_paths == [str(token_path)]
        assert requested_uid is None
        return {"status": "authenticated", "customToken": "new-token", "isNewUser": True}

    monkeypatch.setattr(service, "_finalize", finalize)
    first = service.start_login("person@example.com", "secret")

    assert first["status"] == "mfa_required"
    assert created[0].password is None
    challenge_id = str(first["challengeId"])

    second = service.complete_mfa(challenge_id, "123456")

    assert second["status"] == "authenticated"
    assert created[0].resumed_codes == ["123456"]


def test_expired_mfa_challenge_is_rejected() -> None:
    now = [100.0]
    store = PendingLoginStore(ttl_seconds=5, clock=lambda: now[0])
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=lambda **kwargs: FakeGarmin(needs_mfa=True, **kwargs),  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    now[0] = 106.0

    try:
        service.complete_mfa(str(first["challengeId"]), "123456")
    except Exception as exc:
        assert "expired" in str(exc).lower()
    else:
        raise AssertionError("expired MFA challenge should fail")
