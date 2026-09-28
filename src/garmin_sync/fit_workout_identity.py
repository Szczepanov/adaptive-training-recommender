"""PR 5 (training-occurrence plan, ADR-0034 "FIT structured-workout identity"): a
normalized, versioned fingerprint for a device-recorded structured workout.

The strongest available input is the FIT Workout + Workout Step definition embedded in
the recorded Activity file. Observed Lap/Record workout-step indexes are only a fallback
when a definition is absent: they describe what was executed, not the prescription
itself, and therefore must not make the fingerprint change merely because an athlete
stopped a structured workout early.

Adaptive now generates the same semantic identity from its canonical workout export before
structured execution. Semantic fingerprints are used by reconciliation only when both sides
are definition-derived and the template was canonicalized with the same context as the Garmin
upload path. Observed-index fallbacks remain non-comparable execution evidence.
"""

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any, Literal

from .fit_activity import FitWorkoutStepEvidence

FIT_WORKOUT_FINGERPRINT_VERSION = "fit-workout-v2"

FitWorkoutFingerprintKind = Literal["semantic_definition", "index_fallback"]


@dataclass(frozen=True)
class FitWorkoutIdentity:
    fingerprint: str
    kind: FitWorkoutFingerprintKind


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


def compute_fit_workout_identity(
    workout_name: str | None,
    workout_step_indices: tuple[int, ...],
    workout_steps: tuple[FitWorkoutStepEvidence, ...] = (),
) -> FitWorkoutIdentity | None:
    """Return a deterministic semantic workout identity when evidence exists."""
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
        kind: FitWorkoutFingerprintKind = "semantic_definition"
    else:
        observed_steps = sorted(set(workout_step_indices))
        if not normalized_name and not observed_steps:
            return None
        payload = {
            "name": normalized_name or None,
            "observedStepIndices": observed_steps,
        }
        kind = "index_fallback"

    digest_input = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()[:32]
    fingerprint = f"{FIT_WORKOUT_FINGERPRINT_VERSION}:{digest}"
    return FitWorkoutIdentity(fingerprint=fingerprint, kind=kind)


def compute_fit_workout_fingerprint(
    workout_name: str | None,
    workout_step_indices: tuple[int, ...],
    workout_steps: tuple[FitWorkoutStepEvidence, ...] = (),
) -> str | None:
    """Return a deterministic semantic workout fingerprint when evidence exists.

    Workout Step definitions take precedence over observed step indexes. With definitions
    present, steps are normalized into canonical message-index order so equivalent files
    with harmless message-order differences converge. Without definitions, distinct
    observed indexes retain the pre-v2 sorted-set normalization as weaker execution
    linkage evidence.

    `FitActivityEvidence.workout_step_indices` is a tuple-compatible value that can carry
    its decoded Workout Step definitions as metadata. Reading that metadata here keeps the
    existing service call shape backward compatible while upgrading its evidence quality;
    explicit `workout_steps` still wins for direct callers/tests.
    """
    identity = compute_fit_workout_identity(workout_name, workout_step_indices, workout_steps)
    return identity.fingerprint if identity is not None else None


