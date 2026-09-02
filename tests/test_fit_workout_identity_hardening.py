from garmin_sync.fit_activity import FitWorkoutStepEvidence, FitWorkoutStepIndices
from garmin_sync.fit_workout_identity import compute_fit_workout_fingerprint


def _step(*, duration_value: float = 600.0, target_value: float = 3.0) -> FitWorkoutStepEvidence:
    return FitWorkoutStepEvidence(
        message_index=0,
        name="Threshold",
        duration_type="time",
        duration_value=duration_value,
        target_type="power",
        target_value=target_value,
        custom_target_value_low=None,
        custom_target_value_high=None,
        intensity="active",
        equipment="bike",
    )


def test_semantic_step_definition_distinguishes_same_name_and_observed_indices():
    a = compute_fit_workout_fingerprint("Builder", (0,), (_step(duration_value=600.0),))
    b = compute_fit_workout_fingerprint("Builder", (0,), (_step(duration_value=900.0),))

    assert a is not None
    assert b is not None
    assert a != b


def test_semantic_definition_wins_over_partial_execution_indices():
    steps = (
        _step(duration_value=600.0),
        FitWorkoutStepEvidence(
            message_index=1,
            name="Recovery",
            duration_type="time",
            duration_value=300.0,
            target_type="open",
            target_value=None,
            custom_target_value_low=None,
            custom_target_value_high=None,
            intensity="rest",
            equipment="bike",
        ),
    )

    completed_all = compute_fit_workout_fingerprint("Builder", (0, 1), steps)
    stopped_early = compute_fit_workout_fingerprint("Builder", (0,), steps)

    assert completed_all == stopped_early


def test_tuple_compatible_indices_carry_semantic_definition_through_existing_service_call_shape():
    steps = (_step(target_value=4.0),)
    indices = FitWorkoutStepIndices([0], steps)

    implicit = compute_fit_workout_fingerprint("Builder", indices)
    explicit = compute_fit_workout_fingerprint("Builder", (0,), steps)

    assert isinstance(indices, tuple)
    assert indices == (0,)
    assert implicit == explicit


def test_fallback_observed_indices_preserve_execution_order_instead_of_sorting():
    forward = compute_fit_workout_fingerprint("Builder", (0, 1, 2))
    reordered = compute_fit_workout_fingerprint("Builder", (2, 0, 1))

    assert forward != reordered


def test_cosmetic_name_and_enum_case_do_not_churn_semantic_fingerprint():
    upper = _step()
    lower = FitWorkoutStepEvidence(
        message_index=0,
        name=" threshold ",
        duration_type="TIME",
        duration_value=600.0,
        target_type="POWER",
        target_value=3.0,
        custom_target_value_low=None,
        custom_target_value_high=None,
        intensity="ACTIVE",
        equipment="BIKE",
    )

    assert compute_fit_workout_fingerprint("  BUILDER ", (0,), (upper,)) == compute_fit_workout_fingerprint(
        "builder", (0,), (lower,)
    )
