# Repository hygiene audit

This procedure creates evidence for cleanup work without deleting code, tests, or documentation.
It is intentionally separate from `make verify`: existing hygiene debt must not make unrelated
feature PRs fail, and an analyzer finding is not proof that a file is safe to remove.

## Commands

From the repository root:

```bash
make hygiene
```

runs the deterministic, dependency-free inventory in `scripts/repository_hygiene.py`. It only
reads Git-tracked files and Git history and writes ignored reports under `artifacts/hygiene/`:

- `inventory.json` — machine-readable counts and candidates;
- `summary.md` — review-oriented summary;
- unindexed `docs/plans/*.md` files relative to the authoritative `docs/plans/README.md` board;
- largest runtime/tooling/test files and large-file churn hotspots;
- whether full Git history is available (shallow clones make churn counts lower bounds);
- byte-identical tracked-file groups.

For the full static-analysis pass:

```bash
make hygiene-tools
```

This runs the same inventory and then downloads/runs pinned CLI versions locally via `npx`/`uvx`:

| Tool | Purpose | How to interpret it |
|---|---|---|
| Knip | Unused TS/TSX files, exports and dependencies | Compare the normal scan with the production-only scan. Code kept alive only by tests is a review candidate, not automatic dead code. |
| dependency-cruiser | Dependency graph, cycles, orphans and layer-boundary drift | Rules are warnings in this first pass so existing architecture debt is visible without becoming a new merge gate. |
| jscpd | Token-level copy/paste duplication | Use clone groups to locate consolidation candidates; it does not prove semantic equivalence. |
| Vulture | Python unused/unreachable code | Both full-repository and runtime-package scans use `--min-confidence 100`; findings still require caller/config/dynamic-use review. |

Pinned versions live in `scripts/repository_hygiene.py`. Reports and tool stdout/stderr are written
under `artifacts/hygiene/`; the directory is gitignored.

`make hygiene-all` is an alias for the full `make hygiene-tools` scan.

## Why two Knip and Vulture views?

A normal static-analysis run includes tests and tooling. That is useful for finding code unused by
anything in the repository. A production-only Knip view answers a different question: which shipped
TS/TSX files or exports are reachable only from tests/tooling? Knip explicitly documents production
mode as complementary to the default run rather than a replacement for it. Vulture uses the same
comparison idea but calls the narrow scan `runtime`: it scans `src/garmin_sync/` only, while the
full scan also includes root scripts and tests.

## Review protocol for the cleanup PR

Treat every finding as a hypothesis. Before deleting or consolidating something:

1. Verify direct and indirect callers, runtime/config entry points, dynamic imports and persistence
   or compatibility obligations.
2. For documentation, transfer any durable current-state truth to `architecture/`, an ADR, `ops/`,
   or the `docs/plans/README.md` status board before removing a historical plan/review artifact.
3. For tests, identify the invariant they protect. Remove a test only when the invariant is
   duplicated, the behavior is intentionally retired, or stronger coverage demonstrably subsumes it.
4. For compatibility/legacy code, prove the stored-data or migration window that required it has
   ended; a "legacy" name alone is not evidence of dead code.
5. Keep cleanup behavior-neutral unless a separate issue/PR explicitly owns a behavior change.
6. Run focused tests while iterating and `make verify` before the cleanup PR is considered complete.

The recommended first execution PR should prefer high-confidence deletions and documentation
lifecycle cleanup. Large structural decompositions (`planner.ts`, `models.ts`, `Home.tsx`, Python
sync/provider/CLI hotspots) should remain separate PRs so behavior-preserving cleanup is reviewable.

## Tooling policy

These analyzers are deliberately **not** added to normal CI in this PR. Once the baseline has been
reviewed and false positives/configuration are understood, a later change may add a "no new debt"
gate or a committed baseline. Do not set a repository-wide deletion percentage or duplication
threshold before that baseline review.

The external CLIs execute locally; no repository source is uploaded to an analysis service. Package
managers still contact their registries to obtain the pinned analyzer binaries/packages.
