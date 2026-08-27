from garmin_sync.presence_filter import validate_co_presence


def test_co_presence_concordant_match() -> None:
    garmin_snap = {
        "raw": {
            "restingHr": 44,
            "sleep": {"startTimeGmt": "2026-08-27T22:30:00Z", "endTimeGmt": "2026-08-28T06:30:00Z"},
        }
    }
    eight_bundle = {
        "observations": [
            {"metric": "daily_resting_heart_rate_bpm", "value": 45.0},
            {
                "metric": "sleep_duration_seconds",
                "observedStart": "2026-08-27T22:45:00Z",
                "observedEnd": "2026-08-28T06:15:00Z",
            },
        ]
    }

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is True
    assert verdict.concordanceStatus == "CONCORDANT"
    assert verdict.imposterConfidence == "VERIFIED"
    assert verdict.rhrDelta == 1.0
    assert verdict.timingOverlapMinutes == 450


def test_co_presence_timing_mismatch_quarantined() -> None:
    garmin_snap = {
        "raw": {
            "restingHr": 44,
            "sleep": {"startTimeGmt": "2026-08-27T23:00:00Z", "endTimeGmt": "2026-08-28T07:00:00Z"},
        }
    }
    # Bed used during afternoon (nap by family member)
    eight_bundle = {
        "observations": [
            {"metric": "daily_resting_heart_rate_bpm", "value": 45.0},
            {
                "metric": "sleep_duration_seconds",
                "observedStart": "2026-08-27T14:00:00Z",
                "observedEnd": "2026-08-27T14:45:00Z",
            },
        ]
    }

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.concordanceStatus == "DISCORDANT_SECONDARY"
    assert "Sleep timing mismatch" in verdict.reason


def test_co_presence_physiological_divergence_rejected() -> None:
    garmin_snap = {"raw": {"restingHr": 43}}
    # Divergent occupant on mattress with RHR of 82 bpm
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 82.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.concordanceStatus == "DISCORDANT_SECONDARY"
    assert verdict.imposterConfidence == "IMPOSTER_REJECTED"
    assert verdict.rhrDelta == 39.0
    assert "physiological divergence" in verdict.reason


def test_co_presence_watch_off_wrist_quarantined_from_baseline() -> None:
    # Watch charging overnight, plausible athlete RHR (45 bpm)
    # Quarantined from mutating baseline per D-MS-PREBASE
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}

    verdict = validate_co_presence(None, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.concordanceStatus == "UNVERIFIED_OFF_WRIST"
    assert "quarantined from baseline mutation" in verdict.reason


def test_co_presence_watch_off_wrist_no_baseline() -> None:
    # Watch charging and no historical baseline yet -> unverified
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}

    verdict = validate_co_presence(None, eight_bundle, athlete_rhr_28d_median=None)
    assert verdict.verifiedAthlete is False
    assert verdict.concordanceStatus == "UNVERIFIED_OFF_WRIST"
    assert "cannot be verified without Garmin RHR or a historical baseline" in verdict.reason


def test_co_presence_top_level_resting_heart_rate_key() -> None:
    # Garmin snapshot with canonical top-level resting_heart_rate
    garmin_snap = {"resting_heart_rate": 45.0}
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 46.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=45.0)
    assert verdict.verifiedAthlete is True
    assert verdict.concordanceStatus == "CONCORDANT"
    assert verdict.rhrDelta == 1.0
