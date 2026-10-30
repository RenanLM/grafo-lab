import {
  addEdge,
  addVertex,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  type EdgeId,
  type Graph,
  type GraphError,
  type VertexId,
} from '@/domain/graph';

import type { Point } from './camera';
import { moveVertex, placeVertex, reconcileLayout, removePosition, emptyLayout, type GraphLayout } from './layout';

// Núcleo de edição (Fase 3, incremento 3.4): o que o editor FAZ, sem desenhar, sem ouvir gestos e sem guardar estado em
// lugar nenhum. TypeScript puro: `applyAction(estado, ação)` devolve o próximo estado; a store Zustand (fora do núcleo) só
// guarda o resultado. Toda regra do grafo vem do domínio (`addVertex`, `addEdge`, `removeVertex`…), e a do layout, de
// `layout.ts`; este módulo as costura e cuida do histórico, da seleção e da política de rótulos e de contadores.
//
// Estado: `{ graph, layout, selection, mode, history, error? }`
// - `graph` e `layout` andam JUNTOS: o layout é do `graph.id`, tem exatamente uma posição por vértice e nenhuma órfã. Toda
//   transição mantém isso POR CONSTRUÇÃO (adicionar posiciona, remover despõe a posição); os testes conferem as invariantes
//   a cada passo, mas a produção não revalida nada por ação.
// - `selection`: união discriminada (nenhuma, vértice ou aresta) por ID estável, nunca por objeto. Fora do histórico.
// - `mode`: select | add-vertex | connect. Só guarda o modo; o que cada modo faz com um toque é do detector de gestos (3.10).
// - `history`: `{ past, future, limit }` de instantâneos `{ graph, layout }` (só isso). A câmera, a seleção, o modo e o erro
//   NÃO entram nos instantâneos.
// - `error`: erro transitório da última ação recusada. Qualquer ação aplicada com sucesso o limpa; desfazer e refazer nunca o
//   restauram (não está nos instantâneos).
//
// Transição: `{ state, error? }`. Três resultados, distinguíveis sem campo extra:
// - APLICADA: `state` novo, sem `error`.
// - SEM EFEITO (rótulo ou peso iguais, mover para onde já está, desfazer sem histórico, selecionar o que já está
//   selecionado…): `state` é o MESMO objeto recebido, e nada entra no histórico.
// - RECUSADA: `state` novo só com o `error` preenchido (grafo, layout, `history` e contadores são os mesmos objetos), e
//   `error` na transição, para quem quer o erro estruturado sem ler o estado. O erro do domínio vem intacto em
//   `error.error`; a mensagem em português é de `error-messages.ts`.
//
// Histórico
// - Entra UM instantâneo (o estado de antes) por operação que muda o grafo ou o layout: adicionar, conectar, remover,
//   rótulo, peso e mover (uma movimentação concluída = um passo). Recusadas, sem efeito, seleção, modo e limpar erro NÃO entram.
// - Desfazer: o estado atual vai para `future`, o último de `past` volta. Refazer: o inverso. Uma operação nova depois de
//   desfazer DESCARTA `future`. Com `past` vazio, desfazer não faz nada (idem refazer com `future` vazio).
// - `limit` (padrão 100, `1 ≤ limit ≤ 1000`, inválido vale o padrão): passando disso, o instantâneo mais antigo é esquecido.
//   É uma política inicial, não uma garantia de memória (veja a complexidade).
//
// IDs nunca recuam (estratégia do incremento 3.0, ARCHITECTURE.md)
// - Os contadores `nextVertexSeq` e `nextEdgeSeq` do estado ATUAL são o piso da sessão: só as operações os aumentam, e uma
//   operação descarta o `future`. Ao restaurar um instantâneo (desfazer ou refazer), o `Graph` restaurado é copiado com
//   `max(contador do instantâneo, contador do estado que está sendo deixado)` — uma cópia rasa de objeto comum, sem alterar o
//   domínio nem o instantâneo. Assim: refazer devolve a MESMA entidade com o MESMO id (o instantâneo a guarda), e uma operação
//   nova depois de desfazer emite um id NOVO, acima de todos os já emitidos na sessão. Vértices e arestas têm contadores
//   independentes, e cada um é tratado em separado.
// - Consequência: `redo(undo(s))` devolve o mesmo grafo (mesmo conteúdo e mesmos contadores) e o mesmo layout.
//
// Rótulos automáticos
// - Sem rótulo informado, o editor usa o MENOR da sequência A, B, …, Z, AA, AB, … que nenhum vértice usa hoje, e o passa
//   explicitamente a `addVertex`: criar A, B, C, desfazer C e criar outro dá o vértice `v4` com o rótulo `C`. Rótulo se reaproveita;
//   id nunca. Rótulos dados pelo aluno contam como usados e nunca são alterados; duplicados informados continuam permitidos.
//   A regra padrão de `addVertex` (rótulo pelo contador) não muda.
//
// Complexidade (V vértices, E arestas, L = limite do histórico, no máximo 1000)
// - adicionar vértice: Θ(V) (conjunto de rótulos usados, cópia do vetor de vértices do domínio, cópia do layout); conectar: Θ(E);
//   remover vértice: Θ(V + E); rótulo: Θ(V); peso: Θ(E); mover: Θ(V) (cópia do layout); selecionar, modo e limpar erro: O(1)
//   (selecionar confere que o elemento existe: O(V) ou O(E)).
// - registrar no histórico copia o vetor `past` (Θ(L)); desfazer e refazer custam Θ(L + V + E) (cópia dos vetores e conferência
//   da seleção).
// - Memória: os instantâneos compartilham os vértices, arestas e posições (objetos imutáveis), mas cada atualização do grafo
//   cria vetores novos, então o histórico ocupa Θ(L · (V + E)) referências no pior caso, não um valor constante. Nada é copiado
//   em profundidade, e as quatro representações matemáticas NÃO são recalculadas aqui (a interface as pede sob demanda).

