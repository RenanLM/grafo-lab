import type { Edge, EdgeId, Graph, VertexId } from './types';

// Lista de incidência: para cada vértice, as ARESTAS que incidem nele. Não confundir com a lista de adjacência:
// lá o objeto de cada entrada é o vizinho (e as entradas seguem a ordem dos vértices); aqui o objeto é a
// aresta (`edgeId`), o vizinho é só um atributo dela (`oppositeVertexId`) e as entradas seguem a ordem de
// inserção das ARESTAS.
//
// - Derivada do `Graph`, sem estado: depois de editar o grafo, chame `incidenceList` de novo. Só usa IDs, então
//   mudar um rótulo não altera o resultado.
// - `rows[i]` pertence a `vertexIds[i]` (a mesma ordem de inserção dos vértices, inclusive os isolados). Dentro de
//   cada linha, as entradas seguem a ordem de inserção das arestas: é a ordem das colunas de `incidenceMatrix`,
//   então as entradas da linha i correspondem às células não nulas da linha i da matriz, da esquerda para a direita.
// - Cada aresta aparece exatamente uma vez na linha de CADA extremo (2E entradas no total: não há laços).
// - Papéis: grafo orientado → `outgoing` na origem e `incoming` no destino (correspondem a +1 e −1 na matriz de
//   incidência, segundo a convenção do livro-texto, §2.1, p. 20); grafo não orientado → `undirected` nos dois
//   extremos (+1 nos dois, na matriz).
// - `oppositeVertexId` é o OUTRO extremo da aresta. Arcos opostos (u→v e v→u) são arestas diferentes, com
//   `edgeId` próprio: cada um aparece nas duas linhas com papéis complementares.
// - Peso copiado sem conversão: ausente (aresta sem peso, **não** vira 1), zero ou negativo.
// - Cada entrada é um objeto próprio (as duas entradas de uma aresta não são compartilhadas) e cada linha é um
//   array próprio, então não há aliasing entre entradas, linhas ou com o grafo.
//
// Complexidade (V = vértices, E = arestas; 2E entradas, pois o modelo não tem laços):
// - Tempo: Θ(V + E). `Map` de posições Θ(V); uma única passada pelas arestas, com duas inserções O(1) cada, Θ(E);
//   listas de ids Θ(V). A busca no `Map` é O(1) esperada (tabela hash), não de pior caso. Não há ordenação: ler as
//   arestas em ordem de inserção já deixa cada linha ordenada.
// - Espaço: Θ(V + E): V linhas e 2E entradas na saída, mais o `Map` Θ(V) como auxiliar.
// - Consulta das incidências de um vértice: O(d(v)) depois de localizar a linha (a linha i é o i-ésimo vértice;
//   achar o índice por id é O(V) com `indexOf`, ou O(1) com um `Map` do consumidor, montado em Θ(V)).

/** Papel do vértice dono da linha em relação à aresta da entrada. */
export type IncidenceRole = 'incoming' | 'outgoing' | 'undirected';

export type IncidenceListEntry = {
  readonly edgeId: EdgeId;
  /** O OUTRO extremo da aresta (não o dono da linha). */
  readonly oppositeVertexId: VertexId;
  readonly role: IncidenceRole;
  /** Peso copiado sem conversão. Ausente = aresta sem peso (**não** vira 1); `0` e negativos são pesos. */
  readonly weight?: number;
};

export type IncidenceList = {
  /** Vértice de cada linha, na ordem de inserção dos vértices. */
  readonly vertexIds: readonly VertexId[];
  /** `rows[i]`: arestas incidentes a `vertexIds[i]`, na ordem de inserção das arestas. */
  readonly rows: readonly (readonly IncidenceListEntry[])[];
};

export function incidenceList(graph: Graph): IncidenceList {
  const { vertices, edges, directed } = graph;

  const position = new Map<VertexId, number>();
  vertices.forEach((vertex, index) => position.set(vertex.id, index));

  const rows: IncidenceListEntry[][] = vertices.map(() => []);
  for (const edge of edges) {
    // Invariante de `Graph`: toda aresta liga vértices existentes, então `position.get` nunca falha.
    const source = position.get(edge.source)!;
    const target = position.get(edge.target)!;
    rows[source]!.push(entryFor(edge, edge.target, directed ? 'outgoing' : 'undirected'));
    rows[target]!.push(entryFor(edge, edge.source, directed ? 'incoming' : 'undirected'));
  }

  return { vertexIds: vertices.map((vertex) => vertex.id), rows };
}

function entryFor(edge: Edge, oppositeVertexId: VertexId, role: IncidenceRole): IncidenceListEntry {
  return {
    edgeId: edge.id,
    oppositeVertexId,
    role,
    ...(edge.weight !== undefined && { weight: edge.weight }),
  };
}
