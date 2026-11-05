import type { Graph, VertexId } from '@/domain/graph';

import { screenToWorld, worldToScreen, type Camera, type Point, type Viewport } from './camera';
import type { EditorAction, EditorState } from './editor';
import type { HitTestOptions } from './geometry';
import { positionOf, type GraphLayout } from './layout';
import { hitTapTarget } from './tap';

// Arrasto de vértice (Fase 3, incremento 3.9), parte pura. TypeScript puro: não conhece gesto, React, SVG, Reanimated nem store. O gesto
// (na interface) entrega pontos em dp locais ao canvas e deslocamentos; aqui se decide se o arrasto começa, onde o vértice estaria, e
// qual ação o editor recebe ao soltar. Nada é alterado: nem grafo, nem layout, nem histórico. Durante o arrasto só a PRÉVIA se move (ver
// `drag-preview.ts`); quem muda o layout, uma vez, é o `move-vertex` do `applyAction` (3.4), com UM passo de histórico.
//
// Quando o arrasto pode começar (`startDrag`; a primeira regra que falha devolve `undefined`: nenhuma sessão)
// 1. o modo é `select` (em `add-vertex` e `connect` o dedo não arrasta vértice);
// 2. o ponto inicial vale: câmera válida, `viewport` válido, ponto finito e DENTRO do canvas (`hitTapTarget`, a mesma validação do
//    toque; os limites contam como dentro);
// 3. o `hitTest` do 3.3 (a MESMA função do toque: aqui não há outra conta de proximidade) responde um VÉRTICE, com a prioridade vértice >
//    aresta > fundo e o alvo mínimo de 48 dp. Começar sobre aresta ou fundo não move nada;
// 4. esse vértice tem posição finita no layout.
// O vértice é identificado UMA vez, aqui, no início do gesto: a sessão guarda o id técnico e nada mais o troca (passar sobre outro círculo
// não muda o vértice arrastado, e ninguém refaz o hit-testing a cada atualização).
//
// Sessão (`DragSession`, imutável e congelada): o id do grafo e do vértice, a posição do vértice no MUNDO e o ponto do dedo na TELA no
// início, o grab offset, a câmera (copiada: fica FIXA durante o gesto, sem pan nem zoom neste incremento) e os OBJETOS `Graph` e
// `GraphLayout` do início, guardados por referência para saber, por identidade, se ainda valem (`isDragSessionValid`). Dois grafos
// diferentes usam os mesmos ids técnicos (`v1`…), então comparar ids não basta: outro grafo, mesmo com ids iguais, é outro objeto.
//
// Matemática do grab offset. O dedo costuma tocar fora do centro do círculo. Com a câmera `tela = mundo·scale + (x, y)`:
//   centro inicial na tela   C0 = worldToScreen(câmera, posiçãoInicial)
//   grab offset              g  = P0 − C0           (P0 = ponto do dedo na tela, em dp, no início)
//   o dedo anda t dp         P  = P0 + t
//   o centro acompanha o dedo C  = P − g = C0 + t   (o deslocamento entre dedo e centro, g, se mantém: o vértice não "salta" para o dedo)
//   novo ponto do mundo      posição = screenToWorld(câmera, C) = posiçãoInicial + t / scale
// O último passo é porque `(C0 + t − câmera.x) / scale = (C0 − câmera.x) / scale + t / scale`: a translação da câmera some e só a escala
// converte o deslocamento. Por isso a fórmula do código é `posição = posiçãoInicial + t / scale`, calculada com `screenToWorld` sobre
// uma câmera SEM translação (`{ x: 0, y: 0, scale }`, que divide o deslocamento pela escala) e somada à posição inicial. Ela é exata para
// t = 0 (devolve a posição inicial, sem erro de arredondamento) e equivale a `screenToWorld(câmera, P0 + t − g)` a menos do
// arredondamento (os testes conferem a equivalência em várias câmeras). `t` é o DESLOCAMENTO do dedo em dp locais (o ponto atual menos
// o ponto inicial, ou a `translationX/Y` do gesto), nunca `absoluteX/absoluteY` tomados como se fossem locais ao canvas.
//
// Conclusão e cancelamento (`finishDrag`): ao soltar, `dragCommitAction` devolve UMA ação `move-vertex` com a posição final (a mesma fórmula
// da prévia: o que se viu é o que se confirma), ou nada, se a sessão deixou de valer, a posição não é finita ou é a mesma de antes (nenhum
// passo de histórico). Cancelar (gesto cancelado, interrompido ou falho) NUNCA devolve ação. A posição final fora da área visível é válida:
// a câmera não se move (sem auto-rolagem), e desfazer traz o vértice de volta.
//
// Complexidade (V vértices, E arestas, N amostras por curva): `startDrag` Θ(V) se o dedo cai num vértice e Θ(V + E·N) no pior caso
// (o `hitTest`); o resto é O(1): `dragActivated`, `dragPreviewPosition`, `dragFinalPosition`, `isDragSessionValid` e `finishDrag`. Aplicar a
// ação devolvida custa Θ(V) (cópia do layout) mais o passo de histórico (Θ(L), veja `editor.ts`).

