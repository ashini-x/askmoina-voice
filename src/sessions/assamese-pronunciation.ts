/**
 * Source-attributed Assamese pronunciation rules loaded from D1.
 *
 * This is a small pronunciation-rule reference, not an audio corpus or a
 * trained pronunciation model. Research-backed regional notes stay explicitly
 * unverified until Upper Assam native speakers evaluate them.
 */
export interface AssamesePronunciationRuleRow {
  rule_id: string;
  title: string;
  dialect_scope: string;
  position_scope: string;
  guidance: string;
  examples: string | null;
  source_title: string;
  evidence_status: string;
  native_verified: number;
  priority: number;
}

const MAX_RULES = 12;
const MAX_GUIDANCE_CHARS = 5_000;

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, maximum);
}

/**
 * Builds a compact prompt appendix from our curated rules table.
 * A missing/unmigrated database must never prevent a voice session from starting.
 */
export async function buildAssamesePronunciationInstruction(
  db: Pick<D1Database, "prepare"> | undefined,
): Promise<string> {
  if (!db) return "";

  try {
    const result = await db
      .prepare(
        `SELECT rule_id, title, dialect_scope, position_scope, guidance, examples,
                source_title, evidence_status, native_verified, priority
         FROM assamese_pronunciation_rules
         WHERE enabled = 1
         ORDER BY priority ASC, rule_id ASC
         LIMIT ${MAX_RULES}`,
      )
      .all<AssamesePronunciationRuleRow>();

    const rules = Array.isArray(result.results) ? result.results : [];
    if (!rules.length) return "";

    const lines = [
      "UPPER ASSAM ASSAMESE PRONUNCIATION REFERENCE (source-attributed rule database):",
      "- Use these notes as phonetic guidance, not as literal character substitutions. Never speak IPA notation, slash-delimited phonemes, or bracketed examples to the user.",
      "- Apply Assamese sound patterns only to words identified as Assamese. Preserve conventional English pronunciation in English words inside Assamese-English code-switching.",
      "- Apply word-specific guidance before broad phonology. A pronunciation target reported by an AskMoina listener should be followed for that exact word when targeting their preferred regional style, even if it differs from a general baseline; do not generalize it to similar-looking words.",
      "- Seed rules without native-speaker verification are not proof of a community-wide norm. Honor explicit lexeme-specific user targets as product preferences while keeping them scoped to the reported word.",
    ];

    for (const rule of rules) {
      const title = safeText(rule.title, 140);
      const scope = safeText(rule.dialect_scope, 110);
      const position = safeText(rule.position_scope, 80);
      const guidance = safeText(rule.guidance, 850);
      const examples = safeText(rule.examples, 260);
      const source = safeText(rule.source_title, 180);
      if (!title || !guidance) continue;

      const verification = Number(rule.native_verified) === 1
        ? "native-speaker verified"
        : "not yet locally verified";
      const parts = [
        `- ${title} [scope: ${scope || "Assamese"}; position: ${position || "general"}; ${verification}]: ${guidance}`,
        examples ? `Examples: ${examples}` : "",
        source ? `Evidence: ${source}` : "",
      ].filter(Boolean);
      lines.push(parts.join(" "));
    }

    return lines.join("\n").slice(0, MAX_GUIDANCE_CHARS);
  } catch {
    // During a staged migration or local test without D1, retain the base prompt.
    return "";
  }
}
