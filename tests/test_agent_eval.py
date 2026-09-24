from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent_eval import (
    CorpusError,
    create_result_template,
    find_case,
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
