import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from garmin_sync.cli import main, run_export_activities_cmd
from garmin_sync.service import GarminSyncService


@pytest.fixture
def sample_activity_records() -> list[dict[str, Any]]:
    return [
        {
            "activityId": "1002",
            "date": "2026-08-26",
            "type": "strength_training",
            "durationMin": 45,
            "intensityTag": "moderate",
            "exerciseSets": [
                {
                    "setOrder": 0,
                    "setType": "active",
                    "repetitionCount": 8,
                    "weightKg": 70.0,
                    "exerciseName": "bench_press",
                }
            ],
        },
        {
            "activityId": "1001",
            "date": "2026-08-25",
            "type": "cycling",
            "durationMin": 60,
            "intensityTag": "hard",
            "normalizedPower": 240.0,
            "powerInZones": [{"zoneNumber": 2, "secondsInZone": 1800}],
        },
    ]


def test_service_export_activities_json(sample_activity_records: list[dict[str, Any]]) -> None:
    mock_settings = MagicMock()
    mock_settings.app_user_id = "test-user-123"
    mock_repo = MagicMock()
    mock_repo.get_activities_in_range.return_value = sample_activity_records

    with patch.object(GarminSyncService, "__init__", lambda self, settings: None):
        service = GarminSyncService(mock_settings)
        service.settings = mock_settings
        service.repository = mock_repo

        bundle = service.export_activities_json("2026-08-20", "2026-08-27")

        assert bundle["schemaVersion"] == "recent_activities_bundle_v1"
        assert bundle["metadata"]["userId"] == "test-user-123"
        assert bundle["metadata"]["totalActivities"] == 2
        assert bundle["metadata"]["dateRange"] == {
            "startDateInclusive": "2026-08-20",
            "throughDateInclusive": "2026-08-27",
        }
        # Check chronological sorting
        assert bundle["activities"][0]["activityId"] == "1001"
        assert bundle["activities"][1]["activityId"] == "1002"
        mock_repo.get_activities_in_range.assert_called_once_with("2026-08-20", "2026-08-27")


def test_cli_export_activities_stdout(
    sample_activity_records: list[dict[str, Any]], capsys: pytest.CaptureFixture[str]
) -> None:
    mock_settings = MagicMock()
    mock_settings.app_user_id = "test-user-123"

    with (
        patch("garmin_sync.cli.load_settings", return_value=mock_settings),
        patch("garmin_sync.cli.GarminSyncService") as mock_service_cls,
    ):
        mock_service = mock_service_cls.return_value
        mock_service.export_activities_json.return_value = {
            "schemaVersion": "recent_activities_bundle_v1",
            "metadata": {"totalActivities": 2, "userId": "test-user-123"},
            "activities": sample_activity_records,
        }

        exit_code = run_export_activities_cmd(
            ["--start-date", "2026-08-20", "--end-date", "2026-08-27"]
        )

        assert exit_code == 0
        captured = capsys.readouterr()
        parsed = json.loads(captured.out)
        assert parsed["schemaVersion"] == "recent_activities_bundle_v1"
        assert parsed["metadata"]["totalActivities"] == 2
        mock_service.export_activities_json.assert_called_once_with("2026-08-20", "2026-08-27")


def test_cli_export_activities_to_file(
    tmp_path: Any, sample_activity_records: list[dict[str, Any]]
) -> None:
    output_file = tmp_path / "exported_activities.json"
    mock_settings = MagicMock()
    mock_settings.app_user_id = "test-user-123"

    with (
        patch("garmin_sync.cli.load_settings", return_value=mock_settings),
        patch("garmin_sync.cli.GarminSyncService") as mock_service_cls,
    ):
        mock_service = mock_service_cls.return_value
        mock_service.export_activities_json.return_value = {
            "schemaVersion": "recent_activities_bundle_v1",
            "metadata": {"totalActivities": 2, "userId": "test-user-123"},
            "activities": sample_activity_records,
        }

        exit_code = run_export_activities_cmd(
            [
                "--start-date",
                "2026-08-20",
                "--end-date",
                "2026-08-27",
                "--output",
                str(output_file),
            ]
        )

        assert exit_code == 0
        assert output_file.exists()
        content = json.loads(output_file.read_text(encoding="utf-8"))
        assert content["schemaVersion"] == "recent_activities_bundle_v1"
        assert content["metadata"]["totalActivities"] == 2


def test_cli_main_export_activities_routing() -> None:
    with patch("garmin_sync.cli.run_export_activities_cmd", return_value=0) as mock_cmd:
        with patch("sys.argv", ["cli.py", "export-activities", "--days", "7"]):
            exit_code = main()
            assert exit_code == 0
            mock_cmd.assert_called_once_with(["--days", "7"])
