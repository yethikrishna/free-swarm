"""Wires the rewind driver (P4) to the agent stack's existing fork machinery.

`agent_manager.edit_message` already forks at a user turn and re-runs. This
injects it as the rewind driver so apps/rewind stays a leaf (no agent imports at
load). agent_manager is imported at fire-time.
"""

from __future__ import annotations

from backend.apps.rewind.rewind import set_driver


async def _drive_rewind(session_id: str, message_id: str, new_content: str) -> None:
    from backend.apps.agents.agent_manager import agent_manager
    await agent_manager.edit_message(session_id, message_id, new_content)


def wire() -> None:
    set_driver(_drive_rewind)
