import { View } from 'react-native';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

export default function AssetsScreen() {
  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <Text variant="heading">Assets</Text>
        </CardHeader>
        <CardContent>
          <Text variant="muted">
            Grouped by class and by location; value + true return + return/hour per row — Stage 6
          </Text>
        </CardContent>
      </Card>
    </View>
  );
}
