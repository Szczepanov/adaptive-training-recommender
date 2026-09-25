"""Unit tests for find_main_ci_evidence script."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest
from find_main_ci_evidence import classify, main, wait_for_evidence

SHA = "a" * 40


def _run(**overrides: Any) -> dict[str, Any]:
    run: dict[str, Any] = {
        "head_sha": SHA,
        "event": "push",
        "head_branch": "main",
        "path": ".github/workflows/ci.yml",
        "status": "completed",
        "conclusion": "success",
        "html_url": "https://example.test/run/1",
    }
    return {**run, **overrides}


def test_successful_push_run_validates() -> None:
    evidence, run = classify([_run()], SHA)
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
    ],
)
def test_non_matching_or_unsuccessful_runs_are_missing(overrides: dict[str, Any]) -> None:
    assert classify([_run(**overrides)], SHA) == ("missing", None)


def test_no_runs_is_missing() -> None:
    assert classify([], SHA) == ("missing", None)


def test_success_wins_over_a_failed_attempt() -> None:
    evidence, _ = classify([_run(conclusion="failure"), _run()], SHA)
    assert evidence == "validated"


def test_in_progress_run_is_pending() -> None:
    evidence, _ = classify([_run(status="in_progress", conclusion=None)], SHA)
    assert evidence == "pending"


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def test_waits_for_pending_run_to_succeed() -> None:
    responses = [
        [_run(status="queued", conclusion=None)],
        [_run(status="in_progress", conclusion=None)],
        [_run()],
    ]
    clock = _FakeClock()
    evidence, _ = wait_for_evidence(
        lambda: responses.pop(0),
        SHA,
        wait_seconds=300,
        poll_seconds=30,
        sleep=clock.sleep,
        clock=clock,
    )
    assert evidence == "validated"
    assert clock.now == 60


def test_pending_past_deadline_falls_back_to_missing() -> None:
    clock = _FakeClock()
    evidence, _ = wait_for_evidence(
        lambda: [_run(status="in_progress", conclusion=None)],
        SHA,
        wait_seconds=90,
        poll_seconds=30,
        sleep=clock.sleep,
        clock=clock,
    )
    assert evidence == "missing"
    assert clock.now <= 90


def test_api_error_falls_back_to_missing() -> None:
    def failing_fetch() -> list[dict[str, Any]]:
        raise subprocess.CalledProcessError(1, ["gh", "api"])

    evidence, _ = wait_for_evidence(failing_fetch, SHA, wait_seconds=60, poll_seconds=30)
    assert evidence == "missing"


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
