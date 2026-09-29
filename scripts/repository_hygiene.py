from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, NotRequired, Sequence, TypedDict

ROOT = Path(__file__).resolve().parents[1]
PLAN_DIR = "docs/plans/"
PLAN_INDEX = "docs/plans/README.md"
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
SOURCE_PREFIXES = ("app/src/", "src/garmin_sync/")
TOOLING_PREFIXES = ("scripts/", "app/scripts/")
TEST_MARKERS = (".test.", ".spec.", ".pw.", ".perf.test.")

KNIP_VERSION = "6.38.0"
DEPENDENCY_CRUISER_VERSION = "18.4.0"
JSCPD_VERSION = "5.3.1"
VULTURE_VERSION = "2.16"

_PLAN_REF_RE = re.compile(r"\]\(\./([^)]+\.md)\)")


class FileMetric(TypedDict):
    path: str
    bytes: int
    lines: int
    kind: str
    commits: NotRequired[int | None]


class ToolResult(TypedDict):
    name: str
    command: list[str]
    cwd: str
    returncode: int
    allowedReturncodes: list[int]
    ok: bool


def run_git(root: Path, args: Sequence[str]) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def tracked_paths(root: Path) -> list[str]:
    return sorted(path for path in run_git(root, ["ls-files", "-z"]).split("\0") if path)


def parse_plan_references(index_text: str) -> set[str]:
    return {f"{PLAN_DIR}{match}" for match in _PLAN_REF_RE.findall(index_text)}


def find_plan_index_gaps(paths: Iterable[str], index_text: str) -> tuple[list[str], list[str]]:
    tracked = set(paths)
    plans = {
        path
        for path in tracked
        if path.startswith(PLAN_DIR) and path.endswith(".md") and path != PLAN_INDEX
    }
    referenced = parse_plan_references(index_text)
    return sorted(plans - referenced), sorted(referenced - tracked)


def classify_tracked_path(path: str) -> str:
    lowered = path.lower()
    if (
        path.startswith("tests/")
        or "/tests/" in path
        or "/__tests__/" in path
        or any(marker in lowered for marker in TEST_MARKERS)
    ):
        return "test"
    if path.startswith(SOURCE_PREFIXES) and Path(path).suffix.lower() in SOURCE_SUFFIXES:
        return "production_source"
    if path.startswith(TOOLING_PREFIXES) and Path(path).suffix.lower() in SOURCE_SUFFIXES:
        return "tooling_source"
    if path.startswith("docs/"):
        return "docs"
    return "other"


