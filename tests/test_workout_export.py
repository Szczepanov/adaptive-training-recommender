from garmin_sync.workout_export import canonical_workout_to_garmin_payload


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
