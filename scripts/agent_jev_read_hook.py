#!/usr/bin/env python3
"""Egress-guarded Claude Code PreToolUse hook around `jev hook read`.

`jev hook read` narrows a large `Read` to the window that answers the current
request. To do that it sends the whole file and the user's latest prompt to the
external TypeSafe service, with no path policy of its own. This client-local,
opt-in hook applies the `agent_jev.py` scope policy first and forwards only
repository source files outside decision-authority code. Every refusal, error or
timeout passes the read through untouched, so the fallback is always a full read
and never a request leaving the machine.

Jev's reply is rebuilt rather than forwarded: only a narrowing of the same file
is accepted, and the "this read was narrowed" note is placed inside
`hookSpecificOutput`, the only place Claude Code reads it from.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from agent_jev import JEV_EXECUTABLE, scope_violations

ROOT = Path(__file__).resolve().parents[1]
PASS_THROUGH = b"{}\n"
JEV_TIMEOUT_SECONDS = 18.0

# Only source code is eligible; data, docs, config and rules files are read in full.
SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py")

# Code owning engine thresholds, knowledge claims and the workout/intensity policy the
# coverage inventory references (ADR-0033). A narrowed window could hide the constant
# or invariant a change depends on, so these are read whole. Matched at any depth so
# a nested worktree's copy is covered too.
DECISION_AUTHORITY_PATHS = (
    ("app", "src", "engine"),
    ("app", "src", "knowledge"),
    ("app", "src", "workouts"),
    ("src", "garmin_sync", "intensity_classification.py"),
)

Invoker = Callable[[bytes], bytes | None]


def _contains_run(parts: tuple[str, ...], run: tuple[str, ...]) -> bool:
    return any(parts[i : i + len(run)] == run for i in range(len(parts) - len(run) + 1))


def _nested_checkout(resolved: Path, root: Path) -> Path | None:
    """Return a git checkout between the file and the repository root, if any."""
    for ancestor in resolved.parents:
        if ancestor == root or root not in ancestor.parents:
            return None
        if (ancestor / ".git").exists():
            return ancestor
    return None


def read_skip_reason(file_path: str, repo_root: Path) -> str | None:
    """Return why a Read must not be sent to Jev, or None when it is eligible."""
    raw = Path(file_path)
    # Jev reads the raw path relative to its own cwd; only an absolute path is
    # guaranteed to name the file this policy checked.
    if not raw.is_absolute():
        return f"{file_path} is not an absolute path"

    root = repo_root.resolve()
    resolved = raw.resolve()
    try:
        relative = resolved.relative_to(root)
    except ValueError:
        return f"{resolved} is outside the repository"

    violations = scope_violations([str(resolved)], root)
    if violations:
        return "; ".join(violations)

    parts = tuple(part.lower() for part in relative.parts)
    if ".claude" in parts:
        return f"{relative.as_posix()} is under .claude/ (agent config or a nested worktree)"
    nested = _nested_checkout(resolved, root)
    if nested is not None:
        return f"{relative.as_posix()} is inside the nested checkout {nested}"

    if resolved.suffix.lower() not in SOURCE_SUFFIXES:
        return f"{relative.as_posix()} is not a source file"

    if any(_contains_run(parts, path) for path in DECISION_AUTHORITY_PATHS):
        return f"{relative.as_posix()} is decision-authority code; read it in full"

    return None


def _eligible_file_path(raw: bytes) -> tuple[str | None, str]:
    """Extract the Read target, or explain why the payload is not eligible."""
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None, "unreadable payload"
    if not isinstance(payload, dict) or payload.get("tool_name") != "Read":
        return None, "not a Read"

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None, "no tool_input"
    if "offset" in tool_input or "limit" in tool_input:
        return None, "explicit offset or limit"

    file_path = tool_input.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        return None, "no file_path"
    return file_path, ""


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return None
    return value


def narrowed_decision(output: bytes, file_path: str) -> bytes | None:
    """Rebuild Jev's reply as a narrowing of `file_path`; None if it is anything else."""
    try:
        data = json.loads(output)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    specific = data.get("hookSpecificOutput")
    if not isinstance(specific, dict):
        return None
    updated = specific.get("updatedInput")
    if not isinstance(updated, dict) or updated.get("file_path") != file_path:
        return None
    offset = _positive_int(updated.get("offset"))
    limit = _positive_int(updated.get("limit"))
    if offset is None or limit is None:
        return None

    note = data.get("additionalContext") or specific.get("additionalContext")
    if not isinstance(note, str) or not note.strip():
        note = (
            f"jev narrowed this Read to lines {offset}-{offset + limit - 1}. Read it again "
            "with an explicit offset or limit to see any other part."
        )
    decision = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {"file_path": file_path, "offset": offset, "limit": limit},
            "additionalContext": note,
        }
    }
    return (json.dumps(decision) + "\n").encode()


def run_hook(raw: bytes, repo_root: Path, invoke: Invoker) -> bytes:
    """Decide one PreToolUse payload; returns the hook's stdout."""
    file_path, reason = _eligible_file_path(raw)
    if file_path is not None:
        reason = read_skip_reason(file_path, repo_root) or ""
    if file_path is None or reason:
        _debug(f"passing through ({reason})")
        return PASS_THROUGH

    output = invoke(raw)
    decision = narrowed_decision(output, file_path) if output else None
    if decision is None:
        _debug("passing through (jev declined, failed or returned no usable narrowing)")
        return PASS_THROUGH
    return decision


def invoke_jev(raw: bytes) -> bytes | None:
    """Run `jev hook read` on the payload; None on any failure."""
    executable = shutil.which(JEV_EXECUTABLE)
    if executable is None:
        return None
    try:
        completed = subprocess.run(
            [executable, "hook", "read"],
            input=raw,
            capture_output=True,
            timeout=JEV_TIMEOUT_SECONDS,
            cwd=ROOT,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.stderr and _debug_enabled():
        sys.stderr.buffer.write(completed.stderr)
    return completed.stdout if completed.returncode == 0 else None


def _debug_enabled() -> bool:
    return bool(os.environ.get("JEV_HOOK_DEBUG", "").strip())


def _debug(message: str) -> None:
    if _debug_enabled():
        print(f"agent_jev_read_hook: {message}", file=sys.stderr)


def main() -> int:
    output = PASS_THROUGH
    if not os.environ.get("JEV_HOOK_DISABLE", "").strip():
        try:
            output = run_hook(sys.stdin.buffer.read(), ROOT, invoke_jev)
        except Exception as error:  # noqa: BLE001 - any failure must fall back to a full read
            _debug(f"passing through (hook error: {error!r})")
    sys.stdout.buffer.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
