/** Dependency-free allocation bars — the "data-dense but calm, ASCII-ish"
 *  design language (spec §10) rendered with plain Views. */
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { money } from '@/lib/format';

export function AllocationBars({
  data,
  currency,
}: {
  data: Record<string, number>;
  currency: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
  return (
    <View className="gap-2">
      {entries.map(([label, value]) => (
        <View key={label} className="gap-1">
          <View className="flex-row justify-between">
            <Text className="text-sm">{label}</Text>
            <Text className="text-sm font-mono text-muted-foreground">
              {money(value, currency, { compact: true })}
            </Text>
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-secondary">
            <View
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(2, (Math.abs(value) / max) * 100)}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
