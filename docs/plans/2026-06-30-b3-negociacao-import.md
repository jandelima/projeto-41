# B3 Negociação Import — Plan

## Goal

Import a user's real B3 trades into the app automatically, without maintaining
each operation by hand. Runs on localhost only.

## Why this route

B3 has **no** official retail API for an investor's own operations. The
practical, low-risk path is to consume the export the B3 investor portal already
produces:

`investidor.b3.com.br` → **Extratos → Negociação** → export **Excel (.xlsx)**.

No credentials in the app, no scraping, no ToS gray area. The user downloads the
file occasionally and imports it. (Automated portal login was rejected: MFA +
undocumented internal API = fragile and not worth it for a personal tool.)

## Source file format (Negociação export)

One row per trade. Columns (Portuguese, may vary slightly by export version):

| Column                    | Meaning                     | Maps to        |
|---------------------------|-----------------------------|----------------|
| `Data do Negócio`         | trade date (DD/MM/YYYY)     | `date`         |
| `Tipo de Movimentação`    | `Compra` / `Venda`          | `type`         |
| `Mercado`                 | e.g. "Mercado à Vista"      | (filter/ignore)|
| `Instituição`             | broker                      | (ignore/notes) |
| `Código de Negociação`    | ticker (e.g. `PETR4`)       | `asset`        |
| `Quantidade`              | shares                      | `quantity`     |
| `Preço`                   | unit price (BRL)            | (derive check) |
| `Valor`                   | total (BRL)                 | `total`        |

Target `Operation`: `{ portfolio: "b3", type, asset, date, quantity, total,
currency: "BRL" }`.

Mapping rules:
- `Compra` → `buy`, `Venda` → `sell`.
- Date `DD/MM/YYYY` → ISO `YYYY-MM-DD`.
- Ticker uppercased. Fractional tickers (suffix `F`, e.g. `PETR4F`) → normalize
  to the base ticker `PETR4` (decide: merge or keep separate — default merge).
- `total` from `Valor`; keep `Preço` only to sanity-check `Valor ≈ Preço × Quantidade`.

## Companion file: Movimentação export

Separate export (`Extratos → Movimentação`) carries dividends, JCP, subscriptions,
bonifications, splits. Feeds the existing **dividendos** feature. Out of scope for
v1 — note it as a follow-up so provento rows aren't mistaken for trades.

## Implementation steps

1. **Parser** — `apps/api/src/import/b3-negociacao.ts`
   - Accept `.xlsx`. Add SheetJS (`xlsx`) dependency (current importer is CSV-only
     and hand-rolled). Alternative to avoid the dep: require the user to
     "Save As CSV" in Excel and reuse a CSV path — but xlsx direct is better UX.
   - Detect the B3 header layout (by column names, tolerant to order/extra cols).
   - Return `ParsedOperationRow[]` with `portfolio: "b3"`.
   - Skip non-`Mercado à Vista` rows (options/termo) or flag them.

2. **Generalize the importer** — today
   `apps/api/src/export/operations-csv.ts::parseOperationsCsv` hardcodes
   `portfolio: "crypto"`. Make portfolio a parameter (or infer per-source) so B3
   rows land in the b3 portfolio.

3. **Route** — `POST /api/import/b3/negociacao`
   - Content-type `multipart/form-data` or raw `.xlsx` body (Fastify needs
     `@fastify/multipart` for file upload, or read raw buffer).
   - Validate each row with the existing `operationSchema`. All-or-nothing insert
     (mirror the CSV importer: reject the whole file if any row invalid, return 400).
   - After insert, trigger `priceService.runB3()` (or per-symbol) so new tickers
     get a price. Icons resolve automatically via `/api/icons/b3/{ticker}`.
   - Idempotency: dedupe against existing operations (same asset+date+type+
     quantity+total) so re-importing an overlapping export doesn't double-count.

4. **Frontend** — B3 Portfolio page (`apps/web/src/pages/Portfolio.tsx`)
   - Add an "Importar B3 (.xlsx)" button next to the existing crypto CSV
     import/export controls (currently gated behind `isCrypto`).
   - Toast with imported/skipped counts, then reload operations + portfolios.

5. **Tests**
   - Parser: sample B3 header → correct rows; `Compra/Venda` mapping; date
     conversion; `Valor` vs `Preço×Quantidade` tolerance; fractional-ticker
     normalization.
   - Route: happy path count, invalid-row rejection (no partial insert), dedupe
     on re-import.

## Open decisions

- **Dedupe key** — B3 export has no trade id; rely on
  asset+date+type+quantity+total. Same-day identical fills would collapse. Accept,
  or add an occurrence counter.
- **Fractional tickers** — merge `PETR4F` into `PETR4` (default) or keep separate.
- **xlsx dependency** vs CSV-only (user converts). Default: add `xlsx`.
- **Fees/IRRF** — Negociação export gives gross trade value; broker fees live on
  the nota de corretagem, not here. v1 ignores fees (matches current manual entry).

## Explicitly out of scope (v1)

- Automated portal login / internal-API scraping.
- Movimentação (proventos) import.
- Nota de corretagem PDF parsing.
- Fee/tax reconciliation.
