import { Pressable, StyleSheet, Text as RNText } from 'react-native';

import { minTouchTarget, radius, spacing, typography, useTheme } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
};

/** Botão de ação principal: fundo `primary`, texto `onPrimary` (par com contraste testado) e alvo de toque de 48 dp. */
export function Button({ label, onPress, accessibilityHint }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
      <RNText style={[typography.label, { color: colors.onPrimary }]}>{label}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
});
