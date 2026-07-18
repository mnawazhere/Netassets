import { View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

export default function DashboardScreen() {
  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <Text variant="muted">Total net worth</Text>
        </CardHeader>
        <CardContent>
          <Text variant="title" className="font-mono">
            AED —
          </Text>
          <Text variant="muted" className="mt-1">
            Allocation by class · by platform · top movers — Stage 6
          </Text>
        </CardContent>
      </Card>
    </View>
  );
}
