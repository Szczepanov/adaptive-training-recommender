import pytest

from garmin_sync.token_store import GcsTokenStore


@pytest.mark.parametrize("object_name", ["", "/tokens.json", "garmin/../tokens.json", "garmin//tokens.json"])
def test_gcs_token_store_rejects_traversing_object_names(object_name: str) -> None:
    with pytest.raises(ValueError, match="non-traversing"):
        GcsTokenStore(bucket_name="bucket", object_name=object_name)
