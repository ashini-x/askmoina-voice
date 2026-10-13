export type GroundedListCard = {
  type: "key_details";
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  sources: Array<{ title: string; url: string }>;
};

export type GroundedRankedRow = { rank: number; label: string; value: string };

const NUMBER_WORDS: Record<string, number> = {
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

/** Only synthesize a ranked card when the user asked for a concrete top-N list. */
export function getRequestedRankedListCount(query: string): number | null {
  const match = String(query || "").match(/\btop[\s-]*(\d{1,2}|five|six|seven|eight|nine|ten)\b/i);
  if (!match) return null;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1].toLowerCase()];
  return Number.isInteger(count) && count >= 5 && count <= 10 ? count : null;
}

function cleanRowText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse grounded numbered lists and simple Markdown tables without inventing facts. */
export function extractGroundedRankedRows(text: string, requestedCount: number): GroundedRankedRow[] {
  const answer = String(text || "").split(/\n\s*(?:sources?|source links):/i)[0];
  const found = new Map<number, GroundedRankedRow>();
  for (const rawLine of answer.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;

    let rank = 0;
    let body = "";
    const cells = line.startsWith("|") ? line.split("|").map(cleanRowText).filter(Boolean) : [];
    if (cells.length >= 2 && /^\d{1,2}$/.test(cells[0])) {
      rank = Number(cells[0]);
      body = cells.slice(1).join(" — ");
    } else {
      const numbered = line.match(/^(?:[-*]\s*)?(?:\*\*)?(\d{1,2})[.)]\s+(.+?)\s*$/);
      if (!numbered) continue;
      rank = Number(numbered[1]);
      body = numbered[2];
    }
    if (rank < 1 || rank > requestedCount || found.has(rank)) continue;

    body = cleanRowText(body).replace(/^[-–—|:]+\s*/, "").trim();
    if (!body || body.length > 350) continue;
    const separators = [...body.matchAll(/\s+(?:—|–|\||:)\s+/g)];
    let labelText = body;
    let valueText = "Listed in grounded results";
    const separator = separators[separators.length - 1];
    if (separator && separator.index !== undefined) {
      const left = body.slice(0, separator.index).trim();
      const right = body.slice(separator.index + separator[0].length).trim();
      if (left && right) {
        labelText = left;
        valueText = right;
      }
    }
    found.set(rank, {
      rank,
      label: (String(rank) + ". " + labelText).slice(0, 60),
      value: valueText.slice(0, 180) || "Listed in grounded results"
    });
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank);
}

function extractGroundedSources(text: string): Array<{ title: string; url: string }> {
  const sourcesSection = String(text || "").split(/\n\s*Sources?:\s*\n/i).slice(1).join("\n");
  const found: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /^\s*[-*]\s*(.{1,180}?):\s*(https:\/\/\S+)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourcesSection)) && found.length < 4) {
    const title = cleanRowText(match[1]).slice(0, 100);
    const url = match[2].replace(/[),.;]+$/, "");
    if (!title || !/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    found.push({ title, url });
  }
  return found;
}

/**
 * Build an honest, full-height fallback card directly from the grounded search
 * result. Missing positions are explicitly marked unverified, never guessed.
 */
export function buildGroundedListCard(query: string, groundedResult: string): GroundedListCard | null {
  const requestedCount = getRequestedRankedListCount(query);
  if (!requestedCount) return null;
  const sources = extractGroundedSources(groundedResult);
  if (!sources.length) return null;

  const rows = extractGroundedRankedRows(groundedResult, requestedCount);
  if (!rows.length) return null;

  const byRank = new Map(rows.map((row) => [row.rank, row]));
  const details = Array.from({ length: requestedCount }, (_, index) => {
    const rank = index + 1;
    const row = byRank.get(rank);
    return row
      ? { label: row.label, value: row.value }
      : { label: String(rank) + ". Not verified", value: "No source-backed entry returned" };
  });
  const summary = rows.length === requestedCount
    ? "Complete ranked list assembled from grounded search results. Open the source links to review the original tables."
    : "Only " + rows.length + " of " + requestedCount + " entries were recoverable. Missing ranks are marked unverified—not invented.";
  return {
    type: "key_details",
    title: "Top " + requestedCount + " results",
    summary: summary.slice(0, 180),
    details,
    sources
  };
}
