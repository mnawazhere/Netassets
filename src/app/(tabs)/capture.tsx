import DateTimePicker from '@react-native-community/datetimepicker';
import * as React from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Chip, ChipRow } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { AssetClass, TransactionType } from '@/db/schema';
import { searchSymbols } from '@/domain/symbols/search';
import type { SecurityEntry } from '@/domain/symbols/types';
import {
  classHoursDefault,
  importEtoroCsvFile,
  listAssetOptions,
  listKnownAccounts,
  submitManualTransaction,
  useAiSettings,
  useReviewQueue,
} from '@/hooks/data';
import type { CaptureProposal } from '@/domain/capture/structure';
import { fromMinor } from '@/domain/money';
import { todayISO } from '@/lib/format';
import { structureCapture } from '@/services/ai/structurer';
import { assumeQuantity } from '@/services/assumeQty';
import {
  ensureVoicePermissions,
  pickAndOcrImage,
  startVoiceCapture,
  voiceAvailable,
  type VoiceSession,
} from '@/services/capture/sources';

const TXN_TYPES: readonly TransactionType[] = ['BUY', 'SELL', 'DIVIDEND', 'RENT', 'FEE', 'MAINTENANCE'];
const CLASSES: readonly AssetClass[] = ['EQUITY', 'CRYPTO', 'ETF', 'PROPERTY', 'COLLECTIBLE'];
const MARKET_CLASSES = new Set<AssetClass>(['EQUITY', 'CRYPTO', 'ETF']);

