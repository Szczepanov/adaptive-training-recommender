import dataclasses
import gzip
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger(__name__)

_SAFE_ARCHIVE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_archive_identifier(value: str, name: str) -> str:
    if not _SAFE_ARCHIVE_SEGMENT.fullmatch(value) or value in {".", ".."}:
        raise ValueError(f"Invalid archive {name}; only safe object-name segments are allowed.")
    return value


def _validate_logical_date(logical_date: str) -> str:
    if not _ISO_DATE.fullmatch(logical_date):
        raise ValueError("Invalid archive logical date; expected YYYY-MM-DD.")
    try:
        datetime.strptime(logical_date, "%Y-%m-%d")
    except ValueError as error:
        raise ValueError("Invalid archive logical date; expected a real calendar date.") from error
    return logical_date


def _payload_sha256(payload: Any) -> str:
    body = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def _object_dir(prefix: str, endpoint: str, logical_date: str) -> str:
    _validate_archive_identifier(endpoint, "endpoint")
    _validate_logical_date(logical_date)
    year, month = logical_date[:4], logical_date[5:7]
    return f"{prefix}/{endpoint}/{year}/{month}/{logical_date}"


def compute_observation_id(
    user_id: str,
    provider: str,
    transport: str,
    metric: str,
    source_record_id: str | None = None,
    observed_start: str | None = None,
    observed_end: str | None = None,
    payload_content: Any = None,
) -> str:
    """Compute deterministic observation ID per ADR-0027 / MS2."""
    if source_record_id:
        key = f"{user_id}:{provider}:{transport}:{metric}:{source_record_id}"
    else:
        payload_hash = _payload_sha256(payload_content) if payload_content is not None else ""
        key = f"{user_id}:{provider}:{transport}:{metric}:{observed_start or ''}:{observed_end or ''}:{payload_hash}"
    return f"sha256:{hashlib.sha256(key.encode('utf-8')).hexdigest()}"


@dataclasses.dataclass(frozen=True)
class ArchiveRecord:
    endpoint: str
    logical_date: str
    payload: Any
    sync_run_id: str
    garminconnect_version: str | None = None


@dataclasses.dataclass(frozen=True)
class HealthArchiveRecord:
    user_id: str
    provider: str
    transport: str
    logical_date: str
    payload: Any
    revision: int = 1
    normalizer_version: int = 1


class RawArchiveStore(Protocol):
    def archive(self, record: ArchiveRecord) -> str | None:
        """Archive a raw payload for (endpoint, logical_date). Returns the object path,
        or None if skipped because an identical payload is already archived for that
        date (content-addressed idempotency -- repeated same-day syncs don't duplicate)."""
        ...

    def archive_health(self, record: HealthArchiveRecord) -> str | None:
        """Archive a raw health observation payload for (provider, transport, logical_date)."""
        ...

    def load(self, endpoint: str, logical_date: str) -> Any | None:
        """Load the most recently archived payload for (endpoint, logical_date), or None
        if nothing is archived."""
        ...

    def list_archived_dates(self, endpoint: str, start_date: str, end_date: str) -> set[str]:
        """Return the set of logical dates in [start_date, end_date] that have at least
        one archived payload for this endpoint."""
        ...


class NullArchiveStore:
    """No-op store used when archiving is disabled."""

    def archive(self, record: ArchiveRecord) -> None:
        return None

    def archive_health(self, record: HealthArchiveRecord) -> None:
        return None

    def load(self, endpoint: str, logical_date: str) -> None:
        return None

    def list_archived_dates(self, endpoint: str, start_date: str, end_date: str) -> set[str]:
        return set()


