import type { Graph, VertexId } from '@/domain/graph';

import type { Camera, Point, Viewport } from './camera';
import type { EditorAction, EditorState } from './editor';
import type { HitTarget, HitTestOptions } from './geometry';
import { hitTapTarget } from './tap';

// Máquina de estados do modo Conectar (Fase 3, incremento 3.7). TypeScript puro: não conhece gesto, React, SVG nem a store. Decide,
// a partir da origem PENDENTE e do que há sob o toque, se o toque escolhe a origem, cancela, ou pede a conexão. NÃO altera o grafo
// nem o layout, NÃO cria aresta e NÃO valida a aresta: o resultado é só uma descrição (`ConnectTransition`); quem cria é o
// `applyAction` com a ação `connect`, que usa `addEdge` do domínio (laço, duplicata, vértice inexistente e orientação são do domínio).
//
// Estado: `ConnectState = { sourceVertexId? }`, um id, nunca uma cópia do grafo. NÃO faz parte do `Graph`, do `GraphLayout`, do
// JSON v1 nem dos instantâneos do histórico: é estado transitório da sessão (a store o guarda ao lado do `EditorState`).
//
// Regras dos dois toques (alvo = o que o `hitTest` do 3.3 respondeu; `undefined` = toque inválido ou fora do canvas):
//
//   sem origem pendente   vértice  → ORIGEM escolhida (`source-set`): nenhuma ação, nenhum id, nenhum histórico
//                         aresta ou fundo → nada a cancelar (`ignored`)
//   com origem pendente   a própria origem → CANCELA (`cancelled`); tocar duas vezes no mesmo vértice é cancelar, nunca um laço
//                         outro vértice → pede `connect` (origem, destino) e LIMPA a origem (`connect`), com ou sem sucesso
//                         aresta ou fundo → CANCELA
//   toque inválido        qualquer estado → `ignored`: nada muda
//
// O toque na própria origem cancela sem mostrar erro de laço: o aluno está desistindo, não tentando ligar o vértice a ele mesmo.
// `SELF_LOOP` continua sendo regra do domínio e do `connect` usado por qualquer outro consumidor.
//
// Orientação: a máquina NÃO a conhece. Origem e destino saem na ordem dos toques; em grafo orientado, A → B e B → A são arestas
// distintas, e em não orientado B—A repete A—B e o domínio recusa com `DUPLICATE_EDGE`. Nenhuma regra de orientação é copiada.
//
// Cancelamentos que não passam por um toque (trocar de modo, `reset`, o vértice de origem deixar de existir) são de `reconcileConnection`.
//
// Complexidade (V vértices, E arestas, N amostras por curva): `connectStep` e `reconcileConnection` são Θ(V) (conferem se um vértice
// existe) e O(1) se não há origem pendente; `tapToConnectTransition` soma o `hitTest`, Θ(V + E·N). Nada é copiado nem guardado além
// de um id.

/** Origem pendente da conexão. Ausente = nenhuma. */
export type ConnectState = {
  readonly sourceVertexId?: VertexId;
};

/** Nenhuma conexão em andamento (congelado: é compartilhado). */
export const NO_CONNECTION: ConnectState = Object.freeze({});

/** A ação `connect` do núcleo, sem peso (a aresta criada pelo toque não tem peso; peso é do 3.8). */
export type ConnectAction = Extract<EditorAction, { readonly type: 'connect' }>;

/**
 * O que o toque fez: `source-set` (escolheu a origem), `cancelled` (desistiu ou descartou uma origem que não existe mais),
 * `connect` (pediu a conexão) ou `ignored` (nada mudou).
 */
export type ConnectOutcome = 'source-set' | 'cancelled' | 'connect' | 'ignored';

export type ConnectTransition = {
  /** A origem pendente depois do toque. O MESMO objeto recebido se nada mudou. */
  readonly connection: ConnectState;
  /** Presente só quando o toque fecha a conexão (`outcome` `connect`): a ação para o `applyAction`. */
  readonly action?: ConnectAction;
  readonly outcome: ConnectOutcome;
};

const hasVertex = (graph: Graph, vertexId: VertexId): boolean => graph.vertices.some((vertex) => vertex.id === vertexId);

/**
 * A origem pendente continua valendo? Só vale no modo `connect` e enquanto o vértice existe no grafo; senão, nenhuma conexão
 * (o mesmo objeto se já valia ou não havia origem). O(1) sem origem; Θ(V) com ela.
 */
export function reconcileConnection(connection: ConnectState, editor: EditorState): ConnectState {
  const source = connection.sourceVertexId;
  if (source === undefined) return connection;
  if (editor.mode !== 'connect') return NO_CONNECTION;
  return hasVertex(editor.graph, source) ? connection : NO_CONNECTION;
}

/**
 * Um toque, já identificado, sobre o estado pendente. Pura e determinística: não altera os argumentos. `target` é o resultado do
 * `hitTest` (`undefined` = toque que não vale). `graph` só serve para saber se um vértice existe. Θ(V).
 */
export function connectStep(connection: ConnectState, target: HitTarget | undefined, graph: Graph): ConnectTransition {
  if (target === undefined) return { connection, outcome: 'ignored' };

  const pending = connection.sourceVertexId;
  const source = pending !== undefined && hasVertex(graph, pending) ? pending : undefined;

  if (source === undefined) {
    if (target.type === 'vertex' && hasVertex(graph, target.vertexId)) {
      return { connection: { sourceVertexId: target.vertexId }, outcome: 'source-set' };
    }
    // nada a escolher; uma origem velha (o vértice não existe mais) é descartada
    return pending === undefined ? { connection, outcome: 'ignored' } : { connection: NO_CONNECTION, outcome: 'cancelled' };
  }

  if (target.type !== 'vertex' || target.vertexId === source) return { connection: NO_CONNECTION, outcome: 'cancelled' };
  return { connection: NO_CONNECTION, action: { type: 'connect', source, target: target.vertexId }, outcome: 'connect' };
}

/**
 * Um toque no canvas (dp, relativo ao canvas, a mesma origem da câmera e da cena) no modo Conectar: identifica o alvo com o
 * `hitTest` do 3.3 (`hitTapTarget`, o mesmo do modo Adicionar vértice) e passa por `connectStep`. Fora do modo `connect` não faz
 * nada (e descarta uma origem que tenha sobrado). Θ(V + E·N).
 */
export function tapToConnectTransition(
  editor: EditorState,
  connection: ConnectState,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): ConnectTransition {
  if (editor.mode !== 'connect') return { connection: reconcileConnection(connection, editor), outcome: 'ignored' };
  const target = hitTapTarget(editor.graph, editor.layout, camera, screenPoint, viewport, options);
  return connectStep(connection, target, editor.graph);
}
