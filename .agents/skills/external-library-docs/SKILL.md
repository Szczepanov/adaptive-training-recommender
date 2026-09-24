---
name: external-library-docs
description: Ground third-party library/API implementation, setup, configuration, migration, and version-specific questions in current documentation. Use when correctness depends on an external package or SDK rather than repository-internal behavior.
---

# External Library Documentation

Use this skill when the task depends on a third-party package/API.

## Routing

1. Identify the dependency and derive the version used by the repository from its manifest/lockfile
   when practical.
2. If Context7 MCP is available, resolve the library and query documentation for the task, preferring
   version-appropriate documentation.
3. If Context7 is unavailable or insufficient, use official upstream documentation/source.
4. Compare the external contract with existing repository usage/tests before changing code.
5. Run the repository's normal verification contract after implementation.

Do not use Context7 as evidence for repository-internal architecture, ADR decisions, current behavior,
or Git history. Those come from repository code/docs.

Do not copy examples blindly: adapt them to the versions, types, error semantics, and abstractions
already present in this codebase.

The normative policy is `docs/standards/agent-tooling.md`.
