import { fail, ok, type InvalidLabelReason, type Result } from './errors';
import {
  GRAPH_SCHEMA_VERSION,
  type Edge,
  type EdgeId,
  type Graph,
  type Vertex,
  type VertexId,
} from './types';

export type CreateGraphOptions = {
  /** Fornecido por quem persiste o grafo; o domínio não gera identificadores aleatórios. */
  id: string;
  name?: string;
  directed?: boolean;
};

export type NewEdge = {
  source: VertexId;
  target: VertexId;
  /** Omitido = aresta não ponderada. */
  weight?: number;
};

/** Tamanho máximo do rótulo de um vértice, em pontos de código Unicode (não em unidades UTF-16). */
export const MAX_VERTEX_LABEL_LENGTH = 64;

export function createGraph({ id, name = '', directed = false }: CreateGraphOptions): Graph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    id,
    name,
    directed,
    vertices: [],
    edges: [],
    nextVertexSeq: 1,
    nextEdgeSeq: 1,
  };
}

/** Ordem do grafo: número de vértices, |V|. */
export function order(graph: Graph): number {
  return graph.vertices.length;
}

/** Tamanho do grafo: número de arestas, |E|. */
export function size(graph: Graph): number {
  return graph.edges.length;
}

export function getVertex(graph: Graph, vertexId: VertexId): Vertex | undefined {
  return graph.vertices.find((vertex) => vertex.id === vertexId);
}

export function getEdge(graph: Graph, edgeId: EdgeId): Edge | undefined {
  return graph.edges.find((edge) => edge.id === edgeId);
}

/**
 * Aresta que liga `source` a `target`. Em grafo orientado só casa o arco `source → target`;
 * em não orientado casa nas duas ordens.
 */
export function findEdge(graph: Graph, source: VertexId, target: VertexId): Edge | undefined {
  return graph.edges.find((edge) => connects(graph.directed, edge, source, target));
}

