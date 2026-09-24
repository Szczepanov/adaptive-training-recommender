# Memory Maintenance

## Discovery Model

- Core principle: progressive discovery through references, building a graph of memories.
- Initially, agents are provided with the list of all memories (names only).
- Agents should read `mem:core` as the top-level entry point (graph root).
  This memory should contain references to other memories covering major project domains.
  The referenced memories shall, in turn, shall contain references to even more specific memories, and so on.
  The depth of the graph shall depend on the project complexity.
- Use topics/folders to group related memories in order to make the content structure explicit.
  Folders can mirror project structure (e.g. modules like frontend/backend) or topics like debugging, architecture, etc.
- Memory references must use a mem: prefix inside backticks, e.g. `mem:frontend/core`.
  The surrounding text should clearly indicate when to read the memory/which content to expect.
  The text should provide more precise guidance than the memory name alone,
  i.e. avoid a reference like "frontend debugging: `mem:frontend/debugging` and instead make clear which aspects of frontend debugging are covered.
- Memories themselves should not contain information about when to read them; this is the responsibility of the referring memory.

## Style

Dense agent notes, not prose docs. Prefer invariants, terse bullets.
Avoid obvious context, rationale, and examples unless they prevent likely mistakes.
Keep guidance durable and generalizable, not task-local.

## Add/update threshold

Add or update memories only with stable, non-obvious project conventions that avoid complex rediscovery in the future.
Do not add: quick-read facts; generic language/framework knowledge; one-off task notes; volatile line-level details; behavior likely to change soon.

## No duplication of repository docs

- `CLAUDE.md`, `AGENTS.md` and `docs/` are the source of truth. A memory points at them (file + section name) and never restates them.
- Never copy into a memory: invariants, command lists, CLI subcommand lists, package/module maps, verification gates, dependency versions, delivery status. Copies of these drifted within one commit.
- Knowledge the docs lack belongs in the docs (via a normal PR), not in a memory. Memories are only for Serena-specific notes (e.g. language-server quirks, useful symbol queries).
- If a memory contradicts the repository docs, the docs win: fix or delete the memory.

## Maintenance Actions

- Renaming memories: References are updated automatically if handled via Serena's memory rename tool.
- Checking for stale memories (e.g. after deletion): Call `serena memories check` for a report.
  On Windows it crashes with `UnicodeEncodeError` (cp1250 console); run it with `PYTHONIOENCODING=utf-8` set
  (bash: `PYTHONIOENCODING=utf-8 serena memories check`; PowerShell: `$env:PYTHONIOENCODING = "utf-8"` first).
