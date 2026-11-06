import {
  adjacencyList,
  adjacencyMatrix,
  incidenceList,
  incidenceMatrix,
  type Edge,
  type EdgeId,
  type Graph,
  type IncidenceRole,
  type IncidenceValue,
  type Vertex,
  type VertexId,
} from '@/domain/graph';

import { formatWeight } from './scene';

// Adaptador de APRESENTAÇÃO das quatro representações (Fase 3, incremento 3.11). TypeScript puro: não conhece React, tela, câmera nem layout, e NÃO constrói nenhuma representação: chama as
// funções da Fase 2 (`adjacencyList`, `adjacencyMatrix`, `incidenceMatrix`, `incidenceList`) e transforma o que elas devolvem em um MODELO DE APRESENTAÇÃO (textos, legendas e descrições
// acessíveis já prontos). Nada aqui percorre as arestas de novo para refazer uma matriz: as células, as linhas e as colunas vêm do domínio, na ordem do domínio. O `Graph` só é lido para
// duas coisas que o domínio não carrega (por desenho, as representações só têm IDs): o RÓTULO de cada vértice e os EXTREMOS e o peso de cada aresta, para os textos e as legendas.
//
// Contrato. `buildRepresentationView(graph, kind, options)` calcula UMA representação (a do `kind` pedido) e devolve um modelo discriminado por `kind`; as outras três não são calculadas. O
// modelo é novo a cada chamada, nada é compartilhado com o grafo nem entre chamadas, e o grafo recebido não é alterado (congelado, funciona). Mesmo grafo e mesmo `kind` dão o mesmo resultado.
// Identidade: cada vértice é um `VertexRef` com o `id` técnico e o `label`; o texto exibido é `rótulo (id)`, então rótulos repetidos se distinguem pelo id, e nenhuma posição de array é identidade.
//
// Três estados que nunca se confundem, nas três representações que carregam peso: SEM PESO (a aresta existe e não tem peso; o peso 1 não é inventado), PESO ZERO (um peso, como outro qualquer) e
// PESO NEGATIVO ou positivo. Na matriz de adjacência: `—` não existe aresta, `×` existe aresta sem peso, `0` (ou outro número) existe aresta com esse peso. O zero NUNCA significa ausência aqui,
// o que difere da matriz binária tradicional (0 e 1 para ausência e presença): a legenda e uma nota dizem isso. Na matriz de incidência os valores são só estruturais (+1/-1 no orientado, 1/1 no
// não orientado, 0 fora), e o peso vai na descrição da aresta, separado dos valores.
//
// Limite de legibilidade (só visual; o domínio não impõe tamanho). Uma matriz de adjacência tem V × V células e a de incidência V × E. Antes de chamar o domínio, `buildRepresentationView` confere
// esse produto contra `maxMatrixCells` (padrão `REPRESENTATION_LIMITS.maxMatrixCells`, 400): se passar, devolve `status: 'too-large'` com a mensagem, as dimensões e a sugestão de lista, e a matriz
// NÃO é materializada. Nada é truncado em silêncio. As listas não têm limite no modelo (são Θ(V + E)); `listLines` e `pageLines` as dividem em páginas para a interface mostrar aos poucos e
// dizer quantas linhas faltam.
//
// Complexidade (V vértices, E arestas): lista de adjacência Θ(V + E) (domínio) mais Θ(V + E) de texto; lista de incidência Θ(V + E) e Θ(V + E); matriz de adjacência Θ(V²) (domínio) mais Θ(V²) de
// textos; matriz de incidência Θ(V·E) e Θ(V·E). A conferência do limite é O(1), e o índice de rótulos e de arestas, Θ(V + E).

/** As quatro representações, na ordem em que o painel as oferece. */
export const REPRESENTATION_KINDS = ['adjacency-list', 'adjacency-matrix', 'incidence-matrix', 'incidence-list'] as const;
export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number];

export const REPRESENTATION_TITLES: Readonly<Record<RepresentationKind, string>> = Object.freeze({
  'adjacency-list': 'Lista de adjacência',
  'adjacency-matrix': 'Matriz de adjacência',
  'incidence-matrix': 'Matriz de incidência',
  'incidence-list': 'Lista de incidência',
});

