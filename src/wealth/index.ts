import type { Env } from "../config/env";

type NavPoint = { date: string; nav: number };
type SchemeMeta = {
  scheme_code?: number;
  scheme_name?: string;
  fund_house?: string;
  scheme_category?: string;
  isin_growth?: string | null;
};
type NavResponse = { meta?: SchemeMeta; data?: Array<{ date?: string; nav?: string }>; status?: string };
type SchemeSearchItem = { schemeCode?: number; schemeName?: string };

const MFAPI_BASE = "https://api.mfapi.in";
const MAX_PLANS = 6;
const MAX_INSTALLMENTS = 100;
const NAV_LOOKAHEAD_DAYS = 7;
const NAV_SOURCE = "MFAPI.in";
const NAV_ATTRIBUTION = "Third-party aggregator of AMFI-published mutual-fund NAV data; verify against AMFI before any non-simulated use.";


type DemoStock = { symbol: string; name: string; securityId: string; quantity: number; purchaseDate: string };
type DemoFund = { schemeCode: number; monthlyAmountPaise: number; startDate: string; sipDay: number };
const DEMO_STOCKS: DemoStock[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", securityId: "2885", quantity: 4, purchaseDate: "2022-01-03" },
  { symbol: "HDFCBANK", name: "HDFC Bank", securityId: "1333", quantity: 8, purchaseDate: "2022-02-07" },
  { symbol: "TCS", name: "Tata Consultancy Services", securityId: "11536", quantity: 2, purchaseDate: "2022-03-07" },
  { symbol: "INFY", name: "Infosys", securityId: "1594", quantity: 6, purchaseDate: "2022-04-11" },
];
const DEMO_FUNDS: DemoFund[] = [
  { schemeCode: 122639, monthlyAmountPaise: 300_000, startDate: "2023-01-01", sipDay: 5 },
  { schemeCode: 125497, monthlyAmountPaise: 200_000, startDate: "2023-03-01", sipDay: 10 },
];
type PricePoint = { date: string; close: number };
type DhanHistoryResponse = { close?: unknown[]; timestamp?: unknown[] };

