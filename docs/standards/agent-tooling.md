# Agent Tooling Standard

This standard defines how coding agents should use repository context, external documentation,
verification, and evaluation infrastructure in this repository.

It applies to Claude Code, Codex, Gemini/Antigravity, and any other coding agent that works on this
repository. Client-specific MCP configuration remains developer-local; repository policy lives here.

## 1. External library and API documentation: Context7

When Context7 is connected, use it for **external** library/API questions before relying on model
memory. This includes:

- SDK/framework APIs and examples;
- setup and configuration syntax;
- package-version-specific behavior;
- migrations, deprecations, and breaking changes;
- unfamiliar third-party library features;
- code generation whose correctness depends on a current external API.

Current Context7 guidance explicitly recommends a project rule that automatically invokes Context7
for library/API documentation, code generation, setup, and configuration:
<https://context7.com/docs/tips>.

### Version discipline

Before querying documentation, determine the version actually used by this repository from the
manifest/lockfile when practical. Ask Context7 for that version or major version when versioned
documentation is available. Do not silently assume the newest release.

Relevant sources include:

- Python: `pyproject.toml`, `uv.lock`;
- frontend: `app/package.json`, `app/package-lock.json`;
- CI/runtime: Dockerfiles and workflow action versions where the task concerns them.

Context7 supports version-scoped library documentation:
<https://context7.com/versioned-library-documentation>.

### What Context7 is not for

Do not use Context7 as the source of truth for repository-internal behavior, local architecture,
ADRs, business rules, tests, or current implementation. Read the repository for those.

A useful routing rule is:

| Question | Preferred evidence |
|---|---|
| "How does our planner work?" | repository code + architecture/ADR |
| "Which callers use this symbol?" | repository semantic/text navigation |
| "How does Firebase SDK X implement/query Y in our installed version?" | Context7, then local usage/tests |
| "What does React/Vite/Playwright currently require?" | Context7, version-aware |
| "What did this project decide and why?" | repository docs / Git history |
| "What does this exact dependency source do?" | installed/source package or upstream source if docs are insufficient |

If Context7 is unavailable or does not contain the required version, use the package's official
documentation/source and say that Context7 was unavailable or insufficient when that affects
confidence.

Do not commit Context7 credentials or personal MCP configuration. The MCP server is configured per
developer/client; this repository only defines when and how it should be used.

## 2. Repository semantic discovery: lexical search + local Canopy + optional Jev

Canopy and Jev are **optional developer-local capabilities**, not repository dependencies.

