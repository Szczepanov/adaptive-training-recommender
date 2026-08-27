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


def test_co_presence_watch_off_wrist_no_baseline() -> None:
    # Watch charging and no historical baseline yet -> unverified
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}

    verdict = validate_co_presence(None, eight_bundle, athlete_rhr_28d_median=None)
    assert verdict.verifiedAthlete is False
    assert verdict.imposterConfidence == "UNVERIFIED_OFF_WRIST"
    assert "cannot be verified without Garmin RHR or a historical baseline" in verdict.reason


def test_co_presence_top_level_resting_heart_rate_key() -> None:
    # Garmin snapshot with canonical top-level resting_heart_rate
    garmin_snap = {"resting_heart_rate": 45.0}
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 46.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=45.0)
    assert verdict.verifiedAthlete is True
    assert verdict.imposterConfidence == "VERIFIED"
    assert verdict.rhrDelta == 1.0
