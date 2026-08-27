from unittest.mock import MagicMock

from garmin_sync.google_health_client import GoogleHealthClient
from garmin_sync.health_probe import HealthProvenanceProbe


def test_health_provenance_probe_full_pass():
    mock_client = MagicMock(spec=GoogleHealthClient)

    def mock_list(data_type, **kwargs):
        if data_type == "sleep":
            return [
                {
                    "dataType": "sleep",
                    "dataSource": {
                        "application": {"packageName": "com.garmin.android.apps.connectmobile"}
                    },
                },
                {
                    "dataType": "sleep",
                    "dataSource": {"application": {"packageName": "com.eightsleep.eightsleep"}},
                },
            ]
        elif data_type in (
            "daily-heart-rate-variability",
            "daily-resting-heart-rate",
            "daily-respiratory-rate",
        ):
            return [
                {
                    "dataType": data_type,
                    "dataSource": {"application": {"packageName": "com.eightsleep.eight"}},
                }
            ]
        return []

    mock_client.list_data_points.side_effect = mock_list

    probe = HealthProvenanceProbe(client=mock_client, scopes=["scope.sleep", "scope.metrics"])
    result = probe.run_probe()

    assert result.garminStatus == "PRESENT"
    assert result.eightSleepStatus == "FULL_PASS"
    assert len(result.dataTypesSummary) > 0


def test_health_provenance_probe_eight_sleep_fail():
    mock_client = MagicMock(spec=GoogleHealthClient)

    def mock_list(data_type, **kwargs):
        if data_type == "sleep":
            return [
                {
                    "dataType": "sleep",
                    "dataSource": {
                        "application": {"packageName": "com.garmin.android.apps.connectmobile"}
                    },
                }
            ]
        return []

    mock_client.list_data_points.side_effect = mock_list

    probe = HealthProvenanceProbe(client=mock_client)
    result = probe.run_probe()

    assert result.garminStatus == "PRESENT"
    assert result.eightSleepStatus == "FAIL"
