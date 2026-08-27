from unittest.mock import MagicMock

from garmin_sync.multisource_audit import (
    _calc_correlation,
    _calc_mad,
    _calc_median,
    run_multisource_audit,
)


def test_audit_math_helpers():
    vals = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert _calc_median(vals) == 30.0
    assert _calc_mad(vals, 30.0) is not None

    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert round(_calc_correlation(xs, ys), 2) == 1.0


def test_run_multisource_audit_mocked():
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {
        "2026-08-25": {"date": "2026-08-25", "raw": {"sleepDurationSec": 28800}}
    }
    mock_repo.get_health_observation_bundles_in_range.return_value = [
        {
            "logicalDate": "2026-08-25",
            "provider": "eight_sleep",
            "transport": "google_health",
            "observations": [
                {"metric": "sleep_duration_seconds", "value": 28800},
                {"metric": "hrv_rmssd_ms", "value": 60.0},
                {"metric": "respiration_rate_brpm", "value": 13.0},
            ],
        }
    ]

    report = run_multisource_audit(mock_repo, "2026-08-25", "2026-08-25")
    assert report.totalDays == 1
    assert report.bothSourcesDays == 1
    assert report.eightSleepHrvCount == 1
    assert report.eightSleepHrvMedian == 60.0
