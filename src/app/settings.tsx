import { View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <Text variant="heading">Settings</Text>
        </CardHeader>
        <CardContent>
          <Text variant="muted">
            Hourly rate · base currency (AED) · per-class time defaults — Stage 6
          </Text>
        </CardContent>
      </Card>
    </View>
  );
}
