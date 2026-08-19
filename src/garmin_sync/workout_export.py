import re
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


def _extract_power_target(
    targets: list[str] | None, ftp_watts: float | None = None
) -> tuple[float, float] | None:
    """Extract (min_watts, max_watts) from target strings like '230-240 W', '140–175 W',
    or derived from '% FTP' if ftp_watts is provided."""
    if not targets:
        return None
    for t in targets:
        if not isinstance(t, str):
            continue
        # 1. Exact Watts range (e.g., '230-240 W', '140–175 W')
        m = re.search(r"(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*W\b", t, re.IGNORECASE)
        if m:
            return float(m.group(1)), float(m.group(2))
        single_m = re.search(r"(\d+(?:\.\d+)?)\s*W\b", t, re.IGNORECASE)
        if single_m:
            w = float(single_m.group(1))
            return w, w

        # 2. % FTP range derived with known athlete FTP (e.g., '65-75% FTP', '90–95% FTP')
        if ftp_watts and ftp_watts > 0:
            ftp_m = re.search(
                r"(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*%\s*(?:FTP)?",
                t,
                re.IGNORECASE,
            )
            if ftp_m:
                p1 = float(ftp_m.group(1)) / 100.0
                p2 = float(ftp_m.group(2)) / 100.0
                return round(ftp_watts * p1, 1), round(ftp_watts * p2, 1)

            single_ftp_m = re.search(
                r"(\d+(?:\.\d+)?)\s*%\s*FTP\b",
                t,
                re.IGNORECASE,
            )
            if single_ftp_m:
                p = float(single_ftp_m.group(1)) / 100.0
                val = round(ftp_watts * p, 1)
                return val, val
    return None


def _extract_zone_target(targets: list[str] | None) -> int | None:
    """Extract Coggan/Garmin power zone number (1-7) from target strings like 'Zone 2',
    'Z2', 'Tempo', 'Threshold', or '% FTP' ranges when FTP is not known."""
    if not targets:
        return None
    for t in targets:
        if not isinstance(t, str):
            continue
        # 1. Explicit Zone syntax: 'Zone 2', 'Z2', 'Zone-2', 'Z 2'
        m = re.search(r"\b(?:zone|z)\s*[-–—]?\s*([1-7])\b", t, re.IGNORECASE)
        if m:
            return int(m.group(1))

        # 2. Named Coggan power training levels
        tl = t.lower()
        if re.search(r"\bactive recovery\b", tl):
            return 1
        if re.search(r"\bendurance\b", tl):
            return 2
        if re.search(r"\btempo\b", tl):
            return 3
        if re.search(r"\bthreshold\b|\bsweet\s*spot\b", tl):
            return 4
        if re.search(r"\bvo2\s*(?:max)?\b", tl):
            return 5
        if re.search(r"\banaerobic(?:\s*capacity)?\b", tl):
            return 6
        if re.search(r"\bneuromuscular\b|\bsprint\b", tl):
            return 7

        # 3. % FTP mapped to Coggan 7-zone system if no FTP was supplied
        pct_m = re.search(
            r"(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?\s*%\s*(?:FTP)?",
            t,
            re.IGNORECASE,
        )
        if pct_m:
            v1 = float(pct_m.group(1))
            v2 = float(pct_m.group(2)) if pct_m.group(2) else v1
            avg_pct = (v1 + v2) / 2.0
            if avg_pct <= 55.0:
                return 1
            elif avg_pct <= 75.0:
                return 2
            elif avg_pct <= 90.0:
                return 3
            elif avg_pct <= 105.0:
                return 4
            elif avg_pct <= 120.0:
                return 5
            elif avg_pct <= 150.0:
                return 6
            else:
                return 7
    return None


