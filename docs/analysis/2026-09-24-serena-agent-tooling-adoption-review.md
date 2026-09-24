# 2026-09-24 Serena agent-tooling adoption review

## Scope

This review asks a narrower question than "is Serena configured?": **does the repository make semantic code navigation a normal part of agent work when Serena is available, without making the repository unusable for contributors who do not install it?**

It covers `.serena/project.yml`, Serena memories, root agent instructions, shared skills, Claude subagents, the worktree-based issue-to-PR workflow, and current upstream Serena guidance for Claude Code, Codex, and Antigravity.

This is a point-in-time tooling review. It does **not** claim to measure historical Serena calls: agent transcripts and MCP-call logs are not committed to the repository.

## Findings

### 1. Serena is configured, but activation carries no repository-owned usage policy

`.serena/project.yml` correctly enables TypeScript and Python language servers, indexes the repository root, and leaves the required semantic tools available. However, `initial_prompt` is empty.

**Recommendation:** keep Serena optional as an installation dependency, but make it the preferred semantic navigation layer when connected and the task requires code discovery. Put a concise routing rule in `initial_prompt` so successful activation carries the policy with it.

### 2. "Optional" currently makes generic search the path of least resistance

PR #767 intentionally kept Serena non-required. That compatibility decision is sound, but installation optionality and tool routing are different concerns:

- **installation:** optional; a task must not fail only because Serena is unavailable;
- **routing when available:** prefer Serena for symbols, references, implementations, and unfamiliar source structure.

Grep remains the right tool for literals, error messages, configuration keys, documentation, generated files, and language-server gaps.

### 3. Shared skills do not route suitable discovery through Serena

`.agents/skills/issue-to-pr/SKILL.md` tells agents to use generic "search/read tools" for definitions, callers, validators, and tests. `.agents/skills/planner/SKILL.md` has the same generic guidance.

These are high-value semantic-navigation cases: cross-module impact analysis, caller/reference discovery, interface implementations, and production-wiring checks.

**Recommendation:** encode a Serena-first/text-search-second routing rule in the shared skills instead of expecting every model to recover the preference from a long root instruction file.

### 4. Claude review subagents currently cannot call Serena

Both `.claude/agents/code-reviewer.md` and `.claude/agents/security-reviewer.md` explicitly whitelist only `Read, Grep, Glob, Bash`. Claude Code subagents receive only the tools allowed by their definitions, so these reviewers cannot call `mcp__serena__*` even when Serena is connected.

This is especially costly for `code-reviewer`, whose checklist explicitly verifies callers and production wiring.

**Recommendation:** grant reviewer agents only the read-only semantic subset they need:

- `get_symbols_overview`
- `find_symbol`
- `find_referencing_symbols`
- `find_implementations`

Do **not** grant Serena editing tools to read-only reviewer agents.

Claude Code subagent tool scoping: <https://code.claude.com/docs/en/sub-agents>.

### 5. Worktrees can make semantic results incorrect if Serena stays bound to main

The `issue-to-pr` skill creates a sibling worktree and performs implementation there. Serena is stateful around an active project. A server started against the original checkout can therefore return symbol information from the wrong tree if the workflow assumes changing shell `workdir` also retargets Serena.

Current Serena guidance supports `--project-from-cwd`, and recent releases contain worktree-discovery fixes. The repository should still fail safely for older installs and long-lived MCP processes.

**Recommendation:** after creating a worktree, use Serena only after that worktree is the active Serena project. If the client cannot safely retarget and verify the project, fall back to ordinary repository tools rather than query main.

Upstream client/setup guidance: <https://oraios.github.io/serena/02-usage/030_clients.html>.

### 6. Prompt-only guidance is not sufficient for Claude Code

Current Serena Claude Code guidance documents reduced adherence to Serena instructions in some recent Claude Code/model combinations and provides a system-prompt override plus lifecycle hooks. The `activate` and `remind` hooks specifically address activation and repeated fallback to built-in search/read operations.

**Recommended local Claude Code setup:**

