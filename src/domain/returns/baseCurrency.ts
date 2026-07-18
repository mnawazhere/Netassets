/**
 * Base-currency view of an asset's return (spec §8 v4).
 *
 * Every historical flow converts at its OWN date's rate, so the
 * base-currency gross gain naturally contains currency movement — and the
 * FX effect is then surfaced as its own line via the decomposition:
 *
 *   grossGain(base, per-date)  =  spotGrossGain  +  fxEffect
 *
 * where spotGrossGain = native gross gain × spot rate (what the asset did),
 * and fxEffect is the remainder (what the currency did to your capital).
 * fxEffect < 0 is the FX_loss line of §5; it is INSIDE grossGain, listed
 * separately for display — never subtracted twice.
 */
import { convertAtDates, rateOn, type RateSeries } from '../fx';
import { convertMinor } from '../money';
import { computeAssetReturn, type AssetReturnInput, type ReturnBreakdown } from './engine';

export interface BaseCurrencyInput extends Omit<AssetReturnInput, 'hourlyRateMinor'> {
  /** Native currency of the transactions and current value. */
  currency: string;
  baseCurrency: string;
  /** Dated series for currency → baseCurrency. Ignored when identical. */
  rates: RateSeries;
  /** Already in base currency (the user's rate is set in base). */
  hourlyRateMinor: number;
}

export interface BaseReturnBreakdown extends ReturnBreakdown {
  /** Native gross gain valued at the spot (asOf) rate — the asset's own doing. */
  spotGrossGainMinor: number;
  /** grossGain − spotGrossGain: the currency's doing. Negative = FX loss. */
  fxEffectMinor: number;
}

export function computeAssetReturnInBase(input: BaseCurrencyInput): BaseReturnBreakdown {
  const sameCurrency = input.currency.toUpperCase() === input.baseCurrency.toUpperCase();

  if (sameCurrency) {
    const r = computeAssetReturn({
      transactions: input.transactions,
      currentValueMinor: input.currentValueMinor,
      asOf: input.asOf,
      hourlyRateMinor: input.hourlyRateMinor,
    });
    return { ...r, spotGrossGainMinor: r.grossGainMinor, fxEffectMinor: 0 };
  }

  const spotRate = rateOn(input.rates, input.asOf);

  // Base-currency stream: each flow at its own date; terminal value at spot.
  const baseTxns = convertAtDates(input.transactions, input.currency, input.baseCurrency, input.rates);
  const baseCurrentValue = convertMinor(
    input.currentValueMinor,
    input.currency,
    input.baseCurrency,
    spotRate
  );
  const base = computeAssetReturn({
    transactions: baseTxns,
    currentValueMinor: baseCurrentValue,
    asOf: input.asOf,
    hourlyRateMinor: input.hourlyRateMinor,
  });

  // Native gross gain revalued at spot — the "what the asset did" line.
  const native = computeAssetReturn({
    transactions: input.transactions,
    currentValueMinor: input.currentValueMinor,
    asOf: input.asOf,
    hourlyRateMinor: 0, // labor is priced in base; native pass is for gross only
  });
  const spotGrossGain = convertMinor(
    native.grossGainMinor,
    input.currency,
    input.baseCurrency,
    spotRate
  );

  return {
    ...base,
    spotGrossGainMinor: spotGrossGain,
    fxEffectMinor: base.grossGainMinor - spotGrossGain,
  };
}
