import { addEdge, addVertex, createGraph, fail, type Graph, type Result, type VertexId } from '@/domain/graph';

// Grafo de exemplo da tela Laboratório (Fase 3, incremento 3.5), montado SÓ com as operações oficiais do domínio e com cada
// `Result` conferido: se uma operação falhar, o erro do domínio é devolvido e nada é construído pela metade. O domínio não foi
// alterado para criar este exemplo.
//
// O grafo exercita, de uma vez, o que o renderizador precisa mostrar: direção, arcos opostos (A → B e B → A), aresta sem peso,
// peso zero, peso negativo e vértice isolado.
//
//   A → B                (sem peso)
//   B → A  peso 0        (arco oposto de A → B)
//   B → C  peso −2
//   C → A  peso 5
//   D                    (isolado)

export const EXAMPLE_GRAPH_ID = 'exemplo-orientado';
export const EXAMPLE_GRAPH_NAME = 'Exemplo orientado';

const LABELS = ['A', 'B', 'C', 'D'] as const;

/** Origem e destino por RÓTULO (os ids vêm do domínio) e o peso opcional. */
const EDGES: readonly (readonly [source: string, target: string, weight?: number])[] = [
  ['A', 'B'],
  ['B', 'A', 0],
  ['B', 'C', -2],
  ['C', 'A', 5],
];

/** Monta o grafo de exemplo, ou devolve o primeiro erro do domínio. Θ(1): o tamanho é fixo (4 vértices e 4 arestas). */
export function buildExampleGraph(): Result<Graph> {
  let graph = createGraph({ id: EXAMPLE_GRAPH_ID, name: EXAMPLE_GRAPH_NAME, directed: true });
  const idByLabel = new Map<string, VertexId>();

  for (const label of LABELS) {
    const added = addVertex(graph, label);
    if (!added.ok) return added;
    graph = added.value.graph;
    idByLabel.set(label, added.value.vertex.id);
  }

  for (const [from, to, weight] of EDGES) {
    const source = idByLabel.get(from);
    const target = idByLabel.get(to);
    if (source === undefined) return fail({ code: 'VERTEX_NOT_FOUND', vertexId: from });
    if (target === undefined) return fail({ code: 'VERTEX_NOT_FOUND', vertexId: to });
    const added = addEdge(graph, { source, target, weight });
    if (!added.ok) return added;
    graph = added.value.graph;
  }

  return { ok: true, value: graph };
}
