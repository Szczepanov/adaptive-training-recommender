import os
import shutil
import tarfile
import tempfile
import logging
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)


class TokenStore(Protocol):
    def restore(self, destination: Path) -> bool:
        """Restore tokens to local directory. Return True if restored successfully."""
        ...

    def persist(self, source: Path) -> None:
        """Persist refreshed tokens from local directory to storage backend."""
        ...


class LocalTokenStore:
    """Manages token persistence in a local filesystem directory."""

    def __init__(self, storage_dir: Path | str = ".garth"):
        self.storage_dir = Path(storage_dir).expanduser().resolve()

    def restore(self, destination: Path) -> bool:
        dest_path = Path(destination).expanduser().resolve()
        if not self.storage_dir.exists() or not any(self.storage_dir.iterdir()):
            logger.info(f"Local token directory '{self.storage_dir}' does not exist or is empty.")
            return False

        if dest_path != self.storage_dir:
            dest_path.mkdir(parents=True, exist_ok=True)
            for item in self.storage_dir.iterdir():
                dest_item = dest_path / item.name
                if item.is_dir():
                    if dest_item.exists():
                        shutil.rmtree(dest_item)
                    shutil.copytree(item, dest_item)
                else:
                    shutil.copy2(item, dest_item)

        logger.info(f"Restored tokens from local store '{self.storage_dir}'.")
        return True

    def persist(self, source: Path) -> None:
        source_path = Path(source).expanduser().resolve()
        if not source_path.exists() or not any(source_path.iterdir()):
            logger.warning(f"Source token directory '{source_path}' is empty. Nothing to persist.")
            return

        if source_path != self.storage_dir:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
            for item in source_path.iterdir():
                dest_item = self.storage_dir / item.name
                if item.is_dir():
                    if dest_item.exists():
                        shutil.rmtree(dest_item)
                    shutil.copytree(item, dest_item)
                else:
                    shutil.copy2(item, dest_item)

        logger.info(f"Persisted tokens to local store '{self.storage_dir}'.")


class GcsTokenStore:
    """Manages token persistence in Google Cloud Storage as a tar.gz archive."""

    def __init__(self, bucket_name: str, object_name: str = "garmin_tokens.tar.gz"):
        self.bucket_name = bucket_name
        self.object_name = object_name

    def restore(self, destination: Path) -> bool:
        dest_path = Path(destination).expanduser().resolve()
        dest_path.mkdir(parents=True, exist_ok=True)

        try:
            from google.cloud import storage
        except ImportError:
            logger.error("google-cloud-storage is required for GcsTokenStore.")
            return False

        try:
            client = storage.Client()
            bucket = client.bucket(self.bucket_name)
            blob = bucket.blob(self.object_name)

            if not blob.exists():
                logger.info(f"GCS token object 'gs://{self.bucket_name}/{self.object_name}' does not exist.")
                return False

            with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp_file:
                tmp_path = Path(tmp_file.name)

            blob.download_to_filename(str(tmp_path))
            logger.info(f"Downloaded token archive from gs://{self.bucket_name}/{self.object_name}.")

            with tarfile.open(tmp_path, "r:gz") as tar:
                tar.extractall(path=dest_path)

            tmp_path.unlink(missing_ok=True)
            logger.info(f"Restored GCS token archive to '{dest_path}'.")
            return True
        except Exception as e:
            logger.warning(f"Failed to restore token archive from GCS: {e}")
            return False

    def persist(self, source: Path) -> None:
        source_path = Path(source).expanduser().resolve()
        if not source_path.exists() or not any(source_path.iterdir()):
            logger.warning(f"Source token directory '{source_path}' is empty. Skipping GCS upload.")
            return

        try:
            from google.cloud import storage
        except ImportError:
            logger.error("google-cloud-storage is required for GcsTokenStore.")
            return

        try:
            with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp_file:
                tmp_path = Path(tmp_file.name)

            with tarfile.open(tmp_path, "w:gz") as tar:
                for item in source_path.iterdir():
                    tar.add(item, arcname=item.name)

            client = storage.Client()
            bucket = client.bucket(self.bucket_name)
            blob = bucket.blob(self.object_name)

            blob.upload_from_filename(str(tmp_path))
            tmp_path.unlink(missing_ok=True)
            logger.info(f"Successfully persisted refreshed tokens to gs://{self.bucket_name}/{self.object_name}.")
        except Exception as e:
            logger.error(f"Failed to upload token archive to GCS: {e}")


def create_token_store(
    store_type: str = "local",
    local_dir: str = ".garth",
    bucket_name: str | None = None,
    object_name: str | None = "garmin_tokens.tar.gz",
) -> TokenStore:
    if store_type.lower() == "gcs":
        if not bucket_name:
            raise ValueError("GCS token store requested but bucket_name is not configured.")
        return GcsTokenStore(bucket_name=bucket_name, object_name=object_name or "garmin_tokens.tar.gz")
    return LocalTokenStore(storage_dir=local_dir)
