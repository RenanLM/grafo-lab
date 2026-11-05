// Núcleo puro do editor de grafos (Fase 3): TypeScript sem React, React Native, Expo, JSX, gestos, SVG, animação nem
// Zustand. Calcula; não desenha, não escuta toques e não guarda estado de tela. Os módulos entram um por incremento
// (docs/ROADMAP.md, Fase 3):
//   3.1 câmera (coordenadas de mundo ↔ tela) — pronta · 3.2 GraphLayout e posicionamento — pronto · 3.3 geometria das
//   arestas (3.3A) e hit-testing (3.3B) — prontos · 3.4 comandos do editor, histórico e mensagens — pronto (a store Zustand
//   fica em `graph-editor/editor-store.ts`, fora do núcleo) · 3.5 cena do grafo e enquadramento inicial — pronto (o
//   renderizador SVG fica em `graph-editor/`) · 3.6 tradução do toque em ação (`tap.ts`) — pronto · 3.7 máquina de estados do
//   modo Conectar (`connect.ts`, `connect-status.ts`) — pronto.
// Importa apenas o domínio (`@/domain/graph`) e a si mesmo. O ESLint barra o resto e `boundary.test.ts` confere também
// os imports relativos que saiam desta pasta. A interface (`src/features/graph-editor/*.tsx`) e a futura store
// Zustand dependem deste núcleo, nunca o contrário.

// Câmera: conversão entre coordenadas de mundo e de tela (dp), zoom ancorado, deslocamento e enquadramento
export {
  centerOn,
  clampScale,
  DEFAULT_SCALE_LIMITS,
  fitToBounds,
  isValidCamera,
  NEUTRAL_CAMERA,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Bounds,
  type Camera,
  type FitToBoundsOptions,
  type Point,
  type ScaleLimits,
  type Viewport,
} from './camera';

// Layout: posições dos vértices no mundo (associadas ao id do grafo), posicionamento circular e reconciliação
export {
  boundsOf,
  circularLayout,
  DEFAULT_LAYOUT_SPACING,
  emptyLayout,
  moveVertex,
  placeVertex,
  positionOf,
  reconcileLayout,
  removePosition,
  type CircularLayoutOptions,
  type GraphLayout,
  type ReconcileOptions,
} from './layout';

// Geometria das arestas (em coordenadas de mundo): traço de borda a borda, seta, âncora do peso, arcos opostos curvos
export {
  DEFAULT_ARROW_HALF_WIDTH,
  DEFAULT_ARROW_LENGTH,
  DEFAULT_CURVATURE,
  DEFAULT_VERTEX_RADIUS,
  edgeGeometries,
  edgeGeometry,
  type Arrowhead,
  type EdgeGeometry,
  type EdgePath,
  type GeometryOptions,
  type LineSegment,
  type QuadraticCurve,
} from './geometry';

// Toque: traduz um toque no canvas (dp, relativo ao canvas) em ação do editor, usando o hit-testing do 3.3
export { hitTapTarget, tapToEditorAction } from './tap';

// Conectar (3.7): máquina de estados da origem pendente (escolher origem, destino, cancelar) e o texto de estado em português
export {
  connectStep,
  NO_CONNECTION,
  reconcileConnection,
  tapToConnectTransition,
  type ConnectAction,
  type ConnectOutcome,
  type ConnectState,
  type ConnectTransition,
} from './connect';
export { CONNECT_IDLE_MESSAGE, connectStatusMessage, type ConnectNotice } from './connect-status';

// Cena: a descrição visual do grafo em dp de tela, pronta para um renderizador, e o enquadramento inicial da câmera
export {
  buildGraphScene,
  DEFAULT_LABEL_FONT_SIZE,
  DEFAULT_SCENE_MARGIN,
  fitCameraToGraph,
  graphContentBounds,
  type FitOptions,
  type GraphScene,
  type SceneEdge,
  type SceneOptions,
  type SceneVertex,
  type SceneWeight,
} from './scene';

// Edição: estado, ações, histórico de desfazer/refazer, política de rótulos e de contadores (a store Zustand fica fora do núcleo)
export {
  applyAction,
  createEditorState,
  DEFAULT_HISTORY_LIMIT,
  EDITOR_MODES,
  MAX_HISTORY_LIMIT,
  nextFreeLabel,
  type CreateEditorStateOptions,
  type EditorAction,
  type EditorError,
  type EditorHistory,
  type EditorMode,
  type EditorSelection,
  type EditorSnapshot,
  type EditorState,
  type EditorTransition,
} from './editor';
export { editorErrorMessage, graphErrorMessage } from './error-messages';

// Hit-testing (toque em dp de tela + câmera): vértice, aresta ou fundo do canvas
export {
  DEFAULT_CURVE_SAMPLES,
  DEFAULT_EDGE_TOLERANCE,
  DEFAULT_MIN_TOUCH_DIAMETER,
  hitTest,
  hitTestEdge,
  hitTestVertex,
  type EdgeHit,
  type HitTarget,
  type HitTestOptions,
  type VertexHit,
} from './geometry';
