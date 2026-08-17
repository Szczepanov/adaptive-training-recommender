from garmin_sync.workout_export import _extract_power_target, canonical_workout_to_garmin_payload


def test_canonical_workout_to_garmin_payload():
    workout = {
        "schemaVersion": "canonical_workout_v1",
        "title": "Threshold 3x12",
        "workoutId": "threshold_3x12",
        "modality": "cycling",
        "targetDurationMin": 75,
        "blocks": [
            {
                "name": "Warmup",
                "role": "warmup",
                "steps": [{"name": "Spin", "durationSeconds": 900}],
            },
            {
                "name": "Main",
                "role": "main",
                "steps": [
                    {
                        "name": "Interval 1",
                        "durationSeconds": 720,
                        "restAfterSec": 240,
                    }
                ],
            },
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    assert payload["workoutName"] == "Threshold 3x12"
    assert payload["sportType"]["sportTypeKey"] == "cycling"
    assert len(payload["workoutSegments"][0]["workoutSteps"]) == 3
    assert payload["workoutSegments"][0]["workoutSteps"][0]["stepType"]["stepTypeKey"] == "warmup"
    assert payload["workoutSegments"][0]["workoutSteps"][1]["stepType"]["stepTypeKey"] == "interval"
    assert payload["workoutSegments"][0]["workoutSteps"][2]["stepType"]["stepTypeKey"] == "recovery"


def test_strength_workout_uses_garmin_strength_and_repetition_ids():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Squats",
            "modality": "strength",
            "blocks": [
                {
                    "steps": [
                        {"name": "Back squat", "repetitions": 5},
                    ]
                }
            ],
        }
    )

    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert payload["sportType"] == {"sportTypeId": 5, "sportTypeKey": "strength_training"}
    assert step["endCondition"] == {"conditionTypeId": 10, "conditionTypeKey": "reps"}


def test_endurance_workout_generates_repeat_group_with_child_steps():
    workout = {
        "title": "Aerobic Engine 3x15",
        "modality": "cycling",
        "blocks": [
            {
                "steps": [
                    {
                        "name": "Sustained interval",
                        "durationSeconds": 900,
                        "repetitions": 3,
                        "restAfterSec": 300,
                        "targets": ["230-240 W, RPE 6.5-8"],
                    }
                ]
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 1
    repeat_group = steps[0]
    assert repeat_group["type"] == "RepeatGroupDTO"
    assert repeat_group["numberOfIterations"] == 3
    assert repeat_group["stepType"]["stepTypeKey"] == "repeat"
    assert len(repeat_group["workoutSteps"]) == 2

    child_interval = repeat_group["workoutSteps"][0]
    assert child_interval["stepType"]["stepTypeKey"] == "interval"
    assert child_interval["endConditionValue"] == 900
    assert "230-240 W" in child_interval["description"]
    assert child_interval["targetType"] == {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
    assert child_interval["targetValueOne"] == 230.0
    assert child_interval["targetValueTwo"] == 240.0

    child_recovery = repeat_group["workoutSteps"][1]
    assert child_recovery["stepType"]["stepTypeKey"] == "recovery"
    assert child_recovery["endConditionValue"] == 300
    assert child_recovery["targetType"] == {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}


def test_extract_power_target_standard_range():
    assert _extract_power_target(["230-240 W"]) == (230.0, 240.0)
    assert _extract_power_target(["140–175 W"]) == (140.0, 175.0)  # en-dash
    assert _extract_power_target(["140—175 W"]) == (140.0, 175.0)  # em-dash
    assert _extract_power_target(["230 - 240 W"]) == (230.0, 240.0)


def test_extract_power_target_with_extra_text():
    assert _extract_power_target(["230-240 W, RPE approximately 6.5-8"]) == (230.0, 240.0)
    assert _extract_power_target(["Warm up at 140-175 W easy"]) == (140.0, 175.0)


def test_extract_power_target_single_wattage():
    assert _extract_power_target(["250 W"]) == (250.0, 250.0)
    assert _extract_power_target(["Target 200W steady"]) == (200.0, 200.0)


def test_extract_power_target_decimals_and_case():
    assert _extract_power_target(["210.5-225.5 w"]) == (210.5, 225.5)


def test_extract_power_target_non_power_targets_return_none():
    assert _extract_power_target(None) is None
    assert _extract_power_target([]) is None
    assert _extract_power_target(["RPE 7-8", "Zone 2", "Cadence 90 rpm"]) is None
    assert _extract_power_target([123, None]) is None  # type: ignore[list-item]


