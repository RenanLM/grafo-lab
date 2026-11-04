import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { createGraph } from '@/domain/graph';
import { radius, spacing, useTheme } from '@/theme';

import { canvasSize } from './canvas-size';
import {
  buildGraphScene,
  circularLayout,
  fitCameraToGraph,
  graphErrorMessage,
  type CreateEditorStateOptions,
} from './core';
import { selectGraph, selectLayout } from './editor-store';
import { EditorStoreProvider, useEditorStore } from './editor-store-provider';
import { buildExampleGraph } from './example-graph';
import { SvgGraphRenderer } from './svg-graph-renderer';

// Tela do Laboratório (Fase 3, incremento 3.5): SOMENTE LEITURA. Carrega um grafo de exemplo na store da sessão e o desenha;
// ainda não há edição pelo toque, gestos, seleção nem arrasto. A store vive no escopo desta tela (provider abaixo): se a aba for
// desmontada, a sessão acaba, pois nada é persistido nesta etapa.
//
// A câmera é DERIVADA, não guardada: sai do grafo, do layout e do tamanho medido do canvas (`fitCameraToGraph`), numa memoização.
// O canvas só é medido por `onLayout` (largura arredondada, altura em função dela), então re-medir a mesma largura não renderiza de
// novo e não há laço entre tamanho e câmera. Enquanto a área não foi medida, não há câmera nem cena.

const EMPTY_SESSION: CreateEditorStateOptions = { graph: createGraph({ id: 'laboratorio' }), mode: 'select' };

export function LabScreen() {
  return (
    <EditorStoreProvider initial={EMPTY_SESSION}>
      <LabContent />
    </EditorStoreProvider>
  );
}

const PLANNED = [
  'Adicionar vértices e conectá-los com arestas, tocando na tela.',
  'Ver o mesmo grafo como lista de adjacência e como matrizes.',
  'Executar BFS e DFS passo a passo, com explicação de cada passo.',
  'Comparar a complexidade de tempo e de espaço dos algoritmos.',
] as const;

/** O conteúdo da tela, dentro do provider (exportado para os testes montarem a tela em torno de uma store conhecida). */
export function LabContent() {
  const { colors } = useTheme();
  const graph = useEditorStore(selectGraph);
  const layout = useEditorStore(selectLayout);
  const reset = useEditorStore((state) => state.reset);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  const size = canvasSize(measuredWidth);
  const width = size?.width;
  const height = size?.height;
  const scene = useMemo(() => {
    if (width === undefined || height === undefined) return undefined;
    const viewport = { width, height };
    const camera = fitCameraToGraph(graph, layout, viewport);
    return camera === undefined ? undefined : buildGraphScene(graph, layout, camera, { viewport });
  }, [graph, layout, width, height]);

  const onCanvasLayout = (event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  };

  const loadExample = (): void => {
    const example = buildExampleGraph();
    if (!example.ok) {
      setLoadError(graphErrorMessage(example.error));
      return;
    }
    setLoadError(undefined);
    reset({ graph: example.value, layout: circularLayout(example.value), mode: 'select' });
  };

  const hasGraph = graph.vertices.length > 0;
  return (
    <Screen title="Laboratório" subtitle="Veja um grafo desenhado. A edição pelo toque ainda não está disponível.">
      {hasGraph ? (
        <View style={styles.block}>
          <View testID="canvas-area" onLayout={onCanvasLayout} style={styles.canvasArea}>
            {scene !== undefined && width !== undefined && height !== undefined ? (
              <SvgGraphRenderer scene={scene} width={width} height={height} />
            ) : (
              <View style={styles.pending} />
            )}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[StyleSheet.absoluteFill, styles.border, { borderColor: colors.border }]}
            />
          </View>
          <View style={styles.badges}>
            <Badge label={graph.name === '' ? 'Grafo sem nome' : graph.name} />
            <Badge label="Somente leitura" />
          </View>
          {scene === undefined ? null : (
            <Text color="textSecondary" accessibilityElementsHidden importantForAccessibility="no">
              {scene.summary}
            </Text>
          )}
        </View>
      ) : (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <EmptyState
            title="Nenhum grafo carregado"
            description="Toque em Carregar exemplo para ver um grafo desenhado aqui. Criar vértices e arestas pelo toque ainda não está disponível.">
            <Badge label="Somente leitura" centered />
          </EmptyState>
        </View>
      )}
      <Button
        label="Carregar exemplo"
        accessibilityHint="Mostra um grafo orientado de quatro vértices no quadro"
        onPress={loadExample}
      />
      {loadError === undefined ? null : (
        <Text accessibilityRole="alert" color="textSecondary">
          {`Não foi possível montar o exemplo. ${loadError}`}
        </Text>
      )}
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
  block: { gap: spacing.md },
  canvasArea: { borderRadius: radius.lg, overflow: 'hidden' },
  pending: { height: 240 },
  border: { borderWidth: 1, borderRadius: radius.lg, pointerEvents: 'none' },
  badges: { flexDirection: 'row', gap: spacing.sm },
  empty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowText: { flex: 1 },
});
