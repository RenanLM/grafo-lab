import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { radius, spacing, useTheme } from '@/theme';

type Props = {
  label: string;
  /** Centraliza o selo dentro de um contêiner (por padrão fica à esquerda). */
  centered?: boolean;
};

/** Selo textual (o significado nunca depende apenas da cor). */
export function Badge({ label, centered = false }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.surfaceMuted },
        centered && styles.centered,
      ]}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  centered: { alignSelf: 'center' },
});
