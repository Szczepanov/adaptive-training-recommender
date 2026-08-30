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


# PI0 regression: a physiological anomaly alone cannot prove another person (ADR-0028 P-PI-8).


def test_co_presence_extreme_divergence_is_not_an_identity_fraud_claim() -> None:
    # A large delta is physiologically consistent with genuine illness/overreach and must not be
    # reported as a confirmed determination that someone else used the device.
    garmin_snap = {"raw": {"restingHr": 43}}
    eight_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 95.0}]}

    verdict = validate_co_presence(garmin_snap, eight_bundle, athlete_rhr_28d_median=44.0)
    assert verdict.verifiedAthlete is False
    assert verdict.concordanceStatus == "DISCORDANT_SECONDARY"
    lowered = verdict.reason.lower()
    assert "imposter" not in lowered
    assert "another person" not in lowered
    assert "fraud" not in lowered
    assert "quarantined" in lowered


def test_co_presence_status_vocabulary_has_no_confirmed_identity_verdict() -> None:
    garmin_snap = {"raw": {"restingHr": 44}}
    concordant = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 45.0}]}
    discordant = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 82.0}]}
    statuses = {
        validate_co_presence(garmin_snap, concordant, 44.0).concordanceStatus,
        validate_co_presence(garmin_snap, discordant, 44.0).concordanceStatus,
        validate_co_presence(None, concordant, 44.0).concordanceStatus,
        validate_co_presence(garmin_snap, None, 44.0).concordanceStatus,
    }

    assert statuses == {
        "CONCORDANT",
        "DISCORDANT_SECONDARY",
        "UNVERIFIED_OFF_WRIST",
        "NO_SECONDARY_DATA",
    }
    assert "NOT_USER" not in statuses
    assert "USER" not in statuses


def test_co_presence_quarantines_equally_regardless_of_divergence_magnitude() -> None:
    garmin_snap = {"raw": {"restingHr": 43}}
    moderate_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 60.0}]}
    extreme_bundle = {"observations": [{"metric": "daily_resting_heart_rate_bpm", "value": 150.0}]}

    moderate = validate_co_presence(garmin_snap, moderate_bundle, athlete_rhr_28d_median=44.0)
    extreme = validate_co_presence(garmin_snap, extreme_bundle, athlete_rhr_28d_median=44.0)

    # Both are quarantined identically; the heuristic has no mechanism to escalate a bigger
    # anomaly into a stronger identity claim.
    assert moderate.concordanceStatus == "DISCORDANT_SECONDARY"
    assert extreme.concordanceStatus == "DISCORDANT_SECONDARY"
    assert moderate.verifiedAthlete is False
    assert extreme.verifiedAthlete is False
