from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from detect_ci_changes import get_worktree_changed_files
from verify_repo import (
    SPAWN_FAILED,
    VerificationPhase,
    VerificationStep,
    _step_env,
    build_plan,
    classify_paths,
    plan_steps,
    resolve_argv,
    run_plan,
    serialize_plan,
)


def test_docs_only_diff_uses_hygiene_contract() -> None:
    assert classify_paths(["README.md", "docs/README.md"]) == "docs"

    plan = plan_steps(build_plan("docs", "a" * 40))
    names = [step.name for step in plan]

    assert names == ["repository hygiene", "coding-agent eval corpus"]


def test_agent_config_yaml_fails_safe_to_code_contract() -> None:
    assert classify_paths([".agents/project.yml"]) == "code"


def test_code_contract_contains_ci_critical_local_gates() -> None:
    plan = plan_steps(build_plan("code", "b" * 40))
    names = [step.name for step in plan]

    for name in (
        "ruff lint",
        "ruff format",
        "mypy",
        "pytest",
        "frontend typecheck",
        "frontend lint",
        "Firestore rules source sync",
        "frontend unit tests",
        "frontend latency gates",
        "knowledge registry",
        "knowledge coverage",
        "knowledge freshness",
        "workout catalog",
    ):
        assert name in names
    assert "Firestore security rules 1/2" in names
    assert "Firestore security rules 2/2" in names
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

    rules_sync = next(step for step in plan if step.name == "Firestore rules source sync")
    assert rules_sync.argv == ("npm", "--prefix", "app", "run", "rules:check-sync")


def _lane_of(
    phases: list[VerificationPhase], name: str
) -> tuple[str, tuple[VerificationStep, ...]]:
    for phase in phases:
        for lane in phase.lanes:
            if any(step.name == name for step in lane):
                return phase.name, lane
    raise AssertionError(f"{name} not in plan")


def test_code_contract_lanes_isolate_emulators_and_order_simulations() -> None:
    phases = build_plan("code", "d" * 40)

    # Every rules shard runs, each in a lane of its own (the launcher gives it its own ports).
    rules_steps = [
        step for step in plan_steps(phases) if step.name.startswith("Firestore security rules")
    ]
    assert [step.argv[-1] for step in rules_steps] == ["1/2", "2/2"]
    assert all(
        step.argv[:5] == ("npm", "--prefix", "app", "run", "test:rules:shard")
        for step in rules_steps
    )
    lanes = {_lane_of(phases, step.name) for step in rules_steps} | {
        _lane_of(phases, "browser E2E")
    }
    assert len(lanes) == 3

    # simulate:diff reads the report simulate:scenarios writes.
    _, sim_lane = _lane_of(phases, "engine simulations")
    sim_names = [step.name for step in sim_lane]
    assert sim_names.index("engine simulations") < sim_names.index(
        "simulation semantic diff (advisory)"
    )


def test_code_contract_isolates_latency_gates_and_runs_hygiene_first() -> None:
    phases = build_plan("code", "e" * 40)

    assert phases[0].name == "hygiene"
    assert [step.name for step in plan_steps([phases[-1]])] == ["frontend latency gates"]
    assert len(phases[-1].lanes) == 1


def test_serialize_plan_preserves_every_step_in_order() -> None:
    phases = build_plan("code", "f" * 40)
    serial = serialize_plan(phases)

    assert len(serial) == 1
    assert len(serial[0].lanes) == 1
    assert plan_steps(serial) == plan_steps(phases)


def test_code_contract_avoids_external_registry_and_docker_gates() -> None:
    plan = plan_steps(build_plan("code", "c" * 40))
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


def test_resolve_argv_uses_the_path_resolved_executable(monkeypatch: pytest.MonkeyPatch) -> None:
    resolved = {"npm": "C:/Program Files/nodejs/npm.CMD"}
    monkeypatch.setattr("verify_repo.shutil.which", resolved.get)

    assert resolve_argv(("npm", "--prefix", "app", "run", "test:e2e")) == (
        "C:/Program Files/nodejs/npm.CMD",
        "--prefix",
        "app",
        "run",
        "test:e2e",
    )


