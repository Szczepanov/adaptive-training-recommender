"""PR 5 (training-occurrence plan, ADR-0034 "FIT structured-workout identity"): a
normalized, versioned fingerprint for a device-recorded structured workout.

Evidence source: `fit_activity.FitActivityEvidence.workout_name` /
`.workout_step_indices`, decoded from the *recorded activity* FIT file -- this is
Garmin's own on-device workout structure (a workout the athlete ran on their watch),
not an Adaptive-authored prescription. Adaptive does not currently push structured
workouts to Garmin devices, so nothing on the structured-execution side yet produces a
comparable fingerprint to correlate against -- this module intentionally has no
consumer wiring into reconciliation scoring yet. Per ADR-0034: "ensure absent FIT
workout metadata falls back cleanly to existing reconciliation" -- this fingerprint is
additive evidence for a future correlation source, never a required input today.
"""

from __future__ import annotations

import hashlib

FIT_WORKOUT_FINGERPRINT_VERSION = "fit-workout-v1"


def compute_fit_workout_fingerprint(
    workout_name: str | None,
    workout_step_indices: tuple[int, ...],
) -> str | None:
    """Returns None when there is no decodable workout structure at all -- a freeform
    (non-workout) recording must fingerprint to nothing, not to some default/empty-string
    digest that could coincidentally collide with a genuinely tiny structured workout.
    """
    normalized_name = workout_name.strip() if workout_name else ""
    normalized_steps = tuple(sorted(set(workout_step_indices)))
    if not normalized_name and not normalized_steps:
        return None

    digest_input = f"{normalized_name}|{','.join(str(step) for step in normalized_steps)}"
    digest = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()[:32]
    return f"{FIT_WORKOUT_FINGERPRINT_VERSION}:{digest}"
