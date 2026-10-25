"""Decide whether a change can affect the engine simulations (ADR-0052 D-CI).

A file is engine-affecting when it is on the shared decision-affecting list, matches an
engine/simulation path rule, or is reachable in the import graph of the engine and
simulation entry points at the base *or* head commit. The base graph matters: a dependency
that a change deletes, moves or stops importing is no longer in the head graph, yet the
change still alters behaviour.

Classification is conservative. Whenever it is uncertain (a graph cannot be built, an
import cannot be resolved, an entry point is missing, or build/resolution configuration
changed) the result is "affected", so the simulations run. A change may skip them only on
a positive "not engine-affecting" result.
"""

from __future__ import annotations

import json
import posixpath
import re
import subprocess
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path

DECISION_LIST_PATH = "app/scripts/decision-affecting-files.json"

# Engine orchestration entry points (ADR-0052 D-CI) plus every module the simulation and
# judge scripts load directly through Vite's ssrLoadModule.
ENTRY_POINTS = (
    "app/src/engine/rules.ts",
    "app/src/engine/planner.ts",
    "app/src/engine/trainingIntent.ts",
    "app/src/engine/replay.ts",
    "app/src/engine/simulation/analyze.ts",
    "app/src/engine/simulation/scenarios.ts",
    "app/src/engine/simulation/deliveredDoseScenarios.ts",
    "app/src/engine/templates.ts",
    "app/src/engine/eventPresets.ts",
)

# Changes here alter module resolution, the build, the shared list or this gate itself, so
# no import graph can prove they are harmless.
UNCERTAIN_CONFIG_PATTERNS = (
    "app/tsconfig*.json",
    "app/package.json",
    "app/package-lock.json",
    "app/vite.config.*",
    "app/vitest*",
    DECISION_LIST_PATH,
    "scripts/detect_ci_changes.py",
    "scripts/engine_impact.py",
    ".github/workflows/ci.yml",
)

ENGINE_PATH_PATTERNS = (
    "app/src/engine/*",
    "app/src/knowledge/*",
    "app/scripts/ai-judge/*",
    "app/scripts/*simulat*",
    "app/scripts/*scenario*",
    "app/scripts/*judge*",
    "app/scripts/*persona*",
    "docs/analysis/simulation-baseline.json",
    "docs/analysis/*judge*.json",
)

CODE_EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs")
RESOLUTION_SUFFIXES = (
    "",
    ".ts",
    ".tsx",
    ".mts",
    ".js",
    ".mjs",
    ".json",
    "/index.ts",
    "/index.tsx",
    "/index.js",
)

_STATIC_IMPORT = re.compile(
    r"""(?:^|[\s;{}()])(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]"""
)
_SIDE_EFFECT_IMPORT = re.compile(r"""(?:^|[\s;{}()])import\s*['"]([^'"\n]+)['"]""")
_CALL_IMPORT = re.compile(r"""(?<![.\w$])(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)""")
# A dynamic import whose argument is not a plain string literal, or a Vite glob import,
# loads modules no static walk can name, so it makes the graph uncertain. Only expression
# positions count, so a method *named* import (`async import(userId) {`) is not one.
_OPAQUE_IMPORT = re.compile(
    r"""(?:\bawait|\breturn|[=(,:?&|!>\[])\s*(?:import|require)\s*\((?!\s*['"][^'"\n]+['"]\s*\))"""
    r"""|\bimport\.meta\.glob"""
)


class GraphError(RuntimeError):
    """The import graph could not be built, so classification is uncertain."""


@dataclass(frozen=True)
class EngineImpact:
    """Whether the engine simulations must run, and why."""

    affected: bool
    reasons: tuple[str, ...]


@dataclass
class ImportGraph:
    """Files reachable from the entry points, plus imports that could not be resolved."""

    reachable: set[str] = field(default_factory=set)
    unresolved: list[str] = field(default_factory=list)


def strip_comments(source: str) -> str:
    """Remove // and /* */ comments while leaving string and template literals intact."""
    out: list[str] = []
    i, length = 0, len(source)
    while i < length:
        char = source[i]
        nxt = source[i + 1] if i + 1 < length else ""
        if char in "'\"`":
            end = _string_end(source, i)
            out.append(source[i:end])
            i = end
        elif char == "/" and nxt == "/":
            newline = source.find("\n", i)
            i = length if newline == -1 else newline
        elif char == "/" and nxt == "*":
            close = source.find("*/", i + 2)
            i = length if close == -1 else close + 2
            out.append(" ")
        else:
            out.append(char)
            i += 1
    return "".join(out)


def _string_end(source: str, start: int) -> int:
    quote = source[start]
    i = start + 1
    while i < len(source):
        if source[i] == "\\":
            i += 2
            continue
        if source[i] == quote or (quote != "`" and source[i] == "\n"):
            return i + 1
        i += 1
    return len(source)


def extract_specifiers(source: str) -> tuple[list[str], int]:
    """Return the specifiers a TS/JS source imports, plus its count of opaque imports."""
    code = strip_comments(source)
    found: list[str] = []
    for pattern in (_STATIC_IMPORT, _SIDE_EFFECT_IMPORT, _CALL_IMPORT):
        found.extend(match.group(1) for match in pattern.finditer(code))
    return found, len(_OPAQUE_IMPORT.findall(code))


def resolve_specifier(importer: str, specifier: str, files: set[str]) -> str | None:
    """Resolve a specifier to a repository path, "" for a package, or None if unresolved."""
    spec = specifier.split("?", 1)[0]
    if spec.startswith("/src/"):
        base = "app" + spec
    elif spec.startswith("."):
        base = posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))
    else:
        return ""
    candidates = [base + suffix for suffix in RESOLUTION_SUFFIXES]
    if base.endswith(".js"):
        candidates.insert(0, base[:-3] + ".ts")
    return next((candidate for candidate in candidates if candidate in files), None)


