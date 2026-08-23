from garmin_sync.garmin_provider import canonicalize_activities, canonicalize_from_raw


def _daily_metrics(*, readiness: list[dict[str, object]] | None, stats: dict[str, object]):
    return canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=None,
        sleep_today={},
        sleep_fallback=None,
        hrv_today={},
        target_date_iso="2026-08-23",
        yesterday_iso="2026-08-22",
        training_readiness_today=readiness,
    )


def test_daily_recovery_prefers_training_readiness_and_converts_minutes():
    canonical = _daily_metrics(
        readiness=[{"score": 82, "recoveryTime": 90}],
        # The legacy stats value must not override the live readiness reading.
        stats={"restingHeartRate": 52, "recoveryTime": 18},
    )

    assert canonical.recovery_time_hours == 2


def test_daily_recovery_reached_zero_overrides_stale_assigned_time():
    canonical = _daily_metrics(
        readiness=[
            {
                "score": 90,
                "recoveryTime": 720,
                "recoveryTimeChangePhrase": "REACHED_ZERO",
            }
        ],
        stats={"restingHeartRate": 48},
    )

    assert canonical.recovery_time_hours == 0


def test_activity_recovery_time_uses_key_semantics_not_magnitude():
    activity = canonicalize_activities(
        [
            {
                "activityId": 42,
                "startTimeLocal": "2026-08-23T08:00:00",
                "activityType": {"typeKey": "running"},
                "duration": 1800,
                "recoveryTime": 90,
            }
        ]
    )[0]

    assert activity.recovery_time_hours == 2


def test_activity_accepts_current_training_effect_label_and_explicit_hours():
    activity = canonicalize_activities(
        [
            {
                "activityId": 43,
                "startTimeLocal": "2026-08-23T09:00:00",
                "activityType": {"typeKey": "cycling"},
                "duration": 3600,
                "trainingEffectLabel": "TEMPO",
                "recoveryTimeHours": 18,
            }
        ]
    )[0]

    assert activity.training_effect_label == "TEMPO"
    assert activity.recovery_time_hours == 18
