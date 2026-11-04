"""Shared completion rules for Gemini Live acceptance sessions.

generationComplete closes model generation, not necessarily the Live turn.
A turn is safe to continue only after turnComplete and, when reported,
interactionStatus has left IN_PROGRESS.
"""


def turn_complete(message: dict) -> bool:
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(
        content.get("turnComplete") or content.get("turn_complete")
    )


def interaction_status(message: dict) -> str | None:
    content = message.get("serverContent") or message.get("server_content") or {}
    if not isinstance(content, dict):
        return None
    value = content.get("interactionStatus") or content.get("interaction_status")
    return value.upper() if isinstance(value, str) else None


def response_turn_finished(
    message: dict,
    turn_complete_seen: bool = False,
    interaction_in_progress_seen: bool = False,
) -> bool:
    """Return true only after the final turn boundary, not generationComplete.

    The provider may emit generationComplete while waiting for playback or while
    background reasoning/tool work continues. turnComplete marks the logical end;
    interactionStatus=IN_PROGRESS defers that boundary until a later IDLE event.
    Some deployed frames omit interactionStatus, so turnComplete is accepted in
    that case only when no earlier IN_PROGRESS state remains outstanding.
    """
    status = interaction_status(message)
    if status == "IN_PROGRESS":
        return False

    completed = turn_complete(message) or turn_complete_seen
    if not completed:
        return False

    if status in ("IDLE", "REQUIRES_ACTION"):
        return True
    if status is None:
        return not interaction_in_progress_seen
    return False
