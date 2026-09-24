# Coding-Agent Evaluations

This directory evaluates **coding-agent behavior on this repository**. It is separate from the
recommendation engine's simulation/AI-judge suites under `app/`.

## Goals

Use one stable task bank to compare Claude Code, Codex, Gemini/Antigravity, or future agents after
changes to:

- model/version;
- MCP/tool availability;
- project instructions and skills;
- context/retrieval strategy;
- verification workflow.

The suite should answer questions such as:

- Did the agent find all relevant callers instead of fixing only the obvious file?
- Did it preserve repository architecture and policy-lineage rules?
- Did it use current external documentation when a task depended on a third-party API?
- Did it avoid unnecessary external/tool calls for repository-internal questions?
- Did it run the required verification and leave a minimal diff?

## Commands

Validate the corpus:

```bash
make agent-evals
# equivalent:
uv run python scripts/agent_eval.py validate
```

List cases:

```bash
uv run python scripts/agent_eval.py list
```

Show one case:

```bash
uv run python scripts/agent_eval.py show constructor-signature-cross-boundary
```

Create an empty trial result document:

```bash
uv run python scripts/agent_eval.py new-result \
  --case constructor-signature-cross-boundary \
  --agent claude-code \
  --model "<model/version>" \
  --output /tmp/constructor-signature-cross-boundary.json
```

Validate a filled result:

```bash
uv run python scripts/agent_eval.py validate-result /tmp/constructor-signature-cross-boundary.json
```

## Running a trial

1. Read the case from `cases.json`.
2. Create an isolated worktree at the case's `start_ref`.
3. Install dependencies as required by that historical revision (for frontend implementation cases,
   run `npm --prefix app ci --prefer-offline --no-audit` inside the worktree rather than
   symlinking/junctioning `app/node_modules`, so Vite/Vitest worker isolation resolves a single
   `@vitest/runner` instance; if evaluating `semantic_navigation` with Serena, activate Serena on
   the isolated worktree directory first and restore the primary checkout afterward).
4. Give the agent only the case `prompt` plus the normal repository instructions/tools being
   evaluated. Do not reveal the reference PR/solution.
5. Let the agent work normally.
6. Run the case's `grader.commands` from the worktree. Record exit codes.
7. Record changed files, tool capabilities used, elapsed time, tool-call/token metrics when the
   client exposes them, and a short outcome note.
8. Validate the result JSON and retain it outside the repo or in an experiment artifact store.

The checked-in corpus is stable input. Raw transcripts/results are intentionally not committed by
default: they can contain large traces, environment details, or model-generated content that would
turn the repository into a log store.

## Grading philosophy

Outcome correctness dominates. Tool expectations are diagnostic unless a case explicitly marks a
capability `required`.

For example, a cross-module bug can be solved with semantic navigation, text search, or both; the
grader should care that all callers were fixed. A Context7 routing case is different: the capability
under test is whether the agent obtains current external documentation, so `context7` may be
required.

Do not require private chain-of-thought. A trial trace may record tool calls, commands, files read,
and user-visible reasoning/summary, but never depend on hidden reasoning.

## Adding cases

Good cases come from real regressions, difficult PRs, repeated review findings, or explicit
capabilities we want to preserve. Each case must:

- have a unique stable ID;
- define an immutable `start_ref` (commit SHA);
- contain an unambiguous prompt;
- state observable success criteria;
- provide deterministic grader commands when it is an implementation case;
- declare tool expectations separately from correctness;
- avoid credentials, production data, and personal health payloads.

Start small. Add cases when they expose a meaningful failure mode rather than to increase the count.
