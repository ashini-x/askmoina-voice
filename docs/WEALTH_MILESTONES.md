# AskMoina Wealth — feature specification and milestones

**Status:** Feature-branch implementation in progress  
**Branch:** `feat/askmoina-wealth`  
**Product surface:** AskMoina Voice authenticated mobile PWA  
**Feature name:** AskMoina Wealth (navigation label: **Wealth**)  
**Competitive reference:** INDmoney's consolidated stock, mutual-fund, portfolio-analysis and net-worth experience. This is a product-pattern reference only; AskMoina is not affiliated with INDmoney and does not copy its brand, assets, or private APIs.

## 1. Product intent

Wealth is an investment-tracking and historical paper-simulation feature inside AskMoina Voice. It is mobile-first, dark by default, and shares the existing AskMoina account session, Cloudflare Worker, D1 database and PWA installation shell.

The first use case is to replay a hypothetical Indian mutual-fund SIP history from January 2023 using observed NAV records. A later stock ledger will replay hypothetical stock purchases from January 2022 only after instrument identity and corporate actions can be reconciled.

**Non-negotiable truthfulness rule:** a simulated historical return must never be presented as actual ownership, broker-confirmed holdings, an executed SIP, actual allotment, or a guaranteed future result. All balances originate from provider data and saved paper transactions. No sample money, synthetic percentage gains, guessed market prices, or invented stock quantities are permitted.

## 2. Product reference and experience

INDmoney is the reference for the *combined wealth surface*: holdings across equities and mutual funds, portfolio analysis and consolidated value. AskMoina Wealth uses its own information architecture and AskMoina visual language.

- Mobile-first, dark graphite / midnight surfaces with restrained emerald positive-return colour.
- Main sections: Overview, Mutual Funds, Stocks.
- Consolidated summary is blank until a provider-backed simulation exists.
- Mutual-fund scheme search is provider-backed; the user selects the exact plan and scheme code.
- SIP builder captures monthly amount per scheme, SIP day, start date and end date.
- Simulation detail exposes invested capital, accumulated units, latest NAV and its date, absolute return, XIRR, and missed SIP dates.
- The current Stocks panel deliberately displays provider readiness and the outstanding corporate-action gate. It does not invent stock values while that gate is open.

## 3. Data providers and provenance

### Mutual-fund NAV

