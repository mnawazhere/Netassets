# Personal Asset Manager — Build Spec

A local-first iOS app that tracks a person's entire net worth across
heterogeneous assets (equities, crypto, ETFs, property, collectibles),
and — the differentiator — computes each asset's **true, cost- and
labor-adjusted return**, including the hours it costs you priced at your
own hourly rate.

Built for a UAE user first (multi-currency, AED base), single-user now,
architected to add accounts + cloud later without a rewrite.

---

## 1. Product goals

1. **Total net asset value** across every asset class, in one base currency.
2. **True return, not naive return.** A "100% gain" is meaningless until
   you subtract fees, spread, FX, *and* the hours the asset cost you.
   Output the headline metric: **effective return per hour of your life.**
3. **Frictionless capture.** Upload PDFs/statements, screenshots, or a
   voice note. The engine parses, structures, and — critically — never
   double-adds. Manual entry is the fallback, never the default.

---

## 2. Core architectural spine

Every asset, however different its mechanics, reduces to one model. Do
**not** special-case asset classes at the data layer — only at the
valuation adapter.

```
Asset
 ├─ class: EQUITY | CRYPTO | ETF | PROPERTY | COLLECTIBLE
 ├─ valuation adapter (class-specific)
 ├─ base metadata: name, platform/location, currency
 ├─ Lots[]           (each acquisition)
 │    └─ quantity, unit_price, date, fees, currency, source_ref
 └─ Transactions[]   (the cashflow stream)
      └─ type: BUY | SELL | DIVIDEND | RENT | FEE | MAINTENANCE
              | TRANSFER | VALUATION_MARK
         date, amount, quantity, currency, hours_spent, source_ref, fingerprint
```

- **Net worth** = Σ adapter.current_value(asset), converted to base currency.
- **Cost basis** = weighted from Lots.
- **True return** = XIRR over the Transaction cashflow stream, with fees and
  labor cost injected as negative cashflows (see §5).

This single spine handles a stock (many lots), a house (one lot, qty=1,
recurring RENT/MAINTENANCE txns), and a Pokémon box (one lot, one
VALUATION_MARK you update manually).

---

## 3. Asset-class adapters

Each adapter answers one question: **what is this worth right now, in its
native currency?**

### 3.1 Equities / Crypto / ETFs
- Auto-priced by ticker/symbol. Scope is global markets that are
  well-served (US equities, crypto, major ETFs).
  **UAE local exchanges (ADX/DFM) are explicitly out of scope** — any
  local-exchange holding is entered manually, same path as property.
- **Providers (Stage 4, resolved):** equities/ETFs via Stooq EOD CSV
  (keyless, delayed EOD; has a daily hit quota — fine for a personal
  handful of tickers, quota-exceed → stale cache). Crypto via CoinGecko
  public tier (keyless). Fallbacks if Stooq bites in practice: Finnhub or
  Twelve Data (both keyed, free tiers) — pending a UAE-accessibility check
  from the phone.
- Every fetcher returns null on failure → last cached price, marked stale;
  nothing throws for network reasons.
- Refresh on app open + pull-to-refresh; cache last price with timestamp.
- Multi-account aware: same ticker held on eToro *and* IBKR = two positions
  under one asset, so "location of assets" is preserved.

### 3.2 Property
- **Perceived value, set by voice or manual entry** (e.g. "Reeman unit's
  worth ~1.6M now, getting 7k a month rent" → a VALUATION_MARK + a RENT
  transaction). Stored as VALUATION_MARK txns so value history is a real
  time series, not a single overwritten number.
- Recurring inflows: RENT/dividend. Recurring outflows: service charge,
  maintenance, loan/finance payment. (For an Islamic Ijarah, model the
  finance payment as rent-to-own, not interest — label accordingly.)
- Default maintenance time: ~10 hrs/month, editable.

### 3.3 Collectibles (Pokémon, art, graded cards)
- **Resolved (Stage 4): no API credibly prices sealed Japanese product** —
  which is the bulk of the collection (Japanese Mega Evolution sealed sets).
  So this class is **valuation marks + screenshot capture** (Stage 5), full
  stop, and does not depend on any pricing API.
- **Possible later enhancement, graded English singles only:** pokemonpricetracker
  or PriceCharting can auto-refresh a *matched* graded/raw single. Wire it as
  optional auto-refresh keyed on a stored external id, falling back to
  marks/screenshot on any miss — never a hard dependency. Match-rate should be
  measured (probe script) before leaning on it. Note: pokemonpricetracker
  gates Japanese + sealed data to its paid tier and commercial use to $99/mo,
  which matters only in the multi-user phase.
- Graded vs sealed vs raw matters; store grade + grader (PSA/BGS/CGC).

---

## 4. Time & labor model

