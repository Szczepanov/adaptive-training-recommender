"""Server-side contract validation for athlete-authored anthropometry entries.

The browser runs equivalent validation to provide immediate feedback, but this module is the
write authority. It canonicalizes every persisted field and intentionally exposes only
structural field paths on failure, never measurements or other health values.
"""

import math
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

WARSAW = ZoneInfo("Europe/Warsaw")
PROTOCOL = "home_anthropometry@1"
ENTRY_KEYS = frozenset(
    {
        "id",
        "userId",
        "date",
        "observedAt",
        "protocol",
        "context",
        "measurements",
        "schemaVersion",
        "revision",
        "createdAt",
        "updatedAt",
    }
)
CONTEXT_KEYS = frozenset(
    {
        "morningPostVoidPreIntake",
        "trainingBeforeMeasurement",
        "respiratoryState",
        "posture",
        "clothing",
    }
)
MEASUREMENT_KEYS = frozenset(
    {"metricId", "laterality", "unit", "readings", "value", "repeatabilityWarning"}
)
METRIC_BOUNDS: dict[str, tuple[float, float, str]] = {
    "body_mass_kg": (20.0, 350.0, "kg"),
    "waist_minimum_cm": (40.0, 200.0, "cm"),
    "abdomen_umbilicus_cm": (40.0, 200.0, "cm"),
    "hips_max_cm": (50.0, 220.0, "cm"),
    "chest_nipple_line_cm": (50.0, 200.0, "cm"),
    "upper_arm_relaxed_mid_cm": (15.0, 70.0, "cm"),
    "forearm_max_cm": (12.0, 55.0, "cm"),
    "thigh_mid_cm": (25.0, 110.0, "cm"),
    "calf_max_cm": (15.0, 70.0, "cm"),
}
LIMB_METRICS = frozenset(
    {"upper_arm_relaxed_mid_cm", "forearm_max_cm", "thigh_mid_cm", "calf_max_cm"}
)


class AnthropometryEntryValidationError(ValueError):
    """A safe validation failure containing field paths, not untrusted values."""

    def __init__(self, fields: list[str] | tuple[str, ...]) -> None:
        self.fields = tuple(dict.fromkeys(fields))
        super().__init__(f"Invalid anthropometry entry fields: {', '.join(self.fields)}")


def is_valid_entry_id(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and len(value) <= 160
        and value not in {".", ".."}
        and "/" not in value
    )


def _is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _as_utc_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _is_valid_date(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") == value
    except ValueError:
        return False


def _round_positive(value: float, places: int) -> float:
    factor = 10**places
    return math.floor(value * factor + 0.5) / factor


def _nearly_equal(left: float, right: float) -> bool:
    return abs(left - right) <= 1e-9


def _pair_exceeds_tolerance(first: float, second: float) -> bool:
    return abs(first - second) - max(1.0, ((first + second) / 2) * 0.01) > 1e-6


def _validate_context(raw: object, errors: list[str]) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping) or set(raw) - CONTEXT_KEYS:
        errors.append("context")
        return None

    morning = raw.get("morningPostVoidPreIntake")
    trained = raw.get("trainingBeforeMeasurement")
    if not isinstance(morning, bool):
        errors.append("context.morningPostVoidPreIntake")
    if not isinstance(trained, bool):
        errors.append("context.trainingBeforeMeasurement")

    respiratory = raw.get("respiratoryState")
    if respiratory is not None and respiratory not in {"relaxed_normal_expiration", "other"}:
        errors.append("context.respiratoryState")
    posture = raw.get("posture")
    if posture is not None and posture not in {"standing_relaxed", "other"}:
        errors.append("context.posture")
    clothing = raw.get("clothing")
    if clothing is not None and clothing not in {
        "minimal_or_bare_skin",
        "light_clothing",
        "other",
    }:
        errors.append("context.clothing")

    if any(field == "context" or field.startswith("context.") for field in errors):
        return None
    return {
        "morningPostVoidPreIntake": morning,
        "trainingBeforeMeasurement": trained,
        **({"respiratoryState": respiratory} if isinstance(respiratory, str) else {}),
        **({"posture": posture} if isinstance(posture, str) else {}),
        **({"clothing": clothing} if isinstance(clothing, str) else {}),
    }


def _validate_measurement(raw: object, index: int, errors: list[str]) -> dict[str, Any] | None:
    field = f"measurements[{index}]"
    if not isinstance(raw, Mapping) or set(raw) - MEASUREMENT_KEYS:
        errors.append(field)
        return None

    metric_id = raw.get("metricId")
    if not isinstance(metric_id, str) or metric_id not in METRIC_BOUNDS:
        errors.append(f"{field}.metricId")
        return None
    minimum, maximum, unit = METRIC_BOUNDS[metric_id]
    if raw.get("unit") != unit:
        errors.append(f"{field}.unit")

    laterality = raw.get("laterality")
    if metric_id in LIMB_METRICS:
        if "laterality" not in raw:
            laterality = "unspecified"
        elif laterality not in {"left", "right", "unspecified"}:
            errors.append(f"{field}.laterality")
    elif "laterality" in raw and laterality is not None:
        errors.append(f"{field}.laterality")
        laterality = None

    readings = raw.get("readings")
    if not isinstance(readings, list):
        errors.append(f"{field}.readings")
        return None
    expected_count = len(readings) == 1 if metric_id == "body_mass_kg" else 2 <= len(readings) <= 3
    if not expected_count:
        errors.append(f"{field}.readings")
    numeric_readings: list[float] = []
    for reading_index, reading in enumerate(readings):
        if not _is_finite_number(reading) or reading < minimum or reading > maximum:
            errors.append(f"{field}.readings[{reading_index}]")
        else:
            numeric_readings.append(float(reading))

    value = raw.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        numeric_value = 0.0
        errors.append(f"{field}.value")
    else:
        numeric_value = float(value)
    if numeric_value < minimum or numeric_value > maximum:
        errors.append(f"{field}.value")
    repeatability_warning = raw.get("repeatabilityWarning")
    if "repeatabilityWarning" in raw and not isinstance(repeatability_warning, bool):
        errors.append(f"{field}.repeatabilityWarning")

    if any(issue == field or issue.startswith(f"{field}.") for issue in errors):
        return None

    if metric_id == "body_mass_kg":
        return _canonicalize_body_mass(
            numeric_readings, numeric_value, "repeatabilityWarning" in raw, unit, field, errors
        )

    return _canonicalize_circumference(
        numeric_readings,
        numeric_value,
        metric_id,
        raw.get("repeatabilityWarning") if "repeatabilityWarning" in raw else None,
        unit,
        laterality,
        field,
        errors,
    )


