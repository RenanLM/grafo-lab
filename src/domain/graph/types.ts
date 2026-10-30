/** Versão do formato dos dados de um grafo (reservada para a serialização e suas migrações). */
export const GRAPH_SCHEMA_VERSION = 1;

export type VertexId = string;
export type EdgeId = string;

export type Vertex = {
  readonly id: VertexId;
  /**
   * Texto exibido ao aluno. Não precisa ser único: a identidade do vértice é o `id`.
   * Quando informado (`addVertex`, `setVertexLabel`), tem de 1 a 64 pontos de código e nenhum espaço nas pontas.
   */
  readonly label: string;
};

export type Edge = {
  readonly id: EdgeId;
  /**
   * Em grafos orientados a aresta é o arco `source → target`. Em não orientados a ordem
   * apenas registra como a aresta foi criada: `{source, target}` é um par não ordenado.
   */
  readonly source: VertexId;
  readonly target: VertexId;
  /** Ausente = aresta não ponderada. Presente = número finito (0 e negativos são válidos). */
  readonly weight?: number;
};

/**
 * Grafo simples, imutável, orientado ou não (a orientação vale para o grafo todo).
 *
 * Invariantes mantidas pelas operações deste módulo:
 * - não há laços nem arestas repetidas (no sentido da orientação);
 * - toda aresta liga dois vértices existentes;
 * - `id`s de vértices e de arestas são únicos e **nunca reaproveitados** depois de uma remoção;
 * - `vertices` e `edges` ficam na ordem de inserção (desempate estável para os algoritmos).
 *
 * A posição dos vértices na tela não faz parte do grafo.
 */
export type Graph = {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly directed: boolean;
  readonly vertices: readonly Vertex[];
  readonly edges: readonly Edge[];
  /** Próximo número de sequência a emitir em `v<n>`. Só cresce, o que garante IDs estáveis. */
  readonly nextVertexSeq: number;
  /** Próximo número de sequência a emitir em `e<n>`. Só cresce. */
  readonly nextEdgeSeq: number;
};