/** Limites de APRESENTAÇÃO, num só lugar. Não são limites do grafo. */
export const REPRESENTATION_LIMITS = Object.freeze({
  /** Células de uma matriz completa (V × V ou V × E) acima das quais ela não é materializada. */
  maxMatrixCells: 400,
  /** Linhas de uma lista mostradas de cada vez (cada vértice e cada entrada contam uma linha). */
  listPageLines: 60,
});

export type RepresentationViewOptions = {
  /** Substitui `REPRESENTATION_LIMITS.maxMatrixCells`. */
  readonly maxMatrixCells?: number;
};

export const ABSENT_SYMBOL = '—';
export const UNWEIGHTED_SYMBOL = '×';
export const NO_WEIGHT_TEXT = 'sem peso';

/** Um vértice como o painel o mostra: o id técnico e o rótulo, e os textos prontos. */
export type VertexRef = {
  readonly id: VertexId;
  readonly label: string;
  /** `rótulo (id)`. */
  readonly text: string;
  /** Para leitor de tela: `rótulo, vértice id`. */
  readonly spoken: string;
};

/** Um símbolo da legenda: como aparece, como um leitor de tela deve dizê-lo (o travessão e o sinal de vezes não se leem bem) e o que significa. */
export type LegendEntry = { readonly symbol: string; readonly spoken: string; readonly meaning: string };

export type MatrixSize = {
  readonly rows: number;
  readonly columns: number;
  readonly cells: number;
  /** `linhas × colunas`. */
  readonly text: string;
};

// --- Lista de adjacência --------------------------------------------------------------------------------------------------------------------------------------------------------------

export type AdjacencyListEntryView = {
  /** O OUTRO extremo da aresta (o vizinho, ou o sucessor no orientado). */
  readonly vertex: VertexRef;
  readonly edgeId: EdgeId;
  readonly weight: number | undefined;
  /** `sem peso` ou `peso 0`. */
  readonly weightText: string;
  /** `→ B (v2) | e1 | peso 0` (orientado) ou `— B (v2) | e1 | peso 0`. */
  readonly text: string;
  readonly description: string;
};

export type AdjacencyListRowView = {
  readonly vertex: VertexRef;
  readonly entries: readonly AdjacencyListEntryView[];
};

export type AdjacencyListView =
  | { readonly kind: 'adjacency-list'; readonly status: 'empty'; readonly directed: boolean; readonly message: string }
  | {
      readonly kind: 'adjacency-list';
      readonly status: 'ready';
      readonly directed: boolean;
      readonly rows: readonly AdjacencyListRowView[];
      /** Entradas no total (A = E no orientado, 2E no não orientado). */
      readonly entryCount: number;
      readonly notes: readonly string[];
    };

// --- Matriz de adjacência -------------------------------------------------------------------------------------------------------------------------------------------------------------

export type AdjacencyCellView =
  | { readonly state: 'absent'; readonly text: typeof ABSENT_SYMBOL; readonly description: string }
  | { readonly state: 'unweighted'; readonly text: typeof UNWEIGHTED_SYMBOL; readonly edgeId: EdgeId; readonly description: string }
  | { readonly state: 'weighted'; readonly text: string; readonly weight: number; readonly edgeId: EdgeId; readonly description: string };

export type AdjacencyMatrixRowView = {
  readonly vertex: VertexRef;
  readonly cells: readonly AdjacencyCellView[];
};

export type TooLargeMatrix = {
  readonly status: 'too-large';
  readonly size: MatrixSize;
  readonly limit: number;
  readonly message: string;
  readonly detail: string;
  readonly suggestion: string;
  readonly suggestedKind: RepresentationKind;
};

export type AdjacencyMatrixView =
  | { readonly kind: 'adjacency-matrix'; readonly status: 'empty'; readonly directed: boolean; readonly message: string }
  | ({ readonly kind: 'adjacency-matrix'; readonly directed: boolean } & TooLargeMatrix)
  | {
      readonly kind: 'adjacency-matrix';
      readonly status: 'ready';
      readonly directed: boolean;
      /** Cabeçalho das colunas (a mesma ordem das linhas). */
      readonly vertices: readonly VertexRef[];
      readonly rows: readonly AdjacencyMatrixRowView[];
      readonly size: MatrixSize;
      readonly legend: readonly LegendEntry[];
      readonly notes: readonly string[];
    };

