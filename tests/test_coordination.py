from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from garmin_sync.coordination import GarminExecutionLease


@pytest.fixture
def mock_transactional(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("garmin_sync.coordination.firestore.transactional", lambda fn: fn)


@pytest.fixture
def mock_db() -> MagicMock:
    db = MagicMock()
    db.transaction.return_value = MagicMock()
    return db


def test_init_valid(mock_db: MagicMock) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")
    assert lease.user_id == "user1"
    assert lease.operation == "sync"
    assert lease.ttl_seconds == 30 * 60  # DEFAULT_LEASE_SECONDS
    assert lease._acquired is False
    assert lease.holder_id is not None
    assert isinstance(lease.holder_id, str)


def test_init_invalid_user(mock_db: MagicMock) -> None:
    with pytest.raises(ValueError, match="requires a non-blank Firebase UID"):
        GarminExecutionLease(mock_db, "", "sync")
    with pytest.raises(ValueError, match="requires a non-blank Firebase UID"):
        GarminExecutionLease(mock_db, "   ", "sync")


def test_init_invalid_ttl(mock_db: MagicMock) -> None:
    with pytest.raises(ValueError, match="TTL must be positive"):
        GarminExecutionLease(mock_db, "user1", "sync", ttl_seconds=0)
    with pytest.raises(ValueError, match="TTL must be positive"):
        GarminExecutionLease(mock_db, "user1", "sync", ttl_seconds=-10)


def test_acquire_no_existing_lease(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")

    snapshot = MagicMock()
    snapshot.exists = False

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    acquired = lease.acquire()
    assert acquired is True
    assert lease._acquired is True

    transaction = mock_db.transaction()
    doc_ref.get.assert_called_once_with(transaction=transaction)
    transaction.set.assert_called_once()

    set_args = transaction.set.call_args[0]
    assert set_args[0] == doc_ref
    assert set_args[1]["holderId"] == lease.holder_id
    assert set_args[1]["operation"] == "sync"


def test_acquire_existing_expired_lease(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")

    snapshot = MagicMock()
    snapshot.exists = True
    expired_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    snapshot.to_dict.return_value = {
        "holderId": "other_holder",
        "expiresAt": expired_time,
    }

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    acquired = lease.acquire()
    assert acquired is True
    assert lease._acquired is True
    transaction = mock_db.transaction()
    transaction.set.assert_called_once()


def test_acquire_existing_unexpired_lease(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")

    snapshot = MagicMock()
    snapshot.exists = True
    unexpired_time = datetime.now(timezone.utc) + timedelta(minutes=5)
    snapshot.to_dict.return_value = {
        "holderId": "other_holder",
        "expiresAt": unexpired_time,
    }

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    acquired = lease.acquire()
    assert acquired is False
    assert lease._acquired is False
    transaction = mock_db.transaction()
    transaction.set.assert_not_called()


def test_acquire_existing_unexpired_own_lease(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")

    snapshot = MagicMock()
    snapshot.exists = True
    unexpired_time = datetime.now(timezone.utc) + timedelta(minutes=5)
    snapshot.to_dict.return_value = {
        "holderId": lease.holder_id,
        "expiresAt": unexpired_time,
    }

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    acquired = lease.acquire()
    assert acquired is True
    assert lease._acquired is True
    transaction = mock_db.transaction()
    transaction.set.assert_called_once()


def test_release_not_acquired(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")
    assert lease._acquired is False

    lease.release()

    transaction = mock_db.transaction()
    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.assert_not_called()
    transaction.delete.assert_not_called()


def test_release_acquired_and_owned(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")
    lease._acquired = True

    snapshot = MagicMock()
    snapshot.exists = True
    snapshot.to_dict.return_value = {"holderId": lease.holder_id}

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    lease.release()

    assert lease._acquired is False
    transaction = mock_db.transaction()
    doc_ref.get.assert_called_once_with(transaction=transaction)
    transaction.delete.assert_called_once_with(doc_ref)


def test_release_acquired_but_owned_by_other(mock_db: MagicMock, mock_transactional: None) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")
    lease._acquired = True

    snapshot = MagicMock()
    snapshot.exists = True
    snapshot.to_dict.return_value = {"holderId": "other_holder"}

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    lease.release()

    assert lease._acquired is False
    transaction = mock_db.transaction()
    doc_ref.get.assert_called_once_with(transaction=transaction)
    transaction.delete.assert_not_called()


def test_release_acquired_but_no_longer_exists(
    mock_db: MagicMock, mock_transactional: None
) -> None:
    lease = GarminExecutionLease(mock_db, "user1", "sync")
    lease._acquired = True

    snapshot = MagicMock()
    snapshot.exists = False

    doc_ref = mock_db.collection().document().collection().document()
    doc_ref.get.return_value = snapshot

    lease.release()

    assert lease._acquired is False
    transaction = mock_db.transaction()
    doc_ref.get.assert_called_once_with(transaction=transaction)
    transaction.delete.assert_not_called()


def test_as_utc() -> None:
    naive = datetime(2023, 1, 1, 12, 0, 0)
    utc_dt = GarminExecutionLease._as_utc(naive)
    assert utc_dt.tzinfo == timezone.utc

    aware = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone(timedelta(hours=2)))
    utc_dt2 = GarminExecutionLease._as_utc(aware)
    assert utc_dt2.tzinfo == timezone(timedelta(hours=2))
