import * as React from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/utils';

type ViewProps = React.ComponentProps<typeof View>;

function Card({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('rounded-xl border border-border bg-card p-4', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('mb-2', className)} {...props} />;
}

function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('', className)} {...props} />;
}

export { Card, CardContent, CardHeader };
