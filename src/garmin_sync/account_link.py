import hashlib
import logging
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from firebase_admin import auth as firebase_auth
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from google.cloud import firestore as google_firestore

from .firestore_repository import init_firestore_client
from .token_store import GcsTokenStore

logger = logging.getLogger(__name__)


class GarminLinkConflictError(ValueError):
    """Raised when an authenticated app user tries to claim another user's Garmin account."""


class GarminLinkConfigurationError(RuntimeError):
    """Raised when account linking is not safely configured."""


# Mirrors app/src/utils/garminSyncStaleness.ts's STALE_AFTER_MS / IN_FLIGHT_STATUSES /
# isSyncRequestStale: the account-link initial-backfill queueing below must apply the
# exact same "don't stomp a genuinely still-running request" policy the frontend's
# GarminSyncRequestService.requestSync() uses, or the two callers could disagree about
# when it's safe to overwrite a pending/processing garmin_sync_requests/latest doc.
_SYNC_REQUEST_STALE_AFTER = timedelta(minutes=5)
_SYNC_REQUEST_IN_FLIGHT_STATUSES = {"pending", "processing"}


def _is_sync_request_in_flight(data: dict[str, Any]) -> bool:
    return data.get("status") in _SYNC_REQUEST_IN_FLIGHT_STATUSES


def _is_sync_request_stale(data: dict[str, Any], now: datetime) -> bool:
    if not _is_sync_request_in_flight(data):
        return False
    reference = data.get("claimedAt") if data.get("status") == "processing" else None
    reference = reference or data.get("requestedAt")
    if not reference:
        return False
    try:
        reference_dt = datetime.fromisoformat(reference)
    except (TypeError, ValueError):
        return False
    if reference_dt.tzinfo is None:
        reference_dt = reference_dt.replace(tzinfo=timezone.utc)
    return (now - reference_dt) > _SYNC_REQUEST_STALE_AFTER


@dataclass
class PendingGarminLogin:
    api: Garmin
    token_path: Path
    temp_dir: Path
    requested_uid: str | None
    client_state: Any
    created_monotonic: float


class PendingLoginStore:
    """Short-lived in-memory MFA state.

    Garmin's interactive MFA continuation requires the same live client/session object.
    We deliberately keep that object only in memory and deploy the linker as one Cloud Run
    instance. A restart invalidates the challenge and makes the user restart login; it never
    causes us to persist a Garmin password or SSO session to Firestore/GCS.
    """

    def __init__(self, ttl_seconds: int = 300, clock: Callable[[], float] = time.monotonic):
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._items: dict[str, PendingGarminLogin] = {}
        self._lock = threading.Lock()

    def _expired(self, pending: PendingGarminLogin) -> bool:
        return self.clock() - pending.created_monotonic > self.ttl_seconds

    @staticmethod
    def _cleanup(pending: PendingGarminLogin) -> None:
        pending.api.password = None
        shutil.rmtree(pending.temp_dir, ignore_errors=True)

    def _purge_expired_locked(self) -> None:
        expired = [key for key, value in self._items.items() if self._expired(value)]
        for key in expired:
            pending = self._items.pop(key)
            self._cleanup(pending)

    def put(self, pending: PendingGarminLogin) -> str:
        challenge_id = secrets.token_urlsafe(32)
        with self._lock:
            self._purge_expired_locked()
            self._items[challenge_id] = pending
        return challenge_id

    def pop(self, challenge_id: str) -> PendingGarminLogin:
        with self._lock:
            self._purge_expired_locked()
            pending = self._items.pop(challenge_id, None)
        if pending is None:
            raise GarminConnectAuthenticationError(
                "MFA challenge is invalid or expired. Start Garmin login again."
            )
        return pending


