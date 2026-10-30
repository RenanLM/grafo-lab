// Apoio aos testes do domínio (nada aqui é importado pelo código de produção).
import { addEdge, addVertex, createGraph, type Graph, type Result } from './index';

/** Congela o grafo inteiro: qualquer mutação nas operações vira TypeError (módulos são strict). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

export function errorOf(result: Result<unknown>) {
  if (result.ok) throw new Error('esperava erro, mas a operação teve sucesso');
  return result.error;
}

/** Grafo congelado com os vértices v1..vN (rótulos A, B, C…). */
export function withVertices(count: number, directed = false): Graph {
  let graph = deepFreeze(createGraph({ id: 'g', directed }));
  for (let i = 0; i < count; i++) graph = deepFreeze(addVertex(graph).graph);
  return graph;
}

export function connect(graph: Graph, source: string, target: string, weight?: number): Graph {
  return deepFreeze(must(addEdge(graph, { source, target, weight })).graph);
}

/** Grafo congelado com `count` vértices (v1..vN) e as arestas criadas na ordem dada. */
export function graphOf(
  count: number,
  edges: readonly (readonly [string, string])[],
  directed = false,
): Graph {
  return edges.reduce(
    (graph, [source, target]) => connect(graph, source, target),
    withVertices(count, directed),
  );
}