// --- Matriz de incidência -------------------------------------------------------------------------------------------------------------------------------------------------------------

export type EdgeRef = {
  readonly id: EdgeId;
  readonly source: VertexRef;
  readonly target: VertexRef;
  readonly weight: number | undefined;
  readonly weightText: string;
  /** `A → B` (orientado) ou `A — B`. */
  readonly caption: string;
  /** `e1: de A (v1) para B (v2), peso 0`. */
  readonly description: string;
};

export type IncidenceCellView = {
  readonly value: IncidenceValue;
  /** `+1`, `-1`, `1` ou `0`. */
  readonly text: string;
  readonly description: string;
};

export type IncidenceMatrixRowView = {
  readonly vertex: VertexRef;
  readonly cells: readonly IncidenceCellView[];
};

export type IncidenceMatrixView =
  | { readonly kind: 'incidence-matrix'; readonly status: 'empty'; readonly directed: boolean; readonly message: string }
  | { readonly kind: 'incidence-matrix'; readonly status: 'no-edges'; readonly directed: boolean; readonly message: string; readonly vertexCount: number }
  | ({ readonly kind: 'incidence-matrix'; readonly directed: boolean } & TooLargeMatrix)
  | {
      readonly kind: 'incidence-matrix';
      readonly status: 'ready';
      readonly directed: boolean;
      /** Cabeçalho das colunas: as arestas, na ordem do domínio. */
      readonly edges: readonly EdgeRef[];
      readonly rows: readonly IncidenceMatrixRowView[];
      readonly size: MatrixSize;
      readonly legend: readonly LegendEntry[];
      readonly notes: readonly string[];
    };

// --- Lista de incidência --------------------------------------------------------------------------------------------------------------------------------------------------------------

export type IncidenceListEntryView = {
  readonly edgeId: EdgeId;
  readonly role: IncidenceRole;
  /** O OUTRO extremo da aresta. */
  readonly opposite: VertexRef;
  readonly weight: number | undefined;
  readonly weightText: string;
  /** `e1: saída para B (v2) | sem peso`. */
  readonly text: string;
  readonly description: string;
};

export type IncidenceListRowView = {
  readonly vertex: VertexRef;
  readonly entries: readonly IncidenceListEntryView[];
};

export type IncidenceListView =
  | { readonly kind: 'incidence-list'; readonly status: 'empty'; readonly directed: boolean; readonly message: string }
  | {
      readonly kind: 'incidence-list';
      readonly status: 'ready';
      readonly directed: boolean;
      readonly rows: readonly IncidenceListRowView[];
      readonly entryCount: number;
      readonly notes: readonly string[];
    };

export type RepresentationView = AdjacencyListView | AdjacencyMatrixView | IncidenceMatrixView | IncidenceListView;

// --- Textos ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** O peso visível de uma aresta: `sem peso` ou `peso 0` (vírgula decimal). */
export function weightText(weight: number | undefined): string {
  return weight === undefined ? NO_WEIGHT_TEXT : `peso ${formatWeight(weight)}`;
}