export type EditorMode = 'select' | 'add-vertex' | 'connect';

export const EDITOR_MODES: readonly EditorMode[] = Object.freeze(['select', 'add-vertex', 'connect'] as const);

/** O que está selecionado, por ID estável. */
export type EditorSelection =
  | { readonly type: 'none' }
  | { readonly type: 'vertex'; readonly vertexId: VertexId }
  | { readonly type: 'edge'; readonly edgeId: EdgeId };

/** O que o desfazer e o refazer guardam: só o grafo e o layout. */
export type EditorSnapshot = {
  readonly graph: Graph;
  readonly layout: GraphLayout;
};

export type EditorHistory = {
  /** Estados anteriores; o último é o que `undo` restaura. */
  readonly past: readonly EditorSnapshot[];
  /** Estados desfeitos; o último é o que `redo` restaura. */
  readonly future: readonly EditorSnapshot[];
  /** Máximo de passos em `past`. */
  readonly limit: number;
};

/** Por que o editor recusou uma ação. O erro do domínio vem intacto em `GRAPH_ERROR`. */
export type EditorError =
  | { readonly code: 'GRAPH_ERROR'; readonly error: GraphError }
  | { readonly code: 'INVALID_POSITION' }
  | { readonly code: 'NOTHING_SELECTED' }
  | { readonly code: 'INVALID_MODE' };

export type EditorState = {
  readonly graph: Graph;
  readonly layout: GraphLayout;
  readonly selection: EditorSelection;
  readonly mode: EditorMode;
  readonly history: EditorHistory;
  /** Erro da última ação recusada; some na próxima ação aplicada. Fora do histórico. */
  readonly error?: EditorError;
};

