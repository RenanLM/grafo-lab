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
  for (let i = 0; i < count; i++) graph = deepFreeze(must(addVertex(graph)).graph);
  return graph;
}

export function connect(graph: Graph, source: string, target: string, weight?: number): Graph {
  return deepFreeze(must(addEdge(graph, { source, target, weight })).graph);
}

/** Gerador pseudoaleatório determinístico (mulberry32): a mesma semente repete a mesma sequência. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIGHTS = [undefined, 0, -3, 2.5, 7];

/**
 * Grafo simples, congelado e reproduzível (mesma semente → mesmo grafo): 0 a `maxVertices` vértices,
 * densidade aleatória, arestas criadas em ordem embaralhada (e, no não orientado, com extremos em ordem
 * aleatória) e pesos entre ausente, zero, negativo e positivos.
 */
export function randomGraph(seed: number, directed: boolean, maxVertices = 9): Graph {
  const random = seededRandom(seed);
  const count = Math.floor(random() * (maxVertices + 1));

  const pairs: [string, string][] = [];
  for (let i = 1; i <= count; i++) {
    for (let j = 1; j <= count; j++) {
      if (i === j || (!directed && i > j)) continue;
      pairs.push(!directed && random() < 0.5 ? [`v${j}`, `v${i}`] : [`v${i}`, `v${j}`]);
    }
  }
  for (let i = pairs.length - 1; i > 0; i--) {
    const k = Math.floor(random() * (i + 1));
    [pairs[i], pairs[k]] = [pairs[k]!, pairs[i]!];
  }

  const density = random();
  let graph = withVertices(count, directed);
  for (const [source, target] of pairs) {
    if (random() >= density) continue;
    graph = connect(graph, source, target, WEIGHTS[Math.floor(random() * WEIGHTS.length)]);
  }
  return graph;
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

// Grafos de referência compartilhados pelos testes das representações. As arestas são criadas de propósito
// FORA da ordem dos vértices, para provar que os resultados seguem a ordem dos vértices.

/** Não orientado: triângulo v1-v2-v3, haste v3-v4 e v5 isolado. Arestas: e1 v3-v4, e2 v3-v1, e3 v3-v2, e4 v2-v1. */
export const triangleWithTail = graphOf(5, [
  ['v3', 'v4'],
  ['v3', 'v1'],
  ['v3', 'v2'],
  ['v2', 'v1'],
]);

/**
 * Orientado, 6 vértices (v5 isolado). Arcos: e1 v4→v1, e2 v3→v1, e3 v1→v3, e4 v2→v3, e5 v1→v2, e6 v3→v6.
 * Há arcos opostos (v1→v3 e v3→v1), uma fonte (v4) e um sorvedouro (v6).
 */
export const digraphWithOpposites = graphOf(
  6,
  [
    ['v4', 'v1'],
    ['v3', 'v1'],
    ['v1', 'v3'],
    ['v2', 'v3'],
    ['v1', 'v2'],
    ['v3', 'v6'],
  ],
  true,
);

/** Não orientado com os três estados de peso: e1 v1-v2 sem peso, e2 v2-v3 peso 0, e3 v3-v4 peso −2,5, e4 v1-v4 peso 7. */
export const weightedGraph = (() => {
  let graph = withVertices(4);
  graph = connect(graph, 'v1', 'v2');
  graph = connect(graph, 'v2', 'v3', 0);
  graph = connect(graph, 'v3', 'v4', -2.5);
  return connect(graph, 'v1', 'v4', 7);
})();

/** Orientado: e1 v1→v2 peso 0, e2 v2→v1 peso −1 (arco oposto, outro peso), e3 v2→v3 sem peso. */
export const weightedDigraph = (() => {
  let graph = withVertices(3, true);
  graph = connect(graph, 'v1', 'v2', 0);
  graph = connect(graph, 'v2', 'v1', -1);
  return connect(graph, 'v2', 'v3');
})();