class GarminConnectionRepository:
    """Server-only Garmin identity mapping and linked-user discovery."""

    def __init__(self, db: Any = None):
        self.db = db or init_firestore_client()

    def uid_for_identity(self, identity_digest: str) -> str | None:
        snapshot = self.db.collection("garminIdentities").document(identity_digest).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        uid = data.get("userId")
        return str(uid) if uid else None

    def assert_target_available(self, uid: str, identity_digest: str) -> None:
        """Fail fast if the target uid can't accept this identity, before uploading a token.

        This is a pre-flight, non-transactional check only (so a doomed login doesn't pay
        for an upload it can't use); commit_link() re-validates and is the actual guard,
        since this read can be stale under concurrent relinks.
        """
        snapshot = self.db.collection("garminConnections").document(uid).get()
        if not snapshot.exists:
            return
        data = snapshot.to_dict() or {}
        existing_digest = data.get("identityDigest")
        if (
            data.get("status") == "active"
            and existing_digest
            and existing_digest != identity_digest
        ):
            raise GarminLinkConflictError(
                "This app account is already linked to a different Garmin account."
            )

    def commit_link(
        self,
        uid: str,
        identity_digest: str,
        identity_kind: str,
        token_object: str,
    ) -> str | None:
        """Commit the identity/connection mapping; return the tokenObject this replaced.

        The previous tokenObject is read from inside this same transaction (not by a
        separate pre-transaction call) so it's exactly the value this commit overwrites --
        under concurrent relinks for the same account, Firestore's optimistic-concurrency
        retry keeps that guarantee, so the caller can safely delete only that object and
        never leak or race against a sibling transaction's own cleanup.
        """
        identity_ref = self.db.collection("garminIdentities").document(identity_digest)
        connection_ref = self.db.collection("garminConnections").document(uid)
        # Non-secret mirror of connection_ref, under the user's own tree so the frontend can
        # read its own status directly (see users/{userId}/connections/{connectionId} in
        # firestore.rules, the same MS4/ADR-0027 path Google Health's connection status uses).
        # garminConnections itself stays server-only because it also holds tokenObject.
        client_status_ref = (
            self.db.collection("users").document(uid).collection("connections").document("garmin")
        )
        transaction = self.db.transaction()
        server_timestamp = google_firestore.SERVER_TIMESTAMP

        @google_firestore.transactional
        def commit(transaction_obj: Any) -> str | None:
            identity_snapshot = identity_ref.get(transaction=transaction_obj)
            if identity_snapshot.exists:
                identity_data = identity_snapshot.to_dict() or {}
                owner_uid = identity_data.get("userId")
                if owner_uid and owner_uid != uid:
                    raise GarminLinkConflictError(
                        "This Garmin account is already linked to another app account."
                    )

            connection_snapshot = connection_ref.get(transaction=transaction_obj)
            previous_token_object: str | None = None
            if connection_snapshot.exists:
                connection_data = connection_snapshot.to_dict() or {}
                existing_digest = connection_data.get("identityDigest")
                if (
                    connection_data.get("status") == "active"
                    and existing_digest
                    and existing_digest != identity_digest
                ):
                    raise GarminLinkConflictError(
                        "This app account is already linked to a different Garmin account."
                    )
                existing_token_object = connection_data.get("tokenObject")
                previous_token_object = (
                    str(existing_token_object) if existing_token_object else None
                )

            transaction_obj.set(
                identity_ref,
                {
                    "userId": uid,
                    "identityKind": identity_kind,
                    "linkedAt": server_timestamp,
                    "updatedAt": server_timestamp,
                },
                merge=True,
            )
            transaction_obj.set(
                connection_ref,
                {
                    "userId": uid,
                    "status": "active",
                    "identityDigest": identity_digest,
                    "identityKind": identity_kind,
                    "tokenObject": token_object,
                    "source": "garmin-connect-unofficial",
                    "linkedAt": server_timestamp,
                    "updatedAt": server_timestamp,
                },
                merge=True,
            )
            # Client-readable status only -- no tokenObject/identityDigest.
            transaction_obj.set(
                client_status_ref,
                {
                    "status": "active",
                    "identityKind": identity_kind,
                    "linkedAt": server_timestamp,
                    "updatedAt": server_timestamp,
                },
                merge=True,
            )
            return previous_token_object

        return commit(transaction)

    def list_active_connections(self) -> list[tuple[str, str | None]]:
        """Return (uid, tokenObject) for every active Garmin connection.

        tokenObject is whatever _finalize actually committed for that uid, not a
        reconstructed canonical path, so scheduled sync always restores the token the
        account-link transaction really wrote.
        """
        connections: list[tuple[str, str | None]] = []
        seen: set[str] = set()
        for snapshot in self.db.collection("garminConnections").stream():
            data = snapshot.to_dict() or {}
            if data.get("status") != "active":
                continue
            uid = data.get("userId") or snapshot.id
            if not uid or uid in seen:
                continue
            seen.add(uid)
            token_object = data.get("tokenObject")
            connections.append((str(uid), str(token_object) if token_object else None))
        return connections

    def list_active_user_ids(self) -> list[str]:
        return [uid for uid, _ in self.list_active_connections()]


def list_active_garmin_user_ids(db: Any = None) -> list[str]:
    return GarminConnectionRepository(db=db).list_active_user_ids()


def list_active_garmin_connections(db: Any = None) -> list[tuple[str, str | None]]:
    return GarminConnectionRepository(db=db).list_active_connections()