def garmin_payload_to_fit_steps(payload: dict[str, Any]) -> tuple[FitWorkoutStepEvidence, ...]:
    """Convert Garmin Connect workout payload into normalized FitWorkoutStepEvidence tuple."""
    sport_key = payload.get("sportType", {}).get("sportTypeKey")
    equipment = "bike" if sport_key in {"cycling", "bike"} else None
    steps: list[FitWorkoutStepEvidence] = []
    idx = 0
    raw_steps = payload.get("workoutSegments", [{}])[0].get("workoutSteps", [])
    for raw in raw_steps:
        if raw.get("type") == "RepeatGroupDTO":
            start_idx = idx
            for child in raw.get("workoutSteps", []):
                st = child.get("stepType", {}).get("stepTypeKey")
                intensity = (
                    "warmup"
                    if st == "warmup"
                    else "cooldown"
                    if st == "cooldown"
                    else "recovery"
                    if st == "recovery"
                    else "rest"
                    if st == "rest"
                    else "active"
                )
                dur_key = child.get("endCondition", {}).get("conditionTypeKey", "time")
                dur_type = (
                    "reps"
                    if dur_key == "reps"
                    else "open"
                    if dur_key == "lap.button"
                    else "distance"
                    if dur_key == "distance"
                    else "time"
                )
                dur_val = child.get("endConditionValue")
                tgt_key = child.get("targetType", {}).get("workoutTargetTypeKey")
                tgt_type = (
                    "power"
                    if tgt_key == "power.zone"
                    else "heart_rate"
                    if tgt_key == "heart.rate.zone"
                    else "speed"
                    if tgt_key == "speed.zone"
                    else "cadence"
                    if tgt_key == "cadence.zone"
                    else "open"
                )
                steps.append(
                    FitWorkoutStepEvidence(
                        message_index=idx,
                        name=child.get("description"),
                        duration_type=dur_type,
                        duration_value=float(dur_val) if dur_val is not None else None,
                        target_type=tgt_type,
                        target_value=(
                            float(child.get("zoneNumber"))
                            if child.get("zoneNumber") is not None
                            else None
                        ),
                        custom_target_value_low=(
                            float(child.get("targetValueOne"))
                            if child.get("targetValueOne") is not None
                            else None
                        ),
                        custom_target_value_high=(
                            float(child.get("targetValueTwo"))
                            if child.get("targetValueTwo") is not None
                            else None
                        ),
                        intensity=intensity,
                        equipment=equipment,
                    )
                )
                idx += 1
            reps = raw.get("numberOfIterations") or 1
            steps.append(
                FitWorkoutStepEvidence(
                    message_index=idx,
                    name=None,
                    duration_type="repeat_until_steps_cmplt",
                    duration_value=float(start_idx),
                    target_type="open",
                    target_value=float(reps),
                    custom_target_value_low=None,
                    custom_target_value_high=None,
                    intensity="active",
                    equipment=equipment,
                )
            )
            idx += 1
        else:
            st = raw.get("stepType", {}).get("stepTypeKey")
            intensity = (
                "warmup"
                if st == "warmup"
                else "cooldown"
                if st == "cooldown"
                else "recovery"
                if st == "recovery"
                else "rest"
                if st == "rest"
                else "active"
            )
            dur_key = raw.get("endCondition", {}).get("conditionTypeKey", "time")
            dur_type = (
                "reps"
                if dur_key == "reps"
                else "open"
                if dur_key == "lap.button"
                else "distance"
                if dur_key == "distance"
                else "time"
            )
            dur_val = raw.get("endConditionValue")
            tgt_key = raw.get("targetType", {}).get("workoutTargetTypeKey")
            tgt_type = (
                "power"
                if tgt_key == "power.zone"
                else "heart_rate"
                if tgt_key == "heart.rate.zone"
                else "speed"
                if tgt_key == "speed.zone"
                else "cadence"
                if tgt_key == "cadence.zone"
                else "open"
            )
            steps.append(
                FitWorkoutStepEvidence(
                    message_index=idx,
                    name=raw.get("description"),
                    duration_type=dur_type,
                    duration_value=float(dur_val) if dur_val is not None else None,
                    target_type=tgt_type,
                    target_value=(
                        float(raw.get("zoneNumber")) if raw.get("zoneNumber") is not None else None
                    ),
                    custom_target_value_low=(
                        float(raw.get("targetValueOne"))
                        if raw.get("targetValueOne") is not None
                        else None
                    ),
                    custom_target_value_high=(
                        float(raw.get("targetValueTwo"))
                        if raw.get("targetValueTwo") is not None
                        else None
                    ),
                    intensity=intensity,
                    equipment=equipment,
                )
            )
            idx += 1
    return tuple(steps)


def canonical_workout_to_fit_steps(
    workout: dict[str, Any], athlete_ftp: float | None = None
) -> tuple[FitWorkoutStepEvidence, ...]:
    """Convert CanonicalWorkoutExport dictionary into FitWorkoutStepEvidence tuple."""
    from .workout_export import canonical_workout_to_garmin_payload

    payload = canonical_workout_to_garmin_payload(workout, athlete_ftp=athlete_ftp)
    return garmin_payload_to_fit_steps(payload)


FTP_RELATIVE_TARGET_PATTERN = re.compile(
    r"(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*%\s*(?:FTP)?"
    r"|\d+(?:\.\d+)?\s*%\s*FTP\b)",
    re.IGNORECASE,
)


def canonical_workout_requires_athlete_ftp(workout: dict[str, Any]) -> bool:
    """Return whether Garmin export can resolve this cycling template differently with FTP."""
    modality = str(workout.get("modality") or "").lower()
    if modality not in {"cycling", "bike"}:
        return False

    for block in workout.get("blocks") or []:
        for step in block.get("steps") or []:
            values: list[Any] = []
            targets = step.get("targets")
            if isinstance(targets, list):
                values.extend(targets)
            values.extend(
                [
                    step.get("recoveryTarget"),
                    step.get("notes"),
                    step.get("name"),
                ]
            )
            if any(
                isinstance(value, str) and FTP_RELATIVE_TARGET_PATTERN.search(value)
                for value in values
            ):
                return True
    return False


def compute_workout_template_fingerprint(
    workout: dict[str, Any], athlete_ftp: float | None = None
) -> FitWorkoutIdentity:
    """Compute deterministic FitWorkoutIdentity from a canonical workout dictionary."""
    if canonical_workout_requires_athlete_ftp(workout) and not (
        isinstance(athlete_ftp, (int, float))
        and math.isfinite(athlete_ftp)
        and athlete_ftp > 0
    ):
        raise ValueError(
            "Cycling %FTP workout identity requires the athlete FTP used for Garmin export"
        )

    steps = canonical_workout_to_fit_steps(workout, athlete_ftp=athlete_ftp)
    workout_name = workout.get("title")
    identity = compute_fit_workout_identity(workout_name, (), steps)
    if identity is None:
        raise ValueError("Failed to compute template workout identity for workout")
    return identity
