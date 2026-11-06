import {
  addEdge,
  addVertex,
  adjacencyList,
  adjacencyMatrix,
  createGraph,
  incidenceList,
  incidenceMatrix,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  type Graph,
  type Result,
} from '@/domain/graph';

import {
  ABSENT_SYMBOL,
  NO_INCIDENT_EDGES_TEXT,
  NO_NEIGHBORS_TEXT,
  REPRESENTATION_KINDS,
  REPRESENTATION_LIMITS,
  REPRESENTATION_TITLES,
  UNWEIGHTED_SYMBOL,
  buildRepresentationView,
  listLines,
  nextVisibleLines,
  pageLines,
  spokenWeight,
  weightText,
  type AdjacencyMatrixView,
  type IncidenceMatrixView,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Adaptador de apresentação das quatro representações (ver representation-view.ts). O domínio já tem seus testes extensivos (Fase 2): aqui se confere a ADAPTAÇÃO, com o grafo do enunciado
// feito à mão, os três estados de peso, a orientação, a identidade por id, a ordem do domínio e os limites. Um teste por sorteio usa as funções do domínio como ORÁCULO do mapeamento célula a célula.

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type EdgeSpec = readonly [source: number, target: number, weight?: number];

/** Grafo com os rótulos dados (v1, v2, …) e as arestas `[origem, destino, peso?]` (índices a partir de 1), criadas na ordem dada. */
function graphOf(labels: readonly (string | undefined)[], edges: readonly EdgeSpec[] = [], directed = false): Graph {
  let graph = createGraph({ id: 'g', directed });
  for (const label of labels) graph = must(addVertex(graph, label)).graph;
  for (const [source, target, weight] of edges) {
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, ...(weight === undefined ? {} : { weight }) })).graph;
  }
  return graph;
}

/** O dígrafo do enunciado: A (v1), B (v2), C (v3) isolado; e1: A → B com peso 0; e2: B → A sem peso. */
const digraph = (): Graph => graphOf([undefined, undefined, undefined], [[1, 2, 0], [2, 1]], true);

const adjList = (graph: Graph) => buildRepresentationView(graph, 'adjacency-list');
const adjMatrix = (graph: Graph, maxMatrixCells?: number) => buildRepresentationView(graph, 'adjacency-matrix', { maxMatrixCells });
const incMatrix = (graph: Graph, maxMatrixCells?: number) => buildRepresentationView(graph, 'incidence-matrix', { maxMatrixCells });
const incList = (graph: Graph) => buildRepresentationView(graph, 'incidence-list');

function readyAdjMatrix(graph: Graph): Extract<AdjacencyMatrixView, { status: 'ready' }> {
  const view = adjMatrix(graph);
  if (view.status !== 'ready') throw new Error(`esperava a matriz pronta, mas veio ${view.status}`);
  return view;
}

function readyIncMatrix(graph: Graph): Extract<IncidenceMatrixView, { status: 'ready' }> {
  const view = incMatrix(graph);
  if (view.status !== 'ready') throw new Error(`esperava a matriz pronta, mas veio ${view.status}`);
  return view;
}

function readyAdjList(graph: Graph) {
  const view = adjList(graph);
  if (view.status !== 'ready') throw new Error(`esperava a lista pronta, mas veio ${view.status}`);
  return view;
}

function readyIncList(graph: Graph) {
  const view = incList(graph);
  if (view.status !== 'ready') throw new Error(`esperava a lista pronta, mas veio ${view.status}`);
  return view;
}

