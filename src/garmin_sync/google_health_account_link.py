"""Google Health OAuth authorization-code account linking (in-app, per-user).

Unlike Garmin linking (account_link.py), Google Health requires a browser-redirect OAuth
flow: the app sends the user to Google's consent screen, Google redirects back with a
`code`, and the server exchanges that for tokens. This module provides:

- GoogleHealthLinkStateStore: short-lived Firestore-backed CSRF `state` tokens tying a
  callback back to the app user who started it (Firestore rather than in-memory so the
  service can run with normal `max-instances`, unlike Garmin's session-pinned linker).
- exchange_code_for_tokens: the authorization-code -> token exchange.
- persist_tokens / load_tokens: GCS-backed storage for the resulting refresh token,
  mirroring Garmin's GCS-token / Firestore-status-only split (token_store.py).
- GoogleHealthConnectionRepository: per-user connection status (users/{uid}/connections/
  googleHealth, via FirestoreRecoveryRepository.save_connection_metadata/
  get_connection_metadata) and multi-user discovery for operator-triggered syncs.

See docs/plans/2026-08-27-real-google-health-ingestion.md for context on why this exists
(CASA/Restricted Scope verification is confirmed not done -- every linked user will see
Google's "unverified app" warning and refresh tokens are subject to that regime's limits
until verification is completed).
"""

import json
import logging
import secrets
import tempfile
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from .firestore_repository import FirestoreRecoveryRepository, init_firestore_client
from .google_health_auth import (
    GOOGLE_TOKEN_URL,
    GoogleHealthAuthManager,
    GoogleHealthConnectionMetadata,
    GoogleHealthTokenCredentials,
)
from .token_store import GcsTokenStore

logger = logging.getLogger(__name__)

CONNECTION_NAME = "googleHealth"
_STATE_TTL_SECONDS = 10 * 60


class GoogleHealthLinkError(Exception):
    """Base exception for Google Health account-linking failures."""


class GoogleHealthLinkStateInvalidError(GoogleHealthLinkError):
    """Raised when a callback's `state` is missing, unknown, expired, or already used."""


class GoogleHealthTokenExchangeError(GoogleHealthLinkError):
    """Raised when Google rejects the authorization-code exchange."""


@dataclass
class GoogleHealthLinkTokens:
    access_token: str
    refresh_token: str
    token_type: str
    scopes: list[str]
    obtained_at: str


class GoogleHealthLinkStateStore:
    """Short-lived, single-use CSRF `state` tokens for the OAuth redirect round trip.

    Firestore-backed (not in-memory) so this service can run with normal `max-instances`
    rather than being pinned to one instance the way Garmin's MFA-continuation linker is --
    the whole point of a separate service for Google Health is to avoid inheriting that
    constraint.
    """

    def __init__(self, db: Any = None) -> None:
        self.db = db or init_firestore_client()

    def create(self, uid: str) -> str:
        state = secrets.token_urlsafe(32)
        self.db.collection("googleHealthLinkState").document(state).set(
            {"uid": uid, "createdAt": time.time()}
        )
        return state

    def consume(self, state: str) -> str:
        """Validate and delete a state token, returning the uid it was issued for.

        One-time use: a replayed callback (e.g. a user double-clicking, or a stale
        bookmarked callback URL) fails on the second attempt rather than silently
        re-linking or leaking which uid a guessed state token belongs to.
        """
        if not state:
            raise GoogleHealthLinkStateInvalidError("Missing state parameter.")
        doc_ref = self.db.collection("googleHealthLinkState").document(state)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            raise GoogleHealthLinkStateInvalidError("Link request is invalid or already used.")
        data = snapshot.to_dict() or {}
        doc_ref.delete()

        created_at = data.get("createdAt")
        if (
            not isinstance(created_at, (int, float))
            or (time.time() - created_at) > _STATE_TTL_SECONDS
        ):
            raise GoogleHealthLinkStateInvalidError("Link request expired. Start linking again.")

        uid = data.get("uid")
        if not uid or not isinstance(uid, str):
            raise GoogleHealthLinkStateInvalidError("Link request has no associated user.")
        return uid


def build_authorize_url(
    *,
    client_id: str,
    redirect_uri: str,
    scopes: list[str],
    state: str,
) -> str:
    """Build the Google OAuth consent-screen URL for the frontend to redirect the browser to.

    access_type=offline + prompt=consent guarantee a refresh_token is issued every time
    (without prompt=consent, Google only issues one on the *first* ever grant for a given
    user+scopes+client, which would silently break re-linking after a revoke).
    """
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe="")
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def exchange_code_for_tokens(
    *,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> GoogleHealthLinkTokens:
    response = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )
    if response.status_code != 200:
        raise GoogleHealthTokenExchangeError(
            f"Google rejected the authorization code: HTTP {response.status_code}"
        )
    data = response.json()
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        # Happens if prompt=consent was somehow dropped, or the user had already granted
        # and Google is being stingy -- without a refresh_token this link is useless for
        # anything but the next hour, so treat it as a hard failure rather than a partial
        # success the caller might not notice.
        raise GoogleHealthTokenExchangeError(
            "Google did not return a refresh token. Try linking again."
        )
    return GoogleHealthLinkTokens(
        access_token=data.get("access_token", ""),
        refresh_token=refresh_token,
        token_type=data.get("token_type", "Bearer"),
        scopes=str(data.get("scope", "")).split(),
        obtained_at=datetime.now(timezone.utc).isoformat(),
    )


def _write_token_blob(*, bucket_name: str, object_name: str, payload: dict[str, Any]) -> bool:
    store = GcsTokenStore(bucket_name, object_name)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / "google_health_tokens.json"
        tmp_path.write_text(json.dumps(payload))
        return store.persist(tmp_path)


