import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { createGraph, type Graph } from '@/domain/graph';
import { radius, spacing, useTheme } from '@/theme';

import { useSettledCamera } from './camera-hooks';
import { createCameraStore } from './camera-store';
import { CanvasGestureDetector } from './canvas-gesture-detector';
import { canvasSize } from './canvas-size';
import {
  NEUTRAL_CAMERA,
  buildGraphScene,
  cameraForResize,
  centerCamera,
  circularLayout,
  fitCameraToGraph,
  fitGraphCamera,
  graphErrorMessage,
  tapToEditorAction,
  tapToSelectionAction,
  type Camera,
  type CreateEditorStateOptions,
  type GraphLayout,
  type Point,
  type Viewport,
} from './core';
import { CameraControls, ConnectStatus, HistoryBar, ModeBar, SelectionStatus } from './editor-controls';
import { selectConnectSource, selectGraph, selectLayout, selectMode, selectSelection } from './editor-store';
import { EditorStoreProvider, useEditorStore, useEditorStoreApi } from './editor-store-provider';
import { buildExampleGraph } from './example-graph';
import { buildNewGraph } from './new-graph';
import { PropertiesSheet, type SheetRequest } from './properties-sheet';
import { useCanvasGestures } from './canvas-gestures';
import { LiveGraphRenderer } from './vertex-drag';

// Tela do Laboratório (Fase 3, incrementos 3.6 a 3.9). O aluno começa um grafo vazio (orientado ou não) ou carrega o exemplo, escolhe o
// modo e toca no quadro: em Adicionar vértice cria vértices; em Conectar toca em um vértice (a ORIGEM, que ganha destaque) e em outro
// (o DESTINO), e a aresta é criada; em Selecionar toca em um vértice ou aresta (que ganha destaque) e, pelos botões Editar e Excluir, abre a
// folha de propriedades (rótulo, peso) ou a confirmação de exclusão, ou ARRASTA um vértice (as arestas dele acompanham o dedo e, ao soltar, a nova posição
// vira um passo de histórico); desfaz e refaz pelos botões. A store vive no escopo desta
// tela (provider abaixo): se a aba for desmontada, a sessão acaba, pois nada é persistido. Começar outro grafo SUBSTITUI o atual na hora
// (sem confirmação), e desfazer não o traz de volta (o histórico é zerado).
//
// O MESMO detector entrega o toque, e o MODO decide o caminho, um só por toque: `connect` → `store.connectTap` (máquina de estados do
// núcleo, origem pendente na store); `select` → `tapToSelectionAction` (selecionar ou limpar); `add-vertex` → `tapToEditorAction` (criar vértice).
// Com a folha de propriedades aberta nenhum toque chega ao canvas (o `Modal` o cobre e `onCanvasTap` também confere).
//
// ARRASTO (3.9). O mesmo detector (`CanvasGestureDetector`) também entrega o arrasto, a um `VertexDragController` criado aqui. Ele só começa no modo
// Selecionar, com o dedo sobre um vértice e sem a folha aberta; durante o gesto a tela NÃO muda (o grafo, o layout e o histórico ficam parados) e o
// `LiveGraphRenderer`, que assina o controlador, desenha a prévia; ao soltar entra UM `move-vertex`. Começar outro grafo, carregar o exemplo e
// desmontar descartam o arrasto sem confirmar.
//
// CÂMERA (3.10). Ela é estado da SESSÃO VISUAL, com uma única fonte de verdade: o `CameraStore` criado aqui (`camera-store.ts`). NÃO está na store do editor, no grafo, no layout, no JSON nem no
// histórico: mover, ampliar, centralizar e ajustar nunca criam passo de desfazer. Quem desenha (`LiveGraphRenderer`), quem faz o hit-testing (toque e arrasto) e quem calcula os gestos leem DELE.
// A tela assina só a câmera ASSENTADA (muda ao começar uma sessão, num comando ou no fim de um gesto), então um pan ou uma pinça não re-renderiza a tela a cada quadro.
// - grafo novo: câmera NEUTRA (a origem do mundo no canto do quadro; cada toque cria o vértice no mesmo ponto em dp);
// - exemplo: câmera ENQUADRADA UMA vez (`fitCameraToGraph`); se o quadro ainda não foi medido, o enquadramento espera a primeira medida;
// - adicionar vértice, conectar, selecionar, editar, excluir, desfazer, refazer e trocar de modo NÃO mudam a câmera; arrastar um vértice a mantém fixa;
// - pan e pinça mudam só a câmera; Centralizar e Ajustar ao grafo a mudam por comando explícito (nunca automaticamente depois de uma edição);
// - redimensionar ou girar: o ponto do mundo que estava sob o centro do quadro antigo fica sob o centro do novo (`cameraForResize`); NÃO reenquadra o grafo.
// Cada começo de sessão e cada comando avançam a época do armazém, e com isso um gesto atrasado de antes nunca move a câmera de depois.

