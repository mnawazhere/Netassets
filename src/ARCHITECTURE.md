# Source layout — the storage/business split

The one rule that must survive every stage (spec §7): **storage logic stays
separate from business logic**, so a cloud/sync layer later is an addition,
not a rewrite.

| Folder | Role | May import |
|---|---|---|
| `db/` | Drizzle schema, migrations, sqlite client. Storage ONLY. | drizzle, expo-sqlite |
| `repositories/` | Thin data access over `db/` (queries, change_log writes). Storage ONLY. | `db/`, `domain/` types |
| `domain/` | Pure business logic: return engine, XIRR, dedup, FX math. **No db, no React, no native imports — runs under plain Node/Jest.** | nothing app-specific |
| `adapters/` | Class-specific valuation adapters (market API, valuation marks). | `domain/`, `repositories/` |
| `services/` | Orchestration: ingestion pipeline, price refresh, seeding. | everything above |
| `components/` | UI building blocks (react-native-reusables conventions). | UI libs |
| `app/` | expo-router screens. | everything |

Dependency direction points downward in this table — `domain/` never imports
from `db/`; screens never touch sqlite directly.
