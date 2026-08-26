"""Contract 4: Persistence <-> Privileged Workout-Export Jobs.

Loads the same JSON fixture as app/src/contracts/workoutExportContract.test.ts
(tests/fixtures/contracts/workout_export.json) so a field-name or enum change on
either side of the Python/TypeScript boundary has to update one shared fixture,
not two independently-drifting literals.

`workout_export.py` reads `durationSeconds` (not `durationSec`) and `targets` as a
list of strings (not a `target` object) -- see canonical_workout_to_garmin_payload's
`step.get("durationSeconds") or 300` fallback and `_compile_target_sources`. The
assertions below check the *actual* transformed values (not just "some payload came
back") specifically so a regression back to the wrong field names is caught: with
the wrong names every step would silently fall back to a 300s duration and a
`no.target` target type instead of failing loudly.
"""

import json
from pathlib import Path

from garmin_sync.workout_export import canonical_workout_to_garmin_payload, summarize_garmin_payload

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "contracts" / "workout_export.json"


def _load_workout_payload() -> dict:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return fixture["queueEntry"]["payload"]


def _flatten_steps(steps: list[dict]) -> list[dict]:
    """A step with sets > 1 gets wrapped in a RepeatGroupDTO (see
    canonical_workout_to_garmin_payload's Case B), so its child ExecutableStepDTOs
    live under `workoutSteps`, not at the top level -- recurse the same way
    `summarize_garmin_payload`'s own `_count_recovery_steps` does."""
    flat: list[dict] = []
    for step in steps:
        if step.get("type") == "RepeatGroupDTO":
            flat.extend(_flatten_steps(step.get("workoutSteps", [])))
        else:
            flat.append(step)
    return flat


def test_workout_export_contract_transformation() -> None:
    workout = _load_workout_payload()

    payload = canonical_workout_to_garmin_payload(workout)

    assert payload["workoutName"] == "VO2 Max Intervals"
    assert payload["sportType"]["sportTypeKey"] == "cycling"
    assert len(payload["workoutSegments"]) > 0

    summary = summarize_garmin_payload(workout, payload)
    assert summary["modality"] == "Cycling" or summary["modality"] == "cycling"
    assert summary["garminTopLevelStepCount"] >= 3


def test_workout_export_honors_durationSeconds_not_a_fallback_default() -> None:
    """Regression guard: `_build_step_dto` defaults to a 300s block whenever
    `durationSeconds` is missing/misnamed. The fixture's warm-up step is 600s and
    its main interval step is 180s -- neither equals the 300s fallback, so this
    fails loudly if the field name silently stops matching (e.g. a future rename
    to `durationSec` on either side without updating the other)."""
    workout = _load_workout_payload()
    payload = canonical_workout_to_garmin_payload(workout)

    all_steps = _flatten_steps(payload["workoutSegments"][0]["workoutSteps"])
    durations = [s["endConditionValue"] for s in all_steps if s.get("type") == "ExecutableStepDTO"]

    assert 600 in durations, (
        f"expected the warm-up's durationSeconds=600 to survive, got {durations}"
    )
    assert 180 in durations, (
        f"expected the main interval's durationSeconds=180 to survive, got {durations}"
    )
    assert 300 not in durations, (
        "a step landed on workout_export.py's 300s fallback default -- this means "
        "durationSeconds wasn't recognized on at least one step"
    )


def test_workout_export_honors_targets_list_not_a_target_object() -> None:
    """Regression guard: `_compile_target_sources` reads `targets` (a list of
    strings) and falls back to `no.target` if it can't find a power/zone match
    anywhere. The fixture's main interval targets '300-320 W', which must resolve
    to an actual power.zone target, not silently degrade to no.target."""
    workout = _load_workout_payload()
    payload = canonical_workout_to_garmin_payload(workout)

    all_steps = _flatten_steps(payload["workoutSegments"][0]["workoutSteps"])
    main_step = next(
        s
        for s in all_steps
        if s.get("endConditionValue") == 180 and s.get("type") == "ExecutableStepDTO"
    )

    assert main_step["targetType"]["workoutTargetTypeKey"] == "power.zone"
    assert main_step["targetValueOne"] == 300.0
    assert main_step["targetValueTwo"] == 320.0


def test_workout_export_rest_step_uses_restAfterSec() -> None:
    workout = _load_workout_payload()
    payload = canonical_workout_to_garmin_payload(workout)

    all_steps = _flatten_steps(payload["workoutSegments"][0]["workoutSteps"])
    rest_steps = [s for s in all_steps if s.get("stepType", {}).get("stepTypeKey") == "recovery"]

    assert any(s["endConditionValue"] == 180 for s in rest_steps), (
        "expected a 180s recovery step from the main interval's restAfterSec=180"
    )
