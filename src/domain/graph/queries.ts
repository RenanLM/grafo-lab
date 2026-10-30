import { fail, ok, type Result } from './errors';
import { getVertex } from './graph';
import type { Edge, Graph, VertexId } from './types';

// Consultas de grau e vizinhança. Todas são puras e não alteram o grafo.
//
// Convenções (valem para todo o módulo):
// - Vértice inexistente → `Result` com `VERTEX_NOT_FOUND` (devolver 0 confundiria "inexistente" com "isolado").
// - Listas de vértices vêm sempre na ordem de inserção dos vértices do grafo, nunca na ordem de criação
//   das arestas; assim o desempate dos algoritmos não muda se o aluno apagar e recriar uma aresta.
// - Em grafo NÃO orientado, cada aresta vale nos dois sentidos (equivale a dois arcos opostos):
//   `successors` = `predecessors` = `neighbors`, e `inDegree` = `outDegree` = `degree`.
// - Em grafo orientado, `neighbors` é a união de sucessores e predecessores, sem repetir. Por isso
//   `degree` pode superar `neighbors.length`: os arcos u→v e v→u contam 2 no grau e 1 na vizinhança.
// - Custo: cada consulta de um vértice percorre as arestas uma vez e depois ordena pelos vértices
//   (O(V + E)); `isolatedVertices` também é O(V + E).

/**
 * Grau do vértice: número de arestas incidentes. Em grafo orientado é `inDegree + outDegree`.
 * Como o grafo é simples (sem laços), nenhuma aresta é contada duas vezes.
 */
export function degree(graph: Graph, vertexId: VertexId): Result<number> {
  return ifVertexExists(graph, vertexId, () => countEdges(graph, (edge) => touches(edge, vertexId)));
}

/** Grau de entrada: arcos que chegam ao vértice. Em grafo não orientado vale o próprio grau. */
export function inDegree(graph: Graph, vertexId: VertexId): Result<number> {
  return ifVertexExists(graph, vertexId, () =>
    countEdges(graph, (edge) => (graph.directed ? edge.target === vertexId : touches(edge, vertexId))),
  );
}

/** Grau de saída: arcos que partem do vértice. Em grafo não orientado vale o próprio grau. */
export function outDegree(graph: Graph, vertexId: VertexId): Result<number> {
  return ifVertexExists(graph, vertexId, () =>
    countEdges(graph, (edge) => (graph.directed ? edge.source === vertexId : touches(edge, vertexId))),
  );
}

/** Vértices adjacentes. Em grafo orientado, sucessores e predecessores juntos, sem repetição. */
export function neighbors(graph: Graph, vertexId: VertexId): Result<VertexId[]> {
  return ifVertexExists(graph, vertexId, () => {
    const ids = new Set<VertexId>();
    for (const edge of graph.edges) {
      if (edge.source === vertexId) ids.add(edge.target);
      else if (edge.target === vertexId) ids.add(edge.source);
    }
    return inVertexOrder(graph, ids);
  });
}

/** Destinos dos arcos que partem do vértice. Em grafo não orientado, são os vizinhos. */
export function successors(graph: Graph, vertexId: VertexId): Result<VertexId[]> {
  return ifVertexExists(graph, vertexId, () => {
    const ids = new Set<VertexId>();
    for (const edge of graph.edges) {
      if (edge.source === vertexId) ids.add(edge.target);
      else if (!graph.directed && edge.target === vertexId) ids.add(edge.source);
    }
    return inVertexOrder(graph, ids);
  });
}

/** Origens dos arcos que chegam ao vértice. Em grafo não orientado, são os vizinhos. */
export function predecessors(graph: Graph, vertexId: VertexId): Result<VertexId[]> {
  return ifVertexExists(graph, vertexId, () => {
    const ids = new Set<VertexId>();
    for (const edge of graph.edges) {
      if (edge.target === vertexId) ids.add(edge.source);
      else if (!graph.directed && edge.source === vertexId) ids.add(edge.target);
    }
    return inVertexOrder(graph, ids);
  });
}

/** Vértice isolado: sem nenhuma aresta incidente (grau 0, tanto em entrada quanto em saída). */
export function isIsolated(graph: Graph, vertexId: VertexId): Result<boolean> {
  return ifVertexExists(graph, vertexId, () => !graph.edges.some((edge) => touches(edge, vertexId)));
}

/** Todos os vértices isolados, na ordem de inserção. Grafo vazio → lista vazia. */
export function isolatedVertices(graph: Graph): VertexId[] {
  const touched = new Set<VertexId>();
  for (const edge of graph.edges) {
    touched.add(edge.source);
    touched.add(edge.target);
  }
  return graph.vertices.filter((vertex) => !touched.has(vertex.id)).map((vertex) => vertex.id);
}

function ifVertexExists<T>(graph: Graph, vertexId: VertexId, compute: () => T): Result<T> {
  return getVertex(graph, vertexId)
    ? ok(compute())
    : fail({ code: 'VERTEX_NOT_FOUND', vertexId });
}

function touches(edge: Edge, vertexId: VertexId): boolean {
  return edge.source === vertexId || edge.target === vertexId;
}

function countEdges(graph: Graph, predicate: (edge: Edge) => boolean): number {
  let count = 0;
  for (const edge of graph.edges) if (predicate(edge)) count++;
  return count;
}

function inVertexOrder(graph: Graph, ids: ReadonlySet<VertexId>): VertexId[] {
  const ordered: VertexId[] = [];
  for (const vertex of graph.vertices) if (ids.has(vertex.id)) ordered.push(vertex.id);
  return ordered;
}
