import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { radius, spacing, useTheme } from '@/theme';

const PLANNED = [
  'Adicionar vértices e conectá-los com arestas, tocando na tela.',
  'Ver o mesmo grafo como lista de adjacência e como matrizes.',
  'Executar BFS e DFS passo a passo, com explicação de cada passo.',
  'Comparar a complexidade de tempo e de espaço dos algoritmos.',
] as const;

export function LabScreen() {
  const { colors } = useTheme();
  return (
    <Screen title="Laboratório" subtitle="Construa grafos e veja a matemática por trás deles.">
      <View style={[styles.canvas, { borderColor: colors.border }]}>
        <EmptyState
          title="Seu laboratório está vazio"
          description="Quando o editor estiver pronto, este espaço será o seu quadro: cada toque vai criar um vértice ou uma aresta, e o grafo vai aparecer aqui.">
          <Badge label="Editor em breve" centered />
        </EmptyState>
      </View>
      <Card>
        <Text variant="label">O que você vai poder fazer aqui</Text>
        {PLANNED.map((item) => (
          <View key={item} style={styles.row}>
            <Text color="primary" accessibilityElementsHidden>
              •
            </Text>
            <Text color="textSecondary" style={styles.rowText}>
              {item}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowText: { flex: 1 },
});
