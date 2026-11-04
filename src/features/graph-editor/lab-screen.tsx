import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { createGraph, type Graph } from '@/domain/graph';
import { radius, spacing, useTheme } from '@/theme';

import { canvasSize } from './canvas-size';
import { CanvasTapDetector } from './canvas-tap-detector';
import {
  NEUTRAL_CAMERA,
  buildGraphScene,
  circularLayout,
  fitCameraToGraph,
  graphErrorMessage,
  tapToEditorAction,
  type Camera,
  type CreateEditorStateOptions,
  type GraphLayout,
  type Point,
} from './core';
import { HistoryBar, ModeBar } from './editor-controls';
import { selectGraph, selectLayout, selectMode } from './editor-store';
import { EditorStoreProvider, useEditorStore, useEditorStoreApi } from './editor-store-provider';
import { buildExampleGraph } from './example-graph';
import { buildNewGraph } from './new-graph';
import { SvgGraphRenderer } from './svg-graph-renderer';

// Tela do Laboratório (Fase 3, incremento 3.6). O aluno começa um grafo vazio (orientado ou não) ou carrega o exemplo, escolhe o
// modo e, em Adicionar vértice, toca no quadro para criar vértices; desfaz e refaz pelos botões. Conectar, selecionar e arrastar
// ainda não existem. A store vive no escopo desta tela (provider abaixo): se a aba for desmontada, a sessão acaba, pois nada é
// persistido. Começar outro grafo SUBSTITUI o atual na hora (sem confirmação), e desfazer não o traz de volta (o histórico é zerado).
//
// CÂMERA. Ela NÃO está na store e NÃO é recalculada a cada edição: o modo da câmera é decidido só ao começar uma sessão.
// - grafo novo: câmera NEUTRA (a origem do mundo no canto do quadro; cada toque cria o vértice no mesmo ponto em dp);
// - exemplo: câmera ENQUADRADA uma vez, a partir do grafo carregado (`fitCameraToGraph` sobre uma cópia do que foi carregado);
// - adicionar vértice, desfazer, refazer e trocar de modo NÃO mudam a câmera (ela não depende do grafo atual);
// - redimensionar ou girar: com a câmera neutra nada muda; com a enquadrada, o enquadramento é refeito a partir do grafo
//   CARREGADO (não do editado) quando o canvas é medido de novo. Os vértices criados depois seguem a câmera.

const EMPTY_SESSION: CreateEditorStateOptions = { graph: createGraph({ id: 'laboratorio' }), mode: 'select' };

export function LabScreen() {
  return (
    <EditorStoreProvider initial={EMPTY_SESSION}>
      <LabContent />
    </EditorStoreProvider>
  );
}

const PLANNED = [
  'Conectar vértices com arestas, tocando na tela.',
  'Ver o mesmo grafo como lista de adjacência e como matrizes.',
  'Executar BFS e DFS passo a passo, com explicação de cada passo.',
  'Comparar a complexidade de tempo e de espaço dos algoritmos.',
] as const;

/** Como a câmera da sessão é obtida (decidido ao começar o grafo; as edições não a mudam). */
type CameraView =
  | { readonly kind: 'neutral' }
  | { readonly kind: 'fit'; readonly graph: Graph; readonly layout: GraphLayout };

const NEUTRAL_VIEW: CameraView = { kind: 'neutral' };

