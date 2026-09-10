from pathlib import Path

import pytest

from garmin_sync.token_store import GcsTokenStore, LocalTokenStore


@pytest.mark.parametrize(
    "object_name", ["", "/tokens.json", "garmin/../tokens.json", "garmin//tokens.json"]
)
def test_gcs_token_store_rejects_traversing_object_names(object_name: str) -> None:
    with pytest.raises(ValueError, match="non-traversing"):
        GcsTokenStore(bucket_name="bucket", object_name=object_name)


def test_local_token_store_persist_returns_true_on_success(tmp_path: Path) -> None:
    source = tmp_path / "source.json"
    source.write_text("{}")
    store = LocalTokenStore(local_path=tmp_path / "store" / "tokens.json")

    assert store.persist(source) is True
    assert store.storage_file.exists()


def test_local_token_store_persist_returns_false_when_source_missing(tmp_path: Path) -> None:
    store = LocalTokenStore(local_path=tmp_path / "store" / "tokens.json")

    assert store.persist(tmp_path / "missing.json") is False


def test_chmod_secure_raises_when_unsupported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from garmin_sync.token_store import _chmod_secure

    target = tmp_path / "test.txt"
    target.write_text("data")

    # Disable supports_follow_symlinks and O_NOFOLLOW
    monkeypatch.setattr("garmin_sync.token_store.os.supports_follow_symlinks", set(), raising=False)
    monkeypatch.delattr("garmin_sync.token_store.os.O_NOFOLLOW", raising=False)

    with pytest.raises(RuntimeError, match="not supported on this platform"):
        _chmod_secure(target, 0o600)


def test_chmod_secure_raises_on_open_oserror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from garmin_sync.token_store import _chmod_secure

    target = tmp_path / "test.txt"
    target.write_text("data")

    # Force supports_follow_symlinks to be empty set
    monkeypatch.setattr("garmin_sync.token_store.os.supports_follow_symlinks", set(), raising=False)

    def mock_open(*args, **kwargs):
        raise OSError("Symlink detected or access denied")

    monkeypatch.setattr("garmin_sync.token_store.os.open", mock_open)

    with pytest.raises(RuntimeError, match="Failed to set secure permissions"):
        _chmod_secure(target, 0o600)


def test_set_secure_permissions_propagates_exception(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from garmin_sync.token_store import _set_secure_permissions

    target = tmp_path / "subdir" / "tokens.json"

    def mock_chmod_secure(path: Path, mode: int) -> None:
        raise RuntimeError("Secure chmod failed")

    monkeypatch.setattr("garmin_sync.token_store._chmod_secure", mock_chmod_secure)

    with pytest.raises(RuntimeError, match="Secure chmod failed"):
        _set_secure_permissions(target)
