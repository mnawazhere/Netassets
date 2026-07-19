import * as React from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { AllocationBars } from '@/components/allocation';
import { NavChart } from '@/components/navChart';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useIncome, useNavHistory, usePortfolio } from '@/hooks/data';
import { money, signedMoney } from '@/lib/format';

export default function DashboardScreen() {
  const { view, loading, refresh } = usePortfolio();
  const { history, reload: reloadHistory } = useNavHistory();
  const { income, reload: reloadIncome } = useIncome();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      await Promise.all([reloadHistory(), reloadIncome()]);
    } catch (e) {
      Alert.alert('Refresh failed', String(e instanceof Error ? e.message : e));
    } finally {
      setRefreshing(false);
    }
  }, [refresh, reloadHistory, reloadIncome]);

  if (loading || !view) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text variant="mono" className="text-muted-foreground">
          ▚▞ loading…
        </Text>
      </View>
    );
  }

  const { netWorth, baseCurrency } = view;
  const movers = view.assets
    .filter((a) => a.breakdown)
    .sort((a, b) => b.breakdown!.trueProfitMinor - a.breakdown!.trueProfitMinor);
  const top = movers.slice(0, 2);
  const bottom = movers.length > 2 ? movers.slice(-1) : [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {view.anyStale ? (
        <View className="rounded-lg border border-border bg-secondary px-3 py-2">
          <Text className="text-sm text-muted-foreground">
            ⚠ Prices couldn&apos;t refresh — showing last known
            {view.oldestAsOf ? ` (as of ${view.oldestAsOf.slice(0, 10)})` : ''}. Pull to retry.
          </Text>
        </View>
      ) : null}

      <Card>
        <CardHeader>
          <Text variant="muted">Total net worth</Text>
        </CardHeader>
        <CardContent>
          <Text variant="title" className="font-mono text-3xl">
            {money(netWorth.totalMinor, baseCurrency)}
          </Text>
          {netWorth.liabilitiesTotalMinor > 0 ? (
            <Text variant="muted" className="mt-1 font-mono text-sm">
              Assets {money(netWorth.assetsTotalMinor, baseCurrency)} − debts{' '}
              {money(netWorth.liabilitiesTotalMinor, baseCurrency)}
            </Text>
          ) : null}
          {netWorth.unvalued.length > 0 ? (
            <Text variant="muted" className="mt-1">
              {netWorth.unvalued.length} asset(s) unvalued — not included
            </Text>
          ) : null}
          {netWorth.unconvertedLiabilities.length > 0 ? (
            <Text variant="muted" className="mt-1">
              {netWorth.unconvertedLiabilities.length} liability(ies) unconvertible — not included
            </Text>
          ) : null}
        </CardContent>
      </Card>

      {history && history.points.length > 1 ? (
        <Card>
          <CardHeader>
            <Text variant="heading">Net worth — last 12 months</Text>
          </CardHeader>
          <CardContent className="gap-2">
            <NavChart points={history.points} currency={history.baseCurrency} />
            <Text variant="muted" className="text-xs">
              Marks step through history; market holdings at today&apos;s prices; debts at current
              balance.
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {income && income.totalMinor !== 0 ? (
        <Card>
          <CardHeader>
            <Text variant="heading">Income — {income.year}</Text>
          </CardHeader>
          <CardContent className="gap-2">
            <Text variant="title" className="font-mono text-2xl text-gain">
              {signedMoney(income.totalMinor, income.baseCurrency)}
            </Text>
            {Object.entries(income.byType).map(([type, amount]) => (
              <View key={type} className="flex-row justify-between">
                <Text variant="muted" className="text-sm">
                  {type}
                </Text>
                <Text className="font-mono text-sm">{money(amount, income.baseCurrency)}</Text>
              </View>
            ))}
            {income.byAsset[0] ? (
              <Text variant="muted" className="text-xs">
                top earner: {income.byAsset[0].assetName} (
                {money(income.byAsset[0].amountMinor, income.baseCurrency)})
              </Text>
            ) : null}
            {income.unconverted.length > 0 ? (
              <Text variant="muted" className="text-xs">
                {income.unconverted.length} row(s) unconvertible — not included
              </Text>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <Text variant="heading">By class</Text>
        </CardHeader>
        <CardContent>
          <AllocationBars data={netWorth.byClass} currency={baseCurrency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">By location</Text>
        </CardHeader>
        <CardContent>
          <AllocationBars data={netWorth.byPlatform} currency={baseCurrency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">Movers — true profit</Text>
        </CardHeader>
        <CardContent className="gap-2">
          {[...top, ...bottom].map((a) => (
            <View key={a.id} className="flex-row items-center justify-between">
              <Text className="flex-1" numberOfLines={1}>
                {a.name}
              </Text>
              <Text
                className={`font-mono text-sm ${a.breakdown!.trueProfitMinor >= 0 ? 'text-gain' : 'text-loss'}`}>
                {signedMoney(a.breakdown!.trueProfitMinor, baseCurrency)}
              </Text>
            </View>
          ))}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
