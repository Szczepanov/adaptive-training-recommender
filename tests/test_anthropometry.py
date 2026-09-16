from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import pytest

from garmin_sync.anthropometry import (
    AnthropometryEntryValidationError,
    _as_utc_datetime,
    _canonicalize_body_mass,
    _canonicalize_circumference,
    _is_finite_number,
    _is_valid_date,
    _nearly_equal,
    _pair_exceeds_tolerance,
    _round_positive,
    _validate_context,
    _validate_measurement,
    is_valid_entry_id,
    validate_entry,
)


def sample_entry() -> dict[str, Any]:
    return {
        "id": "entry-123",
        "userId": "user-456",
        "date": "2026-09-14",
        "observedAt": "2026-09-14T06:00:00.000Z",
        "protocol": "home_anthropometry@1",
        "context": {
            "morningPostVoidPreIntake": True,
            "trainingBeforeMeasurement": False,
            "respiratoryState": "relaxed_normal_expiration",
            "posture": "standing_relaxed",
            "clothing": "minimal_or_bare_skin",
        },
        "measurements": [
            {
                "metricId": "body_mass_kg",
                "unit": "kg",
                "readings": [70.5],
                "value": 70.5,
            },
            {
                "metricId": "thigh_mid_cm",
                "laterality": "left",
                "unit": "cm",
                "readings": [55.0, 55.2],
                "value": 55.1,
            },
        ],
        "schemaVersion": 1,
        "revision": 1,
        "createdAt": "2026-09-14T06:00:00.000Z",
        "updatedAt": "2026-09-14T06:00:00.000Z",
    }


def test_validation_error_deduplicates_fields() -> None:
    err = AnthropometryEntryValidationError(["field_a", "field_b", "field_a"])
    assert err.fields == ("field_a", "field_b")
    assert "Invalid anthropometry entry fields: field_a, field_b" in str(err)


def test_is_valid_entry_id() -> None:
    assert is_valid_entry_id("valid-id_123") is True
    assert is_valid_entry_id("") is False
    assert is_valid_entry_id("   ") is False
    assert is_valid_entry_id("a" * 161) is False
    assert is_valid_entry_id(".") is False
    assert is_valid_entry_id("..") is False
    assert is_valid_entry_id("path/to/id") is False
    assert is_valid_entry_id(123) is False


def test_is_finite_number() -> None:
    assert _is_finite_number(10) is True
    assert _is_finite_number(10.5) is True
    assert _is_finite_number(True) is False
    assert _is_finite_number(False) is False
    assert _is_finite_number(math.nan) is False
    assert _is_finite_number(math.inf) is False
    assert _is_finite_number(-math.inf) is False
    assert _is_finite_number("10") is False


def test_as_utc_datetime() -> None:
    parsed = _as_utc_datetime("2026-09-14T06:00:00.000Z")
    assert parsed == datetime(2026, 9, 14, 6, 0, tzinfo=timezone.utc)

    assert _as_utc_datetime("invalid-date") is None
    assert _as_utc_datetime("2026-09-14T06:00:00") is None  # missing tzinfo
    assert _as_utc_datetime(123456) is None


def test_is_valid_date() -> None:
    assert _is_valid_date("2026-09-14") is True
    assert _is_valid_date("2026-02-30") is False
    assert _is_valid_date("2026/09/14") is False
    assert _is_valid_date("2026-9-14") is False
    assert _is_valid_date(20260914) is False


def test_round_positive_and_nearly_equal() -> None:
    assert _round_positive(12.345, 2) == 12.35
    assert _round_positive(12.344, 2) == 12.34
    assert _nearly_equal(10.0000000001, 10.0) is True
    assert _nearly_equal(10.01, 10.0) is False


def test_pair_exceeds_tolerance() -> None:
    # 1% tolerance threshold for ~50cm is 0.5cm (max 1.0, so tolerance is 1.0)
    assert _pair_exceeds_tolerance(50.0, 50.5) is False
    assert _pair_exceeds_tolerance(50.0, 51.5) is True


def test_validate_context() -> None:
    errors: list[str] = []
    ctx = {
        "morningPostVoidPreIntake": True,
        "trainingBeforeMeasurement": False,
        "respiratoryState": "relaxed_normal_expiration",
        "posture": "standing_relaxed",
        "clothing": "minimal_or_bare_skin",
    }
    result = _validate_context(ctx, errors)
    assert errors == []
    assert result == ctx

    # Invalid context type / unexpected keys
    errors = []
    assert _validate_context("not-a-dict", errors) is None
    assert errors == ["context"]

    errors = []
    assert _validate_context({**ctx, "extra": True}, errors) is None
    assert errors == ["context"]

    # Invalid values inside context
    errors = []
    bad_ctx = {
        "morningPostVoidPreIntake": "yes",
        "trainingBeforeMeasurement": None,
        "respiratoryState": "invalid",
        "posture": "invalid",
        "clothing": "invalid",
    }
    assert _validate_context(bad_ctx, errors) is None
    assert errors == [
        "context.morningPostVoidPreIntake",
        "context.trainingBeforeMeasurement",
        "context.respiratoryState",
        "context.posture",
        "context.clothing",
    ]


