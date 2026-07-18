import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { DatabaseProvider } from '@/db/provider';

const NAVY = '#0B1D3A';
const NAVY_DARK_BG = '#070F1F';

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';

  return (
    <DatabaseProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: dark ? NAVY_DARK_BG : '#ffffff' },
          headerTintColor: dark ? '#F2F6FC' : NAVY,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: dark ? NAVY_DARK_BG : '#ffffff' },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="asset/[id]" options={{ title: 'Asset' }} />
      </Stack>
    </DatabaseProvider>
  );
}
