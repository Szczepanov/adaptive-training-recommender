#!/usr/bin/env python3
"""Run the repository-owned verification contract for coding agents."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from detect_ci_changes import get_worktree_changed_files, is_code_file

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
VerificationMode = Literal["docs", "code"]


@dataclass(frozen=True)
class VerificationStep:
    """One deterministic local verification step."""

    name: str
    argv: tuple[str, ...]
    cwd: Path = ROOT
    required: bool = True


def classify_paths(paths: list[str]) -> VerificationMode:
    """Classify a diff using the same code-vs-doc rules as CI."""
    if not paths:
        return "code"
    return "code" if any(is_code_file(path) for path in paths) else "docs"


def _git_output(*args: str) -> str | None:
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    return value or None


def resolve_base_sha(explicit_base: str | None = None) -> str:
    """Resolve the immutable base SHA used by diff-sensitive verification."""
    requested = explicit_base or os.getenv("VERIFY_BASE")
    if requested:
        resolved = _git_output("rev-parse", requested)
        if resolved:
            return resolved
        raise RuntimeError(f"Cannot resolve verification base: {requested}")

    merge_base = _git_output("merge-base", "HEAD", "origin/main")
    if merge_base:
        return merge_base

    parent = _git_output("rev-parse", "HEAD^")
    if parent:
        return parent

    raise RuntimeError(
        "Cannot resolve verification base. Fetch origin/main or set VERIFY_BASE=<commit/ref>."
    )


def build_plan(mode: VerificationMode, base_sha: str) -> list[VerificationStep]:
    """Build the stable local verification plan for a docs or code diff."""
    common = [
        VerificationStep(
            "repository hygiene",
            (
                "uv",
                "run",
                "pre-commit",
                "run",
                "--all-files",
                "--show-diff-on-failure",
            ),
        ),
        VerificationStep(
            "coding-agent eval corpus",
            ("uv", "run", "python", "scripts/agent_eval.py", "validate"),
        ),
    ]
    if mode == "docs":
        return common

    return [
        *common,
        VerificationStep("static checks and unit tests", ("make", "check")),
        VerificationStep("Firestore security rules", ("make", "test-rules")),
        VerificationStep(
            "browser E2E",
            ("npm", "--prefix", "app", "run", "test:e2e"),
        ),
        VerificationStep(
            "engine simulations",
            ("npm", "--prefix", "app", "run", "simulate:scenarios"),
        ),
        VerificationStep(
            "simulation baseline cleanliness",
            ("git", "diff", "--exit-code", "--", "docs/analysis/simulation-baseline.json"),
        ),
        VerificationStep(
            "simulation semantic diff (advisory)",
            ("npm", "--prefix", "app", "run", "simulate:diff"),
            required=False,
        ),
        VerificationStep(
            "deterministic plan-judge corpus",
            ("npm", "--prefix", "app", "run", "simulate:plan-judge"),
        ),
        VerificationStep(
            "deterministic persona corpus",
            ("npm", "--prefix", "app", "run", "persona:build"),
        ),
        VerificationStep(
            "policy-version drift",
            ("node", "scripts/check-policy-drift.mjs", base_sha),
            cwd=APP,
        ),
        VerificationStep("production build", ("make", "build")),
    ]


def run_plan(steps: list[VerificationStep]) -> int:
    """Run each step in order and stop on the first failure."""
    for index, step in enumerate(steps, start=1):
        command = " ".join(step.argv)
        relative_cwd = step.cwd.relative_to(ROOT) if step.cwd != ROOT else Path(".")
        print(f"[verify {index}/{len(steps)}] {step.name}: {command} (cwd={relative_cwd})")
        completed = subprocess.run(step.argv, cwd=step.cwd, check=False)
        if completed.returncode != 0:
            if not step.required:
                print(
                    f"[verify] ADVISORY: {step.name} exited {completed.returncode}; continuing",
                    file=sys.stderr,
                )
                continue
            print(
                f"[verify] FAILED: {step.name} exited {completed.returncode}",
                file=sys.stderr,
            )
            return completed.returncode
    print("[verify] PASS: all required local verification steps succeeded")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("auto", "docs", "code"),
        default="auto",
        help="Verification scope. auto uses the same code/docs classification as CI.",
    )
    parser.add_argument(
        "--base",
        help="Base commit/ref for change detection and policy drift. Defaults to merge-base with origin/main.",
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="Print the resolved verification plan without executing commands.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    args = _build_parser().parse_args(argv)
    try:
        base_sha = resolve_base_sha(args.base)
        changed_files = get_worktree_changed_files(base_sha, cwd=ROOT)
        detected_mode = classify_paths(changed_files)
        mode: VerificationMode = detected_mode if args.mode == "auto" else args.mode
        steps = build_plan(mode, base_sha)

        print(f"[verify] base={base_sha}")
        print(
            f"[verify] changed_files={len(changed_files)} detected={detected_mode} selected={mode}"
        )
        for path in changed_files:
            print(f"[verify] changed: {path}")

        if args.plan:
            for step in steps:
                cwd = step.cwd.relative_to(ROOT) if step.cwd != ROOT else Path(".")
                print(f"[verify] plan: {step.name}: {' '.join(step.argv)} (cwd={cwd})")
            return 0

        return run_plan(steps)
    except RuntimeError as exc:
        print(f"[verify] ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
