"""Strict, in-memory decoding boundary for Garmin original activity downloads.

This module is intentionally Garmin-facing but its output uses generic device and
sample concepts.  It never logs or persists original bytes, locations, serial numbers,
or complete traces.  A decoder error is all-or-nothing: callers must retain the base
activity and treat fidelity as unassessed rather than using partial messages.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Any
from zipfile import BadZipFile, ZipFile, is_zipfile

import fitdecode

_MAX_ORIGINAL_BYTES = 16 * 1024 * 1024


class FitActivityDecodeError(ValueError):
    """The original activity cannot safely yield fidelity evidence."""


@dataclass(frozen=True)
class FitDeviceInventoryEntry:
    """Non-identifying device metadata needed for source-inventory reasoning."""

    device_index: int | None
    manufacturer: str | int | None
    product: str | int | None
    device_type: str | int | None
    source_type: str | int | None


@dataclass(frozen=True)
class FitRecordSample:
    """Transient sample values used only by deterministic HR diagnostics."""

    timestamp: datetime | None
    heart_rate_bpm: float | None
    cadence_rpm: float | None
    power_watts: float | None


@dataclass(frozen=True)
class FitActivityEvidence:
    """Compact decoded evidence; callers must not persist ``records`` verbatim."""

    devices: tuple[FitDeviceInventoryEntry, ...]
    records: tuple[FitRecordSample, ...]
    average_heart_rate_bpm: float | None
    lap_average_heart_rate_bpm: tuple[float, ...]
    time_in_hr_zone_seconds: tuple[float, ...]


def decode_activity_original(original: bytes) -> FitActivityEvidence:
    """Decode one bare FIT or one-FIT ZIP original using strict CRC/error handling."""
    fit_bytes = _extract_fit_bytes(original)
    devices: list[FitDeviceInventoryEntry] = []
    records: list[FitRecordSample] = []
    lap_average_heart_rate_bpm: list[float] = []
    time_in_hr_zone_seconds: list[float] = []
    average_heart_rate_bpm: float | None = None

    try:
        with fitdecode.FitReader(
            BytesIO(fit_bytes),
            check_crc=fitdecode.CrcCheck.RAISE,
            error_handling=fitdecode.ErrorHandling.RAISE,
        ) as reader:
            for message in reader:
                name = getattr(message, "name", None)
                if name == "device_info":
                    devices.append(
                        FitDeviceInventoryEntry(
                            device_index=_integer(_value(message, "device_index")),
                            manufacturer=_identifier(_value(message, "manufacturer")),
                            product=_identifier(_value(message, "product")),
                            device_type=_identifier(_value(message, "device_type")),
                            source_type=_identifier(_value(message, "source_type")),
                        )
                    )
                elif name == "record":
                    records.append(
                        FitRecordSample(
                            timestamp=_timestamp(_value(message, "timestamp")),
                            heart_rate_bpm=_number(_value(message, "heart_rate")),
                            cadence_rpm=_number(_value(message, "cadence")),
                            power_watts=_number(_value(message, "power")),
                        )
                    )
                elif name == "session":
                    average_heart_rate_bpm = _number(_value(message, "avg_heart_rate"))
                elif name == "lap":
                    average = _number(_value(message, "avg_heart_rate"))
                    if average is not None:
                        lap_average_heart_rate_bpm.append(average)
                elif name == "time_in_zone":
                    seconds = _number(_value(message, "time_in_hr_zone"))
                    if seconds is not None:
                        time_in_hr_zone_seconds.append(seconds)
    except Exception as error:
        raise FitActivityDecodeError(
            "Original activity FIT could not be decoded safely."
        ) from error

    return FitActivityEvidence(
        devices=tuple(devices),
        records=tuple(records),
        average_heart_rate_bpm=average_heart_rate_bpm,
        lap_average_heart_rate_bpm=tuple(lap_average_heart_rate_bpm),
        time_in_hr_zone_seconds=tuple(time_in_hr_zone_seconds),
    )


def _extract_fit_bytes(original: bytes) -> bytes:
    if not isinstance(original, bytes) or not original:
        raise FitActivityDecodeError("Original activity download is empty or not binary.")
    if len(original) > _MAX_ORIGINAL_BYTES:
        raise FitActivityDecodeError("Original activity download exceeds the HRF size limit.")
    if len(original) >= 12 and original[8:12] == b".FIT":
        return original
    try:
        if not is_zipfile(BytesIO(original)):
            raise FitActivityDecodeError(
                "Original activity is neither a FIT file nor a ZIP archive."
            )
        with ZipFile(BytesIO(original)) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            fit_members = [member for member in members if member.filename.lower().endswith(".fit")]
            if len(fit_members) != 1 or len(members) != 1:
                raise FitActivityDecodeError(
                    "Original activity ZIP must contain exactly one FIT file."
                )
            member = fit_members[0]
            if member.file_size <= 0 or member.file_size > _MAX_ORIGINAL_BYTES:
                raise FitActivityDecodeError(
                    "Original activity FIT member exceeds the HRF size limit."
                )
            return archive.read(member)
    except BadZipFile as error:
        raise FitActivityDecodeError("Original activity ZIP is malformed.") from error


def _value(message: Any, name: str) -> Any:
    getter = getattr(message, "get_value", None)
    return getter(name) if callable(getter) else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _identifier(value: Any) -> str | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (str, int)):
        return value
    return None


def _timestamp(value: Any) -> datetime | None:
    return value if isinstance(value, datetime) else None
