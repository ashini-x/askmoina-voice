/** Tracks on-demand web searches while a provider Live turn is waiting for tool results. */
export interface GroundedSearchToolCall {
  name?: unknown;
  id?: unknown;
}

/** Count valid search_current_web calls before starting any asynchronous retrieval. */
export function addPendingGroundedSearches(
  pendingCount: number,
  calls: readonly GroundedSearchToolCall[],
): number {
  const current = Number.isFinite(pendingCount) ? Math.max(0, Math.floor(pendingCount)) : 0;
  const started = calls.filter((call) =>
    call?.name === "search_current_web" &&
    typeof call.id === "string" &&
    Boolean(call.id.trim())
  ).length;
  return current + started;
}

/** Settle one lookup without allowing the pending count to become negative. */
export function completePendingGroundedSearch(pendingCount: number): number {
  const current = Number.isFinite(pendingCount) ? Math.max(0, Math.floor(pendingCount)) : 0;
  return Math.max(0, current - 1);
}
