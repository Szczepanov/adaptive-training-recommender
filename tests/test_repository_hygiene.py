from pathlib import Path

import repository_hygiene as hygiene


def test_parse_plan_references_normalizes_plan_paths() -> None:
    text = """
    | [Current](./current.md) | In progress |
    prose [Historical](./nested/history.md)
    """
    assert hygiene.parse_plan_references(text) == {
        "docs/plans/current.md",
        "docs/plans/nested/history.md",
    }


def test_find_plan_index_gaps_reports_unindexed_and_missing() -> None:
    paths = [
        "docs/plans/README.md",
        "docs/plans/current.md",
        "docs/plans/orphan.md",
    ]
    index = "[Current](./current.md) [Missing](./missing.md)"

    unindexed, missing = hygiene.find_plan_index_gaps(paths, index)

    assert unindexed == ["docs/plans/orphan.md"]
    assert missing == ["docs/plans/missing.md"]


def test_classify_tracked_path_separates_tests_from_production() -> None:
    assert hygiene.classify_tracked_path("app/src/engine/planner.ts") == "production_source"
    assert hygiene.classify_tracked_path("app/src/engine/planner.test.ts") == "test"
    assert hygiene.classify_tracked_path("app/scripts/ai-judge/__tests__/runner.test.mjs") == "test"
    assert hygiene.classify_tracked_path("app/scripts/run-ai-judge.mjs") == "tooling_source"
    assert hygiene.classify_tracked_path("tests/test_sync_service.py") == "test"
    assert hygiene.classify_tracked_path("docs/README.md") == "docs"


def test_duplicate_groups_only_returns_nonempty_duplicates(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("same\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("same\n", encoding="utf-8")
    (tmp_path / "c.txt").write_text("different\n", encoding="utf-8")
    (tmp_path / "empty.txt").write_text("", encoding="utf-8")

    groups = hygiene.duplicate_groups(
        tmp_path, ["a.txt", "b.txt", "c.txt", "empty.txt"]
    )

    assert groups == [["a.txt", "b.txt"]]