class GitTree:
    """Read one commit's file list and blob contents through a single git process."""

    def __init__(self, ref: str, cwd: str | Path | None = None) -> None:
        self.ref = ref
        self.cwd = cwd
        listing = _git(["ls-tree", "-r", "--name-only", ref], cwd)
        self.files = {line for line in listing.splitlines() if line}
        self._batch: subprocess.Popen[bytes] | None = None

    def read(self, path: str) -> str:
        if self._batch is None:
            self._batch = subprocess.Popen(
                ["git", "cat-file", "--batch"],
                cwd=self.cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
            )
        assert self._batch.stdin is not None and self._batch.stdout is not None
        self._batch.stdin.write(f"{self.ref}:{path}\n".encode())
        self._batch.stdin.flush()
        header = self._batch.stdout.readline().decode().split()
        if len(header) != 3:
            raise GraphError(f"cannot read {path} at {self.ref}")
        content = self._batch.stdout.read(int(header[2]))
        self._batch.stdout.read(1)
        return content.decode("utf-8", errors="replace")

    def close(self) -> None:
        if self._batch is not None:
            if self._batch.stdin is not None:
                self._batch.stdin.close()
            self._batch.wait()
            self._batch = None


def build_graph(tree: GitTree, entry_points: Iterable[str] = ENTRY_POINTS) -> ImportGraph:
    """Walk the import graph of ``entry_points`` within ``tree``."""
    graph = ImportGraph()
    queue: deque[str] = deque()
    for entry in entry_points:
        if entry not in tree.files:
            raise GraphError(f"entry point {entry} is missing at {tree.ref}")
        queue.append(entry)
    while queue:
        path = queue.popleft()
        if path in graph.reachable:
            continue
        graph.reachable.add(path)
        if not path.endswith(CODE_EXTENSIONS):
            continue
        specifiers, opaque = extract_specifiers(tree.read(path))
        if opaque:
            graph.unresolved.append(f"{path} -> {opaque} non-literal dynamic import(s)")
        for specifier in specifiers:
            target = resolve_specifier(path, specifier, tree.files)
            if target is None:
                graph.unresolved.append(f"{path} -> {specifier}")
            elif target and target not in graph.reachable:
                queue.append(target)
    return graph


def load_decision_list(tree: GitTree) -> tuple[set[str], tuple[str, ...]]:
    """Return the shared decision-affecting files and prefixes recorded at ``tree``."""
    if DECISION_LIST_PATH not in tree.files:
        raise GraphError(f"{DECISION_LIST_PATH} is missing at {tree.ref}")
    data = json.loads(tree.read(DECISION_LIST_PATH))
    files = {entry["path"] for entry in data["files"]}
    prefixes = tuple(entry["path"] for entry in data["prefixes"])
    return files, prefixes


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatchcase(path, pattern) for pattern in patterns)


def _rule_reasons(changed: list[str], decision: tuple[set[str], tuple[str, ...]]) -> list[str]:
    files, prefixes = decision
    reasons: list[str] = []
    for path in changed:
        if path in files or path.startswith(prefixes):
            reasons.append(f"{path}: on the shared decision-affecting list")
        elif _matches(path, ENGINE_PATH_PATTERNS):
            reasons.append(f"{path}: engine/simulation path rule")
    return reasons


def classify(changed: list[str], base: GitTree, head: GitTree) -> EngineImpact:
    """Classify ``changed`` paths between the ``base`` and ``head`` trees."""
    config = [path for path in changed if _matches(path, UNCERTAIN_CONFIG_PATTERNS)]
    if config:
        return EngineImpact(True, tuple(f"{path}: build/resolution config" for path in config))
    try:
        reasons = _rule_reasons(changed, load_decision_list(head))
        if reasons:
            return EngineImpact(True, tuple(reasons))
        graphs = (build_graph(base), build_graph(head))
    except (GraphError, KeyError, ValueError) as error:
        return EngineImpact(True, (f"uncertain: {error}",))
    unresolved = [item for graph in graphs for item in graph.unresolved]
    if unresolved:
        return EngineImpact(True, tuple(f"uncertain: unresolved import {u}" for u in unresolved))
    hits = [path for path in changed if any(path in graph.reachable for graph in graphs)]
    if hits:
        return EngineImpact(True, tuple(f"{path}: in the engine import graph" for path in hits))
    return EngineImpact(False, ("no changed file is engine-affecting",))


def changed_between(base_ref: str, head_ref: str, cwd: str | Path | None = None) -> list[str]:
    """List changed paths, reporting both sides of a rename."""
    output = _git(["diff", "--name-only", "--no-renames", base_ref, head_ref], cwd)
    return [line for line in output.splitlines() if line]


def assess(base_ref: str, head_ref: str, cwd: str | Path | None = None) -> EngineImpact:
    """Classify the change from ``base_ref`` to ``head_ref``, failing safe on git errors."""
    try:
        changed = changed_between(base_ref, head_ref, cwd)
        base, head = GitTree(base_ref, cwd), GitTree(head_ref, cwd)
    except GraphError as error:
        return EngineImpact(True, (f"uncertain: {error}",))
    if not changed:
        return EngineImpact(True, ("uncertain: no changed files detected",))
    try:
        return classify(changed, base, head)
    finally:
        base.close()
        head.close()


def _git(args: list[str], cwd: str | Path | None) -> str:
    completed = subprocess.run(["git", *args], cwd=cwd, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "unknown error"
        raise GraphError(f"git {' '.join(args)} failed: {detail}")
    return completed.stdout
