import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { shouldShowPerHour } from '@/domain/display';
import { useAssetDetail } from '@/hooks/data';
import { hours, money, percent, perHour, shortDate, signedMoney } from '@/lib/format';

function Row({ label, value, accent }: { label: string; value: string; accent?: 'gain' | 'loss' }) {
  return (
    <View className="flex-row justify-between">
      <Text variant="muted">{label}</Text>
      <Text className={`font-mono text-sm ${accent === 'gain' ? 'text-gain' : accent === 'loss' ? 'text-loss' : ''}`}>
        {value}
      </Text>
    </View>
  );
}

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { detail } = useAssetDetail(id);

  if (!detail) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text variant="mono" className="text-muted-foreground">
          ▚▞ loading…
        </Text>
      </View>
    );
  }
  if (!detail.entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text>Asset not found</Text>
      </View>
    );
  }

  const { entry, portfolio, marks, txns } = detail;
  const base = portfolio.baseCurrency;
  const b = entry.breakdown;
  const maxMark = Math.max(...marks.map((m) => m.valueMinor), 1);

  return (
    <>
      <Stack.Screen options={{ title: entry.name }} />
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4">
        <Card>
          <CardHeader>
            <Text variant="muted">
              {entry.class} · {entry.currency}
              {entry.valuation?.stale ? ' · cached price' : ''}
            </Text>
          </CardHeader>
          <CardContent>
            <Text variant="title" className="font-mono text-3xl">
              {entry.valuation ? money(entry.valuation.amountMinor, entry.valuation.currency) : '—'}
            </Text>
            {entry.valuation ? (
              <Text variant="muted" className="mt-1">
                as of {shortDate(entry.valuation.asOf)}
              </Text>
            ) : (
              <Text variant="muted" className="mt-1">
                {entry.providerId
                  ? 'no price yet — pull to refresh on the dashboard'
                  : 'unpriced — tracked without auto-pricing (set a valuation mark, or bind a symbol)'}
              </Text>
            )}
          </CardContent>
        </Card>

        {b ? (
          <Card>
            <CardHeader>
              <Text variant="heading">Return breakdown ({base})</Text>
            </CardHeader>
            <CardContent className="gap-1.5">
              <Row label="Gross gain" value={signedMoney(b.grossGainMinor, base)} />
              <Row label="  asset performance" value={signedMoney(b.spotGrossGainMinor, base)} />
              <Row
                label="  FX effect"
                value={signedMoney(b.fxEffectMinor, base)}
                accent={b.fxEffectMinor < 0 ? 'loss' : undefined}
              />
              <Row label="Monetary costs" value={`−${money(b.monetaryCostsMinor, base)}`} />
              <Row label={`Labor (${hours(b.totalHours)})`} value={`−${money(b.laborCostMinor, base)}`} />
              <View className="my-1 border-t border-border" />
              <Row
                label="True profit"
                value={signedMoney(b.trueProfitMinor, base)}
                accent={b.trueProfitMinor >= 0 ? 'gain' : 'loss'}
              />
              <Row label="Money return (simple)" value={percent(b.moneyReturnFraction)} />
              <Row label="Annualized (XIRR)" value={percent(b.xirr)} />
              {shouldShowPerHour(b.totalHours) ? (
                <>
                  <Row
                    label="Return per hour"
                    value={perHour(b.returnPerHourMinor, base)}
                    accent={
                      b.returnPerHourMinor != null &&
                      b.returnPerHourMinor >= portfolio.hourlyRateMinor
                        ? 'gain'
                        : 'loss'
                    }
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    baseline: your rate {money(portfolio.hourlyRateMinor, base)}/hr —{' '}
                    {b.returnPerHourMinor != null &&
                    b.returnPerHourMinor >= portfolio.hourlyRateMinor
                      ? 'worth it'
                      : 'the day job beat it'}
                  </Text>
                </>
              ) : (
                <Text variant="muted" className="mt-1 text-xs">
                  under an hour invested — per-hour not meaningful
                </Text>
              )}
            </CardContent>
          </Card>
        ) : null}

        {entry.accountPositions.length > 0 ? (
          <Card>
            <CardHeader>
              <Text variant="heading">By platform</Text>
            </CardHeader>
            <CardContent className="gap-2">
              {entry.accountPositions.map((p) => (
                <View key={p.account ?? 'unassigned'} className="gap-0.5">
                  <View className="flex-row justify-between">
                    <Text className="font-semibold">{p.account ?? 'Unassigned'}</Text>
                    <Text className="font-mono text-sm">{money(p.valueMinor, entry.currency)}</Text>
                  </View>
                  <Text variant="muted" className="text-xs">
                    {p.quantity} units
                    {p.avgCostMinor != null
                      ? ` · avg cost ${money(p.avgCostMinor, entry.currency)}`
                      : ''}
                  </Text>
                </View>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {marks.length > 0 ? (
          <Card>
            <CardHeader>
              <Text variant="heading">Value history</Text>
            </CardHeader>
            <CardContent className="gap-2">
              {marks.map((m) => (
                <View key={`${m.date}-${m.valueMinor}`} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text variant="muted" className="text-xs">
                      {m.date}
                    </Text>
                    <Text className="font-mono text-xs">{money(m.valueMinor, m.currency)}</Text>
                  </View>
                  <View className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <View
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (m.valueMinor / maxMark) * 100)}%` }}
                    />
                  </View>
                </View>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <Text variant="heading">Timeline</Text>
          </CardHeader>
          <CardContent className="gap-2">
            {txns.map((t) => (
              <View key={t.id} className="flex-row items-center justify-between border-b border-border pb-2">
                <View className="flex-1">
                  <Text className="text-sm font-semibold">{t.type}</Text>
                  <Text variant="muted" className="text-xs">
                    {t.date}
                    {t.sourceAccount ? ` · ${t.sourceAccount}` : ''}
                    {t.hoursSpent > 0 ? ` · ${hours(t.hoursSpent)}` : ''}
                  </Text>
                </View>
                <Text className={`font-mono text-sm ${t.amountMinor >= 0 ? 'text-gain' : ''}`}>
                  {signedMoney(t.amountMinor, t.currency)}
                </Text>
              </View>
            ))}
          </CardContent>
        </Card>
      </ScrollView>
    </>
  );
}
