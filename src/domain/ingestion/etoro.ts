/**
 * eToro account-statement CSV parser (spec §12: start with the exports you
 * actually have). Deterministic — no LLM needed once the format is known.
 *
 * Expected columns (eToro "Account Activity" export):
 *   Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,
 *   Balance,Position ID,Asset type,NWA
 * - Date is DD/MM/YYYY HH:MM:SS
 * - Details is "SYMBOL/CCY" (e.g. AAPL/USD)
 * - Position ID is the broker id → strong dedup key (source_txn_id)
 * - Amount is in the account currency, positive in the export even for
 *   opens; sign is derived from Type.
 */
import { toMinor } from '../money';
import type { ParsedTransaction } from './types';

const TYPE_MAP: Record<string, ParsedTransaction['type'] | 'skip'> = {
  'open position': 'BUY',
  'position closed': 'SELL',
  dividend: 'DIVIDEND',
  fee: 'FEE',
  'overnight fee': 'FEE',
  'sdrt charge': 'FEE',
  deposit: 'skip',
  withdrawal: 'skip',
  'withdraw request': 'skip',
  'account balance to mirror': 'skip',
};

const ASSET_CLASS_MAP: Record<string, ParsedTransaction['asset']['class']> = {
  stocks: 'EQUITY',
  etf: 'ETF',
  crypto: 'CRYPTO',
};

export interface EtoroParseResult {
  transactions: ParsedTransaction[];
  /** Rows we recognized but deliberately skip (deposits etc.). */
  skipped: number;
  /** Rows we could not understand — surfaced, never silently dropped. */
  unparsed: string[];
  /** Min/max txn dates — the statement window for coverage tracking. */
  periodStart: string | null;
  periodEnd: string | null;
}

export function parseEtoroCsv(csv: string, sourceAccount = 'etoro'): EtoroParseResult {
  const lines = csv.trim().split(/\r?\n/);
  const result: EtoroParseResult = {
    transactions: [],
    skipped: 0,
    unparsed: [],
    periodStart: null,
    periodEnd: null,
  };
  if (lines.length < 2) return result;

  const header = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iDate = col('date');
  const iType = col('type');
  const iDetails = col('details');
  const iAmount = col('amount');
  const iUnits = col('units');
  const iPosId = col('position id');
  const iAssetType = col('asset type');
  if (iDate < 0 || iType < 0 || iAmount < 0) {
    result.unparsed.push(lines[0]);
    return result;
  }

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvRow(line);
    const rawType = (cells[iType] ?? '').trim().toLowerCase();
    const mapped = TYPE_MAP[rawType];
    if (mapped === 'skip') {
      result.skipped++;
      continue;
    }
    if (!mapped) {
      result.unparsed.push(line);
      continue;
    }

    const date = parseEtoroDate((cells[iDate] ?? '').trim());
    const details = (cells[iDetails] ?? '').trim();
    const [symbol, ccy] = details.split('/').map((s) => s.trim());
    const amountRaw = (cells[iAmount] ?? '').trim().replace(/,/g, '');
    const units = iUnits >= 0 ? Number((cells[iUnits] ?? '').trim()) : NaN;
    const posId = iPosId >= 0 ? (cells[iPosId] ?? '').trim() : '';
    const assetType = iAssetType >= 0 ? (cells[iAssetType] ?? '').trim().toLowerCase() : '';

    if (!date || !symbol || !amountRaw || Number.isNaN(Number(amountRaw))) {
      result.unparsed.push(line);
      continue;
    }

    const currency = (ccy || 'USD').toUpperCase();
    const magnitude = Math.abs(toMinor(amountRaw, currency));
    const sign = mapped === 'BUY' || mapped === 'FEE' ? -1 : 1;

    result.transactions.push({
      asset: {
        symbol: symbol.toUpperCase(),
        name: symbol.toUpperCase(),
        class: ASSET_CLASS_MAP[assetType] ?? 'EQUITY',
        platform: 'eToro',
        currency,
      },
      type: mapped,
      date,
      amountMinor: sign * magnitude,
      currency,
      quantity: mapped === 'BUY' || mapped === 'SELL' ? (Number.isFinite(units) ? units : null) : null,
      hoursSpent: mapped === 'BUY' ? 0.1 : 0, // class default (spec §4)
      sourceAccount,
      sourceTxnId: posId ? `${posId}:${rawType}` : null,
    });

    if (!result.periodStart || date < result.periodStart) result.periodStart = date;
    if (!result.periodEnd || date > result.periodEnd) result.periodEnd = date;
  }
  return result;
}

/** DD/MM/YYYY [HH:MM:SS] → ISO YYYY-MM-DD. */
function parseEtoroDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** CSV split honoring double-quoted cells. */
function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