export type EditorAction =
  /** Cria um vértice em `position` (mundo). Sem `label`, usa o menor rótulo automático livre. */
  | { readonly type: 'add-vertex'; readonly position: Point; readonly label?: string }
  | { readonly type: 'connect'; readonly source: VertexId; readonly target: VertexId; readonly weight?: number }
  /** Remove o vértice ou a aresta selecionado(a) (e as arestas incidentes a um vértice). */
  | { readonly type: 'remove-selection' }
  | { readonly type: 'set-label'; readonly vertexId: VertexId; readonly label: string }
  /** `weight: undefined` remove o peso (diferente de `0`). */
  | { readonly type: 'set-weight'; readonly edgeId: EdgeId; readonly weight: number | undefined }
  /** Confirma a posição FINAL de um vértice (um passo de histórico). A posição durante o arrasto não passa por aqui. */
  | { readonly type: 'move-vertex'; readonly vertexId: VertexId; readonly position: Point }
  | { readonly type: 'select'; readonly selection: EditorSelection }
  | { readonly type: 'clear-selection' }
  | { readonly type: 'set-mode'; readonly mode: EditorMode }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'clear-error' };

export type EditorTransition = {
  /** O próximo estado; o MESMO objeto recebido se a ação não teve efeito. */
  readonly state: EditorState;
  /** Presente quando a ação foi recusada (o mesmo valor está em `state.error`). */
  readonly error?: EditorError;
};

export type CreateEditorStateOptions = {
  readonly graph: Graph;
  /** Layout de partida; ausente, de outro grafo ou incompleto, é reconciliado (`reconcileLayout`). */
  readonly layout?: GraphLayout;
  /** Máximo de passos do histórico. Inteiro de 1 a `MAX_HISTORY_LIMIT`; inválido vale `DEFAULT_HISTORY_LIMIT`. */
  readonly historyLimit?: number;
  readonly mode?: EditorMode;
};

/** Máximo de passos do histórico (política inicial, a ajustar em aparelho). */
export const DEFAULT_HISTORY_LIMIT = 100;
/** Teto do limite configurável: protege a memória de um valor absurdo. */
export const MAX_HISTORY_LIMIT = 1000;

const NO_SELECTION: EditorSelection = Object.freeze({ type: 'none' });

const isValidPoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const graphError = (error: GraphError): EditorError => ({ code: 'GRAPH_ERROR', error });

