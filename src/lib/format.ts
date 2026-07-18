import { decimalsFor, fromMinor } from '@/domain/money';

/** "AED 1,612,776" — whole units for dashboard density. */
export function money(minor: number, currency: string, opts?: { compact?: boolean }): string {
  const value = fromMinor(minor, currency);
  if (opts?.compact && Math.abs(value) >= 10000) {
    const compact =
      Math.abs(value) >= 1_000_000
        ? `${(value / 1_000_000).toFixed(2)}M`
        : `${(value / 1_000).toFixed(1)}K`;
    return `${currency.toUpperCase()} ${compact}`;
  }
  return `${currency.toUpperCase()} ${value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalsFor(currency),
  })}`;
}

/** Signed variant: "+AED 1,240" / "−AED 11,000". */
export function signedMoney(minor: number, currency: string): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '−' : '';
  return `${sign}${money(Math.abs(minor), currency)}`;
}

export function percent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

export function perHour(minorPerHour: number | null, currency: string): string {
  if (minorPerHour === null) return '—';
  const sign = minorPerHour < 0 ? '−' : '';
  return `${sign}${money(Math.abs(Math.round(minorPerHour)), currency)}/hr`;
}

export function hours(h: number): string {
  return h === 1 ? '1 hr' : `${h % 1 === 0 ? h : h.toFixed(1)} hrs`;
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
