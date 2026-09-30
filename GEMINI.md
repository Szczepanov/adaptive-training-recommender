# GEMINI.md — Gemini CLI entry point

This repository's canonical cross-agent instructions live in [`AGENTS.md`](./AGENTS.md);
safety/invariant and working-loop rules live in [`CLAUDE.md`](./CLAUDE.md). Do not create a
third copy of those rules here.

Before a substantive coding task:

1. Read `AGENTS.md` and the relevant parts of `CLAUDE.md`.
2. For non-trivial source discovery where implementation vocabulary/location is unknown, read and
   follow `.agents/skills/semantic-code-discovery/SKILL.md` before broad exploration.
3. Exact symbol/string/path already known → use `rg`/direct source.
4. Unknown vocabulary/location → make one query-only
   `python scripts/agent_canopy.py search "<behavior>"` attempt.
5. `CANOPY_UNAVAILABLE` / exit 3 → fall back immediately; never init/reindex/provision Canopy as
   task setup.
6. Canopy remains ambiguous → at most one narrowly scoped `python scripts/agent_jev.py find`
   second opinion before broader search.
7. Known target + one semantic property that would otherwise require multiple substantial reads →
   one atomic `python scripts/agent_jev.py ask`, then verify the cited source.
8. The primary agent owns broad semantic discovery. Give subagents established files/symbols;
   do not have them repeat the same Canopy/Jev sweep.

Use `make verify` as the canonical handoff/PR gate when the task changes code. The detailed command
and architecture routing remains in `AGENTS.md`; this file exists because Gemini CLI discovers
`GEMINI.md` natively.
