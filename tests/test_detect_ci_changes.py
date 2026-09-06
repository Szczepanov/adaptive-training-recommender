"""Unit tests for detect_ci_changes script."""

from __future__ import annotations

from pathlib import Path

import pytest
from detect_ci_changes import is_code_file


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("docs/README.md", False),
        ("README.md", False),
        ("AGENTS.md", False),
        ("CLAUDE.md", False),
        ("SECURITY.md", False),
        ("LICENSE", False),
        ("docs/architecture/recommendation-engine.md", False),
        ("docs/ops/production-deployment.md", False),
        ("docs/plans/some-plan.md", False),
        # Special exception: simulation-baseline.json is a machine test contract inside docs/
        ("docs/analysis/simulation-baseline.json", True),
        # Source code
        ("src/garmin_sync/models.py", True),
        ("src/garmin_sync/dates.py", True),
        ("app/src/engine/composer.ts", True),
        ("app/src/App.tsx", True),
        # Infrastructure / Docker
        ("Dockerfile", True),
        ("app/Dockerfile", True),
        ("docker-compose.yml", True),
        ("app/nginx.conf.template", True),
        ("scripts/docker_compose_smoke.py", True),
        # Config & dependencies
        ("pyproject.toml", True),
        ("uv.lock", True),
        ("app/package.json", True),
        ("app/package-lock.json", True),
        (".pre-commit-config.yaml", True),
        (".env.example", True),
        (".gitignore", True),
        # GitHub Actions workflows
        (".github/workflows/ci.yml", True),
        (".github/workflows/deploy-production.yml", True),
        # Unknown/new scripts fail safe to code
        ("new_tool.py", True),
        ("unknown_config.json", True),
    ],
)
def test_is_code_file(path: str, expected: bool) -> None:
    assert is_code_file(path) is expected


def test_main_non_pull_request_event(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from detect_ci_changes import main

    out_file = tmp_path / "output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_call")

    assert main() == 0
    content = out_file.read_text(encoding="utf-8")
    assert "code_changed=true" in content
    assert "docs_only=false" in content


def test_main_pull_request_docs_only(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import detect_ci_changes

    out_file = tmp_path / "output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "pull_request")
    monkeypatch.setattr(
        detect_ci_changes, "get_changed_files", lambda base_ref: ["docs/README.md", "CLAUDE.md"]
    )

    assert detect_ci_changes.main() == 0
    content = out_file.read_text(encoding="utf-8")
    assert "code_changed=false" in content
    assert "docs_only=true" in content


def test_main_pull_request_code_changes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import detect_ci_changes

    out_file = tmp_path / "output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "pull_request")
    monkeypatch.setattr(
        detect_ci_changes,
        "get_changed_files",
        lambda base_ref: ["docs/README.md", "src/garmin_sync/models.py"],
    )

    assert detect_ci_changes.main() == 0
    content = out_file.read_text(encoding="utf-8")
    assert "code_changed=true" in content
    assert "docs_only=false" in content


def test_main_pull_request_fail_safe_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import detect_ci_changes

    out_file = tmp_path / "output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "pull_request")
    monkeypatch.setattr(detect_ci_changes, "get_changed_files", lambda base_ref: [])

    assert detect_ci_changes.main() == 0
    content = out_file.read_text(encoding="utf-8")
    assert "code_changed=true" in content
    assert "docs_only=false" in content
