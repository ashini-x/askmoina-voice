export type GroundedDeviceContext = {
  manufacturer: string;
  model_id: string;
  variant: string;
  part_number: string;
  requested_material: string;
};

const MATERIALS = new Set(["manual", "diagram", "troubleshooting", "recall", "compatibility", "general"]);

const KNOWN_OFFICIAL_DOMAINS: Record<string, string[]> = {
  apple: ["apple.com"],
  samsung: ["samsung.com"],
  dell: ["dell.com"],
  hp: ["hp.com"],
  "hewlett packard": ["hp.com"],
  lenovo: ["lenovo.com"],
  asus: ["asus.com"],
  acer: ["acer.com"],
  microsoft: ["microsoft.com"],
  google: ["google.com"],
  xiaomi: ["mi.com", "xiaomi.com"],
  sony: ["sony.com"],
  lg: ["lg.com"],
  canon: ["canon.com"],
  epson: ["epson.com"],
  brother: ["brother.com"],
  panasonic: ["panasonic.com"],
  intel: ["intel.com"],
  amd: ["amd.com"],
  nvidia: ["nvidia.com"]
};

/** Keep displayed grounding links on secure, ordinary HTTPS pages. */
export function safeGroundedSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || !host || url.username || url.password) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Exact known-domain comparison is stronger than matching a manufacturer word in a
 * hostname, but it still does not prove the page contents are applicable to a device.
 * Unknown manufacturers deliberately remain unverified.
 */
export function isKnownOfficialManufacturerHost(uri: string, manufacturer: string): boolean {
  const clean = (value: string): string => value.normalize("NFKD").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:inc|incorporated|ltd|limited|corporation|corp|company|co)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const domains = KNOWN_OFFICIAL_DOMAINS[clean(manufacturer)];
  if (!domains) return false;
  const safeUrl = safeGroundedSourceUrl(uri);
  if (!safeUrl) return false;
  const hostname = new URL(safeUrl).hostname.toLocaleLowerCase().replace(/\.$/, "");
  return domains.some((domain) => hostname === domain || hostname.endsWith("." + domain));
}

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
  officialManufacturerHostMatch: boolean;
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
    if (url.protocol === "https:" && !url.username && !url.password) hostLabels = url.hostname.toLocaleLowerCase().split(".");
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
    officialManufacturerHostMatch: isKnownOfficialManufacturerHost(uri, context.manufacturer || ""),
    note
  };
}
