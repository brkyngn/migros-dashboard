# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Note: `README.md`, `KURULUM.md`, and `PROJE-YAPISI.md` are **outdated** — they describe an SQLite database and a `backend/`+`agent/` directory split that no longer exist. The real system uses **PostgreSQL** (Railway) and a flat repo layout. Trust the code over those docs.

## Commands

All commands run from the repo root.

```bash
# Install everything (postinstall also installs client deps)
npm install

# Build the React client into client/dist (server serves this statically)
npm run build

# Run BOTH processes together (production start): server.js + agent.js
npm start          # concurrently "node server.js" "node agent.js"

# Run just the agent (scheduler + Migros data fetch)
npm run agent

# Frontend dev server with HMR (proxies /api, /auth, /report to localhost:8080)
cd client && npm run dev

# Lint the React client
cd client && npm run lint
```

There is **no test suite**. Verification is done by hitting endpoints (see Debug/verification below).

**Dev port gotcha:** `client/vite.config.ts` proxies API calls to `localhost:8080`, but `server.js` defaults `PORT` to `3000`. For local dev with the Vite proxy, start the server with `PORT=8080 node server.js`.

## Architecture

Two independent Node processes share one PostgreSQL database (`DATABASE_URL`, SSL required). They are started together by `npm start` but never call each other in-process.

### `server.js` — Express API + static host
- Serves the built React SPA from `client/dist`, plus legacy static HTML tools under `frontend/` (`/tools`, `/karsilastirma`, `/gunluk-stok`).
- **Two classes of endpoints:**
  - **`/report/*`, `/isleticirapor/*`, `/auth/login`** — thin proxies that forward the browser's request straight to the Migros B2B API (`api-prod.migros.com.tr`). Auth headers (`Authorization`, `ConnectionCode`) pass through from the client.
  - **`/api/db-*`** — read the local Postgres tables (`db-stok`, `db-gunluk`, `db-ozet`, `db-stok-gecmis`, etc.). This is what the React app actually consumes via `client/src/api/migros.ts`.
