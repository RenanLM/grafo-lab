import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { minTouchTarget, radius, spacing, useTheme } from '@/theme';

type Props = {
  href: Href;
  title: string;
  description: string;
};

/** Cartão inteiro tocável que leva a outra rota. */
export function ActionCard({ href, title, description }: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}. ${description}`}
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <View style={styles.texts}>
        <Text variant="label">{title}</Text>
        <Text color="textSecondary">{description}</Text>
      </View>
      <Text variant="heading" color="primary" accessibilityElementsHidden>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: minTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  texts: { flex: 1, gap: spacing.xs },
});
