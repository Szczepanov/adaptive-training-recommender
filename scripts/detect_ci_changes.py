#!/usr/bin/env python3
"""Classify changed files for CI job selection.

Determines whether a pull request touches code, configuration, or baselines
that require the full CI suite, or is strictly documentation-only, and whether
it can affect the engine simulations (ADR-0052 D-CI, see ``engine_impact``).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import PurePosixPath

from engine_impact import EngineImpact, assess

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
    """Retrieve list of changed files relative to base_ref or PR merge parents.

    Uses the same (base, head) pair as the engine-impact check (:func:`resolve_diff_refs`),
    so both classifications always describe one diff.
    """
    refs = resolve_diff_refs(base_ref)
    if refs is None:
        # Return empty to trigger fail-safe code_changed=True
        return []
    try:
        diff_output = subprocess.check_output(
            ["git", "diff", "--name-only", *refs],
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return []
    return [line.strip() for line in diff_output.splitlines() if line.strip()]


def get_worktree_changed_files(
    base_sha: str, cwd: str | os.PathLike[str] | None = None
) -> list[str]:
    """List paths that differ between ``base_sha`` and the local working tree.

    Unlike :func:`get_changed_files`, this is for local runs: it includes
    committed, staged, unstaged and untracked (non-ignored) changes, and never
    applies the CI-only "HEAD is a PR merge commit" shortcut. Renames are
    reported as both the old and the new path. Raises ``RuntimeError`` when git
    cannot produce the diff, so callers can fail safe instead of seeing "no
    changes".
    """
    commands = (
        ["git", "diff", "--name-only", "--no-renames", base_sha],
        ["git", "ls-files", "--others", "--exclude-standard"],
    )
    paths: set[str] = set()
    for command in commands:
        completed = subprocess.run(command, cwd=cwd, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            detail = completed.stderr.strip() or "unknown error"
            raise RuntimeError(f"{' '.join(command)} failed: {detail}")
        paths.update(
            line.strip().replace("\\", "/")
            for line in completed.stdout.splitlines()
            if line.strip()
        )
    return sorted(paths)


def resolve_diff_refs(base_ref: str | None = None) -> tuple[str, str] | None:
    """Return the (base, head) commits this run classifies, or None if unresolvable.

    In GitHub Actions pull_request, HEAD is a merge commit whose first parent is the base
    branch, so the base is that parent. Otherwise it is the merge base with ``base_ref``
    (default ``origin/main``), which is what ``git diff base_ref...HEAD`` compares.
    """
    try:
        parents = subprocess.check_output(
            ["git", "rev-list", "--parents", "-n", "1", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).split()
        if len(parents) == 3:
            return parents[1], "HEAD"
        merge_base = subprocess.check_output(
            ["git", "merge-base", base_ref or "origin/main", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return (merge_base, "HEAD") if merge_base else None


def assess_engine_impact(base_ref: str | None = None) -> EngineImpact:
    """Classify the PR's engine impact, failing safe when the base cannot be resolved."""
    refs = resolve_diff_refs(base_ref)
    if refs is None:
        return EngineImpact(True, ("uncertain: cannot resolve the diff base",))
    return assess(*refs)


def write_github_output(code_changed: bool, docs_only: bool, engine_affected: bool) -> None:
    """Write outputs to GITHUB_OUTPUT file for GitHub Actions."""
    github_output = os.getenv("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"code_changed={'true' if code_changed else 'false'}\n")
            f.write(f"docs_only={'true' if docs_only else 'false'}\n")
            f.write(f"engine_affected={'true' if engine_affected else 'false'}\n")


def main() -> int:
    event_name = os.getenv("GITHUB_EVENT_NAME", "")
    base_ref = sys.argv[1] if len(sys.argv) > 1 else None

    # On main push, workflow_call (release), or manual dispatch, run everything
    if event_name and event_name != "pull_request":
        print(f"Event '{event_name}' is not pull_request; running all CI jobs.")
        write_github_output(code_changed=True, docs_only=False, engine_affected=True)
        return 0

    changed_files = get_changed_files(base_ref)
    if not changed_files:
        # Fail safe: if no changed files detected or error, run all checks
        print("No changed files detected or git diff unavailable; running all CI jobs (fail-safe).")
        write_github_output(code_changed=True, docs_only=False, engine_affected=True)
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

    impact = assess_engine_impact(base_ref)
    print(f"Engine-affecting (simulations run): {'yes' if impact.affected else 'no'}")
    for reason in impact.reasons[:10]:
        print(f"  - {reason}")

    write_github_output(
        code_changed=code_changed, docs_only=docs_only, engine_affected=impact.affected
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