def persist_tokens(
    *,
    bucket_name: str,
    uid: str,
    tokens: GoogleHealthLinkTokens,
) -> str:
    """Upload the token pair to GCS; returns the object name (never the token itself) for
    storage in Firestore, mirroring Garmin's tokenObject pattern (account_link.py)."""
    object_name = f"google-health/users/{uid}/google_health_tokens-{secrets.token_hex(8)}.json"
    ok = _write_token_blob(
        bucket_name=bucket_name,
        object_name=object_name,
        payload={
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "token_type": tokens.token_type,
            "scopes": tokens.scopes,
            "obtained_at": tokens.obtained_at,
        },
    )
    if not ok:
        raise GoogleHealthLinkError("Failed to persist Google Health tokens to storage.")
    return object_name


def _overwrite_tokens(
    *,
    bucket_name: str,
    object_name: str,
    credentials: GoogleHealthTokenCredentials,
) -> None:
    """Overwrite an existing linked-user token object in place after a refresh -- see
    load_auth_manager_for_user's on_refresh callback. Best-effort: logs rather than raises,
    since this runs mid-request after the caller already has a usable access token."""
    ok = _write_token_blob(
        bucket_name=bucket_name,
        object_name=object_name,
        payload={
            "access_token": credentials.access_token,
            "refresh_token": credentials.refresh_token,
            "token_type": credentials.token_type,
            "scopes": credentials.scopes,
            "obtained_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    if not ok:
        logger.warning(
            "Failed to persist refreshed Google Health tokens to gs://%s/%s",
            bucket_name,
            object_name,
        )


def load_tokens(*, bucket_name: str, object_name: str) -> dict[str, Any] | None:
    store = GcsTokenStore(bucket_name, object_name)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / "google_health_tokens.json"
        if not store.restore(tmp_path):
            return None
        return json.loads(tmp_path.read_text())


class GoogleHealthConnectionRepository:
    """Per-user Google Health connection status + multi-user discovery for operator-
    triggered syncs (mirrors GarminConnectionRepository.list_active_connections)."""

    def __init__(self, db: Any = None, credentials_path: str | None = None) -> None:
        self.db = db or init_firestore_client()
        self.credentials_path = credentials_path

    def _repo_for(self, uid: str) -> FirestoreRecoveryRepository:
        return FirestoreRecoveryRepository(
            user_id=uid,
            collection_name="daily_recovery_snapshots",
            db=self.db,
            credentials_path=self.credentials_path,
        )

    def save_connection(
        self,
        uid: str,
        *,
        health_user_id: str | None,
        granted_scopes: list[str],
        token_object: str,
    ) -> None:
        metadata = GoogleHealthConnectionMetadata(
            status="active",
            healthUserId=health_user_id,
            grantedScopes=granted_scopes,
            linkedAt=datetime.now(timezone.utc).isoformat(),
        ).to_dict()
        metadata["tokenObject"] = token_object
        self._repo_for(uid).save_connection_metadata(CONNECTION_NAME, metadata)

    def get_connection(self, uid: str) -> dict[str, Any] | None:
        return self._repo_for(uid).get_connection_metadata(CONNECTION_NAME)

    def list_active_user_ids(self) -> list[str]:
        """Collection-group scan of users/*/connections for active googleHealth links.

        Filtered client-side (small expected collection size for a "few users" pilot)
        rather than via a composite Firestore index, since the connection status doc's
        *id* (not a field) is what identifies it as the googleHealth connection.
        """
        user_ids: list[str] = []
        for snapshot in self.db.collection_group("connections").stream():
            if snapshot.id != CONNECTION_NAME:
                continue
            data = snapshot.to_dict() or {}
            if data.get("status") != "active":
                continue
            uid = snapshot.reference.parent.parent.id if snapshot.reference.parent.parent else None
            if uid:
                user_ids.append(uid)
        return user_ids

    def load_auth_manager_for_user(
        self,
        uid: str,
        *,
        client_id: str,
        client_secret: str,
        bucket_name: str,
    ) -> GoogleHealthAuthManager:
        connection = self.get_connection(uid)
        if not connection or connection.get("status") != "active":
            raise GoogleHealthLinkError(f"No active Google Health connection for user {uid}.")
        token_object = connection.get("tokenObject")
        if not token_object:
            raise GoogleHealthLinkError(
                f"Google Health connection for user {uid} has no stored token."
            )

        stored = load_tokens(bucket_name=bucket_name, object_name=str(token_object))
        if not stored or not stored.get("refresh_token"):
            raise GoogleHealthLinkError(
                f"Could not load a valid Google Health refresh token for user {uid}."
            )

        creds = GoogleHealthTokenCredentials(
            access_token=stored.get("access_token", ""),
            refresh_token=stored["refresh_token"],
            expires_at=0.0,  # force a refresh on first use rather than trusting a stale value
        )

        def _persist_refreshed(refreshed: GoogleHealthTokenCredentials) -> None:
            # Overwrite the same object (not a new one) -- Google doesn't rotate the
            # refresh_token on every access-token refresh, but can. Without this, a caller
            # relying only on the token loaded above would eventually hit invalid_grant after
            # an unseen rotation. Same object name means no Firestore tokenObject update is
            # needed. Best-effort by design (see GoogleHealthAuthManager.on_refresh): this
            # runs mid-request, so a storage hiccup here shouldn't fail a request that already
            # has a good access token in hand.
            _overwrite_tokens(
                bucket_name=bucket_name, object_name=str(token_object), credentials=refreshed
            )

        return GoogleHealthAuthManager(
            client_id=client_id,
            client_secret=client_secret,
            credentials=creds,
            on_refresh=_persist_refreshed,
        )
