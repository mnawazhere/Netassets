import { Link } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { usePortfolio } from '@/hooks/data';
import { money, percent, perHour } from '@/lib/format';

export default function AssetsScreen() {
  const { view, loading } = usePortfolio();

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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4">
      {[...byClass.entries()].map(([cls, assets]) => (
        <Card key={cls}>
          <CardHeader>
            <Text variant="heading">{cls}</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {assets.map((a) => {
              const b = a.breakdown;
              const trueReturn =
                b && b.costBasisMinor > 0 ? b.trueProfitMinor / b.costBasisMinor : null;
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
                        {a.valuation?.stale ? ' *' : ''}
                      </Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text variant="muted">true return {percent(trueReturn)}</Text>
                      <Text
                        className={`text-sm ${
                          b?.returnPerHourMinor != null &&
                          b.returnPerHourMinor >= view.hourlyRateMinor
                            ? 'text-gain'
                            : 'text-muted-foreground'
                        }`}>
                        {b ? perHour(b.returnPerHourMinor, view.baseCurrency) : '—'}
                      </Text>
                    </View>
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
