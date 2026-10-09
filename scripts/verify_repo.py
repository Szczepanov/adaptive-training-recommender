#!/usr/bin/env python3
"""Run the repository-owned verification contract for coding agents."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Literal, TextIO

from detect_ci_changes import get_worktree_changed_files, is_code_file

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
LOG_DIR = APP / "artifacts" / "verify"
FAILURE_TAIL_LINES = 80
SPAWN_FAILED = 127
# Same split as CI's rules job matrix.
RULES_SHARDS = 2
VerificationMode = Literal["docs", "code"]


@dataclass(frozen=True)
class VerificationStep:
    """One deterministic local verification step."""

    name: str
    argv: tuple[str, ...]
    cwd: Path = ROOT
    required: bool = True
    env: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class VerificationPhase:
    """A set of lanes that run concurrently; each lane runs its steps in order."""

    name: str
    lanes: tuple[tuple[VerificationStep, ...], ...]


@dataclass(frozen=True)
class StepResult:
    """Outcome of one executed step."""

    step: VerificationStep
    returncode: int
    seconds: float
    log_path: Path | None


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


def _npm(script: str) -> tuple[str, ...]:
    return ("npm", "--prefix", "app", "run", script)


def build_plan(mode: VerificationMode, base_sha: str) -> list[VerificationPhase]:
    """Build the stable local verification plan for a docs or code diff.

    Phases run in order. Within a phase, lanes run concurrently and each lane runs its steps
    in order, so a lane holds exactly the steps that must not overlap, e.g. ``simulate:diff``
    reads the report that ``simulate:scenarios`` writes. Emulator suites can share a phase
    because each rules shard and browser E2E acquires its own dynamically leased ports via the
    test harness launcher. Wall-clock latency gates get a phase of their own so no
    sibling competes for the CPU while samples are taken.
    """
    # In code mode the gates phase runs mypy and ESLint itself; pre-commit's copies of those
    # hooks would only repeat the two slowest checks before any gate starts.
    duplicated_hooks: tuple[tuple[str, str], ...] = (
        () if mode == "docs" else (("SKIP", "mypy,eslint"),)
    )
    hygiene = VerificationPhase(
        "hygiene",
        (
            (
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
                    env=duplicated_hooks,
                ),
            ),
            (
                VerificationStep(
                    "coding-agent eval corpus",
                    ("uv", "run", "python", "scripts/agent_eval.py", "validate"),
                ),
            ),
        ),
    )
    if mode == "docs":
        return [hygiene]

    gates = VerificationPhase(
        "gates",
        (
            *(
                (
                    VerificationStep(
                        f"Firestore security rules {index}/{RULES_SHARDS}",
                        (*_npm("test:rules:shard"), "--", f"{index}/{RULES_SHARDS}"),
                    ),
                )
                for index in range(1, RULES_SHARDS + 1)
            ),
            (VerificationStep("browser E2E", _npm("test:e2e")),),
            (
                VerificationStep("ruff lint", ("uv", "run", "ruff", "check", ".")),
                VerificationStep("ruff format", ("uv", "run", "ruff", "format", "--check", ".")),
                VerificationStep("mypy", ("uv", "run", "mypy")),
                VerificationStep("pytest", ("uv", "run", "pytest")),
            ),
            (
                VerificationStep("frontend dependency audit", _npm("audit")),
                VerificationStep("Firestore rules source sync", _npm("rules:check-sync")),
                VerificationStep("frontend typecheck", _npm("typecheck")),
                VerificationStep("frontend lint", _npm("lint")),
                VerificationStep("knowledge registry", _npm("validate:knowledge")),
                VerificationStep("knowledge coverage", _npm("validate:knowledge-coverage")),
                VerificationStep("knowledge freshness", _npm("validate:knowledge-freshness")),
                VerificationStep("workout catalog", _npm("validate:workouts")),
            ),
            (VerificationStep("frontend unit tests", _npm("test")),),
            (
                VerificationStep("engine simulations", _npm("simulate:scenarios")),
                VerificationStep(
                    "simulation baseline cleanliness",
                    ("git", "diff", "--exit-code", "--", "docs/analysis/simulation-baseline.json"),
                ),
                VerificationStep(
                    "simulation semantic diff (advisory)",
                    _npm("simulate:diff"),
                    required=False,
                ),
            ),
            (
                VerificationStep("deterministic plan-judge corpus", _npm("simulate:plan-judge")),
                VerificationStep("deterministic persona corpus", _npm("persona:build")),
                VerificationStep(
                    "policy-version drift",
                    ("node", "scripts/check-policy-drift.mjs", base_sha),
                    cwd=APP,
                ),
            ),
            (VerificationStep("production build", _npm("build:bundle")),),
        ),
    )
    latency = VerificationPhase(
        "latency",
        ((VerificationStep("frontend latency gates", _npm("test:perf")),),),
    )
    return [hygiene, gates, latency]


def plan_steps(phases: list[VerificationPhase]) -> list[VerificationStep]:
    """Flatten a plan into its steps, in phase then lane order."""
    return [step for phase in phases for lane in phase.lanes for step in lane]


def serialize_plan(phases: list[VerificationPhase]) -> list[VerificationPhase]:
    """Collapse a plan into one single-lane phase, i.e. the old strictly sequential run."""
    return [VerificationPhase("serial", (tuple(plan_steps(phases)),))]


def resolve_argv(argv: tuple[str, ...]) -> tuple[str, ...]:
    """Resolve the executable to a full path so Windows can spawn npm.cmd-style shims.

    CreateProcess does not apply PATHEXT, so a bare ``npm`` fails on Windows even though a
    shell finds ``npm.cmd``. ``shutil.which`` applies PATHEXT there and returns the same binary
    a POSIX shell would. An unresolvable name is left as-is so the spawn error still names it.
    """
    if not argv:
        return argv
    resolved = shutil.which(argv[0])
    return (resolved, *argv[1:]) if resolved else argv


def _log_path(step: VerificationStep, log_dir: Path) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", step.name.lower()).strip("-")
    return log_dir / f"{slug}.log"


def _step_env(step: VerificationStep) -> dict[str, str] | None:
    if not step.env:
        return None
    env = dict(os.environ)
    for key, value in step.env:
        # Extend rather than replace a caller's own list (e.g. SKIP=gitleaks make verify).
        env[key] = ",".join(filter(None, (env.get(key), value))) if key == "SKIP" else value
    return env


def _display_command(step: VerificationStep) -> str:
    return "".join(f"{key}={value} " for key, value in step.env) + " ".join(step.argv)


def _spawn(step: VerificationStep, log_path: Path | None) -> int:
    """Run one step, streaming its output or writing it to ``log_path``; return its exit code."""
    if log_path is None:
        return subprocess.run(
            resolve_argv(step.argv), cwd=step.cwd, env=_step_env(step), check=False
        ).returncode
    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        return subprocess.run(
            resolve_argv(step.argv),
            cwd=step.cwd,
            env=_step_env(step),
            check=False,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        ).returncode


def _run_step(
    step: VerificationStep, log_dir: Path | None, emit: Callable[[str], None]
) -> StepResult:
    relative_cwd = step.cwd.relative_to(ROOT) if step.cwd != ROOT else Path(".")
    emit(f"[verify] start {step.name}: {_display_command(step)} (cwd={relative_cwd})")
    started = time.monotonic()
    log_path = None if log_dir is None else _log_path(step, log_dir)
    try:
        returncode = _spawn(step, log_path)
    except OSError as exc:
        # A missing executable or unwritable log fails this step, not the whole lane thread.
        emit(f"[verify] cannot start {step.name}: {exc}")
        returncode = SPAWN_FAILED
    result = StepResult(step, returncode, time.monotonic() - started, log_path)
    status = "ok" if returncode == 0 else f"exit {returncode}"
    advisory = "" if step.required or returncode == 0 else " (advisory, continuing)"
    emit(f"[verify] {status:>7} {result.seconds:6.1f}s {step.name}{advisory}")
    return result


def _run_lane(
    lane: tuple[VerificationStep, ...],
    log_dir: Path | None,
    abort: threading.Event,
    emit: Callable[[str], None],
) -> list[StepResult]:
    results: list[StepResult] = []
    for step in lane:
        if abort.is_set():
            break
        result = _run_step(step, log_dir, emit)
        results.append(result)
        if result.returncode != 0 and step.required:
            abort.set()
            break
    return results


def _print_log(result: StepResult, heading: str, tail: int | None, file: TextIO) -> None:
    print(heading, file=file)
    if result.log_path is None:
        return
    lines = result.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    shown = lines if tail is None else lines[-tail:]
    print(f"[verify] {len(shown)} of {len(lines)} lines of {result.log_path}:", file=file)
    for line in shown:
        print(f"    {line}", file=file)


def run_plan(phases: list[VerificationPhase], log_dir: Path = LOG_DIR) -> int:
    """Run phases in order, lanes concurrently, and stop scheduling on the first failure.

    A failing required step stops every lane from starting its next step; steps already
    running finish rather than being killed, so no emulator or dev server is orphaned.
    A single-lane phase streams its output; concurrent lanes write per-step logs, and an
    advisory step's log is printed in full because reading it is the point of running it.
    """
    lock = threading.Lock()

    def emit(message: str) -> None:
        with lock:
            print(message, flush=True)

    # Logs left by an earlier run would be mistaken for this run's output.
    for stale in log_dir.glob("*.log") if log_dir.is_dir() else ():
        stale.unlink()

    started = time.monotonic()
    for index, phase in enumerate(phases, start=1):
        phase_log_dir = None if len(phase.lanes) == 1 else log_dir
        if phase_log_dir is not None:
            phase_log_dir.mkdir(parents=True, exist_ok=True)
        emit(
            f"[verify phase {index}/{len(phases)}] {phase.name}: {len(phase.lanes)} lane(s)"
            + ("" if phase_log_dir is None else f", logs in {phase_log_dir}")
        )
        abort = threading.Event()
        with ThreadPoolExecutor(max_workers=len(phase.lanes)) as pool:
            run_lane = partial(_run_lane, log_dir=phase_log_dir, abort=abort, emit=emit)
            results = [result for lane in pool.map(run_lane, phase.lanes) for result in lane]

        for result in results:
            if not result.step.required:
                heading = (
                    f"[verify] ADVISORY output of {result.step.name} (exit {result.returncode}):"
                )
                _print_log(result, heading, None, sys.stdout)
        failures = [r for r in results if r.returncode != 0 and r.step.required]
        for failure in failures:
            heading = f"[verify] FAILED: {failure.step.name} exited {failure.returncode}"
            _print_log(failure, heading, FAILURE_TAIL_LINES, sys.stderr)
        if failures:
            return failures[0].returncode

    elapsed = time.monotonic() - started
    print(f"[verify] PASS: all required local verification steps succeeded in {elapsed:.0f}s")
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
    parser.add_argument(
        "--serial",
        action="store_true",
        default=os.getenv("VERIFY_SERIAL") == "1",
        help="Run every step one after another with streamed output (debugging aid; slower). "
        "Also enabled by VERIFY_SERIAL=1.",
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
        phases = build_plan(mode, base_sha)
        if args.serial:
            phases = serialize_plan(phases)

        print(f"[verify] base={base_sha}")
        print(
            f"[verify] changed_files={len(changed_files)} detected={detected_mode} selected={mode}"
        )
        for path in changed_files:
            print(f"[verify] changed: {path}")

        if args.plan:
            for phase in phases:
                for lane_index, lane in enumerate(phase.lanes, start=1):
                    for step in lane:
                        cwd = step.cwd.relative_to(ROOT) if step.cwd != ROOT else Path(".")
                        print(
                            f"[verify] plan: {phase.name}/lane {lane_index}: {step.name}: "
                            f"{_display_command(step)} (cwd={cwd})"
                        )
            return 0

        return run_plan(phases)
    except RuntimeError as exc:
        print(f"[verify] ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
