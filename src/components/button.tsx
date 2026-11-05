import { Pressable, StyleSheet, Text as RNText } from 'react-native';

import { minTouchTarget, radius, spacing, typography, useTheme } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  /** Rótulo para leitores de tela quando o texto visível é curto demais ("Editar" → "Editar propriedades do vértice A"). Padrão: o próprio `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** `primary` (padrão): fundo `primary`. `secondary`: fundo da superfície, contorno e texto `primary`. */
  variant?: 'primary' | 'secondary';
};

/** Botão de ação: `primary` (texto `onPrimary` sobre `primary`) ou `secondary` (texto `primary` sobre `surface`), ambos com contraste testado e alvo de 48 dp. */
export function Button({ label, onPress, accessibilityLabel, accessibilityHint, variant = 'primary' }: Props) {
  const { colors } = useTheme();
  const secondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1.5 }
          : { backgroundColor: colors.primary },
        { opacity: pressed ? 0.8 : 1 },
      ]}>
      <RNText style={[typography.label, { color: secondary ? colors.primary : colors.onPrimary }]}>{label}</RNText>
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