const EMPTY_SESSION: CreateEditorStateOptions = { graph: createGraph({ id: 'laboratorio' }), mode: 'select' };

export function LabScreen() {
  return (
    <EditorStoreProvider initial={EMPTY_SESSION}>
      <LabContent />
    </EditorStoreProvider>
  );
}

const PLANNED = [
  'Ver o mesmo grafo como lista de adjacência e como matrizes.',
  'Executar BFS e DFS passo a passo, com explicação de cada passo.',
  'Comparar a complexidade de tempo e de espaço dos algoritmos.',
] as const;

/** O enquadramento do exemplo que ainda espera o quadro ser medido (aplicado UMA vez, na primeira medida). */
type PendingFit = { readonly graph: Graph; readonly layout: GraphLayout };

/** Aviso discreto de Ajustar ao grafo quando o zoom mínimo impede o enquadramento completo. */
const FIT_LIMIT_NOTICE = 'O grafo é maior que o quadro no zoom mínimo: parte dele fica fora da área visível.';

/** O conteúdo da tela, dentro do provider (exportado para os testes montarem a tela em torno de uma store conhecida). */
export function LabContent() {
  const { colors } = useTheme();
  const graph = useEditorStore(selectGraph);
  const layout = useEditorStore(selectLayout);
  const mode = useEditorStore(selectMode);
  const connectSource = useEditorStore(selectConnectSource);
  const selection = useEditorStore(selectSelection);
  const reset = useEditorStore((state) => state.reset);
  const store = useEditorStoreApi();
  const [started, setStarted] = useState(false);
  const [cameraStore] = useState(() => createCameraStore(NEUTRAL_CAMERA));
  const settledCamera = useSettledCamera(cameraStore);
  const [fitLimited, setFitLimited] = useState<Camera | undefined>(undefined);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [sheet, setSheet] = useState<SheetRequest | undefined>(undefined);
  const serial = useRef(0);

  const size = canvasSize(measuredWidth);
  const width = size?.width;
  const height = size?.height;
  const viewport: Viewport | undefined = useMemo(
    () => (width === undefined || height === undefined ? undefined : { width, height }),
    [width, height],
  );
  // A cena da tela é a da câmera ASSENTADA (resumo acessível, "fora da área visível"); durante um gesto o `LiveGraphRenderer` refaz a sua com a câmera viva.
  const scene = useMemo(
    () => (viewport === undefined ? undefined : buildGraphScene(graph, layout, settledCamera, { viewport })),
    [graph, layout, settledCamera, viewport],
  );
  const pendingFit = useRef<PendingFit | undefined>(undefined);
  const lastViewport = useRef<Viewport | undefined>(undefined);

  // O quadro foi medido (ou mudou de tamanho). Primeira medida com um exemplo à espera: enquadra UMA vez. Depois: o ponto do mundo sob o centro do quadro antigo
  // fica sob o centro do novo (sem reenquadrar). O comando avança a época e descarta qualquer gesto da medida anterior.
  useEffect(() => {
    if (viewport === undefined) return;
    const previous = lastViewport.current;
    lastViewport.current = viewport;
    const pending = pendingFit.current;
    if (pending !== undefined) {
      pendingFit.current = undefined;
      cameraStore.reset(fitCameraToGraph(pending.graph, pending.layout, viewport) ?? NEUTRAL_CAMERA);
      return;
    }
    if (previous !== undefined) cameraStore.command(cameraForResize(cameraStore.get(), previous, viewport));
  }, [viewport, cameraStore]);

  // Os gestos do canvas: o arrasto de vértice (3.9), o pan da câmera e a pinça (3.10) e o orquestrador que decide o dono de cada gesto. São criados uma vez e recebem o contexto atual depois
  // de cada renderização; a câmera é lida do armazém na hora do gesto.
  const { drag, gestures } = useCanvasGestures(store, cameraStore, {
    viewport,
    // sem grafo começado o canvas nem existe (não há detector); só a folha aberta tira o toque do canvas
    enabled: sheet === undefined,
  });

  const onCanvasLayout = (event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  };

  // Um toque no canvas: `point` está em dp, relativo ao canto do canvas (o detector envolve o próprio canvas). O núcleo puro decide
  // o que o toque significa e a store aplica. O estado do editor é lido NA HORA do toque, não de uma cópia de renderização, e nada é
  // feito se o canvas ainda não foi medido. Um toque segue UM caminho, escolhido pelo modo: em Conectar, a máquina de estados da
  // conexão (origem, destino, cancelar); nos outros, a criação de vértice (só em Adicionar vértice, em área vazia).
  const onCanvasTap = (point: Point): void => {
    if (sheet !== undefined || viewport === undefined) return;
    const camera = cameraStore.get(); // a câmera VIVA na hora do toque: a mesma que está desenhada
    const { editor, dispatch, connectTap } = store.getState();
    if (editor.mode === 'connect') {
      connectTap(camera, point, viewport);
      return;
    }
    if (editor.mode === 'select') {
      const selecting = tapToSelectionAction(editor, camera, point, viewport);
      if (selecting !== undefined) dispatch(selecting);
      return;
    }
    const action = tapToEditorAction(editor, camera, point, viewport);
    if (action !== undefined) dispatch(action);
  };

  // Centralizar: o centro do grafo vai para o centro do quadro, no mesmo zoom. Ajustar ao grafo: enquadra com margem, dentro dos limites de zoom; se o zoom mínimo
  // não bastar, avisa. São comandos explícitos (avançam a época do armazém); nunca mexem no grafo, no layout nem no histórico.
  const onCenterCamera = (): void => {
    if (viewport === undefined) return;
    const { editor } = store.getState();
    setFitLimited(undefined);
    cameraStore.command(centerCamera(editor.graph, editor.layout, cameraStore.get(), viewport));
  };
  const onFitCamera = (): void => {
    if (viewport === undefined) return;
    const { editor } = store.getState();
    const result = fitGraphCamera(editor.graph, editor.layout, viewport);
    if (result === undefined) return;
    cameraStore.command(result.camera);
    setFitLimited(result.fits ? undefined : result.camera);
  };
  // O aviso só vale enquanto a câmera assentada é a do enquadramento: qualquer outro movimento da câmera o esconde sozinho.
  const fitNotice = fitLimited !== undefined && fitLimited === settledCamera ? FIT_LIMIT_NOTICE : undefined;

  const startNewGraph = (directed: boolean): void => {
    serial.current += 1;
    gestures.cancel();
    setSheet(undefined);
    setLoadError(undefined);
    setStarted(true);
    pendingFit.current = undefined;
    setFitLimited(undefined);
    cameraStore.reset(NEUTRAL_CAMERA);
    reset({ graph: buildNewGraph(directed, serial.current), mode: 'add-vertex' });
  };

  const loadExample = (): void => {
    const example = buildExampleGraph();
    if (!example.ok) {
      setLoadError(graphErrorMessage(example.error));
      return;
    }
    const exampleLayout = circularLayout(example.value);
    gestures.cancel();
    setSheet(undefined);
    setLoadError(undefined);
    setStarted(true);
    setFitLimited(undefined);
    // enquadra UMA vez; sem a medida do quadro, espera a primeira (a câmera neutra fica no lugar enquanto isso)
    const fit = viewport === undefined ? undefined : fitCameraToGraph(example.value, exampleLayout, viewport);
    pendingFit.current = fit === undefined ? { graph: example.value, layout: exampleLayout } : undefined;
    cameraStore.reset(fit ?? NEUTRAL_CAMERA);
    reset({ graph: example.value, layout: exampleLayout, mode: 'select' });
  };

  const isEmpty = graph.vertices.length === 0;
  return (
    <>
      <Screen title="Laboratório" subtitle="Comece um grafo, adicione vértices e arestas tocando no quadro, e selecione para editar, excluir ou arrastar.">
        {started ? (
          <>
            <ModeBar />
            <View style={styles.block}>
              <CanvasGestureDetector onTap={onCanvasTap} pan={gestures.pan} pinch={gestures.pinch}>
                <View testID="canvas-area" onLayout={onCanvasLayout} style={styles.canvasArea}>
                  {scene !== undefined && width !== undefined && height !== undefined ? (
                    <LiveGraphRenderer
                      controller={drag}
                      cameraStore={cameraStore}
                      graph={graph}
                      layout={layout}
                      baseScene={scene}
                      baseCamera={settledCamera}
                      width={width}
                      height={height}
                      highlightedVertexId={connectSource}
                      selection={selection}
                    />
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
              </CanvasGestureDetector>
              <CameraControls onCenter={onCenterCamera} onFit={onFitCamera} notice={fitNotice} />
              <ConnectStatus />
              <SelectionStatus
                onEdit={(chosen) => {
                  setSheet({ view: 'edit', selection: chosen });
                }}
                onDelete={(chosen) => {
                  setSheet({ view: 'delete', selection: chosen });
                }}
              />
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
              description="Comece um grafo vazio, adicione vértices tocando no quadro, conecte-os e edite, ou carregue o exemplo." />
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
      {/* Fora da `Screen`: dentro do ScrollView dela, com um campo focado, o ScrollView capturaria os toques da folha (ver properties-sheet.tsx). */}
      <PropertiesSheet
        request={sheet}
        onClose={() => {
          setSheet(undefined);
        }}
      />
    </>
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
