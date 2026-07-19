/**
 * Salary runner (spec §14) — a PROJECTION surface, deliberately separate
 * from the measured dashboard. Every figure here is assumption-driven and
 * labeled as such; nothing writes back into actuals.
 */
import Slider from '@react-native-community/slider';
import { Stack, router } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { NavChart } from '@/components/navChart';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { computeCashflow } from '@/domain/cashflow';
import { toMinor } from '@/domain/money';
import { projectNav } from '@/domain/projection';
import {
  useIncome,
  usePortfolio,
  useProjectionAssumptions,
  useSettingsData,
  useSpend,
} from '@/hooks/data';
import { money, signedMoney } from '@/lib/format';

const BAND_SPREAD = 0.03;
const MAX_YEARS = 10;

export default function ProjectionScreen() {
  const { view } = usePortfolio();
  const { income } = useIncome();
  const settings = useSettingsData();
  const { spend } = useSpend();
  const { growth, saveGrowthPct } = useProjectionAssumptions();
  const [years, setYears] = React.useState(MAX_YEARS);
  const [growthEdits, setGrowthEdits] = React.useState<Record<string, string>>({});

  if (!view || !income) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text variant="mono" className="text-muted-foreground">
          ▚▞ loading…
        </Text>
      </View>
    );
  }

  const base = view.baseCurrency;
  // §14 surplus: salary + passive income − spending. Actual average spend
  // wins over the stated projection when months are recorded.
  const salaryMonthlyMinor =
    settings.salaryMonthly !== '' ? toMinor(settings.salaryMonthly, base) : 0;
  const projectedSpendMonthlyMinor =
    settings.expensesMonthly !== '' ? toMinor(settings.expensesMonthly, base) : 0;
  const usingActualSpend = (spend?.monthsRecorded ?? 0) > 0;
  const spendMonthlyMinor = usingActualSpend ? spend!.avgMonthMinor : projectedSpendMonthlyMinor;
  const cf = computeCashflow({
    salaryMonthlyMinor,
    expensesMonthlyMinor: spendMonthlyMinor,
    passiveIncomeMinor: income.totalMinor,
  });

  const points = projectNav({
    byClassMinor: view.netWorth.byClass,
    liabilitiesMinor: view.netWorth.liabilitiesTotalMinor,
    annualSurplusMinor: cf.netProfitMinor,
    growthByClass: growth,
    bandSpread: BAND_SPREAD,
    years: MAX_YEARS,
  });
  const selected = points[years];
  const thisYear = Number(new Date().getFullYear());
  const chartPoints = points
    .slice(0, years + 1)
    .map((p) => ({ date: `${thisYear + p.year}-12-31`, totalMinor: p.navMinor }));

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Salary runner',
          // Always give a way out — incl. cold starts where there is no
          // stack beneath to pop (deep link straight onto this screen).
          headerLeft: () => (
            <Pressable
              hitSlop={12}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
              <Text className="text-base">‹ Back</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-4"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled">
        <View className="rounded-lg border border-border bg-secondary px-3 py-2">
          <Text className="text-sm text-muted-foreground">
            PROJECTION — assumption-driven, never mixed into your measured net worth.
          </Text>
        </View>

        <Card>
          <CardHeader>
            <Text variant="muted">
              In {years} year{years === 1 ? '' : 's'} ({thisYear + years})
            </Text>
          </CardHeader>
          <CardContent className="gap-2">
            <Text variant="title" className="font-mono text-3xl">
              {money(selected.navMinor, base)}
            </Text>
            <Text variant="muted" className="font-mono text-sm">
              range {money(selected.lowMinor, base)} – {money(selected.highMinor, base)} (growth
              ∓{Math.round(BAND_SPREAD * 100)}pp)
            </Text>
            <Slider
              minimumValue={1}
              maximumValue={MAX_YEARS}
              step={1}
              value={years}
              onValueChange={setYears}
              style={{ height: 40 }}
            />
            <NavChart points={chartPoints} currency={base} showQuarters={false} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Text variant="heading">Annual surplus feeding the runner</Text>
          </CardHeader>
          <CardContent className="gap-2">
            <View className="flex-row justify-between">
              <Text variant="muted" className="text-sm">
                Salary (stated ×12)
              </Text>
              <Text className="font-mono text-sm">{money(cf.salaryAnnualMinor, base)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text variant="muted" className="text-sm">
                Passive income ({income.year}, measured)
              </Text>
              <Text className="font-mono text-sm">{money(income.totalMinor, base)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text variant="muted" className="text-sm">
                Spending ({usingActualSpend ? `actual, ${spend!.monthsRecorded} mo avg` : 'projected'} ×12)
              </Text>
              <Text className="font-mono text-sm">−{money(cf.expensesAnnualMinor, base)}</Text>
            </View>
            <View className="flex-row justify-between border-t border-border pt-2">
              <Text className="text-sm font-semibold">Net surplus / yr</Text>
              <Text
                className={`font-mono text-sm ${cf.netProfitMinor >= 0 ? 'text-gain' : 'text-loss'}`}>
                {signedMoney(cf.netProfitMinor, base)}
              </Text>
            </View>
            <Text variant="muted" className="text-xs">
              Surplus lands yearly, split across classes by today&apos;s weights. Debts held at
              current balance. Set salary &amp; spending in Settings.
            </Text>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Text variant="heading">Growth assumptions (%/yr)</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {Object.entries(growth).map(([cls, g]) => (
              <View key={cls} className="flex-row items-end gap-3">
                <View className="flex-1">
                  <Input
                    label={cls}
                    value={growthEdits[cls] ?? String(Math.round(g * 1000) / 10)}
                    onChangeText={(v) => setGrowthEdits((e) => ({ ...e, [cls]: v }))}
                    keyboardType="decimal-pad"
                    onBlur={() => {
                      const v = growthEdits[cls];
                      if (v !== undefined && v.trim() !== '') void saveGrowthPct(cls, v.trim());
                    }}
                  />
                </View>
              </View>
            ))}
            <Text variant="muted" className="text-xs">
              Blunt single rates — collectibles and property are illiquid and assumption-heavy;
              the ∓ band exists because these WILL be wrong.
            </Text>
          </CardContent>
        </Card>
      </ScrollView>
    </>
  );
}
