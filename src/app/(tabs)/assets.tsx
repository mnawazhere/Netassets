import { Link, useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { listRowMetrics } from '@/domain/display';
import { usePortfolio } from '@/hooks/data';
import { money, percent } from '@/lib/format';

export default function AssetsScreen() {
  const { view, loading, reload, refresh } = usePortfolio();
  const [refreshing, setRefreshing] = React.useState(false);

  // Tab screens stay mounted — reload on focus so captures/imports made on
  // other tabs show up here without restarting the app.
  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

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

  const byClass = new Map<string, typeof view.assets>();
  for (const a of view.assets) {
    if (!byClass.has(a.class)) byClass.set(a.class, []);
    byClass.get(a.class)!.push(a);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {[...byClass.entries()].map(([cls, assets]) => (
        <Card key={cls}>
          <CardHeader>
            <Text variant="heading">{cls}</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {assets.map((a) => {
              // §5 display rules: rows show the simple total MONEY return
              // only — labor never blends into a %, per-hour never renders here.
              const row = listRowMetrics(a.breakdown, a.valuation?.stale ?? false);
              const nwEntry = view.netWorth.perAsset.find((p) => p.id === a.id);
              return (
                <Link key={a.id} href={{ pathname: '/asset/[id]', params: { id: a.id } }} asChild>
                  <Pressable className="gap-1 border-b border-border pb-3 active:opacity-70">
                    <View className="flex-row items-center justify-between">
                      <Text className="flex-1 font-semibold" numberOfLines={1}>
                        {a.name}
                      </Text>
                      <Text className="font-mono text-sm">
                        {nwEntry
                          ? money(nwEntry.valueMinor, view.baseCurrency, { compact: true })
                          : '—'}
                        {row.stale ? ' *' : ''}
                      </Text>
                    </View>
                    <Text
                      className={`text-sm ${
                        row.moneyReturnFraction == null
                          ? 'text-muted-foreground'
                          : row.moneyReturnFraction >= 0
                            ? 'text-gain'
                            : 'text-loss'
                      }`}>
                      {row.moneyReturnFraction == null
                        ? 'return —'
                        : `${row.moneyReturnFraction >= 0 ? '+' : ''}${percent(row.moneyReturnFraction)}`}
                    </Text>
                  </Pressable>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ))}
      <Text variant="muted" className="text-center">
        * price served from cache
      </Text>
    </ScrollView>
  );
}
