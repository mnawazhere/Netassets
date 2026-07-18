import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/utils';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: 'text-base',
      title: 'text-2xl font-bold tracking-tight',
      heading: 'text-lg font-semibold',
      muted: 'text-sm text-muted-foreground',
      mono: 'text-base font-mono',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>;

function Text({ className, variant, ...props }: TextProps) {
  return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}

export { Text, textVariants };
export type { TextProps };
