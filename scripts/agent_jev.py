#!/usr/bin/env python3
"""Egress-guarded bridge from coding agents to the Jev semantic navigation CLI.

Jev sends selected repository content to an external TypeSafe service, so every
Jev scope is data egress rather than a purely local search. This wrapper refuses
repository-root sweeps, generated/artifact trees and credential-shaped paths
before a request can leave the machine, and exposes only the query verbs an agent
is allowed to use. A refusal is fail-closed: nothing is executed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JEV_EXECUTABLE = "jev"
UNAVAILABLE_EXIT = 3
REFUSED_EXIT = 4

# Directory names whose contents must never reach an external provider: generated
# reports, vendored dependencies, VCS/index state and local device archives.
BLOCKED_TREES = (
    "artifacts",
    ".garmin_archive",
    ".garmin_tokens",
    ".garth",
    "node_modules",
    ".git",
    ".canopy",
    ".venv",
    "__pycache__",
    "test-results",
    "playwright-report",
    "dist",
    "build",
    ".next",
)

# Substrings that mark a leaf name as credential or token material.
BLOCKED_NAME_MARKERS = (
    ".env",
    "service-account",
    "credential",
    "secret",
    "token",
    ".pem",
    ".key",
    "id_rsa",
)


def resolve_scope(raw: str, repo_root: Path) -> Path:
    """Resolve one scope argument to an absolute path for policy checks."""
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return candidate.resolve()


def scope_violations(scopes: Sequence[str], repo_root: Path) -> list[str]:
    """Return policy refusals for scopes that must not leave the machine."""
    violations: list[str] = []
    root = repo_root.resolve()

    for raw in scopes:
        resolved = resolve_scope(raw, repo_root)

        if resolved == root:
            violations.append(
                f"{raw!r} resolves to the repository root; scope Jev to explicit source "
                "files or one narrow source-only directory"
            )
            continue

        blocked = sorted({part.lower() for part in resolved.parts}.intersection(BLOCKED_TREES))
        if blocked:
            violations.append(f"{raw!r} is inside blocked tree(s): {', '.join(blocked)}")

        leaf = resolved.name.lower()
        matched = [marker for marker in BLOCKED_NAME_MARKERS if marker in leaf]
        if matched:
            violations.append(f"{raw!r} has a credential-shaped name ({leaf})")

    return violations


def requested_scopes(args: argparse.Namespace) -> list[str]:
    """Scope arguments for the selected command; `probe` names no scope."""
    if args.command == "ask":
        return [args.path]
    if args.command == "find":
        return list(args.scopes)
    if args.command == "scan":
        return [args.scope]
    return []


def is_local_only(args: argparse.Namespace) -> bool:
    """`scan --list` inspects candidates locally and never leaves the machine."""
    return args.command == "scan" and args.list_only


def build_jev_command(args: argparse.Namespace) -> list[str]:
    """Build only the query commands exposed by this wrapper."""
    if args.command == "probe":
        return [JEV_EXECUTABLE, "probe"]
    if args.command == "scan":
        command = [JEV_EXECUTABLE, "scan"]
        if args.list_only:
            command.append("--list")
        command.append(args.scope)
        return command
    if args.command == "ask":
        command = [JEV_EXECUTABLE, "ask", args.question, args.path]
        if args.quiet:
            command.append("-q")
        return command
    if args.command == "find":
        command = [JEV_EXECUTABLE, "find", args.behavior, *args.scopes]
        if args.max_files is not None:
            command.extend(["--max-files", str(args.max_files)])
        return command
    raise ValueError(f"Unsupported Jev query command: {args.command}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("probe", help="verify the Jev install without sending source")

    scan = subparsers.add_parser("scan", help="inspect scope candidates locally (no egress)")
    scan.add_argument("scope")
    scan.add_argument("--list", dest="list_only", action="store_true", default=False)

    ask = subparsers.add_parser("ask", help="one atomic semantic property about one source file")
    ask.add_argument("question")
    ask.add_argument("path")
    ask.add_argument("-q", dest="quiet", action="store_true", default=False)

    find = subparsers.add_parser(
        "find", help="locate behavior when repository vocabulary is unknown"
    )
    find.add_argument("behavior")
    find.add_argument("scopes", nargs="+")
    find.add_argument("--max-files", type=int)

    return parser


def main(argv: list[str] | None = None) -> int:
    """Run one egress-guarded Jev query command."""
    args = _build_parser().parse_args(argv)

    if shutil.which(JEV_EXECUTABLE) is None:
        print(
            f"JEV_UNAVAILABLE: {JEV_EXECUTABLE} executable not found; fall back to lexical "
            "search without provisioning it. On Windows this needs a resolvable executable "
            "such as jev.exe; an extensionless file named jev is not one.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT

    if not is_local_only(args):
        violations = scope_violations(requested_scopes(args), ROOT)
        if violations:
            for violation in violations:
                print(f"JEV_REFUSED: {violation}", file=sys.stderr)
            print(
                "JEV_REFUSED: a Jev scope is data egress, not a local search; narrow to "
                "explicit source files, or inspect candidates with 'scan --list'.",
                file=sys.stderr,
            )
            return REFUSED_EXIT

    completed = subprocess.run(build_jev_command(args), cwd=ROOT, check=False)
    if completed.returncode != 0:
        print(
            "JEV_UNAVAILABLE: guarded Jev command failed; fall back to lexical search.",
            file=sys.stderr,
        )
        return UNAVAILABLE_EXIT
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