The user's hours are a real cost. Two kinds:

- **Transaction time** — one-off per transaction (research, paperwork,
  standing in line). *Example: buying a sealed box — 4 hrs in line + 1 hr
  travel = 5 hrs on that BUY.*
- **Maintenance time** — recurring, per asset (a rental ≈ 10 hrs/mo, a
  stock ≈ 0).

Rules:
- Every asset class ships a **sensible default** (editable): stock buy ≈ 0.1 hr,
  graded card ≈ 3 hr to source+grade+ship, property ≈ 10 hr/mo.
- The number is always present so nothing blocks capture; the user refines
  only where they care.
- `hours_spent` lives on each Transaction, so it flows straight into the
  return engine.

**Global setting (onboarding):** one **hourly rate**. Copy must clarify
it's "what an hour of your time is worth" — actual earning rate and
subjective value give very different answers. Changing it recomputes
everything live.

---

## 5. Return + cost-of-time engine

The heart of the app. For each asset (and the portfolio):

```
gross_gain      = current_value + realized_proceeds + income − cost_basis
monetary_costs  = fees + spread + FX_loss + maintenance_money
labor_cost      = Σ(transaction.hours_spent) × hourly_rate
true_profit     = gross_gain − monetary_costs − labor_cost

XIRR            = money-weighted annualized return over the full dated
                  cashflow stream (buys −, sells +, income +, fees −).
                  Fees in; labor OUT — keeps the % interpretable as a
                  standard return-on-capital. Labor's lens lives below.

return_per_hour = (gross_gain − monetary_costs) / Σ(hours_spent)
                  = what you earned per hour of effort; compare DIRECTLY to
                  hourly_rate. Do NOT subtract labor_cost here — dividing an
                  already-labor-netted figure by hours double-counts.
```

Three complementary headline metrics — keep them DISTINCT, never merge:
- **True profit** (currency) = gross − money − labor. All-in net treating
  your time as a real cost. Worked example → AED −11k.
- **Annualized return %** = XIRR (money-weighted; fees in, labor out).
- **Return per hour of your life** = (gross − money) / hours, vs your
  hourly-rate baseline → the "was it worth it?" verdict. Worked example →
  AED 208/hr vs a 300 baseline → not worth it.

Worked example (rental, one year): nets AED 40k, −AED 15k money costs,
−120 hrs. At AED 300/hr baseline → labor cost AED 36k → true profit
≈ AED −11k, ~AED 208/hr effective. Verdict: the day job beat it.

---

## 6. Ingestion pipeline (onboarding = upload whatever you can export)

Three capture paths, all converging on structured Transactions:

1. **PDF / statement** (e.g. eToro export) → vision model parses rows.
2. **Screenshot** (collector app, broker screen) → vision model extracts.
3. **Voice note** ("bought 2 boxes for 400 dirhams each, spent 5 hours") →
   speech-to-text → LLM → structured transaction.

### Idempotent dedup (the "don't double-add" requirement)
- Each parsed transaction gets a **fingerprint**:
  - **If the statement provides a broker/order transaction ID, use it**
    (`hash(asset_id + source_account + source_txn_id)`). This is the only
    reliable idempotency key — it survives re-imports AND keeps two
    genuinely identical trades distinct.
  - **Fallback (no ID):** `hash(asset_id + date + type + quantity +
    amount + source_account)`. This CANNOT distinguish a re-import from two
    real identical same-day trades, so on collision it must NOT hard-fail —
    route to the review queue below.
- **Exact match → auto-skip silently.** Re-importing the same PDF is a no-op.
  The import path catches the unique-index violation and skips gracefully;
  a duplicate fingerprint must never surface as an uncaught DB throw.
- **Near-match / ambiguous collision** (overlapping window, rounding diffs,
  ID-less identical trades) → queue for **one-tap review**
  (keep / merge / discard). Never silently drop or dupe.
- **Lots must be idempotent on re-import too.** Derive cost-basis lots from
  BUY/SELL transactions (single source of truth), or give `lots` its own
  dedup key — otherwise a re-import skips the transaction but duplicates the
  lot and double-counts cost basis.
- Every transaction stores `source_ref` (which file/import produced it).
- Every imported **statement** stores its date range, so the engine knows
  which periods are already covered and flags gaps/overlaps.

---

## 7. Data model (SQLite)

Tables: `assets`, `lots`, `transactions`, `valuation_marks`, `imports`
(one per uploaded file, with date range + provenance), `settings`
(hourly_rate, base_currency), `fx_rates` (cached), `price_cache`,
`change_log`.

**`change_log` (audit trail).** Any manually-set number anywhere — property
value, dividend, loan payment, maintenance, hourly rate, a corrected
transaction — writes a row: entity, field, old_value, new_value, timestamp,
source (voice / manual / import). This makes value history auditable and
trustworthy, and powers the property value chart. Cheap to build, high trust
payoff.

