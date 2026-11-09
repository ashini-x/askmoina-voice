# AskMoina Wealth — feature specification and milestones

**Status:** Personal demo release candidate; production rollout pending validation  
**Branch:** `feat/askmoina-wealth`  
**Product surface:** AskMoina Voice authenticated mobile PWA  
**Feature name:** AskMoina Wealth (navigation label: **Wealth**)  
**Competitive reference:** INDmoney's consolidated stock, mutual-fund, portfolio-analysis and net-worth experience. This is a product-pattern reference only; AskMoina is not affiliated with INDmoney and does not copy its brand, assets, or private APIs.

## 1. Product intent

Wealth is an investment-tracking and historical paper-simulation feature inside AskMoina Voice. It is mobile-first, dark by default, and shares the existing AskMoina account session, Cloudflare Worker, D1 database and PWA installation shell.

The default overview presents a fixed sample portfolio so the owner can explore the app immediately. Sample quantities, purchase dates and SIP contributions are static demo inputs only. All displayed fund NAVs and configured stock prices are fetched from providers; no hard-coded market values, NAVs or returns are used.

**Non-negotiable truthfulness rule:** sample quantities and cash contributions are clearly labelled hypothetical demo inputs; they are not actual user holdings, purchases, bank records or SIP mandates. Every market price and NAV shown is provider-sourced and date-stamped. If an exact price/NAV is unavailable, the corresponding value is withheld. The app never presents sample data as actual ownership, broker-confirmed holdings, executed SIPs, actual allotments or guaranteed future results.

## 2. Product reference and experience

INDmoney is the reference for the *combined wealth surface*: holdings across equities and mutual funds, portfolio analysis and consolidated value. AskMoina Wealth uses its own information architecture and AskMoina visual language.

- Mobile-first, dark graphite / midnight surfaces with restrained emerald positive-return colour.
- Main sections: Overview, Mutual Funds, Stocks.
- The sample overview shows a full portfolio total only when every asset has a provider-backed value on the exact same valuation date; otherwise only verified fund subtotals are shown.
- Mutual-fund scheme search is provider-backed; the user selects the exact plan and scheme code.
- SIP builder captures monthly amount per scheme, SIP day, start date and end date.
- Simulation detail exposes invested capital, accumulated units, latest NAV and its date, absolute return, XIRR, and missed SIP dates.
- The Stocks panel displays fixed sample share-equivalent units and dates. It fetches Dhan daily candles only when the owner enables the optional Data API integration; prices are otherwise blank.

## 3. Data providers and provenance

### Mutual-fund NAV

