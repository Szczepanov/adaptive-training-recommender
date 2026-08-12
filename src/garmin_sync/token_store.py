import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)


def _validate_gcs_object_name(object_name: str) -> str:
    """Accept only a relative, non-traversing GCS object name."""
    if (
        not object_name
        or object_name.startswith("/")
        or any(part in {"", ".", ".."} for part in object_name.split("/"))
    ):
        raise ValueError("GCS token object name must be a relative, non-traversing path.")
    return object_name


def _set_secure_permissions(file_path: Path) -> None:
    """Ensure token file permissions are 0600 and parent directory is 0700 where OS permits."""
    try:
        parent = file_path.parent
        parent.mkdir(parents=True, exist_ok=True)
        if hasattr(os, "chmod"):
            os.chmod(parent, 0o700)
            if file_path.exists():
                os.chmod(file_path, 0o600)
    except Exception as e:
        logger.debug(f"Failed to set permissions on '{file_path}': {e}")


class TokenStore(Protocol):
    def restore(self, destination: Path) -> bool:
        """Restore single token JSON file to destination path. Return True if restored successfully."""
        ...

    def persist(self, source: Path) -> None:
        """Persist refreshed token JSON file from local path to storage backend."""
        ...


class LocalTokenStore:
    """Manages single token JSON file persistence in a local filesystem path."""

    def __init__(self, local_path: Path | str = ".garmin_tokens/garmin_tokens.json"):
        self.storage_file = Path(local_path).expanduser().resolve()

    def restore(self, destination: Path) -> bool:
        dest_path = Path(destination).expanduser().resolve()
        if not self.storage_file.exists() or self.storage_file.is_dir():
            logger.info(f"Local token file '{self.storage_file}' does not exist or is a directory.")
            return False

        if dest_path != self.storage_file:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.storage_file, dest_path)

        _set_secure_permissions(dest_path)
        logger.info(f"Restored tokens from local store file '{self.storage_file}'.")
        return True

    def persist(self, source: Path) -> None:
        source_path = Path(source).expanduser().resolve()
        if not source_path.exists() or source_path.is_dir():
            logger.warning(f"Source token file '{source_path}' does not exist. Nothing to persist.")
            return

        if source_path != self.storage_file:
            self.storage_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, self.storage_file)

        _set_secure_permissions(self.storage_file)
        logger.info(f"Persisted tokens to local store file '{self.storage_file}'.")


class GcsTokenStore:
    """Manages token persistence in Google Cloud Storage as a single JSON file."""

    def __init__(self, bucket_name: str, object_name: str = "garmin/garmin_tokens.json"):
        self.bucket_name = bucket_name
        self.object_name = _validate_gcs_object_name(object_name)

    def restore(self, destination: Path) -> bool:
        dest_path = Path(destination).expanduser().resolve()
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            from google.cloud import storage  # type: ignore[attr-defined]
        except ImportError:
            logger.error("google-cloud-storage is required for GcsTokenStore.")
            return False

        try:
            client = storage.Client()
            bucket = client.bucket(self.bucket_name)
            blob = bucket.blob(self.object_name)

            if not blob.exists():
                logger.info(
                    f"GCS token object 'gs://{self.bucket_name}/{self.object_name}' does not exist."
                )
                return False

            # A failed download must not leave a partial token at the active path.
            with tempfile.NamedTemporaryFile(
                dir=dest_path.parent, prefix=".token-", delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
            try:
                blob.download_to_filename(str(temporary_path))
                os.replace(temporary_path, dest_path)
            finally:
                if temporary_path.exists():
                    temporary_path.unlink(missing_ok=True)
            _set_secure_permissions(dest_path)
            logger.info(f"Restored GCS token file to '{dest_path}'.")
            return True
        except Exception:
            logger.warning("Failed to restore token file from GCS.")
            return False

    def persist(self, source: Path) -> None:
        source_path = Path(source).expanduser().resolve()
        if not source_path.exists() or source_path.is_dir():
            logger.warning(
                f"Source token file '{source_path}' does not exist. Skipping GCS upload."
            )
            return

        try:
            from google.cloud import storage  # type: ignore[attr-defined]
        except ImportError:
            logger.error("google-cloud-storage is required for GcsTokenStore.")
            return

        try:
            client = storage.Client()
            bucket = client.bucket(self.bucket_name)
            blob = bucket.blob(self.object_name)

            blob.upload_from_filename(str(source_path))
            logger.info(
                f"Successfully persisted refreshed token file to gs://{self.bucket_name}/{self.object_name}."
            )
        except Exception:
            logger.error("Failed to upload token file to GCS.")


def create_token_store(
    store_type: str = "local",
    local_path: str = ".garmin_tokens/garmin_tokens.json",
    bucket_name: str | None = None,
    object_name: str | None = "garmin/garmin_tokens.json",
) -> TokenStore:
    if store_type.lower() == "gcs":
        if not bucket_name:
            raise ValueError("GCS token store requested but bucket_name is not configured.")
        return GcsTokenStore(
            bucket_name=bucket_name, object_name=object_name or "garmin/garmin_tokens.json"
        )
    return LocalTokenStore(local_path=local_path)
