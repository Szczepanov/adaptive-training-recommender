"""Strict, in-memory decoding boundary for Garmin original activity downloads.

This module is intentionally Garmin-facing but its output uses generic device and
sample concepts. It never logs or persists original bytes, locations, serial numbers,
or complete traces. A decoder error is all-or-nothing: callers must retain the base
activity and treat fidelity as unassessed rather than using partial messages.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Any
from zipfile import BadZipFile, LargeZipFile, ZipFile, is_zipfile

import fitdecode

_MAX_ORIGINAL_BYTES = 16 * 1024 * 1024
_MAX_DEVICE_ENTRIES = 512
_MAX_RECORD_SAMPLES = 250_000
_MAX_LAP_SUMMARIES = 10_000
_MAX_TIMER_EVENTS = 20_000
_MAX_ZONE_BUCKETS = 64
_MAX_WORKOUT_STEP_INDICES = 500
_MAX_WORKOUT_STEPS = 500
_SESSION_MESSAGE_NUMBER = 18
_ANTPLUS_HEART_RATE_DEVICE_TYPE = 120


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
class FitTimerEvent:
    """Transient timer state transition used to reconstruct active recording windows."""

    timestamp: datetime | None
    event_type: str | int | None


@dataclass(frozen=True)
class FitWorkoutStepEvidence:
    """Identity-relevant fields from one FIT Workout Step message.

    Garmin's FIT profile defines the workout by indexed duration/target/intensity
    instructions. These semantic fields are materially stronger identity evidence than
    merely observing that record/lap samples referenced step indexes 0..N.
    """

    message_index: int | None
    name: str | None
    duration_type: str | int | None
    duration_value: float | None
    target_type: str | int | None
    target_value: float | None
    custom_target_value_low: float | None
    custom_target_value_high: float | None
    intensity: str | int | None
    equipment: str | int | None


class FitWorkoutStepIndices(tuple):
    """Tuple-compatible observed step indexes with optional semantic definition metadata.

    The existing sync boundary already passes `workout_step_indices` into the fingerprint
    function. Keeping this value tuple-compatible avoids widening that service API while
    allowing the decoder to attach the stronger Workout Step definition for consumers that
    understand it. Normal tuple behavior/equality is unchanged for existing callers.
    """

    workout_steps: tuple[FitWorkoutStepEvidence, ...]

    def __new__(
        cls,
        values: list[int] | tuple[int, ...],
        workout_steps: tuple[FitWorkoutStepEvidence, ...] = (),
    ) -> "FitWorkoutStepIndices":
        instance = super().__new__(cls, values)
        instance.workout_steps = workout_steps
        return instance


@dataclass(frozen=True)
class FitActivityEvidence:
    """Compact decoded evidence; callers must not persist ``records`` verbatim."""

    devices: tuple[FitDeviceInventoryEntry, ...]
    records: tuple[FitRecordSample, ...]
    average_heart_rate_bpm: float | None
    lap_average_heart_rate_bpm: tuple[float, ...]
    time_in_hr_zone_seconds: tuple[float, ...]
    timer_events: tuple[FitTimerEvent, ...]
    # PR 5 (training-occurrence plan, ADR-0034 "FIT structured-workout identity"):
    # `workout_steps` is the semantic definition when the Activity FIT embeds Workout /
    # Workout Step messages. `workout_step_indices` is observed execution linkage from
    # Lap.workout_step_index (plus the legacy record-level fallback) and is intentionally
    # weaker evidence when the definition itself is absent.
    workout_step_indices: tuple[int, ...] = ()
    workout_name: str | None = None
    workout_steps: tuple[FitWorkoutStepEvidence, ...] = ()


def decode_activity_original(original: bytes) -> FitActivityEvidence:
    """Decode one bare FIT or one-FIT ZIP original using strict CRC/error handling."""
    fit_bytes = _extract_fit_bytes(original)
    devices: list[FitDeviceInventoryEntry] = []
    records: list[FitRecordSample] = []
    lap_average_heart_rate_bpm: list[float] = []
    time_in_hr_zone_seconds: list[float] = []
    timer_events: list[FitTimerEvent] = []
    average_heart_rate_bpm: float | None = None
    session_count = 0
    workout_step_indices: list[int] = []
    seen_workout_step_indices: set[int] = set()
    workout_name_from_session: str | None = None
    workout_name_from_definition: str | None = None
    workout_definition_count = 0
    workout_steps: list[FitWorkoutStepEvidence] = []

    def remember_workout_step_index(step_index: int | None) -> None:
        if step_index is None or step_index in seen_workout_step_indices:
            return
        _guard_capacity(
            workout_step_indices,
            _MAX_WORKOUT_STEP_INDICES,
            "workout step index",
        )
        seen_workout_step_indices.add(step_index)
        workout_step_indices.append(step_index)

    try:
        with fitdecode.FitReader(
            BytesIO(fit_bytes),
            check_crc=fitdecode.CrcCheck.RAISE,
            error_handling=fitdecode.ErrorHandling.RAISE,
        ) as reader:
            for message in reader:
                # FitReader yields header/definition/data/CRC frames. Definition
                # messages expose the same ``name`` as their data messages, so name-only
                # dispatch would manufacture all-None records/device rows.
                if getattr(message, "frame_type", None) != fitdecode.FIT_FRAME_DATA:
                    continue

                name = getattr(message, "name", None)
                if name == "device_info":
                    _guard_capacity(devices, _MAX_DEVICE_ENTRIES, "device inventory")
                    source_type = _identifier(_value(message, "source_type"))
                    devices.append(
                        FitDeviceInventoryEntry(
                            device_index=_integer(_value(message, "device_index")),
                            manufacturer=_identifier(_value(message, "manufacturer")),
                            product=_identifier(_value(message, "product")),
                            device_type=_normalize_device_type(
                                _identifier(_value(message, "device_type")),
                                source_type,
                            ),
                            source_type=source_type,
                        )
                    )
                elif name == "record":
                    _guard_capacity(records, _MAX_RECORD_SAMPLES, "record sample")
                    records.append(
                        FitRecordSample(
                            timestamp=_timestamp(_value(message, "timestamp")),
                            heart_rate_bpm=_number(_value(message, "heart_rate")),
                            cadence_rpm=_number(_value(message, "cadence")),
                            power_watts=_number(_value(message, "power")),
                        )
                    )
                    # Retain the pre-PR hardening record-level field as a compatibility
                    # fallback for files/devices exposing it, but do not treat it as a
                    # semantic workout definition.
                    remember_workout_step_index(_integer(_value(message, "workout_step")))
                elif name == "event":
                    event = _value(message, "event")
                    if event == "timer" or event == 0:
                        _guard_capacity(timer_events, _MAX_TIMER_EVENTS, "timer event")
                        timer_events.append(
                            FitTimerEvent(
                                timestamp=_timestamp(_value(message, "timestamp")),
                                event_type=_identifier(_value(message, "event_type")),
                            )
                        )
                elif name == "session":
                    session_count += 1
                    if session_count == 1:
                        average_heart_rate_bpm = _number(_value(message, "avg_heart_rate"))
                        session_zones = _numbers(_value(message, "time_in_hr_zone"))
                        if session_zones:
                            time_in_hr_zone_seconds = _bounded_zone_values(session_zones)
                        # Some Garmin-origin activity files expose this convenient session
                        # alias. The FIT-standard Workout.wkt_name below is authoritative
                        # when present.
                        workout_name_from_session = _text(_value(message, "workout_name"))
                    else:
                        # A FIT can legitimately contain several sport sessions. This
                        # boundary has only one activity-level summary slot, so choosing
                        # the last session would falsely label it as whole-activity HR.
                        average_heart_rate_bpm = None
                        time_in_hr_zone_seconds = []
                        workout_name_from_session = None
                elif name == "workout":
                    workout_definition_count += 1
                    if workout_definition_count == 1:
                        workout_name_from_definition = _text(_value(message, "wkt_name"))
                    else:
                        # The Activity profile allows at most one Workout message. Do not
                        # manufacture one fingerprint by blending multiple definitions.
                        workout_name_from_definition = None
                elif name == "workout_step":
                    _guard_capacity(workout_steps, _MAX_WORKOUT_STEPS, "workout step")
                    workout_steps.append(
                        FitWorkoutStepEvidence(
                            message_index=_integer(_value(message, "message_index")),
                            name=_text(_value(message, "wkt_step_name")),
                            duration_type=_identifier(_value(message, "duration_type")),
                            duration_value=_number(_value(message, "duration_value")),
                            target_type=_identifier(_value(message, "target_type")),
                            target_value=_number(_value(message, "target_value")),
                            custom_target_value_low=_number(_value(message, "custom_target_value_low")),
                            custom_target_value_high=_number(_value(message, "custom_target_value_high")),
                            intensity=_identifier(_value(message, "intensity")),
                            equipment=_identifier(_value(message, "equipment")),
                        )
                    )
                elif name == "lap":
                    average = _number(_value(message, "avg_heart_rate"))
                    if average is not None:
                        _guard_capacity(
                            lap_average_heart_rate_bpm,
                            _MAX_LAP_SUMMARIES,
                            "lap HR summary",
                        )
                        lap_average_heart_rate_bpm.append(average)
                    # FIT Activity files typically associate each completed workout step
                    # with a Lap via workout_step_index. This is execution linkage, not the
                    # definition itself, so it only backs the fallback fingerprint path.
                    remember_workout_step_index(_integer(_value(message, "workout_step_index")))
                elif name == "time_in_zone" and session_count <= 1 and not time_in_hr_zone_seconds:
                    # FIT time-in-zone is an array and can be scoped to session/lap via
                    # reference_mesg/reference_index. Only session-scoped data is a safe
                    # fallback for the activity-level summary; never blend lap arrays.
                    reference_mesg = _value(message, "reference_mesg")
                    if _is_session_reference(reference_mesg):
                        fallback_zones = _numbers(_value(message, "time_in_hr_zone"))
                        if fallback_zones:
                            time_in_hr_zone_seconds = _bounded_zone_values(fallback_zones)
    except FitActivityDecodeError:
        raise
    except Exception as error:
        raise FitActivityDecodeError(
            "Original activity FIT could not be decoded safely."
        ) from error

    # Multiple Workout messages violate the Activity-profile expectation and make the
    # step list ambiguous, so expose no semantic definition rather than hashing a blend.
    semantic_workout_steps = tuple(workout_steps) if workout_definition_count <= 1 else ()
    workout_name = workout_name_from_definition or workout_name_from_session
    observed_step_indices = FitWorkoutStepIndices(workout_step_indices, semantic_workout_steps)

    return FitActivityEvidence(
        devices=tuple(devices),
        records=tuple(records),
        average_heart_rate_bpm=average_heart_rate_bpm,
        lap_average_heart_rate_bpm=tuple(lap_average_heart_rate_bpm),
        time_in_hr_zone_seconds=tuple(time_in_hr_zone_seconds),
        timer_events=tuple(timer_events),
        workout_step_indices=observed_step_indices,
        workout_name=workout_name,
        workout_steps=semantic_workout_steps,
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
            with archive.open(member) as fit_stream:
                fit_bytes = fit_stream.read(_MAX_ORIGINAL_BYTES + 1)
            if len(fit_bytes) > _MAX_ORIGINAL_BYTES:
                raise FitActivityDecodeError(
                    "Original activity FIT member exceeds the HRF size limit."
                )
            return fit_bytes
    except FitActivityDecodeError:
        raise
    except (BadZipFile, LargeZipFile, RuntimeError, NotImplementedError, OSError) as error:
        raise FitActivityDecodeError("Original activity ZIP could not be read safely.") from error


def _value(message: Any, name: str) -> Any:
    getter = getattr(message, "get_value", None)
    return getter(name, fallback=None) if callable(getter) else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _numbers(value: Any) -> tuple[float, ...]:
    if isinstance(value, (list, tuple)):
        values: list[float] = []
        for item in value:
            number = _number(item)
            if number is None:
                # Array position is semantically meaningful (zone index), so never
                # compress an invalid/null element and silently shift later buckets.
                return ()
            values.append(number)
        return tuple(values)
    number = _number(value)
    return () if number is None else (number,)


def _bounded_zone_values(values: tuple[float, ...]) -> list[float]:
    if len(values) > _MAX_ZONE_BUCKETS:
        raise FitActivityDecodeError("Original activity FIT has too many HR-zone buckets.")
    return list(values)


def _is_session_reference(value: Any) -> bool:
    return value == "session" or value == _SESSION_MESSAGE_NUMBER


def _guard_capacity(values: list[Any], limit: int, label: str) -> None:
    if len(values) >= limit:
        raise FitActivityDecodeError(f"Original activity FIT exceeds the HRF {label} limit.")


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _identifier(value: Any) -> str | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (str, int)):
        return value
    return None


def _normalize_device_type(
    device_type: str | int | None,
    source_type: str | int | None,
) -> str | int | None:
    """Normalize only source-scoped FIT device enums needed for HR provenance.

    FIT field 1 is dynamic: for ANT+ sources, raw value 120 means heart-rate device.
    The numeric value is intentionally left untouched when the source is not proven
    ANT+, because interpreting it without its source discriminator could invent a
    sensor classification.
    """
    normalized_source = source_type.strip().lower() if isinstance(source_type, str) else source_type
    if normalized_source in {"antplus", 1} and device_type == _ANTPLUS_HEART_RATE_DEVICE_TYPE:
        return "heart_rate"
    return device_type


def _timestamp(value: Any) -> datetime | None:
    return value if isinstance(value, datetime) else None
