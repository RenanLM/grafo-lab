import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { GraphGlyph } from '@/components/graph-glyph';
import { Text } from '@/components/text';
import { spacing } from '@/theme';

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function EmptyState({ title, description, children }: Props) {
  return (
    <View style={styles.root}>
      <GraphGlyph size={112} />
      <Text variant="heading" style={styles.centered}>
        {title}
      </Text>
      <Text color="textSecondary" style={styles.centered}>
        {description}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  centered: { textAlign: 'center' },
});
