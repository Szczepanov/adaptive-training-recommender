from garmin_sync.presence_filter import validate_co_presence


def test_co_presence_verified_match() -> None:
    garmin_snap = {"raw": {"restingHr": 44}}
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is True
    assert verdict.imposterConfidence == "VERIFIED"
    assert verdict.rhrDelta == 1.0


def test_co_presence_imposter_child_rejected() -> None:
    garmin_snap = {"raw": {"restingHr": 43}}
    # Child sleeping on mattress with RHR of 82 bpm
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 82.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.imposterConfidence == "IMPOSTER_REJECTED"
    assert verdict.rhrDelta == 39.0
    assert "Likely a family member" in verdict.reason


def test_co_presence_watch_off_wrist_normal() -> None:
    # Watch charging overnight, genuine athlete on mattress (RHR 45 bpm)
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}

    verdict = validate_co_presence(None, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is True
    assert verdict.imposterConfidence == "UNVERIFIED_OFF_WRIST"


def test_co_presence_watch_off_wrist_imposter() -> None:
    # Watch charging, but child sleeping on bed (RHR 75 bpm)
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 75.0}]}

    verdict = validate_co_presence(None, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.imposterConfidence == "IMPOSTER_REJECTED"
