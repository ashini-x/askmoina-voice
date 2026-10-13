export type ResponseCard =
  | { type: "steps"; title: string; summary?: string; steps: Array<{ label: string; instruction: string }> }
  | { type: "key_details"; title: string; summary?: string; details: Array<{ label: string; value: string; unit?: string }>; sources?: Array<{ title: string; url: string }> }
  | { type: "comparison"; title: string; summary?: string; options: Array<{ name: string; attributes: Array<{ label: string; value: string }> }>; takeaway?: string };

export type ResponseCardValidation =
  | { valid: true; card: ResponseCard }
  | { valid: false; reason: string };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_PAYLOAD_CHARS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > maxLength || CONTROL_CHARACTERS.test(text)) return null;
  return text;
}

function optionalText(value: unknown, maxLength: number): { ok: boolean; value?: string } {
  if (value === undefined) return { ok: true };
  const text = cleanText(value, maxLength);
  return text === null ? { ok: false } : { ok: true, value: text };
}

function invalid(reason: string): ResponseCardValidation {
  return { valid: false, reason };
}

/** Strict RC2 contract validation. Values are plain text data, never markup. */
export function validateResponseCard(value: unknown): ResponseCardValidation {
  if (!isRecord(value)) return invalid("payload_must_be_object");
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { return invalid("payload_not_serializable"); }
  if (!encoded || encoded.length > MAX_PAYLOAD_CHARS) return invalid("payload_too_large");

  const type = value.type;
  const title = cleanText(value.title, 80);
  const summary = optionalText(value.summary, 180);
  if (title === null) return invalid("invalid_title");
  if (!summary.ok) return invalid("invalid_summary");
  const base = { title, ...(summary.value ? { summary: summary.value } : {}) };

  if (type === "steps") {
    if (!exactKeys(value, ["type", "title", "summary", "steps"])) return invalid("unexpected_steps_fields");
    if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 5) return invalid("invalid_steps_count");
    const steps: Array<{ label: string; instruction: string }> = [];
    for (const item of value.steps) {
      if (!isRecord(item) || !exactKeys(item, ["label", "instruction"])) return invalid("invalid_step_shape");
      const label = cleanText(item.label, 60);
      const instruction = cleanText(item.instruction, 180);
      if (label === null || instruction === null) return invalid("invalid_step_text");
      steps.push({ label, instruction });
    }
    return { valid: true, card: { type, ...base, steps } };
  }

  if (type === "key_details") {
    if (!exactKeys(value, ["type", "title", "summary", "details", "sources"])) return invalid("unexpected_key_details_fields");
    if (!Array.isArray(value.details) || value.details.length < 1 || value.details.length > 10) return invalid("invalid_details_count");
    const details: Array<{ label: string; value: string; unit?: string }> = [];
    for (const item of value.details) {
      if (!isRecord(item) || !exactKeys(item, ["label", "value", "unit"])) return invalid("invalid_detail_shape");
      const label = cleanText(item.label, 60);
      const detailValue = cleanText(item.value, 180);
      const unit = optionalText(item.unit, 32);
      if (label === null || detailValue === null || !unit.ok) return invalid("invalid_detail_text");
      details.push({ label, value: detailValue, ...(unit.value ? { unit: unit.value } : {}) });
    }
    const sources: Array<{ title: string; url: string }> = [];
    if (value.sources !== undefined) {
      if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 4) {
        return invalid("invalid_sources_count");
      }
      for (const item of value.sources) {
        if (!isRecord(item) || !exactKeys(item, ["title", "url"])) return invalid("invalid_source_shape");
        const sourceTitle = cleanText(item.title, 100);
        const sourceUrl = cleanText(item.url, 500);
        if (sourceTitle === null || sourceUrl === null) return invalid("invalid_source_text");
        let parsedUrl: URL;
        try { parsedUrl = new URL(sourceUrl); } catch { return invalid("invalid_source_url"); }
        if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) return invalid("invalid_source_url");
        sources.push({ title: sourceTitle, url: parsedUrl.href });
      }
    }
    return { valid: true, card: { type, ...base, details, ...(sources.length ? { sources } : {}) } };
  }

  if (type === "comparison") {
    if (!exactKeys(value, ["type", "title", "summary", "options", "takeaway"])) return invalid("unexpected_comparison_fields");
    const takeaway = optionalText(value.takeaway, 180);
    if (!takeaway.ok) return invalid("invalid_takeaway");
    if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4) return invalid("invalid_options_count");
    const options: Array<{ name: string; attributes: Array<{ label: string; value: string }> }> = [];
    for (const option of value.options) {
      if (!isRecord(option) || !exactKeys(option, ["name", "attributes"])) return invalid("invalid_option_shape");
      const name = cleanText(option.name, 70);
      if (name === null || !Array.isArray(option.attributes) || option.attributes.length < 1 || option.attributes.length > 8) return invalid("invalid_option");
      const attributes: Array<{ label: string; value: string }> = [];
      for (const attribute of option.attributes) {
        if (!isRecord(attribute) || !exactKeys(attribute, ["label", "value"])) return invalid("invalid_attribute_shape");
        const label = cleanText(attribute.label, 50);
        const attributeValue = cleanText(attribute.value, 120);
        if (label === null || attributeValue === null) return invalid("invalid_attribute_text");
        attributes.push({ label, value: attributeValue });
      }
      options.push({ name, attributes });
    }
    return { valid: true, card: { type, ...base, options, ...(takeaway.value ? { takeaway: takeaway.value } : {}) } };
  }

  return invalid("unsupported_card_type");
}

