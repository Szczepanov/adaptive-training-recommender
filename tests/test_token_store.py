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


def test_set_secure_permissions_handles_os_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from garmin_sync.token_store import _set_secure_permissions

    target_file = tmp_path / "tokens.json"
    target_file.write_text("{}")

    def mock_chmod_secure(path: Path, mode: int) -> None:
        raise OSError("Permission denied")

    monkeypatch.setattr("garmin_sync.token_store._chmod_secure", mock_chmod_secure)

    # Should catch OSError and log debug without raising exception
    _set_secure_permissions(target_file)