def _canonicalize_body_mass(
    numeric_readings: list[float],
    numeric_value: float,
    has_repeatability_warning: bool,
    unit: str,
    field: str,
    errors: list[str],
) -> dict[str, Any] | None:
    canonical_readings = [_round_positive(numeric_readings[0], 2)]
    expected_value = canonical_readings[0]
    if not _nearly_equal(numeric_value, expected_value):
        errors.append(f"{field}.value")
    if has_repeatability_warning:
        errors.append(f"{field}.repeatabilityWarning")
    if any(issue == field or issue.startswith(f"{field}.") for issue in errors):
        return None
    return {
        "metricId": "body_mass_kg",
        "unit": unit,
        "readings": canonical_readings,
        "value": expected_value,
    }


def _canonicalize_circumference(
    numeric_readings: list[float],
    numeric_value: float,
    metric_id: str,
    repeatability_warning: object,
    unit: str,
    laterality: object,
    field: str,
    errors: list[str],
) -> dict[str, Any] | None:
    has_repeatability_warning = repeatability_warning is not None
    canonical_readings = [_round_positive(reading, 1) for reading in numeric_readings]
    pair_exceeded = _pair_exceeds_tolerance(canonical_readings[0], canonical_readings[1])
    if (pair_exceeded and len(canonical_readings) != 3) or (
        not pair_exceeded and len(canonical_readings) != 2
    ):
        errors.append(f"{field}.readings")
    sorted_readings = sorted(canonical_readings)
    middle = len(sorted_readings) // 2
    median = (
        sorted_readings[middle]
        if len(sorted_readings) % 2
        else (sorted_readings[middle - 1] + sorted_readings[middle]) / 2
    )
    expected_value = _round_positive(median, 1)
    if not _nearly_equal(numeric_value, expected_value):
        errors.append(f"{field}.value")
    if has_repeatability_warning and repeatability_warning != pair_exceeded:
        errors.append(f"{field}.repeatabilityWarning")
    if any(issue == field or issue.startswith(f"{field}.") for issue in errors):
        return None
    return {
        "metricId": metric_id,
        **({"laterality": laterality} if isinstance(laterality, str) else {}),
        "unit": unit,
        "readings": canonical_readings,
        "value": expected_value,
        "repeatabilityWarning": pair_exceeded,
    }


def validate_entry(raw: object) -> dict[str, Any]:
    """Validate and canonicalize one server-authoritative entry payload."""
    errors: list[str] = []
    if not isinstance(raw, Mapping) or set(raw) - ENTRY_KEYS:
        raise AnthropometryEntryValidationError(("entry",))

    entry_id = raw.get("id")
    if not is_valid_entry_id(entry_id):
        errors.append("id")
    user_id = raw.get("userId")
    if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > 160:
        errors.append("userId")
    date = raw.get("date")
    if not _is_valid_date(date):
        errors.append("date")
    observed_at = raw.get("observedAt")
    observed_instant = _as_utc_datetime(observed_at)
    if observed_instant is None:
        errors.append("observedAt")
    elif isinstance(date, str) and _is_valid_date(date):
        if observed_instant.astimezone(WARSAW).date().isoformat() != date:
            errors.append("observedAt")
    if raw.get("protocol") != PROTOCOL:
        errors.append("protocol")
    if raw.get("schemaVersion") != 1:
        errors.append("schemaVersion")
    revision = raw.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        errors.append("revision")
    if _as_utc_datetime(raw.get("createdAt")) is None:
        errors.append("createdAt")
    if _as_utc_datetime(raw.get("updatedAt")) is None:
        errors.append("updatedAt")

    context = _validate_context(raw.get("context"), errors)
    measurements_raw = raw.get("measurements")
    if not isinstance(measurements_raw, list) or not 1 <= len(measurements_raw) <= 10:
        errors.append("measurements")
        measurements_raw = []
    measurements: list[dict[str, Any]] = []
    seen_series: set[tuple[str, str]] = set()
    for index, measurement_raw in enumerate(measurements_raw):
        measurement = _validate_measurement(measurement_raw, index, errors)
        if measurement is None:
            continue
        series = (str(measurement["metricId"]), str(measurement.get("laterality", "unspecified")))
        if series in seen_series:
            errors.append(f"measurements[{index}]")
        else:
            seen_series.add(series)
            measurements.append(measurement)

    if errors or context is None:
        raise AnthropometryEntryValidationError(errors)
    return {
        "id": entry_id,
        "userId": user_id,
        "date": date,
        "observedAt": observed_at,
        "protocol": PROTOCOL,
        "context": context,
        "measurements": measurements,
        "schemaVersion": 1,
        "revision": revision,
        "createdAt": raw["createdAt"],
        "updatedAt": raw["updatedAt"],
    }
