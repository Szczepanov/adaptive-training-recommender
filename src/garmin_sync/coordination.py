import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from firebase_admin import firestore

DEFAULT_LEASE_SECONDS = 30 * 60


class GarminExecutionLease:
    """Firestore-backed per-user lease for Garmin operations.

    Cloud Run Jobs can overlap when Scheduler (or a manual execution) starts another run
    before the previous one finishes. All production Garmin CLI paths use the same document,
    so sync, manual sync, backfill and workout uploads for one Firebase UID are serialized
    across processes and Cloud Run instances. The expiry is deliberately longer than the
    default Cloud Run Job task timeout, allowing a killed process to release itself eventually
    without expiring during a normal scheduled execution.
    """

    def __init__(
        self,
        db: Any,
        user_id: str,
        operation: str,
        ttl_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> None:
        if not user_id or not user_id.strip():
            raise ValueError("Garmin execution lease requires a non-blank Firebase UID.")
        if ttl_seconds <= 0:
            raise ValueError("Garmin execution lease TTL must be positive.")
        self.db = db
        self.user_id = user_id
        self.operation = operation
        self.ttl_seconds = ttl_seconds
        self.holder_id = uuid.uuid4().hex
        self._acquired = False
        self._ref = (
            db.collection("users")
            .document(user_id)
            .collection("garmin_runtime")
            .document("execution_lease")
        )

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)

    def acquire(self) -> bool:
        """Atomically claim the user lease unless another unexpired holder owns it."""
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=self.ttl_seconds)

        @firestore.transactional
        def claim(transaction: Any) -> bool:
            snapshot = self._ref.get(transaction=transaction)
            if snapshot.exists:
                data = snapshot.to_dict() or {}
                existing_holder = data.get("holderId")
                existing_expiry = data.get("expiresAt")
                if existing_holder and isinstance(existing_expiry, datetime):
                    if self._as_utc(existing_expiry) > now and existing_holder != self.holder_id:
                        return False

            transaction.set(
                self._ref,
                {
                    "holderId": self.holder_id,
                    "operation": self.operation,
                    "acquiredAt": now,
                    "expiresAt": expires_at,
                },
            )
            return True

        self._acquired = bool(claim(self.db.transaction()))
        return self._acquired

    def release(self) -> None:
        """Delete the lease only when this instance still owns it."""
        if not self._acquired:
            return

        @firestore.transactional
        def release_owned(transaction: Any) -> None:
            snapshot = self._ref.get(transaction=transaction)
            if not snapshot.exists:
                return
            data = snapshot.to_dict() or {}
            if data.get("holderId") == self.holder_id:
                transaction.delete(self._ref)

        try:
            release_owned(self.db.transaction())
        finally:
            self._acquired = False
