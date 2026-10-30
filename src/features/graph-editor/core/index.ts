// Núcleo puro do editor de grafos (Fase 3): TypeScript sem React, React Native, Expo, JSX, gestos, SVG, animação nem
// Zustand. Calcula; não desenha, não escuta toques e não guarda estado de tela. Os módulos entram um por incremento
// (docs/ROADMAP.md, Fase 3):
//   3.1 câmera (coordenadas de mundo ↔ tela) — pronta · 3.2 GraphLayout e posicionamento — pronto · 3.3 geometria e
//   hit-testing · 3.4 comandos do editor e histórico.
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
