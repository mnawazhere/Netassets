import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

export default function CaptureScreen() {
  return (
    <View className="flex-1 bg-background gap-4 p-4">
      <Card>
        <CardHeader>
          <Text variant="heading">Capture</Text>
        </CardHeader>
        <CardContent className="gap-3">
          <Button label="Voice note" disabled />
          <Button label="Photo / screenshot" variant="secondary" disabled />
          <Button label="Upload PDF" variant="outline" disabled />
          <Text variant="muted">Ingestion + dedup review queue — Stage 5</Text>
        </CardContent>
      </Card>
    </View>
  );
}
