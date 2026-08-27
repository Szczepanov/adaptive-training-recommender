from unittest.mock import MagicMock

from garmin_sync.identity_eligibility import EffectiveIdentityDecisionProjection
from garmin_sync.multisource_audit import (
    _calc_correlation,
    _calc_mad,
    _calc_median,
    run_multisource_audit,
)


def test_audit_math_helpers() -> None:
    vals = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert _calc_median(vals) == 30.0
    assert _calc_mad(vals, 30.0) is not None

    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert round(_calc_correlation(xs, ys), 2) == 1.0


def test_run_multisource_audit_mocked() -> None:
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {
        "2026-08-25": {"date": "2026-08-25", "raw": {"sleepDurationSec": 28800, "restingHr": 45.0}}
    }
    mock_repo.get_health_observation_bundles_in_range.return_value = [
        {
            "logicalDate": "2026-08-25",
            "provider": "eight_sleep",
            "transport": "google_health",
            "revision": 3,
            "sourcePayloadHash": "sha256:eight-sleep-2026-08-25",
            "observations": [
                {"metric": "sleep_duration_seconds", "value": 28800},
                {"metric": "daily_resting_heart_rate_bpm", "value": 45.0},
                {"metric": "hrv_rmssd_ms", "value": 60.0},
                {"metric": "respiration_rate_brpm", "value": 13.0},
            ],
        }
    ]

    decision = EffectiveIdentityDecisionProjection(
        assessment_id="assessment-2026-08-25",
        source_night_key="2026-08-25",
        provider="eight_sleep",
        transport="google_health",
        bundle_id="2026-08-25_eight_sleep_google_health",
        bundle_revision=3,
        source_payload_hash="sha256:eight-sleep-2026-08-25",
        effective_status="USER",
        baseline_learning=True,
    )
    report = run_multisource_audit(
        mock_repo,
        "2026-08-25",
        "2026-08-25",
        {("2026-08-25", "eight_sleep", "google_health"): decision},
    )
    assert report.totalDays == 1
    assert report.bothSourcesDays == 1
    assert report.eightSleepHrvCount == 1
    assert report.eightSleepHrvMedian == 60.0
    assert report.eightSleepIdentityEligibleDays == 1
    assert report.eightSleepIdentityExcludedDays == 0
    assert report.dailyComparisons[0]["identityBaselineEligible"] is True


def test_run_multisource_audit_missing_identity_projection_fails_closed() -> None:
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}
    mock_repo.get_health_observation_bundles_in_range.return_value = [
        {
            "logicalDate": "2026-08-25",
            "provider": "eight_sleep",
            "transport": "google_health",
            "revision": 1,
            "sourcePayloadHash": "sha256:unverified",
            "observations": [
                {"metric": "hrv_rmssd_ms", "value": 999.0},
                {"metric": "respiration_rate_brpm", "value": 30.0},
            ],
        }
    ]
    mock_repo.get_effective_identity_decision_projections_in_range.return_value = {}

    report = run_multisource_audit(mock_repo, "2026-08-25", "2026-08-25")

    assert report.eightSleepHrvCount == 0
    assert report.eightSleepRespCount == 0
    assert report.eightSleepIdentityEligibleDays == 0
    assert report.eightSleepIdentityExcludedDays == 1
    assert report.dailyComparisons[0]["effectiveIdentityStatus"] == "UNCERTAIN"
    assert report.dailyComparisons[0]["identityBaselineEligible"] is False


def test_run_multisource_audit_loads_persisted_effective_decisions_by_default() -> None:
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}
    mock_repo.get_health_observation_bundles_in_range.return_value = []
    mock_repo.get_effective_identity_decision_projections_in_range.return_value = {}

    run_multisource_audit(mock_repo, "2026-08-25", "2026-08-27")

    mock_repo.get_effective_identity_decision_projections_in_range.assert_called_once_with(
        "2026-08-25", "2026-08-27"
    )
