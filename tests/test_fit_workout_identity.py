from garmin_sync.fit_workout_identity import (
    FIT_WORKOUT_FINGERPRINT_VERSION,
    compute_fit_workout_fingerprint,
)


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
