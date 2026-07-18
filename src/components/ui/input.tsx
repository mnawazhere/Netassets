import * as React from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '@/lib/utils';

import { Text } from './text';

type InputProps = React.ComponentProps<typeof TextInput> & { label?: string };

function Input({ className, label, ...props }: InputProps) {
  return (
    <View className="gap-1">
      {label ? <Text variant="muted">{label}</Text> : null}
      <TextInput
        className={cn(
          'h-12 rounded-lg border border-input bg-card px-3 text-base text-foreground',
          className
        )}
        placeholderTextColor="#8A93A6"
        {...props}
      />
    </View>
  );
}

export { Input };