/** O peso falado, sem ambiguidade com a ausência: `sem peso`, `com peso zero`, `com peso menos 2`, `com peso 2,5`. */
export function spokenWeight(weight: number | undefined): string {
  if (weight === undefined) return NO_WEIGHT_TEXT;
  if (weight === 0) return 'com peso zero';
  if (weight < 0) return `com peso menos ${formatWeight(-weight)}`;
  return `com peso ${formatWeight(weight)}`;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const vertexRef = (vertex: Vertex): VertexRef => ({
  id: vertex.id,
  label: vertex.label,
  text: `${vertex.label} (${vertex.id})`,
  spoken: `${vertex.label}, vértice ${vertex.id}`,
});

/** O índice id → `VertexRef` (Θ(V)): o rótulo vem do grafo, a ORDEM vem sempre do domínio. */
function refIndex(graph: Graph): ReadonlyMap<VertexId, VertexRef> {
  return new Map(graph.vertices.map((vertex) => [vertex.id, vertexRef(vertex)] as const));
}

/** Um vértice do domínio sempre existe no grafo; se faltasse, o id aparece como rótulo em vez de a conta falhar. */
const refOf = (index: ReadonlyMap<VertexId, VertexRef>, id: VertexId): VertexRef =>
  index.get(id) ?? { id, label: id, text: id, spoken: id };

const matrixSize = (rows: number, columns: number): MatrixSize => ({ rows, columns, cells: rows * columns, text: `${rows} × ${columns}` });

function tooLarge(size: MatrixSize, limit: number, suggestedKind: RepresentationKind, listName: string): TooLargeMatrix {
  return {
    status: 'too-large',
    size,
    limit,
    message: 'Esta matriz possui muitas células para ser exibida integralmente nesta tela.',
    detail: `Dimensões: ${size.text} (${plural(size.cells, 'célula', 'células')}); o limite de apresentação é ${limit}.`,
    suggestion: `Use a ${listName} para ver este grafo.`,
    suggestedKind,
  };
}

const EMPTY_MESSAGE =
  'O grafo não tem vértices: não há o que mostrar. Adicione vértices no quadro para ver esta representação.';

function maxCells(options: RepresentationViewOptions | undefined): number {
  const wanted = options?.maxMatrixCells;
  return wanted !== undefined && Number.isFinite(wanted) && wanted >= 0 ? wanted : REPRESENTATION_LIMITS.maxMatrixCells;
}

// --- Lista de adjacência --------------------------------------------------------------------------------------------------------------------------------------------------------------

function adjacencyListView(graph: Graph): AdjacencyListView {
  const directed = graph.directed;
  if (graph.vertices.length === 0) return { kind: 'adjacency-list', status: 'empty', directed, message: EMPTY_MESSAGE };
  const index = refIndex(graph);
  const list = adjacencyList(graph);
  let entryCount = 0;
  const rows = list.map((row): AdjacencyListRowView => {
    const owner = refOf(index, row.vertexId);
    const entries = row.entries.map((entry): AdjacencyListEntryView => {
      const neighbor = refOf(index, entry.vertexId);
      const text = weightText(entry.weight);
      return {
        vertex: neighbor,
        edgeId: entry.edgeId,
        weight: entry.weight,
        weightText: text,
        text: `${directed ? '→' : '—'} ${neighbor.text} | ${entry.edgeId} | ${text}`,
        description: directed
          ? `${owner.spoken}: aresta ${entry.edgeId} para ${neighbor.spoken}, ${spokenWeight(entry.weight)}.`
          : `${owner.spoken}: aresta ${entry.edgeId} com ${neighbor.spoken}, ${spokenWeight(entry.weight)}.`,
      };
    });
    entryCount += entries.length;
    return { vertex: owner, entries };
  });
  const notes = [
    directed ? 'Cada linha lista os arcos que SAEM do vértice.' : 'Cada aresta aparece nas duas pontas, com o mesmo identificador.',
    'Os vizinhos seguem a ordem de criação dos vértices.',
  ];
  return { kind: 'adjacency-list', status: 'ready', directed, rows, entryCount, notes };
}

// --- Matriz de adjacência -------------------------------------------------------------------------------------------------------------------------------------------------------------

function adjacencyMatrixView(graph: Graph, limit: number): AdjacencyMatrixView {
  const directed = graph.directed;
  const count = graph.vertices.length;
  if (count === 0) return { kind: 'adjacency-matrix', status: 'empty', directed, message: EMPTY_MESSAGE };
  const size = matrixSize(count, count);
  // Conferido ANTES de o domínio montar a grade V × V: uma matriz grande demais nem é materializada.
  if (size.cells > limit) return { kind: 'adjacency-matrix', directed, ...tooLarge(size, limit, 'adjacency-list', 'lista de adjacência') };

  const index = refIndex(graph);
  const matrix = adjacencyMatrix(graph);
  const vertices = matrix.vertexIds.map((id) => refOf(index, id));
  const rows = matrix.cells.map((cells, i): AdjacencyMatrixRowView => {
    const from = vertices[i]!;
    return {
      vertex: from,
      cells: cells.map((cell, j): AdjacencyCellView => {
        const to = vertices[j]!;
        const where = directed
          ? `Origem ${from.spoken}; destino ${to.spoken}`
          : `Linha ${from.spoken}; coluna ${to.spoken}`;
        if (cell === null) return { state: 'absent', text: ABSENT_SYMBOL, description: `${where}; não existe aresta.` };
        if (cell.weight === undefined) {
          return { state: 'unweighted', text: UNWEIGHTED_SYMBOL, edgeId: cell.edgeId, description: `${where}; aresta ${cell.edgeId} sem peso.` };
        }
        return {
          state: 'weighted',
          text: formatWeight(cell.weight),
          weight: cell.weight,
          edgeId: cell.edgeId,
          description: `${where}; aresta ${cell.edgeId} ${spokenWeight(cell.weight)}.`,
        };
      }),
    };
  });
  const legend: LegendEntry[] = [
    { symbol: ABSENT_SYMBOL, spoken: 'traço', meaning: 'não existe aresta' },
    { symbol: UNWEIGHTED_SYMBOL, spoken: 'sinal de vezes', meaning: 'existe aresta sem peso' },
    { symbol: '0', spoken: 'zero', meaning: 'existe aresta com peso zero' },
    { symbol: '2,5', spoken: 'dois vírgula cinco', meaning: 'existe aresta com esse peso (também vale para pesos negativos)' },
  ];
  const notes = [
    directed
      ? 'Linha = vértice de origem; coluna = vértice de destino. Arcos opostos ocupam células diferentes.'
      : 'Matriz simétrica: cada aresta aparece nas duas células (linha, coluna) e (coluna, linha).',
    'A matriz binária tradicional de adjacência usa 0 e 1 para ausência e presença de aresta. A notação exibida aqui preserva também o peso: o 0 é um PESO (aresta de peso zero) e a ausência de aresta é "—".',
  ];
  return { kind: 'adjacency-matrix', status: 'ready', directed, vertices, rows, size, legend, notes };
}

// --- Matriz de incidência -------------------------------------------------------------------------------------------------------------------------------------------------------------

function edgeRef(edge: Edge, index: ReadonlyMap<VertexId, VertexRef>, directed: boolean): EdgeRef {
  const source = refOf(index, edge.source);
  const target = refOf(index, edge.target);
  const text = weightText(edge.weight);
  return {
    id: edge.id,
    source,
    target,
    weight: edge.weight,
    weightText: text,
    caption: `${source.label} ${directed ? '→' : '—'} ${target.label}`,
    description: directed
      ? `${edge.id}: de ${source.text} para ${target.text}, ${text}`
      : `${edge.id}: entre ${source.text} e ${target.text}, ${text}`,
  };
}

function incidenceCell(value: IncidenceValue, vertex: VertexRef, edge: EdgeRef, directed: boolean): IncidenceCellView {
  const head = `Vértice ${vertex.spoken}; aresta ${edge.id}`;
  if (value === 0) return { value, text: '0', description: `${head}: o vértice não é extremo da aresta, valor zero.` };
  if (!directed) {
    return { value, text: '1', description: `${head}, entre ${edge.source.label} e ${edge.target.label}: o vértice é extremo da aresta, valor um.` };
  }
  const course = `de ${edge.source.label} para ${edge.target.label}`;
  return value === 1
    ? { value, text: '+1', description: `${head}, ${course}: o vértice é a origem, a aresta sai dele, valor mais um.` }
    : { value, text: '-1', description: `${head}, ${course}: o vértice é o destino, a aresta entra nele, valor menos um.` };
}

function incidenceMatrixView(graph: Graph, limit: number): IncidenceMatrixView {
  const directed = graph.directed;
  const vertexCount = graph.vertices.length;
  const edgeCount = graph.edges.length;
  if (vertexCount === 0) return { kind: 'incidence-matrix', status: 'empty', directed, message: EMPTY_MESSAGE };
  if (edgeCount === 0) {
    return {
      kind: 'incidence-matrix',
      status: 'no-edges',
      directed,
      vertexCount,
      message: 'O grafo ainda não tem arestas: a matriz de incidência não tem colunas. Conecte dois vértices para vê-la.',
    };
  }
  const size = matrixSize(vertexCount, edgeCount);
  if (size.cells > limit) return { kind: 'incidence-matrix', directed, ...tooLarge(size, limit, 'incidence-list', 'lista de incidência') };

  const index = refIndex(graph);
  const edgeById = new Map<EdgeId, Edge>(graph.edges.map((edge) => [edge.id, edge] as const));
  const matrix = incidenceMatrix(graph);
  const edges = matrix.edgeIds.map((id) => edgeRef(edgeById.get(id)!, index, directed));
  const rows = matrix.cells.map((cells, i): IncidenceMatrixRowView => {
    const vertex = refOf(index, matrix.vertexIds[i]!);
    return { vertex, cells: cells.map((value, j) => incidenceCell(value, vertex, edges[j]!, directed)) };
  });
  const legend: LegendEntry[] = directed
    ? [
        { symbol: '+1', spoken: 'mais um', meaning: 'a aresta sai do vértice (ele é a origem)' },
        { symbol: '-1', spoken: 'menos um', meaning: 'a aresta entra no vértice (ele é o destino)' },
        { symbol: '0', spoken: 'zero', meaning: 'o vértice não é extremo da aresta' },
      ]
    : [
        { symbol: '1', spoken: 'um', meaning: 'o vértice é extremo da aresta' },
        { symbol: '0', spoken: 'zero', meaning: 'o vértice não é extremo da aresta' },
      ];
  const notes = [
    'Linhas = vértices; colunas = arestas, na ordem de criação. Os valores descrevem só a incidência: os pesos não aparecem na matriz (veja a descrição de cada aresta).',
    directed ? 'É a convenção do livro-texto da disciplina; outras fontes podem inverter os sinais.' : 'Sem direção, as duas pontas da aresta valem 1.',
  ];
  return { kind: 'incidence-matrix', status: 'ready', directed, edges, rows, size, legend, notes };
}

// --- Lista de incidência --------------------------------------------------------------------------------------------------------------------------------------------------------------

const ROLE_PHRASE: Readonly<Record<IncidenceRole, string>> = {
  outgoing: 'saída para',
  incoming: 'entrada de',
  undirected: 'liga a',
};

function incidenceEntryDescription(owner: VertexRef, role: IncidenceRole, edgeId: EdgeId, opposite: VertexRef, weight: number | undefined): string {
  const tail = `${opposite.spoken}; ${spokenWeight(weight)}.`;
  switch (role) {
    case 'outgoing':
      return `${owner.spoken}: a aresta ${edgeId} sai de ${owner.label} e vai para ${tail}`;
    case 'incoming':
      return `${owner.spoken}: a aresta ${edgeId} entra em ${owner.label}, vinda de ${tail}`;
    case 'undirected':
      return `${owner.spoken}: a aresta ${edgeId} liga ${owner.label} a ${tail}`;
  }
}

function incidenceListView(graph: Graph): IncidenceListView {
  const directed = graph.directed;
  if (graph.vertices.length === 0) return { kind: 'incidence-list', status: 'empty', directed, message: EMPTY_MESSAGE };
  const index = refIndex(graph);
  const list = incidenceList(graph);
  let entryCount = 0;
  const rows = list.rows.map((entries, i): IncidenceListRowView => {
    const owner = refOf(index, list.vertexIds[i]!);
    const views = entries.map((entry): IncidenceListEntryView => {
      const opposite = refOf(index, entry.oppositeVertexId);
      const text = weightText(entry.weight);
      return {
        edgeId: entry.edgeId,
        role: entry.role,
        opposite,
        weight: entry.weight,
        weightText: text,
        text: `${entry.edgeId}: ${ROLE_PHRASE[entry.role]} ${opposite.text} | ${text}`,
        description: incidenceEntryDescription(owner, entry.role, entry.edgeId, opposite, entry.weight),
      };
    });
    entryCount += views.length;
    return { vertex: owner, entries: views };
  });
  const notes = [
    directed ? 'Saída: a aresta parte do vértice. Entrada: a aresta chega ao vértice.' : 'Sem direção: a aresta apenas liga o vértice ao outro extremo.',
    'As arestas de cada vértice seguem a ordem de criação das arestas.',
  ];
  return { kind: 'incidence-list', status: 'ready', directed, rows, entryCount, notes };
}

// --- A porta de entrada ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Constrói o modelo de apresentação da representação `kind` de `graph`. Só essa representação é calculada. */
export function buildRepresentationView(graph: Graph, kind: 'adjacency-list', options?: RepresentationViewOptions): AdjacencyListView;
export function buildRepresentationView(graph: Graph, kind: 'adjacency-matrix', options?: RepresentationViewOptions): AdjacencyMatrixView;
export function buildRepresentationView(graph: Graph, kind: 'incidence-matrix', options?: RepresentationViewOptions): IncidenceMatrixView;
export function buildRepresentationView(graph: Graph, kind: 'incidence-list', options?: RepresentationViewOptions): IncidenceListView;
export function buildRepresentationView(graph: Graph, kind: RepresentationKind, options?: RepresentationViewOptions): RepresentationView;
export function buildRepresentationView(graph: Graph, kind: RepresentationKind, options?: RepresentationViewOptions): RepresentationView {
  switch (kind) {
    case 'adjacency-list':
      return adjacencyListView(graph);
    case 'adjacency-matrix':
      return adjacencyMatrixView(graph, maxCells(options));
    case 'incidence-matrix':
      return incidenceMatrixView(graph, maxCells(options));
    case 'incidence-list':
      return incidenceListView(graph);
  }
}

// --- Listas em páginas ----------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Uma linha de uma lista, na ordem em que aparece: o vértice, cada entrada dele, ou o aviso de que ele não tem nenhuma. */
export type ListLine =
  | { readonly key: string; readonly kind: 'vertex'; readonly vertexId: VertexId; readonly text: string; readonly description: string }
  | { readonly key: string; readonly kind: 'entry'; readonly vertexId: VertexId; readonly edgeId: EdgeId; readonly text: string; readonly description: string }
  | { readonly key: string; readonly kind: 'empty'; readonly vertexId: VertexId; readonly text: string; readonly description: string };

export const NO_NEIGHBORS_TEXT = 'Sem vizinhos';
export const NO_INCIDENT_EDGES_TEXT = 'Nenhuma aresta incidente';

type ReadyList = Extract<AdjacencyListView | IncidenceListView, { status: 'ready' }>;

/** A lista achatada em linhas, para a interface mostrar aos poucos. Θ(V + A). Cada vértice aparece, inclusive os isolados. */
export function listLines(view: ReadyList): readonly ListLine[] {
  const emptyText = view.kind === 'adjacency-list' ? NO_NEIGHBORS_TEXT : NO_INCIDENT_EDGES_TEXT;
  const lines: ListLine[] = [];
  for (const row of view.rows) {
    lines.push({
      key: `vertex-${row.vertex.id}`,
      kind: 'vertex',
      vertexId: row.vertex.id,
      text: row.vertex.text,
      description: `Vértice ${row.vertex.spoken}: ${row.entries.length === 0 ? emptyText.toLowerCase() : plural(row.entries.length, 'entrada', 'entradas')}.`,
    });
    if (row.entries.length === 0) {
      lines.push({
        key: `empty-${row.vertex.id}`,
        kind: 'empty',
        vertexId: row.vertex.id,
        text: emptyText,
        description: `${row.vertex.spoken}: ${emptyText.toLowerCase()}.`,
      });
      continue;
    }
    for (const entry of row.entries) {
      lines.push({
        key: `entry-${row.vertex.id}-${entry.edgeId}`,
        kind: 'entry',
        vertexId: row.vertex.id,
        edgeId: entry.edgeId,
        text: entry.text,
        description: entry.description,
      });
    }
  }
  return lines;
}

/** Quantas linhas aparecem depois de pedir mais uma página: nunca passa do total. */
export function nextVisibleLines(visible: number, total: number, pageSize: number = REPRESENTATION_LIMITS.listPageLines): number {
  return Math.min(total, Math.max(0, visible) + Math.max(1, pageSize));
}

/** O recorte mostrado e quantas linhas ficam de fora (para dizer isso ao aluno). */
export function pageLines(lines: readonly ListLine[], visible: number): { readonly shown: readonly ListLine[]; readonly hidden: number } {
  const count = Math.min(lines.length, Math.max(0, visible));
  return { shown: lines.slice(0, count), hidden: lines.length - count };
}
