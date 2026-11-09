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
const MAX_INSTALLMENTS = 120;
const NAV_LOOKAHEAD_DAYS = 7;
const NAV_SOURCE = "MFAPI.in";
const NAV_ATTRIBUTION = "Third-party aggregator of AMFI-published mutual-fund NAV data; verify against AMFI before any non-simulated use.";

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

function monthKey(iso: string): string {
  return iso.slice(0, 7);
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

function pickNextNav(points: NavPoint[], scheduledDate: string): NavPoint | null {
  const lastAllowed = isoDaysAfter(scheduledDate, NAV_LOOKAHEAD_DAYS);
  return points.find((point) => point.date >= scheduledDate && point.date <= lastAllowed) || null;
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
  const upstream = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AskMoina-Wealth/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!upstream.ok) throw new Error("nav_provider_http_" + upstream.status);
  return await upstream.json();
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function isGrowthOption(meta: SchemeMeta): boolean {
  const name = (meta.scheme_name || "").toLowerCase();
  return name.includes("growth") && !/(idcw|dividend|bonus)/i.test(name);
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
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 24_000) return badRequest("request_too_large", 413);
  let body: unknown;
  try { body = await request.json(); } catch { return badRequest("invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid_payload");
  const payload = body as { title?: unknown; plans?: unknown };
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 80) : "My SIP simulation";
  if (!Array.isArray(payload.plans) || payload.plans.length < 1 || payload.plans.length > MAX_PLANS) return badRequest("plans_must_contain_1_to_6_items");
  const plans: CreatePlan[] = [];
  const codes = new Set<number>();
  const today = new Date().toISOString().slice(0, 10);
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
  }> = [];

  try {
    for (const input of plans) {
      const payload = await mfapi("/mf/" + input.schemeCode + "?startDate=" + input.startDate + "&endDate=" + isoDaysAfter(input.endDate, NAV_LOOKAHEAD_DAYS)) as NavResponse;
      const normalized = normalizeNavHistory(payload, input.schemeCode);
      if (!isGrowthOption(normalized.meta)) throw new Error("growth_option_required");
      const schedule = buildSipSchedule(input.startDate, input.endDate, input.sipDay);
      const purchases: Array<{ scheduledDate: string; navDate: string; nav: number; units: number }> = [];
      const missedDates: string[] = [];
      for (const scheduledDate of schedule) {
        const point = pickNextNav(normalized.points, scheduledDate);
        if (!point) { missedDates.push(scheduledDate); continue; }
        const units = input.monthlyAmountPaise / 100 / point.nav;
        if (!Number.isFinite(units) || units <= 0) throw new Error("units_calculation_invalid");
        purchases.push({ scheduledDate, navDate: point.date, nav: point.nav, units });
      }
      if (!purchases.length) throw new Error("no_nav_observations_for_sip_window");
      preparedPlans.push({
        planId: crypto.randomUUID(),
        input,
        schemeName: normalized.meta.scheme_name || "Unknown scheme",
        meta: normalized.meta,
        purchases,
        missedDates,
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
  const purchaseRows = await env.DB.prepare(
    "SELECT p.plan_id, x.scheduled_date, x.nav_date, x.invested_paise, x.nav, x.units " +
    "FROM wealth_sip_plans p JOIN wealth_sip_purchases x ON x.plan_id=p.plan_id " +
    "WHERE p.simulation_id=? ORDER BY x.scheduled_date ASC",
  ).bind(simulationId).all<PurchaseRow & { plan_id: string }>();

  const planRows = plans.results || [];
  const uniqueCodes = Array.from(new Set(planRows.map((plan) => Number(plan.scheme_code))));
  const latestByCode = new Map<number, { date: string; nav: number }>();
  const latestDates: string[] = [];
  for (const code of uniqueCodes) {
    try {
      const raw = await mfapi("/mf/" + code + "/latest") as NavResponse;
      const normalized = normalizeNavHistory(raw, code);
      const latest = normalized.points[normalized.points.length - 1];
      latestByCode.set(code, latest);
      latestDates.push(latest.date);
    } catch (error) {
      console.error("[wealth] latest NAV lookup failed", code, error instanceof Error ? error.message : "unknown");
    }
  }
  // Use one common portfolio valuation date. Schemes whose latest NAV is newer
  // are repriced to their last available NAV on or before that shared date.
  const commonValuationDate = latestDates.length === uniqueCodes.length
    ? [...latestDates].sort()[0]
    : "";
  if (commonValuationDate) {
    for (const code of uniqueCodes) {
      const current = latestByCode.get(code);
      if (!current || current.date <= commonValuationDate) continue;
      try {
        const fromDate = isoDaysAfter(commonValuationDate, -14);
        const raw = await mfapi("/mf/" + code + "?startDate=" + fromDate + "&endDate=" + commonValuationDate) as NavResponse;
        const normalized = normalizeNavHistory(raw, code);
        const point = normalized.points.filter((item) => item.date <= commonValuationDate).at(-1);
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
    const units = purchases.reduce((sum, purchase) => sum + Number(purchase.units), 0);
    const investedPaise = purchases.reduce((sum, purchase) => sum + Number(purchase.invested_paise), 0);
    const currentValue = latest ? units * latest.nav : null;
    const profit = currentValue === null ? null : currentValue - investedPaise / 100;
    const scheduledDates = buildSipSchedule(plan.start_date, plan.end_date, Number(plan.sip_day));
    const purchasedDates = new Set(purchases.map((purchase) => purchase.scheduled_date));
    const missedDates = scheduledDates.filter((date) => !purchasedDates.has(date));
    const xirrFlows = purchases.map((purchase) => ({ date: purchase.scheduled_date, amount: -Number(purchase.invested_paise) / 100 }));
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
      missedInstallments: missedDates.length,
      missedInstallmentDates: missedDates,
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
  const combinedFlows: Array<{ date: string; amount: number }> = [];
  for (const purchase of purchaseRows.results || []) combinedFlows.push({ date: purchase.scheduled_date, amount: -Number(purchase.invested_paise) / 100 });
  const latestValuationDate = commonValuationDate;
  if (currentValuePaise !== null && latestValuationDate) combinedFlows.push({ date: latestValuationDate, amount: currentValuePaise / 100 });
  const combinedXirr = currentValuePaise !== null ? xirr(combinedFlows) : null;

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
  const clientId = env.DHAN_CLIENT_ID?.trim();
  const accessToken = env.DHAN_ACCESS_TOKEN?.trim();
  if (!clientId || !accessToken) {
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
      !validDhanDate(fromDate) || !validDhanDate(toDate) || fromDate > toDate || fromDate < "2022-01-01" || toDate > new Date().toISOString().slice(0, 10)) {
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
        "client-id": clientId,
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
      return [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: price }];
    });
    return response({
      ok: true,
      source: "DhanHQ historical daily OHLC",
      securityId,
      exchangeSegment,
      instrument: "EQUITY",
      fromDate,
      toDate,
      adjustedForCorporateActions: false,
      canCalculateTotalReturn: false,
      candles,
      disclaimer: "Raw close prices only. Do not use for portfolio-return claims until a verified instrument master and complete corporate-action adjustments are applied.",
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

  if (url.pathname === "/api/wealth/status" && request.method === "GET") {
    return response({
      ok: true,
      feature: "AskMoina Wealth",
      mode: "historical_paper_simulation",
      providers: {
        mutualFundNav: NAV_SOURCE,
        mutualFundNavReady: true,
        stockHistory: "DhanHQ",
        stockHistoryReady: Boolean(env.DHAN_CLIENT_ID?.trim() && env.DHAN_ACCESS_TOKEN?.trim()),
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
  xirr,
};