def _extract_recovery_seconds(step: dict[str, Any]) -> int | None:
    text = f"{step.get('notes', '')} {step.get('name', '')} {step.get('description', '')}"
    if not text.strip():
        return None
    m = re.search(
        r"followed\s+by\s+(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\b",
        text,
        re.IGNORECASE,
    )
    if m:
        val = float(m.group(1))
        unit = m.group(2).lower()
        return round(val * 60) if unit.startswith("m") else round(val)
    m2 = re.search(
        r"(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\s+(?:easy|rest|recovery|off)\b",
        text,
        re.IGNORECASE,
    )
    if m2:
        val = float(m2.group(1))
        unit = m2.group(2).lower()
        return round(val * 60) if unit.startswith("m") else round(val)
    m3 = re.search(r"\b(\d+)\s*(?:s|sec)?\s*/\s*(\d+)\s*(?:s|sec)?\b", text, re.IGNORECASE)
    if m3:
        on_val = int(m3.group(1))
        off_val = int(m3.group(2))
        dur = step.get("durationSeconds")
        if not dur or dur == on_val:
            return off_val
    return None


def _extract_set_recovery_seconds(step: dict[str, Any]) -> int | None:
    text = f"{step.get('notes', '')} {step.get('description', '')}"
    if not text.strip():
        return None
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)(?:\s+(?:easy|rest|recovery|riding))?\s+between\s+sets\b",
        text,
        re.IGNORECASE,
    )
    if m:
        val = float(m.group(1))
        unit = m.group(2).lower()
        return round(val * 60) if unit.startswith("m") else round(val)
    return None


def _resolve_strength_rest_seconds(step: dict[str, Any]) -> int | None:
    """Resolve inter-set rest for a strength step with explicit precedence:

    1. ``setRecoverySec`` (v1 ``ExternalPrescriptionStep`` dedicated field)
    2. ``restAfterSec`` (v2/catalog generic per-step rest, used as a
       fallback for strength inter-set recovery)
    3. ``None`` — no rest step. The transformer must never invent a rest
       duration; it preserves instructions, it does not author them.
    """
    set_recovery = step.get("setRecoverySec")
    if set_recovery and set_recovery > 0:
        return int(set_recovery)
    rest_after = step.get("restAfterSec")
    if rest_after and rest_after > 0:
        return int(rest_after)
    return None


def _build_strength_step_or_group(
    step: dict[str, Any],
    step_order: int,
    default_step_type: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """Build the Garmin step (or ``RepeatGroupDTO``) for one strength exercise.

    Strength semantics are distinct from endurance intervals and are kept in
    their own branch rather than folded into the cycling/running repeat-group
    logic:

    - ``sets`` is a working-set count and is never used as a repetition
      target.
    - ``repetitions`` is the rep target inside one set; when present, the
      exercise gets a ``reps`` end condition and (when ``sets > 1``) is
      wrapped in a ``RepeatGroupDTO`` with ``numberOfIterations == sets``.
    - when there is no repetition target, ``durationSeconds`` is used
      as-is (a genuinely time-based block); ``sets`` does not turn a
      duration block into a fabricated repeat.
    - when neither a repetition target nor a duration is available, the
      step falls back to a manual/lap-button end condition rather than
      inventing a duration or aliasing ``sets`` as reps.

    Returns ``(garmin_step, next_step_order)``.
    """
    sets = step.get("sets")
    reps = step.get("repetitions")
    duration_sec = step.get("durationSeconds")

    step_name = str(step.get("name", "")).strip()
    step_name_lower = step_name.lower()
    targets = step.get("targets")
    desc_parts = [step_name] if step_name else []
    if targets and isinstance(targets, list) and targets:
        desc_parts.append(f"({'; '.join(targets)})")
    step_desc = " ".join(desc_parts) if desc_parts else None

    step_type = default_step_type
    if "warm" in step_name_lower:
        step_type = STEP_TYPE_MAP["warmup"]
    elif "cool" in step_name_lower:
        step_type = STEP_TYPE_MAP["cooldown"]

    if reps and reps > 0:
        end_condition = END_CONDITION_MAP["reps"]
        end_condition_value: Any = reps
    elif duration_sec and duration_sec > 0:
        end_condition = END_CONDITION_MAP["time"]
        end_condition_value = duration_sec
    else:
        # No usable rep target and no duration: prefer an explicit/manual
        # completion condition over fabricating a duration or using the
        # set count as the rep target.
        end_condition = END_CONDITION_MAP["lap_button"]
        end_condition_value = None

    exercise_dto: dict[str, Any] = {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": 1,
        "stepType": step_type,
        "childStepId": None,
        "description": step_desc,
        "endCondition": end_condition,
        "endConditionValue": end_condition_value,
        "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"},
        "targetValueOne": None,
        "targetValueTwo": None,
        "zoneNumber": None,
    }

    if sets and sets > 1 and reps and reps > 0:
        rest_sec = _resolve_strength_rest_seconds(step)
        child_steps = [exercise_dto]
        if rest_sec:
            child_steps.append(
                {
                    "type": "ExecutableStepDTO",
                    "stepId": None,
                    "stepOrder": 2,
                    "stepType": STEP_TYPE_MAP["recovery"],
                    "childStepId": None,
                    "description": "Set recovery",
                    "endCondition": END_CONDITION_MAP["time"],
                    "endConditionValue": rest_sec,
                    "targetType": {
                        "workoutTargetTypeId": 1,
                        "workoutTargetTypeKey": "no.target",
                    },
                    "targetValueOne": None,
                    "targetValueTwo": None,
                    "zoneNumber": None,
                }
            )

        garmin_step: dict[str, Any] = {
            "type": "RepeatGroupDTO",
            "stepId": None,
            "stepOrder": step_order,
            "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
            "childStepId": 1,
            "numberOfIterations": sets,
            "smartRepeat": False,
            "workoutSteps": child_steps,
        }
    else:
        exercise_dto["stepOrder"] = step_order
        garmin_step = exercise_dto

    return garmin_step, step_order + 1