/** Rótulo padrão a partir do número de sequência: 1→A, 2→B, …, 26→Z, 27→AA. */
function defaultLabel(seq: number): string {
  let label = '';
  for (let n = seq; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

/**
 * Cria um vértice. Sem `label`, usa o rótulo padrão (A, B, …, Z, AA…, a partir do contador). Com
 * `label`, aplica as mesmas regras do `setVertexLabel`: `trim()` e depois 1 a `MAX_VERTEX_LABEL_LENGTH`
 * pontos de código; rótulos repetidos são permitidos. Só `undefined` significa "omitido": `null` e
 * qualquer outro valor que não seja string são recusados. Em caso de erro nada é criado e o contador de
 * ids não avança.
 */
export function addVertex(
  graph: Graph,
  label?: string,
): Result<{ graph: Graph; vertex: Vertex }> {
  const finalLabel =
    label === undefined ? ok(defaultLabel(graph.nextVertexSeq)) : normalizeLabel(label);
  if (!finalLabel.ok) return finalLabel;

  const vertex: Vertex = { id: `v${graph.nextVertexSeq}`, label: finalLabel.value };
  return ok({
    graph: {
      ...graph,
      vertices: [...graph.vertices, vertex],
      nextVertexSeq: graph.nextVertexSeq + 1,
    },
    vertex,
  });
}

/** Remove o vértice e todas as arestas incidentes a ele (como origem ou como destino). */
export function removeVertex(graph: Graph, vertexId: VertexId): Result<Graph> {
  if (!getVertex(graph, vertexId)) return fail({ code: 'VERTEX_NOT_FOUND', vertexId });
  return ok({
    ...graph,
    vertices: graph.vertices.filter((vertex) => vertex.id !== vertexId),
    edges: graph.edges.filter((edge) => edge.source !== vertexId && edge.target !== vertexId),
  });
}

/**
 * Cria uma aresta. As validações rodam nesta ordem e a primeira que falhar é o erro devolvido:
 * origem existe → destino existe → não é laço → peso válido → não repete aresta existente.
 */
export function addEdge(
  graph: Graph,
  { source, target, weight }: NewEdge,
): Result<{ graph: Graph; edge: Edge }> {
  if (!getVertex(graph, source)) return fail({ code: 'VERTEX_NOT_FOUND', vertexId: source });
  if (!getVertex(graph, target)) return fail({ code: 'VERTEX_NOT_FOUND', vertexId: target });
  if (source === target) return fail({ code: 'SELF_LOOP', vertexId: source });
  if (weight !== undefined && !isValidWeight(weight)) {
    return fail({ code: 'INVALID_WEIGHT', weight });
  }
  const existing = findEdge(graph, source, target);
  if (existing) return fail({ code: 'DUPLICATE_EDGE', existingEdgeId: existing.id });

  const edge: Edge = {
    id: `e${graph.nextEdgeSeq}`,
    source,
    target,
    ...(weight !== undefined && { weight: normalizeWeight(weight) }),
  };
  return ok({
    graph: { ...graph, edges: [...graph.edges, edge], nextEdgeSeq: graph.nextEdgeSeq + 1 },
    edge,
  });
}

export function removeEdge(graph: Graph, edgeId: EdgeId): Result<Graph> {
  if (!getEdge(graph, edgeId)) return fail({ code: 'EDGE_NOT_FOUND', edgeId });
  return ok({ ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) });
}

/**
 * Define o rótulo do vértice. O texto passa por `trim()` e, depois disso, precisa ter de 1 a
 * `MAX_VERTEX_LABEL_LENGTH` pontos de código. Rótulos repetidos entre vértices são permitidos.
 * Preserva o id, a posição e as conexões; se o rótulo final é o atual, devolve o mesmo grafo.
 * Validações, em ordem: vértice existe → rótulo válido.
 */
export function setVertexLabel(graph: Graph, vertexId: VertexId, label: string): Result<Graph> {
  const vertex = getVertex(graph, vertexId);
  if (!vertex) return fail({ code: 'VERTEX_NOT_FOUND', vertexId });
  const normalized = normalizeLabel(label);
  if (!normalized.ok) return normalized;
  if (normalized.value === vertex.label) return ok(graph);
  return ok({
    ...graph,
    vertices: graph.vertices.map((v) => (v === vertex ? { ...v, label: normalized.value } : v)),
  });
}

/**
 * Define o peso da aresta; `undefined` remove o peso (aresta não ponderada). Remover o peso é
 * diferente de definir peso 0: `0` é um peso válido e `undefined` deixa a aresta sem peso.
 * `null`, `NaN`, `±Infinity` e não-números → `INVALID_WEIGHT`; `-0` é normalizado para `0`.
 * Preserva o id, os extremos, a orientação e a posição; se o peso final é o atual, devolve o
 * mesmo grafo. Validações, em ordem: aresta existe → peso válido.
 */
export function setEdgeWeight(
  graph: Graph,
  edgeId: EdgeId,
  weight: number | undefined,
): Result<Graph> {
  const edge = getEdge(graph, edgeId);
  if (!edge) return fail({ code: 'EDGE_NOT_FOUND', edgeId });
  if (weight !== undefined && !isValidWeight(weight)) {
    return fail({ code: 'INVALID_WEIGHT', weight });
  }
  const next = weight === undefined ? undefined : normalizeWeight(weight);
  if (next === edge.weight) return ok(graph);
  return ok({
    ...graph,
    edges: graph.edges.map((e) => (e === edge ? withWeight(e, next) : e)),
  });
}

function connects(directed: boolean, edge: Edge, source: VertexId, target: VertexId): boolean {
  if (edge.source === source && edge.target === target) return true;
  return !directed && edge.source === target && edge.target === source;
}

// As regras de peso (`isValidWeight`, `normalizeWeight`) e de rótulo (`checkLabel`) são exportadas deste módulo, mas
// NÃO por `index.ts`: o leitor de documentos (`deserialization.ts`) usa exatamente as mesmas, para não existirem
// duas versões do que é um peso ou um rótulo válido.

export function isValidWeight(weight: unknown): weight is number {
  return typeof weight === 'number' && Number.isFinite(weight);
}

/** `-0` vira `0` para que a igualdade estrutural não distinga os dois zeros. */
export function normalizeWeight(weight: number): number {
  return weight === 0 ? 0 : weight;
}

/** Cópia da aresta com o peso dado, ou sem o campo `weight` se `undefined`; os demais campos seguem iguais. */
function withWeight(edge: Edge, weight: number | undefined): Edge {
  const { weight: _previous, ...rest } = edge;
  return weight === undefined ? rest : { ...rest, weight };
}

export type LabelCheck =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: InvalidLabelReason };

/**
 * Aplica `trim()` e valida o tamanho (em pontos de código). Devolve o rótulo normalizado ou o motivo da recusa.
 * Um ponto de código ocupa no máximo 2 unidades UTF-16: acima de 2·MAX unidades o rótulo já passa do limite, e
 * essa checagem barata evita montar a lista de pontos de código de um texto enorme (documento hostil).
 */
export function checkLabel(label: unknown): LabelCheck {
  if (typeof label !== 'string') return { ok: false, reason: 'NOT_A_STRING' };
  const trimmed = label.trim();
  if (trimmed === '') return { ok: false, reason: 'EMPTY' };
  if (
    trimmed.length > 2 * MAX_VERTEX_LABEL_LENGTH ||
    Array.from(trimmed).length > MAX_VERTEX_LABEL_LENGTH
  ) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, label: trimmed };
}

function normalizeLabel(label: unknown): Result<string> {
  const checked = checkLabel(label);
  return checked.ok
    ? ok(checked.label)
    : fail({ code: 'INVALID_VERTEX_LABEL', label, reason: checked.reason });
}
