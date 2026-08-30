from unittest.mock import MagicMock

from garmin_sync.identity_replay_export import export_identity_replay_input


def _complete_garmin_snapshot(date: str) -> dict:
    return {
        "date": date,
        "raw": {
            "sleepScore": 80,
            "sleepDurationSec": 27000,
            "restingHr": 45.0,
            "hrvOvernightAvg": 52.0,
            "respirationAvg": 14.0,
            "bodyBatteryWake": 80,
            "totalSteps": 8000,
        },
    }


def _eight_sleep_bundle(date: str, **overrides) -> dict:
    bundle = {
        "logicalDate": date,
        "provider": "eight_sleep",
        "transport": "google_health",
        "revision": 1,
        "sourcePayloadHash": "sha256:real-hash",
        "observations": [
            {
                "metric": "sleep_session",
                "value": {"deepSeconds": 5400},
                "observedStart": f"{date}T22:00:00+00:00",
                "observedEnd": f"{date}T23:59:00+00:00",
            },
            {"metric": "daily_resting_heart_rate_bpm", "value": 47.0},
            {"metric": "hrv_rmssd_ms", "value": 55.0},
            {"metric": "respiration_rate_brpm", "value": 14.2},
        ],
    }
    bundle.update(overrides)
    return bundle


def test_export_paired_night_with_anchor_present() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-08-01": _complete_garmin_snapshot("2026-08-01")
    }
    repo.get_health_observation_bundles_in_range.return_value = [_eight_sleep_bundle("2026-08-01")]

    result = export_identity_replay_input(repo, "2026-08-01", "2026-08-01", "test-uid")

    assert result.pairedNightCount == 1
    assert result.anchorPresentCount == 1
    assert result.anchorMissingCount == 0

    night = result.nights[0]
    assert night["sourceNightKey"] == "2026-08-01"
    assert night["anchorPresent"] is True
    assert night["anchorTechnicallyEligible"] is True
    assert len(night["anchorBundleRefs"]) == 1

    anchor_ref = night["anchorBundleRefs"][0]
    assert anchor_ref["provider"] == "garmin"
    assert anchor_ref["transport"] == "garmin_direct"
    assert anchor_ref["lineageKey"] == "garmin_direct:test-uid"

    shared_ref = night["sharedBundleRef"]
    assert shared_ref["provider"] == "eight_sleep"
    assert shared_ref["transport"] == "google_health"
    assert shared_ref["lineageKey"] == "google_health:test-uid"
    assert shared_ref["sourcePayloadHash"] == "sha256:real-hash"
    assert shared_ref["revision"] == 1

    # Lineage keys must differ so isLineageIndependent (TS side) treats the anchor as independent.
    assert anchor_ref["lineageKey"] != shared_ref["lineageKey"]

    # This fixture's raw snapshot has no sleepSessionStart/sleepSessionEnd (e.g. a night
    # synced before the sleep-timing plumbing fix) -- see
    # test_export_garmin_session_populated_when_raw_has_sleep_timing for the positive case.
    assert night["garminSessions"] == []
    assert night["eightSleepSessions"] == [
        {"startIso": "2026-08-01T22:00:00+00:00", "endIso": "2026-08-01T23:59:00+00:00"}
    ]

    assert night["sharedRestingHeartRate"] == 47.0
    assert night["garminRestingHeartRate"] == 45.0
    assert night["sharedRespirationRate"] == 14.2
    assert night["garminRespirationRate"] == 14.0
    assert night["sharedHrv"] == 55.0
    assert night["garminHrv"] == 52.0

    # 22:00 UTC on 2026-08-01 is 00:00 local (Europe/Warsaw, CEST = UTC+2) -> next-day local minute 0.
    assert night["sharedSleepStartMinutesLocal"] == 0
    assert night["sharedSleepDurationMinutes"] == 119.0


def test_export_anchor_missing_is_not_dropped() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {}
    repo.get_health_observation_bundles_in_range.return_value = [_eight_sleep_bundle("2026-08-02")]

    result = export_identity_replay_input(repo, "2026-08-02", "2026-08-02", "test-uid")

    assert result.pairedNightCount == 1
    assert result.anchorMissingCount == 1
    night = result.nights[0]
    assert night["anchorPresent"] is False
    assert night["anchorTechnicallyEligible"] is False
    assert night["anchorBundleRefs"] == []
    assert night["garminRestingHeartRate"] is None


def test_export_incomplete_garmin_snapshot_is_present_but_technically_ineligible() -> None:
    repo = MagicMock()
    incomplete = _complete_garmin_snapshot("2026-08-03")
    del incomplete["raw"]["hrvOvernightAvg"]
    repo.get_historical_snapshots.return_value = {"2026-08-03": incomplete}
    repo.get_health_observation_bundles_in_range.return_value = [_eight_sleep_bundle("2026-08-03")]

    result = export_identity_replay_input(repo, "2026-08-03", "2026-08-03", "test-uid")

    night = result.nights[0]
    assert night["anchorPresent"] is True
    assert night["anchorTechnicallyEligible"] is False
    # Still contributes its raw HRV value even though it fails the technical-completeness bar --
    # eligibility and data availability are independent (mirrors PI1's identity/quality separation).
    assert night["garminHrv"] is None


