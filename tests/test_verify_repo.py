from __future__ import annotations

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


def test_code_contract_avoids_external_registry_and_docker_gates() -> None:
    plan = build_plan("code", "c" * 40)
    commands = [" ".join(step.argv) for step in plan]

    assert all("npm audit" not in command for command in commands)
    assert all("pip-audit" not in command for command in commands)
    assert all("docker" not in command for command in commands)
