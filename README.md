# Netassets — Personal Asset Manager

Local-first iOS app that tracks net worth across heterogeneous assets
(equities, crypto, ETFs, property, collectibles) and computes each asset's
**true, cost- and labor-adjusted return** — including the hours it costs
you, priced at your own hourly rate.

Source of truth: [`docs/asset-tracker-build-spec.md`](docs/asset-tracker-build-spec.md).
Source layout and the storage/business split: [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).

## Stack

- Expo (SDK 57) / React Native, TypeScript, expo-router
- NativeWind (Tailwind) + react-native-reusables conventions — navy/white theme
- expo-sqlite + Drizzle ORM (local-first, on-device)
- Jest for the pure business-logic layer (`src/domain` — no simulator needed)

## Commands

```bash
npm start            # Expo dev server
npm run ios          # iOS simulator (macOS)
npm test             # Jest — domain unit tests
npm run typecheck    # tsc --noEmit
npm run db:generate  # drizzle-kit migrations from src/db/schema.ts
```

## Build stages

1. ✅ Scaffold (this)
2. Data model — 9 tables, UUID PKs, migrations + seed
3. Return + cost-of-time engine (XIRR, true profit, return/hour) — test-first
4. Valuation adapters + FX
5. Ingestion + dedup (asset resolution → fingerprint)
6. Screens
