import sys
from typing import Any, Generator
from unittest.mock import MagicMock, patch

import pytest

from garmin_sync.cli import (
    main,
    run_audit_cmd,
    run_backfill,
    run_daily_sync,
    run_poll_manual_sync_all_cmd,
    run_daily_sync_all,
    run_poll_manual_sync_cmd,
    run_push_pending_workouts_all_cmd,
    run_rebuild_cmd,
)


@pytest.fixture
def mock_settings() -> Generator[Any, None, None]:
    with patch("garmin_sync.cli.load_settings") as mock:
        yield mock


@pytest.fixture
def mock_service() -> Generator[Any, None, None]:
    with patch("garmin_sync.cli.GarminSyncService") as mock:
        yield mock


@pytest.fixture(autouse=True)
def mock_execution_lease() -> Generator[Any, None, None]:
    with patch("garmin_sync.cli.GarminExecutionLease") as mock:
        mock.return_value.acquire.return_value = True
        yield mock


@pytest.fixture
def mock_run_audit() -> Generator[Any, None, None]:
    with patch("garmin_sync.cli.run_audit") as mock:
        yield mock


@pytest.fixture
def mock_format_report() -> Generator[Any, None, None]:
    with patch("garmin_sync.cli.format_report") as mock:
        yield mock


