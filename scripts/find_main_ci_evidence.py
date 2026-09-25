#!/usr/bin/env python3
"""Decide whether a production release can reuse main's post-merge CI run for its SHA.

Every push to ``main`` already runs the full CI Pipeline (``ci.yml``; a non-pull_request event
runs every job). ``deploy-production.yml`` releases exactly one ``main`` SHA, so re-running the
same suite on the same tree mostly re-rolls flaky tests. It is not fully redundant, though:
``npm audit`` and ``pip-audit`` query live advisory databases and the Docker smoke test builds on
a floating base image, so their verdict ages. Evidence is therefore reused only while it is
fresh (``--max-age-hours``, measured from the run's start). This script looks for a successful,
fresh ``push`` run of ``ci.yml`` on ``main`` for the release SHA:

* ``validated`` -- such a run succeeded recently enough; the release reuses it.
* ``pending``   -- a matching run is still queued/in progress; poll until it settles.
* ``missing``   -- no matching run, every matching run failed, or the success is too old; the
  release falls back to calling ``ci.yml`` itself.

Any API error also falls back to ``missing``. The script never fails the job: the caller's
fallback CI run is the safety net.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

CI_WORKFLOW_PATH = ".github/workflows/ci.yml"
GH_API_TIMEOUT_SECONDS = 60
Evidence = Literal["validated", "pending", "missing"]
Run = Mapping[str, Any]


def matching_runs(runs: Iterable[Run], sha: str) -> list[Run]:
    """Keep only main-branch push runs of ci.yml for exactly this SHA."""
    return [
        run
        for run in runs
        if run.get("head_sha") == sha
        and run.get("event") == "push"
        and run.get("head_branch") == "main"
        and run.get("path") == CI_WORKFLOW_PATH
    ]


def run_started_at(run: Run) -> datetime | None:
    """Parse the run's start time; a missing or unparseable timestamp counts as unknown."""
    raw = run.get("run_started_at") or run.get("created_at")
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_fresh(run: Run, now: datetime, max_age: timedelta) -> bool:
    """True when the run started within ``max_age`` of ``now``."""
    started = run_started_at(run)
    return started is not None and now - started <= max_age


def classify(
    runs: Iterable[Run], sha: str, *, now: datetime, max_age: timedelta
) -> tuple[Evidence, Run | None]:
    """Classify the CI evidence for ``sha`` and return the run that decided it, if any."""
    candidates = matching_runs(runs, sha)
    for run in candidates:
        if (
            run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and is_fresh(run, now, max_age)
        ):
            return "validated", run
    for run in candidates:
        if run.get("status") != "completed":
            return "pending", run
    return "missing", None


def runs_endpoint(repository: str, sha: str) -> str:
    """The REST endpoint listing ci.yml push runs on main for ``sha``."""
    return (
        f"repos/{repository}/actions/workflows/ci.yml/runs"
        f"?head_sha={sha}&event=push&branch=main&per_page=20"
    )


def parse_runs(payload: str) -> list[Run]:
    """Extract ``workflow_runs`` from an API response; any unexpected shape raises ValueError."""
    document = json.loads(payload)
    runs = document.get("workflow_runs") if isinstance(document, dict) else None
    if not isinstance(runs, list):
        raise ValueError("response has no workflow_runs list")
    return [run for run in runs if isinstance(run, dict)]


def fetch_runs(repository: str, sha: str) -> list[Run]:
    """List ci.yml push runs on main for ``sha`` through the GitHub CLI."""
    output = subprocess.check_output(
        ["gh", "api", runs_endpoint(repository, sha)],
        text=True,
        timeout=GH_API_TIMEOUT_SECONDS,
    )
    return parse_runs(output)


def wait_for_evidence(
    fetch: Callable[[], list[Run]],
    sha: str,
    *,
    wait_seconds: float,
    poll_seconds: float,
    max_age: timedelta,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    utcnow: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> tuple[Evidence, Run | None]:
    """Poll while a matching run is pending, up to ``wait_seconds``; errors count as missing."""
    deadline = clock() + wait_seconds
    while True:
        try:
            evidence, run = classify(fetch(), sha, now=utcnow(), max_age=max_age)
        except Exception as error:  # any lookup failure must fall back to a fresh CI run
            print(f"::warning::Could not read CI runs for {sha}: {error}", file=sys.stderr)
            return "missing", None
        if evidence != "pending":
            return evidence, run
        if clock() + poll_seconds > deadline:
            print(f"Post-merge CI for {sha} is still running after {wait_seconds:.0f}s.")
            return "missing", None
        print(f"Post-merge CI run {run and run.get('html_url')} is in progress; waiting.")
        sleep(poll_seconds)


def write_outputs(evidence: Evidence, run: Run | None) -> None:
    """Expose ``validated`` to the workflow and record the decision in the step summary."""
    validated = evidence == "validated"
    if output_path := os.getenv("GITHUB_OUTPUT"):
        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(f"validated={'true' if validated else 'false'}\n")
    if summary_path := os.getenv("GITHUB_STEP_SUMMARY"):
        with open(summary_path, "a", encoding="utf-8") as handle:
            if validated and run is not None:
                handle.write(f"Reusing successful post-merge CI run: {run.get('html_url')}\n")
            else:
                handle.write("No successful post-merge CI run found; running full CI.\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait-seconds", type=float, default=1200)
    parser.add_argument("--poll-seconds", type=float, default=30)
    parser.add_argument("--max-age-hours", type=float, default=24)
    args = parser.parse_args(argv)

    repository = os.environ.get("GITHUB_REPOSITORY", "")
    sha = os.environ.get("GITHUB_SHA", "")
    if not repository or not sha:
        print("GITHUB_REPOSITORY and GITHUB_SHA are required.", file=sys.stderr)
        write_outputs("missing", None)
        return 0

    evidence, run = wait_for_evidence(
        lambda: fetch_runs(repository, sha),
        sha,
        wait_seconds=args.wait_seconds,
        poll_seconds=args.poll_seconds,
        max_age=timedelta(hours=args.max_age_hours),
    )
    print(f"CI evidence for {sha}: {evidence}")
    write_outputs(evidence, run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