def test_resolve_argv_keeps_unresolvable_or_empty_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("verify_repo.shutil.which", lambda _name: None)

    assert resolve_argv(("missing-tool", "--flag")) == ("missing-tool", "--flag")
    assert resolve_argv(()) == ()


def test_resolve_argv_finds_every_real_plan_executable() -> None:
    executables = {step.argv[0] for step in plan_steps(build_plan("code", "c" * 40))}

    for executable in executables:
        resolved = resolve_argv((executable,))[0]
        assert Path(resolved).is_absolute(), f"{executable} not found on PATH"


def test_code_contract_skips_only_pre_commit_hooks_the_gates_rerun() -> None:
    docs_hygiene = plan_steps(build_plan("docs", "a" * 40))[0]
    code_steps = plan_steps(build_plan("code", "a" * 40))
    code_hygiene = code_steps[0]

    assert docs_hygiene.env == ()
    assert code_hygiene.env == (("SKIP", "mypy,eslint"),)
    commands = {" ".join(step.argv) for step in code_steps}
    assert "uv run mypy" in commands
    assert "npm --prefix app run lint" in commands


def test_step_env_extends_a_caller_skip_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SKIP", "gitleaks")
    step = VerificationStep("hygiene", ("true",), env=(("SKIP", "mypy,eslint"),))

    env = _step_env(step)

    assert env is not None
    assert env["SKIP"] == "gitleaks,mypy,eslint"
    assert _step_env(VerificationStep("plain", ("true",))) is None


REPO_ROOT = Path(__file__).resolve().parents[1]


def _make_recipe_commands(target: str, makefile: str) -> list[str]:
    """Expand a Makefile target into the shell commands its recipes run, dependencies first."""
    commands: list[str] = []
    match = re.search(rf"^{re.escape(target)}:([^\n]*)\n((?:\t[^\n]*\n)*)", makefile, re.M)
    assert match, f"target {target} not found"
    for dependency in match.group(1).split():
        commands.extend(_make_recipe_commands(dependency, makefile))
    commands.extend(line.strip() for line in match.group(2).splitlines())
    return commands


def test_code_contract_runs_every_make_check_and_build_command() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    plan_commands = {" ".join(step.argv) for step in plan_steps(build_plan("code", "a" * 40))}

    expected = _make_recipe_commands("check", makefile) + _make_recipe_commands("build", makefile)

    assert expected, "Makefile check/build targets expanded to no commands"
    missing = [command for command in expected if command not in plan_commands]
    assert missing == [], f"make verify no longer runs: {missing}"


def _exit_step(name: str, code: int, *, required: bool = True) -> VerificationStep:
    return VerificationStep(
        name,
        (sys.executable, "-c", f"print('{name} output'); raise SystemExit({code})"),
        required=required,
    )


def test_run_plan_stops_scheduling_after_a_required_failure(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    phases = [
        VerificationPhase(
            "gates",
            (
                (_exit_step("fails", 3), _exit_step("never runs", 0)),
                (_exit_step("sibling", 0),),
            ),
        ),
        VerificationPhase("later", ((_exit_step("later phase", 0),),)),
    ]

    assert run_plan(phases, tmp_path) == 3

    out, err = capsys.readouterr()
    assert "never runs" not in out
    assert "later phase" not in out
    assert "FAILED: fails exited 3" in err
    assert "fails output" in err


def test_run_plan_prints_advisory_output_and_continues(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "stale.log").write_text("from an earlier run\n")
    phases = [
        VerificationPhase(
            "gates",
            (
                (_exit_step("advisory diff", 1, required=False), _exit_step("next", 0)),
                (_exit_step("sibling", 0),),
            ),
        )
    ]

    assert run_plan(phases, tmp_path) == 0

    out, _ = capsys.readouterr()
    assert "ADVISORY output of advisory diff (exit 1)" in out
    assert "advisory diff output" in out
    assert "PASS" in out
    assert not (tmp_path / "stale.log").exists()


def test_run_plan_fails_a_step_whose_executable_is_missing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    missing = VerificationStep("missing tool", (str(tmp_path / "no-such-executable"),))
    phases = [VerificationPhase("gates", ((missing,), (_exit_step("sibling", 0),)))]

    assert run_plan(phases, tmp_path) == SPAWN_FAILED

    _, err = capsys.readouterr()
    assert "FAILED: missing tool" in err
