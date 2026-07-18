/** Runs migrations + first-launch seed before rendering the app (native). */
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import * as React from 'react';
import { Text, View } from 'react-native';

import { seedIfEmpty } from '@/services/seed';

import { db } from './client';
import migrations from './migrations/migrations';

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [seeded, setSeeded] = React.useState(false);
  const [seedError, setSeedError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!success) return;
    seedIfEmpty(db)
      .then(() => setSeeded(true))
      .catch((e: Error) => setSeedError(e));
  }, [success]);

  const failure = error ?? seedError;
  if (failure) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-destructive">
          Database error: {failure.message}
        </Text>
      </View>
    );
  }

  if (!success || !seeded) return null;
  return <>{children}</>;
}
