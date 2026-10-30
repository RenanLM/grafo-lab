import { fail, ok, type Result } from './errors';
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

export function addVertex(graph: Graph, label?: string): { graph: Graph; vertex: Vertex } {
  const vertex: Vertex = {
    id: `v${graph.nextVertexSeq}`,
    label: label ?? defaultLabel(graph.nextVertexSeq),
  };
  return {
    graph: {
      ...graph,
      vertices: [...graph.vertices, vertex],
      nextVertexSeq: graph.nextVertexSeq + 1,
    },
    vertex,
  };
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
    // `-0` vira `0` para que a igualdade estrutural não distinga os dois zeros.
    ...(weight !== undefined && { weight: weight === 0 ? 0 : weight }),
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

function connects(directed: boolean, edge: Edge, source: VertexId, target: VertexId): boolean {
  if (edge.source === source && edge.target === target) return true;
  return !directed && edge.source === target && edge.target === source;
}

function isValidWeight(weight: unknown): weight is number {
  return typeof weight === 'number' && Number.isFinite(weight);
}
