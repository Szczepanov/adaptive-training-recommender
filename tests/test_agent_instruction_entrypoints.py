"""Regression checks for cross-client coding-agent instruction entrypoints."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENTS_BUDGET_BYTES = 32 * 1024
MANDATORY_ROUTING_PREFIX_BYTES = 8 * 1024


def test_agents_md_stays_within_portable_instruction_budget() -> None:
    data = (ROOT / "AGENTS.md").read_bytes()
    assert len(data) <= AGENTS_BUDGET_BYTES
    marker = b"## Code navigation"
    assert marker in data
    assert data.index(marker) < MANDATORY_ROUTING_PREFIX_BYTES


def test_large_package_inventory_is_progressively_disclosed() -> None:
    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    reference = ROOT / "docs" / "reference" / "package-architecture.md"
    assert reference.is_file()
    assert "docs/reference/package-architecture.md" in agents
    assert "src/garmin_sync/" in reference.read_text(encoding="utf-8")
    assert "app/src/engine/" in reference.read_text(encoding="utf-8")


def test_native_client_entrypoints_route_to_shared_semantic_policy() -> None:
    claude = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    gemini = (ROOT / "GEMINI.md").read_text(encoding="utf-8")
    semantic_skill = ".agents/skills/semantic-code-discovery/SKILL.md"

    assert len(claude.splitlines()) <= 200
    assert semantic_skill in claude
    assert "scripts/agent_canopy.py" in claude
    assert "scripts/agent_jev.py" in claude

    assert semantic_skill in gemini
    assert "AGENTS.md" in gemini
    assert "CLAUDE.md" in gemini
    assert "scripts/agent_canopy.py" in gemini
    assert "scripts/agent_jev.py" in gemini
    assert len(gemini.encode("utf-8")) < 4 * 1024
