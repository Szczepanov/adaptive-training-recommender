from __future__ import annotations

from typing import Any

from google.cloud import firestore as google_firestore

from .firestore_repository import init_firestore_client


def _linked_at_json(value: Any) -> str | None:
    """Return a JSON-safe timestamp without exposing Firestore implementation details."""
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return str(isoformat())
    return None


def reconcile_garmin_connection_status(uid: str, db: Any = None) -> dict[str, Any]:
    """Read canonical Garmin link state and repair the client-readable mirror atomically.

    ``garminConnections/{uid}`` remains server-only because it contains ``tokenObject`` and
    identity metadata. The frontend reads ``users/{uid}/connections/garmin`` instead. Older
    links predate that mirror, so this authenticated reconciliation path lazily backfills the
    non-secret projection on first status check rather than requiring users to relink.

    The canonical read and mirror write/delete share one Firestore transaction so a concurrent
    relink cannot resurrect stale status after an unlink or overwrite a newer link state.
    """
    if not uid:
        raise ValueError("uid is required")

    client = db or init_firestore_client()
    canonical_ref = client.collection("garminConnections").document(uid)
    mirror_ref = (
        client.collection("users").document(uid).collection("connections").document("garmin")
    )
    transaction = client.transaction()

    @google_firestore.transactional
    def reconcile(transaction_obj: Any) -> dict[str, Any]:
        snapshot = canonical_ref.get(transaction=transaction_obj)
        data = snapshot.to_dict() if snapshot.exists else None
        if not data or data.get("status") != "active":
            # Delete a stale projection if canonical state says the account is not linked.
            transaction_obj.delete(mirror_ref)
            return {"status": "disconnected", "linkedAt": None}

        linked_at = data.get("linkedAt")
        mirror: dict[str, Any] = {
            "status": "active",
            "updatedAt": google_firestore.SERVER_TIMESTAMP,
        }
        identity_kind = data.get("identityKind")
        if identity_kind:
            mirror["identityKind"] = identity_kind
        mirror["linkedAt"] = linked_at or google_firestore.SERVER_TIMESTAMP

        # Deliberately project only non-secret fields. Never copy tokenObject,
        # identityDigest, source credentials, or other canonical-only metadata.
        transaction_obj.set(mirror_ref, mirror, merge=True)
        return {
            "status": "active",
            "linkedAt": _linked_at_json(linked_at),
        }

    return reconcile(transaction)


__all__ = ["reconcile_garmin_connection_status"]
