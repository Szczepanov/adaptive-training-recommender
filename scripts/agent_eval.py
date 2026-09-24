#!/usr/bin/env python3
"""Validate and grade the repository's coding-agent evaluation corpus."""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "agent-evals" / "cases.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ALLOWED_KINDS = {"capability", "regression"}
ALLOWED_EXPECTATIONS = {"required", "recommended", "optional", "not_expected"}
ALLOWED_RESULT_STATUSES = {"not_run", "pass", "partial", "fail", "blocked"}


class CorpusError(ValueError):
    """Raised when the checked-in coding-agent corpus is invalid."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CorpusError(f"Cannot read JSON from {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise CorpusError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], raw)


def _require_nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CorpusError(f"{label} must be a non-empty string")
    return value


def _require_string_list(value: Any, label: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        suffix = "a list" if allow_empty else "a non-empty list"
        raise CorpusError(f"{label} must be {suffix} of strings")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise CorpusError(f"{label} must contain only non-empty strings")
    return cast(list[str], value)


def _validate_case(case: Any, index: int) -> dict[str, Any]:
    if not isinstance(case, dict):
        raise CorpusError(f"cases[{index}] must be an object")
    typed = cast(dict[str, Any], case)

    case_id = _require_nonempty_string(typed.get("id"), f"cases[{index}].id")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", case_id):
        raise CorpusError(f"{case_id}: id must use lowercase kebab-case")

    kind = _require_nonempty_string(typed.get("kind"), f"{case_id}.kind")
    if kind not in ALLOWED_KINDS:
        raise CorpusError(f"{case_id}: kind must be one of {sorted(ALLOWED_KINDS)}")

    source = typed.get("source")
    if not isinstance(source, dict):
        raise CorpusError(f"{case_id}.source must be an object")
    source_typed = cast(dict[str, Any], source)
    _require_nonempty_string(source_typed.get("type"), f"{case_id}.source.type")
    _require_nonempty_string(source_typed.get("ref"), f"{case_id}.source.ref")

    start_ref = _require_nonempty_string(typed.get("start_ref"), f"{case_id}.start_ref")
    if not SHA_RE.fullmatch(start_ref):
        raise CorpusError(f"{case_id}.start_ref must be an immutable 40-character commit SHA")

    _require_nonempty_string(typed.get("prompt"), f"{case_id}.prompt")
    _require_string_list(typed.get("success_criteria"), f"{case_id}.success_criteria")

    grader = typed.get("grader")
    if not isinstance(grader, dict):
        raise CorpusError(f"{case_id}.grader must be an object")
    grader_typed = cast(dict[str, Any], grader)
    _require_string_list(
        grader_typed.get("commands"), f"{case_id}.grader.commands", allow_empty=True
    )
    _require_string_list(
        grader_typed.get("forbidden_modified_globs"),
        f"{case_id}.grader.forbidden_modified_globs",
        allow_empty=True,
    )

    expectations = typed.get("tool_expectations")
    if not isinstance(expectations, list) or not expectations:
        raise CorpusError(f"{case_id}.tool_expectations must be a non-empty list")
    seen_capabilities: set[str] = set()
    for expectation_index, expectation in enumerate(expectations):
        if not isinstance(expectation, dict):
            raise CorpusError(
                f"{case_id}.tool_expectations[{expectation_index}] must be an object"
            )
        expectation_typed = cast(dict[str, Any], expectation)
        capability = _require_nonempty_string(
            expectation_typed.get("capability"),
            f"{case_id}.tool_expectations[{expectation_index}].capability",
        )
        if capability in seen_capabilities:
            raise CorpusError(f"{case_id}: duplicate tool expectation for {capability}")
        seen_capabilities.add(capability)

        expected = _require_nonempty_string(
            expectation_typed.get("expectation"),
            f"{case_id}.tool_expectations[{expectation_index}].expectation",
        )
        if expected not in ALLOWED_EXPECTATIONS:
            raise CorpusError(
                f"{case_id}: expectation for {capability} must be one of "
                f"{sorted(ALLOWED_EXPECTATIONS)}"
            )
        _require_nonempty_string(
            expectation_typed.get("reason"),
            f"{case_id}.tool_expectations[{expectation_index}].reason",
        )

    return typed


def load_and_validate_corpus(path: Path = DEFAULT_CORPUS) -> dict[str, Any]:
    """Load the corpus and raise CorpusError on structural or semantic problems."""
    corpus = _load_json(path)
    if corpus.get("schema_version") != 1:
        raise CorpusError("schema_version must be 1")
    _require_nonempty_string(corpus.get("suite"), "suite")

    cases = corpus.get("cases")
    if not isinstance(cases, list) or not cases:
        raise CorpusError("cases must be a non-empty list")

    validated = [_validate_case(case, index) for index, case in enumerate(cases)]
    ids = [cast(str, case["id"]) for case in validated]
    if len(ids) != len(set(ids)):
        raise CorpusError("case ids must be unique")
    corpus["cases"] = validated
    return corpus


def find_case(corpus: dict[str, Any], case_id: str) -> dict[str, Any]:
    """Return one validated case by id."""
    for case in cast(list[dict[str, Any]], corpus["cases"]):
        if case["id"] == case_id:
            return case
    raise CorpusError(f"Unknown case id: {case_id}")


def _changed_files(base_ref: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", f"{base_ref}...HEAD"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise CorpusError(
            f"git diff failed for base {base_ref}: {completed.stderr.strip() or 'unknown error'}"
        )
    return [line.strip().replace("\\", "/") for line in completed.stdout.splitlines() if line.strip()]


def _forbidden_changes(case: dict[str, Any], changed_files: list[str]) -> list[str]:
    grader = cast(dict[str, Any], case["grader"])
    patterns = cast(list[str], grader["forbidden_modified_globs"])
    return [
        path
        for path in changed_files
        if any(fnmatch.fnmatch(path, pattern) for pattern in patterns)
    ]


def create_result_template(case_id: str, agent: str, model: str) -> dict[str, Any]:
    """Create a provider-neutral result document for one trial."""
    return {
        "schema_version": 1,
        "case_id": case_id,
        "agent": agent,
        "model": model,
        "created_at": datetime.now(UTC).isoformat(),
        "outcome": {"status": "not_run", "notes": ""},
        "commands": [],
        "tool_usage": [],
        "changed_files": [],
        "metrics": {
            "turns": None,
            "tool_calls": None,
            "input_tokens": None,
            "output_tokens": None,
            "elapsed_seconds": None,
        },
    }


def validate_result(result: dict[str, Any], corpus: dict[str, Any]) -> None:
    """Validate a trial-result document against the checked-in corpus."""
    if result.get("schema_version") != 1:
        raise CorpusError("result.schema_version must be 1")
    case_id = _require_nonempty_string(result.get("case_id"), "result.case_id")
    find_case(corpus, case_id)
    _require_nonempty_string(result.get("agent"), "result.agent")
    _require_nonempty_string(result.get("model"), "result.model")
    _require_nonempty_string(result.get("created_at"), "result.created_at")

    outcome = result.get("outcome")
    if not isinstance(outcome, dict):
        raise CorpusError("result.outcome must be an object")
    outcome_typed = cast(dict[str, Any], outcome)
    status = _require_nonempty_string(outcome_typed.get("status"), "result.outcome.status")
    if status not in ALLOWED_RESULT_STATUSES:
        raise CorpusError(
            f"result.outcome.status must be one of {sorted(ALLOWED_RESULT_STATUSES)}"
        )
    if not isinstance(outcome_typed.get("notes"), str):
        raise CorpusError("result.outcome.notes must be a string")

    commands = result.get("commands")
    if not isinstance(commands, list):
        raise CorpusError("result.commands must be a list")
    for index, command in enumerate(commands):
        if not isinstance(command, dict):
            raise CorpusError(f"result.commands[{index}] must be an object")
        command_typed = cast(dict[str, Any], command)
        _require_nonempty_string(command_typed.get("command"), f"result.commands[{index}].command")
        exit_code = command_typed.get("exit_code")
        if not isinstance(exit_code, int):
            raise CorpusError(f"result.commands[{index}].exit_code must be an integer")

    _require_string_list(result.get("tool_usage"), "result.tool_usage", allow_empty=True)
    _require_string_list(result.get("changed_files"), "result.changed_files", allow_empty=True)
    if not isinstance(result.get("metrics"), dict):
        raise CorpusError("result.metrics must be an object")


def grade_worktree(case: dict[str, Any], base_ref: str) -> dict[str, Any]:
    """Run deterministic graders against the current worktree and return a result fragment."""
    grader = cast(dict[str, Any], case["grader"])
    commands = cast(list[str], grader["commands"])
    command_results: list[dict[str, Any]] = []

    for command in commands:
        completed = subprocess.run(command, cwd=ROOT, shell=True, check=False)
        command_results.append({"command": command, "exit_code": completed.returncode})
        if completed.returncode != 0:
            break

    changed_files = _changed_files(base_ref)
    forbidden = _forbidden_changes(case, changed_files)
    commands_ok = all(result["exit_code"] == 0 for result in command_results)
    deterministic_pass = commands_ok and not forbidden

    return {
        "deterministic_pass": deterministic_pass,
        "commands": command_results,
        "changed_files": changed_files,
        "forbidden_changes": forbidden,
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("validate")
    subparsers.add_parser("list")

    show = subparsers.add_parser("show")
    show.add_argument("case_id")

    new_result = subparsers.add_parser("new-result")
    new_result.add_argument("--case", required=True, dest="case_id")
    new_result.add_argument("--agent", required=True)
    new_result.add_argument("--model", required=True)
    new_result.add_argument("--output", required=True, type=Path)

    validate_result_parser = subparsers.add_parser("validate-result")
    validate_result_parser.add_argument("result", type=Path)

    grade = subparsers.add_parser("grade-worktree")
    grade.add_argument("--case", required=True, dest="case_id")
    grade.add_argument("--base")
    grade.add_argument("--output", type=Path)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    args = _build_parser().parse_args(argv)

    try:
        corpus = load_and_validate_corpus(args.corpus)

        if args.command == "validate":
            print(f"Agent eval corpus OK: {len(cast(list[Any], corpus['cases']))} cases")
            return 0

        if args.command == "list":
            for case in cast(list[dict[str, Any]], corpus["cases"]):
                print(f"{case['id']}\t{case['kind']}\t{case['source']['ref']}")
            return 0

        if args.command == "show":
            print(json.dumps(find_case(corpus, args.case_id), indent=2))
            return 0

        if args.command == "new-result":
            find_case(corpus, args.case_id)
            result = create_result_template(args.case_id, args.agent, args.model)
            _write_json(args.output, result)
            print(args.output)
            return 0

        if args.command == "validate-result":
            result = _load_json(args.result)
            validate_result(result, corpus)
            print(f"Agent eval result OK: {result['case_id']}")
            return 0

        if args.command == "grade-worktree":
            case = find_case(corpus, args.case_id)
            base_ref = args.base or cast(str, case["start_ref"])
            grade_result = grade_worktree(case, base_ref)
            if args.output:
                _write_json(args.output, grade_result)
            print(json.dumps(grade_result, indent=2))
            return 0 if grade_result["deterministic_pass"] else 1

        raise CorpusError(f"Unsupported command: {args.command}")
    except CorpusError as exc:
        print(f"agent-eval error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
