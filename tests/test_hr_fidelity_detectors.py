from garmin_sync._hr_fidelity_detectors import activity_motion_risk


def test_activity_motion_risk_moderate_for_cycling_and_running() -> None:
    assert activity_motion_risk("cycling") == "moderate"
    assert activity_motion_risk("gravel_cycling") == "moderate"
    assert activity_motion_risk("run") == "moderate"
    assert activity_motion_risk("running") == "moderate"
    assert activity_motion_risk("trail_running") == "moderate"
    assert activity_motion_risk("treadmill_run") == "moderate"

def test_activity_motion_risk_high_for_erratic_movement_sports() -> None:
    assert activity_motion_risk("soccer") == "high"
    assert activity_motion_risk("strength_training") == "high"
    assert activity_motion_risk("rowing") == "high"

def test_activity_motion_risk_unknown_for_other_sports() -> None:
    assert activity_motion_risk("yoga") == "unknown"
    assert activity_motion_risk("meditation") == "unknown"
    assert activity_motion_risk("walking") == "unknown"

def test_activity_motion_risk_handles_formatting() -> None:
    assert activity_motion_risk("  cyCling  ") == "moderate"
    assert activity_motion_risk("RUNNING") == "moderate"
    assert activity_motion_risk("  Trail_Running  ") == "moderate"
    assert activity_motion_risk("SOCCER") == "high"
