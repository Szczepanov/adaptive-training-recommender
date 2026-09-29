from __future__ import annotations

import argparse
from pathlib import Path

import pytest

from agent_canopy import (
    Worktree,
    baseline_query_lock,
    build_canopy_command,
    find_baseline_worktree,
    parse_worktree_porcelain,
)


def _make_index(worktree: Path) -> None:
    canopy = worktree / ".canopy"
    canopy.mkdir(parents=True)
    (canopy / "canopy.toml").write_text('[indexing]\nlast_sha = "abc"\n', encoding="utf-8")
    (canopy / "store.redb").write_bytes(b"store")
    (canopy / "vectors.idx").write_bytes(b"vectors")
    (canopy / "vectors.idx.chunks.usearch").write_bytes(b"hnsw")


def test_parse_worktree_porcelain_preserves_paths_and_branches() -> None:
    records = parse_worktree_porcelain(
        "worktree C:/repo with spaces\n"
        "HEAD abcdef\n"
        "branch refs/heads/main\n"
        "\n"
        "worktree C:/agent\n"
        "HEAD 123456\n"
        "branch refs/heads/feature\n"
        "\n"
    )

    assert records == [
        Worktree(Path("C:/repo with spaces"), "abcdef", "refs/heads/main"),
        Worktree(Path("C:/agent"), "123456", "refs/heads/feature"),
    ]


def test_find_baseline_prefers_existing_main_index(tmp_path: Path) -> None:
    main = tmp_path / "main"
    feature = tmp_path / "feature"
    main.mkdir()
    feature.mkdir()
    _make_index(main)

    baseline, reason = find_baseline_worktree(
        feature,
        worktrees=[
            Worktree(feature, "feature-sha", "refs/heads/feature"),
            Worktree(main, "main-sha", "refs/heads/main"),
        ],
    )

    assert baseline == main.resolve()
    assert reason is None


def test_find_baseline_does_not_bootstrap_missing_main_index(tmp_path: Path) -> None:
    main = tmp_path / "main"
    feature = tmp_path / "feature"
    main.mkdir()
    feature.mkdir()

    baseline, reason = find_baseline_worktree(
        feature,
        worktrees=[
            Worktree(feature, "feature-sha", "refs/heads/feature"),
            Worktree(main, "main-sha", "refs/heads/main"),
        ],
    )

    assert baseline is None
    assert reason is not None
    assert "missing" in reason
    assert not (main / ".canopy").exists()


def test_find_baseline_rejects_missing_vector_sidecar(tmp_path: Path) -> None:
    main = tmp_path / "main"
    feature = tmp_path / "feature"
    main.mkdir()
    feature.mkdir()
    _make_index(main)
    (main / ".canopy" / "vectors.idx.chunks.usearch").unlink()

    baseline, reason = find_baseline_worktree(
        feature,
        worktrees=[
            Worktree(feature, "feature-sha", "refs/heads/feature"),
            Worktree(main, "main-sha", "refs/heads/main"),
        ],
    )

    assert baseline is None
    assert reason is not None
    assert "vectors.idx.chunks.usearch" in reason


def test_baseline_query_lock_serializes_consumers(tmp_path: Path) -> None:
    with baseline_query_lock(tmp_path):
        with pytest.raises(TimeoutError, match="Canopy baseline is busy"):
            with baseline_query_lock(tmp_path, timeout_seconds=0.01):
                pass

    with baseline_query_lock(tmp_path, timeout_seconds=0.01):
        pass


def test_explicit_baseline_requires_existing_index(tmp_path: Path) -> None:
    feature = tmp_path / "feature"
    baseline_dir = tmp_path / "baseline"
    feature.mkdir()
    baseline_dir.mkdir()

    baseline, reason = find_baseline_worktree(
        feature,
        explicit=str(baseline_dir),
        worktrees=[],
    )

    assert baseline is None
    assert reason is not None
    assert ".canopy/canopy.toml" in reason.replace("\\", "/")


def test_read_only_command_surface() -> None:
    search = argparse.Namespace(
        command="search",
        query="where is allocation preservation implemented",
        max_results=15,
        path_filter="app/src/engine/**",
    )
    mapping = argparse.Namespace(command="map", symbol="ContextBriefService")
    trace = argparse.Namespace(
        command="trace",
        from_symbol="generateWeekAheadPlan",
        to_symbol="resolveTimeCapDoseAdjustment",
    )

    assert build_canopy_command(search) == [
        "canopy",
        "search",
        "where is allocation preservation implemented",
        "--max-results",
        "15",
        "--path",
        "app/src/engine/**",
    ]
    assert build_canopy_command(mapping) == ["canopy", "map", "ContextBriefService"]
    assert build_canopy_command(trace) == [
        "canopy",
        "trace",
        "generateWeekAheadPlan",
        "resolveTimeCapDoseAdjustment",
    ]