def _build_step_dto(
    step: dict[str, Any],
    step_order: int,
    default_step_type: dict[str, Any],
    modality: str,
    ftp: float | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    duration_sec = step.get("durationSeconds") or 300
    # `sets` (a working-set count) must never be aliased as a repetition
    # target — only `repetitions` (reps inside one set) counts here.
    reps = step.get("repetitions")

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

    power_target = _extract_power_target(targets, ftp_watts=ftp)
    zone_target = _extract_zone_target(targets) if not power_target else None

    if modality in ["cycling", "bike"]:
        if power_target:
            target_type = {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
            target_val_one: float | None = power_target[0]
            target_val_two: float | None = power_target[1]
            zone_num: int | None = None
        elif zone_target:
            target_type = {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
            target_val_one = None
            target_val_two = None
            zone_num = zone_target
        else:
            target_type = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
            target_val_one = None
            target_val_two = None
            zone_num = None
    else:
        target_type = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
        target_val_one = None
        target_val_two = None
        zone_num = None

    if reps and modality == "strength":
        end_condition = END_CONDITION_MAP["reps"]
        end_condition_value = reps
    else:
        end_condition = END_CONDITION_MAP["time"]
        end_condition_value = duration_sec

    main_dto: dict[str, Any] = {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": step_order,
        "stepType": step_type,
        "childStepId": None,
        "description": step_desc,
        "endCondition": end_condition,
        "endConditionValue": end_condition_value,
        "targetType": target_type,
        "targetValueOne": target_val_one,
        "targetValueTwo": target_val_two,
        "zoneNumber": zone_num,
    }

    rest_dto: dict[str, Any] | None = None
    rest_sec = step.get("restAfterSec")
    if not rest_sec:
        rest_sec = _extract_recovery_seconds(step)

    if rest_sec and rest_sec > 0:
        rec_target_str = step.get("recoveryTarget")
        rec_targets = [rec_target_str] if rec_target_str else None
        rec_power = _extract_power_target(rec_targets, ftp_watts=ftp)
        rec_zone = _extract_zone_target(rec_targets) if not rec_power else None

        if modality in ["cycling", "bike"] and rec_power:
            rec_target_type = {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
            rec_val_one: float | None = rec_power[0]
            rec_val_two: float | None = rec_power[1]
            rec_zone_num: int | None = None
        elif modality in ["cycling", "bike"] and rec_zone:
            rec_target_type = {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"}
            rec_val_one = None
            rec_val_two = None
            rec_zone_num = rec_zone
        else:
            rec_target_type = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
            rec_val_one = None
            rec_val_two = None
            rec_zone_num = None

        rest_dto = {
            "type": "ExecutableStepDTO",
            "stepId": None,
            "stepOrder": step_order + 1,
            "stepType": STEP_TYPE_MAP["recovery"],
            "childStepId": None,
            "description": f"Rest interval ({rec_target_str})"
            if rec_target_str
            else "Rest interval",
            "endCondition": END_CONDITION_MAP["time"],
            "endConditionValue": rest_sec,
            "targetType": rec_target_type,
            "targetValueOne": rec_val_one,
            "targetValueTwo": rec_val_two,
            "zoneNumber": rec_zone_num,
        }

    return main_dto, rest_dto


def summarize_garmin_payload(
    workout: dict[str, Any], garmin_payload: dict[str, Any]
) -> dict[str, Any]:
    """Small transform-observability summary, meant for logging only.

    Lets a report like "Garmin only shows three exercises" be diagnosed from
    logs without first reproducing the whole UI flow. Contains only shape
    metadata (ids, counts) -- never credentials, tokens, or raw health data.
    """

    def _count_recovery_steps(step_list: list[dict[str, Any]]) -> int:
        count = 0
        for s in step_list:
            if s.get("stepType", {}).get("stepTypeKey") == "recovery":
                count += 1
            if s.get("type") == "RepeatGroupDTO":
                count += _count_recovery_steps(s.get("workoutSteps", []))
        return count

    top_level_steps = garmin_payload.get("workoutSegments", [{}])[0].get("workoutSteps", [])
    canonical_step_count = sum(len(block.get("steps", [])) for block in workout.get("blocks", []))
    repeat_group_count = sum(1 for s in top_level_steps if s.get("type") == "RepeatGroupDTO")

    return {
        "workoutId": workout.get("workoutId"),
        "title": workout.get("title"),
        "modality": workout.get("modality"),
        "canonicalStepCount": canonical_step_count,
        "garminTopLevelStepCount": len(top_level_steps),
        "repeatGroupCount": repeat_group_count,
        "recoveryStepCount": _count_recovery_steps(top_level_steps),
    }


def canonical_workout_to_garmin_payload(
    workout: dict[str, Any], athlete_ftp: float | None = None
) -> dict[str, Any]:
    """Convert canonical workout JSON into Garmin Connect's workout payload structure."""
    modality = str(workout.get("modality", "cycling")).lower()
    sport = SPORT_TYPE_MAP.get(modality, SPORT_TYPE_MAP["cycling"])
    title = str(workout.get("title", "Adaptive Workout"))
    blocks = workout.get("blocks", [])
    ftp = athlete_ftp if athlete_ftp is not None else workout.get("athleteFtpWatts")

    workout_steps: list[dict[str, Any]] = []
    step_order = 1

    for block in blocks:
        block_role = str(block.get("role", "main")).lower()
        block_reps = block.get("repetitions") or block.get("sets")
        block_steps = block.get("steps", [])
        default_step_type = (
            STEP_TYPE_MAP["warmup"]
            if block_role == "warmup"
            else STEP_TYPE_MAP["cooldown"]
            if block_role == "cooldown"
            else STEP_TYPE_MAP["interval"]
        )

        # 1. Block-level repeat: when a multi-step block has repetitions > 1
        if block_reps and block_reps > 1 and modality != "strength" and len(block_steps) > 1:
            child_steps: list[dict[str, Any]] = []
            child_order = 1
            for step in block_steps:
                main_dto, rest_dto = _build_step_dto(
                    step, child_order, default_step_type, modality, ftp=ftp
                )
                main_dto["stepOrder"] = child_order
                child_steps.append(main_dto)
                child_order += 1
                if rest_dto:
                    rest_dto["stepOrder"] = child_order
                    child_steps.append(rest_dto)
                    child_order += 1

            block_rest_sec = block.get("restAfterSec")
            if block_rest_sec and block_rest_sec > 0:
                child_steps.append(
                    {
                        "type": "ExecutableStepDTO",
                        "stepId": None,
                        "stepOrder": child_order,
                        "stepType": STEP_TYPE_MAP["recovery"],
                        "childStepId": None,
                        "description": "Block recovery",
                        "endCondition": END_CONDITION_MAP["time"],
                        "endConditionValue": block_rest_sec,
                        "targetType": {
                            "workoutTargetTypeId": 1,
                            "workoutTargetTypeKey": "no.target",
                        },
                        "targetValueOne": None,
                        "targetValueTwo": None,
                        "zoneNumber": None,
                    }
                )
                child_order += 1

            repeat_group: dict[str, Any] = {
                "type": "RepeatGroupDTO",
                "stepId": None,
                "stepOrder": step_order,
                "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
                "childStepId": 1,
                "numberOfIterations": block_reps,
                "smartRepeat": False,
                "workoutSteps": child_steps,
            }
            workout_steps.append(repeat_group)
            step_order += 1

        else:
            # 2. Step-level repeat or sequential execution
            for step in block_steps:
                if modality == "strength":
                    # Strength has its own sets/reps/rest semantics and is
                    # handled by a dedicated builder rather than the
                    # endurance repeat-group cases below.
                    garmin_step, step_order = _build_strength_step_or_group(
                        step, step_order, default_step_type
                    )
                    workout_steps.append(garmin_step)
                    continue

                sets = step.get("sets")
                reps = step.get("repetitions")
                set_recovery_sec = step.get("setRecoverySec")
                if not set_recovery_sec and (
                    sets or "between sets" in str(step.get("notes", "")).lower()
                ):
                    set_recovery_sec = _extract_set_recovery_seconds(step)

                # Case A: Multi-set intervals (e.g. 3 sets of 10 reps)
                if sets and sets > 1 and reps and reps > 1 and modality != "strength":
                    for s in range(1, sets + 1):
                        main_dto, rest_dto = _build_step_dto(
                            step, 1, default_step_type, modality, ftp=ftp
                        )
                        repeat_child_steps = [main_dto]
                        if rest_dto:
                            rest_dto["stepOrder"] = 2
                            repeat_child_steps.append(rest_dto)

                        repeat_group = {
                            "type": "RepeatGroupDTO",
                            "stepId": None,
                            "stepOrder": step_order,
                            "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
                            "childStepId": 1,
                            "numberOfIterations": reps,
                            "smartRepeat": False,
                            "workoutSteps": repeat_child_steps,
                        }
                        workout_steps.append(repeat_group)
                        step_order += 1

                        if s < sets and set_recovery_sec and set_recovery_sec > 0:
                            set_rest_dto = {
                                "type": "ExecutableStepDTO",
                                "stepId": None,
                                "stepOrder": step_order,
                                "stepType": STEP_TYPE_MAP["recovery"],
                                "childStepId": None,
                                "description": "Set recovery",
                                "endCondition": END_CONDITION_MAP["time"],
                                "endConditionValue": set_recovery_sec,
                                "targetType": {
                                    "workoutTargetTypeId": 1,
                                    "workoutTargetTypeKey": "no.target",
                                },
                                "targetValueOne": None,
                                "targetValueTwo": None,
                                "zoneNumber": None,
                            }
                            workout_steps.append(set_rest_dto)
                            step_order += 1

                # Case B: Single-set repeat (repetitions > 1 or sets > 1)
                elif ((reps and reps > 1) or (sets and sets > 1)) and modality != "strength":
                    iteration_count = reps if (reps and reps > 1) else sets
                    main_dto, rest_dto = _build_step_dto(
                        step, 1, default_step_type, modality, ftp=ftp
                    )
                    repeat_child_steps = [main_dto]
                    if rest_dto:
                        rest_dto["stepOrder"] = 2
                        repeat_child_steps.append(rest_dto)

                    repeat_group = {
                        "type": "RepeatGroupDTO",
                        "stepId": None,
                        "stepOrder": step_order,
                        "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
                        "childStepId": 1,
                        "numberOfIterations": iteration_count,
                        "smartRepeat": False,
                        "workoutSteps": repeat_child_steps,
                    }
                    workout_steps.append(repeat_group)
                    step_order += 1

                # Case C: Sequential execution
                else:
                    main_dto, rest_dto = _build_step_dto(
                        step, step_order, default_step_type, modality, ftp=ftp
                    )
                    workout_steps.append(main_dto)
                    step_order += 1
                    if rest_dto:
                        rest_dto["stepOrder"] = step_order
                        workout_steps.append(rest_dto)
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
