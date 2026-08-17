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