- Primary public reference: [AMFI NAV Download and NAV History](https://www.amfiindia.com/net-asset-value/nav-download). AMFI publishes NAV reports and historical NAV downloads; its UI notes that each historical download can cover a maximum of 90 days.
- Initial read-only API adapter: [MFapi.in documentation](https://www.mfapi.in/docs/), using scheme search, scheme NAV history and latest NAV endpoints. MFapi.in is a third-party aggregator, not AMFI. Treat its observations as provider-sourced data that must remain attributable and subject to reconciliation against AMFI before a non-simulated use case.
- Cloudflare's edge cache reduces repeat provider calls: scheme search for six hours, latest NAV for 15 minutes, and historical NAV ranges for 24 hours. Cache failure never fabricates or substitutes data.
- A latest NAV older than seven calendar days, or dated in the future, is withheld from current valuation. A consolidated value requires an exact NAV observation for every selected scheme on the same shared valuation date; no older NAV is carried forward to make an aggregate appear complete. Where that exact-date match cannot be formed, aggregate return fields stay unavailable.
- Data routes: `GET /api/wealth/funds/search?q=`, `GET /api/wealth/funds/:schemeCode/nav?fromDate=&toDate=`.
- Search surfaces Growth options only. Direct and Regular plans remain separate schemes and must not be mixed. IDCW / dividend / bonus-labelled options are excluded from the first SIP simulator.
- Every NAV observation is validated for positive finite NAV, parseable date and exact scheme-code match. Upstream failure produces an error; it is never replaced with a guessed value. SIP POST bodies are also streamed through a 24 KB hard limit, and date cutoffs use the Asia/Kolkata calendar date.

### Equity daily history

- Planned provider: [DhanHQ Historical Data API](https://dhanhq.co/docs/v2/historical-data/). Its documented daily endpoint returns OHLCV and epoch timestamps for a supplied exchange instrument/security ID. The [Dhan instrument list](https://dhanhq.co/docs/v2/instruments/) is the identity source to integrate.
- The read-only Worker adapter requires `WEALTH_DHAN_ENABLED=true` and a server-only `DHAN_ACCESS_TOKEN` secret. The official daily-history request authenticates with the `access-token` header; no client-ID header is sent. The feature flag is explicitly `false` in both production and preview config. Never put the token in `wrangler.jsonc`, the browser, test fixtures, or committed files.
- Dhan documents a 24-hour validity for individually generated access tokens and notes Data API charges/limits can apply. This feature slice has no automatic token renewal. A personal individual token must not be used as a shared data proxy for other AskMoina users unless Dhan has confirmed the applicable usage/partner entitlement in writing. Leave the feature flag off until entitlement, cost, allowed user scope and renewal operations are settled. The daily API's `toDate` is non-inclusive.
- Current adapter output is explicitly raw daily close data with `adjustedForCorporateActions: false` and `canCalculateTotalReturn: false`. It is not permitted to feed the portfolio return summary.
- No NSE/BSE security ID is inferred from a symbol. A verified symbol/exchange/security-ID master is required before users can create stock paper lots.

## 4. SIP calculation contract

A plan contains one exact scheme code and exact scheme name returned by the NAV provider, a positive monthly amount in paise, SIP day (1–28), start date and end date.

For each monthly scheduled date:

1. Generate the calendar SIP date using the selected day. A maximum of 120 instalments is accepted per plan.
2. Select the **first actual NAV observation on or after** the scheduled date, provided it is no more than seven calendar days later.
3. If there is no qualifying NAV, record that scheduled date as a missed instalment. Do not move the purchase backwards, interpolate NAV, or silently fill the gap.
4. Compute paper units as monthly amount in rupees divided by the matched NAV. The stored number is unrounded calculation precision; UI formatting is display-only.
5. Persist the scheduled date, matched NAV date, invested paise, NAV and units. A simulation is persisted only after all selected plans have valid history and all database statements succeed in one D1 batch.

Absolute return is `(current value - invested amount) / invested amount`. XIRR is calculated separately from dated negative SIP cash flows and one positive terminal valuation cash flow; it is not an annualized version of absolute return.

For a combined valuation, the Worker chooses the oldest of the latest NAV dates returned for all schemes as a candidate shared as-of date. Any scheme with a newer latest NAV is queried for an observation on that exact candidate date. If even one scheme has no NAV observation on that exact date, the aggregate current value and aggregate returns remain unavailable rather than carrying an older NAV forward or mixing unaligned snapshots.

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
- [x] SIP schedule, seven-day forward NAV matching, explicit missed dates and unit calculation.
- [x] Persist user-owned SIP plans and per-instalment evidence.
- [x] Absolute-return and XIRR calculation with exact common-date NAV matching; no carry-forward pricing.
- [x] Edge-cache public NAV responses and withhold stale/future latest NAVs.
- [x] Dark mobile PWA builder and simulation detail screen.
- [x] Unit tests for date parsing, schedule generation, NAV matching, Growth-option/scheme-code validation, XIRR, India date boundary and bounded request-body handling.
- [ ] Run repository typecheck and complete test suite on the feature branch.
- [ ] Exercise live MFapi.in search, one NAV history request and one latest NAV request; reconcile selected observations against AMFI.
- [ ] Verify persisted records, duplicate protection, owner isolation and partial-failure behaviour against a non-production D1 database.
- [ ] Capture mobile device acceptance evidence (Android Chrome installed PWA, small viewport, safe-area, offline shell).

**Acceptance:** no simulated result is marked accepted until the same scheme/date/amount inputs reproduce the same stored purchase lots, source NAV dates, invested total, current NAV valuation, absolute return and XIRR in a second read.

### W2 — Equity instrument master and daily history
**Adapter scaffold present; disabled without credentials.**

- [x] Read-only DhanHQ daily-history adapter.
- [x] Server-only credential contract; no browser token exposure.
- [x] Explicit opt-in flag is false in production and preview by default; only the official access-token header is sent; individual-token and Data API entitlement caveats are documented.
- [x] Raw price series explicitly marked unadjusted and barred from total-return calculations.
- [ ] Add verified Dhan instrument-master ingestion and symbol/exchange/security-ID mapping.
- [ ] Configure Dhan secrets in a preview-only Worker environment.
- [ ] Test 2022-to-current date ranges against known exchange trading sessions and compare sample candles to a second trusted source.

**Acceptance:** every stock data point maps to a documented instrument identity and is timestamped/source-attributed. No ticker-only guesses.

### W3 — Corporate-action-adjusted stock ledger
**Not started; mandatory before stock performance is shown.**

- [ ] Model stock paper lots with exchange, security ID, symbol, purchase date, quantity, price and source.
- [ ] Ingest and verify splits, bonus issues, mergers, demergers, symbol changes and delistings.
- [ ] Handle cash dividends separately from price return and document reinvestment assumptions (default: dividends excluded from price-return; total-return view only where complete verified data exists).
- [ ] Apply corporate actions to quantity and cost basis without double-counting.
- [ ] Add regression fixtures around representative corporate-action events.

**Acceptance:** adjusted share quantity and cost basis reconcile to trusted corporate-action records. Until then, only raw candles may be inspected; no long-term stock holding percentage may be shown.

### W4 — Consolidated portfolio and richer mobile charts
**Not started.**

- [ ] Combine accepted stock and mutual-fund paper ledgers under one as-of policy.
- [ ] Build portfolio performance history from stored evidence (not a hand-drawn or fabricated curve).
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
**Not started.**

- [ ] Run all CI checks and Worker dry-run.
- [ ] Use isolated preview D1 and preview-only secrets; never point feature tests at production D1.
- [ ] Complete mobile PWA acceptance and screen-reader/basic keyboard checks.
- [ ] Verify clear paper-only language throughout the feature.
- [ ] Obtain explicit owner approval before production deployment or enabling the feature for all users.

## 8. Known limitations in this feature-branch slice

- No Worker deployment or remote D1 migration is performed by this feature-branch change.
- Mutual-fund history depends on MFapi.in, a third-party aggregator. AMFI is the official NAV reference and source reconciliation remains an acceptance gate.
- Stock history requires the explicit `WEALTH_DHAN_ENABLED` flag and a Dhan access token. Neither is enabled/configured by this branch; individual access tokens expire after 24 hours and Data APIs may incur charges. Raw OHLC is not corporate-action adjusted.
- The stock holdings and stock return ledger are not yet enabled.
- No brokerage account connection, order placement, SIP mandate, payment, tax report or actual ownership verification exists.
- A historical SIP result is a reproducible hypothetical under the documented schedule convention, not a prediction or investment recommendation.

## 9. Implementation file map

- `src/wealth/index.ts` — isolated Wealth API and calculation logic.
- `src/config/env.ts` — optional server-only Dhan credential types.
- `migrations/0014_wealth_simulations.sql` — user-scoped SIP simulation tables.
- `public/wealth.html`, `public/wealth.css`, `public/wealth.js` — dark, mobile-first PWA surface.
- `test/wealth.test.ts` — calculation and input-contract tests.
- `wrangler.jsonc` — route assets through the existing authenticated Worker.
