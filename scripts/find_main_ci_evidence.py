#!/usr/bin/env python3
"""Decide whether a production release can reuse main's post-merge CI run for its SHA.

Every push to ``main`` already runs the full CI Pipeline (``ci.yml``; a non-pull_request event
runs every job). ``deploy-production.yml`` releases exactly one ``main`` SHA, so re-running the
same suite on the same tree can only surface flaky tests, not new defects. This script looks for
a successful ``push`` run of ``ci.yml`` on ``main`` for the release SHA:

* ``validated`` -- such a run succeeded; the release reuses it.
* ``pending``   -- a matching run is still queued/in progress; poll until it settles.
* ``missing``   -- no matching run, or every matching run failed; the release falls back to
  calling ``ci.yml`` itself, so it is never weaker than always re-running CI.

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
from typing import Any, Literal

CI_WORKFLOW_PATH = ".github/workflows/ci.yml"
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


def classify(runs: Iterable[Run], sha: str) -> tuple[Evidence, Run | None]:
    """Classify the CI evidence for ``sha`` and return the run that decided it, if any."""
    candidates = matching_runs(runs, sha)
    for run in candidates:
        if run.get("status") == "completed" and run.get("conclusion") == "success":
            return "validated", run
    for run in candidates:
        if run.get("status") != "completed":
            return "pending", run
    return "missing", None


def fetch_runs(repository: str, sha: str) -> list[Run]:
    """List ci.yml push runs on main for ``sha`` through the GitHub CLI."""
    endpoint = (
        f"repos/{repository}/actions/workflows/ci.yml/runs"
        f"?head_sha={sha}&event=push&branch=main&per_page=20"
    )
    output = subprocess.check_output(["gh", "api", endpoint], text=True)
    runs = json.loads(output).get("workflow_runs", [])
    return list(runs) if isinstance(runs, list) else []


def wait_for_evidence(
    fetch: Callable[[], list[Run]],
    sha: str,
    *,
    wait_seconds: float,
    poll_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[Evidence, Run | None]:
    """Poll while a matching run is pending, up to ``wait_seconds``; errors count as missing."""
    deadline = clock() + wait_seconds
    while True:
        try:
            evidence, run = classify(fetch(), sha)
        except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as error:
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
    )
    print(f"CI evidence for {sha}: {evidence}")
    write_outputs(evidence, run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