/** Quanto o dedo precisa andar, em dp, desde que desceu para o gesto virar arrasto. É o mesmo limite do toque (`TAP_MAX_DISTANCE_DP`). */
export const DRAG_START_DISTANCE_DP = 10;

/** A ação do editor que confirma o arrasto. */
export type MoveVertexAction = Extract<EditorAction, { readonly type: 'move-vertex' }>;

/** O que o arrasto precisa saber do editor para começar e para conferir se a sessão ainda vale. */
export type DragEditorState = Pick<EditorState, 'mode' | 'graph' | 'layout'>;

/** Um arrasto em andamento. Imutável (congelada) e sem aliasing com as entradas, exceto `baseGraph` e `baseLayout`, guardados por referência. */
export type DragSession = {
  readonly graphId: string;
  readonly vertexId: VertexId;
  /** Posição do vértice no layout quando o arrasto começou, em unidades de mundo. */
  readonly startWorldPosition: Point;
  /** Onde o dedo desceu, em dp relativos ao canto superior esquerdo do canvas. */
  readonly startScreenPoint: Point;
  /** `startScreenPoint` menos o centro do vértice na tela: a distância entre o dedo e o centro, mantida durante o arrasto (dp). */
  readonly grabOffset: Point;
  /** A câmera do início, que vale até o fim do arrasto. */
  readonly camera: Camera;
  /** O grafo e o layout do início (por referência): qualquer mudança em um deles invalida a sessão. */
  readonly baseGraph: Graph;
  readonly baseLayout: GraphLayout;
};

/** Como o arrasto terminou: soltou (com o deslocamento final) ou foi cancelado. */
export type DragEnd =
  | { readonly kind: 'release'; readonly translation: Point }
  | { readonly kind: 'cancel' };

/** O que fazer com o fim do arrasto: confirmar o movimento (uma ação) ou descartar, e por quê. */
export type DragOutcome =
  | { readonly kind: 'move'; readonly action: MoveVertexAction }
  | { readonly kind: 'discard'; readonly reason: 'cancelled' | 'stale' | 'invalid' | 'unchanged' };

const noNegativeZero = (n: number): number => (n === 0 ? 0 : n);

const isFinitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const DISCARDED = {
  cancelled: Object.freeze({ kind: 'discard', reason: 'cancelled' }),
  stale: Object.freeze({ kind: 'discard', reason: 'stale' }),
  invalid: Object.freeze({ kind: 'discard', reason: 'invalid' }),
  unchanged: Object.freeze({ kind: 'discard', reason: 'unchanged' }),
} as const satisfies Record<string, DragOutcome>;

/**
 * Começa um arrasto em `screenPoint` (dp, relativo ao canvas), ou devolve `undefined` se nenhum vértice deve ser arrastado (veja as regras
 * no cabeçalho). `viewport`: o tamanho do canvas em dp; `options`: as mesmas opções de geometria e de hit-testing do desenho. Não altera nada.
 */
export function startDrag(
  state: DragEditorState,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): DragSession | undefined {
  if (state.mode !== 'select') return undefined;

  const target = hitTapTarget(state.graph, state.layout, camera, screenPoint, viewport, options);
  if (target?.type !== 'vertex') return undefined;

  const start = positionOf(state.layout, target.vertexId);
  if (start === undefined || !isFinitePoint(start)) return undefined;

  const center = worldToScreen(camera, start);
  return Object.freeze({
    graphId: state.graph.id,
    vertexId: target.vertexId,
    startWorldPosition: Object.freeze({ x: start.x, y: start.y }),
    startScreenPoint: Object.freeze({ x: noNegativeZero(screenPoint.x), y: noNegativeZero(screenPoint.y) }),
    grabOffset: Object.freeze({
      x: noNegativeZero(screenPoint.x - center.x),
      y: noNegativeZero(screenPoint.y - center.y),
    }),
    camera: Object.freeze({ x: camera.x, y: camera.y, scale: camera.scale }),
    baseGraph: state.graph,
    baseLayout: state.layout,
  });
}

