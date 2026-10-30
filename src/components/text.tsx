import { Text as RNText, type TextProps } from 'react-native';

import { typography, useTheme, type ColorToken } from '@/theme';

type Props = TextProps & {
  variant?: keyof typeof typography;
  color?: Extract<ColorToken, 'text' | 'textSecondary' | 'primary'>;
};

export function Text({ variant = 'body', color = 'text', style, ...rest }: Props) {
  const { colors } = useTheme();
  const isHeading = variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : undefined}
      {...rest}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}
