from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

import garmin_sync.account_link as account_link_module
from garmin_sync.account_link import GarminAccountLinkService, PendingLoginStore


class _FakeGarminClient:
    def __init__(self) -> None:
        self.authenticated = False

    @property
    def is_authenticated(self) -> bool:
        return self.authenticated

    def dump(self, path: str) -> None:
        Path(path).write_text("{}", encoding="utf-8")


class _PostAuthRateLimitedGarmin:
    def __init__(self, **kwargs: Any) -> None:
        assert kwargs["return_on_mfa"] is True
        assert kwargs["retry_attempts"] == 1
        self.password = kwargs.get("password")
        self.client = _FakeGarminClient()

    def login(self, _token_path: str) -> tuple[str, None]:
        return "needs_mfa", None

    def resume_login(
        self, _client_state: dict[str, Any], _code: str
    ) -> tuple[None, None]:
        # Mirrors garminconnect 0.3.15: the low-level client has accepted MFA
        # and cleared its pending state before the wrapper loads profile/settings.
        self.client.authenticated = True
        raise account_link_module.GarminConnectTooManyRequestsError(
            "profile fetch rate limited"
        )


class _DummyRepository:
    pass


def test_post_auth_rate_limit_consumes_mfa_challenge_and_cleans_temp_state() -> None:
    store = PendingLoginStore()
    service = GarminAccountLinkService(
        "bucket",
        repository=_DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=_PostAuthRateLimitedGarmin,  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify cleanup boundary
    assert pending.temp_dir.exists()

    with pytest.raises(
        account_link_module.GarminConnectTooManyRequestsError,
        match="profile fetch rate limited",
    ):
        service.complete_mfa(challenge_id, "123456")

    assert pending.api.password is None
    assert not pending.temp_dir.exists()
    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError,
        match="invalid, expired",
    ):
        service.complete_mfa(challenge_id, "123456")
