# 2026-09-26 Agent delegation and Serena usage-efficiency review

## Scope

This follow-up reviews a concrete failure mode in the repository's coding-agent workflow:
independent subagents repeated the same semantic repository discovery and consumed substantially
more agent budget than a single cohesive issue justified.

It updates the 2026-09-24 Serena adoption review. The goal remains to use Serena where semantic
navigation improves correctness, but without multiplying the same discovery work across agent
contexts.

## Observed incident

A Codex run for issue #801 ("Preserve the second weekly strength/power exposure in cycling
event-directed builds") was asked to use subagents and skills where applicable.

The run spawned two subagents with separate Serena sessions. The recorded Serena calls were:

| Tool | Subagent A | Subagent B | Total |
|---|---:|---:|---:|
| `find_symbol` | 20 | 36 | 56 |
| `get_symbols_overview` | 7 | 4 | 11 |
| `find_referencing_symbols` | 4 | 5 | 9 |
| `activate_project` | 2 | 1 | 3 |
| `initial_instructions` | 2 | 1 | 3 |
| `search_for_pattern` | 2 | 0 | 2 |
| `get_current_config` | 1 | 0 | 1 |
| **Total** | **38** | **47** | **85** |

This is one observed run, not a benchmark. It is nevertheless sufficient to expose a workflow
problem because issue #801 already named the relevant modules, described the architecture boundary,
and supplied detailed acceptance criteria. Two independent agents did not need to rediscover the
same change surface from scratch.

## Root cause

The usage multiplication came from the composition of several individually reasonable rules:

1. Serena was made the preferred semantic navigation layer.
2. The issue-to-PR workflow mandated an independent code-reviewer.
3. Engine changes also mandated a separate validator subagent.
4. The reviewer was explicitly granted Serena and encouraged to perform semantic traversal.
5. A user instruction such as "use subagents where applicable" made those mandatory/default
   delegations even more likely.

The resulting topology was effectively:

```text
primary agent
├── semantic discovery + implementation + verification
├── reviewer
│   └── fresh semantic discovery
└── validator
    └── another independent context and repository inspection
```

The problem is not Serena itself. A single targeted semantic pass can reduce broad reading. The
problem is duplicating that pass across agents that each maintain their own context and reasoning
budget.

## Revised policy

### Primary-agent ownership

For one cohesive issue, the primary agent owns:

- issue/history intake;
- architecture and code discovery;
- implementation planning;
- implementation;
- deterministic verification.

Do not spawn planning/research/validator agents merely to repeat those phases.

### One general independent review

For non-trivial code changes, use one independent read-only review after implementation when a
subagent is available.

The reviewer receives:

- issue acceptance criteria;
- implementation summary;
- changed-file list;
- branch diff.

It starts with the diff, reads only the surrounding code needed to validate the change, and does
not independently reconstruct the architecture.

A second specialist reviewer is justified only when the change has a genuinely distinct risk
surface, such as auth, secrets, Firestore access control or sensitive logging.

### Deterministic validation stays in the primary agent

Commands such as `make verify`, targeted tests, simulations and policy-drift checks are
deterministic evidence. Re-running them in a second reasoning context normally adds cost without
new information.

Use a separate validator only when independent execution itself is material evidence—for example,
a high-risk environment-specific workflow where the primary agent's environment or execution path
is part of what must be challenged.

### Serena economy

For a cohesive issue:

1. Prefer one semantic-navigation pass by the primary agent.
2. Use `get_symbols_overview` / `find_symbol` to locate unfamiliar targets.
3. Use `find_referencing_symbols` or `find_implementations` only when caller/implementation
   evidence is actually needed.
4. Once target files/symbols are known, read them directly rather than repeatedly rediscovering
   them.
5. Do not have multiple agents independently rebuild the same call graph.
6. If Serena is still initializing, treat that as transient: perform only minimum fallback work and
   retry before a broad source-reading sweep.
7. Roughly 10–15 semantic calls without material narrowing is a soft tripwire to reassess strategy,
   not a hard limit.

## Reviewer tooling change

The normal `.claude/agents/code-reviewer.md` no longer receives Serena tools. This deliberately
reverses the 2026-09-24 recommendation to give the reviewer a read-only semantic subset.

That earlier recommendation was based on the hypothesis that semantic caller traversal would
improve review quality. The #801 run supplied counter-evidence about the default workflow: granting
every reviewer its own semantic-discovery capability made duplicate repository exploration too
easy.

The primary agent still has Serena. If the reviewer identifies a concrete unresolved cross-module
question, it reports that question for the primary agent to resolve semantically.

## Client-local controls

Repository policy should not commit personal Codex/Claude/Gemini configuration. Where supported,
developers can additionally constrain:

- maximum concurrent subagents;
- default subagent model/reasoning effort;
- MCP tool output budgets;
- Serena lifecycle hooks.

Those controls are useful guardrails, but they do not replace repository routing policy: an
expensive duplicated task remains duplicated even when each subagent is cheaper.

Current OpenAI multi-agent documentation treats concurrency as an explicit budget and recommends
using developer instructions to tune when the root agent should delegate:
<https://developers.openai.com/api/docs/guides/responses-multi-agent>.

## Expected effect

The default issue-to-PR flow becomes:

```text
primary agent
  issue → targeted Serena discovery → plan → implement → deterministic verification
                                                    │
                                                    └── one diff-first reviewer
```

instead of multiple agents independently repeating repository discovery.

The expected result is lower token/usage consumption and less duplicated work while preserving the
valuable independent review step.

## Follow-up measurement

Use the existing coding-agent evaluation discipline rather than treating one run as proof of the
optimal threshold.

For several representative issues, record:

- number of subagents;
- Serena calls by agent;
- repeated symbol/reference queries;
- files/tokens read before the change surface was established;
- review findings caught;
- verification failures found;
- total agent usage where the client exposes it.

Compare the previous multi-discovery workflow with the new primary-discovery/diff-review workflow.
If review quality drops materially, add targeted semantic escalation rather than restoring full
duplicate discovery by default.
