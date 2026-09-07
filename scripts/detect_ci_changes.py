#!/usr/bin/env python3
"""Classify changed files for CI job selection.

Determines whether a pull request touches code, configuration, or baselines
that require the full CI suite, or is strictly documentation-only.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import PurePosixPath

CODE_PATTERNS = [
    "src/**",
    "app/**",
    "scripts/**",
    "tests/**",
    ".github/**",
    "Dockerfile",
    "docker-compose.yml",
    "Makefile",
    "pyproject.toml",
    "uv.lock",
    ".pre-commit-config.yaml",
    ".env.example",
    ".dockerignore",
    ".gitignore",
    ".python-version",
    "docs/analysis/simulation-baseline.json",
]

DOC_PATTERNS = [
    "*.md",
    "**/*.md",
    "docs/**",
    "LICENSE",
    "SECURITY.md",
]


def is_code_file(path_str: str) -> bool:
    """Return True if path_str represents code, infrastructure, or a test baseline."""
    posix_path = PurePosixPath(path_str.replace("\\", "/"))

    # Explicit exception: simulation-baseline.json is inside docs/ but is an engine test baseline
    if posix_path == PurePosixPath("docs/analysis/simulation-baseline.json"):
        return True

    for pattern in CODE_PATTERNS:
        if pattern == "docs/analysis/simulation-baseline.json":
            continue
        if posix_path.match(pattern):
            return True

    # Check if it matches documentation patterns
    for pattern in DOC_PATTERNS:
        if posix_path.match(pattern):
            return False

    # Any unknown or root file fails safe to True (treated as code)
    return True


def get_changed_files(base_ref: str | None = None) -> list[str]:
    """Retrieve list of changed files relative to base_ref or PR merge parents."""
    # In GitHub Actions pull_request, HEAD is a merge commit with 2 parents:
    # parent 1 is base branch, parent 2 is PR head.
    try:
        parents = (
            subprocess.check_output(
                ["git", "rev-list", "--parents", "-n", "1", "HEAD"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            .strip()
            .split()
        )
        if len(parents) == 3:
            base_parent = parents[1]
            diff_output = subprocess.check_output(
                ["git", "diff", "--name-only", base_parent, "HEAD"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            return [line.strip() for line in diff_output.splitlines() if line.strip()]
    except Exception:
        pass

    # Fallback to explicit base_ref
    target_base = base_ref or "origin/main"
    try:
        diff_output = subprocess.check_output(
            ["git", "diff", "--name-only", f"{target_base}...HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return [line.strip() for line in diff_output.splitlines() if line.strip()]
    except Exception:
        # If diff fails, return empty to trigger fail-safe code_changed=True
        return []


def write_github_output(code_changed: bool, docs_only: bool) -> None:
    """Write outputs to GITHUB_OUTPUT file for GitHub Actions."""
    github_output = os.getenv("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"code_changed={'true' if code_changed else 'false'}\n")
            f.write(f"docs_only={'true' if docs_only else 'false'}\n")


def main() -> int:
    event_name = os.getenv("GITHUB_EVENT_NAME", "")
    base_ref = sys.argv[1] if len(sys.argv) > 1 else None

    # On main push, workflow_call (release), or manual dispatch, run everything
    if event_name and event_name != "pull_request":
        print(f"Event '{event_name}' is not pull_request; running all CI jobs.")
        write_github_output(code_changed=True, docs_only=False)
        return 0

    changed_files = get_changed_files(base_ref)
    if not changed_files:
        # Fail safe: if no changed files detected or error, run all checks
        print("No changed files detected or git diff unavailable; running all CI jobs (fail-safe).")
        write_github_output(code_changed=True, docs_only=False)
        return 0

    code_files = [f for f in changed_files if is_code_file(f)]
    doc_files = [f for f in changed_files if not is_code_file(f)]

    code_changed = len(code_files) > 0
    docs_only = not code_changed and len(doc_files) > 0

    print(f"Changed files total: {len(changed_files)}")
    print(f"  Code/Infra files: {len(code_files)}")
    print(f"  Doc-only files:   {len(doc_files)}")
    if code_files:
        print("Sample code files:")
        for cf in code_files[:5]:
            print(f"  - {cf}")

    write_github_output(code_changed=code_changed, docs_only=docs_only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
