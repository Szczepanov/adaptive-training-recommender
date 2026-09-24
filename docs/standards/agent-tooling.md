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

## 2. Verification contract

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

### Iteration versus completion

During implementation, use the narrowest useful command:

- targeted test while fixing one behavior;
- `make check` for the standard Python/frontend static+unit gate;
- subsystem commands documented in `AGENTS.md`.

Before completion, run `make verify`.

This separation keeps iteration fast without letting an agent redefine "done" per task.

## 3. Coding-agent evaluations

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