export default function CaptureScreen() {
  const review = useReviewQueue();
  const ai = useAiSettings();
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
  const [account, setAccount] = React.useState('');
  const [knownAccounts, setKnownAccounts] = React.useState<string[]>([]);
  const [location, setLocation] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);
  const [qtyHint, setQtyHint] = React.useState<string | null>(null);
  const [assuming, setAssuming] = React.useState(false);
  const [voiceSession, setVoiceSession] = React.useState<VoiceSession | null>(null);
  const [transcript, setTranscript] = React.useState('');
  const [captureBusy, setCaptureBusy] = React.useState<'voice' | 'photo' | null>(null);
  const [captureNote, setCaptureNote] = React.useState<string | null>(null);

  const reloadAssets = React.useCallback(async () => {
    setAssets(await listAssetOptions());
    setKnownAccounts(await listKnownAccounts());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([listAssetOptions(), listKnownAccounts()]).then(([opts, accounts]) => {
      if (cancelled) return;
      setAssets(opts);
      setKnownAccounts(accounts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    void (async () => {
      const cls = assetId ? (assets.find((a) => a.id === assetId)?.class ?? 'COLLECTIBLE') : newAssetClass;
      setHoursSpent(String(await classHoursDefault(cls)));
    })();
  }, [assetId, newAssetClass, assets]);

  const selected = assets.find((a) => a.id === assetId) ?? null;

  // Assume-at-market: price the symbol on the chosen date and pre-fill
  // qty = amount ÷ price. A proposal only — the field stays editable.
  const assumableSymbol = assetId ? (selected?.symbol ?? null) : (binding?.symbol ?? null);
  const onAssumeQty = async (): Promise<void> => {
    if (!assumableSymbol || !activeClass) return;
    setAssuming(true);
    try {
      const est = await assumeQuantity({
        symbol: assumableSymbol,
        class: activeClass,
        amountMajor: amount.trim(),
        amountCurrency: currency.trim() || 'AED',
        date: date.trim(),
      });
      if (!est) {
        Alert.alert(
          "Couldn't price",
          'No market price reachable for that symbol/date (or no FX rate for the amount currency). Enter the quantity manually.'
        );
        return;
      }
      setQuantity(String(est.quantity));
      setQtyHint(
        `≈ ${est.quantity} @ ${est.priceCurrency} ${fromMinor(est.priceMinor, est.priceCurrency)} (${est.priceAsOf.slice(0, 10)}) — edit if wrong`
      );
    } finally {
      setAssuming(false);
    }
  };

  const activeClass = assetId ? (selected?.class ?? null) : newAssetClass;
  const isMarketTxn = activeClass !== null && MARKET_CLASSES.has(activeClass);
  const accountChips = [...new Set(['etoro', 'trading212', ...knownAccounts])];

  /** A validated proposal PRE-FILLS the form — the user reviews and taps
   *  Save; capture never writes to the DB directly (spec §6 review gate). */
  const applyProposal = (p: CaptureProposal, source: 'voice' | 'ocr'): void => {
    const existing = assets.find((a) => a.name.toLowerCase() === p.assetName.toLowerCase());
    if (existing) {
      setAssetId(existing.id);
    } else {
      setAssetId(null);
      setNewAssetName(p.assetName);
      setNewAssetClass(p.class);
    }
    setType(p.type);
    setAmount(p.amount);
    setCurrency(p.currency);
    setDate(p.date);
    setQuantity(p.quantity !== null ? String(p.quantity) : '');
    if (p.hoursSpent !== null) setHoursSpent(String(p.hoursSpent));
    if (p.account) setAccount(p.account);
    setCaptureNote(
      `${source === 'voice' ? 'Voice' : 'Screenshot'} → form (confidence ${Math.round(p.confidence * 100)}%). Review below, then Save.`
    );
  };

  const structureText = async (text: string, source: 'voice' | 'ocr'): Promise<void> => {
    if (!ai.enabled) {
      Alert.alert(
        'Cloud structuring is off',
        'Turning speech/screenshots into transactions sends the extracted TEXT (redacted on-device) to the AI. Enable "AI symbol lookup" in Settings and add an API key to use capture.'
      );
      return;
    }
    const proposal = await structureCapture(text, source, todayISO());
    if (!proposal || proposal.confidence === 0) {
      Alert.alert(
        "Couldn't structure that",
        source === 'voice'
          ? 'The transcript did not parse into a transaction. The text stays below — fill the form manually.'
          : 'No transaction found in that image. Fill the form manually.'
      );
      return;
    }
    applyProposal(proposal, source);
  };

  const onVoicePress = async (): Promise<void> => {
    if (voiceSession) {
      voiceSession.stop(); // end listener finishes the flow
      return;
    }
    if (!(await ensureVoicePermissions())) {
      Alert.alert('Microphone unavailable', 'Voice capture needs mic + speech permissions (Settings → Netassets).');
      return;
    }
    setTranscript('');
    setCaptureNote(null);
    const session = startVoiceCapture(setTranscript, (finalText) => {
      setVoiceSession(null);
      if (!finalText) {
        setCaptureBusy(null);
        return;
      }
      void (async () => {
        setCaptureBusy('voice');
        try {
          await structureText(finalText, 'voice');
        } finally {
          setCaptureBusy(null);
        }
      })();
    });
    if (!session) {
      Alert.alert('Voice capture unavailable', 'On-device speech recognition needs the dev/Release build (not Expo Go).');
      return;
    }
    setVoiceSession(session);
  };

  const onPhotoPress = async (): Promise<void> => {
    setCaptureBusy('photo');
    setCaptureNote(null);
    try {
      const text = await pickAndOcrImage();
      if (text === null) {
        setCaptureBusy(null);
        return; // cancelled, denied, or OCR unavailable — no alert spam
      }
      setTranscript(text);
      await structureText(text, 'ocr');
    } finally {
      setCaptureBusy(null);
    }
  };

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
            // Market assets locate via each txn's account; others via the
            // asset's platform label (Home safe, Al Reeman…).
            platform: isMarketTxn ? account.trim() || null : location.trim() || null,
            currency: currency.toUpperCase(),
          },
      type,
      date: date.trim(),
      amount: amount.trim(),
      currency,
      quantity: quantity.trim() ? Number(quantity) : null,
      hoursSpent: hoursSpent.trim() ? Number(hoursSpent) : 0,
      // Where this trade sits — drives the by-location view (§3.1).
      sourceAccount: isMarketTxn ? account.trim() || null : null,
      note: null,
    };
    const showResult = async (result: Awaited<ReturnType<typeof submitManualTransaction>>) => {
      if (result.ok) {
        Alert.alert(
          'Saved',
          [
            result.priced === false
              ? 'Transaction recorded — but the price fetch FAILED (offline, or the provider is unreachable from this network). The asset shows unpriced until a refresh succeeds.'
              : result.priced === true
                ? 'Transaction recorded — priced and tracking.'
                : 'Transaction recorded (audited in change log).',
            'assumedQty' in result && result.assumedQty
              ? `Qty assumed: ${result.assumedQty.quantity} @ the ${result.assumedQty.priceAsOf.slice(0, 10)} market price — edit the transaction if the broker fill differed.`
              : null,
          ]
            .filter(Boolean)
            .join('\n\n')
        );
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

  const onResolveReview = async (
    item: { id: string; reason: string },
    decision: 'kept' | 'merged' | 'discarded'
  ) => {
    setResolvingId(item.id);
    try {
      await review.resolve(item.id, decision);
      // A confirmed binding changes the asset (bound + priced) — refresh so
      // the capture form's options don't keep the stale unbound asset.
      if (item.reason === 'binding-confirm') await reloadAssets();
    } catch (e) {
      // e.g. double-tap raced the reload: 'Review item already kept/discarded'.
      Alert.alert('Could not resolve', String(e instanceof Error ? e.message : e));
      await review.reload();
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled">
      <Card>
        <CardHeader>
          <Text variant="heading">Import</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Button label="Import eToro statement (CSV)" onPress={onImportCsv} disabled={busy} />
          <Button
            label={
              voiceSession
                ? '■ Stop — structure the note'
                : captureBusy === 'voice'
                  ? 'Structuring…'
                  : voiceAvailable()
                    ? '🎙 Voice note'
                    : 'Voice note — needs dev build'
            }
            variant={voiceSession ? 'default' : 'outline'}
            onPress={() => void onVoicePress()}
            disabled={captureBusy !== null || !voiceAvailable()}
          />
          <Button
            label={captureBusy === 'photo' ? 'Reading…' : '📷 Photo / screenshot'}
            variant="outline"
            onPress={() => void onPhotoPress()}
            disabled={captureBusy !== null || voiceSession !== null}
          />
          {transcript !== '' ? (
            <Text variant="muted" className="text-sm" numberOfLines={4}>
              “{transcript}”
            </Text>
          ) : null}
          {captureNote ? (
            <Text className="text-sm text-gain">{captureNote}</Text>
          ) : null}
          <Text variant="muted" className="text-xs">
            Speech and OCR run on this device — only redacted text is sent for structuring, and
            nothing saves without your review below.
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
                      “{p.candidate.forQuery}” matched {b.displayName} — {b.symbol} ·{' '}
                      {(p.fetchedPriceMinor / 100).toFixed(2)} {b.currency}
                    </Text>
                    <Text variant="muted" className="text-xs">
                      Fuzzy match from an import — confirm it’s the right security before it
                      auto-prices. Until then it’s tracked unpriced.
                    </Text>
                    <View className="flex-row gap-2">
                      <Button label="Track" size="sm" disabled={resolvingId !== null} onPress={() => void onResolveReview(item, 'kept')} />
                      <Button label="Don't track" size="sm" variant="outline" disabled={resolvingId !== null} onPress={() => void onResolveReview(item, 'discarded')} />
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
                    <Button label="Keep" size="sm" disabled={resolvingId !== null} onPress={() => void onResolveReview(item, 'kept')} />
                    {item.reason === 'near-match' ? (
                      <Button label="Merge" size="sm" variant="secondary" disabled={resolvingId !== null} onPress={() => void onResolveReview(item, 'merged')} />
                    ) : null}
                    <Button label="Discard" size="sm" variant="outline" disabled={resolvingId !== null} onPress={() => void onResolveReview(item, 'discarded')} />
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
          {/* Chips keyed/selected by asset id, not name — duplicate names must
              not collide, and an asset literally named '+ new' must not hit
              the sentinel. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            <Chip label="+ new" selected={assetId === null} onPress={() => setAssetId(null)} />
            {assets.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                selected={a.id === assetId}
                onPress={() => {
                  setAssetId(a.id);
                  // Prefill from the asset at pick time; stays user-editable after.
                  setCurrency(a.currency);
                }}
              />
            ))}
          </ScrollView>
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
          {isMarketTxn ? (
            <>
              <Text variant="muted">Account — where you hold it (drives the by-location view)</Text>
              <ChipRow
                options={accountChips as readonly string[]}
                value={account || null}
                onChange={setAccount}
              />
              <Input
                label="or type another account"
                value={account}
                onChangeText={setAccount}
                autoCapitalize="none"
                placeholder="etoro / trading212 / ibkr…"
              />
            </>
          ) : !assetId ? (
            <Input
              label="Location / platform (e.g. Home safe, Al Reeman)"
              value={location}
              onChangeText={setLocation}
            />
          ) : null}
          <Text variant="muted">Type</Text>
          <ChipRow
            options={isMarketTxn ? TXN_TYPES : [...TXN_TYPES, 'VALUATION_MARK' as TransactionType]}
            value={type}
            onChange={setType}
          />
          {type === 'VALUATION_MARK' ? (
            <Text variant="muted" className="text-xs">
              A statement of current worth ("it's worth X now") — updates the asset's value, not a
              cashflow.
            </Text>
          ) : null}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            </View>
            <View className="w-24">
              <Input label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
            </View>
          </View>
          <View className="flex-row items-end gap-3">
            <View className="flex-1 gap-1">
              <Text variant="muted" className="text-sm">
                Date
              </Text>
              <View className="flex-row">
                <DateTimePicker
                  value={new Date(`${date}T12:00:00Z`)}
                  mode="date"
                  display="compact"
                  onValueChange={(_e, d) => {
                    if (d) setDate(d.toISOString().slice(0, 10));
                  }}
                />
              </View>
            </View>
            <View className="w-24">
              <Input
                label="Qty"
                value={quantity}
                onChangeText={(v) => {
                  setQuantity(v);
                  setQtyHint(null); // a manual edit supersedes the estimate
                }}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {isMarketTxn && assumableSymbol && (type === 'BUY' || type === 'SELL') ? (
            <>
              <Button
                label={assuming ? 'Pricing…' : `Assume qty @ ${assumableSymbol} market price`}
                size="sm"
                variant="secondary"
                onPress={() => void onAssumeQty()}
                disabled={assuming || !amount.trim() || !date.trim()}
              />
              {qtyHint ? (
                <Text variant="muted" className="text-xs">
                  {qtyHint}
                </Text>
              ) : null}
            </>
          ) : null}
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
