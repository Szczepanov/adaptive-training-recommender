from garmin_sync.garmin_provider import canonicalize_activities, extract_running_dynamics


def test_canonicalize_activities_keeps_running_dynamics_running_only():
    raw = [
        {
            "activityId": 2001,
            "startTimeLocal": "2026-08-23T08:00:00",
            "activityType": {"typeKey": "cycling"},
            "duration": 3600,
            # These generic keys are valid cycling power fields too. They must never
            # create a CanonicalRunningDynamics object on a non-running activity.
            "avgPower": 245,
            "maxPower": 510,
        }
    ]

    activity = canonicalize_activities(raw)[0]

    assert activity.type == "cycling"
    assert activity.running_dynamics is None


def test_extract_running_dynamics_ignores_zero_sentinel_metrics():
    dynamics = extract_running_dynamics(
        {
            "activityType": {"typeKey": "running"},
            "avgGroundContactTime": 0,
            "avgVerticalOscillation": 0,
            "avgStrideLength": 0,
            "avgPower": 0,
            "maxPower": 0,
        }
    )

    assert dynamics is None


def test_canonicalize_activities_handles_malformed_activity_type_shape():
    raw = [
        {
            "activityId": 2002,
            "startTimeLocal": "2026-08-23T08:00:00",
            "activityType": "running",
            "duration": 1800,
            "avgGroundContactTime": 235,
        }
    ]

    activity = canonicalize_activities(raw)

    assert activity[0].type == "unknown"
    assert activity[0].running_dynamics is None
