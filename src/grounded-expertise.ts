export type GroundedDeviceContext = {
  manufacturer: string;
  model_id: string;
  variant: string;
  part_number: string;
  requested_material: string;
};

const MATERIALS = new Set(["manual", "diagram", "troubleshooting", "recall", "compatibility", "general"]);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

export function normalizeGroundedDeviceContext(raw: unknown): GroundedDeviceContext {
  const empty: GroundedDeviceContext = {
    manufacturer: "",
    model_id: "",
    variant: "",
    part_number: "",
    requested_material: ""
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const value = raw as Record<string, unknown>;
  const material = cleanText(value.requested_material, 24);
  return {
    manufacturer: cleanText(value.manufacturer, 80),
    model_id: cleanText(value.model_id, 80),
    variant: cleanText(value.variant, 80),
    part_number: cleanText(value.part_number, 80),
    requested_material: MATERIALS.has(material) ? material : ""
  };
}

export function assessGroundedSource(
  title: string,
  uri: string,
  context: Partial<GroundedDeviceContext>
): {
  modelTextMatch: "visible_in_title_or_url" | "not_established";
  manufacturerHostHint: boolean;
  note: string;
} {
  const clean = (value: string): string => value.normalize("NFKD").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  const text = clean(title + " " + uri);
  const identifiers = [context.model_id || "", context.variant || "", context.part_number || ""]
    .filter((value) => value.trim().length >= 4)
    .map(clean);
  const allIdentifiersVisible = identifiers.length > 0 && identifiers.every((identifier) => identifier && text.includes(identifier));
  const manufacturerTokens = clean(context.manufacturer || "").split(" ").filter((token) => token.length >= 4);
  let hostLabels: string[] = [];
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" || url.protocol === "http:") hostLabels = url.hostname.toLocaleLowerCase().split(".");
  } catch {}
  const hostBrandHint = manufacturerTokens.some((token) => hostLabels.includes(token));
  let note: string;
  if (identifiers.length && allIdentifiersVisible) {
    note = "requested model/variant text appears in the source title or URL; the page content still requires inspection";
  } else if (identifiers.length) {
    note = "exact model/variant match is not established by the source title or URL";
  } else {
    note = "no exact model identifier was provided; model-specific applicability is unverified";
  }
  if (hostBrandHint) note += "; hostname match is a heuristic only; it does not verify domain ownership";
  return {
    modelTextMatch: allIdentifiersVisible ? "visible_in_title_or_url" : "not_established",
    manufacturerHostHint: hostBrandHint,
    note
  };
}