function pickFirstCloseAtOrAfter(points: PricePoint[], requestedDate: string, maxDays = 7): PricePoint | null {
  const lastAllowed = isoDaysAfter(requestedDate, maxDays);
  return points.find((point) => point.date >= requestedDate && point.date <= lastAllowed) || null;
}
function parseCsvTable(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length < 2) throw new Error("dhan_instrument_master_empty");
  const headers = rows[0].map((header) => header.trim());
  const required = ["SEM_EXM_EXCH_ID", "SEM_SEGMENT", "SEM_SMST_SECURITY_ID", "SEM_INSTRUMENT_NAME", "SEM_TRADING_SYMBOL"];
  if (required.some((header) => !headers.includes(header))) throw new Error("dhan_instrument_master_schema_invalid");
  return rows.slice(1).map((values) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => { item[header] = (values[index] || "").trim(); });
    return item;
  });
}
function validateDemoSecurityIds(rows: Array<Record<string, string>>): boolean {
  return DEMO_STOCKS.every((stock) => rows.some((row) =>
    row.SEM_EXM_EXCH_ID === "NSE" && row.SEM_SEGMENT === "E" &&
    row.SEM_INSTRUMENT_NAME === "EQUITY" &&
    row.SEM_TRADING_SYMBOL === stock.symbol &&
    row.SEM_SMST_SECURITY_ID === stock.securityId
  ));
}
async function fetchDhanInstrumentMaster(): Promise<void> {
  const url = "https://images.dhan.co/api-data/api-scrip-master.csv";
  const key = new Request(url, { method: "GET" });
  try {
    // Cache only a master that has already passed all four exact symbol/ID checks.
    if (await caches.default.match(key)) return;
  } catch {
    // Cache miss: fetch the official instrument master below.
  }
  const upstream = await fetch(url, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) throw new Error("dhan_instrument_master_http_" + upstream.status);
  const rows = parseCsvTable(await upstream.text());
  if (!validateDemoSecurityIds(rows)) throw new Error("dhan_instrument_master_mapping_changed");
  try {
    await caches.default.put(key, new Response("validated", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=21600" },
    }));
  } catch { /* Instrument cache is an optimization only. */ }
}
function normalizeDhanHistory(payload: DhanHistoryResponse, fromDate: string, toDate: string): PricePoint[] {
  if (!Array.isArray(payload.close) || !Array.isArray(payload.timestamp) ||
      payload.close.length !== payload.timestamp.length || payload.close.length > 2_000) {
    throw new Error("dhan_stock_history_response_invalid");
  }
  const points = payload.close.flatMap((close, index) => {
    const price = Number(close), timestamp = Number(payload.timestamp?.[index]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return [];
    const date = indiaDateFromEpochSeconds(timestamp);
    if (!date || date < fromDate || date >= toDate) return [];
    return [{ date, close: price }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const deduplicated = new Map<string, PricePoint>();
  points.forEach((point) => deduplicated.set(point.date, point));
  const normalized = Array.from(deduplicated.values());
  if (normalized.length < 2) throw new Error("dhan_stock_history_empty");
  return normalized;
}
async function fetchDhanStockHistory(position: DemoStock, today: string, accessToken: string): Promise<PricePoint[]> {
  const fromDate = position.purchaseDate, toDate = isoDaysAfter(today, 1);
  const upstream = await fetch("https://api.dhan.co/v2/charts/historical", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": accessToken },
    body: JSON.stringify({
      securityId: position.securityId, exchangeSegment: "NSE_EQ", instrument: "EQUITY",
      expiryCode: 0, oi: false, fromDate, toDate,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) throw new Error("dhan_stock_history_http_" + upstream.status);
  return normalizeDhanHistory(await upstream.json() as DhanHistoryResponse, fromDate, toDate);
}
async function fetchDemoFundHistory(plan: DemoFund, today: string): Promise<{ meta: SchemeMeta; points: NavPoint[] }> {
  const payload = await mfapi("/mf/" + plan.schemeCode + "?startDate=" + plan.startDate + "&endDate=" + today) as NavResponse;
  const normalized = normalizeNavHistory(payload, plan.schemeCode);
  if (!isGrowthOption(normalized.meta)) throw new Error("demo_growth_option_invalid");
  return normalized;
}
function valueDemoStock(position: DemoStock, points: PricePoint[], asOfDate: string) {
  const usablePoints = points.filter((point) => point.date <= asOfDate);
  const latest = usablePoints[usablePoints.length - 1];
  const purchase = pickFirstCloseAtOrAfter(usablePoints, position.purchaseDate);
  if (!latest || !purchase || !isFreshNavDate(latest.date, todayInIndia())) throw new Error("demo_stock_price_unavailable");
  // Dhan says its daily history is bonus/split adjusted. Demo quantities are
  // share-equivalent units on that adjusted basis; cash dividends are excluded.
  const invested = position.quantity * purchase.close, marketValue = position.quantity * latest.close;
  const investedPaise = Math.round(invested * 100), marketValuePaise = Math.round(marketValue * 100);
  return {
    symbol: position.symbol, name: position.name, quantity: position.quantity,
    purchaseDate: purchase.date, purchasePrice: purchase.close,
    latestPrice: latest.close, latestPriceDate: latest.date,
    investedPaise, marketValuePaise, currentValuePaise: marketValuePaise,
    profitLossPaise: marketValuePaise - investedPaise,
    absoluteReturn: investedPaise > 0 ? (marketValuePaise - investedPaise) / investedPaise : null,
    xirr: xirr([{ date: purchase.date, amount: -invested }, { date: latest.date, amount: marketValue }]),
    priceSeries: usablePoints.slice(-120), source: "DhanHQ historical daily candles",
  };
}
function valueDemoFund(plan: DemoFund, history: { meta: SchemeMeta; points: NavPoint[] }, asOfDate: string) {
  const points = history.points.filter((point) => point.date <= asOfDate), latest = points[points.length - 1];
  if (!latest || !isFreshNavDate(latest.date, todayInIndia())) throw new Error("demo_fund_nav_unavailable");
  const schedule = buildSipSchedule(plan.startDate, asOfDate, plan.sipDay);
  let investedPaise = 0, units = 0, missedCount = 0, pendingCount = 0, pricedInstallmentCount = 0;
  const flows: Array<{ date: string; amount: number }> = [];
  for (const date of schedule) {
    const nav = pickNextNav(points, date, asOfDate);
    if (!nav) {
      if (asOfDate <= isoDaysAfter(date, NAV_LOOKAHEAD_DAYS)) pendingCount += 1;
      else missedCount += 1;
      continue;
    }
    units += (plan.monthlyAmountPaise / 100) / nav.nav;
    investedPaise += plan.monthlyAmountPaise;
    pricedInstallmentCount += 1;
    flows.push({ date, amount: -(plan.monthlyAmountPaise / 100) });
  }
  const currentValuePaise = Math.round(units * latest.nav * 100), profitLossPaise = currentValuePaise - investedPaise;
  if (currentValuePaise > 0) flows.push({ date: latest.date, amount: currentValuePaise / 100 });
  return {
    schemeCode: plan.schemeCode, schemeName: history.meta.scheme_name || "Unknown scheme",
    fundHouse: history.meta.fund_house || null, category: history.meta.scheme_category || null,
    monthlyAmountPaise: plan.monthlyAmountPaise, sipDay: plan.sipDay, startDate: plan.startDate,
    units, latestNav: latest.nav, latestNavDate: latest.date, installmentCount: schedule.length,
    pricedInstallmentCount, missedCount, pendingCount, investedPaise, currentValuePaise, profitLossPaise,
    absoluteReturn: investedPaise > 0 ? profitLossPaise / investedPaise : null, xirr: xirr(flows), source: NAV_SOURCE,
  };
}
async function handleDemoPortfolio(env: Env): Promise<Response> {
  const today = todayInIndia();
  let stockDataStatus: "ready" | "disabled" | "not_configured" | "unavailable" = "disabled";
  let stockDataMessage = "Dhan Data API is not enabled. Sample quantities and dates are visible, but no stock prices or returns are shown.";
  let stockHistories: PricePoint[][] = [];
  const accessToken = env.DHAN_ACCESS_TOKEN?.trim(), stockEnabled = env.WEALTH_DHAN_ENABLED === "true";
  if (stockEnabled && !accessToken) {
    stockDataStatus = "not_configured";
    stockDataMessage = "Add a valid Dhan Data API access token as the server-side DHAN_ACCESS_TOKEN secret. No stock prices are fabricated.";
  } else if (stockEnabled && accessToken) {
    try {
      await fetchDhanInstrumentMaster();
      stockHistories = await Promise.all(DEMO_STOCKS.map((position) => fetchDhanStockHistory(position, today, accessToken)));
      stockDataStatus = "ready";
      stockDataMessage = "DhanHQ daily candles · bonus/split-adjusted historical prices. Cash dividends are excluded.";
    } catch (error) {
      stockDataStatus = "unavailable";
      stockDataMessage = "Dhan historical prices could not be verified. Check the Data API subscription and token expiry; stock values are withheld.";
      console.error("[wealth] Dhan demo history unavailable", error instanceof Error ? error.message : "unknown");
      stockHistories = [];
    }
  }
  try {
    const fundHistories = await Promise.all(DEMO_FUNDS.map((plan) => fetchDemoFundHistory(plan, today)));
    const stockLatestDates = stockDataStatus === "ready"
      ? stockHistories.map((history) => history[history.length - 1]?.date) : [];
    const latestDates = [
      ...fundHistories.map((history) => history.points[history.points.length - 1]?.date),
      ...stockLatestDates,
    ];
    if (latestDates.some((date) => !date || !validIsoDate(date) || !isFreshNavDate(date, today))) throw new Error("demo_market_data_stale");
    const asOfDate = [...latestDates].sort()[0] as string;
    const funds = DEMO_FUNDS.map((plan, index) => valueDemoFund(plan, fundHistories[index], asOfDate));
    const stocks = stockDataStatus === "ready"
      ? DEMO_STOCKS.map((position, index) => valueDemoStock(position, stockHistories[index], asOfDate))
      : [];
    const valuationComplete = stocks.length === DEMO_STOCKS.length;
    const fundsInvestedPaise = funds.reduce((sum, item) => sum + item.investedPaise, 0);
    const fundsCurrentValuePaise = funds.reduce((sum, item) => sum + item.currentValuePaise, 0);
    const investedPaise = valuationComplete ? fundsInvestedPaise + stocks.reduce((sum, item) => sum + item.investedPaise, 0) : null;
    const currentValuePaise = valuationComplete ? fundsCurrentValuePaise + stocks.reduce((sum, item) => sum + item.currentValuePaise, 0) : null;
    const profitLossPaise = currentValuePaise === null || investedPaise === null ? null : currentValuePaise - investedPaise;
    const stockFlows = stocks.flatMap((item) => [
      { date: item.purchaseDate, amount: -item.investedPaise / 100 },
      { date: asOfDate, amount: item.marketValuePaise / 100 },
    ]);
    const fundFlows = funds.flatMap((fund, index) => {
      const plan = DEMO_FUNDS[index], points = fundHistories[index].points.filter((point) => point.date <= asOfDate);
      const paid = buildSipSchedule(plan.startDate, asOfDate, plan.sipDay).flatMap((date) =>
        pickNextNav(points, date, asOfDate) ? [{ date, amount: -plan.monthlyAmountPaise / 100 }] : []);
      return [...paid, { date: asOfDate, amount: fund.currentValuePaise / 100 }];
    });
    return response({
      ok: true, mode: "static_demo_with_live_market_data", title: "Sample portfolio", asOfDate,
      valuationComplete, investedPaise, currentValuePaise, profitLossPaise,
      absoluteReturn: investedPaise && profitLossPaise !== null ? profitLossPaise / investedPaise : null,
      xirr: valuationComplete ? xirr([...stockFlows, ...fundFlows]) : null,
      fundsInvestedPaise, fundsCurrentValuePaise, funds, stocks,
      sampleStockLots: DEMO_STOCKS.map(({ symbol, name, quantity, purchaseDate }) => ({ symbol, name, quantity, purchaseDate })),
      stockDataStatus, stockDataMessage,
      providers: {
        stocks: "DhanHQ historical daily candles · bonus/split-adjusted · cash dividends excluded",
        mutualFunds: NAV_SOURCE + " · third-party aggregator of AMFI-published daily NAVs",
      },
      sampleDataNotice: "Sample share-equivalent quantities, purchase dates and SIP contributions are fixed demonstration inputs. They are not the signed-in user's actual holdings, purchases, bank records or SIP mandates. Stock prices and fund NAVs are fetched from external providers. No payments, orders or SIP mandates are created.",
      disclaimer: "Personal demonstration only. Dhan says daily historical candles are adjusted for bonuses and splits; cash dividends are excluded from stock returns. Mutual-fund NAVs are supplied by MFapi.in and should be reconciled against AMFI. Sample holdings and SIPs are hypothetical, not proof of ownership, investment advice, execution prices, tax statements, actual transactions or mandates.",
    });
  } catch (error) {
    console.error("[wealth] demo NAV data unavailable", error instanceof Error ? error.message : "unknown");
    return response({ ok: false, error: "demo_market_data_unavailable", message: "A live mutual-fund NAV could not be verified. The demo snapshot is withheld rather than showing guessed values." }, 502);
  }
}

function response(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

function badRequest(code: string, status = 400, details?: unknown): Response {
  return response({ ok: false, error: code, ...(details === undefined ? {} : { details }) }, status);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseNavDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{2}-\d{2}-\d{4}$/.test(value)) return null;
  const parts = value.split("-");
  const iso = parts[2] + "-" + parts[1] + "-" + parts[0];
  return validIsoDate(iso) ? iso : null;
}

function isoDaysAfter(iso: string, days: number): string {
  const date = new Date(iso + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayInIndia(now = new Date()): string {
  // India uses UTC+05:30 year-round; avoid a server's UTC date boundary.
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function indiaDateFromEpochSeconds(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000 + 330 * 60_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

async function readJsonBounded(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request_too_large").catch(() => undefined);
        throw new Error("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

function buildSipSchedule(startDate: string, endDate: string, sipDay: number): string[] {
  const result: string[] = [];
  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T00:00:00.000Z");
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (Date.UTC(year, month, 1) <= end.getTime() && result.length <= MAX_INSTALLMENTS) {
    const candidate = new Date(Date.UTC(year, month, sipDay)).toISOString().slice(0, 10);
    if (candidate >= startDate && candidate <= endDate) result.push(candidate);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return result;
}

function normalizeNavHistory(payload: NavResponse, schemeCode: number): { meta: SchemeMeta; points: NavPoint[] } {
  const returnedCode = Number(payload?.meta?.scheme_code);
  if (!payload || payload.status !== "SUCCESS" || !payload.meta ||
      !Number.isSafeInteger(returnedCode) || returnedCode !== schemeCode || !Array.isArray(payload.data)) {
    throw new Error("nav_provider_response_invalid");
  }
  const points: NavPoint[] = [];
  for (const item of payload.data) {
    const date = parseNavDate(item?.date);
    const nav = Number(item?.nav);
    if (date && Number.isFinite(nav) && nav > 0) points.push({ date, nav });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const deduplicated = new Map<string, NavPoint>();
  for (const point of points) deduplicated.set(point.date, point);
  const normalized = Array.from(deduplicated.values());
  if (!normalized.length) throw new Error("nav_history_empty");
  return { meta: payload.meta, points: normalized };
}

function pickNextNav(points: NavPoint[], scheduledDate: string, today = todayInIndia()): NavPoint | null {
  const lastAllowed = isoDaysAfter(scheduledDate, NAV_LOOKAHEAD_DAYS);
  const effectiveEnd = today < lastAllowed ? today : lastAllowed;
  return points.find((point) => point.date >= scheduledDate && point.date <= effectiveEnd) || null;
}

function xirr(flows: Array<{ date: string; amount: number }>): number | null {
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const base = new Date(flows[0].date + "T00:00:00.000Z").getTime();
  const dated = flows.map((flow) => ({
    days: (new Date(flow.date + "T00:00:00.000Z").getTime() - base) / 86_400_000,
    amount: flow.amount,
  })).filter((flow) => Number.isFinite(flow.days) && Number.isFinite(flow.amount));
  const npv = (rate: number): number => dated.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.days / 365), 0);
  let low = -0.9999;
  let high = 100;
  let lowValue = npv(low);
  let highValue = npv(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let i = 0; i < 160; i += 1) {
    const middle = (low + high) / 2;
    const value = npv(middle);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-7) return middle;
    if (lowValue * value <= 0) {
      high = middle;
      highValue = value;
    } else {
      low = middle;
      lowValue = value;
    }
  }
  const result = (low + high) / 2;
  return Number.isFinite(result) ? result : null;
}

async function mfapi(path: string): Promise<unknown> {
  const url = MFAPI_BASE + path;
  const cacheKey = new Request(url, { method: "GET" });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return await cached.json();
  } catch {
    // Cache is an optimization only; the provider remains the source of truth.
  }
  const upstream = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AskMoina-Wealth/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!upstream.ok) throw new Error("nav_provider_http_" + upstream.status);
  const payload = await upstream.json() as unknown;
  const endDateParam = new URL(url).searchParams.get("endDate");
  const maxAge = path.includes("/latest")
    ? 900
    : path.includes("/search")
      ? 21_600
      : endDateParam && endDateParam >= todayInIndia()
        ? 900
        : 86_400;
  try {
    await caches.default.put(cacheKey, new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=" + maxAge,
      },
    }));
  } catch {
    // Never fail a NAV read because the edge cache is unavailable.
  }
  return payload;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function isGrowthOption(meta: SchemeMeta): boolean {
  const name = (meta.scheme_name || "").toLowerCase();
  return name.includes("growth") && !/(idcw|dividend|bonus)/i.test(name);
}

function isFreshNavDate(navDate: string, today: string, maxAgeDays = 7): boolean {
  if (!validIsoDate(navDate) || !validIsoDate(today) || navDate > today) return false;
  const ageDays = (new Date(today + "T00:00:00.000Z").getTime() - new Date(navDate + "T00:00:00.000Z").getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= maxAgeDays;
}

function parseSchemeCode(value: string): number | null {
  if (!/^\d{1,9}$/.test(value)) return null;
  const code = Number(value);
  return Number.isSafeInteger(code) && code > 0 ? code : null;
}

function validDhanDate(value: string): boolean {
  return validIsoDate(value);
}

async function handleFundSearch(url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2 || query.length > 80) return badRequest("query_must_be_2_to_80_characters");
  try {
    const data = await mfapi("/mf/search?q=" + encodeURIComponent(query));
    if (!Array.isArray(data)) return response({ ok: false, error: "nav_provider_response_invalid" }, 502);
    const schemes = (data as SchemeSearchItem[]).slice(0, 30).flatMap((item) => {
      const code = Number(item.schemeCode);
      const name = typeof item.schemeName === "string" ? item.schemeName.trim() : "";
      if (!Number.isSafeInteger(code) || code <= 0 || !name || name.length > 240 ||
          !name.toLowerCase().includes("growth") || /(idcw|dividend|bonus)/i.test(name)) return [];
      return [{ schemeCode: code, schemeName: name }];
    });
    return response({ ok: true, source: NAV_SOURCE, attribution: NAV_ATTRIBUTION, schemes });
  } catch (error) {
    console.error("[wealth] fund search failed", error instanceof Error ? error.message : "unknown");
    return response({ ok: false, error: "nav_provider_unavailable" }, 502);
  }
}

async function handleFundNav(url: URL, schemeCode: number): Promise<Response> {
  const fromDate = url.searchParams.get("fromDate") || "";
  const toDate = url.searchParams.get("toDate") || "";
  if (!validIsoDate(fromDate) || !validIsoDate(toDate) || fromDate > toDate) return badRequest("invalid_date_range");
  const spanDays = (new Date(toDate + "T00:00:00Z").getTime() - new Date(fromDate + "T00:00:00Z").getTime()) / 86_400_000;
  if (spanDays > 1_830) return badRequest("date_range_exceeds_five_years");
  try {
    const payload = await mfapi("/mf/" + schemeCode + "?startDate=" + fromDate + "&endDate=" + toDate) as NavResponse;
    const normalized = normalizeNavHistory(payload, schemeCode);
    const points = normalized.points.filter((point) => point.date >= fromDate && point.date <= toDate);
    return response({
      ok: true,
      scheme: {
        schemeCode,
        schemeName: normalized.meta.scheme_name || "Unknown scheme",
        fundHouse: normalized.meta.fund_house || null,
        category: normalized.meta.scheme_category || null,
      },
      source: NAV_SOURCE,
      attribution: NAV_ATTRIBUTION,
      fromDate,
      toDate,
      pointCount: points.length,
      nav: points,
    });
  } catch (error) {
    console.error("[wealth] fund NAV history failed", error instanceof Error ? error.message : "unknown");
    return response({ ok: false, error: "nav_history_unavailable" }, 502);
  }
}

type CreatePlan = {
  schemeCode: number;
  monthlyAmountPaise: number;
  startDate: string;
  endDate: string;
  sipDay: number;
};

async function createSimulation(request: Request, env: Env, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return badRequest("origin_mismatch", 403);
  const lengthHeader = request.headers.get("Content-Length");
  const length = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : 0;
  if (length > 24_000) return badRequest("request_too_large", 413);
  let body: unknown;
  try {
    body = await readJsonBounded(request, 24_000);
  } catch (error) {
    return error instanceof Error && error.message === "request_too_large"
      ? badRequest("request_too_large", 413)
      : badRequest("invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid_payload");
  const payload = body as { title?: unknown; plans?: unknown };
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 80) : "My SIP simulation";
  if (!Array.isArray(payload.plans) || payload.plans.length < 1 || payload.plans.length > MAX_PLANS) return badRequest("plans_must_contain_1_to_6_items");
  const plans: CreatePlan[] = [];
  const codes = new Set<number>();
  const today = todayInIndia();
  for (const raw of payload.plans) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("invalid_plan");
    const plan = raw as Record<string, unknown>;
    const schemeCode = Number(plan.schemeCode);
    const amount = Number(plan.monthlyAmountPaise);
    const sipDay = Number(plan.sipDay);
    const startDate = plan.startDate;
    const endDate = plan.endDate;
    if (!Number.isSafeInteger(schemeCode) || schemeCode <= 0 || codes.has(schemeCode) ||
        !Number.isSafeInteger(amount) || amount < 10_000 || amount > 100_000_000 ||
        !Number.isInteger(sipDay) || sipDay < 1 || sipDay > 28 ||
        !validIsoDate(startDate) || !validIsoDate(endDate) || startDate > endDate || endDate > today) {
      return badRequest("invalid_plan_fields");
    }
    const schedule = buildSipSchedule(startDate, endDate, sipDay);
    if (!schedule.length || schedule.length > MAX_INSTALLMENTS) return badRequest("installment_count_out_of_range");
    codes.add(schemeCode);
    plans.push({ schemeCode, monthlyAmountPaise: amount, startDate, endDate, sipDay });
  }

  const preparedPlans: Array<{
    planId: string;
    input: CreatePlan;
    schemeName: string;
    meta: SchemeMeta;
    purchases: Array<{ scheduledDate: string; navDate: string; nav: number; units: number }>;
    missedDates: string[];
    pendingDates: string[];
  }> = [];

  try {
    for (const input of plans) {
      const payload = await mfapi("/mf/" + input.schemeCode + "?startDate=" + input.startDate + "&endDate=" + isoDaysAfter(input.endDate, NAV_LOOKAHEAD_DAYS)) as NavResponse;
      const normalized = normalizeNavHistory(payload, input.schemeCode);
      if (!isGrowthOption(normalized.meta)) throw new Error("growth_option_required");
      const schedule = buildSipSchedule(input.startDate, input.endDate, input.sipDay);
      const purchases: Array<{ scheduledDate: string; navDate: string; nav: number; units: number }> = [];
      const missedDates: string[] = [];
      const pendingDates: string[] = [];
      for (const scheduledDate of schedule) {
        const point = pickNextNav(normalized.points, scheduledDate, today);
        if (!point) {
          if (today <= isoDaysAfter(scheduledDate, NAV_LOOKAHEAD_DAYS)) pendingDates.push(scheduledDate);
          else missedDates.push(scheduledDate);
          continue;
        }
        const units = input.monthlyAmountPaise / 100 / point.nav;
        if (!Number.isFinite(units) || units <= 0) throw new Error("units_calculation_invalid");
        purchases.push({ scheduledDate, navDate: point.date, nav: point.nav, units });
      }
      if (!purchases.length && !pendingDates.length) throw new Error("no_nav_observations_for_sip_window");
      preparedPlans.push({
        planId: crypto.randomUUID(),
        input,
        schemeName: normalized.meta.scheme_name || "Unknown scheme",
        meta: normalized.meta,
        purchases,
        missedDates,
        pendingDates,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[wealth] simulation NAV preparation failed", message);
    return response({ ok: false, error: message === "growth_option_required" ? "growth_option_required" : "historical_nav_unavailable", reason: message }, message === "growth_option_required" ? 422 : 502);
  }

  const simulationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const lastDate = preparedPlans.flatMap((plan) => plan.purchases.map((purchase) => purchase.navDate)).sort().at(-1) || today;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO wealth_simulations (simulation_id, user_id, title, simulation_type, created_at, as_of_date) VALUES (?, ?, ?, 'paper_sip', ?, ?)")
      .bind(simulationId, userId, title || "My SIP simulation", createdAt, lastDate),
  ];
  const planSummary = [];
  for (const plan of preparedPlans) {
    statements.push(env.DB.prepare(
      "INSERT INTO wealth_sip_plans (plan_id, simulation_id, scheme_code, scheme_name, monthly_amount_paise, sip_day, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(plan.planId, simulationId, plan.input.schemeCode, plan.schemeName, plan.input.monthlyAmountPaise, plan.input.sipDay, plan.input.startDate, plan.input.endDate, createdAt));
    for (const purchase of plan.purchases) {
      statements.push(env.DB.prepare(
        "INSERT INTO wealth_sip_purchases (purchase_id, plan_id, scheduled_date, nav_date, invested_paise, nav, units) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), plan.planId, purchase.scheduledDate, purchase.navDate, plan.input.monthlyAmountPaise, purchase.nav, purchase.units));
    }
    planSummary.push({
      schemeCode: plan.input.schemeCode,
      schemeName: plan.schemeName,
      monthlyAmountPaise: plan.input.monthlyAmountPaise,
      sipDay: plan.input.sipDay,
      startDate: plan.input.startDate,
      endDate: plan.input.endDate,
      purchaseCount: plan.purchases.length,
      missedInstallmentDates: plan.missedDates,
      pendingInstallmentDates: plan.pendingDates,
      units: plan.purchases.reduce((sum, purchase) => sum + purchase.units, 0),
      investedPaise: plan.purchases.length * plan.input.monthlyAmountPaise,
    });
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error("[wealth] simulation persistence failed", error instanceof Error ? error.message : "unknown");
    return response({ ok: false, error: "simulation_persistence_failed" }, 500);
  }
  return response({
    ok: true,
    simulationId,
    title: title || "My SIP simulation",
    simulationType: "historical_paper_simulation",
    createdAt,
    source: NAV_SOURCE,
    attribution: NAV_ATTRIBUTION,
    asOfDate: lastDate,
    plans: planSummary,
    disclaimer: "This is a hypothetical historical simulation, not proof of ownership, an actual SIP mandate, an allotment, or investment advice.",
  }, 201);
}

type SimulationRow = {
  simulation_id: string;
  title: string;
  created_at: string;
  as_of_date: string;
  plan_count: number;
};
type PlanRow = {
  plan_id: string;
  scheme_code: number;
  scheme_name: string;
  monthly_amount_paise: number;
  sip_day: number;
  start_date: string;
  end_date: string;
  purchase_count: number;
  invested_paise: number;
  units: number;
};
type PurchaseRow = {
  scheduled_date: string;
  nav_date: string;
  invested_paise: number;
  nav: number;
  units: number;
};

async function refreshPendingPurchases(
  env: Env,
  plans: PlanRow[],
  existingPurchases: Array<PurchaseRow & { plan_id: string }>,
  today: string,
): Promise<void> {
  const inserts: D1PreparedStatement[] = [];
  for (const plan of plans) {
    const existingDates = new Set(
      existingPurchases
        .filter((purchase) => purchase.plan_id === plan.plan_id)
        .map((purchase) => purchase.scheduled_date),
    );
    const pendingDates = buildSipSchedule(plan.start_date, plan.end_date, Number(plan.sip_day))
      .filter((date) => !existingDates.has(date) && date <= today && today <= isoDaysAfter(date, NAV_LOOKAHEAD_DAYS));
    if (!pendingDates.length) continue;

    try {
      const fromDate = [...pendingDates].sort()[0];
      const payload = await mfapi(
        "/mf/" + plan.scheme_code + "?startDate=" + fromDate + "&endDate=" + today,
      ) as NavResponse;
      const normalized = normalizeNavHistory(payload, Number(plan.scheme_code));
      if (!isGrowthOption(normalized.meta)) continue;
      for (const scheduledDate of pendingDates) {
        const point = pickNextNav(normalized.points, scheduledDate, today);
        if (!point) continue;
        const units = Number(plan.monthly_amount_paise) / 100 / point.nav;
        if (!Number.isFinite(units) || units <= 0) continue;
        // The unique(plan_id, scheduled_date) constraint plus INSERT OR IGNORE
        // makes concurrent detail refreshes idempotent.
        inserts.push(env.DB.prepare(
          "INSERT OR IGNORE INTO wealth_sip_purchases (purchase_id, plan_id, scheduled_date, nav_date, invested_paise, nav, units) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          crypto.randomUUID(),
          plan.plan_id,
          scheduledDate,
          point.date,
          Number(plan.monthly_amount_paise),
          point.nav,
          units,
        ));
      }
    } catch (error) {
      console.warn("[wealth] pending SIP NAV refresh deferred", Number(plan.scheme_code), error instanceof Error ? error.message : "unknown");
    }
  }
  if (!inserts.length) return;
  try {
    await env.DB.batch(inserts);
  } catch (error) {
    // Leave the existing records intact; a later detail read may safely retry.
    console.warn("[wealth] pending SIP persistence deferred", error instanceof Error ? error.message : "unknown");
  }
}

async function buildPerformanceSeries(
  env: Env,
  plans: PlanRow[],
  purchaseRows: Array<PurchaseRow & { plan_id: string }>,
  valuationDate: string,
): Promise<Array<{ date: string; valuePaise: number; investedPaise: number }>> {
  if (!plans.length || !valuationDate) return [];
  const histories = new Map<number, NavPoint[]>();
  try {
    const historyResults = await Promise.all(plans.map(async (plan) => {
      const purchases = purchaseRows.filter((purchase) => purchase.plan_id === plan.plan_id);
      const startDate = purchases.map((purchase) => purchase.nav_date).sort()[0];
      if (!startDate) return { schemeCode: Number(plan.scheme_code), points: null };
      const raw = await mfapi("/mf/" + plan.scheme_code + "?startDate=" + startDate + "&endDate=" + isoDaysAfter(valuationDate, 1)) as NavResponse;
      const normalized = normalizeNavHistory(raw, Number(plan.scheme_code));
      if (!isGrowthOption(normalized.meta)) return { schemeCode: Number(plan.scheme_code), points: null };
      return {
        schemeCode: Number(plan.scheme_code),
        points: normalized.points.filter((point) => point.date <= valuationDate),
      };
    }));
    for (const result of historyResults) {
      if (!result.points) return [];
      histories.set(result.schemeCode, result.points);
    }
  } catch (error) {
    console.warn("[wealth] historical performance series unavailable", error instanceof Error ? error.message : "unknown");
    return [];
  }

  const firstHistory = histories.get(Number(plans[0].scheme_code)) || [];
  const commonDates = firstHistory
    .map((point) => point.date)
    .filter((date) => plans.every((plan) => (histories.get(Number(plan.scheme_code)) || []).some((point) => point.date === date)));
  if (commonDates.length < 2) return [];

  const navMaps = new Map<number, Map<string, number>>();
  for (const plan of plans) {
    navMaps.set(Number(plan.scheme_code), new Map(
      (histories.get(Number(plan.scheme_code)) || []).map((point) => [point.date, point.nav]),
    ));
  }

  const stateByPlan = plans.map((plan) => {
    const purchases = purchaseRows.filter((purchase) => purchase.plan_id === plan.plan_id);
    return {
      schemeCode: Number(plan.scheme_code),
      byNavDate: [...purchases].sort((a, b) => a.nav_date.localeCompare(b.nav_date)),
      navIndex: 0,
      units: 0,
      investedPaise: 0,
    };
  });

  const series: Array<{ date: string; valuePaise: number; investedPaise: number }> = [];
  for (const date of commonDates) {
    let totalValue = 0;
    let totalInvestedPaise = 0;
    let complete = true;
    for (const state of stateByPlan) {
      const nav = navMaps.get(state.schemeCode)?.get(date);
      if (nav === undefined) { complete = false; break; }
      while (state.navIndex < state.byNavDate.length && state.byNavDate[state.navIndex].nav_date <= date) {
        state.units += Number(state.byNavDate[state.navIndex].units);
        state.investedPaise += Number(state.byNavDate[state.navIndex].invested_paise);
        state.navIndex += 1;
      }
      totalValue += state.units * nav;
      totalInvestedPaise += state.investedPaise;
    }
    if (complete) {
      series.push({
        date,
        valuePaise: Math.round(totalValue * 100),
        investedPaise: totalInvestedPaise,
      });
    }
  }

  if (series.length <= 180) return series;
  const stride = Math.ceil((series.length - 1) / 179);
  const sampled = series.filter((_, index) => index === 0 || index % stride === 0);
  if (sampled[sampled.length - 1]?.date !== series[series.length - 1].date) sampled.push(series[series.length - 1]);
  return sampled;
}

async function getSimulationDetail(env: Env, userId: string, simulationId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(simulationId)) return badRequest("invalid_simulation_id");
  const simulation = await env.DB.prepare(
    "SELECT s.simulation_id, s.title, s.created_at, s.as_of_date, COUNT(DISTINCT p.plan_id) AS plan_count " +
    "FROM wealth_simulations s LEFT JOIN wealth_sip_plans p ON p.simulation_id=s.simulation_id " +
    "WHERE s.simulation_id=? AND s.user_id=? GROUP BY s.simulation_id LIMIT 1",
  ).bind(simulationId, userId).first<SimulationRow>();
  if (!simulation) return badRequest("simulation_not_found", 404);
  const plans = await env.DB.prepare(
    "SELECT p.plan_id, p.scheme_code, p.scheme_name, p.monthly_amount_paise, p.sip_day, p.start_date, p.end_date, " +
    "COUNT(x.purchase_id) AS purchase_count, COALESCE(SUM(x.invested_paise),0) AS invested_paise, COALESCE(SUM(x.units),0) AS units " +
    "FROM wealth_sip_plans p LEFT JOIN wealth_sip_purchases x ON x.plan_id=p.plan_id " +
    "WHERE p.simulation_id=? GROUP BY p.plan_id ORDER BY p.created_at, p.scheme_name",
  ).bind(simulationId).all<PlanRow>();
  const planRows = plans.results || [];
  let purchaseRows = await env.DB.prepare(
    "SELECT p.plan_id, x.scheduled_date, x.nav_date, x.invested_paise, x.nav, x.units " +
    "FROM wealth_sip_plans p JOIN wealth_sip_purchases x ON x.plan_id=p.plan_id " +
    "WHERE p.simulation_id=? ORDER BY x.scheduled_date ASC",
  ).bind(simulationId).all<PurchaseRow & { plan_id: string }>();
  await refreshPendingPurchases(env, planRows, purchaseRows.results || [], todayInIndia());
  purchaseRows = await env.DB.prepare(
    "SELECT p.plan_id, x.scheduled_date, x.nav_date, x.invested_paise, x.nav, x.units " +
    "FROM wealth_sip_plans p JOIN wealth_sip_purchases x ON x.plan_id=p.plan_id " +
    "WHERE p.simulation_id=? ORDER BY x.scheduled_date ASC",
  ).bind(simulationId).all<PurchaseRow & { plan_id: string }>();

  const uniqueCodes = Array.from(new Set(planRows.map((plan) => Number(plan.scheme_code))));
  const latestByCode = new Map<number, { date: string; nav: number }>();
  const latestDates: string[] = [];
  for (const code of uniqueCodes) {
    try {
      const raw = await mfapi("/mf/" + code + "/latest") as NavResponse;
      const normalized = normalizeNavHistory(raw, code);
      const latest = normalized.points[normalized.points.length - 1];
      const today = todayInIndia();
      if (!isFreshNavDate(latest.date, today)) {
        console.warn("[wealth] latest NAV is stale; valuation withheld", code, latest.date);
        continue;
      }
      latestByCode.set(code, latest);
      latestDates.push(latest.date);
    } catch (error) {
      console.error("[wealth] latest NAV lookup failed", code, error instanceof Error ? error.message : "unknown");
    }
  }
  // Use one exact common portfolio valuation date. Later-updated schemes must
  // actually expose a NAV on that date; carrying a prior NAV forward is not allowed.
  const commonValuationDate = latestDates.length === uniqueCodes.length
    ? [...latestDates].sort()[0]
    : "";
  if (commonValuationDate) {
    for (const code of uniqueCodes) {
      const current = latestByCode.get(code);
      if (!current || current.date <= commonValuationDate) continue;
      try {
        const endDate = isoDaysAfter(commonValuationDate, 1);
        const raw = await mfapi("/mf/" + code + "?startDate=" + commonValuationDate + "&endDate=" + endDate) as NavResponse;
        const normalized = normalizeNavHistory(raw, code);
        const point = normalized.points.find((item) => item.date === commonValuationDate);
        if (point) latestByCode.set(code, point);
        else latestByCode.delete(code);
      } catch (error) {
        console.error("[wealth] common-date NAV lookup failed", code, error instanceof Error ? error.message : "unknown");
        latestByCode.delete(code);
      }
    }
  }

  const detailedPlans = planRows.map((plan) => {
    const purchases = (purchaseRows.results || []).filter((purchase) => purchase.plan_id === plan.plan_id);
    const latest = latestByCode.get(Number(plan.scheme_code)) || null;
    const valuationCutoff = commonValuationDate || todayInIndia();
    const appliedPurchases = purchases.filter((purchase) => purchase.nav_date <= valuationCutoff);
    const units = appliedPurchases.reduce((sum, purchase) => sum + Number(purchase.units), 0);
    const investedPaise = appliedPurchases.reduce((sum, purchase) => sum + Number(purchase.invested_paise), 0);
    const currentValue = latest ? units * latest.nav : null;
    const profit = currentValue === null ? null : currentValue - investedPaise / 100;
    const scheduledDates = buildSipSchedule(plan.start_date, plan.end_date, Number(plan.sip_day));
    const matchedDates = new Set(purchases.map((purchase) => purchase.scheduled_date));
    const unmatchedDates = scheduledDates.filter((date) => !matchedDates.has(date));
    const today = todayInIndia();
    const pendingDates = unmatchedDates.filter((date) => today <= isoDaysAfter(date, NAV_LOOKAHEAD_DAYS));
    const missedDates = unmatchedDates.filter((date) => today > isoDaysAfter(date, NAV_LOOKAHEAD_DAYS));
    const xirrFlows = appliedPurchases.map((purchase) => ({ date: purchase.scheduled_date, amount: -Number(purchase.invested_paise) / 100 }));
    if (currentValue !== null && latest && commonValuationDate) xirrFlows.push({ date: commonValuationDate, amount: currentValue });
    const rate = currentValue !== null && latest && commonValuationDate ? xirr(xirrFlows) : null;
    return {
      planId: plan.plan_id,
      schemeCode: Number(plan.scheme_code),
      schemeName: plan.scheme_name,
      monthlyAmountPaise: Number(plan.monthly_amount_paise),
      sipDay: Number(plan.sip_day),
      startDate: plan.start_date,
      endDate: plan.end_date,
      purchaseCount: Number(plan.purchase_count),
      appliedPurchaseCount: appliedPurchases.length,
      missedInstallments: missedDates.length,
      missedInstallmentDates: missedDates,
      pendingInstallments: pendingDates.length,
      pendingInstallmentDates: pendingDates,
      investedPaise,
      units,
      latestNav: latest ? { nav: latest.nav, date: latest.date, portfolioValuationDate: commonValuationDate } : null,
      currentValuePaise: currentValue === null ? null : Math.round(currentValue * 100),
      profitLossPaise: profit === null ? null : Math.round(profit * 100),
      absoluteReturn: profit === null || investedPaise <= 0 ? null : profit / (investedPaise / 100),
      xirr: rate,
    };
  });

  const investedPaise = detailedPlans.reduce((sum, plan) => sum + plan.investedPaise, 0);
  const hasAllNav = detailedPlans.length > 0 && detailedPlans.every((plan) => plan.currentValuePaise !== null);
  const currentValuePaise = hasAllNav ? detailedPlans.reduce((sum, plan) => sum + Number(plan.currentValuePaise), 0) : null;
  const profitLossPaise = currentValuePaise === null ? null : currentValuePaise - investedPaise;
  const latestValuationDate = commonValuationDate;
  const xirrCutoff = latestValuationDate || todayInIndia();
  const combinedFlows: Array<{ date: string; amount: number }> = [];
  for (const purchase of purchaseRows.results || []) {
    if (purchase.nav_date <= xirrCutoff) {
      combinedFlows.push({ date: purchase.scheduled_date, amount: -Number(purchase.invested_paise) / 100 });
    }
  }
  if (currentValuePaise !== null && latestValuationDate) combinedFlows.push({ date: latestValuationDate, amount: currentValuePaise / 100 });
  const combinedXirr = currentValuePaise !== null ? xirr(combinedFlows) : null;
  const performanceSeries = hasAllNav
    ? await buildPerformanceSeries(env, planRows, (purchaseRows.results || []) as Array<PurchaseRow & { plan_id: string }>, latestValuationDate)
    : [];

  return response({
    ok: true,
    simulation: {
      simulationId: simulation.simulation_id,
      title: simulation.title,
      createdAt: simulation.created_at,
      latestValuationDate,
      investedPaise,
      currentValuePaise,
      profitLossPaise,
      absoluteReturn: currentValuePaise === null || investedPaise <= 0 ? null : (currentValuePaise - investedPaise) / investedPaise,
      xirr: combinedXirr,
      valuationComplete: hasAllNav,
      performanceSeries,
      plans: detailedPlans,
    },
    source: NAV_SOURCE,
    attribution: NAV_ATTRIBUTION,
    disclaimer: "Historical paper simulation only. The first available NAV on or after the scheduled SIP date, within seven calendar days, is used as a deterministic proxy. The proxy is not an actual allotment, transaction confirmation, tax statement, or recommendation.",
  });
}

async function listSimulations(env: Env, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT s.simulation_id, s.title, s.created_at, s.as_of_date, COUNT(p.plan_id) AS plan_count " +
    "FROM wealth_simulations s LEFT JOIN wealth_sip_plans p ON p.simulation_id=s.simulation_id " +
    "WHERE s.user_id=? GROUP BY s.simulation_id ORDER BY s.created_at DESC LIMIT 30",
  ).bind(userId).all<SimulationRow>();
  return response({ ok: true, simulations: rows.results || [] });
}

async function handleStockHistory(url: URL, env: Env): Promise<Response> {
  const accessToken = env.DHAN_ACCESS_TOKEN?.trim();
  if (env.WEALTH_DHAN_ENABLED !== "true") {
    return response({
      ok: false,
      error: "stock_provider_disabled",
      message: "The Dhan data adapter is disabled until data entitlements and the permitted user scope are verified.",
    }, 503);
  }
  if (!accessToken) {
    return response({
      ok: false,
      error: "stock_provider_not_configured",
      message: "Dhan historical-data credentials are not configured on this Worker. Raw stock history must also pass instrument-master and corporate-action adjustment gates before it can be used for long-term return calculations.",
    }, 503);
  }
  const securityId = url.searchParams.get("securityId") || "";
  const exchangeSegment = url.searchParams.get("exchangeSegment") || "";
  const fromDate = url.searchParams.get("fromDate") || "";
  const toDate = url.searchParams.get("toDate") || "";
  if (!/^\d{1,12}$/.test(securityId) || !["NSE_EQ", "BSE_EQ"].includes(exchangeSegment) ||
      !validDhanDate(fromDate) || !validDhanDate(toDate) || fromDate >= toDate || fromDate < "2022-01-01" || toDate > todayInIndia()) {
    return badRequest("invalid_stock_history_request");
  }
  const spanDays = (new Date(toDate + "T00:00:00Z").getTime() - new Date(fromDate + "T00:00:00Z").getTime()) / 86_400_000;
  if (spanDays > 1_830) return badRequest("stock_history_range_exceeds_five_years");
  try {
    const upstream = await fetch("https://api.dhan.co/v2/charts/historical", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "access-token": accessToken,
      },
      body: JSON.stringify({
        securityId,
        exchangeSegment,
        instrument: "EQUITY",
        expiryCode: 0,
        oi: false,
        fromDate,
        toDate,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) return response({ ok: false, error: "stock_provider_unavailable", providerStatus: upstream.status }, 502);
    const data = await upstream.json() as { close?: unknown[]; timestamp?: unknown[] };
    if (!Array.isArray(data.close) || !Array.isArray(data.timestamp) || data.close.length !== data.timestamp.length || data.close.length > 2_000) {
      return response({ ok: false, error: "stock_provider_response_invalid" }, 502);
    }
    const candles = data.close.flatMap((close, index) => {
      const price = Number(close);
      const timestamp = Number(data.timestamp?.[index]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return [];
      const date = indiaDateFromEpochSeconds(timestamp);
      if (!date || date < fromDate || date >= toDate) return [];
      return [{ date, close: price }];
    });
    return response({
      ok: true,
      source: "DhanHQ historical daily OHLC",
      securityId,
      exchangeSegment,
      instrument: "EQUITY",
      fromDate,
      toDate,
      adjustedForCorporateActions: true,
      canCalculateTotalReturn: false,
      candles,
      disclaimer: "Dhan states daily historical candles are adjusted for bonuses and splits. Cash dividends are not included, so this is a price-return data series rather than a complete total-return series.",
    });
  } catch (error) {
    console.error("[wealth] Dhan history failed", error instanceof Error ? error.message : "unknown");
    return response({ ok: false, error: "stock_provider_unavailable" }, 502);
  }
}

export async function handleWealthRequest(request: Request, env: Env, userId: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/wealth" && !url.pathname.startsWith("/api/wealth/")) return null;
  if (!userId) return badRequest("authentication_required", 401);
  if (request.method === "OPTIONS") return badRequest("method_not_allowed", 405);

  if (url.pathname === "/api/wealth/demo" && request.method === "GET") return handleDemoPortfolio(env);

  if (url.pathname === "/api/wealth/status" && request.method === "GET") {
    return response({
      ok: true,
      feature: "AskMoina Wealth",
      mode: "historical_paper_simulation",
      providers: {
        mutualFundNav: NAV_SOURCE,
        mutualFundNavReady: true,
        stockHistory: "DhanHQ",
        stockHistoryReady: env.WEALTH_DHAN_ENABLED === "true" && Boolean(env.DHAN_ACCESS_TOKEN?.trim()),
        stockHistoryEnabled: env.WEALTH_DHAN_ENABLED === "true",
        stockPerformanceReady: false,
      },
      disclaimer: "This feature creates hypothetical historical paper portfolios. It does not connect to a brokerage, place trades, create SIP mandates, or prove actual ownership.",
    });
  }

  if (url.pathname === "/api/wealth/funds/search" && request.method === "GET") return handleFundSearch(url);
  const navMatch = url.pathname.match(/^\/api\/wealth\/funds\/(\d{1,9})\/nav$/);
  if (navMatch && request.method === "GET") {
    const code = parseSchemeCode(navMatch[1]);
    return code ? handleFundNav(url, code) : badRequest("invalid_scheme_code");
  }

  if (url.pathname === "/api/wealth/simulations" && request.method === "GET") return listSimulations(env, userId);
  if (url.pathname === "/api/wealth/simulations" && request.method === "POST") return createSimulation(request, env, userId);
  const detailMatch = url.pathname.match(/^\/api\/wealth\/simulations\/([0-9a-f-]{36})$/i);
  if (detailMatch && request.method === "GET") return getSimulationDetail(env, userId, detailMatch[1]);

  if (url.pathname === "/api/wealth/stocks/history" && request.method === "GET") return handleStockHistory(url, env);
  if (url.pathname.startsWith("/api/wealth/")) return badRequest("not_found", 404);
  return null;
}

export const wealthMath = {
  validIsoDate,
  parseNavDate,
  buildSipSchedule,
  normalizeNavHistory,
  pickNextNav,
  isGrowthOption,
  isFreshNavDate,
  todayInIndia,
  indiaDateFromEpochSeconds,
  readJsonBounded,
  xirr,
  pickFirstCloseAtOrAfter,
  parseCsvTable,
  validateDemoSecurityIds,
  normalizeDhanHistory,
};
