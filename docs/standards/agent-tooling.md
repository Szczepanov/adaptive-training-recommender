# Agent Tooling Standard

This standard defines how coding agents should use repository context, external documentation,
verification, and evaluation infrastructure in this repository.

It applies to Claude Code, Codex, Gemini/Antigravity, and any other coding agent that works on this
repository. Client-specific MCP configuration remains developer-local; repository policy lives here.

## 0. Client instruction entrypoints

The repository must work correctly without requiring each developer to customize a global agent
configuration. Client-local setup may improve convenience or environment inheritance, but the
committed entrypoints below are the portability contract:

| Client | Native repository entrypoint | Repository rule |
|---|---|---|
| Codex | `AGENTS.md` | Keep the root file below the repository's 32 KiB budget and keep mandatory discovery routing near the top. `project_doc_max_bytes` may be raised locally for headroom, but correctness must not depend on it. |
| Claude Code | `CLAUDE.md` | Keep the always-on file concise (target ≤200 lines); route detailed/on-demand discovery to `.agents/skills/semantic-code-discovery/SKILL.md`. |
| Gemini CLI | `GEMINI.md` | The root shim points Gemini to the canonical `AGENTS.md` / `CLAUDE.md` contract and repeats only the minimal semantic-discovery decision boundary. |
| OpenCode / OpenChamber | `AGENTS.md` | OpenCode V2 consumes `AGENTS.md` directly; OpenChamber inherits that behavior through its OpenCode server. |

