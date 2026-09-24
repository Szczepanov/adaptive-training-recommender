# Adaptive Training Recommender — Entry Point

Python Garmin/health ingestion backend (`src/garmin_sync/`) + React/TypeScript/Firebase app
(`app/`) with a pure adaptive decision engine (`app/src/engine/`).

These memories are an index. The repository docs are the source of truth; nothing here
restates them. If a doc and a memory disagree, the doc wins: fix the memory.

## Where to read

- Invariants I1–I6, the pre-change knowledge-registry check, the working loop and
  done-criteria: `CLAUDE.md` (read it before editing anything).
- Commands (Makefile, `uv run python -m garmin_sync …`, `app/` npm scripts) and what CI
  gates: `AGENTS.md` § Commands reference.
- Package routing map for `src/garmin_sync/` and `app/src/`: `AGENTS.md` § Package
  architecture.
- Which `docs/` directory to trust, and precedence when documents disagree:
  `docs/README.md`.
- What is live, shadow-only or planned: `docs/plans/README.md` (the only status board).
- Engine behaviour: `docs/architecture/recommendation-engine.md`, then the relevant ADR.
- UI/UX quality bar: `docs/standards/ui-ux.md`.

## Serena usage

- Before changing an engine constant, run `find_referencing_symbols` on it. The owning
  claim (`app/src/knowledge/sportsKnowledgeRegistry.ts`), coverage item
  (`knowledgeCoverage.ts`) and `*PolicyAlignment.test.ts` all have to change together.
- Before adding or editing a memory, read `mem:memory_maintenance`. It covers the
  no-duplication rule and when a memory is warranted.
