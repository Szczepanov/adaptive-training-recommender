from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from detect_ci_changes import get_worktree_changed_files
from verify_repo import build_plan, classify_paths


def test_docs_only_diff_uses_hygiene_contract() -> None:
    assert classify_paths(["README.md", "docs/README.md"]) == "docs"

    plan = build_plan("docs", "a" * 40)
    names = [step.name for step in plan]

    assert names == ["repository hygiene", "coding-agent eval corpus"]


def test_agent_config_yaml_fails_safe_to_code_contract() -> None:
    assert classify_paths([".serena/project.yml"]) == "code"


def test_code_contract_contains_ci_critical_local_gates() -> None:
    plan = build_plan("code", "b" * 40)
    names = [step.name for step in plan]

    assert "static checks and unit tests" in names
    assert "Firestore security rules" in names
    assert "browser E2E" in names
    assert "engine simulations" in names
    assert "deterministic plan-judge corpus" in names
    assert "deterministic persona corpus" in names
    assert "policy-version drift" in names
    assert "production build" in names

    semantic_diff = next(
        step for step in plan if step.name == "simulation semantic diff (advisory)"
    )
    assert semantic_diff.required is False
    assert semantic_diff.argv == ("npm", "--prefix", "app", "run", "simulate:diff")


def test_code_contract_avoids_external_registry_and_docker_gates() -> None:
    plan = build_plan("code", "c" * 40)
    commands = [" ".join(step.argv) for step in plan]

    assert all("npm audit" not in command for command in commands)
    assert all("pip-audit" not in command for command in commands)
    assert all("docker" not in command for command in commands)


@pytest.fixture(autouse=True)
def _isolate_from_hook_git_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Git hooks (e.g. pre-push) export GIT_DIR/GIT_INDEX_FILE. Inherited, they point
    # the tmp_path fixture repos below at the real repository: `git init` there sets
    # core.bare=true and `git config user.*` overwrites the real identity.
    for key in [key for key in os.environ if key.startswith("GIT_")]:
        monkeypatch.delenv(key)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()


def test_worktree_changes_include_uncommitted_and_untracked_code(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")
    (tmp_path / "README.md").write_text("base\n")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "tracked.py").write_text("x = 1\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "base")
    base = _git(tmp_path, "rev-parse", "HEAD")

    (tmp_path / "README.md").write_text("committed docs change\n")
    _git(tmp_path, "commit", "-qam", "docs")
    (tmp_path / "src" / "tracked.py").write_text("x = 2\n")
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "new_tool.py").write_text("y = 1\n")

    changed = get_worktree_changed_files(base, cwd=tmp_path)

    assert changed == ["README.md", "scripts/new_tool.py", "src/tracked.py"]
    assert classify_paths(changed) == "code"


def test_worktree_changes_fail_loudly_for_unknown_base(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q")

    with pytest.raises(RuntimeError):
        get_worktree_changed_files("f" * 40, cwd=tmp_path)
