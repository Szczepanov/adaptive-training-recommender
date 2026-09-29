---
name: semantic-code-discovery
description: Route repository discovery between exact lexical search and optional Jev semantic judgment/search while minimizing agent context. Use for source-code navigation, semantic audits, impact discovery, and questions about where behavior lives.
---

# Semantic Code Discovery

Use the cheapest evidence source that answers the question. In this skill, `jev` means the
BorisLeMeec/jev code-navigation CLI backed by TypeSafe Jev, not TypeSafe's general typed-decision
design skill. Jev is optional: never block work because it is unavailable.

## Routing

1. **Exact vocabulary known** — use `rg`/Grep and direct reads for symbols, strings, errors, paths,
   configuration keys and exact callers.
2. **Known target, semantic property unknown** — use a targeted direct read when the relevant
   evidence is already small/localized. When answering would otherwise require a broad/large read or
   scanning multiple files and `jev` is available, use `jev ask` against the implementation file
   or smallest relevant subsystem.
3. **Behavior known, repository vocabulary/location unknown** — use a tightly scoped `jev find`
   as a discovery hint, then verify the returned line/window in source.
4. **Type/signature ripple** — use the compiler (`cd app && npx tsc -b`, `uv run mypy`) as the
   authoritative impact list.
5. **External library/API behavior** — use the `external-library-docs` skill / Context7 instead.

## Jev ask

Keep questions atomic: one independently testable semantic property per call. Do not call Jev
ceremonially after a targeted source read already answers the question; the purpose is to avoid
unnecessary context loading, not to add another required hop.

Prefer:

```bash
rg -n "ContextBriefService" app/src
jev ask "does ContextBriefService.build hydrate performedFacts for the morning brief?" \
  app/src/services/contextBriefService.ts -q
```

over a compound question such as "does A/B/C already work or does slice 1 need wiring?" Split A,
B and C and combine the verified results yourself.

## Jev find

Use `jev find` only when the implementation name/location is genuinely unknown.

- Start with the smallest plausible subsystem, not the repository root.
- Treat the CLI file-count guard as a signal to narrow the scope.
- Do not raise `--max-files` merely to avoid choosing a subsystem.
- Treat rankings as candidate locations, not proof. A plausible top result can still miss the real
  implementation.

## Evidence contract

Jev probabilities and rankings are not source authority.

After a Jev result:

1. Read the cited line/window and enough surrounding source to verify the claim; do not automatically
   re-read the entire large file.
2. Verify important callers, tests, and exact strings with normal repository tools.
3. Use the compiler for type/signature impact.
4. For high-impact changes, rely on deterministic tests/verification rather than a semantic score.

A low-confidence or empty Jev result is not by itself proof that behavior is absent.

## Data boundary

Jev sends selected repository content to an external TypeSafe service. Treat every Jev scope as data
egress, not as a purely local search.

- Never run Jev over the repository root `.` in this project.
- Scope to explicit source files or narrow source-only directories such as `app/src/`, `src/`, or
  another directory established by the architecture map.
- Never scan `artifacts/`, `app/artifacts/`, health exports, provider archives, credentials,
  token stores, service-account material, `.env*`, or other local/production data.
- Do not assume `.gitignore` is a security boundary. Before using a directory whose contents may
  include ignored/untracked files, run `jev scan --list <scope>` locally and inspect the candidate paths,
  or narrow to explicit safe files instead.
- If source disclosure to the configured provider is not acceptable for the task/repository, do not
  use Jev; fall back to local lexical search, targeted reads, tests, and compiler output.

## Agent economy

The primary agent owns broad discovery. Do not ask multiple subagents to repeat the same Jev sweep.
Give reviewers the established files/symbols and let them query further only for a concrete
unresolved question.

The automatic Jev large-read narrowing hook is not part of the shared repository workflow because it
can hide source. It may be evaluated client-locally, but explicit `jev ask`/`jev find` is the
portable default.

Local setup, credentials and API keys are developer-owned. `jev probe` verifies a local install;
`jev gain` is useful for cost/token diagnostics. Never commit provider credentials or personal
client/plugin configuration.

The normative policy is `docs/standards/agent-tooling.md`.
