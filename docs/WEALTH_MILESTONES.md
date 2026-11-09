# AskMoina Wealth — frontend-only portfolio interface

**Status:** Private owner/admin interface preview  
**Branch:** `feat/askmoina-wealth`  
**Surface:** Authenticated AskMoina Voice PWA at `/wealth`

## Product intent

A mobile-first portfolio dashboard with the familiar structure of a retail investing app: portfolio value, day and overall P&L, performance chart, stock and mutual-fund holdings, allocation, watchlist, and activity timeline.

This is a **frontend-only visual demo** for the project owner. It is not a multi-user financial product.

## Data and integration boundary

- All holdings, symbols, quantities, average prices, last prices, dates, watchlist quotes, chart points, and activity entries are static illustrative values embedded in the frontend.
- No stock or fund data provider is called.
- No broker login, broker API, market-data subscription, account linking, backend market-data API, or D1 schema is used by this feature.
- No actual portfolio is imported or stored.
- No trading, order placement, payments, SIP mandates, deposits, or withdrawals exist.
- Visible notices identify the values as demo data, not live quotes or financial records.
- The route and homepage shortcut are limited to AskMoina admin/owner sessions. The general user menu does not expose the feature.
- The page uses the existing PWA shell.

## Interface

- Portfolio: total portfolio value, invested capital, day P&L, overall return, and selectable 1D/1W/1M/3M/1Y/ALL illustrative chart ranges.
- Holdings: equity and mutual-fund rows, quantities/units, sample average price, sample last price, market value, and P&L.
- Allocation: equity vs mutual-fund split.
- Watchlist: static sample instruments and percentage moves.
- Activity: static sample buy/SIP-style timeline entries for visual completeness only.

## Release gates

- [x] Responsive frontend with no market-data or Wealth API fetches.
- [x] Static demo holdings, prices, allocation, chart, watchlist, and activity.
- [x] Wealth-specific Worker API, D1 migration, and broker secret dependencies removed.
- [x] Page and homepage shortcut restricted to the owner/admin.
- [ ] Run release validation and verify the preview on Android.
- [ ] Confirm the visual design and sample values on the owner's device before merging.

## Important

Do not present demo values as actual portfolio data. Do not connect this frontend to trading or provider APIs without a separate, explicit scope and data-rights review.
