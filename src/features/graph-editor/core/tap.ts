import type { Graph } from '@/domain/graph';

import { isValidCamera, screenToWorld, type Camera, type Point, type Viewport } from './camera';
import type { EditorAction, EditorState } from './editor';
import { hitTest, type HitTarget, type HitTestOptions } from './geometry';
import type { GraphLayout } from './layout';

// Tradução do TOQUE em ação do editor (Fase 3, incremento 3.6). TypeScript puro: não conhece gesto, React nem SVG. O detector
// de gestos (na interface) só entrega o ponto tocado; esta função decide se aquilo vira uma ação do núcleo e qual. Nada é
// alterado: o resultado é só uma descrição (`EditorAction`) que a store passa ao `applyAction`.
//
// Origem das coordenadas: `screenPoint` está em DP, RELATIVO ao canto superior esquerdo do CANVAS (a mesma origem da câmera, do
// `viewport` e da cena). Quem chama (o detector) é quem garante isso; nunca coordenadas absolutas da tela.
//
// Regras (a primeira que falha devolve `undefined`: nenhuma ação):
// 1. o modo é `add-vertex`; nos modos `select` e `connect` este caminho não cria nada (o `connect` tem o seu, em `connect.ts`);
// 2. câmera válida, `viewport` com largura e altura finitas e > 0, e toque com coordenadas finitas;
// 3. o toque está DENTRO do canvas, `0 ≤ x ≤ largura` e `0 ≤ y ≤ altura` (os limites contam);
// 4. o `hitTest` do 3.3 (a MESMA função do resto do editor; aqui não há outro hit-testing) responde `background`: toque
//    sobre um vértice (alvo mínimo de 48 dp incluído) ou uma aresta (tolerância de 12 dp) nunca cria nada. A prioridade
//    continua vértice > aresta > fundo;
// 5. o ponto de tela vira ponto do MUNDO com `screenToWorld` (a escala e a translação da câmera, uma vez cada) e o resultado
//    precisa ser finito.
// As regras 2 a 4 (o que há sob o toque, se ele vale) vivem em `hitTapTarget`, que o modo Conectar (3.7) reaproveita sem copiar.
// Devolve `{ type: 'add-vertex', position }` com um ponto NOVO (sem alias do toque). Os ids e os rótulos (A, B, C…, menor rótulo
// livre) são do `applyAction`; esta função não decide nenhum.
//
// Complexidade: Θ(V + E·N) no pior caso, o do `hitTest` (Θ(V) se o toque acerta um vértice; senão confere as arestas, com N
// amostras por curva), mais O(1) para a conversão. Não há estado, índice nem cache.

const isValidViewport = (viewport: Viewport): boolean =>
  Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;

const isFinitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * O que há sob um toque no canvas, ou `undefined` se o toque não vale (câmera, área ou ponto inválidos, ou toque FORA do canvas;
 * os limites contam como dentro). `screenPoint`: dp, relativo ao canto superior esquerdo do canvas; `viewport`: o tamanho do canvas,
 * em dp. A resposta é a do `hitTest` do 3.3 (vértice, aresta ou fundo, com a prioridade vértice > aresta > fundo): não há outro
 * hit-testing. Θ(V + E·N), o do `hitTest`. Não depende do modo: cada modo decide o que fazer com o alvo.
 */
export function hitTapTarget(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): HitTarget | undefined {
  if (!isValidCamera(camera) || !isValidViewport(viewport) || !isFinitePoint(screenPoint)) return undefined;
  if (screenPoint.x < 0 || screenPoint.y < 0 || screenPoint.x > viewport.width || screenPoint.y > viewport.height) return undefined;
  return hitTest(graph, layout, camera, screenPoint, options);
}

/**
 * Ação do editor para um toque no canvas, ou `undefined` se o toque não deve fazer nada. `screenPoint`: dp, relativo ao canto
 * superior esquerdo do canvas; `viewport`: o tamanho do canvas, em dp; `options`: as mesmas opções de geometria e de hit-testing
 * usadas para desenhar (raio visual, alvo mínimo, tolerância).
 */
export function tapToEditorAction(
  state: EditorState,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): EditorAction | undefined {
  if (state.mode !== 'add-vertex') return undefined;

  const target = hitTapTarget(state.graph, state.layout, camera, screenPoint, viewport, options);
  if (target?.type !== 'background') return undefined;

  const position = screenToWorld(camera, screenPoint);
  if (!isFinitePoint(position)) return undefined;
  return { type: 'add-vertex', position };
}
