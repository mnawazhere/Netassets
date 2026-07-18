import * as React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { AllocationBars } from '@/components/allocation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { usePortfolio } from '@/hooks/data';
import { money, signedMoney } from '@/lib/format';

export default function DashboardScreen() {
  const { view, loading, refresh } = usePortfolio();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

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
            ⚠ Prices couldn't refresh — showing last known
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
          {netWorth.unvalued.length > 0 ? (
            <Text variant="muted" className="mt-1">
              {netWorth.unvalued.length} asset(s) unvalued — not included
            </Text>
          ) : null}
        </CardContent>
      </Card>

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
