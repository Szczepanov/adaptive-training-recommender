import json
from pathlib import Path

import pytest

from garmin_sync.fit_workout_identity import (
    FIT_WORKOUT_FINGERPRINT_VERSION,
    canonical_workout_to_fit_steps,
    compute_fit_workout_fingerprint,
    compute_fit_workout_identity,
    compute_workout_template_fingerprint,
)


def test_cross_language_contract_fixture_parity() -> None:
    fixture_path = (
        Path(__file__).resolve().parent / "fixtures" / "contracts" / "fit_workout_identity_v2.json"
    )
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    for case in data["cases"]:
        if "workout" in case:
            identity = compute_workout_template_fingerprint(
                case["workout"], athlete_ftp=case.get("athleteFtpWatts")
            )
            assert identity.fingerprint == case["expectedFingerprint"]
            assert identity.kind == case["expectedKind"]
        else:
            indices = tuple(case["observedStepIndices"])
            identity = compute_fit_workout_identity(case["workoutName"], indices, ())
            if case["expectedFingerprint"] is None:
                assert identity is None
            else:
                assert identity is not None
                assert identity.fingerprint == case["expectedFingerprint"]
                assert identity.kind == case["expectedKind"]


def test_returns_none_for_a_freeform_recording_with_no_workout_evidence() -> None:
    assert compute_fit_workout_fingerprint(None, ()) is None
    assert compute_fit_workout_fingerprint("", ()) is None


def test_returns_a_versioned_fingerprint_when_workout_evidence_is_present() -> None:
    fingerprint = compute_fit_workout_fingerprint("5x5 Squat", (0, 1, 2))
    assert fingerprint is not None
    assert fingerprint.startswith(f"{FIT_WORKOUT_FINGERPRINT_VERSION}:")


def test_is_deterministic_for_the_same_inputs() -> None:
    a = compute_fit_workout_fingerprint("5x5 Squat", (0, 1, 2))
    b = compute_fit_workout_fingerprint("5x5 Squat", (0, 1, 2))
    assert a == b


def test_is_order_independent_over_step_indices() -> None:
    a = compute_fit_workout_fingerprint("5x5 Squat", (2, 0, 1))
    b = compute_fit_workout_fingerprint("5x5 Squat", (0, 1, 2))
    assert a == b


def test_differs_for_a_different_workout_name() -> None:
    a = compute_fit_workout_fingerprint("5x5 Squat", (0, 1))
    b = compute_fit_workout_fingerprint("5x5 Bench", (0, 1))
    assert a != b


def test_differs_for_a_different_step_structure() -> None:
    a = compute_fit_workout_fingerprint("5x5 Squat", (0, 1))
    b = compute_fit_workout_fingerprint("5x5 Squat", (0, 1, 2))
    assert a != b


def test_produces_a_fingerprint_from_step_indices_alone_with_no_workout_name() -> None:
    assert compute_fit_workout_fingerprint(None, (0, 1)) is not None


def test_ftp_relative_template_requires_exact_export_context() -> None:
    workout = {
        "schemaVersion": "canonical_workout_v1",
        "title": "FTP Endurance",
        "workoutId": "ftp_endurance",
        "modality": "cycling",
        "targetDurationMin": 10,
        "blocks": [
            {
                "id": "main",
                "name": "Main",
                "role": "main",
                "steps": [
                    {
                        "id": "work",
                        "name": "Steady endurance",
                        "durationSeconds": 600,
                        "targets": ["65-75% FTP"],
                    }
                ],
            }
        ],
    }

    with pytest.raises(ValueError, match="requires the athlete FTP used for Garmin export"):
        compute_workout_template_fingerprint(workout)


# ADR-0051 D3/D5 depend on this flattened order: per-step rest and block recovery inside the
# repeat group, the repeat-control step last, and one repeat group per set for multi-set work.
_REPEAT_LAYOUTS = {
    "cycling_block_repeat_with_block_recovery": [
        ("Easy spin (140-160 W)", "time", 600.0),
        ("Over (290-310 W)", "time", 120.0),
        ("Rest interval", "time", 60.0),
        ("Under (230-250 W)", "time", 90.0),
        ("Block recovery", "time", 300.0),
        (None, "repeat_until_steps_cmplt", 1.0),
        ("Easy spin (110-130 W)", "time", 300.0),
    ],
    "cycling_single_child_repeat": [
        ("Easy spin (140-160 W)", "time", 600.0),
        ("Sprint (500-600 W)", "time", 30.0),
        (None, "repeat_until_steps_cmplt", 1.0),
        ("Easy spin (110-130 W)", "time", 300.0),
    ],
    "cycling_multi_set_intervals": [
        ("Easy spin (140-160 W)", "time", 600.0),
        ("Burst (380-400 W)", "time", 30.0),
        ("Rest interval", "time", 30.0),
        (None, "repeat_until_steps_cmplt", 1.0),
        ("Set recovery", "time", 240.0),
        ("Burst (380-400 W)", "time", 30.0),
        ("Rest interval", "time", 30.0),
        (None, "repeat_until_steps_cmplt", 5.0),
        ("Easy spin (110-130 W)", "time", 300.0),
    ],
}


@pytest.mark.parametrize("case_id", sorted(_REPEAT_LAYOUTS))
def test_repeat_group_contract_cases_flatten_to_the_pinned_layout(case_id: str) -> None:
    fixture_path = (
        Path(__file__).resolve().parent / "fixtures" / "contracts" / "fit_workout_identity_v2.json"
    )
    cases = json.loads(fixture_path.read_text(encoding="utf-8"))["cases"]
    workout = next(case["workout"] for case in cases if case["id"] == case_id)

    steps = canonical_workout_to_fit_steps(workout)

    assert [step.message_index for step in steps] == list(range(len(steps)))
    assert [(step.name, step.duration_type, step.duration_value) for step in steps] == (
        _REPEAT_LAYOUTS[case_id]
    )