class LocalRawArchiveStore:
    """Filesystem mirror of the GCS raw archive layout, for local dev/tests."""

    def __init__(self, base_dir: Path | str = ".garmin_archive", prefix: str = "raw/garmin"):
        self.base_dir = Path(base_dir).expanduser().resolve()
        self.prefix = prefix

    def _dir(self, endpoint: str, logical_date: str) -> Path:
        return self.base_dir / _object_dir(self.prefix, endpoint, logical_date)

    def archive(self, record: ArchiveRecord) -> str | None:
        _validate_archive_identifier(record.sync_run_id, "sync run ID")
        target_dir = self._dir(record.endpoint, record.logical_date)
        payload_hash = _payload_sha256(record.payload)

        if target_dir.exists():
            for existing in target_dir.glob("*.meta.json"):
                try:
                    meta = json.loads(existing.read_text())
                    if meta.get("payloadSha256") == payload_hash:
                        logger.debug(
                            f"Skipping archive for {record.endpoint}/{record.logical_date}: identical payload already archived."
                        )
                        return None
                except Exception:
                    continue

        target_dir.mkdir(parents=True, exist_ok=True)
        object_path = target_dir / f"{record.sync_run_id}.json.gz"
        meta_path = target_dir / f"{record.sync_run_id}.meta.json"

        with gzip.open(object_path, "wt", encoding="utf-8") as f:
            json.dump(record.payload, f, default=str)

        metadata = {
            "provider": "garmin_connect_unofficial",
            "endpoint": record.endpoint,
            "logicalDate": record.logical_date,
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "garminconnectVersion": record.garminconnect_version,
            "payloadSha256": payload_hash,
            "syncRunId": record.sync_run_id,
        }
        meta_path.write_text(json.dumps(metadata, indent=2))
        logger.info(f"Archived {record.endpoint}/{record.logical_date} -> {object_path}")
        return str(object_path)

    def archive_health(self, record: HealthArchiveRecord) -> str | None:
        _validate_archive_identifier(record.user_id, "user ID")
        # endpoint must be a single safe path segment (_object_dir validates it as one);
        # "health/" is a directory level, not part of the segment -- so it goes on the
        # instance prefix, matching how _object_dir/_validate_archive_identifier are used
        # everywhere else. See docs/plans/2026-08-27-real-google-health-ingestion.md.
        endpoint = f"{record.provider}_{record.transport}"
        log_label = f"health/{endpoint}"
        target_dir = self.base_dir / _object_dir(
            f"{self.prefix}/health", endpoint, record.logical_date
        )
        payload_hash = _payload_sha256(record.payload)

        if target_dir.exists():
            for existing in target_dir.glob("*.meta.json"):
                try:
                    meta = json.loads(existing.read_text())
                    if meta.get("payloadSha256") == payload_hash:
                        logger.debug(
                            f"Skipping health archive for {log_label}/{record.logical_date}: identical payload already archived."
                        )
                        return None
                except Exception:
                    continue

        target_dir.mkdir(parents=True, exist_ok=True)
        object_path = target_dir / f"rev_{record.revision}.json.gz"
        meta_path = target_dir / f"rev_{record.revision}.meta.json"

        with gzip.open(object_path, "wt", encoding="utf-8") as f:
            json.dump(record.payload, f, default=str)

        metadata = {
            "userId": record.user_id,
            "provider": record.provider,
            "transport": record.transport,
            "logicalDate": record.logical_date,
            "revision": record.revision,
            "normalizerVersion": record.normalizer_version,
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "payloadSha256": payload_hash,
        }
        meta_path.write_text(json.dumps(metadata, indent=2))
        logger.info(f"Archived health {log_label}/{record.logical_date} -> {object_path}")
        return str(object_path)

    def load(self, endpoint: str, logical_date: str) -> Any | None:
        target_dir = self._dir(endpoint, logical_date)
        if not target_dir.exists():
            return None
        candidates = sorted(target_dir.glob("*.json.gz"))
        if not candidates:
            return None
        with gzip.open(candidates[-1], "rt", encoding="utf-8") as f:
            return json.load(f)

    def list_archived_dates(self, endpoint: str, start_date: str, end_date: str) -> set[str]:
        endpoint_dir = self.base_dir / self.prefix / endpoint
        if not endpoint_dir.exists():
            return set()
        found: set[str] = set()
        for date_dir in endpoint_dir.glob("*/*/*"):
            if (
                date_dir.is_dir()
                and start_date <= date_dir.name <= end_date
                and any(date_dir.glob("*.json.gz"))
            ):
                found.add(date_dir.name)
        return found


