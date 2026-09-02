"""PR 5 (training-occurrence plan, ADR-0034 "FIT structured-workout identity"): a
normalized, versioned fingerprint for a device-recorded structured workout.

The strongest available input is the FIT Workout + Workout Step definition embedded in
the recorded Activity file. Observed Lap/Record workout-step indexes are only a fallback
when a definition is absent: they describe what was executed, not the prescription
itself, and therefore must not make the fingerprint change merely because an athlete
stopped a structured workout early.

Adaptive does not currently push structured workouts to Garmin devices, so nothing on
the structured-execution side yet produces a comparable fingerprint. This module remains
additive evidence for a future correlation source and is intentionally not wired into
reconciliation scoring yet.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from .fit_activity import FitWorkoutStepEvidence

FIT_WORKOUT_FINGERPRINT_VERSION = "fit-workout-v2"


def _normalize_text(value: str | None) -> str:
    return " ".join(value.split()).casefold() if value else ""


def _normalize_identifier(value: str | int | None) -> str | int | None:
    if isinstance(value, str):
        normalized = _normalize_text(value)
        return normalized or None
    return value


def _normalize_number(value: float | None) -> int | float | None:
    if value is None or not math.isfinite(value):
        return None
    return int(value) if value.is_integer() else value


def _normalized_step(step: FitWorkoutStepEvidence) -> dict[str, Any]:
    """Canonicalize only identity-relevant FIT Workout Step fields.

    Display-only notes are deliberately excluded. Step name is retained because devices
    and authored workouts can legitimately use it to distinguish otherwise-equal open
    steps, while whitespace/case normalization avoids cosmetic fingerprint churn.
    """
    return {
        "messageIndex": step.message_index,
        "name": _normalize_text(step.name) or None,
        "durationType": _normalize_identifier(step.duration_type),
        "durationValue": _normalize_number(step.duration_value),
        "targetType": _normalize_identifier(step.target_type),
        "targetValue": _normalize_number(step.target_value),
        "customTargetValueLow": _normalize_number(step.custom_target_value_low),
        "customTargetValueHigh": _normalize_number(step.custom_target_value_high),
        "intensity": _normalize_identifier(step.intensity),
        "equipment": _normalize_identifier(step.equipment),
    }


def compute_fit_workout_fingerprint(
    workout_name: str | None,
    workout_step_indices: tuple[int, ...],
    workout_steps: tuple[FitWorkoutStepEvidence, ...] = (),
) -> str | None:
    """Return a deterministic semantic workout fingerprint when evidence exists.

    Workout Step definitions take precedence over observed step indexes. With definitions
    present, steps are normalized into canonical message-index order so equivalent files
    with harmless message-order differences converge. Without definitions, distinct
    observed indexes retain first-seen order as weaker execution-linkage evidence.

    `FitActivityEvidence.workout_step_indices` is a tuple-compatible value that can carry
    its decoded Workout Step definitions as metadata. Reading that metadata here keeps the
    existing service call shape backward compatible while upgrading its evidence quality;
    explicit `workout_steps` still wins for direct callers/tests.
    """
    if not workout_steps:
        attached_steps = getattr(workout_step_indices, "workout_steps", ())
        if isinstance(attached_steps, tuple):
            workout_steps = attached_steps

    normalized_name = _normalize_text(workout_name)

    if workout_steps:
        indexed_steps = list(enumerate(workout_steps))
        normalized_steps = [
            _normalized_step(step)
            for _, step in sorted(
                indexed_steps,
                key=lambda item: (
                    item[1].message_index is None,
                    item[1].message_index if item[1].message_index is not None else item[0],
                    item[0],
                ),
            )
        ]
        payload: dict[str, Any] = {
            "name": normalized_name or None,
            "steps": normalized_steps,
        }
    else:
        observed_steps = list(dict.fromkeys(workout_step_indices))
        if not normalized_name and not observed_steps:
            return None
        payload = {
            "name": normalized_name or None,
            "observedStepIndices": observed_steps,
        }

    digest_input = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()[:32]
    return f"{FIT_WORKOUT_FINGERPRINT_VERSION}:{digest}"
