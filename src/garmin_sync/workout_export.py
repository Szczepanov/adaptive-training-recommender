"""Workout transformation into Garmin Connect API payload schema."""

from typing import Any

SPORT_TYPE_MAP: dict[str, dict[str, Any]] = {
    "cycling": {"sportTypeId": 2, "sportTypeKey": "cycling"},
    "bike": {"sportTypeId": 2, "sportTypeKey": "cycling"},
    "running": {"sportTypeId": 1, "sportTypeKey": "running"},
    "run": {"sportTypeId": 1, "sportTypeKey": "running"},
    "strength": {"sportTypeId": 5, "sportTypeKey": "strength_training"},
    "mobility": {"sportTypeId": 11, "sportTypeKey": "mobility"},
    # The app's cross-training bucket is deliberately vendor-neutral; Garmin's
    # generic "other" type is safer than labelling every session as skiing.
    "cross_training": {"sportTypeId": 3, "sportTypeKey": "other"},
}

STEP_TYPE_MAP: dict[str, dict[str, Any]] = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup"},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown"},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval"},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery"},
    "rest": {"stepTypeId": 5, "stepTypeKey": "rest"},
}

END_CONDITION_MAP: dict[str, dict[str, Any]] = {
    "time": {"conditionTypeId": 2, "conditionTypeKey": "time"},
    "distance": {"conditionTypeId": 3, "conditionTypeKey": "distance"},
    "reps": {"conditionTypeId": 10, "conditionTypeKey": "reps"},
    "lap_button": {"conditionTypeId": 1, "conditionTypeKey": "lap.button"},
}


def canonical_workout_to_garmin_payload(workout: dict[str, Any]) -> dict[str, Any]:
    """Convert canonical workout JSON into Garmin Connect's workout payload structure."""
    modality = str(workout.get("modality", "cycling")).lower()
    sport = SPORT_TYPE_MAP.get(modality, SPORT_TYPE_MAP["cycling"])
    title = str(workout.get("title", "Adaptive Workout"))
    blocks = workout.get("blocks", [])

    workout_steps: list[dict[str, Any]] = []
    step_order = 1

    for block in blocks:
        block_role = str(block.get("role", "main")).lower()
        default_step_type = (
            STEP_TYPE_MAP["warmup"]
            if block_role == "warmup"
            else STEP_TYPE_MAP["cooldown"]
            if block_role == "cooldown"
            else STEP_TYPE_MAP["interval"]
        )

        for step in block.get("steps", []):
            duration_sec = step.get("durationSeconds") or 300
            reps = step.get("repetitions") or step.get("sets")

            step_type = default_step_type
            step_name = str(step.get("name", "")).strip()
            step_name_lower = step_name.lower()
            if "warm" in step_name_lower:
                step_type = STEP_TYPE_MAP["warmup"]
            elif "cool" in step_name_lower:
                step_type = STEP_TYPE_MAP["cooldown"]
            elif "rest" in step_name_lower or "recovery" in step_name_lower:
                step_type = STEP_TYPE_MAP["recovery"]

            targets = step.get("targets")
            desc_parts = [step_name] if step_name else []
            if targets and isinstance(targets, list) and targets:
                desc_parts.append(f"({'; '.join(targets)})")
            step_desc = " ".join(desc_parts) if desc_parts else None

            if reps and modality == "strength":
                end_condition = END_CONDITION_MAP["reps"]
                end_condition_value = reps
            else:
                end_condition = END_CONDITION_MAP["time"]
                end_condition_value = duration_sec

            rest_sec = step.get("restAfterSec")

            if reps and reps > 1 and modality != "strength":
                repeat_steps: list[dict[str, Any]] = [
                    {
                        "type": "ExecutableStepDTO",
                        "stepId": None,
                        "stepOrder": 1,
                        "stepType": step_type,
                        "childStepId": None,
                        "description": step_desc,
                        "endCondition": end_condition,
                        "endConditionValue": end_condition_value,
                        "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
                    }
                ]
                if rest_sec and rest_sec > 0:
                    repeat_steps.append(
                        {
                            "type": "ExecutableStepDTO",
                            "stepId": None,
                            "stepOrder": 2,
                            "stepType": STEP_TYPE_MAP["recovery"],
                            "childStepId": None,
                            "description": "Rest interval",
                            "endCondition": END_CONDITION_MAP["time"],
                            "endConditionValue": rest_sec,
                            "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
                        }
                    )
                repeat_group: dict[str, Any] = {
                    "type": "RepeatGroupDTO",
                    "stepId": None,
                    "stepOrder": step_order,
                    "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
                    "childStepId": 1,
                    "numberOfIterations": reps,
                    "smartRepeat": False,
                    "workoutSteps": repeat_steps,
                }
                workout_steps.append(repeat_group)
                step_order += 1
            else:
                garmin_step: dict[str, Any] = {
                    "type": "ExecutableStepDTO",
                    "stepId": None,
                    "stepOrder": step_order,
                    "stepType": step_type,
                    "childStepId": None,
                    "description": step_desc,
                    "endCondition": end_condition,
                    "endConditionValue": end_condition_value,
                    "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
                }

                workout_steps.append(garmin_step)
                step_order += 1

                # If there is a rest interval after this step, add a recovery step
                if rest_sec and rest_sec > 0:
                    workout_steps.append(
                        {
                            "type": "ExecutableStepDTO",
                            "stepId": None,
                            "stepOrder": step_order,
                            "stepType": STEP_TYPE_MAP["recovery"],
                            "childStepId": None,
                            "description": "Rest interval",
                            "endCondition": END_CONDITION_MAP["time"],
                            "endConditionValue": rest_sec,
                            "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
                        }
                    )
                    step_order += 1

    if not workout_steps:
        workout_steps.append(
            {
                "type": "ExecutableStepDTO",
                "stepId": None,
                "stepOrder": 1,
                "stepType": STEP_TYPE_MAP["interval"],
                "childStepId": None,
                "description": title,
                "endCondition": END_CONDITION_MAP["time"],
                "endConditionValue": (workout.get("targetDurationMin") or 60) * 60,
                "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
            }
        )

    return {
        "workoutName": title,
        "description": workout.get("summary") or f"Adaptive {modality} session",
        "sportType": sport,
        "workoutSegments": [
            {
                "segmentOrder": 1,
                "sportType": sport,
                "workoutSteps": workout_steps,
            }
        ],
    }