- `canopy` means the local tree-sitter/vector/graph index from
  [LioraLabs/canopy](https://github.com/LioraLabs/canopy). Prefer a local embedding provider such as
  Ollama so repository source stays local.
- `jev` means the [BorisLeMeec/jev](https://github.com/BorisLeMeec/jev) code-navigation CLI backed
  by TypeSafe Jev; it is distinct from TypeSafe's general typed-decision/design skill. Jev sends
  selected source to the configured provider.

The Canopy index/model/runtime state, Jev CLI/API key, and personal client/plugin configuration stay
outside the repository. When installed, use `canopy status` to check index freshness and `jev probe`
to verify Jev connectivity; never commit generated indexes, model files, `TYPE_SAFE_AI_KEY`, or
another provider credential.

Route repository questions by evidence shape:

| Question | Preferred route |
|---|---|
| Exact symbol/string/error/path is known | `rg`/text search, then direct read |
| Behavior is known but repository vocabulary/location is unknown | fresh local `canopy search`; scoped `jev find` as second opinion/fallback |
| Known file/subsystem; semantic property needs broad/large reading | narrowly scoped atomic `jev ask`; otherwise targeted direct read |
| Call-graph orientation after discovery | `canopy map` / `canopy trace` as advisory hints |
| Type/signature change; need complete impact list | compiler (`tsc -b` / `mypy`) |
| External package/API behavior | Context7 / official upstream docs |

### Canopy operating policy

Canopy is primarily a **local semantic locator**, not source authority and not a replacement for
lexical lookup.

- Use `canopy search "<behavior>"` for vocabulary-gap questions where the implementation name is
  unknown. Do not use it for exact-symbol lookups that `rg` answers precisely.
- The current repository evaluation favors `top_k = 15` and `test_penalty = 0.5` in the
  developer-local `.canopy/canopy.toml`. The larger candidate set avoids losing known-correct
  implementations just below the default top 10; the stronger test penalty keeps regression tests
  visible without letting them routinely outrank production code.
- Do **not** standardize an embedding query instruction prefix yet. In the initial controlled trial
  it improved one known implementation from rank 9 to rank 4 but did not consistently repair harder
  retrieval misses. Revisit only through a fixed benchmark.
- Current baseline: Qwen3-Embedding-4B Q4 via local Ollama is already fast enough for interactive
  agent search in the evaluated workstation. Do not optimize for full-reindex speed at the expense
  of retrieval quality. Test Q6/Q8 only after a fixed benchmark demonstrates true embedding-recall
  failures rather than ranking, chunking, or graph extraction issues.
- A model or quantization change requires a full `canopy reindex`; document and query embeddings
  must use the same embedding model/quantization.
- `canopy map` and `canopy trace` are supplemental. Tree-sitter/entity extraction can fail to
  resolve a real symbol or produce ambiguous generic edges, so a graph miss never proves source
  absence.
- In the currently evaluated Canopy implementation, `--path` filters after broad vector retrieval
  and graph reranking. It narrows output but is not an exhaustive subtree search; a filtered miss is
  not absence proof.
- Always verify important Canopy hits against source, exact callers/tests, and compiler output as
  appropriate.

If Canopy is configured with a remote/OpenAI-compatible embedding provider instead of local Ollama,
treat its source upload as data egress and apply the same prohibited-path/privacy rules below.

### Jev question discipline

- Prefer one independently testable semantic property per `jev ask`. Split compound questions
  such as "does A/B/C already work or is wiring needed?" into separate A, B and C checks.
- Do not invoke Jev ceremonially when a small targeted read already answers the question. Its value
  is avoiding broad/large context loading or multi-file semantic inspection, not adding a mandatory
  tool hop.
- If the exact symbol is already known, locate it lexically first and scope Jev to the implementation
  file or smallest relevant subsystem. Do not pay for a repository-wide semantic sweep to rediscover
  a known symbol.
- For `jev find`, start with the smallest plausible subsystem. The CLI's file-count guard is a
  useful signal to narrow the search; do not raise `--max-files` merely to bypass that guard.
- Jev probabilities/rankings are evidence, not proof. Read the cited line/window and only the
  surrounding source needed to verify it; do not automatically re-read the whole large file. Verify
  important conclusions with exact callers/tests/compiler output as appropriate.
- A failed or low-confidence Jev search must not become an absence proof unless the source/test
  evidence independently supports absence.

### Data egress and privacy

Jev is not a local-only index: selected source content is sent to the configured TypeSafe service.
That makes the scan scope a data-governance boundary.

- Never run Jev over repository root `.` in this project. Start from an explicit source file or a
  narrow source-only directory identified from the architecture map.
- Never scan `artifacts/`, `app/artifacts/`, raw health exports, provider archives, token stores,
  credentials, service-account material, `.env*`, or any path containing personal/production data.
- Do **not** treat `.gitignore` as a DLP mechanism. The upstream CLI intentionally implements only
  a subset of ignore syntax, so an ignored local file can still be eligible for scanning.
- If a directory might contain ignored/untracked data, run local-only `jev scan --list <scope>` and inspect
  the candidate paths before any remote `jev find`/`jev ask`, or narrow to explicit safe files.
- If sending the relevant source to the configured provider is not acceptable, Jev is unavailable
  for that task; use local lexical search, targeted reads, tests, and compiler output instead.

These rules extend the repository's existing no-secrets/no-raw-health-data boundary to agent tooling;
developer-local installation does not make provider data egress local.

### Agent and hook economy

Broad semantic discovery belongs to the primary agent. Subagents/reviewers should not repeat the
same Canopy search or Jev sweep; give them the established target symbols/files and let them query further only for
a concrete unresolved question.

The automatic Jev large-read narrowing hook is **not** a repository default. It can reduce context,
but it can also hide source. Treat it as a client-local experiment and compare correctness against
full-source runs before enabling it broadly. Explicit `jev ask`/`jev find` remains the shared
workflow.

`jev gain` may be used as a local diagnostic for query count, examined tokens and provider spend,
but leverage is not the same as measured agent-token savings. Repository evals should prioritize
end-state correctness and then compare turns/context/tool usage across repeated trials.

If Jev is unavailable, use lexical search, direct reads, tests and compiler output. No task may
block on Jev setup.

The shared operational workflow is in
[`.agents/skills/semantic-code-discovery/SKILL.md`](../../.agents/skills/semantic-code-discovery/SKILL.md).

## 3. Verification contract

**`make verify` is the canonical "ready to hand off / ready for PR review" command for agents.**

Agents may run narrower tests while iterating, but a task is not complete until `make verify`
passes, or the agent explicitly reports which part could not be run and why.

The command is repository-owned and scope-aware:

- documentation-only diff: repository hygiene/pre-commit checks;
- code/infra diff: repository hygiene, static checks, tests, Firestore rules, browser E2E,
  engine simulations, deterministic plan/persona corpus gates, policy-version drift, production
  build, and coding-agent corpus validation.

The verification driver deliberately excludes checks whose result depends on external registry
state or local infrastructure rather than the repository state (for example dependency-security
registry availability and Docker/BuildKit availability). CI continues to own those environment
gates.

The contract is implemented by `scripts/verify_repo.py`; `make verify` is the stable public
entry point. Do not duplicate the command matrix in agent prompts or skills.

Independent gates run concurrently: repository hygiene first (pre-commit may rewrite files),
then every static, unit, emulator, simulation and build gate in parallel lanes, then the
wall-clock latency gates alone so nothing competes for the CPU while they sample. Each
concurrent step writes its output to `app/artifacts/verify/<step>.log`; a failure prints the
tail of its log, and no lane starts another step after a required step fails. The Firestore
rules suite runs as two shards on their own emulator ports next to browser E2E. For
sequential, streamed output while debugging, run
`uv run python scripts/verify_repo.py --serial` (or `VERIFY_SERIAL=1 make verify`).

### Iteration versus completion

During implementation, use the narrowest useful command:

- targeted test while fixing one behavior;
- `make check` for the standard Python/frontend static+unit gate;
- subsystem commands documented in `AGENTS.md`.

Before completion, run `make verify`.

This separation keeps iteration fast without letting an agent redefine "done" per task.

## 4. Delegation and context economy

Subagents are useful when work is genuinely separable, but every delegated agent has its own
reasoning/context budget and can duplicate repository discovery. For a single cohesive GitHub issue,
the default workflow is therefore:

1. the primary agent owns issue intake, repository discovery, planning, implementation and
   deterministic verification;
2. after implementation, at most one general read-only reviewer starts from the acceptance
   criteria and diff;
3. add a specialist reviewer only for a distinct risk domain (for example auth/secrets/Firestore
   security), not to repeat the same architecture review;
4. do not create a separate validator merely to rerun deterministic commands that the primary
   agent can execute and report directly.

A delegated reviewer must be **diff-first**. Give it the issue acceptance criteria, implementation
summary, changed-file list and diff. It should read surrounding code only to answer concrete review
questions and must not independently reconstruct the whole repository architecture.

The same economy applies to code navigation (full policy in
[`AGENTS.md` § Code navigation](../../AGENTS.md#code-navigation)):

- follow the routing policy in §2: exact lookup stays lexical, small/localized evidence is read
  directly, Jev is optional for broad/large semantic inspection or genuine vocabulary gaps, and the
  compiler (`tsc -b`, `mypy`) remains the impact list for type-level changes;
- once target symbols and relevant callers are known, read them directly rather than repeatedly
  rediscovering them;
- do not have multiple agents independently rebuild the same call graph.

Client-specific concurrency, model choice, reasoning effort, MCP output limits and lifecycle hooks
remain developer-local settings. Use them to enforce a smaller delegation budget when the client
supports it, but do not commit personal MCP configuration or credentials to this repository.

Current OpenAI multi-agent guidance also treats concurrency as an explicit budget and recommends
tuning when the root model should delegate:
<https://developers.openai.com/api/docs/guides/responses-multi-agent>.

## 5. Coding-agent evaluations

Product recommendation evaluation (simulation, plan judge, persona judge) and **coding-agent
evaluation** answer different questions and must remain separate.

Coding-agent evals live under `agent-evals/`. They measure whether coding agents can correctly
navigate, modify, and verify this repository.

The initial suite contains both:

- **regression cases** from real repository failures/fixes;
- **capability/routing cases** that test behaviors such as using current external documentation
  when appropriate and avoiding unnecessary external lookup when repository evidence is enough.

### Evaluation principles

1. Prefer deterministic outcome graders (tests, typecheck, lint, state/diff assertions) over
   judging a particular reasoning path.
2. Treat tool-use expectations primarily as diagnostics. Require a tool only when using that
   capability is part of the task being evaluated (for example a Context7 routing case).
3. Include both positive and negative routing cases so agents do not learn "always call every
   tool."
4. Run trials in isolated worktrees/checkouts from the case's declared `start_ref`; do not let
   one trial inspect artifacts produced by another.
5. Record model/client/version and tool availability with every trial.
6. Use multiple trials before comparing agents or prompt/tooling changes; one run is anecdotal.
7. Promote solved capability cases into regression cases when they become behaviors we want to
   preserve.

These principles follow current agent-evaluation guidance: coding agents are best graded on
verifiable end-state outcomes, with trace/tool grading added only where useful, and balanced
positive/negative tasks help prevent over-triggering. See:
<https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents> and
<https://developers.openai.com/api/docs/guides/agent-evals>.

### Corpus contract

`agent-evals/cases.json` is the checked-in task bank. Validate it with:

```bash
make agent-evals
```

The validator is intentionally provider-neutral. It does not call Claude, Codex, Gemini, or an API.
Agent execution remains a separate adapter concern; all clients should consume the same task bank
and grading expectations.

See `agent-evals/README.md` for the trial workflow and result format.
