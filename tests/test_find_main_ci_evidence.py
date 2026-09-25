"""Unit tests for find_main_ci_evidence script."""

from __future__ import annotations

import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import find_main_ci_evidence
import pytest
from find_main_ci_evidence import (
    classify,
    main,
    parse_runs,
    runs_endpoint,
    wait_for_evidence,
    write_outputs,
)

SHA = "a" * 40
NOW = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
DAY = timedelta(hours=24)


def _run(**overrides: Any) -> dict[str, Any]:
    run: dict[str, Any] = {
        "head_sha": SHA,
        "event": "push",
        "head_branch": "main",
        "path": ".github/workflows/ci.yml",
        "status": "completed",
        "conclusion": "success",
        "run_started_at": "2026-09-25T10:00:00Z",
        "html_url": "https://example.test/run/1",
    }
    return {**run, **overrides}


def _classify(runs: list[dict[str, Any]]) -> tuple[str, Any]:
    return classify(runs, SHA, now=NOW, max_age=DAY)


def test_fresh_successful_push_run_validates() -> None:
    evidence, run = _classify([_run()])
    assert evidence == "validated"
    assert run is not None


@pytest.mark.parametrize(
    "overrides",
    [
        {"head_sha": "b" * 40},
        {"event": "pull_request"},
        {"event": "workflow_dispatch"},
        {"head_branch": "feature"},
        {"path": ".github/workflows/deploy-production.yml"},
        {"conclusion": "failure"},
        {"conclusion": "cancelled"},
        # Older than the freshness bound: time-dependent gates (audits, base image) have aged.
        {"run_started_at": "2026-09-24T11:59:59Z"},
        {"run_started_at": None, "created_at": None},
        {"run_started_at": "not-a-timestamp"},
    ],
)
def test_non_matching_unsuccessful_or_stale_runs_are_missing(overrides: dict[str, Any]) -> None:
    assert _classify([_run(**overrides)]) == ("missing", None)


def test_run_exactly_at_the_age_bound_is_still_fresh() -> None:
    evidence, _ = _classify([_run(run_started_at="2026-09-24T12:00:00Z")])
    assert evidence == "validated"


def test_created_at_is_used_when_run_started_at_is_absent() -> None:
    evidence, _ = _classify([_run(run_started_at=None, created_at="2026-09-25T11:00:00Z")])
    assert evidence == "validated"


def test_no_runs_is_missing() -> None:
    assert _classify([]) == ("missing", None)


def test_success_wins_over_a_failed_attempt() -> None:
    evidence, _ = _classify([_run(conclusion="failure"), _run()])
    assert evidence == "validated"


def test_in_progress_run_is_pending() -> None:
    evidence, _ = _classify([_run(status="in_progress", conclusion=None)])
    assert evidence == "pending"


def test_in_progress_run_is_pending_even_after_a_failed_one() -> None:
    evidence, _ = _classify(
        [_run(conclusion="failure"), _run(status="in_progress", conclusion=None)]
    )
    assert evidence == "pending"


def test_runs_endpoint_filters_to_main_push_runs_of_ci_for_the_sha() -> None:
    assert runs_endpoint("owner/repo", SHA) == (
        f"repos/owner/repo/actions/workflows/ci.yml/runs"
        f"?head_sha={SHA}&event=push&branch=main&per_page=20"
    )


def test_parse_runs_keeps_only_run_objects() -> None:
    assert parse_runs('{"workflow_runs": [{"id": 1}, "junk"]}') == [{"id": 1}]


@pytest.mark.parametrize("payload", ["[]", '{"message": "Not Found"}', '{"workflow_runs": {}}'])
def test_parse_runs_rejects_unexpected_shapes(payload: str) -> None:
    with pytest.raises(ValueError):
        parse_runs(payload)


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _wait(fetch: Any, clock: _FakeClock, wait_seconds: float) -> tuple[str, Any]:
    return wait_for_evidence(
        fetch,
        SHA,
        wait_seconds=wait_seconds,
        poll_seconds=30,
        max_age=DAY,
        sleep=clock.sleep,
        clock=clock,
        utcnow=lambda: NOW,
    )


def test_waits_for_pending_run_to_succeed() -> None:
    responses = [
        [_run(status="queued", conclusion=None)],
        [_run(status="in_progress", conclusion=None)],
        [_run()],
    ]
    clock = _FakeClock()
    evidence, _ = _wait(lambda: responses.pop(0), clock, wait_seconds=300)
    assert evidence == "validated"
    assert clock.now == 60


def test_pending_past_deadline_falls_back_to_missing() -> None:
    clock = _FakeClock()
    evidence, _ = _wait(
        lambda: [_run(status="in_progress", conclusion=None)], clock, wait_seconds=90
    )
    assert evidence == "missing"
    assert clock.now <= 90


@pytest.mark.parametrize(
    "error",
    [
        subprocess.CalledProcessError(1, ["gh", "api"]),
        subprocess.TimeoutExpired(["gh", "api"], 60),
        ValueError("response has no workflow_runs list"),
        AttributeError("unexpected"),
    ],
)
def test_any_lookup_error_falls_back_to_missing(error: Exception) -> None:
    def failing_fetch() -> list[dict[str, Any]]:
        raise error

    assert _wait(failing_fetch, _FakeClock(), wait_seconds=60) == ("missing", None)


def test_write_outputs_records_reused_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output, summary = tmp_path / "output", tmp_path / "summary"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    write_outputs("validated", _run())
    assert output.read_text(encoding="utf-8") == "validated=true\n"
    assert "https://example.test/run/1" in summary.read_text(encoding="utf-8")


def test_main_reuses_a_fresh_successful_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "output"
    fresh = _run(run_started_at=datetime.now(UTC).isoformat())
    monkeypatch.setattr(find_main_ci_evidence, "fetch_runs", lambda _repo, _sha: [fresh])
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.setenv("GITHUB_SHA", SHA)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    assert main(["--wait-seconds", "0"]) == 0
    assert output.read_text(encoding="utf-8") == "validated=true\n"


def test_main_without_environment_outputs_not_validated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "output"
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    monkeypatch.delenv("GITHUB_SHA", raising=False)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    assert main([]) == 0
    assert output.read_text(encoding="utf-8") == "validated=false\n"