/** O conteúdo da tela, dentro do provider (exportado para os testes montarem a tela em torno de uma store conhecida). */
export function LabContent() {
  const { colors } = useTheme();
  const graph = useEditorStore(selectGraph);
  const layout = useEditorStore(selectLayout);
  const mode = useEditorStore(selectMode);
  const reset = useEditorStore((state) => state.reset);
  const store = useEditorStoreApi();
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<CameraView>(NEUTRAL_VIEW);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const serial = useRef(0);

  const size = canvasSize(measuredWidth);
  const width = size?.width;
  const height = size?.height;
  const camera: Camera | undefined = useMemo(() => {
    if (view.kind === 'neutral') return NEUTRAL_CAMERA;
    if (width === undefined || height === undefined) return undefined;
    return fitCameraToGraph(view.graph, view.layout, { width, height });
  }, [view, width, height]);
  const scene = useMemo(() => {
    if (camera === undefined || width === undefined || height === undefined) return undefined;
    return buildGraphScene(graph, layout, camera, { viewport: { width, height } });
  }, [graph, layout, camera, width, height]);

  const onCanvasLayout = (event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  };

  // Um toque no canvas: `point` está em dp, relativo ao canto do canvas (o detector envolve o próprio canvas). O núcleo puro decide
  // se vira ação (só no modo Adicionar vértice, em área vazia, dentro do canvas); a store aplica. O estado do editor é lido NA HORA
  // do toque, não de uma cópia de renderização, e nada é feito se o canvas ainda não foi medido.
  const onCanvasTap = (point: Point): void => {
    if (camera === undefined || width === undefined || height === undefined) return;
    const { editor, dispatch } = store.getState();
    const action = tapToEditorAction(editor, camera, point, { width, height });
    if (action !== undefined) dispatch(action);
  };

  const startNewGraph = (directed: boolean): void => {
    serial.current += 1;
    setLoadError(undefined);
    setStarted(true);
    setView(NEUTRAL_VIEW);
    reset({ graph: buildNewGraph(directed, serial.current), mode: 'add-vertex' });
  };

  const loadExample = (): void => {
    const example = buildExampleGraph();
    if (!example.ok) {
      setLoadError(graphErrorMessage(example.error));
      return;
    }
    const exampleLayout = circularLayout(example.value);
    setLoadError(undefined);
    setStarted(true);
    setView({ kind: 'fit', graph: example.value, layout: exampleLayout });
    reset({ graph: example.value, layout: exampleLayout, mode: 'select' });
  };

  const isEmpty = graph.vertices.length === 0;
  return (
    <Screen title="Laboratório" subtitle="Comece um grafo e adicione vértices tocando no quadro. Conectar chega em breve.">
      {started ? (
        <>
          <ModeBar />
          <View style={styles.block}>
            <CanvasTapDetector onTap={onCanvasTap}>
              <View testID="canvas-area" onLayout={onCanvasLayout} style={styles.canvasArea}>
                {scene !== undefined && width !== undefined && height !== undefined ? (
                  <SvgGraphRenderer scene={scene} width={width} height={height} />
                ) : (
                  <View style={styles.pending} />
                )}
                {isEmpty ? (
                  // A instrução do quadro vazio fica DENTRO do quadro (como o texto de um campo vazio), sobreposta e com
                  // `pointerEvents: 'none'`: o toque a atravessa e chega ao detector. Fora do fluxo, ela não muda a posição do
                  // quadro quando some com o primeiro vértice (antes, o quadro subia e o vértice ficava longe do dedo).
                  <View testID="canvas-hint" style={[StyleSheet.absoluteFill, styles.hint]}>
                    <Text color="textSecondary" style={styles.hintText}>
                      {mode === 'add-vertex'
                        ? 'Toque no espaço para adicionar o primeiro vértice.'
                        : 'Selecione Adicionar vértice e toque no espaço para começar.'}
                    </Text>
                  </View>
                ) : null}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[StyleSheet.absoluteFill, styles.border, { borderColor: colors.border }]}
                />
              </View>
            </CanvasTapDetector>
            <View style={styles.badges}>
              <Badge label={graph.name === '' ? 'Grafo sem nome' : graph.name} />
            </View>
            {scene === undefined ? null : (
              <Text color="textSecondary" accessibilityElementsHidden importantForAccessibility="no">
                {scene.summary}
              </Text>
            )}
          </View>
          <HistoryBar />
        </>
      ) : (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <EmptyState
            title="Nenhum grafo carregado"
            description="Comece um grafo vazio e adicione vértices tocando no quadro, ou carregue o exemplo. Conectar vértices ainda não está disponível." />
        </View>
      )}
      <View style={styles.starts}>
        <Button
          label="Novo grafo não orientado"
          accessibilityHint="Começa um grafo vazio, sem direção nas arestas, e ativa Adicionar vértice"
          onPress={() => {
            startNewGraph(false);
          }}
        />
        <Button
          label="Novo grafo orientado"
          accessibilityHint="Começa um grafo vazio, com direção nas arestas, e ativa Adicionar vértice"
          onPress={() => {
            startNewGraph(true);
          }}
        />
        <Button
          variant="secondary"
          label="Carregar exemplo"
          accessibilityHint="Mostra um grafo orientado de quatro vértices no quadro"
          onPress={loadExample}
        />
      </View>
      {loadError === undefined ? null : (
        <Text accessibilityRole="alert" color="textSecondary">
          {`Não foi possível montar o exemplo. ${loadError}`}
        </Text>
      )}
      <Card>
        <Text variant="label">O que ainda vem aqui</Text>
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
  hint: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, pointerEvents: 'none' },
  hintText: { textAlign: 'center' },
  border: { borderWidth: 1, borderRadius: radius.lg, pointerEvents: 'none' },
  badges: { flexDirection: 'row', gap: spacing.sm },
  starts: { gap: spacing.sm },
  empty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowText: { flex: 1 },
});