def test_export_night_with_no_shared_bundle_is_excluded() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-08-04": _complete_garmin_snapshot("2026-08-04")
    }
    repo.get_health_observation_bundles_in_range.return_value = []

    result = export_identity_replay_input(repo, "2026-08-04", "2026-08-04", "test-uid")

    assert result.pairedNightCount == 0
    assert result.nights == []


def test_export_garmin_session_populated_when_raw_has_sleep_timing() -> None:
    repo = MagicMock()
    without_timing = _complete_garmin_snapshot("2026-08-06")
    with_timing = _complete_garmin_snapshot("2026-08-07")
    with_timing["raw"]["sleepSessionStart"] = "2026-08-07T22:10:00+00:00"
    with_timing["raw"]["sleepSessionEnd"] = "2026-08-08T06:00:00+00:00"
    repo.get_historical_snapshots.return_value = {
        "2026-08-06": without_timing,
        "2026-08-07": with_timing,
    }
    repo.get_health_observation_bundles_in_range.return_value = [
        _eight_sleep_bundle("2026-08-06"),
        _eight_sleep_bundle("2026-08-07"),
    ]

    result = export_identity_replay_input(repo, "2026-08-06", "2026-08-07", "test-uid")
    nights_by_date = {n["sourceNightKey"]: n for n in result.nights}

    assert nights_by_date["2026-08-06"]["garminSessions"] == []
    assert nights_by_date["2026-08-07"]["garminSessions"] == [
        {"startIso": "2026-08-07T22:10:00+00:00", "endIso": "2026-08-08T06:00:00+00:00"}
    ]
    # The anchor ref's hash must vary with session timing too, or a real timing correction
    # would silently look identical to a night with no timing data at all.
    assert (
        nights_by_date["2026-08-06"]["anchorBundleRefs"][0]["sourcePayloadHash"]
        != nights_by_date["2026-08-07"]["anchorBundleRefs"][0]["sourcePayloadHash"]
    )


def test_export_nap_and_real_night_both_become_pairing_candidates() -> None:
    """Real bug found in production: a single bundle can carry a short nap/presence reading
    alongside the real overnight session, both attributed to the same logicalDate (confirmed
    against real Firestore data for 2026-07-05, 2026-08-03, 2026-08-14). Returning only the
    first session fed the nap into identity pairing as if it were the whole night. Both must
    become pairing candidates -- identityFeatures.ts's selectBestSessionPairing already knows
    how to pick the real overlap, but only if every real candidate reaches it -- while the
    scalar baseline fields (sharedSleepStartMinutesLocal/sharedSleepDurationMinutes) must use
    the real (longest) night, not whichever came first in Firestore's observation order."""
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-07-05": _complete_garmin_snapshot("2026-07-05")
    }
    nap_first_bundle = _eight_sleep_bundle(
        "2026-07-05",
        observations=[
            # Nap listed first, exactly matching the real Firestore observation order found.
            {
                "metric": "sleep_session",
                "value": {"durationSeconds": 3780},
                "observedStart": "2026-07-05T15:01:30+00:00",
                "observedEnd": "2026-07-05T16:04:30+00:00",
            },
            {
                "metric": "sleep_session",
                "value": {"durationSeconds": 17730},
                "observedStart": "2026-07-05T00:09:30+00:00",
                "observedEnd": "2026-07-05T05:05:00+00:00",
            },
            {"metric": "daily_resting_heart_rate_bpm", "value": 47.0},
            {"metric": "hrv_rmssd_ms", "value": 55.0},
            {"metric": "respiration_rate_brpm", "value": 14.2},
        ],
    )
    repo.get_health_observation_bundles_in_range.return_value = [nap_first_bundle]

    result = export_identity_replay_input(repo, "2026-07-05", "2026-07-05", "test-uid")

    night = result.nights[0]
    assert night["eightSleepSessions"] == [
        {"startIso": "2026-07-05T15:01:30+00:00", "endIso": "2026-07-05T16:04:30+00:00"},
        {"startIso": "2026-07-05T00:09:30+00:00", "endIso": "2026-07-05T05:05:00+00:00"},
    ]
    # The scalar fields must reflect the real (longest) night, not the nap listed first.
    assert night["sharedSleepDurationMinutes"] == 295.5  # 17730s
    assert (
        night["sharedSleepStartMinutesLocal"] == 2 * 60 + 9
    )  # 00:09:30 UTC -> 02:09 Warsaw (CEST)


def test_export_config_uses_garmin_direct_anchor_policy() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {}
    repo.get_health_observation_bundles_in_range.return_value = []

    result = export_identity_replay_input(repo, "2026-08-05", "2026-08-05", "test-uid")

    assert result.config["method"] == "leaveOneOut"
    assert result.config["anchorPolicy"]["primaryProvider"] == "garmin"
    assert result.config["anchorPolicy"]["primaryTransport"] == "garmin_direct"