def test_validate_measurement_body_mass() -> None:
    errors: list[str] = []
    raw = {
        "metricId": "body_mass_kg",
        "unit": "kg",
        "readings": [70.5],
        "value": 70.5,
    }
    res = _validate_measurement(raw, 0, errors)
    assert errors == []
    assert res == {
        "metricId": "body_mass_kg",
        "unit": "kg",
        "readings": [70.5],
        "value": 70.5,
    }

    # Body mass with repeatability warning should fail
    errors = []
    raw_with_warn = {**raw, "repeatabilityWarning": True}
    res = _validate_measurement(raw_with_warn, 0, errors)
    assert res is None
    assert "measurements[0].repeatabilityWarning" in errors


def test_validate_measurement_circumference_3_readings() -> None:
    errors: list[str] = []
    # First 2 readings differ by > 1cm (50.0 vs 52.0), pair exceeds tolerance, so 3 readings are required
    raw = {
        "metricId": "waist_minimum_cm",
        "unit": "cm",
        "readings": [50.0, 52.0, 51.0],
        "value": 51.0,
        "repeatabilityWarning": True,
    }
    res = _validate_measurement(raw, 0, errors)
    assert errors == []
    assert res == {
        "metricId": "waist_minimum_cm",
        "unit": "cm",
        "readings": [50.0, 52.0, 51.0],
        "value": 51.0,
        "repeatabilityWarning": True,
    }


def test_validate_measurement_limb_laterality() -> None:
    # Limb metric requires laterality or defaults to "unspecified"
    errors: list[str] = []
    raw = {
        "metricId": "thigh_mid_cm",
        "unit": "cm",
        "readings": [50.0, 50.2],
        "value": 50.1,
    }
    res = _validate_measurement(raw, 0, errors)
    assert errors == []
    assert res is not None and res["laterality"] == "unspecified"

    # Non-limb metric having laterality should produce error
    errors = []
    raw_non_limb = {
        "metricId": "waist_minimum_cm",
        "laterality": "left",
        "unit": "cm",
        "readings": [80.0, 80.2],
        "value": 80.1,
    }
    res = _validate_measurement(raw_non_limb, 0, errors)
    assert res is None
    assert "measurements[0].laterality" in errors


def test_validate_measurement_errors() -> None:
    errors: list[str] = []
    # Not mapping
    assert _validate_measurement("not-a-dict", 0, errors) is None
    assert errors == ["measurements[0]"]

    # Invalid metricId / unit
    errors = []
    raw_invalid = {
        "metricId": "unknown_metric",
        "unit": "lbs",
        "readings": [10.0],
        "value": 10.0,
    }
    assert _validate_measurement(raw_invalid, 1, errors) is None
    assert "measurements[1].metricId" in errors

    # Out of bounds reading / value
    errors = []
    raw_oob = {
        "metricId": "body_mass_kg",
        "unit": "kg",
        "readings": [10.0],  # min is 20.0
        "value": 10.0,
    }
    assert _validate_measurement(raw_oob, 2, errors) is None
    assert "measurements[2].readings[0]" in errors
    assert "measurements[2].value" in errors


def test_canonicalize_body_mass_value_mismatch() -> None:
    errors: list[str] = []
    res = _canonicalize_body_mass([70.0], 75.0, False, "kg", "measurements[0]", errors)
    assert res is None
    assert "measurements[0].value" in errors


def test_canonicalize_circumference_reading_count_mismatch() -> None:
    errors: list[str] = []
    # Pair does not exceed tolerance, but 3 readings provided
    res = _canonicalize_circumference(
        [50.0, 50.2, 50.1],
        50.1,
        "waist_minimum_cm",
        False,
        "cm",
        None,
        "measurements[0]",
        errors,
    )
    assert res is None
    assert "measurements[0].readings" in errors


def test_validate_entry_valid() -> None:
    entry = sample_entry()
    validated = validate_entry(entry)
    assert validated["id"] == "entry-123"
    assert validated["userId"] == "user-456"
    assert len(validated["measurements"]) == 2


def test_validate_entry_invalid_root_and_fields() -> None:
    with pytest.raises(AnthropometryEntryValidationError) as exc:
        validate_entry("not-a-dict")
    assert exc.value.fields == ("entry",)

    entry = sample_entry()
    entry["id"] = ""
    entry["userId"] = ""
    entry["date"] = "invalid-date"
    entry["protocol"] = "wrong_protocol"
    entry["schemaVersion"] = 2
    entry["revision"] = 0

    with pytest.raises(AnthropometryEntryValidationError) as exc:
        validate_entry(entry)
    assert "id" in exc.value.fields
    assert "userId" in exc.value.fields
    assert "date" in exc.value.fields
    assert "protocol" in exc.value.fields
    assert "schemaVersion" in exc.value.fields
    assert "revision" in exc.value.fields


def test_validate_entry_duplicate_measurement_series() -> None:
    entry = sample_entry()
    entry["measurements"].append(
        {
            "metricId": "body_mass_kg",
            "unit": "kg",
            "readings": [71.0],
            "value": 71.0,
        }
    )
    with pytest.raises(AnthropometryEntryValidationError) as exc:
        validate_entry(entry)
    assert "measurements[2]" in exc.value.fields