- **`/api/agent-stok`, `/api/agent-gunluk`, `/api/agent-calistir`** — let the UI manually trigger a Migros fetch using the server's own login (mirrors the agent's fetch logic).
- **`/api/trigger-email`** — manually send the daily report email (same code path as the agent's scheduled send).
- Also has one-off maintenance endpoints (`/api/fix-date-format`, `/api/temizle-bozuk-tarih`, `/api/import-excel-satis`) used to repair data.

### `agent.js` — scheduled data fetcher + emailer
- A `setInterval` 1-minute tick drives everything (see `startScheduler`). Times are computed in **Turkey time (UTC+3)** by offsetting `Date.now()`.
- **Günlük Satış** retries from 06:00 TR, **Stok** from 06:15 TR, each **every 30 min until it succeeds**. Success/failure flags (`satisBasarili`, `stokBasarili`, `emailGonderildi`) reset at midnight TR.
- When **both** sales and stock succeed, it sends the daily email once (`emailGonderildi` guard).
- Migros auth = SHA1(`connectionCode` + username) sent as the `ConnectionCode` header (see `sha1()` / `fetchData()`).
- **Stok pagination is mandatory:** the stok endpoint returns `next_url`; you must follow every page until it's null or Migros locks the session. `extractPath()` strips the API prefix off `next_url`; there's a 20-page safety cap.
- Sales/stock rows are stamped with `veri_tarihi` and upserted. `gunluk_satis` uses `ON CONFLICT (...) DO NOTHING` for idempotency; columns are auto-added via `ensureColumns()` because the Migros payload shape can vary.

### `emailReport.js` — shared email module
Imported by **both** `server.js` and `agent.js` (single source of truth — don't duplicate email logic into either).
- `buildEmailData(pool, date)` — queries yesterday's sales, current-month sales, all-time cumulative sales, and latest stock. **Stock always uses `MAX(veri_tarihi)`**, not a hardcoded date, because stok data may lag behind the sales date.
- `buildEmailHTML(data)` — table-based HTML email (email-client-safe inline styles).
- `resendSend(...)` — sends via the **Resend HTTP API** (`api.resend.com`) using the native `https` module. This is deliberate: the deploy host (Render) blocks SMTP ports, and the `resend` npm package had connection issues here, so raw HTTPS on port 443 is used — the same pattern as the Migros API calls. From address is a verified domain (`rapor@kittycady.com`).
- `EMAIL_TO` supports a **comma-separated** list of recipients.

### `financeRoutes.js` + `invoiceAI.js` — P&L (Kâr/Zarar) modülü
- `financeRoutes.js` exports `financeRoutes(pool)` (Express router mounted at `/api` in server.js — **must stay registered before the SPA fallback**, so it's mounted at module scope right after pool creation) and `initializeFinanceTables(pool)` (called in `startServer`; idempotent CREATE TABLE + seed).
- Tables: `products` (SKU cards: birim_maliyet, komisyon_orani_override, koli_ici_adet), `expense_categories` (each mapped to a P&L block: SMM/KANAL/IADE_FIRE/PAZARLAMA/OPERASYONEL/PERSONEL/FINANSMAN/DIGER), `expenses`, `recurring_expenses`, `settings` (key-value: komisyon_orani=50, satis_kdv_orani=20, `satis_kdv_dahil=false` — NetSalesValue is VAT-exclusive).
- **Recurring expenses materialize on read** (`materializeRecurring`): every `GET /api/expenses` / `GET /api/pnl` inserts missing monthly rows with `ON CONFLICT (tekrarlayan_id, donem) DO NOTHING` (partial unique index). Templates are deactivated, never deleted (FK from materialized rows).
- P&L math lives server-side: `GET /api/pnl?from&to` (waterfall JSON), `/api/pnl/trend?months=12`, `/api/pnl/unit-economics?from&to` (per-box breakdown + breakeven), `/api/stok-sermayesi`. Sales queries CAST TEXT columns and guard with `"DateTransaction" ~ '^\d{4}-\d{2}-\d{2}'`.
- `invoiceAI.js` — `POST /api/fatura-analiz`: multer **memoryStorage** (file never touches disk), 15MB / pdf+jpg+png+webp whitelist, Anthropic `claude-opus-4-8` with `output_config.format` json_schema (no temperature — 400s on Opus 4.8). Returns parsed JSON only; saving always goes through user-approved `POST /api/expenses`. Requires `ANTHROPIC_API_KEY`.
- Frontend: pages `Expenses.tsx` / `ProfitLoss.tsx` / `FinanceSettings.tsx`, api client `client/src/api/finance.ts`, types `client/src/types/finance.ts`, Turkish number input parsing in `client/src/utils/money.ts` (`parseTrNumber` — comma decimal). Sidebar is grouped (Migros / Finans) with localStorage-persisted collapse state.

### `client/` — React 19 + Vite + TypeScript + Tailwind SPA
- Single-page app with **manual page switching via `useState`** in `App.tsx` (no router). Pages live in `client/src/pages/`.
- Data fetched through `client/src/api/migros.ts`, which hits the server's `/api/db-*` endpoints.
- Tailwind custom colors: `ac: #C0392B` (Active Carbon), `mb: #1A3A5C` (Marseille Breeze), `sidebar: #1A1A2E`.

## Key domain facts

- **Two tracked SKUs** (hardcoded in `emailReport.js`): `41075315` = Active Carbon 5L, `41075312` = Marseille Breeze 5L (Kittycady cat litter).
- **Stok table column names come from the Migros payload in Turkish**, and are the frequent source of bugs. Store identity is `TESLIM_NOKTASI_ID` (delivery point), quantity is `STOK_MIKTARI`, SKU is `SATICI_URUN_KODU`, product name is `URUN_SATICI_ADI`. There is **no** `MAGAZA_NO`/`StoreNumber` column — code that assumes those will silently produce zeros.
- `gunluk_satis` uses different (English) column names: `SupplierItemNumber` (SKU), `QuantitySold`, `NetSalesValue`, `StoreNumber`, `DateTransaction`.
- **Date format hazard:** `DateTransaction` should be `YYYY-MM-DD`. Excel imports / older records sometimes land as `MM/DD/YYYY HH:MM:SS`; `normalizeDateStr()` in `agent.js` fixes new inserts, and `/api/fix-date-format` repairs existing rows.

## Deployment

Deployed on **Render** (Railway's IPs are blocked by the Migros API; Render's are not). Build/start via `nixpacks.toml` → `npm install && npm run build`, then `npm start`. Node 20 (`.node-version`, `.nvmrc`). `docker-compose.yml` exists but is legacy/unused.

Required env vars: `DATABASE_URL`, `MIGROS_USERNAME`, `MIGROS_PASSWORD`, `SATICI_ID`, `RESEND_API_KEY`, `EMAIL_TO`, `EMAIL_FROM`, `PORT`, `ANTHROPIC_API_KEY` (fatura AI).

## Debugging / verification

- `GET /api/health` — liveness.
- `GET /api/debug/stok-schema` — dumps the live `stok` table columns + a sample row. Use this first whenever stock values come back zero; the cause is almost always a column-name mismatch in `emailReport.js`.
- `POST /api/trigger-email` — send the report on demand to verify email content end-to-end.
- `cekme_loglari` table + the process console logs record every fetch/email attempt (`BAŞARILI` / `HATA`).
