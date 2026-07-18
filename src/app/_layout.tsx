import '@/global.css';

import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, useColorScheme, type ColorValue } from 'react-native';

import { DatabaseProvider } from '@/db/provider';

const NAVY = '#0B1D3A';
const NAVY_DARK_BG = '#070F1F';
const BLUE_LIGHT = '#6EA8F7';

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return (
    <DatabaseProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: dark ? NAVY_DARK_BG : '#ffffff' },
          headerTintColor: dark ? '#F2F6FC' : NAVY,
          headerTitleStyle: { fontWeight: '700' },
          tabBarStyle: { backgroundColor: dark ? NAVY_DARK_BG : '#ffffff' },
          tabBarActiveTintColor: dark ? BLUE_LIGHT : NAVY,
          tabBarInactiveTintColor: dark ? '#8A93A6' : '#9AA5B8',
          sceneStyle: { backgroundColor: dark ? NAVY_DARK_BG : '#ffffff' },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color }) => <TabGlyph glyph="◈" color={color} />,
          }}
        />
        <Tabs.Screen
          name="assets"
          options={{
            title: 'Assets',
            tabBarIcon: ({ color }) => <TabGlyph glyph="▤" color={color} />,
          }}
        />
        <Tabs.Screen
          name="capture"
          options={{
            title: 'Capture',
            tabBarIcon: ({ color }) => <TabGlyph glyph="✚" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color }) => <TabGlyph glyph="⚙" color={color} />,
          }}
        />
      </Tabs>
    </DatabaseProvider>
  );
}
