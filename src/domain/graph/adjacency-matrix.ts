import type { Edge, EdgeId, Graph, VertexId } from './types';
import { weightField } from './weight';

// Matriz de adjacência estrutural: `cells[i][j]` descreve a aresta de `vertexIds[i]` para `vertexIds[j]`.
//
// - É derivada do `Graph` e não guarda estado: depois de editar o grafo, chame `adjacencyMatrix` de novo.
//   Só usa IDs, então mudar um rótulo não altera o resultado.
// - Linhas e colunas na ordem de inserção dos vértices (`vertexIds`), independentemente da ordem das arestas.
// - Cada célula tem UM destes três estados, e eles nunca são confundidos:
//     `null`                         → não há aresta;
//     `{ edgeId }`                   → há aresta SEM peso (o peso 1 não é inventado);
//     `{ edgeId, weight }`           → há aresta com peso, inclusive `0` e negativos.
// - A diagonal é sempre `null`: o modelo só tem grafos simples (sem laços).
// - Não orientado: a matriz é simétrica, `cells[i][j]` e `cells[j][i]` descrevem a mesma aresta (mesmo
//   `edgeId` e peso). Orientado: `cells[i][j]` é o arco i→j, independente de `cells[j][i]`; os arcos opostos
//   têm `edgeId`s (e pesos) próprios, e a matriz pode ser simétrica ou assimétrica conforme os arcos.
//
// Imutabilidade: `readonly` só vale em tempo de compilação e o domínio não congela objetos em execução,
// então um objeto compartilhado entre `cells[i][j]` e `cells[j][i]` NÃO seria efetivamente imutável (um cast
// permitiria alterar uma célula e, sem querer, a simétrica). Por isso cada posição recebe um objeto próprio,
// e cada linha é um array próprio.
//
// Complexidade (V = vértices, E = arestas; num grafo simples E ≤ V², logo E = O(V²)):
// - Tempo: Θ(V²). Alocar e preencher a grade com `null` custa Θ(V²) mesmo em grafo esparso; o índice dos
//   vértices custa Θ(V) e o preenchimento das células custa Θ(E). Em notação de soma, O(V² + E) = Θ(V²).
//   A busca no `Map` do índice é O(1) esperada.
// - Espaço: Θ(V²) para as V linhas de V posições, mais Θ(E) objetos de célula (2E se não orientado, por não
//   haver compartilhamento), que cabem em O(V²). Não depende de E para a grade: grafo esparso paga V².
// - Consulta de uma célula: O(1) depois de obter os índices dos dois vértices (`vertexIds.indexOf(id)` é O(V);
//   um `Map` id → posição do consumidor é Θ(V) para montar e O(1) por consulta).
// - Vizinhos de um vértice: O(V), varrendo a linha (a lista de adjacência dá O(grau)).

/** Uma aresta vista como célula da matriz. Ausente = sem peso; `0` e negativos são pesos. */
export type AdjacencyCell = {
  readonly edgeId: EdgeId;
  /** Peso copiado sem conversão: ausente (aresta sem peso, **não** vira 1), zero ou qualquer finito. */
  readonly weight?: number;
};

export type AdjacencyMatrix = {
  /** Vértice de cada linha e de cada coluna, na ordem de inserção dos vértices. */
  readonly vertexIds: readonly VertexId[];
  /** `cells[i][j]`: aresta de `vertexIds[i]` para `vertexIds[j]`, ou `null` se não existe. */
  readonly cells: readonly (readonly (AdjacencyCell | null)[])[];
};

export function adjacencyMatrix(graph: Graph): AdjacencyMatrix {
  const { vertices, edges, directed } = graph;
  const count = vertices.length;

  const position = new Map<VertexId, number>();
  vertices.forEach((vertex, index) => position.set(vertex.id, index));

  const cells = vertices.map(() => new Array<AdjacencyCell | null>(count).fill(null));
  for (const edge of edges) {
    // Invariante de `Graph`: toda aresta liga vértices existentes, então `position.get` nunca falha.
    const source = position.get(edge.source)!;
    const target = position.get(edge.target)!;
    cells[source]![target] = cellFor(edge);
    if (!directed) cells[target]![source] = cellFor(edge);
  }

  return { vertexIds: vertices.map((vertex) => vertex.id), cells };
}

// Projeção numérica
//
// `adjacencyAsNumbers` LÊ a matriz estrutural como números; não é outra representação do grafo e **não é
// reversível**. A projeção:
// - descarta o `edgeId`;
// - pode juntar estados que a matriz estrutural separa, quando as opções coincidem com pesos reais (por
//   exemplo `absent: 0` com uma aresta de peso zero, ou `unweighted: 1` com uma aresta de peso 1). Para
//   recuperar os três estados (sem aresta / sem peso / com peso) use sempre a matriz estrutural.
// - preserva pesos arbitrários (zero, negativos, fracionários); por isso o resultado NÃO é, em geral, uma
//   matriz binária. Só contém apenas 0 e 1 quando o grafo não tem pesos e as opções são `absent: 0`,
//   `unweighted: 1` (a leitura do livro-texto para grafos sem valores; ver docs/REFERENCIAS.md).
// - não decide nada sobre a diagonal: as células da diagonal são `null`, logo valem `absent`. Algoritmos que
//   exigem distância 0 de um vértice a si mesmo devem ajustar a diagonal por conta própria.
// Custo: Θ(V²) em tempo e em espaço (a saída é uma grade V × V de números).

/** Escolhas do chamador para ler a matriz estrutural como números. As duas são obrigatórias. */
export type AdjacencyNumericOptions = {
  /** Valor das posições sem aresta (`null`), inclusive a diagonal. Aceita qualquer número, como `Infinity`. */
  readonly absent: number;
  /** Valor das arestas sem peso explícito. Arestas com peso (inclusive `0` e negativos) mantêm o próprio peso. */
  readonly unweighted: number;
};

/**
 * Lê a matriz de adjacência como uma grade de números (nova a cada chamada; a matriz recebida não é
 * alterada): `null` → `absent`; aresta sem peso → `unweighted`; aresta com peso → o peso.
 * Ver o aviso sobre perda de informação acima.
 */
export function adjacencyAsNumbers(
  matrix: AdjacencyMatrix,
  options: AdjacencyNumericOptions,
): number[][] {
  const { absent, unweighted } = options;
  return matrix.cells.map((row) =>
    row.map((cell) => (cell === null ? absent : (cell.weight ?? unweighted))),
  );
}

function cellFor(edge: Edge): AdjacencyCell {
  return { edgeId: edge.id, ...weightField(edge) };
}
