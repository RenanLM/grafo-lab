import type { Edge, EdgeId, Graph, VertexId } from './types';
import { weightField } from './weight';

// Lista de adjacência: uma linha por vértice, com as arestas que partem dele.
//
// - A lista é derivada do `Graph` e **não** guarda estado: depois de editar o grafo (rótulo, peso, aresta),
//   chame `adjacencyList` de novo. Só usa IDs, então mudar um rótulo não altera o resultado.
// - Linhas na ordem de inserção dos vértices; entradas de cada linha também na ordem de inserção dos
//   vértices vizinhos (a mesma ordem de `successors`), nunca na ordem de criação das arestas.
// - Orientado: a linha de `u` lista só os arcos que SAEM de `u`. Não orientado: cada aresta aparece nas duas
//   linhas, com o mesmo `edgeId` e o mesmo peso.
//
// Complexidade (V = vértices, E = arestas, A = arcos listados: A = E se orientado, A = 2E se não orientado):
// - Tempo: Θ(V + E). Índice dos vértices Θ(V); distribuição dos arcos em baldes Θ(E); varredura dos baldes
//   e montagem das linhas Θ(V + A). Não há ordenação por comparação (seria Θ(E log E)): a ordem dos vizinhos
//   sai de um *counting sort*, pois os baldes são lidos em ordem crescente de posição do vizinho.
//   A busca no `Map` é O(1) esperada (tabela hash), não de pior caso.
// - Espaço: Θ(V + E). Saída: V linhas e A entradas. Auxiliar: o `Map` Θ(V) e os baldes Θ(V + A), liberados ao
//   final. Como A ≤ 2E, o total é Θ(V + E).
// - Uso depois de pronta: vizinhos de uma linha em O(grau); achar a linha de um id exige um índice do
//   consumidor (a linha i é o i-ésimo vértice), porque a lista é um array.

/** Uma aresta vista a partir de uma das pontas. */
export type AdjacencyEntry = {
  /** O OUTRO extremo da aresta: o vizinho (não orientado) ou o sucessor (orientado). */
  readonly vertexId: VertexId;
  readonly edgeId: EdgeId;
  /**
   * Peso da aresta, copiado sem conversão. Ausente = aresta sem peso (**não** vira 1);
   * `0` e valores negativos são pesos.
   */
  readonly weight?: number;
};

export type AdjacencyRow = {
  /** O vértice dono da linha. */
  readonly vertexId: VertexId;
  readonly entries: readonly AdjacencyEntry[];
};

export type AdjacencyList = readonly AdjacencyRow[];

/** Arco a ser listado na linha da posição `from` (o vizinho é o balde onde o arco está). */
type Arc = { readonly from: number; readonly edge: Edge };

export function adjacencyList(graph: Graph): AdjacencyList {
  const { vertices, edges, directed } = graph;

  const position = new Map<VertexId, number>();
  vertices.forEach((vertex, index) => position.set(vertex.id, index));

  // Passo 1 — balde por vértice vizinho: guarda os arcos que chegam a ele.
  // Invariante de `Graph`: toda aresta liga vértices existentes, então `position.get` nunca falha.
  const arcsInto: Arc[][] = vertices.map(() => []);
  for (const edge of edges) {
    const source = position.get(edge.source)!;
    const target = position.get(edge.target)!;
    arcsInto[target]!.push({ from: source, edge });
    if (!directed) arcsInto[source]!.push({ from: target, edge });
  }

  // Passo 2 — lê os baldes em ordem crescente de vizinho e distribui para as linhas; cada linha
  // recebe seus vizinhos já ordenados.
  const rows = vertices.map((vertex) => ({
    vertexId: vertex.id,
    entries: [] as AdjacencyEntry[],
  }));
  arcsInto.forEach((arcs, neighbor) => {
    const neighborId = vertices[neighbor]!.id;
    for (const { from, edge } of arcs) rows[from]!.entries.push(entryFor(neighborId, edge));
  });
  return rows;
}

function entryFor(vertexId: VertexId, edge: Edge): AdjacencyEntry {
  return {
    vertexId,
    edgeId: edge.id,
    ...weightField(edge),
  };
}
