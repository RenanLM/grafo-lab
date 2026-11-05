import type { Graph, VertexId } from '@/domain/graph';

import type { Camera, Point, Viewport } from './camera';
import type { EditorAction, EditorState } from './editor';
import type { HitTestOptions } from './geometry';
import { hitTapTarget } from './tap';
import { formatWeightForInput } from './weight-input';

// Seleção por toque (Fase 3, incremento 3.8). TypeScript puro: não conhece gesto, React, SVG nem store. Traduz o toque em uma AÇÃO do
// núcleo (`select` ou `clear-selection`) e descreve a seleção em português; quem aplica é o `applyAction`. Não altera nada.
//
// Regras (a primeira que falha devolve `undefined`: nenhuma ação):
// 1. o modo é `select` (em `add-vertex` e `connect` o toque tem os seus caminhos, em `tap.ts` e `connect.ts`);
// 2. o toque vale (câmera, área e ponto válidos, dentro do canvas) e `hitTapTarget` (o MESMO `hitTest` do 3.3; aqui não há outra
//    conta de proximidade nem de geometria) responde o que está sob ele, com a prioridade vértice > aresta > fundo:
//    - vértice → `select` do vértice; aresta → `select` da aresta (um toque na área de um vértice nunca seleciona aresta);
//    - fundo → `clear-selection`.
// Tocar de novo no que já está selecionado MANTÉM a seleção (não alterna): o `applyAction` devolve o mesmo estado e ninguém é avisado.
// A seleção é por id técnico e NÃO entra no histórico (3.4); toque fora do canvas, inválido ou cancelado do gesto não muda nada.
//
// Complexidade: Θ(V + E·N), a do `hitTest` (Θ(V) se o toque acerta um vértice; senão confere as arestas, com N amostras por curva).
// A ação devolvida custa O(V) ou O(E) para aplicar (o núcleo confere que o elemento existe). Sem estado, índice nem cache.

/**
 * Ação de seleção para um toque no canvas, ou `undefined` se o toque não deve fazer nada. `screenPoint`: dp, relativo ao canto superior
 * esquerdo do canvas; `viewport`: o tamanho do canvas, em dp; `options`: as mesmas opções de geometria e de hit-testing do desenho.
 */
export function tapToSelectionAction(
  state: EditorState,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): EditorAction | undefined {
  if (state.mode !== 'select') return undefined;

  const target = hitTapTarget(state.graph, state.layout, camera, screenPoint, viewport, options);
  if (target === undefined) return undefined;
  if (target.type === 'vertex') return { type: 'select', selection: { type: 'vertex', vertexId: target.vertexId } };
  if (target.type === 'edge') return { type: 'select', selection: { type: 'edge', edgeId: target.edgeId } };
  return { type: 'clear-selection' };
}

/** Instrução sem nada selecionado. */
export const SELECT_IDLE_MESSAGE = 'Toque em um vértice ou em uma aresta para selecioná-lo.';

const labelOf = (graph: Graph, vertexId: VertexId): string => graph.vertices.find((vertex) => vertex.id === vertexId)?.label ?? '?';

/**
 * A frase de estado do modo Selecionar, ou texto vazio fora dele. Cita o RÓTULO dos vértices, nunca o id.
 * - nada selecionado (ou seleção que não existe mais): a instrução;
 * - vértice: "Vértice A selecionado.";
 * - aresta: "Aresta de A para B selecionada." (orientado) ou "Aresta entre A e B selecionada." (não orientado), seguida de
 *   "Peso 2,5." ou "Sem peso.": peso `0` é "Peso 0." e aresta sem peso é "Sem peso.", sem confundir os dois.
 * Θ(V + E): procura o elemento e os rótulos.
 */
export function selectionStatusMessage(editor: Pick<EditorState, 'mode' | 'graph' | 'selection'>): string {
  if (editor.mode !== 'select') return '';
  const { graph, selection } = editor;

  if (selection.type === 'vertex') {
    const vertex = graph.vertices.find((candidate) => candidate.id === selection.vertexId);
    if (vertex !== undefined) return `Vértice ${vertex.label} selecionado.`;
  }
  if (selection.type === 'edge') {
    const edge = graph.edges.find((candidate) => candidate.id === selection.edgeId);
    if (edge !== undefined) {
      const from = labelOf(graph, edge.source);
      const to = labelOf(graph, edge.target);
      const what = graph.directed ? `Aresta de ${from} para ${to} selecionada.` : `Aresta entre ${from} e ${to} selecionada.`;
      return edge.weight === undefined ? `${what} Sem peso.` : `${what} Peso ${formatWeightForInput(edge.weight)}.`;
    }
  }
  return SELECT_IDLE_MESSAGE;
}
