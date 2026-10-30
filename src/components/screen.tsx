import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { spacing, useTheme } from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/**
 * Contêiner padrão das abas. A barra de abas nativa cuida da borda inferior,
 * então a área segura só é aplicada em cima e nas laterais.
 */
export function Screen({ title, subtitle, children }: Props) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="title">{title}</Text>
          {subtitle ? (
            <Text color="textSecondary" style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  header: { gap: spacing.xs, paddingTop: spacing.sm },
  subtitle: { marginTop: spacing.xs },
});