describe('o exemplo obrigatório: A (v1), B (v2), C (v3) isolado; e1 A → B com peso 0; e2 B → A sem peso', () => {
  it('lista de adjacência: A tem B por e1, B tem A por e2, C não tem vizinhos', () => {
    const view = readyAdjList(digraph());

    expect(view.directed).toBe(true);
    expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(view.rows[0]!.entries).toStrictEqual([
      {
        vertex: { id: 'v2', label: 'B', text: 'B (v2)', spoken: 'B, vértice v2' },
        edgeId: 'e1',
        weight: 0,
        weightText: 'peso 0',
        text: '→ B (v2) | e1 | peso 0',
        description: 'A, vértice v1: aresta e1 para B, vértice v2, com peso zero.',
      },
    ]);
    expect(view.rows[1]!.entries).toStrictEqual([
      {
        vertex: { id: 'v1', label: 'A', text: 'A (v1)', spoken: 'A, vértice v1' },
        edgeId: 'e2',
        weight: undefined,
        weightText: 'sem peso',
        text: '→ A (v1) | e2 | sem peso',
        description: 'B, vértice v2: aresta e2 para A, vértice v1, sem peso.',
      },
    ]);
    expect(view.rows[2]!.entries).toStrictEqual([]);
    expect(view.entryCount).toBe(2);
  });

  it('matriz de adjacência: de A para B peso zero, de B para A aresta sem peso, o resto sem aresta', () => {
    const view = readyAdjMatrix(digraph());

    expect(view.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(view.rows[0]!.cells[1]).toStrictEqual({
      state: 'weighted',
      text: '0',
      weight: 0,
      edgeId: 'e1',
      description: 'Origem A, vértice v1; destino B, vértice v2; aresta e1 com peso zero.',
    });
    expect(view.rows[1]!.cells[0]).toStrictEqual({
      state: 'unweighted',
      text: UNWEIGHTED_SYMBOL,
      edgeId: 'e2',
      description: 'Origem B, vértice v2; destino A, vértice v1; aresta e2 sem peso.',
    });
    const states = view.rows.map((row) => row.cells.map((cell) => cell.state));
    expect(states).toStrictEqual([
      ['absent', 'weighted', 'absent'],
      ['unweighted', 'absent', 'absent'],
      ['absent', 'absent', 'absent'],
    ]);
    expect(view.size).toStrictEqual({ rows: 3, columns: 3, cells: 9, text: '3 × 3' });
  });

  it('matriz de incidência: e1 dá A = +1 e B = -1, e2 dá B = +1 e A = -1, e C tem zero em todas as colunas', () => {
    const view = readyIncMatrix(digraph());

    expect(view.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2']);
    expect(view.rows.map((row) => [row.vertex.id, row.cells.map((cell) => cell.value)])).toStrictEqual([
      ['v1', [1, -1]],
      ['v2', [-1, 1]],
      ['v3', [0, 0]],
    ]);
    expect(view.rows.map((row) => row.cells.map((cell) => cell.text))).toStrictEqual([
      ['+1', '-1'],
      ['-1', '+1'],
      ['0', '0'],
    ]);
  });

  it('lista de incidência: A tem e1 como saída e e2 como entrada, B o contrário, C nenhuma aresta', () => {
    const view = readyIncList(digraph());

    expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(view.rows[0]!.entries.map((entry) => [entry.edgeId, entry.role, entry.opposite.id])).toStrictEqual([
      ['e1', 'outgoing', 'v2'],
      ['e2', 'incoming', 'v2'],
    ]);
    expect(view.rows[1]!.entries.map((entry) => [entry.edgeId, entry.role, entry.opposite.id])).toStrictEqual([
      ['e1', 'incoming', 'v1'],
      ['e2', 'outgoing', 'v1'],
    ]);
    expect(view.rows[2]!.entries).toStrictEqual([]);
    expect(view.rows[0]!.entries.map((entry) => entry.text)).toStrictEqual(['e1: saída para B (v2) | peso 0', 'e2: entrada de B (v2) | sem peso']);
  });

  it('os arcos opostos NÃO se invertem: e1 continua indo de A para B e e2 de B para A em todas as quatro', () => {
    const graph = digraph();
    const matrix = readyAdjMatrix(graph);
    const incidence = readyIncMatrix(graph);

    expect(matrix.rows[0]!.cells[1]).toMatchObject({ edgeId: 'e1' });
    expect(matrix.rows[1]!.cells[0]).toMatchObject({ edgeId: 'e2' });
    expect(incidence.edges[0]).toMatchObject({ id: 'e1', caption: 'A → B' });
    expect(incidence.edges[1]).toMatchObject({ id: 'e2', caption: 'B → A' });
    expect(readyAdjList(graph).rows[0]!.entries[0]!.text.startsWith('→ B')).toBe(true);
  });
});

describe('os três estados de peso nunca se confundem', () => {
  const graph = graphOf(['A', 'B', 'C', 'D', 'E'], [[1, 2], [1, 3, 0], [1, 4, -2], [1, 5, 2.5]]);

  it('na matriz de adjacência: sem peso é ×, peso zero é 0, negativo e fracionário mostram o número (vírgula decimal), ausência é —', () => {
    const [row] = readyAdjMatrix(graph).rows;
    expect(row!.cells.map((cell) => cell.text)).toStrictEqual([ABSENT_SYMBOL, UNWEIGHTED_SYMBOL, '0', '-2', '2,5']);
    expect(row!.cells.map((cell) => cell.state)).toStrictEqual(['absent', 'unweighted', 'weighted', 'weighted', 'weighted']);
  });

  it('o zero nunca é ausência e a aresta sem peso nunca é zero: os textos, os estados e os pesos são distintos', () => {
    const [row] = readyAdjMatrix(graph).rows;
    const [absent, unweighted, zero] = row!.cells;

    expect(new Set([absent!.text, unweighted!.text, zero!.text]).size).toBe(3);
    expect(zero).toMatchObject({ state: 'weighted', weight: 0 });
    expect(unweighted).not.toHaveProperty('weight');
    expect(absent).not.toHaveProperty('edgeId');
  });

  it('na lista de adjacência: `sem peso`, `peso 0`, `peso -2` e `peso 2,5`', () => {
    const entries = readyAdjList(graph).rows[0]!.entries;

    expect(entries.map((entry) => entry.weightText)).toStrictEqual(['sem peso', 'peso 0', 'peso -2', 'peso 2,5']);
    expect(entries.map((entry) => entry.weight)).toStrictEqual([undefined, 0, -2, 2.5]);
  });

  it('na lista de incidência: o mesmo texto de peso, na entrada de cada aresta', () => {
    const entries = readyIncList(graph).rows[0]!.entries;

    expect(entries.map((entry) => entry.weightText)).toStrictEqual(['sem peso', 'peso 0', 'peso -2', 'peso 2,5']);
  });

  it('na matriz de incidência o peso NÃO entra nos valores: só +1/-1/1/0; ele aparece na descrição da aresta, separado', () => {
    const view = readyIncMatrix(graph);
    const values = new Set(view.rows.flatMap((row) => row.cells.map((cell) => cell.value)));

    expect([...values].sort()).toStrictEqual([0, 1]);
    expect(view.edges.map((edge) => edge.weightText)).toStrictEqual(['sem peso', 'peso 0', 'peso -2', 'peso 2,5']);
    expect(view.edges.map((edge) => edge.weight)).toStrictEqual([undefined, 0, -2, 2.5]);
    expect(view.edges[1]!.description).toBe('e2: entre A (v1) e C (v3), peso 0');
  });

  it('o peso falado diz zero por extenso e não confunde com a ausência', () => {
    expect(spokenWeight(undefined)).toBe('sem peso');
    expect(spokenWeight(0)).toBe('com peso zero');
    expect(spokenWeight(-2)).toBe('com peso menos 2');
    expect(spokenWeight(-0.5)).toBe('com peso menos 0,5');
    expect(spokenWeight(2.5)).toBe('com peso 2,5');
    expect(spokenWeight(1000000)).toBe('com peso 1000000');
  });

  it('o peso visível: `sem peso`, `peso 0`, números negativos e a vírgula decimal', () => {
    expect(weightText(undefined)).toBe('sem peso');
    expect(weightText(0)).toBe('peso 0');
    expect(weightText(-2)).toBe('peso -2');
    expect(weightText(2.5)).toBe('peso 2,5');
    expect(weightText(-0.25)).toBe('peso -0,25');
    expect(weightText(1e21)).toBe('peso 1e+21');
  });

  it('a descrição falada de cada célula tem linha, coluna e significado, e o zero nunca aparece sozinho', () => {
    const [row] = readyAdjMatrix(graph).rows;

    expect(row!.cells.map((cell) => cell.description)).toStrictEqual([
      'Linha A, vértice v1; coluna A, vértice v1; não existe aresta.',
      'Linha A, vértice v1; coluna B, vértice v2; aresta e1 sem peso.',
      'Linha A, vértice v1; coluna C, vértice v3; aresta e2 com peso zero.',
      'Linha A, vértice v1; coluna D, vértice v4; aresta e3 com peso menos 2.',
      'Linha A, vértice v1; coluna E, vértice v5; aresta e4 com peso 2,5.',
    ]);
  });
});

describe('orientação e simetria', () => {
  const undirected = graphOf(['A', 'B', 'C', 'D'], [[1, 2, 2.5], [2, 3], [1, 3, -1]]); // D isolado

  it('não orientado: a matriz de adjacência é simétrica (mesmo estado, texto, aresta e peso nas duas células)', () => {
    const { rows } = readyAdjMatrix(undirected);

    rows.forEach((row, i) => {
      row.cells.forEach((cell, j) => {
        const mirror = rows[j]!.cells[i]!;
        expect(mirror.state).toBe(cell.state);
        expect(mirror.text).toBe(cell.text);
        expect('edgeId' in cell ? cell.edgeId : undefined).toBe('edgeId' in mirror ? mirror.edgeId : undefined);
        expect('weight' in cell ? cell.weight : undefined).toBe('weight' in mirror ? mirror.weight : undefined);
      });
    });
    expect(rows.map((row) => row.cells[row.cells.length - 1]!.state)).toStrictEqual(['absent', 'absent', 'absent', 'absent']); // D é isolado
  });

  it('não orientado: a diagonal é sempre ausência (o modelo não tem laços)', () => {
    const { rows } = readyAdjMatrix(undirected);

    rows.forEach((row, i) => {
      expect(row.cells[i]!.state).toBe('absent');
    });
  });

  it('orientado: a matriz de adjacência pode ser assimétrica, e a linha é a origem e a coluna o destino', () => {
    const graph = graphOf(['A', 'B', 'C'], [[1, 2, 3], [2, 3]], true);
    const { rows } = readyAdjMatrix(graph);

    expect(rows[0]!.cells[1]).toMatchObject({ state: 'weighted', text: '3', edgeId: 'e1' });
    expect(rows[1]!.cells[0]).toMatchObject({ state: 'absent' });
    expect(rows[1]!.cells[2]).toMatchObject({ state: 'unweighted', edgeId: 'e2' });
    expect(rows[2]!.cells[1]).toMatchObject({ state: 'absent' });
    expect(rows[0]!.cells[1]!.description.startsWith('Origem A, vértice v1; destino B, vértice v2;')).toBe(true);
  });

  it('incidência orientada: origem +1, destino -1, fora 0; não orientada: 1 nas duas pontas e 0 fora', () => {
    const directed = readyIncMatrix(graphOf(['A', 'B', 'C'], [[1, 2], [3, 1]], true));
    const plain = readyIncMatrix(graphOf(['A', 'B', 'C'], [[1, 2], [3, 1]], false));

    expect(directed.rows.map((row) => row.cells.map((cell) => cell.text))).toStrictEqual([['+1', '-1'], ['-1', '0'], ['0', '+1']]);
    expect(plain.rows.map((row) => row.cells.map((cell) => cell.text))).toStrictEqual([['1', '1'], ['1', '0'], ['0', '1']]);
    expect(plain.rows.flatMap((row) => row.cells.map((cell) => cell.value))).not.toContain(-1);
  });

  it('a descrição falada de incidência diz se o vértice é origem, destino, extremo ou nada, e lê o sinal', () => {
    const directed = readyIncMatrix(graphOf(['A', 'B', 'C'], [[1, 2]], true));
    const plain = readyIncMatrix(graphOf(['A', 'B', 'C'], [[1, 2]], false));

    expect(directed.rows[0]!.cells[0]!.description).toBe('Vértice A, vértice v1; aresta e1, de A para B: o vértice é a origem, a aresta sai dele, valor mais um.');
    expect(directed.rows[1]!.cells[0]!.description).toBe('Vértice B, vértice v2; aresta e1, de A para B: o vértice é o destino, a aresta entra nele, valor menos um.');
    expect(directed.rows[2]!.cells[0]!.description).toBe('Vértice C, vértice v3; aresta e1: o vértice não é extremo da aresta, valor zero.');
    expect(plain.rows[0]!.cells[0]!.description).toBe('Vértice A, vértice v1; aresta e1, entre A e B: o vértice é extremo da aresta, valor um.');
  });

  it('listas: o orientado mostra → e saída/entrada; o não orientado mostra — e `liga a`, sem inventar direção', () => {
    const directed = graphOf(['A', 'B'], [[1, 2]], true);
    const plain = graphOf(['A', 'B'], [[1, 2]], false);

    expect(readyAdjList(directed).rows.map((row) => row.entries.map((entry) => entry.text))).toStrictEqual([['→ B (v2) | e1 | sem peso'], []]);
    expect(readyAdjList(plain).rows.map((row) => row.entries.map((entry) => entry.text))).toStrictEqual([['— B (v2) | e1 | sem peso'], ['— A (v1) | e1 | sem peso']]);
    expect(readyIncList(directed).rows.map((row) => row.entries.map((entry) => entry.role))).toStrictEqual([['outgoing'], ['incoming']]);
    expect(readyIncList(plain).rows.map((row) => row.entries.map((entry) => [entry.role, entry.text]))).toStrictEqual([
      [['undirected', 'e1: liga a B (v2) | sem peso']],
      [['undirected', 'e1: liga a A (v1) | sem peso']],
    ]);
  });

  it('a descrição falada das entradas das listas diz o sentido da aresta', () => {
    const directed = graphOf(['A', 'B'], [[1, 2, 0]], true);

    expect(readyAdjList(directed).rows[0]!.entries[0]!.description).toBe('A, vértice v1: aresta e1 para B, vértice v2, com peso zero.');
    expect(readyIncList(directed).rows[0]!.entries[0]!.description).toBe('A, vértice v1: a aresta e1 sai de A e vai para B, vértice v2; com peso zero.');
    expect(readyIncList(directed).rows[1]!.entries[0]!.description).toBe('B, vértice v2: a aresta e1 entra em B, vinda de A, vértice v1; com peso zero.');
    const plain = graphOf(['A', 'B'], [[1, 2]], false);
    expect(readyAdjList(plain).rows[0]!.entries[0]!.description).toBe('A, vértice v1: aresta e1 com B, vértice v2, sem peso.');
    expect(readyIncList(plain).rows[0]!.entries[0]!.description).toBe('A, vértice v1: a aresta e1 liga A a B, vértice v2; sem peso.');
  });
});

describe('vértices isolados, rótulos repetidos e Unicode', () => {
  it('um vértice isolado aparece explicitamente em todas as representações (nunca como linha ausente)', () => {
    const graph = graphOf(['A', 'B', 'ISOLADO'], [[1, 2]]);

    expect(readyAdjList(graph).rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(readyIncList(graph).rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(readyAdjMatrix(graph).rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(readyAdjMatrix(graph).vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(readyIncMatrix(graph).rows.map((row) => [row.vertex.id, row.cells.map((cell) => cell.value)])).toStrictEqual([
      ['v1', [1]],
      ['v2', [1]],
      ['v3', [0]],
    ]);
    expect(readyAdjList(graph).rows[2]!.entries).toStrictEqual([]);
  });

  it('só vértices isolados: as listas mostram todos sem entradas, a matriz de adjacência é toda ausência e a de incidência não tem colunas', () => {
    const graph = graphOf(['A', 'B', 'C']);

    expect(readyAdjList(graph).rows.map((row) => row.entries.length)).toStrictEqual([0, 0, 0]);
    expect(readyIncList(graph).rows.map((row) => row.entries.length)).toStrictEqual([0, 0, 0]);
    expect(readyAdjMatrix(graph).rows.flatMap((row) => row.cells.map((cell) => cell.state))).toStrictEqual(Array(9).fill('absent'));
    expect(incMatrix(graph)).toMatchObject({ status: 'no-edges', vertexCount: 3 });
  });

  it('um vértice só: matriz 1 × 1 de ausência e as listas com uma linha', () => {
    const graph = graphOf(['A']);

    expect(readyAdjMatrix(graph).rows[0]!.cells).toHaveLength(1);
    expect(readyAdjMatrix(graph).rows[0]!.cells[0]!.state).toBe('absent');
    expect(readyAdjList(graph).rows).toHaveLength(1);
    expect(readyIncList(graph).rows).toHaveLength(1);
  });

  it('rótulos repetidos se distinguem pelo id: o texto é `rótulo (id)` e a identidade nunca é o rótulo', () => {
    const graph = graphOf(['X', 'X', 'X'], [[1, 2, 0], [3, 1]]);
    const matrix = readyAdjMatrix(graph);

    expect(matrix.vertices.map((vertex) => vertex.text)).toStrictEqual(['X (v1)', 'X (v2)', 'X (v3)']);
    expect(matrix.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(matrix.rows[0]!.cells[1]).toMatchObject({ state: 'weighted', edgeId: 'e1' });
    expect(matrix.rows[2]!.cells[0]).toMatchObject({ state: 'unweighted', edgeId: 'e2' });
    expect(matrix.rows[0]!.cells[1]!.description).toBe('Linha X, vértice v1; coluna X, vértice v2; aresta e1 com peso zero.');
    expect(readyAdjList(graph).rows[0]!.entries[0]!.vertex).toStrictEqual({ id: 'v2', label: 'X', text: 'X (v2)', spoken: 'X, vértice v2' });
    expect(readyIncList(graph).rows[1]!.entries[0]!.opposite.id).toBe('v1');
  });

  it('rótulos Unicode (acentos, emoji, pontos de código fora do plano básico) passam inteiros', () => {
    const graph = graphOf(['Ação', '🚀', '𝔸', '日本語'], [[1, 2, 1.5], [3, 4]]);
    const matrix = readyAdjMatrix(graph);

    expect(matrix.vertices.map((vertex) => vertex.label)).toStrictEqual(['Ação', '🚀', '𝔸', '日本語']);
    expect(matrix.vertices.map((vertex) => vertex.text)).toStrictEqual(['Ação (v1)', '🚀 (v2)', '𝔸 (v3)', '日本語 (v4)']);
    expect(matrix.rows[0]!.cells[1]!.description).toBe('Linha Ação, vértice v1; coluna 🚀, vértice v2; aresta e1 com peso 1,5.');
    expect(readyIncMatrix(graph).edges.map((edge) => edge.caption)).toStrictEqual(['Ação — 🚀', '𝔸 — 日本語']);
    expect(readyIncList(graph).rows[3]!.entries[0]!.text).toBe('e2: liga a 𝔸 (v3) | sem peso');
  });

  it('com lacunas nos ids (um vértice e uma aresta removidos) os cabeçalhos mostram os ids que sobraram, na ordem do domínio', () => {
    let graph = graphOf(['A', 'B', 'C', 'D'], [[1, 2], [2, 3], [3, 4], [1, 4]]);
    graph = must(removeVertex(graph, 'v2')); // some v2 e as arestas e1 e e2
    graph = must(removeEdge(graph, 'e3'));

    const matrix = readyAdjMatrix(graph);
    expect(matrix.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v3', 'v4']);
    expect(matrix.rows[0]!.cells[2]).toMatchObject({ state: 'unweighted', edgeId: 'e4' }); // v1 — v4
    expect(readyIncMatrix(graph).edges.map((edge) => edge.id)).toStrictEqual(['e4']);
    expect(readyAdjList(graph).rows.map((row) => row.vertex.id)).toStrictEqual(['v1', 'v3', 'v4']);
    expect(readyIncList(graph).rows.map((row) => row.entries.map((entry) => entry.edgeId))).toStrictEqual([['e4'], [], ['e4']]);
  });
});

describe('a ordem é a do domínio, não a da criação das arestas nem a dos rótulos', () => {
  it('lista de adjacência: os vizinhos seguem a ordem dos vértices, mesmo com as arestas criadas em outra ordem', () => {
    const graph = graphOf(['Z', 'A', 'M', 'B'], [[1, 4], [1, 2], [1, 3]]);

    expect(readyAdjList(graph).rows[0]!.entries.map((entry) => [entry.vertex.id, entry.edgeId])).toStrictEqual([
      ['v2', 'e2'],
      ['v3', 'e3'],
      ['v4', 'e1'],
    ]);
    expect(readyAdjList(graph).rows.map((row) => row.vertex.label)).toStrictEqual(['Z', 'A', 'M', 'B']); // nada é reordenado por rótulo
  });

  it('lista de incidência e matriz de incidência: as arestas seguem a ordem de criação', () => {
    const graph = graphOf(['A', 'B', 'C', 'D'], [[3, 4], [1, 2], [2, 3]]);

    expect(readyIncMatrix(graph).edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2', 'e3']);
    expect(readyIncList(graph).rows[1]!.entries.map((entry) => entry.edgeId)).toStrictEqual(['e2', 'e3']);
  });
});

describe('o domínio é o oráculo: a adaptação é célula a célula igual ao que a Fase 2 devolve (grafos sorteados)', () => {
  function randomGraph(seed: number, directed: boolean): Graph {
    const random = seededRandom(seed);
    let graph = createGraph({ id: 'g', directed });
    const count = 1 + Math.floor(random() * 7);
    for (let i = 0; i < count; i++) graph = must(addVertex(graph, random() < 0.3 ? 'X' : undefined)).graph;
    const attempts = Math.floor(random() * count * 3);
    for (let k = 0; k < attempts; k++) {
      const source = 1 + Math.floor(random() * count);
      const target = 1 + Math.floor(random() * count);
      const pick = random();
      const weight = pick < 0.35 ? undefined : pick < 0.5 ? 0 : Math.round((random() * 20 - 10) * 100) / 100;
      const added = addEdge(graph, { source: `v${source}`, target: `v${target}`, ...(weight === undefined ? {} : { weight }) });
      if (added.ok) graph = added.value.graph;
    }
    return graph;
  }

  const graphs = [...Array(40).keys()].flatMap((seed) => [randomGraph(seed, false), randomGraph(1000 + seed, true)]);

  it('matriz de adjacência', () => {
    for (const graph of graphs) {
      const domain = adjacencyMatrix(graph);
      const view = readyAdjMatrix(graph);
      expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(domain.vertexIds);
      view.rows.forEach((row, i) => {
        row.cells.forEach((cell, j) => {
          const expected = domain.cells[i]![j]!;
          if (expected === null) expect(cell.state).toBe('absent');
          else {
            expect('edgeId' in cell ? cell.edgeId : undefined).toBe(expected.edgeId);
            expect(cell.state).toBe(expected.weight === undefined ? 'unweighted' : 'weighted');
            if (expected.weight !== undefined) expect('weight' in cell ? cell.weight : undefined).toBe(expected.weight);
          }
        });
      });
    }
  });

  it('matriz de incidência', () => {
    for (const graph of graphs) {
      if (graph.edges.length === 0) continue;
      const domain = incidenceMatrix(graph);
      const view = readyIncMatrix(graph);
      expect(view.edges.map((edge) => edge.id)).toStrictEqual(domain.edgeIds);
      expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(domain.vertexIds);
      expect(view.rows.map((row) => row.cells.map((cell) => cell.value))).toStrictEqual(domain.cells.map((row) => [...row]));
    }
  });

  it('lista de adjacência', () => {
    for (const graph of graphs) {
      const domain = adjacencyList(graph);
      const view = readyAdjList(graph);
      expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(domain.map((row) => row.vertexId));
      view.rows.forEach((row, i) => {
        expect(row.entries.map((entry) => [entry.vertex.id, entry.edgeId, entry.weight])).toStrictEqual(
          domain[i]!.entries.map((entry) => [entry.vertexId, entry.edgeId, entry.weight]),
        );
      });
    }
  });

  it('lista de incidência', () => {
    for (const graph of graphs) {
      const domain = incidenceList(graph);
      const view = readyIncList(graph);
      expect(view.rows.map((row) => row.vertex.id)).toStrictEqual(domain.vertexIds);
      view.rows.forEach((row, i) => {
        expect(row.entries.map((entry) => [entry.edgeId, entry.role, entry.opposite.id, entry.weight])).toStrictEqual(
          domain.rows[i]!.map((entry) => [entry.edgeId, entry.role, entry.oppositeVertexId, entry.weight]),
        );
      });
    }
  });
});

describe('grafo vazio e mensagens', () => {
  const empty = createGraph({ id: 'g' });

  it('sem vértices, as quatro dizem que não há o que mostrar (e não confundem isso com ausência de aresta)', () => {
    for (const kind of REPRESENTATION_KINDS) {
      const view = buildRepresentationView(empty, kind);
      expect(view.status).toBe('empty');
      expect('message' in view ? view.message : '').toContain('não tem vértices');
    }
  });

  it('com vértices e nenhuma aresta: as listas e a matriz de adjacência mostram os vértices; a incidência avisa que não há colunas', () => {
    const graph = graphOf(['A', 'B']);

    expect(adjList(graph).status).toBe('ready');
    expect(adjMatrix(graph).status).toBe('ready');
    expect(incList(graph).status).toBe('ready');
    const view = incMatrix(graph);
    expect(view.status).toBe('no-edges');
    expect('message' in view ? view.message : '').toContain('ainda não tem arestas');
  });

  it('os títulos das quatro representações, na ordem do painel', () => {
    expect(REPRESENTATION_KINDS.map((kind) => REPRESENTATION_TITLES[kind])).toStrictEqual([
      'Lista de adjacência',
      'Matriz de adjacência',
      'Matriz de incidência',
      'Lista de incidência',
    ]);
  });
});

describe('legendas e notas', () => {
  it('matriz de adjacência: legenda dos quatro símbolos e a nota sobre a matriz binária tradicional', () => {
    const view = readyAdjMatrix(digraph());

    expect(view.legend.map((entry) => entry.symbol)).toStrictEqual(['—', '×', '0', '2,5']);
    expect(view.legend[0]).toStrictEqual({ symbol: '—', spoken: 'traço', meaning: 'não existe aresta' });
    expect(view.legend[1]).toStrictEqual({ symbol: '×', spoken: 'sinal de vezes', meaning: 'existe aresta sem peso' });
    expect(view.legend[2]).toStrictEqual({ symbol: '0', spoken: 'zero', meaning: 'existe aresta com peso zero' });
    expect(view.notes.join(' ')).toContain('matriz binária tradicional');
    expect(view.notes.join(' ')).toContain('o 0 é um PESO');
  });

  it('matriz de adjacência: a nota diz que a linha é a origem e a coluna o destino (orientado) ou que é simétrica (não orientado)', () => {
    expect(readyAdjMatrix(digraph()).notes[0]).toBe('Linha = vértice de origem; coluna = vértice de destino. Arcos opostos ocupam células diferentes.');
    expect(readyAdjMatrix(graphOf(['A', 'B'], [[1, 2]])).notes[0]).toContain('simétrica');
  });

  it('matriz de incidência: +1, -1 e 0 no orientado; 1 e 0 no não orientado; e a nota de que o peso não entra', () => {
    const directed = readyIncMatrix(digraph());
    const plain = readyIncMatrix(graphOf(['A', 'B'], [[1, 2]]));

    expect(directed.legend).toStrictEqual([
      { symbol: '+1', spoken: 'mais um', meaning: 'a aresta sai do vértice (ele é a origem)' },
      { symbol: '-1', spoken: 'menos um', meaning: 'a aresta entra no vértice (ele é o destino)' },
      { symbol: '0', spoken: 'zero', meaning: 'o vértice não é extremo da aresta' },
    ]);
    expect(plain.legend.map((entry) => entry.symbol)).toStrictEqual(['1', '0']);
    expect(directed.notes[0]).toContain('os pesos não aparecem na matriz');
    expect(directed.notes[1]).toContain('outras fontes podem inverter os sinais');
  });

  it('listas: notas sobre o que cada linha mostra', () => {
    expect(readyAdjList(digraph()).notes[0]).toBe('Cada linha lista os arcos que SAEM do vértice.');
    expect(readyAdjList(graphOf(['A', 'B'], [[1, 2]])).notes[0]).toContain('duas pontas');
    expect(readyIncList(digraph()).notes[0]).toContain('Saída');
    expect(readyIncList(graphOf(['A', 'B'], [[1, 2]])).notes[0]).toContain('Sem direção');
  });
});

describe('limites de legibilidade (só visuais)', () => {
  const complete = (count: number): Graph => {
    const edges: EdgeSpec[] = [];
    for (let i = 1; i <= count; i++) for (let j = i + 1; j <= count; j++) edges.push([i, j]);
    return graphOf(Array(count).fill(undefined), edges);
  };

  it('o limite padrão é 400 células e fica centralizado', () => {
    expect(REPRESENTATION_LIMITS.maxMatrixCells).toBe(400);
    expect(Object.isFrozen(REPRESENTATION_LIMITS)).toBe(true);
  });

  it('matriz de adjacência: V × V = 400 (V = 20) ainda é exibida; V = 21 (441) não', () => {
    expect(adjMatrix(graphOf(Array(20).fill(undefined))).status).toBe('ready');
    const big = adjMatrix(graphOf(Array(21).fill(undefined)));

    expect(big.status).toBe('too-large');
    expect(big).toMatchObject({
      kind: 'adjacency-matrix',
      limit: 400,
      size: { rows: 21, columns: 21, cells: 441, text: '21 × 21' },
      suggestedKind: 'adjacency-list',
      message: 'Esta matriz possui muitas células para ser exibida integralmente nesta tela.',
      detail: 'Dimensões: 21 × 21 (441 células); o limite de apresentação é 400.',
      suggestion: 'Use a lista de adjacência para ver este grafo.',
    });
  });

  it('matriz de incidência: V × E conta, não só V (5 vértices e 10 arestas = 50 células)', () => {
    const graph = complete(5);

    expect(incMatrix(graph).status).toBe('ready');
    expect(incMatrix(graph, 49)).toMatchObject({
      status: 'too-large',
      size: { rows: 5, columns: 10, cells: 50, text: '5 × 10' },
      suggestedKind: 'incidence-list',
      suggestion: 'Use a lista de incidência para ver este grafo.',
    });
    expect(incMatrix(graph, 50).status).toBe('ready'); // o limite é inclusivo
  });

  it('o limite é configurável e um limite inválido volta ao padrão', () => {
    const graph = graphOf(['A', 'B', 'C']);

    expect(adjMatrix(graph, 8).status).toBe('too-large');
    expect(adjMatrix(graph, 9).status).toBe('ready');
    expect(adjMatrix(graph, Number.NaN).status).toBe('ready');
    expect(adjMatrix(graph, -1).status).toBe('ready');
  });

  it('um grafo grande mostra a mensagem e as dimensões, nunca uma matriz truncada em silêncio', () => {
    const view = adjMatrix(complete(25));

    expect(view.status).toBe('too-large');
    expect(view).not.toHaveProperty('rows');
    expect(view).not.toHaveProperty('vertices');
  });

  it('as listas não têm limite no modelo: um grafo grande aparece inteiro e a página é decidida pela interface', () => {
    const view = readyAdjList(complete(30));

    expect(view.rows).toHaveLength(30);
    expect(view.entryCount).toBe(30 * 29);
  });

  it('o grafo vazio e o grafo sem arestas vêm antes do limite', () => {
    expect(adjMatrix(createGraph({ id: 'g' }), 0).status).toBe('empty');
    expect(incMatrix(graphOf(['A', 'B']), 0).status).toBe('no-edges');
  });
});

describe('listas em páginas', () => {
  const graph = graphOf(['A', 'B', 'C'], [[1, 2, 0], [2, 3]], true);

  it('as linhas achatadas: cada vértice, cada entrada e o aviso de vértice sem entradas, na ordem', () => {
    const lines = listLines(readyAdjList(graph));

    expect(lines.map((line) => [line.kind, line.text])).toStrictEqual([
      ['vertex', 'A (v1)'],
      ['entry', '→ B (v2) | e1 | peso 0'],
      ['vertex', 'B (v2)'],
      ['entry', '→ C (v3) | e2 | sem peso'],
      ['vertex', 'C (v3)'],
      ['empty', NO_NEIGHBORS_TEXT],
    ]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  it('a lista de incidência usa o aviso próprio para o vértice sem arestas incidentes', () => {
    const lines = listLines(readyIncList(graphOf(['A', 'B'])));

    expect(lines.map((line) => [line.kind, line.text])).toStrictEqual([
      ['vertex', 'A (v1)'],
      ['empty', NO_INCIDENT_EDGES_TEXT],
      ['vertex', 'B (v2)'],
      ['empty', NO_INCIDENT_EDGES_TEXT],
    ]);
  });

  it('a descrição falada da linha de um vértice diz quantas entradas ele tem', () => {
    const lines = listLines(readyAdjList(graph));

    expect(lines[0]!.description).toBe('Vértice A, vértice v1: 1 entrada.');
    expect(lines[4]!.description).toBe('Vértice C, vértice v3: sem vizinhos.');
    expect(lines[5]!.description).toBe('C, vértice v3: sem vizinhos.');
  });

  it('a página recorta e diz quantas linhas ficam de fora; nunca passa do total', () => {
    const lines = listLines(readyAdjList(graph));

    expect(pageLines(lines, 4).shown).toHaveLength(4);
    expect(pageLines(lines, 4).hidden).toBe(2);
    expect(pageLines(lines, 100)).toMatchObject({ hidden: 0 });
    expect(pageLines(lines, 100).shown).toHaveLength(6);
    expect(pageLines(lines, -3).shown).toHaveLength(0);
    expect(nextVisibleLines(60, 130)).toBe(120);
    expect(nextVisibleLines(120, 130)).toBe(130);
    expect(nextVisibleLines(130, 130)).toBe(130);
    expect(nextVisibleLines(0, 5, 2)).toBe(2);
    expect(REPRESENTATION_LIMITS.listPageLines).toBe(60);
  });
});

describe('determinismo, imutabilidade e ausência de estado compartilhado', () => {
  it('o mesmo grafo e o mesmo tipo dão o mesmo resultado, em objetos novos a cada chamada', () => {
    const graph = digraph();

    for (const kind of REPRESENTATION_KINDS) {
      const first = buildRepresentationView(graph, kind);
      const second = buildRepresentationView(graph, kind);
      expect(second).toStrictEqual(first);
      expect(second).not.toBe(first);
    }
  });

  it('o grafo recebido não é alterado (congelado em profundidade) e nenhum objeto dele aparece nos modelos', () => {
    const graph = deepFreeze(digraph());
    const before = JSON.stringify(graph);

    for (const kind of REPRESENTATION_KINDS) {
      expect(() => buildRepresentationView(graph, kind)).not.toThrow();
    }
    expect(JSON.stringify(graph)).toBe(before);
    const view = readyAdjMatrix(graph);
    expect(view.vertices[0]).not.toBe(graph.vertices[0]);
  });

  it('o resultado só depende do grafo: editar o peso muda a representação, e voltar ao valor antigo volta ao resultado antigo', () => {
    const graph = digraph();
    const edited = must(setEdgeWeight(graph, 'e2', 5));

    expect(readyAdjMatrix(edited).rows[1]!.cells[0]).toMatchObject({ state: 'weighted', text: '5' });
    expect(readyAdjMatrix(graph).rows[1]!.cells[0]).toMatchObject({ state: 'unweighted' });
    expect(buildRepresentationView(graph, 'adjacency-matrix')).toStrictEqual(buildRepresentationView(digraph(), 'adjacency-matrix'));
  });
});
