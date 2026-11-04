import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { minTouchTarget, radius, spacing, typography, useTheme } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  /** Controle ativo (um modo escolhido). Aparece com fundo `primary`, a marca "✓" e o estado acessível `selected`. */
  selected?: boolean;
  /** Controle que ainda não age. Aparece com contorno tracejado, nunca se confunde com um controle ativo e não responde ao toque. */
  disabled?: boolean;
  /** Texto curto sob o rótulo (por exemplo, "em breve"). */
  caption?: string;
  accessibilityHint?: string;
  /** `radio` para um modo dentro de um grupo; `button` (padrão) para uma ação. */
  accessibilityRole?: 'button' | 'radio';
  testID?: string;
};

/**
 * Botão de ferramenta da barra do editor. O estado NÃO depende só de cor: o ativo ganha a marca "✓" e o estado acessível
 * `selected`; o desabilitado ganha contorno tracejado e `disabled`. O rótulo acessível é o próprio rótulo (a marca fica escondida
 * dos leitores de tela). Alvo de toque de pelo menos 48 dp; o texto quebra em duas linhas em telas estreitas.
 */
export function ToolButton({
  label,
  onPress,
  selected = false,
  disabled = false,
  caption,
  accessibilityHint,
  accessibilityRole = 'button',
  testID,
}: Props) {
  const { colors } = useTheme();
  const foreground = selected ? colors.onPrimary : disabled ? colors.textSecondary : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          borderStyle: disabled ? 'dashed' : 'solid',
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <View style={styles.row}>
        {selected ? (
          <RNText accessibilityElementsHidden importantForAccessibility="no" style={[typography.label, { color: foreground }]}>
            ✓
          </RNText>
        ) : null}
        <RNText style={[typography.label, styles.label, { color: foreground }]}>{label}</RNText>
      </View>
      {caption === undefined ? null : <RNText style={[typography.caption, { color: foreground }]}>{caption}</RNText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  // `flexShrink: 1`: sem ele o rótulo não quebra dentro da linha e empurra a marca "✓" para fora do botão (visto no Android).
  label: { textAlign: 'center', flexShrink: 1 },
});
