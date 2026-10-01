from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import agent_jev_read_hook
import pytest
from agent_jev_read_hook import PASS_THROUGH, narrowed_decision, read_skip_reason, run_hook


def _payload(file_path: str, **window: int) -> bytes:
    tool_input: dict[str, object] = {"file_path": file_path, **window}
    return json.dumps({"tool_name": "Read", "tool_input": tool_input}).encode()


def _jev_reply(file_path: str, offset: object = 10, limit: object = 80, **top: object) -> bytes:
    specific = {
        "hookEventName": "PreToolUse",
        "updatedInput": {"file_path": file_path, "offset": offset, "limit": limit},
    }
    return json.dumps({"hookSpecificOutput": specific, **top}).encode()


def _source(tmp_path: Path) -> str:
    return str(tmp_path / "app" / "src" / "services" / "a.ts")


@pytest.fixture(autouse=True)
def _no_real_jev(monkeypatch: pytest.MonkeyPatch) -> None:
    """Jev is a paid external service: no test may reach the real executable."""

    def refuse(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        raise AssertionError("test attempted to run a real process")

    monkeypatch.setattr(agent_jev_read_hook.shutil, "which", lambda _name: None)
    monkeypatch.setattr(agent_jev_read_hook.subprocess, "run", refuse)


class RecordingInvoker:
    def __init__(self, result: bytes | None) -> None:
        self.result = result
        self.calls: list[bytes] = []

    def __call__(self, payload: bytes) -> bytes | None:
        self.calls.append(payload)
        return self.result


# --- path policy -------------------------------------------------------------------


def test_ordinary_source_file_is_eligible(tmp_path: Path) -> None:
    assert read_skip_reason(_source(tmp_path), tmp_path) is None


def test_python_source_file_is_eligible(tmp_path: Path) -> None:
    assert read_skip_reason(str(tmp_path / "src" / "garmin_sync" / "mapper.py"), tmp_path) is None


def test_relative_path_is_skipped(tmp_path: Path) -> None:
    reason = read_skip_reason("app/src/services/a.ts", tmp_path)

    assert reason is not None
    assert "not an absolute path" in reason


def test_file_outside_repository_is_skipped(tmp_path: Path) -> None:
    reason = read_skip_reason(str(tmp_path.parent / "elsewhere" / "notes.ts"), tmp_path)

    assert reason is not None
    assert "outside the repository" in reason


def test_dot_dot_escape_to_engine_is_skipped(tmp_path: Path) -> None:
    sneaky = tmp_path / "app" / "src" / "services" / ".." / "engine" / "optimizer.ts"

    reason = read_skip_reason(str(sneaky), tmp_path)

    assert reason is not None
    assert "decision-authority" in reason


@pytest.mark.parametrize(
    "relative",
    ["artifacts/report.ts", "app/artifacts/run.py", ".garth/session.py", "node_modules/x/index.js"],
)
def test_blocked_trees_are_skipped(tmp_path: Path, relative: str) -> None:
    reason = read_skip_reason(str(tmp_path / relative), tmp_path)

    assert reason is not None
    assert "blocked tree" in reason


def test_credential_shaped_source_is_skipped(tmp_path: Path) -> None:
    reason = read_skip_reason(str(tmp_path / "scripts" / "refresh_token.py"), tmp_path)

    assert reason is not None
    assert "credential-shaped" in reason


@pytest.mark.parametrize(
    "relative",
    ["tests/fixtures/snapshot.json", "docs/adr/0001.md", ".env", "app/firestore.rules", "Makefile"],
)
def test_non_source_files_are_skipped(tmp_path: Path, relative: str) -> None:
    assert read_skip_reason(str(tmp_path / relative), tmp_path) is not None


@pytest.mark.parametrize(
    "relative",
    [
        "app/src/engine/optimizer.ts",
        "APP/SRC/ENGINE/Optimizer.ts",
        "app/src/knowledge/sportsKnowledgeRegistry.ts",
        "app/src/workouts/event-plan.ts",
        "app/src/workouts/catalog/performance-goal-support.ts",
        "src/garmin_sync/intensity_classification.py",
    ],
)
def test_decision_authority_code_is_read_in_full(tmp_path: Path, relative: str) -> None:
    reason = read_skip_reason(str(tmp_path / relative), tmp_path)

    assert reason is not None
    assert "decision-authority" in reason


def test_nested_worktree_under_dot_claude_is_skipped(tmp_path: Path) -> None:
    nested = tmp_path / ".claude" / "worktrees" / "wt" / "app" / "src" / "services" / "a.ts"

    reason = read_skip_reason(str(nested), tmp_path)

    assert reason is not None
    assert ".claude" in reason


def test_nested_git_checkout_is_skipped(tmp_path: Path) -> None:
    checkout = tmp_path / "vendor" / "other"
    checkout.mkdir(parents=True)
    (checkout / ".git").write_text("gitdir: elsewhere\n")

    reason = read_skip_reason(str(checkout / "lib" / "a.ts"), tmp_path)

    assert reason is not None
    assert "nested checkout" in reason


def test_symlink_leaving_the_repository_is_skipped(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    outside = tmp_path / "outside"
    (repo / "app" / "src").mkdir(parents=True)
    outside.mkdir()
    (outside / "a.ts").write_text("export {}\n")
    link = repo / "app" / "src" / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not permitted on this platform")

    reason = read_skip_reason(str(link / "a.ts"), repo)

    assert reason is not None
    assert "outside the repository" in reason


# --- jev reply validation ----------------------------------------------------------


def test_narrowing_is_rebuilt_with_note_inside_hook_specific_output() -> None:
    reply = _jev_reply("/r/a.ts", additionalContext="jev narrowed this Read")

    decision = json.loads(narrowed_decision(reply, "/r/a.ts") or b"null")

    assert decision == {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {"file_path": "/r/a.ts", "offset": 10, "limit": 80},
            "additionalContext": "jev narrowed this Read",
        }
    }


def test_narrowing_without_a_note_gets_one() -> None:
    decision = json.loads(narrowed_decision(_jev_reply("/r/a.ts"), "/r/a.ts") or b"null")

    note = decision["hookSpecificOutput"]["additionalContext"]
    assert "lines 10-89" in note
    assert "explicit offset or limit" in note


@pytest.mark.parametrize(
    "reply",
    [
        _jev_reply("/r/other.ts"),
        _jev_reply("/r/a.ts", offset=0),
        _jev_reply("/r/a.ts", limit=-5),
        _jev_reply("/r/a.ts", offset=True),
        _jev_reply("/r/a.ts", limit="80"),
        b"{}",
        b"[1, 2]",
        b"not json",
        json.dumps(
            {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny"}}
        ).encode(),
        json.dumps({"continue": False, "stopReason": "x"}).encode(),
    ],
)
def test_anything_but_a_same_file_narrowing_is_rejected(reply: bytes) -> None:
    assert narrowed_decision(reply, "/r/a.ts") is None


# --- run_hook ------------------------------------------------------------------------


def test_eligible_read_is_forwarded_and_narrowed(tmp_path: Path) -> None:
    target = _source(tmp_path)
    payload = _payload(target)
    invoke = RecordingInvoker(_jev_reply(target))

    decision = json.loads(run_hook(payload, tmp_path, invoke))

    assert invoke.calls == [payload]
    assert decision["hookSpecificOutput"]["updatedInput"]["file_path"] == target


def test_blocked_read_never_reaches_jev(tmp_path: Path) -> None:
    invoke = RecordingInvoker(b"{}")
    payload = _payload(str(tmp_path / "artifacts" / "a.ts"))

    assert run_hook(payload, tmp_path, invoke) == PASS_THROUGH
    assert invoke.calls == []


@pytest.mark.parametrize("window", [{"offset": 1}, {"limit": 50}])
def test_explicit_window_never_reaches_jev(tmp_path: Path, window: dict[str, int]) -> None:
    invoke = RecordingInvoker(b"{}")

    assert run_hook(_payload(_source(tmp_path), **window), tmp_path, invoke) == PASS_THROUGH
    assert invoke.calls == []


@pytest.mark.parametrize(
    "payload",
    [
        b"not json",
        b"[]",
        json.dumps({"tool_name": "Grep", "tool_input": {"pattern": "x"}}).encode(),
        json.dumps({"tool_name": "Read", "tool_input": {}}).encode(),
        json.dumps({"tool_name": "Read"}).encode(),
    ],
)
def test_unusable_payloads_pass_through(tmp_path: Path, payload: bytes) -> None:
    invoke = RecordingInvoker(b"{}")

    assert run_hook(payload, tmp_path, invoke) == PASS_THROUGH
    assert invoke.calls == []


@pytest.mark.parametrize("result", [None, b"", b"{}", b"not json"])
def test_declined_or_failed_jev_passes_through(tmp_path: Path, result: bytes | None) -> None:
    invoke = RecordingInvoker(result)

    assert run_hook(_payload(_source(tmp_path)), tmp_path, invoke) == PASS_THROUGH
    assert len(invoke.calls) == 1


# --- invoke_jev and main -----------------------------------------------------------


def test_default_invoker_passes_through_when_jev_is_missing() -> None:
    assert agent_jev_read_hook.invoke_jev(b"{}") is None


def test_default_invoker_runs_jev_hook_read_from_repo_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        seen["command"] = command
        seen.update(kwargs)
        return subprocess.CompletedProcess(args=command, returncode=0, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(agent_jev_read_hook.shutil, "which", lambda _name: "jev.exe")
    monkeypatch.setattr(agent_jev_read_hook.subprocess, "run", fake_run)

    assert agent_jev_read_hook.invoke_jev(b"payload") == b"{}"
    assert seen["command"] == ["jev.exe", "hook", "read"]
    assert seen["input"] == b"payload"
    assert seen["cwd"] == agent_jev_read_hook.ROOT


def test_default_invoker_swallows_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    def time_out(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.TimeoutExpired(cmd="jev", timeout=1)

    monkeypatch.setattr(agent_jev_read_hook.shutil, "which", lambda _name: "jev.exe")
    monkeypatch.setattr(agent_jev_read_hook.subprocess, "run", time_out)

    assert agent_jev_read_hook.invoke_jev(b"{}") is None


def test_default_invoker_drops_output_of_failed_jev(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(args=["jev"], returncode=1, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(agent_jev_read_hook.shutil, "which", lambda _name: "jev.exe")
    monkeypatch.setattr(agent_jev_read_hook.subprocess, "run", fail)

    assert agent_jev_read_hook.invoke_jev(b"{}") is None


class _Stream:
    def __init__(self, data: bytes = b"") -> None:
        self.buffer = io.BytesIO(data)


def _run_main(monkeypatch: pytest.MonkeyPatch, stdin: bytes) -> tuple[int, bytes]:
    stdout = _Stream()
    monkeypatch.setattr(agent_jev_read_hook.sys, "stdin", _Stream(stdin))
    monkeypatch.setattr(agent_jev_read_hook.sys, "stdout", stdout)
    return agent_jev_read_hook.main(), stdout.buffer.getvalue()


def test_main_passes_through_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JEV_HOOK_DISABLE", "1")

    assert _run_main(monkeypatch, b"not even read") == (0, PASS_THROUGH)


def test_main_falls_back_to_a_full_read_on_unexpected_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(*_args: object) -> bytes:
        raise RuntimeError("boom")

    monkeypatch.delenv("JEV_HOOK_DISABLE", raising=False)
    monkeypatch.setattr(agent_jev_read_hook, "run_hook", explode)

    assert _run_main(monkeypatch, b"{}") == (0, PASS_THROUGH)
