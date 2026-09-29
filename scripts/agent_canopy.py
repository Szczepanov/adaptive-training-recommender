#!/usr/bin/env python3
"""Read-only bridge from agent worktrees to a maintained Canopy baseline index."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[1]
BASELINE_ENV = "AGENT_CANOPY_BASELINE_WORKTREE"
UNAVAILABLE_EXIT = 3
_REQUIRED_INDEX_FILES = (
    Path(".canopy/canopy.toml"),
    Path(".canopy/store.redb"),
    Path(".canopy/vectors.idx"),
)


@dataclass(frozen=True)
class Worktree:
    """One record from `git worktree list --porcelain`."""

    path: Path
    head: str
    branch: str | None


def parse_worktree_porcelain(text: str) -> list[Worktree]:
    """Parse `git worktree list --porcelain` without assuming paths lack spaces."""
    records: list[Worktree] = []
    current: dict[str, str] = {}

    def flush() -> None:
        if "worktree" not in current:
            current.clear()
            return
        records.append(
            Worktree(
                path=Path(current["worktree"]),
                head=current.get("HEAD", ""),
                branch=current.get("branch"),
            )
        )
        current.clear()

    for raw_line in text.splitlines():
        if not raw_line:
            flush()
            continue
        key, separator, value = raw_line.partition(" ")
        current[key] = value if separator else ""
    flush()
    return records


def _git_worktrees(repo_root: Path) -> list[Worktree]:
    completed = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip() or "git worktree list --porcelain failed"
        )
    return parse_worktree_porcelain(completed.stdout)


def _missing_index_files(worktree: Path) -> list[Path]:
    return [relative for relative in _REQUIRED_INDEX_FILES if not (worktree / relative).exists()]


def _resolve_explicit_path(raw: str, repo_root: Path) -> Path:
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return candidate.resolve()


def find_baseline_worktree(
    repo_root: Path,
    *,
    explicit: str | None = None,
    worktrees: Sequence[Worktree] | None = None,
) -> tuple[Path | None, str | None]:
    """Find a maintained main/master worktree with an existing Canopy index."""
    override = explicit or os.environ.get(BASELINE_ENV)
    if override:
        candidate = _resolve_explicit_path(override, repo_root)
        missing = _missing_index_files(candidate)
        if missing:
            joined = ", ".join(str(path) for path in missing)
            return None, f"{candidate} is missing {joined}"
        return candidate, None

    records = list(worktrees) if worktrees is not None else _git_worktrees(repo_root)
    preferred_branches = ("refs/heads/main", "refs/heads/master")
    for branch in preferred_branches:
        for record in records:
            if record.branch != branch:
                continue
            missing = _missing_index_files(record.path)
            if not missing:
                return record.path.resolve(), None
            joined = ", ".join(str(path) for path in missing)
            return None, f"{record.path} is the {branch.removeprefix('refs/heads/')} worktree but is missing {joined}"

    return None, "no checked-out main/master worktree with a maintained Canopy index was found"


def _git_head(worktree: Path) -> str | None:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=worktree,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    return value or None


def _indexed_sha(worktree: Path) -> str | None:
    config_path = worktree / ".canopy" / "canopy.toml"
    try:
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return None

    indexing = config.get("indexing")
    if not isinstance(indexing, dict):
        return None
    value = indexing.get("last_sha")
    return value if isinstance(value, str) and value else None


def build_canopy_command(args: argparse.Namespace) -> list[str]:
    """Build only read-only Canopy commands exposed by this wrapper."""
    if args.command == "status":
        return ["canopy", "status"]
    if args.command == "search":
        command = ["canopy", "search", args.query]
        if args.max_results is not None:
            command.extend(["--max-results", str(args.max_results)])
        if args.path_filter is not None:
            command.extend(["--path", args.path_filter])
        return command
    if args.command == "map":
        return ["canopy", "map", args.symbol]
    if args.command == "trace":
        return ["canopy", "trace", args.from_symbol, args.to_symbol]
    raise ValueError(f"Unsupported read-only Canopy command: {args.command}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline-worktree",
        help=f"override the maintained baseline checkout (or set {BASELINE_ENV})",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status")

    search = subparsers.add_parser("search")
    search.add_argument("query")
    search.add_argument("--max-results", type=int)
    search.add_argument("--path", dest="path_filter")

    mapping = subparsers.add_parser("map")
    mapping.add_argument("symbol")

    trace = subparsers.add_parser("trace")
    trace.add_argument("from_symbol")
    trace.add_argument("to_symbol")

    return parser


def _print_baseline_state(worktree: Path) -> None:
    indexed_sha = _indexed_sha(worktree)
    head_sha = _git_head(worktree)

    print(f"CANOPY_BASELINE: {worktree}", file=sys.stderr)
    if indexed_sha and head_sha:
        state = "up-to-date" if indexed_sha == head_sha else "stale-baseline"
        print(
            f"CANOPY_INDEX: {state} indexed={indexed_sha[:12]} head={head_sha[:12]}",
            file=sys.stderr,
        )
    elif indexed_sha:
        print(f"CANOPY_INDEX: indexed={indexed_sha[:12]} head=unknown", file=sys.stderr)
    else:
        print("CANOPY_INDEX: indexed-sha=unknown", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    """Run a read-only Canopy query against a maintained baseline checkout."""
    args = _build_parser().parse_args(argv)

    if shutil.which("canopy") is None:
        print(
            "CANOPY_UNAVAILABLE: canopy executable not found; fall back without provisioning it.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT

    try:
        baseline, reason = find_baseline_worktree(
            ROOT,
            explicit=args.baseline_worktree,
        )
    except RuntimeError as exc:
        print(
            f"CANOPY_UNAVAILABLE: {exc}; fall back without provisioning it.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT

    if baseline is None:
        print(
            f"CANOPY_UNAVAILABLE: {reason}; fall back without provisioning it.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT

    _print_baseline_state(baseline)
    command = build_canopy_command(args)
    completed = subprocess.run(command, cwd=baseline, check=False)
    if completed.returncode != 0:
        print(
            "CANOPY_UNAVAILABLE: read-only Canopy query failed; "
            "fall back without init/index/reindex/model changes.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
