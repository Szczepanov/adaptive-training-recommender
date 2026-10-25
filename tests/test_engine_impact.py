"""Unit tests for the ADR-0052 D-CI engine-simulation trigger (scripts/engine_impact.py).

Every repository here is a synthetic git repo built in ``tmp_path``.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from engine_impact import (
    ENTRY_POINTS,
    GitTree,
    assess,
    classify,
    extract_specifiers,
    resolve_specifier,
)

DECISION_LIST = {
    "files": [{"path": "app/src/workouts/event-plan.ts"}],
    "prefixes": [{"path": "app/src/workouts/catalog/"}],
}

BASE_FILES = {
    "app/scripts/decision-affecting-files.json": json.dumps(DECISION_LIST),
    "app/src/engine/rules.ts": "import { flag } from '../derived/flags';\nexport const r = flag;\n",
    "app/src/derived/flags.ts": (
        "import { helper } from '../legacy/helper';\nexport const flag = helper;\n"
    ),
    "app/src/legacy/helper.ts": "export const helper = 1;\n",
    "app/src/workouts/event-plan.ts": "export const plan = 1;\n",
    "app/src/components/Home.tsx": (
        "import { flag } from '../derived/flags';\nexport const Home = flag;\n"
    ),
    "app/src/components/Banner.tsx": "export const Banner = 'banner';\n",
    "app/package.json": "{}\n",
    "src/garmin_sync/sync.py": "VALUE = 1\n",
}


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _write(repo: Path, files: dict[str, str | None]) -> None:
    for path, content in files.items():
        target = repo / path
        if content is None:
            target.unlink()
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")


def _commit(repo: Path, files: dict[str, str | None]) -> str:
    _write(repo, files)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "change")
    return _git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Iterator[Path]:
    _git(tmp_path, "init", "-q")
    stubs: dict[str, str | None] = {entry: "export const stub = 1;\n" for entry in ENTRY_POINTS[1:]}
    _commit(tmp_path, {**BASE_FILES, **stubs})
    yield tmp_path


def _assess_change(repo: Path, files: dict[str, str | None]) -> tuple[bool, str]:
    base = _git(repo, "rev-parse", "HEAD")
    head = _commit(repo, files)
    impact = assess(base, head, cwd=repo)
    return impact.affected, " | ".join(impact.reasons)


def test_ui_only_change_skips_simulations(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo, {"app/src/components/Banner.tsx": "export const B = 2;\n"}
    )
    assert not affected, reasons


def test_python_only_change_skips_simulations(repo: Path) -> None:
    affected, reasons = _assess_change(repo, {"src/garmin_sync/sync.py": "VALUE = 2\n"})
    assert not affected, reasons


def test_extracted_module_outside_engine_is_affected(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo, {"app/src/derived/flags.ts": "export const flag = 2;\n"}
    )
    assert affected
    assert "app/src/derived/flags.ts: in the engine import graph" in reasons


def test_shared_workout_input_on_decision_list_is_affected(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo, {"app/src/workouts/event-plan.ts": "export const plan = 2;\n"}
    )
    assert affected
    assert "on the shared decision-affecting list" in reasons


def test_catalog_prefix_is_affected(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo, {"app/src/workouts/catalog/strength.ts": "export const w = 1;\n"}
    )
    assert affected
    assert "decision-affecting list" in reasons


def test_dependency_reachable_only_at_base_is_affected(repo: Path) -> None:
    base_ref = _git(repo, "rev-parse", "HEAD")
    head_ref = _commit(
        repo,
        {"app/src/derived/flags.ts": "export const flag = 1;\n", "app/src/legacy/helper.ts": None},
    )
    base, head = GitTree(base_ref, repo), GitTree(head_ref, repo)
    try:
        # Only the deleted file: the head graph no longer reaches it, the base graph does.
        impact = classify(["app/src/legacy/helper.ts"], base, head)
    finally:
        base.close()
        head.close()
    assert impact.affected
    assert impact.reasons == ("app/src/legacy/helper.ts: in the engine import graph",)


def test_unresolved_import_is_uncertain(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo,
        {"app/src/derived/flags.ts": "import { x } from './missing';\nexport const flag = x;\n"},
    )
    assert affected
    assert reasons.startswith("uncertain: unresolved import app/src/derived/flags.ts -> ./missing")


def test_non_literal_dynamic_import_is_uncertain(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo,
        {"app/src/derived/flags.ts": "export const load = (n: string) => import(`./${n}`);\n"},
    )
    assert affected
    assert "non-literal dynamic import" in reasons


def test_build_config_change_is_uncertain(repo: Path) -> None:
    affected, reasons = _assess_change(repo, {"app/package.json": '{"name": "x"}\n'})
    assert affected
    assert "app/package.json: build/resolution config" in reasons


def test_missing_entry_point_is_uncertain(repo: Path) -> None:
    affected, reasons = _assess_change(
        repo, {"app/src/engine/replay.ts": None, "app/src/components/Banner.tsx": "x\n"}
    )
    assert affected  # replay.ts is also an engine path; the rule fires before the graph
    assert "app/src/engine/replay.ts" in reasons


def test_unreadable_base_fails_safe(repo: Path) -> None:
    impact = assess("0" * 40, "HEAD", cwd=repo)
    assert impact.affected
    assert impact.reasons[0].startswith("uncertain:")


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import { a,\n  b, // don't drop me\n} from './multi';", ["./multi"]),
        ("import type { T } from '../types';", ["../types"]),
        ("export * from './barrel';\nexport { x } from \"./named\";", ["./barrel", "./named"]),
        ("import './side-effect.css';", ["./side-effect.css"]),
        ("const m = await import('./lazy');", ["./lazy"]),
        ("// import { no } from './commented';\n/* import './block'; */", []),
        ("const url = 'https://example.invalid/x'; import { y } from './after';", ["./after"]),
        ("class S { async import(userId: string) { return userId; } }", []),
        ("service.import('./not-a-module');", []),
    ],
)
def test_extract_specifiers(source: str, expected: list[str]) -> None:
    specifiers, opaque = extract_specifiers(source)
    assert sorted(specifiers) == sorted(expected)
    assert opaque == 0


@pytest.mark.parametrize(
    "source",
    [
        "const m = await import(name);",
        "return import(`./${n}`);",
        "const load = (n) => import(n);",
        "const mods = [import(a)];",
        "import.meta.glob('./*.ts');",
    ],
)
def test_extract_specifiers_flags_opaque_imports(source: str) -> None:
    assert extract_specifiers(source)[1] >= 1


@pytest.mark.parametrize(
    ("specifier", "expected"),
    [
        ("./flags", "app/src/derived/flags.ts"),
        ("./flags.js", "app/src/derived/flags.ts"),
        ("../workouts", "app/src/workouts/index.ts"),
        ("/src/derived/flags.ts", "app/src/derived/flags.ts"),
        ("./data.json?raw", "app/src/derived/data.json"),
        ("react", ""),
        ("./missing", None),
    ],
)
def test_resolve_specifier(specifier: str, expected: str | None) -> None:
    files = {
        "app/src/derived/flags.ts",
        "app/src/derived/data.json",
        "app/src/workouts/index.ts",
    }
    assert resolve_specifier("app/src/derived/x.ts", specifier, files) == expected


def test_shared_decision_list_paths_exist() -> None:
    root = Path(__file__).resolve().parents[1]
    data = json.loads((root / "app/scripts/decision-affecting-files.json").read_text("utf-8"))
    missing = [e["path"] for e in data["files"] if not (root / e["path"]).is_file()]
    missing += [e["path"] for e in data["prefixes"] if not (root / e["path"]).is_dir()]
    assert missing == []
