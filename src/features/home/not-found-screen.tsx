import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { minTouchTarget } from '@/theme';

export function NotFoundScreen() {
  return (
    <Screen title="Página não encontrada">
      <EmptyState
        title="Este caminho não leva a lugar nenhum"
        description="O endereço que você abriu não existe no GrafoLab.">
        <Link href="/" accessibilityRole="link" style={styles.link}>
          <Text variant="label" color="primary">
            Voltar ao início
          </Text>
        </Link>
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: minTouchTarget, paddingVertical: 12 },
});
