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
