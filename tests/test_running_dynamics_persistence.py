from garmin_sync.canonical import CanonicalActivity, CanonicalRunningDynamics
from garmin_sync.mapper import normalize_activity


def _activity(activity_type: str) -> CanonicalActivity:
    return CanonicalActivity(
        activity_id="a-1",
        date="2026-08-23",
        type=activity_type,
        duration_min=45,
        duration_seconds=2700,
        training_effect_aerobic=3.0,
        training_effect_anaerobic=0.0,
        average_hr=150.0,
        training_load=80.0,
        intensity_tag="moderate",
        running_dynamics=CanonicalRunningDynamics(
            ground_contact_time_ms=238.0,
            ground_contact_balance_left_pct=49.6,
            vertical_oscillation_cm=8.2,
            vertical_ratio_pct=7.1,
            stride_length_m=1.18,
            avg_running_power_watts=285,
            max_running_power_watts=410,
        ),
    )


def test_normalize_activity_persists_running_dynamics_for_running_sport():
    payload = normalize_activity(_activity("trail_running"), "sync-1")

    assert payload["runningDynamics"] == {
        "groundContactTimeMs": 238.0,
        "groundContactBalanceLeftPct": 49.6,
        "verticalOscillationCm": 8.2,
        "verticalRatioPct": 7.1,
        "strideLengthM": 1.18,
        "avgRunningPowerWatts": 285,
        "maxRunningPowerWatts": 410,
    }


def test_normalize_activity_does_not_persist_running_dynamics_for_cycling():
    payload = normalize_activity(_activity("cycling"), "sync-1")

    assert "runningDynamics" not in payload
