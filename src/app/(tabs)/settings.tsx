import * as React from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChipRow } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAiSettings, useLiabilities, useSettingsData } from '@/hooks/data';
import { fromMinor } from '@/domain/money';

const BASE_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'JPY'] as const;

export default function SettingsScreen() {
  const s = useSettingsData();
  const ai = useAiSettings();
  const liab = useLiabilities();
  const [rate, setRate] = React.useState('');
  const [defaults, setDefaults] = React.useState<Record<string, string>>({});
  const [keyInput, setKeyInput] = React.useState('');
  const [debtEdits, setDebtEdits] = React.useState<Record<string, string>>({});
  const [newDebtName, setNewDebtName] = React.useState('');
  const [newDebtAmount, setNewDebtAmount] = React.useState('');

  // Resync local edit state during render only when the stored value actually
  // changed (compared by content) — a content-identical reload must not clobber
  // in-progress edits.
  const [prevRate, setPrevRate] = React.useState(s.hourlyRate);
  if (prevRate !== s.hourlyRate) {
    setPrevRate(s.hourlyRate);
    setRate(s.hourlyRate);
  }
  const defaultsSnapshot = JSON.stringify(s.timeDefaults);
  const [prevDefaults, setPrevDefaults] = React.useState(defaultsSnapshot);
  if (prevDefaults !== defaultsSnapshot) {
    setPrevDefaults(defaultsSnapshot);
    setDefaults(s.timeDefaults);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled">
      <Card>
        <CardHeader>
          <Text variant="heading">Your hourly rate</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted" className="text-sm">
            What an hour of your time is worth — not necessarily what you earn. Changing it
            recomputes every return live.
          </Text>
          <View className="flex-row items-end gap-3">
            <View className="flex-1">
              <Input label="AED per hour" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
            </View>
            <Button
              label="Save"
              onPress={async () => {
                try {
                  await s.saveHourlyRate(rate.trim());
                  Alert.alert('Saved', 'Hourly rate updated — returns recompute from it.');
                } catch (e) {
                  Alert.alert('Not saved', String(e instanceof Error ? e.message : e));
                }
              }}
            />
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">Base currency</Text>
        </CardHeader>
        <CardContent className="gap-2">
          <ChipRow
            options={BASE_CURRENCIES}
            value={(s.baseCurrency as (typeof BASE_CURRENCIES)[number]) ?? 'AED'}
            onChange={(c) => void s.saveBaseCurrency(c)}
          />
          <Text variant="muted" className="text-xs">
            Everything is stored in its native currency; only display converts.
          </Text>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">Time defaults (hrs per transaction)</Text>
        </CardHeader>
        <CardContent className="gap-3">
          {Object.entries(defaults).map(([cls, value]) => (
            <View key={cls} className="flex-row items-end gap-3">
              <View className="flex-1">
                <Input
                  label={cls}
                  value={value}
                  onChangeText={(v) => setDefaults((d) => ({ ...d, [cls]: v }))}
                  keyboardType="decimal-pad"
                />
              </View>
              <Button label="Save" size="sm" variant="secondary" onPress={() => void s.saveTimeDefault(cls, defaults[cls])} />
            </View>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">Liabilities</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted" className="text-sm">
            Outstanding debts subtract from net worth. A debt linked to an asset also turns that
            asset&apos;s screen into an equity view (value − owed).
          </Text>
          {liab.liabilities.map((l) => (
            <View key={l.id} className="gap-1">
              <View className="flex-row items-end gap-3">
                <View className="flex-1">
                  <Input
                    label={`${l.name} (${l.currency}, as of ${l.asOf})`}
                    value={debtEdits[l.id] ?? fromMinor(l.outstandingMinor, l.currency)}
                    onChangeText={(v) => setDebtEdits((d) => ({ ...d, [l.id]: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Button
                  label="Save"
                  size="sm"
                  variant="secondary"
                  onPress={async () => {
                    try {
                      await liab.saveOutstanding(l.id, (debtEdits[l.id] ?? fromMinor(l.outstandingMinor, l.currency)).trim(), l.currency);
                      setDebtEdits((d) => {
                        const { [l.id]: _drop, ...rest } = d;
                        return rest;
                      });
                    } catch (e) {
                      Alert.alert('Not saved', String(e instanceof Error ? e.message : e));
                    }
                  }}
                />
                <Button
                  label="✕"
                  size="sm"
                  variant="secondary"
                  onPress={() =>
                    Alert.alert('Remove liability?', l.name, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => void liab.removeLiability(l.id) },
                    ])
                  }
                />
              </View>
              {l.note ? (
                <Text variant="muted" className="text-xs">
                  {l.note}
                </Text>
              ) : null}
            </View>
          ))}
          <View className="flex-row items-end gap-3">
            <View className="flex-1">
              <Input label="New debt name" value={newDebtName} onChangeText={setNewDebtName} />
            </View>
            <View className="w-28">
              <Input
                label={`Owed (${s.baseCurrency})`}
                value={newDebtAmount}
                onChangeText={setNewDebtAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <Button
              label="Add"
              size="sm"
              onPress={async () => {
                if (!newDebtName.trim() || !newDebtAmount.trim()) return;
                try {
                  await liab.addLiability(newDebtName.trim(), 'OTHER', newDebtAmount.trim(), s.baseCurrency, null);
                  setNewDebtName('');
                  setNewDebtAmount('');
                } catch (e) {
                  Alert.alert('Not added', String(e instanceof Error ? e.message : e));
                }
              }}
            />
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text variant="heading">AI symbol lookup</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted" className="text-sm">
            When a security isn&apos;t in the offline index, the AI can propose a match — it only
            fires on a miss, and nothing binds without a live price check AND your confirmation.
          </Text>
          <ChipRow
            options={['Off', 'On'] as const}
            value={ai.enabled ? 'On' : 'Off'}
            onChange={(v) => void ai.setAiEnabled(v === 'On')}
          />
          <View className="flex-row items-end gap-3">
            <View className="flex-1">
              <Input
                label={ai.hasKey ? 'Anthropic API key (stored — enter to replace, blank to remove)' : 'Anthropic API key'}
                value={keyInput}
                onChangeText={setKeyInput}
                autoCapitalize="none"
                secureTextEntry
              />
            </View>
            <Button
              label="Save"
              size="sm"
              variant="secondary"
              onPress={async () => {
                await ai.saveKey(keyInput);
                setKeyInput('');
                Alert.alert('Saved', 'Key stored in the iOS Keychain — never in the database or audit log.');
              }}
            />
          </View>
        </CardContent>
      </Card>

      {s.audit.length > 0 ? (
        <Card>
          <CardHeader>
            <Text variant="heading">Hourly-rate audit trail</Text>
          </CardHeader>
          <CardContent className="gap-2">
            {s.audit.map((c, i) => (
              <View key={i} className="flex-row justify-between">
                <Text variant="muted" className="text-xs">
                  {c.timestamp.slice(0, 16).replace('T', ' ')} · {c.source}
                </Text>
                <Text className="font-mono text-xs">
                  {c.oldValue ? `${Number(c.oldValue) / 100} → ` : ''}
                  {c.newValue ? Number(c.newValue) / 100 : '—'}
                </Text>
              </View>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}