The cross-client single source of truth for semantic routing remains
`.agents/skills/semantic-code-discovery/SKILL.md`. Client-specific entrypoints should contain only
enough always-on context to make the model load that skill when applicable. Do not copy the full
skill into `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

### Repository instruction budgets

- `AGENTS.md` has a repository-enforced **32 KiB UTF-8 ceiling**. Large routing inventories belong
  under `docs/reference/` and are linked from the root file.
- Mandatory semantic-routing instructions must begin within the first **8 KiB** of `AGENTS.md`.
- `CLAUDE.md` should remain at or below **200 lines**. Reference material belongs in skills,
  standards, or architecture documents.
- `GEMINI.md` is a small compatibility/router shim, not another canonical policy document.

These are repository design constraints, not claims that every client uses exactly the same hard
limit. The purpose is to stay inside conservative client budgets and minimize always-on context.

### Recommended developer-local setup

Repository correctness does not require these settings, but they improve reliability on a
multi-client workstation:

- **Codex:** `~/.codex/config.toml` may set `project_doc_max_bytes = 65536` for additional headroom.
  Keep normal shell environment inheritance configured so `python`, `canopy`, `jev`, and Ollama are
  visible to commands. The committed 32 KiB budget still applies.
- **Claude Code:** no extra project-memory configuration is required because `CLAUDE.md` is the
  native entrypoint. Keep user-level rules generic; do not duplicate this repository's semantic
  policy globally.
- **Gemini CLI:** no `context.fileName` override is required now that the repository contains
  `GEMINI.md`. `/memory show` can be used to verify that the expected context loaded.
- **OpenCode:** the repository `AGENTS.md` is sufficient. A global
  `~/.config/opencode/AGENTS.md` should contain only cross-project personal defaults.
- **OpenChamber:** when its login/startup service is used, changing `PATH`, provider credentials,
  Jev credentials, or local tool locations requires refreshing/restarting the service environment;
  do not put those credentials in the repository.

On each client, a local smoke check for this repository is:

```bash
python scripts/agent_canopy.py status
python scripts/agent_jev.py probe
```

`CANOPY_UNAVAILABLE` remains a normal fallback condition. A missing Jev/Canopy installation must
never trigger task-time provisioning.

Current client references:

- Codex configuration reference: <https://developers.openai.com/docs/config-file/config-reference>
- Claude Code extension/context guidance: <https://code.claude.com/docs/en/features-overview>
- Gemini CLI context files: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md>
- OpenCode instructions: <https://opencode.ai/v2/docs/instructions>
- OpenChamber server/startup environment: <https://github.com/openchamber/openchamber/blob/main/packages/docs/content/docs/opencode-server.mdx>
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
outside the repository. Coding agents access an already-maintained Canopy index only through
`scripts/agent_canopy.py`; they do not initialize or mutate it. Agents reach Jev only through
`scripts/agent_jev.py`, which refuses out-of-policy scopes before any request leaves the
machine. Never commit generated indexes, model files, `TYPE_SAFE_AI_KEY`, or another provider
credential.

Route repository questions by evidence shape:

| Question | Preferred route |
|---|---|
| Exact symbol/string/error/path is known | `rg`/text search, then direct read |
| Behavior is known but repository vocabulary/location is unknown | one query-only `scripts/agent_canopy.py search` attempt; then scoped `scripts/agent_jev.py find` if still ambiguous |
| Known file/subsystem; one semantic property needs multiple substantial reads | one narrowly scoped atomic `scripts/agent_jev.py ask`; otherwise targeted direct read |
| Call-graph orientation after discovery | `canopy map` / `canopy trace` as advisory hints |
| Type/signature change; need complete impact list | compiler (`tsc -b` / `mypy`) |
| External package/API behavior | Context7 / official upstream docs |

### Canopy operating policy

Canopy is primarily a **local semantic locator**, not source authority and not a replacement for
lexical lookup.

Coding agents should invoke Canopy through the repository-owned query-only bridge:

```bash
python scripts/agent_canopy.py search "where is this behavior implemented?"
python scripts/agent_canopy.py map SomeSymbol
python scripts/agent_canopy.py trace Caller Callee
python scripts/agent_canopy.py status
```

The bridge discovers a checked-out `main`/`master` worktree, or accepts
`AGENT_CANOPY_BASELINE_WORKTREE` / `--baseline-worktree`, validates that the complete generated index already exists (including the HNSW sidecar), and
then runs only query/non-maintenance Canopy commands from that baseline checkout. It never invokes
`init`, `index`, `reindex`, `clean`, or configuration/model mutation. Exit code 3 plus `CANOPY_UNAVAILABLE` explicitly means: **continue with
fallback evidence and do not troubleshoot/provision Canopy during the task**.

- Use `python scripts/agent_canopy.py search "<behavior>"` for vocabulary-gap questions where the
  implementation name is unknown. Do not use raw Canopy from a temporary worktree, and do not use
  semantic retrieval for exact-symbol lookups that `rg` answers precisely.
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

#### Index lifecycle and agent worktrees

Index provisioning is infrastructure maintenance, not issue/PR setup.

- Normal coding agents MUST NOT run `canopy init`, `canopy reindex`, change the embedding
  model/quantization, or pull an Ollama embedding model just because their worktree has no index.
- Normal coding agents MUST NOT run `canopy index` against a shared/baseline index. Incremental
  index maintenance belongs to a designated persistent checkout or an explicit developer/tooling
  maintenance workflow.
- A persistent primary/main checkout may own a long-lived Qwen3-Embedding-4B index and keep it
  incrementally current. The one-time full-index cost is acceptable because measured interactive
  queries are already fast; do not optimize normal agent startup by rebuilding smaller disposable
  indexes in every worktree.
- If a client/environment exposes the persistent-main index for queries, its results describe the
  indexed baseline. Use them to discover likely files/symbols, then inspect the current worktree
  directly. Branch changes, uncommitted edits, and commits newer than the indexed SHA are outside
  that baseline.
- Never symlink/copy one **writable** `.canopy/` directory across concurrent worktrees. Canopy's
  store, vector indexes, configuration/indexed SHA, and incremental updates are mutable state; give
  one maintenance owner exclusive write responsibility.
- Upstream Canopy currently opens `store.redb` with `Database::create` and an initialization write
  transaction even for query/status/map/trace paths. Therefore **query-only is a command-surface
  guarantee, not an OS/filesystem read-only guarantee**. `agent_canopy.py` serializes its consumers
  with a baseline-scoped lock; explicit index maintenance must not overlap those queries.
- A usable search index requires both the `vectors.idx` dimensions header and
  `vectors.idx.chunks.usearch` HNSW sidecar. The wrapper treats either missing artifact as
  `CANOPY_UNAVAILABLE` rather than allowing an apparently successful empty search.
- If no pre-existing usable Canopy index is available, proceed immediately with `rg`, direct
  reads, repository docs/tests, compiler evidence, and scoped Jev where appropriate. Missing Canopy
  must never block a task.
- Do not switch the normal baseline to Qwen3-Embedding-0.6B merely to make per-worktree indexing
  cheap. The evaluated 4B Q4 baseline is already fast during actual search and should be preferred
  until a fixed retrieval benchmark shows that a smaller model preserves the required correctness.
  A smaller model remains a valid explicit experiment if disposable/per-worktree indexing later
  becomes a real product requirement.

These lifecycle rules deliberately separate **querying** from **index maintenance**. The primary
agent may use a maintained semantic baseline for broad discovery; delegated agents/worktrees should
receive established files/symbols instead of rebuilding the same semantic corpus.

If Canopy is configured with a remote/OpenAI-compatible embedding provider instead of local Ollama,
treat its source upload as data egress and apply the same prohibited-path/privacy rules below.

### Jev question discipline

The trigger for `jev ask` is operational: if the implementation target is known but one semantic
property would otherwise require inspecting multiple substantial source regions/files, ask one
atomic Jev question before doing that broad reading. Typical issue work should use 0–3 Jev calls;
additional calls should correspond to distinct unresolved properties, not repeated discovery.

For unknown implementation location, Jev `find` is the second opinion after the query-only Canopy
attempt is unavailable or materially ambiguous—not a mandatory duplicate search.

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
- If a directory might contain ignored/untracked data, run local-only
  `python scripts/agent_jev.py scan --list <scope>` and inspect the candidate paths before any
  remote `scripts/agent_jev.py find`/`ask`, or narrow to explicit safe files.
- If sending the relevant source to the configured provider is not acceptable, Jev is unavailable
  for that task; use local lexical search, targeted reads, tests, and compiler output instead.

These rules extend the repository's existing no-secrets/no-raw-health-data boundary to agent tooling;
developer-local installation does not make provider data egress local.

### Executable Jev egress guard

The rules above are prose, so `scripts/agent_jev.py` makes the boundary enforceable. It resolves the
`jev` CLI and exposes only `probe`, `scan`, `ask` and `find`:

```bash
python scripts/agent_jev.py probe                        # install check, no source sent
python scripts/agent_jev.py scan --list app/src          # local candidate inspection, no egress
python scripts/agent_jev.py ask "<atomic question>" app/src/services/contextBriefService.ts -q
python scripts/agent_jev.py find "<behavior>" app/src/engine
```

Canopy can borrow a maintained baseline, but Jev has none: its scope is whatever the caller names, so
the guard is the only thing between a repository-root sweep and the provider. Argument parsing binds
scope positions explicitly, so a question is never mistaken for a path.

- Scope arguments are resolved to absolute paths and refused when they resolve to the repository
  root, sit inside a blocked tree (`artifacts/`, `app/artifacts/`, `.garmin_archive`,
  `.garmin_tokens`, `.garth`, `node_modules/`, `.git/`, `.canopy/`, `.venv/`, `__pycache__/`,
  `dist/`, `build/`), or carry a credential-shaped leaf name (`.env*`, `service-account*`,
  `*secret*`, `*token*`, `*.pem`, `*.key`, `id_rsa`).
- Refusal is fail-closed: the process exits `4` (`JEV_REFUSED`) without executing `jev` at all. That
  is deliberately distinct from `3` (`JEV_UNAVAILABLE`, missing CLI or a failed call) so a caller can
  tell a policy boundary from a missing tool.
- `scan --list` stays permitted at any breadth because it only enumerates candidate paths
  locally. A `scan` without `--list` performs a remote scan and is guarded like `find`/`ask`.
  Use it to vet a directory before scoping a remote call to it.
- The guard is a floor, not a substitute for judgment: a permitted `app/src` scope is still source
  leaving the machine, so scope as narrowly as the question allows.

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
