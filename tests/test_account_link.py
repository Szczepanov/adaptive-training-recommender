from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import garmin_sync.account_link as account_link_module
from garmin_sync.account_link import GarminAccountLinkService, PendingLoginStore


class FakeGarminClient:
    def __init__(self) -> None:
        self.dumped_paths: list[str] = []

    def dump(self, path: str) -> None:
        self.dumped_paths.append(path)
        Path(path).write_text("{}", encoding="utf-8")


class FakeGarmin:
    def __init__(self, *, needs_mfa: bool, **kwargs: Any) -> None:
        assert kwargs["return_on_mfa"] is True
        assert kwargs["retry_attempts"] == 1
        assert "verify_login" not in kwargs
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

    def finalize(
        api: Any,
        token_path: Path,
        temp_dir: Path,
        requested_uid: str | None,
    ) -> dict[str, Any]:
        assert api.password is None
        assert api.client.dumped_paths == [str(token_path)]
        assert token_path.exists()
        assert temp_dir.exists()
        assert requested_uid == "existing-uid"
        return {"status": "authenticated", "customToken": "token", "isNewUser": False}

    monkeypatch.setattr(service, "_finalize", finalize)
    result = service.start_login(
        "person@example.com",
        "secret",
        requested_uid="existing-uid",
    )

    assert result["status"] == "authenticated"
    assert created[0].password is None


def test_mfa_challenge_keeps_session_but_not_plaintext_password(
    monkeypatch: Any,
) -> None:
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

    def finalize(
        api: Any,
        token_path: Path,
        _temp_dir: Path,
        requested_uid: str | None,
    ) -> dict[str, Any]:
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

    def factory(**kwargs: Any) -> FakeGarmin:
        return FakeGarmin(needs_mfa=True, **kwargs)

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    now[0] = 106.0

    with pytest.raises(Exception, match="expired"):
        service.complete_mfa(str(first["challengeId"]), "123456")


def test_mutable_display_name_is_not_accepted_as_account_identity() -> None:
    class DisplayNameOnlyGarmin:
        def connectapi(self, _path: str) -> dict[str, str]:
            return {"displayName": "renameable-handle"}

    with pytest.raises(Exception, match="no stable account identity"):
        account_link_module._garmin_identity(  # noqa: SLF001 - identity contract regression
            DisplayNameOnlyGarmin()  # type: ignore[arg-type]
        )


def test_link_commit_failure_removes_uploaded_token(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    class Repository:
        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> None:
            raise account_link_module.GarminLinkConflictError("conflicting link")

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    service = GarminAccountLinkService(
        "bucket",
        repository=Repository(),  # type: ignore[arg-type]
    )
    deleted_objects: list[str] = []
    monkeypatch.setattr(service, "_delete_token_object", deleted_objects.append)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    with pytest.raises(account_link_module.GarminLinkConflictError, match="conflicting link"):
        service._finalize(  # noqa: SLF001 - regression test for rollback boundary
            FinalizableGarmin(),  # type: ignore[arg-type]
            token_path,
            temp_dir,
            "existing-uid",
        )

    assert deleted_objects == ["garmin/users/existing-uid/garmin_tokens.json"]


def test_custom_token_failure_after_commit_keeps_new_user_for_retry(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    class Repository:
        committed = False

        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> None:
            self.committed = True

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    repository = Repository()
    deleted_uids: list[str] = []
    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_user",
        lambda: SimpleNamespace(uid="new-uid"),
    )
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "delete_user",
        deleted_uids.append,
    )

    def fail_custom_token(_uid: str) -> bytes:
        raise RuntimeError("temporary signer failure")

    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_custom_token",
        fail_custom_token,
    )

    service = GarminAccountLinkService(
        "bucket",
        repository=repository,  # type: ignore[arg-type]
    )
    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    with pytest.raises(RuntimeError, match="temporary signer failure"):
        service._finalize(  # noqa: SLF001 - regression test for transactional boundary
            FinalizableGarmin(),  # type: ignore[arg-type]
            token_path,
            temp_dir,
            None,
        )

    assert repository.committed is True
    assert deleted_uids == []
