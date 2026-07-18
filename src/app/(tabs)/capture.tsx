import * as React from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChipRow } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { AssetClass, TransactionType } from '@/db/schema';
import { searchSymbols } from '@/domain/symbols/search';
import type { SecurityEntry } from '@/domain/symbols/types';
import {
  classHoursDefault,
  importEtoroCsvFile,
  listAssetOptions,
  submitManualTransaction,
  useReviewQueue,
} from '@/hooks/data';
import { todayISO } from '@/lib/format';

const TXN_TYPES: readonly TransactionType[] = ['BUY', 'SELL', 'DIVIDEND', 'RENT', 'FEE', 'MAINTENANCE'];
const CLASSES: readonly AssetClass[] = ['EQUITY', 'CRYPTO', 'ETF', 'PROPERTY', 'COLLECTIBLE'];
const MARKET_CLASSES = new Set<AssetClass>(['EQUITY', 'CRYPTO', 'ETF']);

export default function CaptureScreen() {
  const review = useReviewQueue();
  const [assets, setAssets] = React.useState<
    Awaited<ReturnType<typeof listAssetOptions>>
  >([]);
  const [assetId, setAssetId] = React.useState<string | null>(null);
  const [newAssetName, setNewAssetName] = React.useState('');
  const [newAssetClass, setNewAssetClass] = React.useState<AssetClass>('COLLECTIBLE');
  const [symbolQuery, setSymbolQuery] = React.useState('');
  const [binding, setBinding] = React.useState<SecurityEntry | null>(null);
  const [type, setType] = React.useState<TransactionType>('BUY');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('AED');
  const [date, setDate] = React.useState(todayISO());
  const [quantity, setQuantity] = React.useState('');
  const [hoursSpent, setHoursSpent] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reloadAssets = React.useCallback(async () => {
    setAssets(await listAssetOptions());
  }, []);

  React.useEffect(() => {
    void reloadAssets();
  }, [reloadAssets]);

  React.useEffect(() => {
    void (async () => {
      const cls = assetId ? (assets.find((a) => a.id === assetId)?.class ?? 'COLLECTIBLE') : newAssetClass;
      setHoursSpent(String(await classHoursDefault(cls)));
    })();
  }, [assetId, newAssetClass, assets]);

  const selected = assets.find((a) => a.id === assetId) ?? null;
  React.useEffect(() => {
    if (selected) setCurrency(selected.currency);
  }, [selected]);

  const onImportCsv = async () => {
    setBusy(true);
    try {
      const res = await importEtoroCsvFile();
      if (res.picked) {
        const { summary, unparsed } = res;
        const coverage = summary.coverage.overlaps.length
          ? '\nOverlaps an already-imported statement — duplicates were deduped.'
          : summary.coverage.gapBefore
            ? `\nGap in coverage before this statement (${summary.coverage.gapBefore.from} → ${summary.coverage.gapBefore.to}).`
            : '';
        Alert.alert(
          'Import finished',
          `${summary.inserted} added · ${summary.skippedExact} duplicates skipped · ` +
            `${summary.queuedForReview} for review · ${summary.assetsCreated} new asset(s)` +
            (unparsed ? `\n${unparsed} row(s) not understood — kept out.` : '') +
            coverage
        );
        await Promise.all([reloadAssets(), review.reload()]);
      }
    } catch (e) {
      Alert.alert('Import failed', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitManual = async () => {
    setBusy(true);
    const entry = {
      assetId,
      newAsset: assetId
        ? null
        : {
            name: newAssetName.trim(),
            class: newAssetClass,
            symbol: binding?.symbol ?? null,
            providerId: binding?.providerId ?? null,
            platform: null,
            currency: currency.toUpperCase(),
          },
      type,
      date: date.trim(),
      amount: amount.trim(),
      currency,
      quantity: quantity.trim() ? Number(quantity) : null,
      hoursSpent: hoursSpent.trim() ? Number(hoursSpent) : 0,
      sourceAccount: null,
      note: null,
    };
    const showResult = async (result: Awaited<ReturnType<typeof submitManualTransaction>>) => {
      if (result.ok) {
        Alert.alert('Saved', 'Transaction recorded (audited in change log).');
        setAmount('');
        setQuantity('');
        await reloadAssets();
      } else if ('confirmBinding' in result) {
        // Gate 2 (§6 v10): test-fetch passed, the entity still needs a human.
        const p = result.confirmBinding;
        const b = p.candidate.binding;
        Alert.alert(
          'Track this security?',
          `Matched ${b.displayName} — ${b.symbol} · ` +
            `${(p.fetchedPriceMinor / 100).toFixed(2)} ${b.currency}` +
            (p.candidate.origin === 'ai' ? '\n(AI-suggested — verify it is the right entity)' : ''),
          [
            {
              text: "Don't track (unpriced)",
              style: 'cancel',
              onPress: () =>
                void submitManualTransaction(entry, { pending: p, accepted: false }).then(showResult),
            },
            {
              text: 'Track',
              onPress: () =>
                void submitManualTransaction(entry, { pending: p, accepted: true }).then(showResult),
            },
          ]
        );
      } else {
        Alert.alert('Not saved', result.reason);
      }
    };
    try {
      await showResult(await submitManualTransaction(entry));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4">
      <Card>
        <CardHeader>
          <Text variant="heading">Import</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Button label="Import eToro statement (CSV)" onPress={onImportCsv} disabled={busy} />
          <Button label="Voice note — needs dev build" variant="outline" disabled />
          <Button label="Photo / screenshot — needs dev build" variant="outline" disabled />
          <Text variant="muted" className="text-xs">
            Voice (on-device speech) and vision capture arrive with the iOS dev build; both feed
            the same dedup pipeline the CSV import uses.
          </Text>
        </CardContent>
      </Card>

      {review.items.length > 0 ? (
        <Card>
          <CardHeader>
            <Text variant="heading">Review queue ({review.items.length})</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {review.items.map((item) => {
              if (item.reason === 'binding-confirm') {
                const p = JSON.parse(item.payload) as {
                  candidate: {
                    binding: { displayName: string; symbol: string; currency: string; providerId: string };
                    origin: string;
                    forQuery: string;
                  };
                  fetchedPriceMinor: number;
                };
                const b = p.candidate.binding;
                return (
                  <View key={item.id} className="gap-2 border-b border-border pb-3">
                    <Text className="text-sm">
                      "{p.candidate.forQuery}" matched {b.displayName} — {b.symbol} ·{' '}
                      {(p.fetchedPriceMinor / 100).toFixed(2)} {b.currency}
                    </Text>
                    <Text variant="muted" className="text-xs">
                      Fuzzy match from an import — confirm it's the right security before it
                      auto-prices. Until then it's tracked unpriced.
                    </Text>
                    <View className="flex-row gap-2">
                      <Button label="Track" size="sm" onPress={() => review.resolve(item.id, 'kept')} />
                      <Button label="Don't track" size="sm" variant="outline" onPress={() => review.resolve(item.id, 'discarded')} />
                    </View>
                  </View>
                );
              }
              const p = JSON.parse(item.payload) as {
                type: string;
                date: string;
                amountMinor: number;
                currency: string;
              };
              return (
                <View key={item.id} className="gap-2 border-b border-border pb-3">
                  <Text className="text-sm">
                    {p.type} · {p.date} · {p.amountMinor / 100} {p.currency}
                  </Text>
                  <Text variant="muted" className="text-xs">
                    {item.reason === 'weak-collision'
                      ? 'Identical to an existing transaction — same trade re-imported, or a real second one?'
                      : 'Almost identical to an existing transaction (rounding difference).'}
                  </Text>
                  <View className="flex-row gap-2">
                    <Button label="Keep" size="sm" onPress={() => review.resolve(item.id, 'kept')} />
                    {item.reason === 'near-match' ? (
                      <Button label="Merge" size="sm" variant="secondary" onPress={() => review.resolve(item.id, 'merged')} />
                    ) : null}
                    <Button label="Discard" size="sm" variant="outline" onPress={() => review.resolve(item.id, 'discarded')} />
                  </View>
                </View>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <Text variant="heading">Manual entry</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted">Asset</Text>
          <ChipRow
            options={['+ new', ...assets.map((a) => a.name)] as readonly string[]}
            value={assetId ? (selected?.name ?? null) : '+ new'}
            onChange={(name) => setAssetId(name === '+ new' ? null : (assets.find((a) => a.name === name)?.id ?? null))}
          />
          {!assetId ? (
            <>
              <Text variant="muted">Class</Text>
              <ChipRow
                options={CLASSES}
                value={newAssetClass}
                onChange={(c) => {
                  setNewAssetClass(c);
                  setBinding(null);
                  setSymbolQuery('');
                }}
              />
              {MARKET_CLASSES.has(newAssetClass) ? (
                binding ? (
                  <View className="rounded-lg border border-primary bg-secondary px-3 py-2">
                    <Text className="text-sm font-semibold">
                      {binding.displayName} — {binding.symbol}
                      {binding.exchange ? ` (${binding.exchange})` : ''}
                    </Text>
                    <Text variant="muted" className="text-xs">
                      prices via {binding.providerId} ·{' '}
                      <Text className="text-xs underline" onPress={() => setBinding(null)}>
                        change
                      </Text>
                    </Text>
                  </View>
                ) : (
                  <>
                    <Input
                      label="Search security (name or ticker — offline index)"
                      value={symbolQuery}
                      onChangeText={setSymbolQuery}
                      autoCapitalize="none"
                    />
                    {symbolQuery.trim()
                      ? searchSymbols(symbolQuery, { class: newAssetClass as SecurityEntry['class'], limit: 5 }).map((e) => (
                          <Text
                            key={e.providerId}
                            className="border-b border-border py-2 text-sm"
                            onPress={() => {
                              setBinding(e);
                              setNewAssetName(e.displayName);
                              setCurrency(e.currency);
                            }}>
                            {e.displayName} — {e.symbol}
                            {e.exchange ? ` (${e.exchange})` : ''}
                          </Text>
                        ))
                      : null}
                    {symbolQuery.trim() &&
                    searchSymbols(symbolQuery, { class: newAssetClass as SecurityEntry['class'], limit: 1 }).length === 0 ? (
                      <Text variant="muted" className="text-xs">
                        No match in the offline index — it can be added unpriced (tracked like a
                        collectible). AI lookup arrives in the next stage.
                      </Text>
                    ) : null}
                  </>
                )
              ) : null}
              <Input label="New asset name" value={newAssetName} onChangeText={setNewAssetName} />
            </>
          ) : null}
          <Text variant="muted">Type</Text>
          <ChipRow options={TXN_TYPES} value={type} onChange={setType} />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            </View>
            <View className="w-24">
              <Input label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            </View>
            <View className="w-24">
              <Input label="Qty" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
            </View>
          </View>
          <Input
            label="Hours spent (defaults per class, edit if you care)"
            value={hoursSpent}
            onChangeText={setHoursSpent}
            keyboardType="decimal-pad"
          />
          <Button label="Save transaction" onPress={onSubmitManual} disabled={busy || !amount.trim()} />
        </CardContent>
      </Card>
    </ScrollView>
  );
}
