from unittest.mock import MagicMock
import pytest
from garmin_sync.firestore_repository import FirestoreRecoveryRepository

def test_firestore_repository_rejects_default_user():
    with pytest.raises(ValueError, match="requires a valid non-default user_id"):
        FirestoreRecoveryRepository(user_id="default_user")

def test_firestore_repository_upsert_path_and_user_validation():
    mock_db = MagicMock()
    doc_ref = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = False
    doc_ref.get.return_value = doc_snap
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref

    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    valid_payload = {"userId": "real_uid_456", "date": "2026-08-06", "raw": {}}
    repo.upsert_snapshot("2026-08-06", valid_payload)

    mock_db.collection.assert_called_with("users")
    doc_ref.set.assert_called_once()
    saved_data = doc_ref.set.call_args[0][0]
    assert saved_data["userId"] == "real_uid_456"
    assert "createdAt" in saved_data
    assert "updatedAt" in saved_data

def test_firestore_repository_user_mismatch_raises_error():
    mock_db = MagicMock()
    repo = FirestoreRecoveryRepository(user_id="real_uid_456", db=mock_db)

    invalid_payload = {"userId": "other_uid_789", "date": "2026-08-06", "raw": {}}
    with pytest.raises(ValueError, match="does not match configured user_id"):
        repo.upsert_snapshot("2026-08-06", invalid_payload)
