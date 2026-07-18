import * as React from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChipRow } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAiSettings, useSettingsData } from '@/hooks/data';

const BASE_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'JPY'] as const;

export default function SettingsScreen() {
  const s = useSettingsData();
  const ai = useAiSettings();
  const [rate, setRate] = React.useState('');
  const [defaults, setDefaults] = React.useState<Record<string, string>>({});
  const [keyInput, setKeyInput] = React.useState('');

  React.useEffect(() => setRate(s.hourlyRate), [s.hourlyRate]);
  React.useEffect(() => setDefaults(s.timeDefaults), [s.timeDefaults]);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4">
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
          <Text variant="heading">AI symbol lookup</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted" className="text-sm">
            When a security isn't in the offline index, the AI can propose a match — it only
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
