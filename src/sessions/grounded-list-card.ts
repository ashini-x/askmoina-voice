export type GroundedListCard = {
  type: "key_details";
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  sources: Array<{ title: string; url: string }>;
};

export type GroundedRankedRow = { rank: number; label: string; value: string };

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};
const COUNT_PATTERN = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)";

function toCount(value: string): number | null {
  const token = String(value || "").trim().toLowerCase();
  const count = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
  return Number.isInteger(count) && count >= 2 && count <= 10 ? count : null;
}

/** Resolve the requested visible list size from common natural-language forms. */
export function getRequestedRankedListCount(query: string): number | null {
  const text = String(query || "").replace(/\s+/g, " ").trim();
  const patterns = [
    new RegExp("\\btop[\\s-]*" + COUNT_PATTERN + "\\b", "i"),
    new RegExp("\\b(?:all|every|first)\\s+(?:the\\s+)?" + COUNT_PATTERN + "\\b", "i"),
    new RegExp("\\b(?:full|complete|entire|whole)\\s+(?:ranked\\s+)?list(?:\\s+of)?\\s+(?:all\\s+)?" + COUNT_PATTERN + "\\b", "i"),
    new RegExp("\\b(?:show|display|list|give|include|return)\\b.{0,40}\\b(?:all\\s+)?" + COUNT_PATTERN + "\\s+(?:results|entries|items|players|names|rankers|rows|options|steps)\\b", "i")
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    for (let index = 1; index < match.length; index += 1) {
      const count = toCount(match[index] || "");
      if (count !== null) return count;
    }
  }
  return null;
}

function cleanRowText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(new RegExp(String.fromCharCode(96), "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse grounded numbered lists and Markdown table rows without inventing facts. */
export function extractGroundedRankedRows(text: string, requestedCount: number): GroundedRankedRow[] {
  const answer = String(text || "").split(/\n\s*(?:sources?|source links):/i)[0];
  const found = new Map<number, GroundedRankedRow>();
  for (const rawLine of answer.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;

    let rank = 0;
    let body = "";
    const tableRow = line.match(/^\|?\s*(\d{1,2})\s*\|(.+?)\|?\s*$/);
    if (tableRow) {
      rank = Number(tableRow[1]);
      body = (tableRow[2] || "").split("|").map(cleanRowText).filter(Boolean).join(" — ");
    } else {
      const numbered = line.match(/^(?:[-*]\s*)?(?:rank\s*)?(?:#\s*)?(?:\*\*)?(\d{1,2})[.)]?\s*[:.)—-]?\s+(.+?)\s*$/i);
      if (!numbered) continue;
      rank = Number(numbered[1]);
      body = numbered[2];
    }
    if (rank < 1 || rank > requestedCount || found.has(rank)) continue;

    body = cleanRowText(body).replace(/^[-–—|:]+\s*/, "").trim();
    if (!body || body.length > 350 || /^(rank|player|name|team|runs|wickets|score|result)s?$/i.test(body)) continue;
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
  const section = String(text || "").split(/\n\s*Sources?:\s*\n/i).slice(1).join("\n");
  const found: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /^\s*[-*]\s*(.{1,180}?):\s*(https:\/\/\S+)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) && found.length < 4) {
    const title = cleanRowText(match[1]).slice(0, 100);
    const url = match[2].replace(/[),.;]+$/, "");
    if (!title || !/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    found.push({ title, url });
  }
  return found;
}

/**
 * Merge a targeted retry with the first grounded ranked-list attempt.
 * Prefer the retry's wording for duplicate ranks, while preserving still-useful
 * source-backed ranks from the first answer. Source sections are removed here;
 * the Worker attaches the union of actual grounding metadata URLs separately.
 */
export function mergeGroundedRankedListAttempts(firstAttempt: string, retryAttempt: string): string {
  const rankedSection = (value: string) =>
    String(value || "").split(/\\n\\s*(?:sources?|source links):/i)[0].trim();
  return [rankedSection(retryAttempt), rankedSection(firstAttempt)].filter(Boolean).join("\\n");
}

/** Build a designed fallback card from grounded results; missing positions remain explicitly unverified. */
export function buildGroundedListCard(query: string, groundedResult: string): GroundedListCard | null {
  const requestedCount = getRequestedRankedListCount(query);
  if (!requestedCount) return null;
  const sources = extractGroundedSources(groundedResult);
  if (!sources.length) return null;
  const rows = extractGroundedRankedRows(groundedResult, requestedCount);
  if (!rows.length) return null;

  const byRank = new Map<number, GroundedRankedRow>(rows.map((row): [number, GroundedRankedRow] => [row.rank, row]));
  const details = Array.from({ length: requestedCount }, (_, index) => {
    const rank = index + 1;
    const row = byRank.get(rank);
    return row
      ? { label: row.label, value: row.value }
      : { label: String(rank) + ". Not verified", value: "No source-backed entry returned" };
  });
  const complete = details.every((row) => !row.label.endsWith("Not verified")) &&
    rows.length === requestedCount && rows.every((row, index) => row.rank === index + 1);
  return {
    type: "key_details",
    title: "Top " + requestedCount + " results",
    summary: complete
      ? "Complete ranked list assembled from grounded search results. Open the source links to review the original tables."
      : "Only " + rows.length + " of " + requestedCount + " entries were recoverable. Missing ranks are marked unverified—not invented.",
    details,
    sources
  };
}
