/** Tracks on-demand web and BRVIN lookups while a provider Live turn awaits tool results. */
export interface GroundedSearchToolCall {
  name?: unknown;
  id?: unknown;
}

/** Count valid web/BRVIN knowledge lookups before starting asynchronous retrieval. */
export function addPendingGroundedSearches(
  pendingCount: number,
  calls: readonly GroundedSearchToolCall[],
): number {
  const current = Number.isFinite(pendingCount) ? Math.max(0, Math.floor(pendingCount)) : 0;
  const started = calls.filter((call) =>
    (call?.name === "search_current_web" || call?.name === "search_brvin_knowledge") &&
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