function resolveHistoryLimit(limit: number | undefined): number {
  return limit !== undefined && Number.isInteger(limit) && limit >= 1
    ? Math.min(limit, MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT;
}

/** Rótulo `seq` da sequência A, B, …, Z, AA, AB, … (`seq ≥ 1`): numeração bijetiva em base 26. */
function sequenceLabel(seq: number): string {
  let label = '';
  for (let n = seq; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

/**
 * Menor rótulo automático (A, B, …, Z, AA, AB, …) que nenhum vértice do grafo usa. Rótulos dados pelo aluno contam como usados.
 * Θ(V): monta o conjunto dos rótulos usados e percorre a sequência até achar um livre, o que ocorre em no máximo V + 1 passos.
 */
export function nextFreeLabel(graph: Graph): string {
  const used = new Set<string>();
  for (const vertex of graph.vertices) used.add(vertex.label);
  let seq = 1;
  while (used.has(sequenceLabel(seq))) seq++;
  return sequenceLabel(seq);
}

/**
 * Estado inicial de uma sessão de edição: o grafo dado, o layout (reconciliado se faltar, for de outro grafo ou estiver
 * incompleto), nenhuma seleção, modo `select` (ou o pedido), histórico vazio e nenhum erro.
 */
export function createEditorState(options: CreateEditorStateOptions): EditorState {
  const { graph } = options;
  const layout = reconcileLayout(graph, options.layout ?? emptyLayout(graph.id));
  const mode = options.mode !== undefined && EDITOR_MODES.includes(options.mode) ? options.mode : 'select';
  return {
    graph,
    layout,
    selection: NO_SELECTION,
    mode,
    history: { past: [], future: [], limit: resolveHistoryLimit(options.historyLimit) },
  };
}

// ---------------------------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------------------------

const unchanged = (state: EditorState): EditorTransition => ({ state });

/** Recusa a ação: só o erro muda no estado. Grafo, layout, histórico e seleção seguem os mesmos objetos. */
const rejected = (state: EditorState, error: EditorError): EditorTransition => ({ state: { ...state, error }, error });

/** Novo estado sem o erro transitório, com as partes dadas trocadas. */
function applied(state: EditorState, patch: Partial<Omit<EditorState, 'error'>>): EditorTransition {
  return {
    state: {
      graph: patch.graph ?? state.graph,
      layout: patch.layout ?? state.layout,
      selection: patch.selection ?? state.selection,
      mode: patch.mode ?? state.mode,
      history: patch.history ?? state.history,
    },
  };
}

/** A seleção continua valendo no grafo? Senão, nenhuma (a seleção é por ID: nunca guarda objetos de instantâneos). */
function selectionIn(selection: EditorSelection, graph: Graph): EditorSelection {
  if (selection.type === 'vertex') {
    return graph.vertices.some((vertex) => vertex.id === selection.vertexId) ? selection : NO_SELECTION;
  }
  if (selection.type === 'edge') {
    return graph.edges.some((edge) => edge.id === selection.edgeId) ? selection : NO_SELECTION;
  }
  return selection;
}

/** Operação que muda o grafo ou o layout: o estado de antes vai para `past`, `future` é descartado, e o resto segue. */
function commit(
  state: EditorState,
  graph: Graph,
  layout: GraphLayout,
  selection: EditorSelection = state.selection,
): EditorTransition {
  const { past, limit } = state.history;
  const grown = [...past, { graph: state.graph, layout: state.layout }];
  const kept = grown.length > limit ? grown.slice(grown.length - limit) : grown;
  return applied(state, { graph, layout, selection, history: { past: kept, future: [], limit } });
}

/**
 * Restaura o `Graph` de um instantâneo sem deixar os contadores de id recuarem: copia o grafo com o MAIOR de cada contador entre
 * o do instantâneo e o do estado que está sendo deixado. Se o instantâneo já não está atrás, devolve o próprio objeto.
 */
function restoredGraph(snapshot: Graph, leaving: Graph): Graph {
  if (snapshot.nextVertexSeq >= leaving.nextVertexSeq && snapshot.nextEdgeSeq >= leaving.nextEdgeSeq) return snapshot;
  return {
    ...snapshot,
    nextVertexSeq: Math.max(snapshot.nextVertexSeq, leaving.nextVertexSeq),
    nextEdgeSeq: Math.max(snapshot.nextEdgeSeq, leaving.nextEdgeSeq),
  };
}

function addVertexAt(state: EditorState, position: Point, label: string | undefined): EditorTransition {
  if (!isValidPoint(position)) return rejected(state, { code: 'INVALID_POSITION' });
  // Só `undefined` significa "omitido" (como no domínio): `null` ou texto vazio chegam ao `addVertex` e são recusados lá.
  const added = addVertex(state.graph, label === undefined ? nextFreeLabel(state.graph) : label);
  if (!added.ok) return rejected(state, graphError(added.error));
  return commit(state, added.value.graph, placeVertex(state.layout, added.value.vertex.id, position));
}

function connect(state: EditorState, source: VertexId, target: VertexId, weight: number | undefined): EditorTransition {
  const added = addEdge(state.graph, { source, target, weight });
  if (!added.ok) return rejected(state, graphError(added.error));
  return commit(state, added.value.graph, state.layout);
}

function removeSelection(state: EditorState): EditorTransition {
  const { selection } = state;
  if (selection.type === 'none') return rejected(state, { code: 'NOTHING_SELECTED' });
  if (selection.type === 'vertex') {
    const removed = removeVertex(state.graph, selection.vertexId);
    if (!removed.ok) return rejected(state, graphError(removed.error));
    return commit(state, removed.value, removePosition(state.layout, selection.vertexId), NO_SELECTION);
  }
  const removed = removeEdge(state.graph, selection.edgeId);
  if (!removed.ok) return rejected(state, graphError(removed.error));
  return commit(state, removed.value, state.layout, NO_SELECTION);
}

function setLabel(state: EditorState, vertexId: VertexId, label: string): EditorTransition {
  const result = setVertexLabel(state.graph, vertexId, label);
  if (!result.ok) return rejected(state, graphError(result.error));
  return result.value === state.graph ? unchanged(state) : commit(state, result.value, state.layout);
}

function setWeight(state: EditorState, edgeId: EdgeId, weight: number | undefined): EditorTransition {
  const result = setEdgeWeight(state.graph, edgeId, weight);
  if (!result.ok) return rejected(state, graphError(result.error));
  return result.value === state.graph ? unchanged(state) : commit(state, result.value, state.layout);
}

function moveTo(state: EditorState, vertexId: VertexId, position: Point): EditorTransition {
  if (!state.graph.vertices.some((vertex) => vertex.id === vertexId)) {
    return rejected(state, graphError({ code: 'VERTEX_NOT_FOUND', vertexId }));
  }
  if (!isValidPoint(position)) return rejected(state, { code: 'INVALID_POSITION' });
  const layout = moveVertex(state.layout, vertexId, position);
  return layout === state.layout ? unchanged(state) : commit(state, state.graph, layout);
}

function sameSelection(a: EditorSelection, b: EditorSelection): boolean {
  if (a.type === 'vertex') return b.type === 'vertex' && a.vertexId === b.vertexId;
  if (a.type === 'edge') return b.type === 'edge' && a.edgeId === b.edgeId;
  return b.type === 'none';
}

function select(state: EditorState, selection: EditorSelection): EditorTransition {
  if (selection.type === 'vertex' && !state.graph.vertices.some((vertex) => vertex.id === selection.vertexId)) {
    return rejected(state, graphError({ code: 'VERTEX_NOT_FOUND', vertexId: selection.vertexId }));
  }
  if (selection.type === 'edge' && !state.graph.edges.some((edge) => edge.id === selection.edgeId)) {
    return rejected(state, graphError({ code: 'EDGE_NOT_FOUND', edgeId: selection.edgeId }));
  }
  if (sameSelection(state.selection, selection)) return unchanged(state);
  return applied(state, { selection: selection.type === 'none' ? NO_SELECTION : selection });
}

function undo(state: EditorState): EditorTransition {
  const { past, future, limit } = state.history;
  const target = past[past.length - 1];
  if (target === undefined) return unchanged(state);
  const graph = restoredGraph(target.graph, state.graph);
  return applied(state, {
    graph,
    layout: target.layout,
    selection: selectionIn(state.selection, graph),
    history: { past: past.slice(0, -1), future: [...future, { graph: state.graph, layout: state.layout }], limit },
  });
}

function redo(state: EditorState): EditorTransition {
  const { past, future, limit } = state.history;
  const target = future[future.length - 1];
  if (target === undefined) return unchanged(state);
  const graph = restoredGraph(target.graph, state.graph);
  return applied(state, {
    graph,
    layout: target.layout,
    selection: selectionIn(state.selection, graph),
    history: { past: [...past, { graph: state.graph, layout: state.layout }], future: future.slice(0, -1), limit },
  });
}

/**
 * Aplica uma ação ao estado. Pura, determinística, sem exceção: devolve a transição (veja o cabeçalho para os três
 * resultados: aplicada, sem efeito, recusada). Não altera `state` nem `action`.
 */
export function applyAction(state: EditorState, action: EditorAction): EditorTransition {
  switch (action.type) {
    case 'add-vertex':
      return addVertexAt(state, action.position, action.label);
    case 'connect':
      return connect(state, action.source, action.target, action.weight);
    case 'remove-selection':
      return removeSelection(state);
    case 'set-label':
      return setLabel(state, action.vertexId, action.label);
    case 'set-weight':
      return setWeight(state, action.edgeId, action.weight);
    case 'move-vertex':
      return moveTo(state, action.vertexId, action.position);
    case 'select':
      return select(state, action.selection);
    case 'clear-selection':
      return select(state, NO_SELECTION);
    case 'set-mode':
      if (!EDITOR_MODES.includes(action.mode)) return rejected(state, { code: 'INVALID_MODE' });
      return action.mode === state.mode ? unchanged(state) : applied(state, { mode: action.mode });
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
    case 'clear-error':
      return state.error === undefined ? unchanged(state) : applied(state, {});
    default:
      return unchanged(state);
  }
}
