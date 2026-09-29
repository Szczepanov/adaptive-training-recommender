from __future__ import annotations

import argparse
from pathlib import Path

import agent_jev
import pytest
from agent_jev import (
    REFUSED_EXIT,
    UNAVAILABLE_EXIT,
    build_jev_command,
    is_local_only,
    main,
    requested_scopes,
    resolve_scope,
    scope_violations,
)


def test_repository_root_scope_is_refused(tmp_path: Path) -> None:
    violations = scope_violations(["."], tmp_path)

    assert len(violations) == 1
    assert "repository root" in violations[0]


def test_explicit_repository_root_path_is_refused(tmp_path: Path) -> None:
    violations = scope_violations([str(tmp_path)], tmp_path)

    assert len(violations) == 1
    assert "repository root" in violations[0]


def test_generated_and_archive_trees_are_refused(tmp_path: Path) -> None:
    violations = scope_violations(
        ["artifacts", "app/artifacts", ".garmin_archive", ".garmin_tokens", ".garth", ".canopy"],
        tmp_path,
    )

    # Every scope is refused. .garmin_tokens is refused twice, once per independent
    # rule, so the two checks stay redundant rather than mutually exclusive.
    assert len(violations) == 7
    assert sum("blocked tree" in violation for violation in violations) == 6
    assert sum("credential-shaped" in violation for violation in violations) == 1


def test_credential_shaped_scopes_are_refused(tmp_path: Path) -> None:
    violations = scope_violations(
        [".env", "firebase-service-account.json", "deploy/id_rsa", "secrets/notes.key"],
        tmp_path,
    )

    assert len(violations) == 4
    assert all("credential-shaped" in violation for violation in violations)


def test_source_scopes_are_allowed(tmp_path: Path) -> None:
    assert (
        scope_violations(["app/src", "src/garmin_sync", "app/src/engine/policy.ts"], tmp_path) == []
    )


def test_vendored_and_build_trees_are_refused(tmp_path: Path) -> None:
    violations = scope_violations(["node_modules", "app/dist", "web/build", ".venv"], tmp_path)

    assert len(violations) == 4
    assert all("blocked tree" in violation for violation in violations)


def test_resolve_scope_expands_relative_paths(tmp_path: Path) -> None:
    assert resolve_scope("app/src", tmp_path) == (tmp_path / "app" / "src").resolve()


def test_scan_list_is_local_only() -> None:
    local = argparse.Namespace(command="scan", scope=".", list_only=True)
    remote = argparse.Namespace(command="scan", scope=".", list_only=False)
    find = argparse.Namespace(command="find", behavior="x", scopes=["."], max_files=None)

    assert is_local_only(local) is True
    assert is_local_only(remote) is False
    assert is_local_only(find) is False


def test_requested_scopes_follow_command_positions() -> None:
    ask = argparse.Namespace(
        command="ask", question="q", path="app/src/engine/policy.ts", quiet=True
    )
    find = argparse.Namespace(command="find", behavior="b", scopes=["app/src", "src"], max_files=5)
    remote_scan = argparse.Namespace(command="scan", scope="app/src", list_only=False)
    probe = argparse.Namespace(command="probe")

    assert requested_scopes(ask) == ["app/src/engine/policy.ts"]
    assert requested_scopes(find) == ["app/src", "src"]
    assert requested_scopes(remote_scan) == ["app/src"]
    assert requested_scopes(probe) == []


def test_query_only_command_surface() -> None:
    probe = argparse.Namespace(command="probe")
    scan = argparse.Namespace(command="scan", scope="app/src", list_only=True)
    ask = argparse.Namespace(
        command="ask",
        question="does build hydrate performedFacts?",
        path="app/src/services/contextBriefService.ts",
        quiet=True,
    )
    find = argparse.Namespace(
        command="find",
        behavior="where is dose packing implemented",
        scopes=["app/src/engine"],
        max_files=20,
    )

    assert build_jev_command(probe) == ["jev", "probe"]
    assert build_jev_command(scan) == ["jev", "scan", "--list", "app/src"]
    assert build_jev_command(ask) == [
        "jev",
        "ask",
        "does build hydrate performedFacts?",
        "app/src/services/contextBriefService.ts",
        "-q",
    ]
    assert build_jev_command(find) == [
        "jev",
        "find",
        "where is dose packing implemented",
        "app/src/engine",
        "--max-files",
        "20",
    ]


def test_refusal_is_distinct_from_unavailable() -> None:
    assert REFUSED_EXIT != UNAVAILABLE_EXIT


def test_main_refuses_before_executing_anything(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(*args: object, **kwargs: object) -> None:
        raise AssertionError("jev must not run for a refused scope")

    monkeypatch.setattr(agent_jev.shutil, "which", lambda _name: "/usr/bin/jev")
    monkeypatch.setattr(agent_jev.subprocess, "run", _fail)

    assert main(["find", "anything", "."]) == REFUSED_EXIT


def test_main_refuses_a_remote_repository_root_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(*args: object, **kwargs: object) -> None:
        raise AssertionError("jev must not run a remote scan of the repository root")

    monkeypatch.setattr(agent_jev.shutil, "which", lambda _name: "/usr/bin/jev")
    monkeypatch.setattr(agent_jev.subprocess, "run", _fail)

    assert main(["scan", "."]) == REFUSED_EXIT


def test_main_reports_unavailable_without_jev_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_jev.shutil, "which", lambda _name: None)

    assert main(["probe"]) == UNAVAILABLE_EXIT