export const DISPLAY_RESPONSE_CARD_FUNCTION = {
  name: "display_response_card",
  description: "Mandatory for an explicit request such as 'make a response card with three steps for organizing pens': call this function with type=steps and 2–5 short, safe actions. Use also for useful multi-step plans, exact reference details, grounded comparisons, and proactive ranked/top-10 lists; a top-10 list should use type=key_details with one entry per rank. The client displays validated data in a compact generic response-card tray; after acknowledgement, continue with concise spoken guidance. Never imply that a rendered card means the user completed an action. Separate from camera overlays. Keep values concise and safe. Do not call for greetings or one-line factual answers.",
  parameters: {
    type: "OBJECT",
    properties: {
      type: { type: "STRING", enum: ["steps", "key_details", "comparison"], description: "The single supported response-card layout." },
      title: { type: "STRING", description: "Short plain-text title, maximum 80 characters." },
      summary: { type: "STRING", description: "Optional plain-text summary, maximum 180 characters." },
      steps: {
        type: "ARRAY",
        description: "For type=steps only: 2–5 ordered low-risk steps, with no completion/checkmark state.",
        items: { type: "OBJECT", properties: {
          label: { type: "STRING", description: "Short step label, maximum 60 characters." },
          instruction: { type: "STRING", description: "One concise instruction, maximum 180 characters." }
        }, required: ["label", "instruction"] }
      },
      details: {
        type: "ARRAY",
        description: "For type=key_details only: 1–10 labelled facts, ranking rows, or values.",
        items: { type: "OBJECT", properties: {
          label: { type: "STRING", description: "Field label, maximum 60 characters." },
          value: { type: "STRING", description: "Plain-text value, maximum 180 characters." },
          unit: { type: "STRING", description: "Optional unit, maximum 32 characters." }
        }, required: ["label", "value"] }
      },
      sources: {
        type: "ARRAY",
        description: "Optional for type=key_details only: 1–4 grounded source records. When a web search was used, include source titles and full HTTPS URLs returned by the search tool. Do not invent URLs.",
        items: { type: "OBJECT", properties: {
          title: { type: "STRING", description: "Readable source title, maximum 100 characters." },
          url: { type: "STRING", description: "Full HTTPS URL returned by the search tool, maximum 500 characters." }
        }, required: ["title", "url"] }
      },
      options: {
        type: "ARRAY",
        description: "For type=comparison only: 2–4 grounded options, each with 1–8 comparable attributes.",
        items: { type: "OBJECT", properties: {
          name: { type: "STRING", description: "Option name, maximum 70 characters." },
          attributes: { type: "ARRAY", items: { type: "OBJECT", properties: {
            label: { type: "STRING", description: "Attribute label, maximum 50 characters." },
            value: { type: "STRING", description: "Attribute value, maximum 120 characters." }
          }, required: ["label", "value"] } }
        }, required: ["name", "attributes"] }
      },
      takeaway: { type: "STRING", description: "Optional evidence-grounded takeaway, maximum 180 characters." }
    },
    required: ["type", "title"]
  }
};
