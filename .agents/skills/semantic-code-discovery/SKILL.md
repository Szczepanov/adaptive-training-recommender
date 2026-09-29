---
name: semantic-code-discovery
description: Route repository discovery between exact lexical search, local Canopy semantic retrieval/graph hints, and optional Jev semantic judgment while minimizing agent context. Use for source-code navigation, semantic audits, impact discovery, and questions about where behavior lives.
---

# Semantic Code Discovery

Use the cheapest evidence source that answers the question. `canopy` means the local
tree-sitter/vector/graph code index when installed; the evaluated default uses local Ollama.
`jev` means the BorisLeMeec/jev code-navigation CLI backed by TypeSafe Jev, not TypeSafe's
general typed-decision design skill. Both are optional: never block work because either is
unavailable.

## Routing

1. **Exact vocabulary known** — use `rg`/Grep and direct reads for symbols, strings, errors, paths,
   configuration keys and exact callers. Do not use semantic retrieval to rediscover a known name.
2. **Behavior known, repository vocabulary/location unknown** — when a local Canopy index is
   available and current, use `canopy search` as the first semantic locator. Treat the returned
   files/chunks as candidates, not proof. If Canopy is unavailable, stale, or materially ambiguous,
   use a tightly scoped `jev find` as a second opinion/fallback.
3. **Known target, semantic property unknown** — use a targeted direct read when the relevant
   evidence is already small/localized. When answering would otherwise require a broad/large read or
   scanning multiple files and `jev` is available, use an atomic `jev ask` against the
   implementation file or smallest relevant subsystem. Canopy search is retrieval, not a substitute
   for a semantic yes/no judgment.
4. **Call-graph orientation** — after a useful Canopy search hit, `canopy map`/`canopy trace`
   may provide cheap local graph context. Treat graph output as advisory: if a known symbol is not
   resolved, fall back to `rg`/source rather than inferring absence.
5. **Type/signature ripple** — use the compiler (`cd app && npx tsc -b`, `uv run mypy`) as the
   authoritative impact list.
6. **External library/API behavior** — use the `external-library-docs` skill / Context7 instead.

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

## Canopy search / graph

Use Canopy primarily for **local vocabulary-gap discovery**: natural-language behavior → likely
implementation files/symbols.

- Prefer `canopy search "<behavior>"` when you do not know the repository's symbol vocabulary.
- The current evaluated repository setup favors `top_k = 15` and `test_penalty = 0.5`: returning
  a few extra source candidates is cheaper than missing the implementation, while tests remain
  visible but are demoted below production code. These are retrieval-tuning defaults, not
  correctness rules.
- Do not add a Qwen instruction prefix by default yet. It improved one controlled ranking during
  evaluation but did not consistently repair harder misses; benchmark it before standardizing it.
- A result below the default top-k can still be the correct implementation. If the question matters,
  inspect more candidates before concluding that Canopy missed it.
- `--path` is a narrowing aid, not an absence proof. In the currently evaluated Canopy version,
  path filtering is applied after broad candidate retrieval/reranking, so a filtered miss does not
  prove the target is absent from that subtree.
- `canopy map` and `canopy trace` depend on tree-sitter/entity extraction. They can fail to resolve
  a real symbol even when `rg` and source prove it exists. Use them for orientation only.
- Model/quantization changes require a full reindex before comparing retrieval. Keep document and
  query embeddings on the same model/quantization.
- Optimize retrieval correctness before model precision. The evaluated Qwen3-Embedding-4B Q4 setup
  is already fast enough for interactive agent use; only test Q6/Q8 after a fixed benchmark shows
  genuine embedding-recall failures rather than ranking/chunking/graph issues.

Canopy's local index is developer-owned state. Do not commit `.canopy/`, generated vector stores,
Ollama model files, or machine-specific runtime state.

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

The primary agent owns broad discovery. Do not ask multiple subagents to repeat the same Canopy search or Jev sweep.
Give reviewers the established files/symbols and let them query further only for a concrete
unresolved question.

The automatic Jev large-read narrowing hook is not part of the shared repository workflow because it
can hide source. It may be evaluated client-locally, but explicit `jev ask`/`jev find` is the
portable default.

Local setup, indexes, model choice, credentials and API keys are developer-owned. `canopy status`
checks index freshness; `jev probe` verifies a Jev install; `jev gain` is useful for cost/token
diagnostics. Never commit generated Canopy state, provider credentials, Ollama model files, or
personal client/plugin configuration.

The normative policy is `docs/standards/agent-tooling.md`.