class GcsRawArchiveStore:
    """Manages immutable raw payload archiving in Google Cloud Storage."""

    def __init__(self, bucket_name: str, prefix: str = "raw/garmin"):
        self.bucket_name = bucket_name
        self.prefix = prefix

    def _client(self) -> Any:
        from google.cloud import storage  # type: ignore[attr-defined]

        return storage.Client()

    def archive(self, record: ArchiveRecord) -> str | None:
        try:
            _validate_archive_identifier(record.sync_run_id, "sync run ID")
            client = self._client()
            bucket = client.bucket(self.bucket_name)
            object_dir = _object_dir(self.prefix, record.endpoint, record.logical_date)
            payload_hash = _payload_sha256(record.payload)

            for existing_blob in client.list_blobs(bucket, prefix=f"{object_dir}/"):
                if (
                    existing_blob.metadata
                    and existing_blob.metadata.get("payloadSha256") == payload_hash
                ):
                    logger.debug(
                        f"Skipping GCS archive for {record.endpoint}/{record.logical_date}: identical payload already archived."
                    )
                    return None

            object_path = f"{object_dir}/{record.sync_run_id}.json.gz"
            blob = bucket.blob(object_path)
            blob.metadata = {
                "provider": "garmin_connect_unofficial",
                "endpoint": record.endpoint,
                "logicalDate": record.logical_date,
                "collectedAt": datetime.now(timezone.utc).isoformat(),
                "garminconnectVersion": record.garminconnect_version or "",
                "payloadSha256": payload_hash,
                "syncRunId": record.sync_run_id,
            }
            body = json.dumps(record.payload, default=str).encode("utf-8")
            compressed = gzip.compress(body)
            blob.content_encoding = "gzip"
            blob.upload_from_string(compressed, content_type="application/json")
            logger.info(
                f"Archived {record.endpoint}/{record.logical_date} -> gs://{self.bucket_name}/{object_path}"
            )
            return object_path
        except Exception as e:
            logger.error(f"Failed to archive {record.endpoint}/{record.logical_date} to GCS: {e}")
            return None

    def archive_health(self, record: HealthArchiveRecord) -> str | None:
        try:
            _validate_archive_identifier(record.user_id, "user ID")
            client = self._client()
            bucket = client.bucket(self.bucket_name)
            # endpoint must be a single safe path segment (_object_dir validates it as one);
            # "health/" is a directory level, not part of the segment -- so it goes on the
            # prefix. See docs/plans/2026-08-27-real-google-health-ingestion.md.
            endpoint = f"{record.provider}_{record.transport}"
            log_label = f"health/{endpoint}"
            object_dir = _object_dir(f"{self.prefix}/health", endpoint, record.logical_date)
            payload_hash = _payload_sha256(record.payload)

            for existing_blob in client.list_blobs(bucket, prefix=f"{object_dir}/"):
                if (
                    existing_blob.metadata
                    and existing_blob.metadata.get("payloadSha256") == payload_hash
                ):
                    logger.debug(
                        f"Skipping GCS health archive for {log_label}/{record.logical_date}: identical payload already archived."
                    )
                    return None

            object_path = f"{object_dir}/rev_{record.revision}.json.gz"
            blob = bucket.blob(object_path)
            blob.metadata = {
                "userId": record.user_id,
                "provider": record.provider,
                "transport": record.transport,
                "logicalDate": record.logical_date,
                "revision": str(record.revision),
                "normalizerVersion": str(record.normalizer_version),
                "collectedAt": datetime.now(timezone.utc).isoformat(),
                "payloadSha256": payload_hash,
            }
            body = json.dumps(record.payload, default=str).encode("utf-8")
            compressed = gzip.compress(body)
            blob.content_encoding = "gzip"
            blob.upload_from_string(compressed, content_type="application/json")
            logger.info(
                f"Archived health {log_label}/{record.logical_date} -> gs://{self.bucket_name}/{object_path}"
            )
            return object_path
        except Exception as e:
            logger.error(
                f"Failed to archive health {record.provider}_{record.transport}/{record.logical_date} to GCS: {e}"
            )
            return None

    def load(self, endpoint: str, logical_date: str) -> Any | None:
        try:
            client = self._client()
            bucket = client.bucket(self.bucket_name)
            object_dir = _object_dir(self.prefix, endpoint, logical_date)
            blobs = sorted(client.list_blobs(bucket, prefix=f"{object_dir}/"), key=lambda b: b.name)
            blobs = [b for b in blobs if b.name.endswith(".json.gz")]
            if not blobs:
                return None
            raw = blobs[-1].download_as_bytes()
            try:
                raw = gzip.decompress(raw)
            except OSError:
                pass  # not gzip-compressed (content_encoding auto-decompressed by GCS already)
            return json.loads(raw.decode("utf-8"))
        except Exception as e:
            logger.warning(f"Failed to load archived {endpoint}/{logical_date} from GCS: {e}")
            return None

    def list_archived_dates(self, endpoint: str, start_date: str, end_date: str) -> set[str]:
        try:
            client = self._client()
            bucket = client.bucket(self.bucket_name)
            found: set[str] = set()
            for blob in client.list_blobs(bucket, prefix=f"{self.prefix}/{endpoint}/"):
                logical_date = (blob.metadata or {}).get("logicalDate")
                if logical_date and start_date <= logical_date <= end_date:
                    found.add(logical_date)
            return found
        except Exception as e:
            logger.warning(f"Failed to list archived dates for {endpoint} from GCS: {e}")
            return set()


def create_archive_store(
    enabled: bool,
    store_type: str = "gcs",
    local_dir: str = ".garmin_archive",
    bucket_name: str | None = None,
    prefix: str = "raw/garmin",
) -> RawArchiveStore:
    if not enabled:
        return NullArchiveStore()
    if store_type.lower() == "gcs":
        if not bucket_name:
            raise ValueError(
                "GCS archive store requested but no bucket configured (GARMIN_ARCHIVE_BUCKET/GARMIN_TOKEN_BUCKET)."
            )
        return GcsRawArchiveStore(bucket_name=bucket_name, prefix=prefix)
    return LocalRawArchiveStore(base_dir=local_dir, prefix=prefix)