def _garmin_identity(api: Garmin) -> tuple[str, str]:
    profile = api.connectapi("/userprofile-service/socialProfile") or {}
    if not isinstance(profile, dict):
        raise GarminConnectConnectionError("Garmin returned an invalid social profile.")

    # Only use identifiers expected to be stable for the lifetime of the Garmin account.
    # displayName is intentionally not a fallback: users can change it, so using it as an
    # identity key could create duplicate app accounts after a rename.
    candidates = (
        ("garmin_guid", profile.get("garminGUID")),
        ("profile_id", profile.get("profileId")),
    )
    for kind, raw_value in candidates:
        value = str(raw_value).strip() if raw_value is not None else ""
        if value:
            digest = hashlib.sha256(f"{kind}:{value}".encode("utf-8")).hexdigest()
            return kind, digest
    raise GarminConnectAuthenticationError(
        "Garmin login succeeded but no stable account identity was available."
    )


class GarminAccountLinkService:
    def __init__(
        self,
        token_bucket: str,
        repository: GarminConnectionRepository | None = None,
        pending_store: PendingLoginStore | None = None,
        garmin_factory: Callable[..., Garmin] = Garmin,
    ):
        if not token_bucket.strip():
            raise GarminLinkConfigurationError("GARMIN_TOKEN_BUCKET is required.")
        self.token_bucket = token_bucket.strip()
        self.repository = repository or GarminConnectionRepository()
        self.pending_store = pending_store or PendingLoginStore()
        self.garmin_factory = garmin_factory

    @staticmethod
    def _temporary_token_path() -> tuple[Path, Path]:
        temp_dir = Path(tempfile.mkdtemp(prefix="garmin-link-"))
        return temp_dir, temp_dir / "garmin_tokens.json"

    def start_login(
        self, email: str, password: str, requested_uid: str | None = None
    ) -> dict[str, Any]:
        if not email.strip() or not password:
            raise GarminConnectAuthenticationError("Garmin email and password are required.")

        temp_dir, token_path = self._temporary_token_path()
        api = self.garmin_factory(
            email=email.strip(),
            password=password,
            return_on_mfa=True,
            retry_attempts=1,
        )
        try:
            mfa_status, client_state = api.login(str(token_path))
            if mfa_status == "needs_mfa":
                # Current garminconnect keeps the live MFA state inside this Garmin/Client
                # instance and normally returns client_state=None. Keep the optional return
                # value for forward/backward compatibility; resume_login accepts {} today.
                api.password = None
                challenge_id = self.pending_store.put(
                    PendingGarminLogin(
                        api=api,
                        token_path=token_path,
                        temp_dir=temp_dir,
                        requested_uid=requested_uid,
                        client_state=client_state,
                        created_monotonic=self.pending_store.clock(),
                    )
                )
                return {"status": "mfa_required", "challengeId": challenge_id}

            # Garmin(return_on_mfa=True) returns immediately after the low-level login even
            # when MFA was not required, so its normal tokenstore dump/password cleanup is
            # skipped. Do those two steps explicitly before linking the account.
            api.client.dump(str(token_path))
            api.password = None
            return self._finalize(api, token_path, temp_dir, requested_uid)
        except Exception:
            api.password = None
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

    def complete_mfa(self, challenge_id: str, code: str) -> dict[str, Any]:
        if not challenge_id or not code.strip():
            raise GarminConnectAuthenticationError("MFA challenge and code are required.")

        pending = self.pending_store.pop(challenge_id)
        try:
            pending.api.resume_login(pending.client_state or {}, code.strip())
            pending.api.password = None
            # return_on_mfa exits before Garmin.login()'s normal tokenstore dump path.
            # After successful resume, explicitly persist the authenticated token snapshot.
            pending.api.client.dump(str(pending.token_path))
            return self._finalize(
                pending.api,
                pending.token_path,
                pending.temp_dir,
                pending.requested_uid,
            )
        except Exception:
            pending.api.password = None
            shutil.rmtree(pending.temp_dir, ignore_errors=True)
            raise

    def _delete_token_object(self, token_object: str) -> None:
        """Best-effort cleanup for a token upload whose Firestore link never committed."""
        try:
            from google.cloud import storage  # type: ignore[attr-defined]

            storage.Client().bucket(self.token_bucket).blob(token_object).delete()
        except Exception:
            logger.warning("Failed to remove orphaned Garmin token object after link error.")

    def _finalize(
        self,
        api: Garmin,
        token_path: Path,
        temp_dir: Path,
        requested_uid: str | None,
    ) -> dict[str, Any]:
        created_uid: str | None = None
        link_committed = False
        uploaded_token_object: str | None = None
        try:
            identity_kind, identity_digest = _garmin_identity(api)
            mapped_uid = self.repository.uid_for_identity(identity_digest)

            if mapped_uid:
                if requested_uid and requested_uid != mapped_uid:
                    raise GarminLinkConflictError(
                        "This Garmin account is already linked to another app account."
                    )
                target_uid = mapped_uid
                is_new_user = False
            elif requested_uid:
                target_uid = requested_uid
                is_new_user = False
            else:
                user_record = firebase_auth.create_user()
                target_uid = user_record.uid
                created_uid = target_uid
                is_new_user = True

            # Pre-flight only (may be stale under concurrent relinks); commit_link() below
            # re-validates transactionally and is the actual guard.
            self.repository.assert_target_available(target_uid, identity_digest)
            # Stage every upload under a fresh, unique object name rather than the uid's
            # canonical path: an active relink must never overwrite the token object that
            # scheduled sync still reads until this new one is actually committed.
            token_object = f"garmin/users/{target_uid}/garmin_tokens-{secrets.token_hex(8)}.json"
            if not GcsTokenStore(self.token_bucket, token_object).persist(token_path):
                raise GarminLinkConfigurationError("Failed to persist Garmin session tokens.")
            uploaded_token_object = token_object

            # previous_token_object is read from inside the same transaction that commits
            # token_object, so it's exactly the value this commit overwrote -- safe to
            # delete even under a concurrent relink for the same account (see
            # commit_link()'s docstring).
            previous_token_object = self.repository.commit_link(
                target_uid,
                identity_digest,
                identity_kind,
                token_object,
            )
            link_committed = True
            if previous_token_object and previous_token_object != token_object:
                # The new token is committed; the previous object is superseded and safe
                # to remove. Scheduled sync restores whatever tokenObject Firestore has,
                # so it never reads a path we're about to delete.
                self._delete_token_object(previous_token_object)

            # Queue an initial 56-day backfill request in Firestore so the background
            # poller (garmin-manual-sync Cloud Run Job) immediately backfills historical
            # recovery and activity data to establish baselines without blocking login.
            db = getattr(self.repository, "db", None)
            if db is not None:
                try:
                    now = datetime.now(timezone.utc)
                    sync_req_ref = (
                        db.collection("users")
                        .document(target_uid)
                        .collection("garmin_sync_requests")
                        .document("latest")
                    )

                    @google_firestore.transactional
                    def _queue_initial_backfill(transaction: Any) -> None:
                        snapshot = sync_req_ref.get(transaction=transaction)
                        existing = snapshot.to_dict() if snapshot.exists else None
                        # A plain merge=True set here would overwrite a claimed
                        # 'processing' request's status back to 'pending' while keeping
                        # its claimId -- the worker that already owns that claim would
                        # then mark *this* new request completed without ever running
                        # it, and a second poller could concurrently claim the
                        # 'pending' doc too. Only queue when nothing genuinely
                        # in-flight would be superseded; a stale claim (dead poller)
                        # is safe to overwrite, same policy as
                        # GarminSyncRequestService.requestSync().
                        if (
                            existing
                            and _is_sync_request_in_flight(existing)
                            and not _is_sync_request_stale(existing, now)
                        ):
                            return
                        transaction.set(
                            sync_req_ref,
                            {
                                "userId": target_uid,
                                "status": "pending",
                                "requestType": "initial_backfill",
                                "days": 56,
                                "requestedAt": now.isoformat(),
                                "completedAt": None,
                                "error": None,
                            },
                        )

                    _queue_initial_backfill(db.transaction())
                except Exception as exc:
                    logger.warning(
                        "Failed to queue initial backfill request for user %s: %s",
                        target_uid,
                        exc,
                    )

            custom_token = firebase_auth.create_custom_token(target_uid)
            custom_token_text = (
                custom_token.decode("utf-8")
                if isinstance(custom_token, bytes)
                else str(custom_token)
            )
            return {
                "status": "authenticated",
                "customToken": custom_token_text,
                "isNewUser": is_new_user,
            }
        except Exception:
            if uploaded_token_object and not link_committed:
                self._delete_token_object(uploaded_token_object)
            # Before the mapping commits, a just-created Firebase user is safe to roll back.
            # After commit, keep the user/mapping intact: a transient custom-token signing
            # failure must be retryable, not leave garminConnections pointing at a deleted UID.
            if created_uid and not link_committed:
                try:
                    firebase_auth.delete_user(created_uid)
                except Exception:
                    logger.warning(
                        "Failed to roll back newly-created Firebase user after link error."
                    )
            raise
        finally:
            api.password = None
            shutil.rmtree(temp_dir, ignore_errors=True)


__all__ = [
    "GarminAccountLinkService",
    "GarminConnectionRepository",
    "GarminLinkConfigurationError",
    "GarminLinkConflictError",
    "PendingLoginStore",
    "list_active_garmin_connections",
    "list_active_garmin_user_ids",
    "GarminConnectAuthenticationError",
    "GarminConnectConnectionError",
    "GarminConnectTooManyRequestsError",
]