- **UUID primary keys everywhere** (multi-user + cloud-ready).
- Keep **storage logic separate from business logic** so a sync/cloud layer
  is an addition, not a rewrite.
- Store all monetary amounts with their **native currency**; convert only at
  display/aggregation time using `fx_rates`.

---

## 8. Multi-currency / FX

Non-negotiable core, not a feature. User holds USD (stocks/crypto), JPY
(Japanese sealed product), AED (property). Base currency = AED (default,
changeable). Live FX pulled + cached.

**Convert each historical flow at its as-of-date rate — NEVER a single spot
rate for the whole stream.** Converting all history at today's rate strips
out the FX gain/loss, which is exactly the transaction cost this app exists
to expose. Store `fx_rates` as a dated series; the engine looks up the rate
for each flow's date. Surface the FX effect (`FX_loss`) as its own monetary
-cost line so it shows up in true profit and drags XIRR. `convertTransactions`
taking one fixed rate is a Stage-3 stepping stone only — portfolio
aggregation must use per-date rates.

**FX provider (Stage 4, resolved):** fawazahmed0 exchange-api (keyless,
no rate limits, 200+ currencies incl. AED/JPY, dated historical URLs),
with the USD→AED central-bank peg (3.6725) hardcoded as last-resort
fallback. Guard against inversion: assert a fetched USD→AED rate lands
near the peg before trusting a series. It's a single community-maintained
source — a second keyless FX source is a hardening item for the multi-user
phase (JPY etc. have no fallback today; outages degrade to stale, not wrong).

---

## 9. Screens (MVP)

1. **Dashboard** — total net worth, allocation by class, allocation by
   location/platform, top movers.
2. **Asset list** — grouped by class and by location, each row showing value
   + true return + return/hour.
3. **Asset detail** — value history chart, transaction timeline (dates are
   the spine), the full return breakdown from §5.
4. **Capture** — the big one: voice / photo / upload PDF, with a review
   queue for dedup ambiguities.
5. **Settings** — hourly rate, base currency, per-class time defaults.

---

## 10. Tech stack

- **App:** Expo / React Native (real native iOS).
- **UI:** NativeWind (Tailwind) + **react-native-reusables** (shadcn/ui
  ported to RN) — keeps the shadcn look natively.
- **Local storage:** expo-sqlite + Drizzle ORM. Local-first, on-device.
- **Charts:** Victory Native or react-native-skia.
- **Voice:** Expo audio → speech-to-text model.
- **Design language:** navy + white, clean financial feel, custom
  ASCII-style loaders/animations. Data-dense but calm.

---

## 11. Model routing (build + runtime)

| Job | Model |
|---|---|
| App architecture, XIRR/return engine, adapters, dedup logic | **Claude Opus 4.8** (Claude Code) |
| Bulk UI components, CRUD, glue | **Claude Sonnet 5** (Claude Code) |
| Voice → transcript | dedicated speech-to-text model (not Claude) |
| Transcript → structured transaction | **Claude Sonnet 5** (Haiku for trivial) |
| Messy PDF/statement parsing (vision) | **Claude Opus 4.8**, drop to Sonnet once a format is known |
| Screenshot → {item, grade, value} | **Claude Sonnet 5** (vision) |
| Transaction categorize / dedup near-match scoring (high volume) | **Claude Haiku 4.5** |
| In-app "is this worth holding?" insight | **Claude Sonnet 5**, Opus for deep analysis |

---

## 12. Scope discipline

**MVP:** manual + voice + screenshot capture; 1–2 known statement formats
(start with the exports you actually have, e.g. eToro); equities/crypto
auto-priced; property + collectibles manual-with-assist; the full return
+ cost-of-time engine; local-first single user.

**Deliberately later:** arbitrary-broker PDF parsing (a long tail — don't
turn this into a document-parsing company), cloud sync + accounts,
sharing/multi-user, UAE local-exchange auto-pricing if a provider proves
reliable.

---

## 13. Provider decisions

**Resolved (Stage 4):**
- Equities/ETFs → Stooq EOD CSV (keyless). Crypto → CoinGecko public.
- FX → fawazahmed0 exchange-api + USD→AED peg fallback, per-date historical.
- Collectibles → no API for sealed Japanese product; marks + screenshot.
  Graded English singles only are a possible later auto-refresh.

**Still open:**
- **Stooq UAE-accessibility** — verify from the phone before Stage 6; if it
  geoblocks or the quota bites, swap to Finnhub / Twelve Data. Until then the
  stale-cache path must be *visible* in the UI, not silent.
- **Speech-to-text provider (Stage 5)** — on-device vs cloud; on-device
  favors the local-first privacy stance.
