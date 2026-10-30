import type { EdgeId, Graph, VertexId } from './types';

// Matriz de incidência (vértice × aresta): `cells[i][j]` diz como o vértice `vertexIds[i]` se relaciona com a
// aresta `edgeIds[j]`.
//
// Convenção de sinais (a do livro-texto da disciplina: Boaventura Netto & Jurkiewicz, *Grafos: Introdução e
// Prática*, seção 2.1, p. 20 impressa; ver docs/REFERENCIAS.md):
// - Grafo orientado: o vértice de SAÍDA do arco (a origem) recebe +1 e o de ENTRADA (o destino) recebe −1.
// - Grafo não orientado: as duas pontas recebem +1 (não há sentido).
// - Qualquer outra célula vale 0 = o vértice não é extremo da aresta.
// Outras fontes podem inverter os sinais; a interface deve mostrar uma legenda.
//
// Decisões:
// - Linhas na ordem de inserção dos vértices e colunas na ordem de inserção das arestas (o livro usa a ordem
//   lexicográfica dos pares, mas diz que a ordem não é obrigatória).
// - Arcos opostos (u→v e v→u) são arestas diferentes e ocupam colunas diferentes, com sinais trocados.
// - Pesos NÃO fazem parte desta matriz (ela só descreve incidência). Editar rótulo ou peso não a altera.
// - Derivada do `Graph`, sem estado: depois de editar o grafo, chame `incidenceMatrix` de novo. As células são
//   números primitivos e cada linha é um array próprio, então não há aliasing entre posições nem com o grafo.
// - Grafo sem arestas: uma linha vazia (`[]`) por vértice. Grafo vazio: `vertexIds`, `edgeIds` e `cells` vazios.
//
// Complexidade (V = vértices, E = arestas; a matriz é densa, com apenas 2E células não nulas):
// - CONSTRUÇÃO — tempo Θ(V + V·E): `Map` de posições Θ(V); alocar e zerar V linhas de E células Θ(V·E); marcar
//   as 2E células não nulas Θ(E); listas de ids Θ(V + E). Para E ≥ 1 isso é Θ(V·E). A busca no `Map` é O(1)
//   esperada.
// - ESPAÇO — Θ(V + V·E) (Θ(V·E) para E ≥ 1). Em grafo simples E pode chegar a V(V−1)/2 (não orientado) ou
//   V(V−1) (orientado), então no pior caso a matriz custa Θ(V³): o tamanho é o produto V·E, não só V.
// - CONSULTAS DEPOIS DE CONSTRUÍDA (custo diferente do da construção):
//   · uma célula: O(1) dados os índices (obter o índice por id é O(V) ou O(E) com `indexOf`; um `Map` do
//     consumidor dá O(1) depois de Θ(V) ou Θ(E) para montar);
//   · grau de um vértice, pela linha: O(E);
//   · extremos de uma aresta, pela coluna: O(V);
//   · vizinhos de um vértice por varredura: O(E + d(v)·V) — a linha dá as d(v) arestas incidentes em O(E) e cada
//     coluna custa O(V) para achar a outra ponta. A lista de adjacência dá os vizinhos em O(d(v)).

/** Valor de uma célula: 1 e −1 marcam extremos (ver a convenção acima); 0 = sem incidência. */
export type IncidenceValue = -1 | 0 | 1;

export type IncidenceMatrix = {
  /** Vértice de cada linha, na ordem de inserção dos vértices. */
  readonly vertexIds: readonly VertexId[];
  /** Aresta de cada coluna, na ordem de inserção das arestas. */
  readonly edgeIds: readonly EdgeId[];
  /** `cells[i][j]`: relação do vértice `vertexIds[i]` com a aresta `edgeIds[j]`. */
  readonly cells: readonly (readonly IncidenceValue[])[];
};

export function incidenceMatrix(graph: Graph): IncidenceMatrix {
  const { vertices, edges, directed } = graph;

  const position = new Map<VertexId, number>();
  vertices.forEach((vertex, index) => position.set(vertex.id, index));

  const cells = vertices.map(() => new Array<IncidenceValue>(edges.length).fill(0));
  edges.forEach((edge, column) => {
    // Invariante de `Graph`: toda aresta liga vértices existentes, então `position.get` nunca falha.
    const source = position.get(edge.source)!;
    const target = position.get(edge.target)!;
    cells[source]![column] = 1;
    cells[target]![column] = directed ? -1 : 1;
  });

  return {
    vertexIds: vertices.map((vertex) => vertex.id),
    edgeIds: edges.map((edge) => edge.id),
    cells,
  };
}