1. Follow Serena's current Claude Code setup with `--context claude-code --project-from-cwd`.
2. Verify the MCP connection with Claude Code's `/mcp`.
3. Use Serena's current system-prompt override if semantic tools still get ignored.
4. Enable Serena's documented `activate`, `remind`, and `cleanup` hooks.
5. **Do not enable blanket Serena auto-approval by default.** Upstream documents that auto-approval can include destructive Serena edit operations in permissive mode; explicit approval is safer here.

These client-specific hooks belong in developer-local Claude configuration, not the repository. Serena remains an optional local capability and Codex/Antigravity should not inherit Claude-specific runtime policy.

Serena client guidance: <https://oraios.github.io/serena/02-usage/030_clients.html>.

### 7. Codex and Antigravity need activation discipline, not duplicated repo policy

Keep one repository semantic-navigation policy and use each client's supported Serena context.

- **Codex:** use Serena's current Codex setup/context with project-from-CWD behavior and verify the MCP connection. Current Serena guidance also provides Codex lifecycle hooks (`activate`, `remind`, `reset`, and `cleanup`); enable them locally when semantic tools still lose out to shell-based search in longer sessions. Explicitly activate the current directory where the app does not do so automatically.
- **Antigravity:** use Serena's Antigravity context and explicitly activate the current project when the client cannot provide its working directory to the MCP configuration.

Keep volatile client commands in upstream Serena docs rather than duplicating them in this repository.

## Resulting repository policy

| Need | First choice | Fallback / complement |
|---|---|---|
| Locate unfamiliar symbol / file structure | `get_symbols_overview`, `find_symbol` | filename/text search |
| Determine callers / impact radius | `find_referencing_symbols` | exact text search, tests |
| Resolve interface implementations | `find_implementations` | exact text search |
| Rename/move/public API/cross-module refactor | semantic reference traversal before editing | text search completeness check |
| Verify production wiring in review | semantic references/implementations | Grep + runtime/tests |
| Search strings/config/docs/YAML/JSON | text search | Serena only when useful |
| Known tiny edit with known target | direct read/edit | no ceremonial Serena call |
| Serena unavailable / LS cannot answer | normal repository tools | report only if confidence changes |
| Worktree is not active Serena project | **do not query the wrong checkout** | retarget safely or fall back |

The policy is **Serena-first where semantics matter, not Serena-only**.

## What not to add yet

### Embeddings are not the next fix for active source-code navigation

The current gap is not semantic-similarity search. The repository already has an LSP/symbol layer but does not reliably route agents through it.

Embeddings become more compelling later for **cross-source historical knowledge**: ADRs, PR discussions, issues, Jira/Confluence decisions, incidents, and selected code symbols. Do not add a vector store merely to compensate for unused LSP/reference tools.

Re-evaluate embeddings after semantic navigation is measurably adopted.

### Do not force every task to call Serena

A rule such as "every task must call Serena" optimizes the metric instead of the outcome. Docs-only edits, exact literal changes, and already-known single-file work often gain nothing from an MCP call.

## How to measure adoption

Replace "it feels unused" with a small evidence loop:

1. Pick 10-20 representative historical tasks: caller tracing, cross-module refactor, policy-constant change, wiring review, security data-flow review, exact config edit, and docs-only edit.
2. Record whether Serena was available and whether a suitable task used a symbol/reference/implementation query before broad code reading.
3. Compare files/tokens read before finding the change surface, missed callers/implementations, unnecessary files touched, review findings caught, and total tool calls/elapsed execution where available.
4. Do not score docs-only or exact-literal tasks as failures for skipping Serena.
5. Revisit the policy if semantic navigation adds cost without improving discovery accuracy.

A later coding-agent eval harness can automate these comparisons.

## Changes from this review

The accompanying implementation:

- gives Serena a concise project activation prompt;
- changes root guidance from optional navigation to preferred semantic navigation when available;
- routes shared issue-to-PR and planning discovery through Serena where appropriate;
- guards the worktree workflow against querying the wrong checkout;
- grants Claude reviewer subagents a **read-only** Serena tool subset;
- keeps Serena memories as pointers rather than duplicating mutable repo documentation;
- does not add embeddings, a repo-level MCP dependency, or auto-approval of editing tools.

No recommendation-engine behavior, user data model, deployment path, or production runtime changes.
