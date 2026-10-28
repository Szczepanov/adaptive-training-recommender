from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from agent_eval import (
    CorpusError,
    create_result_template,
    find_case,
    grade_worktree,
    load_and_validate_corpus,
    validate_result,
)


def test_checked_in_agent_eval_corpus_is_valid() -> None:
    corpus = load_and_validate_corpus()
    cases = corpus["cases"]

    assert len(cases) >= 6
    assert find_case(corpus, "external-library-version-routing")["kind"] == "capability"
    assert find_case(corpus, "constructor-signature-cross-boundary")["kind"] == "regression"


def test_context7_routing_corpus_is_balanced() -> None:
    corpus = load_and_validate_corpus()

    expectations: set[str] = set()
    for case in corpus["cases"]:
        for tool in case["tool_expectations"]:
            if tool["capability"] == "context7":
                expectations.add(tool["expectation"])

    assert "required" in expectations
    assert "not_expected" in expectations


def test_semantic_navigation_routing_corpus_has_required_and_negative_cases() -> None:
    corpus = load_and_validate_corpus()

    expectations: dict[str, set[str]] = {"canopy": set(), "jev": set()}
    for case in corpus["cases"]:
        for tool in case["tool_expectations"]:
            capability = tool["capability"]
            if capability in expectations:
                expectations[capability].add(tool["expectation"])

    assert "required" in expectations["canopy"]
    assert "not_expected" in expectations["canopy"]
    assert "required" in expectations["jev"]
    assert "not_expected" in expectations["jev"]


def test_result_template_round_trips_validation() -> None:
    corpus = load_and_validate_corpus()
    result = create_result_template(
        "constructor-signature-cross-boundary",
        "codex",
        "gpt-example",
    )

    validate_result(result, corpus)


def test_duplicate_case_ids_are_rejected(tmp_path: Path) -> None:
    corpus = load_and_validate_corpus()
    duplicate = json.loads(json.dumps(corpus))
    duplicate["cases"].append(duplicate["cases"][0])
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(duplicate), encoding="utf-8")

    with pytest.raises(CorpusError, match="case ids must be unique"):
        load_and_validate_corpus(path)


def test_grade_worktree_executes_commands_without_shell_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], Any]] = []

    def dummy_run(args: list[str], cwd: Path, check: bool = False, **kwargs: Any) -> Any:
        shell_arg = kwargs.get("shell")
        calls.append((args, shell_arg))

        class DummyCompleted:
            returncode = 0

        return DummyCompleted()

    monkeypatch.setattr("agent_eval.subprocess.run", dummy_run)
    monkeypatch.setattr("agent_eval._changed_files", lambda base_ref: [])

    case = {
        "grader": {
            "commands": ["uv run pytest", "echo 'hello world'"],
            "forbidden_modified_globs": [],
        }
    }

    result = grade_worktree(case, "main")

    assert result["deterministic_pass"] is True
    assert calls == [
        (["uv", "run", "pytest"], None),
        (["echo", "hello world"], None),
    ]