def test_run_daily_sync_success(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.sync_daily.return_value = True

    args = ["--date", "2023-10-27", "--force", "--resync-days", "2"]
    exit_code = run_daily_sync(args)

    assert exit_code == 0
    mock_settings.assert_called_once()
    mock_service.assert_called_once_with(mock_settings.return_value)
    mock_service_instance.sync_daily.assert_called_once_with(
        target_date_str="2023-10-27",
        force=True,
        resync_lookback_days=2,
        auto_backfill_cold_start=True,
    )


def test_run_daily_sync_releases_execution_lease(
    mock_settings: Any,
    mock_service: Any,
    mock_execution_lease: Any,
) -> None:
    mock_service.return_value.sync_daily.return_value = True

    assert run_daily_sync([]) == 0

    mock_execution_lease.return_value.acquire.assert_called_once_with()
    mock_execution_lease.return_value.release.assert_called_once_with()


def test_run_daily_sync_busy_lease_is_safe_noop(
    mock_settings: Any,
    mock_service: Any,
    mock_execution_lease: Any,
) -> None:
    mock_execution_lease.return_value.acquire.return_value = False

    assert run_daily_sync([]) == 0

    mock_service.return_value.sync_daily.assert_not_called()
    mock_execution_lease.return_value.release.assert_not_called()


def test_run_daily_sync_failure(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.sync_daily.return_value = False

    exit_code = run_daily_sync([])

    assert exit_code == 1
    mock_service_instance.sync_daily.assert_called_once_with(
        target_date_str=None,
        force=False,
        resync_lookback_days=None,
        auto_backfill_cold_start=True,
    )


def test_run_daily_sync_exception(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.sync_daily.side_effect = Exception("Test Error")

    exit_code = run_daily_sync([])

    assert exit_code == 1


@patch("garmin_sync.cli._run_for_all_users")
def test_run_daily_sync_all_success(mock_run_for_all_users: Any, mock_service: Any) -> None:
    mock_run_for_all_users.return_value = 0
    mock_service_instance = mock_service.return_value

    args = ["--date", "2023-10-27", "--force", "--resync-days", "2"]
    exit_code = run_daily_sync_all(args)

    assert exit_code == 0
    mock_run_for_all_users.assert_called_once()

    # Check that _run_for_all_users was called with the correct operation name and a lambda
    call_args = mock_run_for_all_users.call_args[0]
    assert call_args[0] == "daily sync"
    operation_lambda = call_args[1]

    # Execute the lambda to verify its behavior
    operation_lambda(mock_service_instance)

    mock_service_instance.sync_daily.assert_called_once_with(
        target_date_str="2023-10-27",
        force=True,
        resync_lookback_days=2,
        auto_backfill_cold_start=True,
    )


def test_run_backfill_success(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.backfill.return_value = True

    args = [
        "--days",
        "30",
        "--start-date",
        "2023-09-01",
        "--end-date",
        "2023-10-01",
        "--force",
        "--include-details",
    ]
    exit_code = run_backfill(args)

    assert exit_code == 0
    mock_settings.assert_called_once()
    mock_service.assert_called_once_with(mock_settings.return_value)
    mock_service_instance.backfill.assert_called_once_with(
        days=30,
        start_date_str="2023-09-01",
        end_date_str="2023-10-01",
        force=True,
        include_details=True,
    )


def test_run_backfill_failure(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.backfill.return_value = False

    exit_code = run_backfill([])

    assert exit_code == 1
    mock_service_instance.backfill.assert_called_once_with(
        days=56,
        start_date_str=None,
        end_date_str=None,
        force=False,
        include_details=False,
    )


def test_run_backfill_exception(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.backfill.side_effect = Exception("Test Error")

    exit_code = run_backfill([])

    assert exit_code == 1


def test_run_audit_cmd_success(
    mock_settings: Any, mock_service: Any, mock_run_audit: Any, mock_format_report: Any
) -> None:
    mock_service_instance = mock_service.return_value
    mock_run_audit.return_value = "report_data"
    mock_format_report.return_value = "Formatted Report"

    args = ["--days", "60", "--end-date", "2023-10-27"]
    exit_code = run_audit_cmd(args)

    assert exit_code == 0
    mock_settings.assert_called_once()
    mock_service.assert_called_once_with(mock_settings.return_value)
    mock_run_audit.assert_called_once_with(
        mock_settings.return_value,
        mock_service_instance.repository,
        mock_service_instance.archive_store,
        days=60,
        end_date_str="2023-10-27",
    )
    mock_format_report.assert_called_once_with("report_data")


def test_run_audit_cmd_exception(
    mock_settings: Any, mock_service: Any, mock_run_audit: Any
) -> None:
    mock_run_audit.side_effect = Exception("Test Error")

    exit_code = run_audit_cmd([])

    assert exit_code == 1


def test_run_rebuild_cmd_success(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.rebuild.return_value = True

    args = ["--start-date", "2023-10-01", "--end-date", "2023-10-31"]
    exit_code = run_rebuild_cmd(args)

    assert exit_code == 0
    mock_settings.assert_called_once()
    mock_service.assert_called_once_with(mock_settings.return_value)
    mock_service_instance.rebuild.assert_called_once_with("2023-10-01", "2023-10-31")


def test_run_rebuild_cmd_missing_args() -> None:
    with pytest.raises(SystemExit):
        run_rebuild_cmd([])


def test_run_rebuild_cmd_failure(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.rebuild.return_value = False

    args = ["--start-date", "2023-10-01", "--end-date", "2023-10-31"]
    exit_code = run_rebuild_cmd(args)

    assert exit_code == 1


def test_run_rebuild_cmd_exception(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.rebuild.side_effect = Exception("Test Error")

    args = ["--start-date", "2023-10-01", "--end-date", "2023-10-31"]
    exit_code = run_rebuild_cmd(args)

    assert exit_code == 1


@patch("garmin_sync.cli._run_for_all_users")
def test_run_push_pending_workouts_all_cmd_success(mock_run_for_all_users: Any) -> None:
    mock_run_for_all_users.return_value = 0

    exit_code = run_push_pending_workouts_all_cmd([])

    assert exit_code == 0
    mock_run_for_all_users.assert_called_once()
    args, kwargs = mock_run_for_all_users.call_args
    assert args[0] == "push pending workouts"

    # Test the lambda passed to _run_for_all_users
    mock_service = MagicMock()
    operation_lambda = args[1]
    operation_lambda(mock_service)
    mock_service.push_pending_workouts.assert_called_once_with(max_age_days=14)


@patch("garmin_sync.cli._run_for_all_users")
def test_run_push_pending_workouts_all_cmd_with_args(mock_run_for_all_users: Any) -> None:
    mock_run_for_all_users.return_value = 0

    exit_code = run_push_pending_workouts_all_cmd(["--max-age-days", "7"])

    assert exit_code == 0
    mock_run_for_all_users.assert_called_once()
    args, kwargs = mock_run_for_all_users.call_args
    assert args[0] == "push pending workouts"

    # Test the lambda passed to _run_for_all_users
    mock_service = MagicMock()
    operation_lambda = args[1]
    operation_lambda(mock_service)
    mock_service.push_pending_workouts.assert_called_once_with(max_age_days=7)


def test_run_poll_manual_sync_cmd_success(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.poll_manual_sync_requests.return_value = True

    exit_code = run_poll_manual_sync_cmd([])

    assert exit_code == 0
    mock_service_instance.poll_manual_sync_requests.assert_called_once_with()


def test_run_poll_manual_sync_cmd_failure(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.poll_manual_sync_requests.return_value = False

    exit_code = run_poll_manual_sync_cmd([])

    assert exit_code == 1


def test_run_poll_manual_sync_cmd_exception(mock_settings: Any, mock_service: Any) -> None:
    mock_service_instance = mock_service.return_value
    mock_service_instance.poll_manual_sync_requests.side_effect = Exception("Test Error")

    exit_code = run_poll_manual_sync_cmd([])

    assert exit_code == 1


@patch("garmin_sync.cli._run_for_all_users")
def test_run_poll_manual_sync_all_cmd(mock_run_for_all_users: Any) -> None:
    mock_run_for_all_users.return_value = 0

    exit_code = run_poll_manual_sync_all_cmd([])

    assert exit_code == 0
    mock_run_for_all_users.assert_called_once()


@patch("garmin_sync.cli.run_daily_sync")
def test_main_sync(mock_run_daily_sync: Any) -> None:
    mock_run_daily_sync.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "sync", "--date", "2023-10-27"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_daily_sync.assert_called_once_with(["--date", "2023-10-27"])


@patch("garmin_sync.cli.run_daily_sync_all")
def test_main_sync_all(mock_run_daily_sync_all: Any) -> None:
    mock_run_daily_sync_all.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "sync-all", "--date", "2023-10-27"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_daily_sync_all.assert_called_once_with(["--date", "2023-10-27"])


@patch("garmin_sync.cli.run_backfill")
def test_main_backfill(mock_run_backfill: Any) -> None:
    mock_run_backfill.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "backfill", "--days", "10"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_backfill.assert_called_once_with(["--days", "10"])


@patch("garmin_sync.cli.run_audit_cmd")
def test_main_audit(mock_run_audit_cmd: Any) -> None:
    mock_run_audit_cmd.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "audit"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_audit_cmd.assert_called_once_with([])


@patch("garmin_sync.cli.run_rebuild_cmd")
def test_main_rebuild(mock_run_rebuild_cmd: Any) -> None:
    mock_run_rebuild_cmd.return_value = 0

    with patch.object(
        sys,
        "argv",
        ["garmin_sync", "rebuild", "--start-date", "2023-10-01", "--end-date", "2023-10-31"],
    ):
        exit_code = main()

    assert exit_code == 0
    mock_run_rebuild_cmd.assert_called_once_with(
        ["--start-date", "2023-10-01", "--end-date", "2023-10-31"]
    )


@patch("garmin_sync.cli.run_poll_manual_sync_cmd")
def test_main_poll_manual_sync(mock_run_poll_manual_sync_cmd: Any) -> None:
    mock_run_poll_manual_sync_cmd.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "poll-manual-sync"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_poll_manual_sync_cmd.assert_called_once_with([])


@patch("garmin_sync.cli.run_poll_manual_sync_all_cmd")
def test_main_poll_manual_sync_all(mock_run_poll_manual_sync_all_cmd: Any) -> None:
    mock_run_poll_manual_sync_all_cmd.return_value = 0

    with patch.object(sys, "argv", ["garmin_sync", "poll-manual-sync-all"]):
        exit_code = main()

    assert exit_code == 0
    mock_run_poll_manual_sync_all_cmd.assert_called_once_with([])


@patch("garmin_sync.cli.run_push_pending_workouts_all_cmd")
def test_main_push_pending_workouts_all(mock_run_push_pending_workouts_all_cmd: Any) -> None:
    mock_run_push_pending_workouts_all_cmd.return_value = 0

    with patch.object(
        sys, "argv", ["garmin_sync", "push-pending-workouts-all", "--max-age-days", "7"]
    ):
        exit_code = main()

    assert exit_code == 0
    mock_run_push_pending_workouts_all_cmd.assert_called_once_with(["--max-age-days", "7"])


def test_main_missing_command() -> None:
    with patch.object(sys, "argv", ["garmin_sync"]):
        with pytest.raises(SystemExit):
            main()