def status_signal(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
    for line in text.splitlines():
        if match := _STATUS_RE.match(line):
            return match.group(1).strip() or None
    return None


def line_count(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return sum(1 for _ in handle)
    except UnicodeDecodeError:
        return 0


def commit_count(root: Path, relative_path: str) -> int | None:
    try:
        raw = run_git(root, ["rev-list", "--count", "HEAD", "--", relative_path]).strip()
        return int(raw) if raw else 0
    except (subprocess.CalledProcessError, ValueError):
        return None


def duplicate_groups(root: Path, paths: Iterable[str]) -> list[list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for relative in paths:
        path = root / relative
        if not path.is_file() or path.stat().st_size == 0:
            continue
        groups[hashlib.sha256(path.read_bytes()).hexdigest()].append(relative)
    return sorted(
        (sorted(group) for group in groups.values() if len(group) > 1),
        key=lambda group: (-len(group), group),
    )


def file_metric(root: Path, relative: str, kind: str) -> FileMetric:
    path = root / relative
    return {
        "path": relative,
        "bytes": path.stat().st_size,
        "lines": line_count(path),
        "kind": kind,
    }


def build_inventory(root: Path) -> dict[str, object]:
    paths = tracked_paths(root)
    index_text = (root / PLAN_INDEX).read_text(encoding="utf-8")
    unindexed, missing = find_plan_index_gaps(paths, index_text)

    metrics: list[FileMetric] = [
        file_metric(root, path, kind)
        for path in paths
        if (kind := classify_tracked_path(path))
        in {"production_source", "tooling_source", "test"}
    ]
    production = sorted(
        (item for item in metrics if item["kind"] == "production_source"),
        key=lambda item: (-item["lines"], -item["bytes"], item["path"]),
    )
    tooling = sorted(
        (item for item in metrics if item["kind"] == "tooling_source"),
        key=lambda item: (-item["lines"], -item["bytes"], item["path"]),
    )
    tests = sorted(
        (item for item in metrics if item["kind"] == "test"),
        key=lambda item: (-item["lines"], -item["bytes"], item["path"]),
    )

    hotspots: list[FileMetric] = []
    for item in production[:12]:
        enriched: FileMetric = {
            **item,
            "commits": commit_count(root, item["path"]),
        }
        hotspots.append(enriched)
    hotspots.sort(
        key=lambda item: (
            -item["lines"] * int(item.get("commits") or 0),
            -item["lines"],
            item["path"],
        )
    )

    return {
        "gitHead": run_git(root, ["rev-parse", "HEAD"]).strip(),
        "trackedFileCount": len(paths),
        "topLevelFileCounts": dict(
            sorted(Counter(path.split("/", 1)[0] for path in paths).items())
        ),
        "documentation": {
            "docsFileCount": sum(path.startswith("docs/") for path in paths),
            "analysisFileCount": sum(path.startswith("docs/analysis/") for path in paths),
            "planMarkdownCount": sum(
                path.startswith(PLAN_DIR) and path.endswith(".md") for path in paths
            ),
            "unindexedPlanCount": len(unindexed),
            "unindexedPlans": [
                {"path": path, "status": status_signal(root / path)} for path in unindexed
            ],
            "missingPlanReferences": missing,
        },
        "source": {
            "productionFileCount": len(production),
            "toolingFileCount": len(tooling),
            "testFileCount": len(tests),
            "largestProductionFiles": production[:20],
            "largestToolingFiles": tooling[:20],
            "largestTestFiles": tests[:20],
            "largeFileHotspots": hotspots,
        },
        "exactDuplicateTrackedFiles": duplicate_groups(root, paths),
        "externalToolVersions": {
            "knip": KNIP_VERSION,
            "dependency-cruiser": DEPENDENCY_CRUISER_VERSION,
            "jscpd": JSCPD_VERSION,
            "vulture": VULTURE_VERSION,
        },
    }


def render_markdown(inventory: dict[str, object]) -> str:
    docs = inventory["documentation"]
    source = inventory["source"]
    assert isinstance(docs, dict) and isinstance(source, dict)
    lines = [
        "# Repository hygiene inventory",
        "",
        f"Git head: `{inventory['gitHead']}`",
        "",
        "## Scope",
        "",
        f"- Tracked files: **{inventory['trackedFileCount']}**",
        f"- Documentation files: **{docs['docsFileCount']}**",
        f"- Analysis files: **{docs['analysisFileCount']}**",
        f"- Plan Markdown files: **{docs['planMarkdownCount']}**",
        f"- Unindexed plan files: **{docs['unindexedPlanCount']}**",
        f"- Production source files: **{source['productionFileCount']}**",
        f"- Tooling source files: **{source['toolingFileCount']}**",
        f"- Test files: **{source['testFileCount']}**",
        "",
        "## Unindexed plan files",
        "",
    ]
    plans = docs["unindexedPlans"]
    assert isinstance(plans, list)
    if plans:
        lines.extend(["| Path | Declared status |", "|---|---|"])
        for item in plans:
            assert isinstance(item, dict)
            lines.append(f"| `{item['path']}` | {item.get('status') or 'not detected'} |")
    else:
        lines.append("None.")

    lines.extend(
        [
            "",
            "## Large/high-churn production hotspots",
            "",
            "| Path | Lines | Bytes | Commits |",
            "|---|---:|---:|---:|",
        ]
    )
    hotspots = source["largeFileHotspots"]
    assert isinstance(hotspots, list)
    for item in hotspots:
        assert isinstance(item, dict)
        lines.append(
            f"| `{item['path']}` | {item['lines']} | {item['bytes']} | "
            f"{item.get('commits') if item.get('commits') is not None else 'n/a'} |"
        )
    duplicates = inventory["exactDuplicateTrackedFiles"]
    assert isinstance(duplicates, list)
    lines.extend(
        [
            "",
            "## Exact duplicate tracked files",
            "",
            f"Groups: **{len(duplicates)}**",
            "",
            "This is evidence, not a deletion list. Verify runtime/config entry points, "
            "compatibility obligations, and durable test coverage before removing anything.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_inventory(root: Path, inventory: dict[str, object]) -> None:
    report_dir = root / "artifacts" / "hygiene"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "inventory.json").write_text(
        json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (report_dir / "summary.md").write_text(render_markdown(inventory), encoding="utf-8")


def run_tool(
    root: Path,
    name: str,
    command: Sequence[str],
    cwd: Path,
    allowed: set[int],
) -> ToolResult:
    report_dir = root / "artifacts" / "hygiene" / "tools"
    report_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = report_dir / f"{name}.stdout.txt"
    stderr_path = report_dir / f"{name}.stderr.txt"
    try:
        result = subprocess.run(
            list(command),
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            timeout=900,
        )
        stdout_path.write_text(result.stdout, encoding="utf-8")
        stderr_path.write_text(result.stderr, encoding="utf-8")
        return {
            "name": name,
            "command": list(command),
            "cwd": str(cwd.relative_to(root)),
            "returncode": result.returncode,
            "allowedReturncodes": sorted(allowed),
            "ok": result.returncode in allowed,
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        stderr_path.write_text(f"{type(exc).__name__}: {exc}\n", encoding="utf-8")
        return {
            "name": name,
            "command": list(command),
            "cwd": str(cwd.relative_to(root)),
            "returncode": 127,
            "allowedReturncodes": sorted(allowed),
            "ok": False,
        }


def run_external_tools(root: Path) -> list[ToolResult]:
    app = root / "app"
    specs: list[tuple[str, list[str], Path, set[int]]] = [
        (
            "knip-default",
            [
                "npx",
                "--yes",
                f"knip@{KNIP_VERSION}",
                "--reporter",
                "json",
                "--no-exit-code",
            ],
            app,
            {0},
        ),
        (
            "knip-production",
            [
                "npx",
                "--yes",
                f"knip@{KNIP_VERSION}",
                "--config",
                "knip.production.json",
                "--production",
                "--reporter",
                "json",
                "--no-exit-code",
            ],
            app,
            {0},
        ),
        (
            "dependency-cruiser",
            [
                "npx",
                "--yes",
                f"dependency-cruiser@{DEPENDENCY_CRUISER_VERSION}",
                "--config",
                ".dependency-cruiser.cjs",
                "--output-type",
                "json",
                "src",
            ],
            app,
            {0},
        ),
        (
            "jscpd",
            [
                "npx",
                "--yes",
                f"jscpd@{JSCPD_VERSION}",
                "--config",
                ".jscpd.json",
            ],
            root,
            {0},
        ),
        (
            "vulture-all",
            [
                "uvx",
                "--from",
                f"vulture=={VULTURE_VERSION}",
                "vulture",
                "src/garmin_sync",
                "scripts",
                "tests",
                "--min-confidence",
                "100",
                "--sort-by-size",
            ],
            root,
            {0, 3},
        ),
        (
            "vulture-production",
            [
                "uvx",
                "--from",
                f"vulture=={VULTURE_VERSION}",
                "vulture",
                "src/garmin_sync",
                "scripts",
                "--min-confidence",
                "100",
                "--sort-by-size",
            ],
            root,
            {0, 3},
        ),
    ]
    return [run_tool(root, name, command, cwd, allowed) for name, command, cwd, allowed in specs]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate non-destructive repository hygiene reports."
    )
    parser.add_argument(
        "--external", action="store_true", help="Run pinned external analyzers too."
    )
    args = parser.parse_args(argv)

    inventory = build_inventory(ROOT)
    write_inventory(ROOT, inventory)
    docs = inventory["documentation"]
    assert isinstance(docs, dict)
    print(f"[hygiene] inventory written; unindexed plans: {docs['unindexedPlanCount']}")
    if not args.external:
        return 0

    runs = run_external_tools(ROOT)
    manifest = ROOT / "artifacts" / "hygiene" / "tools.json"
    manifest.write_text(json.dumps(runs, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for run in runs:
        status = "ok" if run["ok"] else "FAILED"
        print(f"[hygiene] {status:>6} {run['name']}: exit {run['returncode']}")
    if any(not run["ok"] for run in runs):
        print(
            "[hygiene] external tool execution failed; inspect artifacts/hygiene/tools/",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
