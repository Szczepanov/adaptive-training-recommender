import json
from pathlib import Path

from garmin_sync.workout_export import (
    _extract_power_target,
    canonical_workout_to_garmin_payload,
    summarize_garmin_payload,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "garmin"


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
    assert child_interval["targetType"] == {
        "workoutTargetTypeId": 2,
        "workoutTargetTypeKey": "power.zone",
    }
    assert child_interval["targetValueOne"] == 230.0
    assert child_interval["targetValueTwo"] == 240.0

    child_recovery = repeat_group["workoutSteps"][1]
    assert child_recovery["stepType"]["stepTypeKey"] == "recovery"
    assert child_recovery["endConditionValue"] == 300
    assert child_recovery["targetType"] == {
        "workoutTargetTypeId": 1,
        "workoutTargetTypeKey": "no.target",
    }


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


def test_extract_power_target_derived_from_ftp():
    assert _extract_power_target(["90-95% FTP"], ftp_watts=250.0) == (225.0, 237.5)
    assert _extract_power_target(["65–75% FTP"], ftp_watts=300.0) == (195.0, 225.0)
    assert _extract_power_target(["80% FTP"], ftp_watts=200.0) == (160.0, 160.0)
    # When explicit watts exist alongside % FTP, explicit watts take priority
    assert _extract_power_target(["230-240 W (90% FTP)"], ftp_watts=250.0) == (230.0, 240.0)


def test_extract_zone_target():
    from garmin_sync.workout_export import _extract_zone_target

    assert _extract_zone_target(["Zone 2"]) == 2
    assert _extract_zone_target(["Z2"]) == 2
    assert _extract_zone_target(["Zone-4"]) == 4
    assert _extract_zone_target(["Z 5"]) == 5
    assert _extract_zone_target(["Active Recovery"]) == 1
    assert _extract_zone_target(["Endurance pace"]) == 2
    assert _extract_zone_target(["Tempo work"]) == 3
    assert _extract_zone_target(["Threshold intervals"]) == 4
    assert _extract_zone_target(["Sweetspot ride"]) == 4
    assert _extract_zone_target(["VO2 Max efforts"]) == 5
    assert _extract_zone_target(["Anaerobic capacity"]) == 6
    assert _extract_zone_target(["Neuromuscular sprints"]) == 7
    # % FTP fallback when no FTP is known
    assert _extract_zone_target(["50% FTP"]) == 1
    assert _extract_zone_target(["65-75% FTP"]) == 2
    assert _extract_zone_target(["85% FTP"]) == 3
    assert _extract_zone_target(["95-100% FTP"]) == 4
    assert _extract_zone_target(["115% FTP"]) == 5
    assert _extract_zone_target(["130% FTP"]) == 6
    assert _extract_zone_target(["160% FTP"]) == 7
    assert _extract_zone_target(None) is None
    assert _extract_zone_target([]) is None
    assert _extract_zone_target(["RPE 6-7"]) is None


def test_endurance_workout_derives_power_from_ftp():
    workout = {
        "title": "Sweet Spot 3x10",
        "modality": "cycling",
        "athleteFtpWatts": 260.0,
        "blocks": [
            {
                "steps": [
                    {
                        "name": "Sweet Spot",
                        "durationSeconds": 600,
                        "targets": ["88-92% FTP"],
                    }
                ]
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"] == {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
    assert step["targetValueOne"] == 228.8
    assert step["targetValueTwo"] == 239.2
    assert step["zoneNumber"] is None


def test_endurance_workout_maps_named_zone_to_zone_number():
    workout = {
        "title": "Base Zone 2",
        "modality": "cycling",
        "blocks": [
            {
                "steps": [
                    {
                        "name": "Endurance Block",
                        "durationSeconds": 3600,
                        "targets": ["Zone 2 endurance"],
                    }
                ]
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"] == {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
    assert step["targetValueOne"] is None
    assert step["targetValueTwo"] is None
    assert step["zoneNumber"] == 2


def test_endurance_workout_maps_pct_ftp_to_zone_number_without_ftp():
    workout = {
        "title": "Tempo Ride",
        "modality": "cycling",
        "blocks": [
            {
                "steps": [
                    {
                        "name": "Tempo Block",
                        "durationSeconds": 1800,
                        "targets": ["80-85% FTP"],
                    }
                ]
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"] == {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
    assert step["targetValueOne"] is None
    assert step["targetValueTwo"] is None
    assert step["zoneNumber"] == 3


def test_over_under_multi_step_block_repeats():
    workout = {
        "title": "FTP Over-Under Engine",
        "modality": "cycling",
        "targetDurationMin": 95,
        "blocks": [
            {
                "name": "Warmup",
                "role": "warmup",
                "steps": [
                    {
                        "name": "Progressive warm-up",
                        "durationSeconds": 1200,
                        "targets": ["140-180 W, RPE 2-4"],
                    }
                ],
            },
            {
                "name": "Over-Under Block",
                "role": "main",
                "repetitions": 3,
                "restAfterSec": 300,
                "steps": [
                    {
                        "name": "Under",
                        "durationSeconds": 240,
                        "targets": ["235–245 W, RPE 7-8"],
                    },
                    {
                        "name": "Over",
                        "durationSeconds": 60,
                        "targets": ["265–275 W, RPE 8"],
                    },
                    {
                        "name": "Under",
                        "durationSeconds": 240,
                        "targets": ["235–245 W, RPE 7-8"],
                    },
                    {
                        "name": "Over",
                        "durationSeconds": 60,
                        "targets": ["265–275 W, RPE 8"],
                    },
                    {
                        "name": "Under",
                        "durationSeconds": 240,
                        "targets": ["235–245 W, RPE 7-8"],
                    },
                    {
                        "name": "Over",
                        "durationSeconds": 60,
                        "targets": ["265–275 W, RPE 8"],
                    },
                ],
            },
            {
                "name": "Cooldown",
                "role": "cooldown",
                "steps": [
                    {
                        "name": "Easy riding",
                        "durationSeconds": 900,
                        "targets": ["110–140 W, RPE 2"],
                    }
                ],
            },
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 3

    # Step 1: Warmup
    assert steps[0]["stepType"]["stepTypeKey"] == "warmup"
    assert steps[0]["targetValueOne"] == 140.0
    assert steps[0]["targetValueTwo"] == 180.0

    # Step 2: Repeat Group (3x)
    assert steps[1]["type"] == "RepeatGroupDTO"
    assert steps[1]["numberOfIterations"] == 3
    child_steps = steps[1]["workoutSteps"]
    assert len(child_steps) == 7  # 6 sub-intervals + 1 block rest
    assert child_steps[0]["targetValueOne"] == 235.0
    assert child_steps[0]["targetValueTwo"] == 245.0
    assert child_steps[1]["targetValueOne"] == 265.0
    assert child_steps[1]["targetValueTwo"] == 275.0
    assert child_steps[6]["stepType"]["stepTypeKey"] == "recovery"
    assert child_steps[6]["endConditionValue"] == 300

    # Step 3: Cooldown
    assert steps[2]["stepType"]["stepTypeKey"] == "cooldown"
    assert steps[2]["targetValueOne"] == 110.0
    assert steps[2]["targetValueTwo"] == 140.0


def test_multi_set_vo2_30_15_garmin_payload():
    workout = {
        "title": "VO2 30/15 repeated aerobic power",
        "modality": "cycling",
        "targetDurationMin": 60,
        "blocks": [
            {
                "name": "Workout Steps",
                "role": "main",
                "steps": [
                    {
                        "name": "Warm-up",
                        "durationSeconds": 1200,
                        "targets": ["140-180 W, RPE 2-4"],
                    },
                    {
                        "name": "30-second work",
                        "durationSeconds": 30,
                        "repetitions": 10,
                        "sets": 3,
                        "restAfterSec": 15,
                        "setRecoverySec": 240,
                        "targets": ["320-350 W"],
                        "recoveryTarget": "150-180 W",
                    },
                    {
                        "name": "Cooldown",
                        "durationSeconds": 600,
                        "targets": ["160 W"],
                    },
                ],
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    # Steps: 1 Warmup, 1 RepeatGroup (Set 1), 1 Set Recovery, 1 RepeatGroup (Set 2), 1 Set Recovery, 1 RepeatGroup (Set 3), 1 Cooldown = 7 steps
    assert len(steps) == 7

    # 1. Warmup
    assert steps[0]["stepType"]["stepTypeKey"] == "warmup"
    assert steps[0]["endConditionValue"] == 1200
    assert steps[0]["targetValueOne"] == 140.0
    assert steps[0]["targetValueTwo"] == 180.0

    # 2. Set 1
    assert steps[1]["type"] == "RepeatGroupDTO"
    assert steps[1]["numberOfIterations"] == 10
    set1_child = steps[1]["workoutSteps"]
    assert len(set1_child) == 2
    assert set1_child[0]["stepType"]["stepTypeKey"] == "interval"
    assert set1_child[0]["endConditionValue"] == 30
    assert set1_child[0]["targetValueOne"] == 320.0
    assert set1_child[0]["targetValueTwo"] == 350.0
    assert set1_child[1]["stepType"]["stepTypeKey"] == "recovery"
    assert set1_child[1]["endConditionValue"] == 15
    assert set1_child[1]["targetValueOne"] == 150.0
    assert set1_child[1]["targetValueTwo"] == 180.0

    # 3. Inter-set recovery 1
    assert steps[2]["stepType"]["stepTypeKey"] == "recovery"
    assert steps[2]["endConditionValue"] == 240
    assert steps[2]["description"] == "Set recovery"

    # 4. Set 2
    assert steps[3]["type"] == "RepeatGroupDTO"
    assert steps[3]["numberOfIterations"] == 10

    # 5. Inter-set recovery 2
    assert steps[4]["stepType"]["stepTypeKey"] == "recovery"
    assert steps[4]["endConditionValue"] == 240

    # 6. Set 3
    assert steps[5]["type"] == "RepeatGroupDTO"
    assert steps[5]["numberOfIterations"] == 10

    # 7. Cooldown
    assert steps[6]["stepType"]["stepTypeKey"] == "cooldown"
    assert steps[6]["endConditionValue"] == 600


def test_strength_multi_set_step_becomes_repeat_group():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Explosive lift",
            "modality": "strength",
            "blocks": [{"steps": [{"name": "Explosive lift", "sets": 4, "repetitions": 2}]}],
        }
    )
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 1
    repeat_group = steps[0]
    assert repeat_group["type"] == "RepeatGroupDTO"
    assert repeat_group["numberOfIterations"] == 4
    child_exercise = repeat_group["workoutSteps"][0]
    assert child_exercise["endCondition"] == {"conditionTypeId": 10, "conditionTypeKey": "reps"}
    assert child_exercise["endConditionValue"] == 2


def test_strength_sets_are_never_used_as_rep_target():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Plank hold",
            "modality": "strength",
            "blocks": [{"steps": [{"name": "Plank hold", "sets": 4, "durationSeconds": 120}]}],
        }
    )
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    # A duration-based strength block must remain time-based; `sets` must
    # never become the rep end condition or a fabricated repeat.
    assert step["type"] == "ExecutableStepDTO"
    assert step["endCondition"] == {"conditionTypeId": 2, "conditionTypeKey": "time"}
    assert step["endConditionValue"] == 120


def test_strength_repeat_group_uses_set_recovery_sec():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Explosive lift",
            "modality": "strength",
            "blocks": [
                {
                    "steps": [
                        {
                            "name": "Explosive lift",
                            "sets": 4,
                            "repetitions": 2,
                            "setRecoverySec": 180,
                        }
                    ]
                }
            ],
        }
    )
    repeat_group = payload["workoutSegments"][0]["workoutSteps"][0]
    recovery_child = repeat_group["workoutSteps"][1]
    assert recovery_child["stepType"]["stepTypeKey"] == "recovery"
    assert recovery_child["endConditionValue"] == 180


def test_strength_repeat_group_uses_rest_after_sec_when_set_recovery_is_absent():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Back squat",
            "modality": "strength",
            "blocks": [
                {
                    "steps": [
                        {
                            "name": "Back squat",
                            "sets": 4,
                            "repetitions": 6,
                            "restAfterSec": 150,
                        }
                    ]
                }
            ],
        }
    )
    repeat_group = payload["workoutSegments"][0]["workoutSteps"][0]
    recovery_child = repeat_group["workoutSteps"][1]
    assert recovery_child["stepType"]["stepTypeKey"] == "recovery"
    assert recovery_child["endConditionValue"] == 150


def test_strength_set_recovery_takes_precedence_over_generic_rest():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Back squat",
            "modality": "strength",
            "blocks": [
                {
                    "steps": [
                        {
                            "name": "Back squat",
                            "sets": 4,
                            "repetitions": 6,
                            "setRecoverySec": 180,
                            "restAfterSec": 150,
                        }
                    ]
                }
            ],
        }
    )
    repeat_group = payload["workoutSegments"][0]["workoutSteps"][0]
    recovery_child = repeat_group["workoutSteps"][1]
    assert recovery_child["endConditionValue"] == 180


def test_strength_without_recovery_does_not_invent_rest():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Explosive lift",
            "modality": "strength",
            "blocks": [{"steps": [{"name": "Explosive lift", "sets": 4, "repetitions": 2}]}],
        }
    )
    repeat_group = payload["workoutSegments"][0]["workoutSteps"][0]
    assert len(repeat_group["workoutSteps"]) == 1


def test_duration_based_strength_block_remains_time_based():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Upper body and trunk",
            "modality": "strength",
            "blocks": [{"steps": [{"name": "Upper body and trunk", "durationSeconds": 720}]}],
        }
    )
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert step["type"] == "ExecutableStepDTO"
    assert step["endCondition"] == {"conditionTypeId": 2, "conditionTypeKey": "time"}
    assert step["endConditionValue"] == 720


def test_strength_step_without_reps_or_duration_uses_manual_completion():
    payload = canonical_workout_to_garmin_payload(
        {
            "title": "Farmer carry",
            "modality": "strength",
            "blocks": [{"steps": [{"name": "Farmer carry"}]}],
        }
    )
    step = payload["workoutSegments"][0]["workoutSteps"][0]
    assert step["endCondition"] == {"conditionTypeId": 1, "conditionTypeKey": "lap.button"}
    assert step["endConditionValue"] is None


def test_low_fatigue_strength_maintenance_regression():
    """Full screenshot regression: the Low-Fatigue Strength Maintenance workout
    must preserve each atomic exercise's sets/reps/duration rather than
    collapsing to three bare sequential steps (2 reps, 4 reps, 12:00)."""
    workout = json.loads(
        (FIXTURES_DIR / "low_fatigue_strength_maintenance.json").read_text(encoding="utf-8")
    )
    payload = canonical_workout_to_garmin_payload(workout)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 3

    # Explosive lift: 4 sets x 2 reps, not a single 2-rep exercise.
    explosive = steps[0]
    assert explosive["type"] == "RepeatGroupDTO"
    assert explosive["numberOfIterations"] == 4
    assert explosive["workoutSteps"][0]["endConditionValue"] == 2
    assert explosive["workoutSteps"][0]["endCondition"] == {
        "conditionTypeId": 10,
        "conditionTypeKey": "reps",
    }

    # Lower-body strength: 2 sets x 4 reps (midpoint of the compound source
    # prescription — full fidelity for the hinge sub-exercise is restored by
    # the separate source-fidelity PR, not this backend transformer).
    lower_body = steps[1]
    assert lower_body["type"] == "RepeatGroupDTO"
    assert lower_body["numberOfIterations"] == 2
    assert lower_body["workoutSteps"][0]["endConditionValue"] == 4

    # Upper body and trunk: remains an explicit 12:00 duration block; no
    # fake movements or reps are fabricated.
    upper_body = steps[2]
    assert upper_body["type"] == "ExecutableStepDTO"
    assert upper_body["endCondition"] == {"conditionTypeId": 2, "conditionTypeKey": "time"}
    assert upper_body["endConditionValue"] == 720

    # No source rest was specified anywhere in the fixture; none may be
    # invented.
    for step in steps:
        children = step.get("workoutSteps", [step])
        for child in children:
            assert child["stepType"]["stepTypeKey"] != "recovery"


def test_summarize_garmin_payload_counts_steps_repeat_groups_and_recoveries():
    workout = json.loads(
        (FIXTURES_DIR / "low_fatigue_strength_maintenance.json").read_text(encoding="utf-8")
    )
    payload = canonical_workout_to_garmin_payload(workout)
    summary = summarize_garmin_payload(workout, payload)

    assert summary["workoutId"] is None  # fixture has no workoutId field
    assert summary["title"] == "Low-Fatigue Strength Maintenance"
    assert summary["modality"] == "strength"
    assert summary["canonicalStepCount"] == 3
    assert summary["garminTopLevelStepCount"] == 3
    assert summary["repeatGroupCount"] == 2
    assert summary["recoveryStepCount"] == 0


def test_notes_fallback_recovery_in_garmin_payload():
    workout = {
        "title": "VO2 30/15 repeated aerobic power",
        "modality": "cycling",
        "blocks": [
            {
                "steps": [
                    {
                        "name": "30-second work",
                        "durationSeconds": 30,
                        "repetitions": 30,
                        "targets": ["320-350 W"],
                        "notes": "Each work repetition is followed by 15 s at approximately 150-180 W. Organize as 3 sets of 10 repetitions with 4 min easy riding between sets.",
                    }
                ]
            }
        ],
    }

    payload = canonical_workout_to_garmin_payload(workout)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    # When restAfterSec was not explicitly passed, fallback extracted 15s recovery and 240s set recovery
    assert len(steps) == 1
    assert steps[0]["type"] == "RepeatGroupDTO"
    assert steps[0]["numberOfIterations"] == 30
    child_steps = steps[0]["workoutSteps"]
    assert len(child_steps) == 2
    assert child_steps[0]["stepType"]["stepTypeKey"] == "interval"
    assert child_steps[0]["endConditionValue"] == 30
    assert child_steps[1]["stepType"]["stepTypeKey"] == "recovery"
    assert child_steps[1]["endConditionValue"] == 15