/**
 * O dedo já andou o suficiente, desde onde desceu, para o gesto virar arrasto? Distância euclidiana em dp entre `screenPoint` e o ponto
 * inicial, `≥ threshold` (padrão `DRAG_START_DISTANCE_DP`; um limite inválido vale o padrão). Ponto não finito: não.
 */
export function dragActivated(session: DragSession, screenPoint: Point, threshold: number = DRAG_START_DISTANCE_DP): boolean {
  if (!isFinitePoint(screenPoint)) return false;
  const limit = Number.isFinite(threshold) && threshold > 0 ? threshold : DRAG_START_DISTANCE_DP;
  const { startScreenPoint } = session;
  return Math.hypot(screenPoint.x - startScreenPoint.x, screenPoint.y - startScreenPoint.y) >= limit;
}

/** `posiçãoInicial + t / scale` (veja o cabeçalho), ou `undefined` se o deslocamento ou o resultado não são finitos. */
function positionAfter(session: DragSession, translation: Point): Point | undefined {
  if (!isFinitePoint(translation)) return undefined;
  // `screenToWorld` com a câmera sem translação divide o deslocamento pela escala: o deslocamento não depende de onde a câmera está.
  const delta = screenToWorld({ x: 0, y: 0, scale: session.camera.scale }, translation);
  const position = {
    x: noNegativeZero(session.startWorldPosition.x + delta.x),
    y: noNegativeZero(session.startWorldPosition.y + delta.y),
  };
  return isFinitePoint(position) ? position : undefined;
}

/**
 * Onde o vértice fica, no MUNDO, quando o dedo andou `translation` (dp) desde o início do arrasto. O grab offset é mantido. Devolve um ponto
 * novo, ou `undefined` se o deslocamento não é finito ou o resultado estoura. Para `translation` zero, devolve exatamente a posição inicial.
 */
export function dragPreviewPosition(session: DragSession, translation: Point): Point | undefined {
  return positionAfter(session, translation);
}

/**
 * A posição que o arrasto confirma ao soltar com o deslocamento final `translation`: a MESMA fórmula da prévia, para que o que o aluno viu
 * seja o que fica. Devolve um ponto novo, ou `undefined` (deslocamento não finito).
 */
export function dragFinalPosition(session: DragSession, translation: Point): Point | undefined {
  return positionAfter(session, translation);
}

/**
 * A sessão ainda corresponde ao editor? O modo continua `select` e o grafo e o layout são OS MESMOS objetos do início (por identidade).
 * Trocar de modo, começar outro grafo (mesmo com os mesmos ids), carregar o exemplo, desfazer, refazer, remover o vértice ou qualquer
 * edição a invalidam.
 */
export function isDragSessionValid(session: DragSession, state: DragEditorState): boolean {
  return (
    state.mode === 'select' &&
    state.graph === session.baseGraph &&
    state.layout === session.baseLayout &&
    state.graph.id === session.graphId
  );
}

/**
 * Fecha o arrasto. `release`: a ação `move-vertex` com a posição final, se a sessão ainda vale, a posição é finita e mudou; senão descarta,
 * com o motivo (`stale`, `invalid`, `unchanged`). `cancel`: descarta sempre (`cancelled`) e nunca devolve ação, nem com um deslocamento grande.
 */
export function finishDrag(session: DragSession, state: DragEditorState, end: DragEnd): DragOutcome {
  if (end.kind === 'cancel') return DISCARDED.cancelled;
  if (!isDragSessionValid(session, state)) return DISCARDED.stale;
  const position = dragFinalPosition(session, end.translation);
  if (position === undefined) return DISCARDED.invalid;
  const { startWorldPosition } = session;
  if (position.x === startWorldPosition.x && position.y === startWorldPosition.y) return DISCARDED.unchanged;
  return { kind: 'move', action: { type: 'move-vertex', vertexId: session.vertexId, position } };
}

/** A ação `move-vertex` de um arrasto concluído (soltou) com o deslocamento final, ou `undefined` se não há o que confirmar. */
export function dragCommitAction(session: DragSession, state: DragEditorState, translation: Point): MoveVertexAction | undefined {
  const outcome = finishDrag(session, state, { kind: 'release', translation });
  return outcome.kind === 'move' ? outcome.action : undefined;
}