- Primary public reference: [AMFI NAV Download and NAV History](https://www.amfiindia.com/net-asset-value/nav-download). AMFI publishes NAV reports and historical NAV downloads; its UI notes that each historical download can cover a maximum of 90 days.
- Initial read-only API adapter: [MFapi.in documentation](https://www.mfapi.in/docs/), using scheme search, scheme NAV history and latest NAV endpoints. MFapi.in is a third-party aggregator, not AMFI. Treat its observations as provider-sourced data that must remain attributable and subject to reconciliation against AMFI before a non-simulated use case.
- Cloudflare's edge cache reduces repeat provider calls: scheme search for six hours, latest NAV for 15 minutes, historical NAV ranges ending before today for 24 hours, and current-window ranges for 15 minutes so pending SIPs can refresh as NAV data is published. Cache failure never fabricates or substitutes data.
- A latest NAV older than seven calendar days, or dated in the future, is withheld from current valuation. A consolidated value requires an exact NAV observation for every selected scheme on the same shared valuation date; no older NAV is carried forward to make an aggregate appear complete. Where that exact-date match cannot be formed, aggregate return fields stay unavailable.
- Data routes: `GET /api/wealth/funds/search?q=`, `GET /api/wealth/funds/:schemeCode/nav?fromDate=&toDate=`.
- Search surfaces Growth options only. Direct and Regular plans remain separate schemes and must not be mixed. IDCW / dividend / bonus-labelled options are excluded from the first SIP simulator.
- Every NAV observation is validated for positive finite NAV, parseable date and exact scheme-code match. Upstream failure produces an error; it is never replaced with a guessed value. SIP POST bodies are also streamed through a 24 KB hard limit, and date cutoffs use the Asia/Kolkata calendar date.

### Equity daily history

- Provider: [DhanHQ Historical Data API](https://dhanhq.co/docs/v2/historical-data/). Its documented daily endpoint returns OHLCV and epoch timestamps for a supplied exchange instrument/security ID. The demo validates the four sample NSE cash-equity symbols against Dhan's official instrument-master CSV before requesting prices.
- The read-only Worker adapter requires `WEALTH_DHAN_ENABLED=true` and a server-only `DHAN_ACCESS_TOKEN` secret. The official daily-history request authenticates with the `access-token` header; no client-ID header is sent. The feature flag is explicitly `false` in both production and preview config. Never put the token in `wrangler.jsonc`, the browser, test fixtures, or committed files.
- Dhan documents a 24-hour validity for individually generated access tokens and notes Data API charges/limits can apply. This feature slice has no automatic token renewal. A personal individual token must not be used as a shared data proxy for other AskMoina users unless Dhan has confirmed the applicable usage/partner entitlement in writing. Leave the feature flag off until entitlement, cost, allowed user scope and renewal operations are settled. The daily API's `toDate` is non-inclusive.
- Dhan support confirms daily historical data is adjusted for corporate actions such as bonuses and splits. The demo may calculate price return from this adjusted series but excludes cash dividends and does not claim total return. Dhan epoch timestamps are mapped to Asia/Kolkata exchange dates and the non-inclusive toDate boundary is enforced.
- No security ID is guessed: the demo resolves NSE/EQUITY IDs from Dhan's official master at runtime and fails closed on missing or ambiguous symbol matches.

## 4. SIP calculation contract

A plan contains one exact scheme code and exact scheme name returned by the NAV provider, a positive monthly amount in paise, SIP day (1–28), start date and end date.

For each monthly scheduled date:

1. Generate the calendar SIP date using the selected day. A maximum of 100 instalments (more than eight years of monthly contributions) is accepted per plan so six selected schemes stay within the current D1 script binding budget. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
2. Select the **first actual NAV observation on or after** the scheduled date, provided it is no more than seven calendar days later and is not future-dated.
3. If there is no qualifying NAV and the seven-day forward window is still open, label the instalment pending. Only after the full seven-day forward window closes without a qualifying NAV is it recorded as missed. Detail reads retry still-open pending windows and persist a newly published qualifying NAV lot idempotently. Do not move the purchase backwards, interpolate NAV, or silently fill the gap.
4. Compute paper units as monthly amount in rupees divided by the matched NAV. The stored number is unrounded calculation precision; UI formatting is display-only.
5. Persist the scheduled date, matched NAV date, invested paise, NAV and units. A simulation is persisted only after all selected plans have valid history and all database statements succeed in one D1 batch.

Absolute return is `(current value - invested amount) / invested amount`. XIRR is calculated separately from dated negative SIP cash flows for lots priced by the shared valuation date and one positive terminal valuation cash flow; it is not an annualized version of absolute return.

For a combined valuation, the Worker chooses the oldest of the latest NAV dates returned for all schemes as a candidate shared as-of date. Any scheme with a newer latest NAV is queried for an observation on that exact candidate date. If even one scheme has no NAV observation on that exact date, the aggregate current value and aggregate returns remain unavailable rather than carrying an older NAV forward or mixing unaligned snapshots. Only SIP lots with a pricing NAV date on or before the shared valuation date contribute units and invested capital to that snapshot.

A scheduled SIP date is used as the cash-flow date for XIRR because it represents the assumed investment outflow; the selected NAV date is separately preserved as the pricing date. This is a deterministic historical proxy, not an actual registrar allotment rule or transaction confirmation.

## 5. Worker API and access boundaries

All Wealth API routes are user-authenticated through the existing AskMoina account cookie. The API handler also rejects unauthenticated calls, uses no-store JSON responses, validates inputs, avoids CORS, and requires same-origin POSTs.

| Route | Method | Purpose |
|---|---|---|
| `/api/wealth/status` | GET | Feature mode and provider readiness |
| `/api/wealth/funds/search?q=` | GET | Search exact Growth schemes |
| `/api/wealth/funds/:schemeCode/nav` | GET | Validated NAV window |
| `/api/wealth/simulations` | GET | List the current user's simulations |
| `/api/wealth/simulations` | POST | Create historical paper SIP simulation |
| `/api/wealth/simulations/:id` | GET | User-owned simulation and current valuation |
| `/api/wealth/stocks/history` | GET | Read-only raw DhanHQ daily candles when credentials exist |

Ownership is enforced on simulation lookup using both simulation ID and authenticated user ID. D1 foreign keys cascade simulation deletion semantics if that feature is later introduced. No delete endpoint is exposed in this slice.

## 6. Storage

Migration `0014_wealth_simulations.sql` adds:

- `wealth_simulations`: owner, label, paper-simulation type, creation and as-of dates.
- `wealth_sip_plans`: canonical scheme identity, contribution amount, schedule and date range.
- `wealth_sip_purchases`: each scheduled date, NAV observation date, rupee contribution, NAV and calculated units.

Amounts are stored in paise to avoid floating-point currency arithmetic. NAV and unit values use numeric columns because NAV/unit calculations are fractional. User identity is the existing AskMoina `account_users.user_id`; there is no new guest identity or separate Wealth login.

## 7. Milestones and acceptance gates

### W0 — Product contract and isolation
**Feature branch implementation: started.**

- [x] Feature name, INDmoney-inspired combined-wealth product reference, paper-only boundary.
- [x] Separate feature branch created from current `main`.
- [x] D1 schema for user-owned paper SIP histories.
- [x] New API module kept out of the existing voice/session handlers.
- [ ] Review the migration against the live D1 schema before any remote apply.

### W1 — Mutual-fund NAV and SIP simulator
**Initial implementation committed; acceptance pending.**

- [x] Authenticated scheme search and date-window NAV API.
- [x] Growth-option validation and provider scheme-code verification.
- [x] SIP schedule, seven-day forward NAV matching, explicit pending/missed states, pending-window retry, and unit calculation.
- [x] Persist user-owned SIP plans and per-instalment evidence.
- [x] Absolute-return and XIRR calculation with exact common-date NAV matching; no carry-forward pricing.
- [x] Edge-cache public NAV responses and withhold stale/future latest NAVs.
- [x] Rebuild pending lots when a qualifying NAV is published later, with idempotent D1 inserts.
- [x] Historical mutual-fund SIP value vs contributions chart from exact shared daily NAV dates (no interpolation; at most 180 chart points).
- [x] Dark mobile PWA builder and simulation detail screen.
- [x] Unit tests for date parsing, schedule generation, NAV matching, Growth-option/scheme-code validation, XIRR, India date boundary, Dhan epoch-to-IST conversion and bounded request-body handling.
- [x] Run repository typecheck and complete test suite on the feature branch (Release validation run 42664869555 passed on implementation commit 392b5f23883c2056dd0953ee0e05b16cfc6b1959).
- [ ] Exercise live MFapi.in search, one NAV history request and one latest NAV request; reconcile selected observations against AMFI.
- [ ] Verify persisted records, duplicate protection, owner isolation and partial-failure behaviour against a non-production D1 database.
- [ ] Capture mobile device acceptance evidence (Android Chrome installed PWA, small viewport, safe-area, offline shell).

**Acceptance:** no simulated result is marked accepted until the same scheme/date/amount inputs reproduce the same stored purchase lots, source NAV dates, invested total, current NAV valuation, absolute return and XIRR in a second read.

### W2 — Equity instrument master and daily history
**Read-only demo price path implemented; live prices require the owner's Dhan Data API subscription/token.**

- [x] Read-only DhanHQ daily-history adapter using the documented v2 historical charts endpoint.
- [x] Server-only credential contract; no browser token exposure.
- [x] Explicit opt-in flag is false in production and preview by default; only the official access-token header is sent.
- [x] Fetch the official Dhan NSE equity instrument-master CSV and resolve exact NSE/EQUITY symbol-to-security-ID mappings at runtime; ambiguous or missing mappings fail closed.
- [x] Dhan daily-candle timestamps converted to Asia/Kolkata exchange dates and non-inclusive toDate enforced.
- [x] Daily history marked as bonus/split adjusted based on Dhan support confirmation; cash dividends remain excluded, so the shown figure is price return rather than total return.
- [x] Demo holdings and purchase dates are static inputs; market price data is fetched from Dhan only when enabled and configured.
- [ ] Configure Dhan credentials in an isolated preview Worker after owner enables the separate Data API subscription.
- [ ] Test 2022-to-current date ranges against known exchange sessions and compare sample candles to a second trusted source.
- [ ] Confirm permitted personal token usage and expiry/refresh operations before any multi-user rollout.

**Acceptance:** every stock candle maps to an exact official instrument-master identity, carries its provider date, and is never displayed as live intraday pricing. Missing/stale stock data leaves stock values blank and prevents a combined total.

### W3 — Corporate-action-adjusted stock ledger
**Partially addressed by Dhan's adjusted daily-price series; full total-return ledger remains not started.**

- [ ] Model stock paper lots with exchange, security ID, symbol, purchase date, quantity, price and source.
- [x] Use Dhan's provider-adjusted daily history for bonus/split adjustment in this personal demo.
- [ ] Ingest and verify mergers, demergers, symbol changes, delistings and cash dividend events for a complete stock ledger.
- [ ] Handle cash dividends separately from price return and document reinvestment assumptions (default: dividends excluded from price-return; total-return view only where complete verified data exists).
- [ ] Apply corporate actions to quantity and cost basis without double-counting.
- [ ] Add regression fixtures around representative corporate-action events.

**Acceptance:** Dhan-adjusted price history is acceptable only for price-return estimates. Total return, dividend reinvestment and complex corporate actions remain unsupported until separately reconciled against authoritative records.

### W4 — Consolidated portfolio and richer mobile charts
**Partial — the mutual-fund SIP chart and a same-date static demo portfolio are implemented; real stock valuation remains gated on Dhan configuration.**

- [x] Combine sample stock and mutual-fund valuations only when every asset has a provider observation on the exact same shared as-of date; otherwise withhold the combined total.
- [x] Build the mutual-fund SIP paper-value and contribution history from exact shared NAV dates, with no interpolated points.
- [ ] Build the consolidated stock + mutual-fund performance history from fully accepted stored evidence (not a hand-drawn or fabricated curve).
- [ ] Period filters: 1M, 6M, 1Y, 3Y and ALL, each with an explicit date range.
- [ ] Holdings, allocation, watchlist and transaction chronology.
- [ ] Clearly distinguish price return, absolute return, XIRR and (where supported) total return.

**Acceptance:** aggregate numbers reconcile exactly to per-asset positions and valuation dates; incomplete or stale provider data is visibly marked.

### W5 — Data reliability, privacy and abuse hardening
**Not started.**

- [ ] Rate limits and bounded provider request budgets.
- [ ] Provider freshness metadata, retries with backoff, source outage UX and auditable data refresh.
- [ ] D1 query/index review, retention policy and user data export/deletion design.
- [ ] Security review for CSRF, user isolation, request sizes, upstream response validation and logs.
- [ ] Provider terms, attribution, caching permission and data redistribution review before broader rollout.

### W6 — Private acceptance and rollout
**CI and Worker dry-run gates passed; private device/data acceptance remains pending.**

- [x] Run all CI checks and Worker dry-run (Release validation run 42664869555 passed on implementation commit 392b5f23883c2056dd0953ee0e05b16cfc6b1959, including local SQLite migrations and Worker bundle contracts).
- [ ] Use isolated preview D1 and preview-only secrets; never point feature tests at production D1.
- [ ] Complete mobile PWA acceptance and screen-reader/basic keyboard checks.
- [ ] Verify clear paper-only language throughout the feature.
- [ ] Obtain explicit owner approval before production deployment or enabling the feature for all users.

## 8. Known limitations in this feature-branch slice

- Production rollout requires the repository release workflow and the ordered D1 migrations 0013 and 0014. No payment gateway or brokerage trade/mandate integration is included.
- Mutual-fund history depends on MFapi.in, a third-party aggregator. AMFI is the official NAV reference and source reconciliation remains an acceptance gate.
- Stock history requires the explicit `WEALTH_DHAN_ENABLED` flag, a Dhan Data API subscription and a server-only `DHAN_ACCESS_TOKEN`. The flag is `false` by default; individual tokens expire after 24 hours. Dhan says daily history is adjusted for bonuses and splits, but cash dividends are excluded.
- The sample stock price/return panel remains disabled until the owner enables Dhan Data API and configures a server-only token. Dhan daily history is bonus/split-adjusted; cash dividends are excluded, so this is price return rather than total return.
- No brokerage account connection, order placement, SIP mandate, payment, tax report or actual ownership verification exists.
- A historical SIP result is a reproducible hypothetical under the documented schedule convention, not a prediction or investment recommendation.

## 9. Implementation file map

- `src/wealth/index.ts` — isolated Wealth API and calculation logic.
- `src/config/env.ts` — optional server-only Dhan credential types.
- `migrations/0013_askmoina_live_support.sql` — preceding additive support/presence schema in the ordered migration chain.
- `migrations/0014_wealth_simulations.sql` — user-scoped SIP simulation tables.
- `public/wealth.html`, `public/wealth.css`, `public/wealth.js`, `public/wealth-demo.js` — dark, mobile-first PWA surface and live-provider demo loader.
- `test/wealth.test.ts` — calculation and input-contract tests.
- `wrangler.jsonc` — route assets through the existing authenticated Worker.



## Demo portfolio data contract (2026-11-09)

The default Wealth overview loads a fixed, clearly labelled sample portfolio so the owner can explore the screens without entering personal holdings. Only the demo inputs are static:

- Sample share-equivalent quantities and purchase dates, and sample SIP amounts/dates, are hard-coded demonstration inputs. They are not the account owner's holdings, transactions, bank records or mandates. They are never written to D1.
- Mutual-fund NAV history is fetched from MFapi.in, a third-party aggregator of AMFI-published daily NAVs. Reconcile with AMFI before any use beyond personal demonstration.
- Stock history uses DhanHQ's documented daily /charts/historical endpoint after the four sample symbols are validated against Dhan's official NSE equity instrument-master CSV. Dhan says daily historical candles are adjusted for bonuses and splits. The demo reports price returns only; cash dividends are excluded.
- Dhan Data API is an optional external subscription (currently ₹499 + applicable GST per month according to Dhan support). AskMoina does not subscribe, collect payment, or expose a payment gateway. The server-side DHAN_ACCESS_TOKEN secret and WEALTH_DHAN_ENABLED=true flag must be configured by the owner. Tokens are time-limited; expired/missing tokens cause stock values to be withheld.
- When Dhan data is not enabled or unavailable, the app still displays real NAV-based sample SIP values, while stock sample inputs remain visible with no prices or returns. Combined portfolio totals/XIRR are blank until every holding has a valid price on the same common valuation date.
- The default page never falls back to hard-coded market prices, NAVs or returns.
- There is no payment gateway, deposit/withdrawal flow, brokerage order path, trading API, or actual SIP mandate.

This mode is a personal product walkthrough. Confirm provider data-use conditions, plan entitlements, token renewal, AMFI NAV reconciliation, and device/privacy acceptance before any distribution or investment use.
