import {
  addEdge,
  addVertex,
  adjacencyList,
  adjacencyMatrix,
  createGraph,
  degree,
  inDegree,
  incidenceList,
  incidenceMatrix,
  ok,
  outDegree,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  type AdjacencyList,
  type AdjacencyMatrix,
  type Graph,
  type IncidenceList,
  type IncidenceMatrix,
  type Result,
} from './index';
import {
  completeGraph,
  connect,
  deepFreeze,
  digraphWithOpposites as D,
  must,
  randomGraph,
  seededRandom,
  triangleWithTail as U,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Suíte CRUZADA: confere que as quatro representações descrevem o MESMO grafo, independentemente dos testes
// unitários de cada uma. Para não repetir um erro comum às quatro, ela usa:
//  - reconstruções escritas de formas diferentes para cada representação;
//  - dois grafos com as quatro estruturas calculadas à mão (G1 orientado e G2 não orientado);
//  - um modelo de referência independente (objetos simples, com as próprias regras) nas sequências de operações;
//  - controles negativos: o verificador precisa acusar representações corrompidas de propósito.

type Reps = { al: AdjacencyList; am: AdjacencyMatrix; im: IncidenceMatrix; il: IncidenceList };

const buildReps = (graph: Graph): Reps => ({
  al: adjacencyList(graph),
  am: adjacencyMatrix(graph),
  im: incidenceMatrix(graph),
  il: incidenceList(graph),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------------------------
// Reconstrução de arestas: extremos, sentido e (quando existir) peso, a partir de cada representação.
// ---------------------------------------------------------------------------------------------

/** Aresta reconstruída. No não orientado `a` ≤ `b` (par não ordenado); no orientado `a` → `b`. */
type Rec = { id: string; a: string; b: string; weight?: number };

const ends = (directed: boolean, s: string, t: string) =>
  directed || s <= t ? { a: s, b: t } : { a: t, b: s };
const weightPart = (weight: number | undefined): { weight?: number } =>
  weight === undefined ? {} : { weight };
const byId = (x: Rec, y: Rec) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const stripWeight = (rec: Rec): Rec => ({ id: rec.id, a: rec.a, b: rec.b });

function sameRecs(x: readonly Rec[], y: readonly Rec[]): boolean {
  return (
    x.length === y.length &&
    x.every((rec, i) => {
      const other = y[i]!;
      return (
        rec.id === other.id &&
        rec.a === other.a &&
        rec.b === other.b &&
        'weight' in rec === 'weight' in other &&
        Object.is(rec.weight, other.weight)
      );
    })
  );
}

/** O que o modelo (o próprio grafo) diz que existe. */
function modelEdges(graph: Graph): Rec[] {
  return graph.edges
    .map((e) => ({ id: e.id, ...ends(graph.directed, e.source, e.target), ...weightPart(e.weight) }))
    .sort(byId);
}

/** Lista de adjacência: orientado só tem arcos de saída; não orientado tem cada aresta nas duas linhas. */
function fromAdjacencyList(list: AdjacencyList, directed: boolean, issues: string[]): Rec[] {
  const found = new Map<string, Rec>();
  for (const row of list) {
    for (const entry of row.entries) {
      const rec: Rec = {
        id: entry.edgeId,
        ...ends(directed, row.vertexId, entry.vertexId),
        ...weightPart(entry.weight),
      };
      const previous = found.get(rec.id);
      if (previous === undefined) found.set(rec.id, rec);
      else if (directed || !sameRecs([previous], [rec])) {
        issues.push(`lista de adjacência: aresta ${rec.id} repetida ou divergente entre as pontas`);
      }
    }
  }
  return [...found.values()].sort(byId);
}

/** Matriz de adjacência: lê cada célula ocupada; no não orientado exige a célula simétrica igual. */
function fromAdjacencyMatrix(matrix: AdjacencyMatrix, directed: boolean, issues: string[]): Rec[] {
  const out: Rec[] = [];
  matrix.cells.forEach((row, i) =>
    row.forEach((cell, j) => {
      if (cell === null) return;
      const s = matrix.vertexIds[i] ?? '?';
      const t = matrix.vertexIds[j] ?? '?';
      if (i === j) issues.push(`matriz de adjacência: diagonal ocupada em ${s}`);
      if (!directed) {
        const twin = matrix.cells[j]?.[i] ?? null;
        if (twin === null || twin.edgeId !== cell.edgeId || !Object.is(twin.weight, cell.weight)) {
          issues.push(`matriz de adjacência: célula (${s},${t}) sem simétrica igual`);
        }
        if (i > j) return;
      }
      out.push({ id: cell.edgeId, ...ends(directed, s, t), ...weightPart(cell.weight) });
    }),
  );
  return out.sort(byId);
}

/** Matriz de incidência: cada coluna dá os extremos e o sentido; ela NÃO contém pesos. */
function fromIncidenceMatrix(matrix: IncidenceMatrix, directed: boolean, issues: string[]): Rec[] {
  return matrix.edgeIds
    .map((id, j) => {
      const rowsWith = (value: number) =>
        matrix.cells.flatMap((row, i) => (row[j] === value ? [matrix.vertexIds[i] ?? '?'] : []));
      const plus = rowsWith(1);
      const minus = rowsWith(-1);
      if (directed) {
        if (plus.length !== 1 || minus.length !== 1) issues.push(`matriz de incidência: coluna ${id} mal formada`);
        return { id, ...ends(true, plus[0] ?? '?', minus[0] ?? '?') };
      }
      if (plus.length !== 2 || minus.length !== 0) issues.push(`matriz de incidência: coluna ${id} mal formada`);
      return { id, ...ends(false, plus[0] ?? '?', plus[1] ?? '?') };
    })
    .sort(byId);
}

/** Lista de incidência: as entradas `outgoing` definem os arcos e as `incoming` precisam espelhá-las. */
function fromIncidenceList(list: IncidenceList, directed: boolean, issues: string[]): Rec[] {
  const found = new Map<string, Rec>();
  const appearances = new Map<string, number>();
  list.rows.forEach((row, i) => {
    const owner = list.vertexIds[i] ?? '?';
    for (const entry of row) {
      appearances.set(entry.edgeId, (appearances.get(entry.edgeId) ?? 0) + 1);
      if ((entry.role === 'undirected') === directed) {
        issues.push(`lista de incidência: papel ${entry.role} incompatível com a orientação`);
      }
      if (directed && entry.role === 'incoming') continue;
      const rec: Rec = {
        id: entry.edgeId,
        ...ends(directed, owner, entry.oppositeVertexId),
        ...weightPart(entry.weight),
      };
      const previous = found.get(rec.id);
      if (previous === undefined) found.set(rec.id, rec);
      else if (directed || !sameRecs([previous], [rec])) {
        issues.push(`lista de incidência: aresta ${rec.id} repetida ou divergente entre as pontas`);
      }
    }
  });
  if (directed) {
    list.rows.forEach((row, i) => {
      const owner = list.vertexIds[i] ?? '?';
      for (const entry of row.filter((x) => x.role === 'incoming')) {
        const arc = found.get(entry.edgeId);
        if (arc === undefined || arc.a !== entry.oppositeVertexId || arc.b !== owner) {
          issues.push(`lista de incidência: entrada incoming ${entry.edgeId} sem o outgoing correspondente`);
        }
      }
    });
  }
  for (const [id, times] of appearances) {
    if (times !== 2) issues.push(`lista de incidência: aresta ${id} aparece ${times} vez(es), esperado 2`);
  }
  return [...found.values()].sort(byId);
}

// ---------------------------------------------------------------------------------------------
// Verificador: devolve a lista de violações (vazia = as quatro representações descrevem o grafo).
// Usa código simples (sem `expect` por célula) para as sequências repetidas ficarem rápidas.
// ---------------------------------------------------------------------------------------------

function findViolations(graph: Graph, r: Reps): string[] {
  const issues: string[] = [];
  const { al, am, im, il } = r;
  const directed = graph.directed;
  const vertexIds = graph.vertices.map((v) => v.id);
  const edgeIds = graph.edges.map((e) => e.id);
  const n = vertexIds.length;
  const m = edgeIds.length;
  const pos = new Map(vertexIds.map((id, i) => [id, i] as const));
  const edgePos = new Map(edgeIds.map((id, j) => [id, j] as const));

  // 1. Mesmos vértices e arestas, na mesma ordem.
  if (!same(al.map((row) => row.vertexId), vertexIds)) issues.push('lista de adjacência: vértices ou ordem');
  if (!same(am.vertexIds, vertexIds)) issues.push('matriz de adjacência: vértices ou ordem');
  if (!same(im.vertexIds, vertexIds)) issues.push('matriz de incidência: vértices ou ordem');
  if (!same(il.vertexIds, vertexIds)) issues.push('lista de incidência: vértices ou ordem');
  if (!same(im.edgeIds, edgeIds)) issues.push('matriz de incidência: arestas ou ordem das colunas');
  if (am.cells.length !== n || am.cells.some((row) => row.length !== n)) issues.push('matriz de adjacência: dimensões');
  if (im.cells.length !== n || im.cells.some((row) => row.length !== m)) issues.push('matriz de incidência: dimensões');
  if (al.length !== n || il.rows.length !== n) issues.push('listas: número de linhas');

  // 2. Reconstrução das arestas (extremos, sentido, peso) comparada com o modelo.
  const expected = modelEdges(graph);
  const rebuilt: [string, Rec[], boolean][] = [
    ['lista de adjacência', fromAdjacencyList(al, directed, issues), true],
    ['matriz de adjacência', fromAdjacencyMatrix(am, directed, issues), true],
    ['matriz de incidência', fromIncidenceMatrix(im, directed, issues), false],
    ['lista de incidência', fromIncidenceList(il, directed, issues), true],
  ];
  for (const [name, recs, hasWeights] of rebuilt) {
    if (!sameRecs(recs, hasWeights ? expected : expected.map(stripWeight))) {
      issues.push(`${name}: arestas reconstruídas diferem do grafo`);
    }
  }

  // 3. Contagens: entradas, células ocupadas e incidências (2E, pois não há laços).
  const arcs = directed ? m : 2 * m;
  const total = (rows: readonly (readonly unknown[])[]) => rows.reduce((t, row) => t + row.length, 0);
  const occupied = am.cells.flat().filter((cell) => cell !== null).length;
  const nonZero = im.cells.flat().filter((value) => value !== 0).length;
  if (total(al.map((row) => row.entries)) !== arcs) issues.push('lista de adjacência: total de entradas');
  if (occupied !== arcs) issues.push('matriz de adjacência: células ocupadas');
  if (nonZero !== 2 * m) issues.push('matriz de incidência: células não nulas');
  if (total(il.rows) !== 2 * m) issues.push('lista de incidência: total de entradas');

  // 4. Graus calculados direto das arestas (não pelas consultas) e conferidos nas quatro estruturas.
  const out = vertexIds.map(() => 0);
  const inn = vertexIds.map(() => 0);
  for (const e of graph.edges) {
    out[pos.get(e.source)!]!++;
    inn[pos.get(e.target)!]!++;
  }
  vertexIds.forEach((id, i) => {
    const o = out[i]!;
    const t = inn[i]!;
    const grau = o + t;
    const row = im.cells[i] ?? [];
    const colunaOcupada = am.cells.filter((cellsRow) => cellsRow[i] !== null).length;
    const outEsperado = directed ? o : grau;
    const inEsperado = directed ? t : grau;
    if ((al[i]?.entries.length ?? -1) !== outEsperado) issues.push(`lista de adjacência: grau de saída de ${id}`);
    if (am.cells[i]?.filter((cell) => cell !== null).length !== outEsperado) issues.push(`matriz de adjacência: linha de ${id}`);
    if (colunaOcupada !== inEsperado) issues.push(`matriz de adjacência: coluna de ${id}`);
    if ((il.rows[i]?.length ?? -1) !== grau) issues.push(`lista de incidência: grau de ${id}`);
    if (row.reduce<number>((s, v) => s + Math.abs(v), 0) !== grau) issues.push(`matriz de incidência: grau de ${id}`);
    if (directed) {
      if (row.filter((v) => v === 1).length !== o) issues.push(`matriz de incidência: +1 de ${id} ≠ grau de saída`);
      if (row.filter((v) => v === -1).length !== t) issues.push(`matriz de incidência: −1 de ${id} ≠ grau de entrada`);
      if ((il.rows[i] ?? []).filter((x) => x.role === 'outgoing').length !== o) issues.push(`lista de incidência: outgoing de ${id}`);
      if ((il.rows[i] ?? []).filter((x) => x.role === 'incoming').length !== t) issues.push(`lista de incidência: incoming de ${id}`);
    }
    // As consultas do domínio concordam com a contagem direta.
    if (must(degree(graph, id)) !== grau) issues.push(`consulta degree de ${id}`);
    if (must(outDegree(graph, id)) !== outEsperado) issues.push(`consulta outDegree de ${id}`);
    if (must(inDegree(graph, id)) !== inEsperado) issues.push(`consulta inDegree de ${id}`);
  });

  // 5. Papéis da lista de incidência ↔ sinais da matriz de incidência, na mesma ordem.
  il.rows.forEach((row, i) => {
    const doSinal = (im.cells[i] ?? []).flatMap((value, j) =>
      value === 0 ? [] : [`${im.edgeIds[j]}|${value === -1 ? 'incoming' : directed ? 'outgoing' : 'undirected'}`],
    );
    if (!same(row.map((x) => `${x.edgeId}|${x.role}`), doSinal)) issues.push(`papéis × sinais divergem em ${vertexIds[i]}`);
  });

  // 6. Ausência de aresta nunca é confundida com peso zero: posição a posição da matriz de adjacência.
  const byPair = new Map<string, (typeof graph.edges)[number]>();
  for (const e of graph.edges) {
    byPair.set(`${pos.get(e.source)},${pos.get(e.target)}`, e);
    if (!directed) byPair.set(`${pos.get(e.target)},${pos.get(e.source)}`, e);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = am.cells[i]?.[j] ?? null;
      const e = byPair.get(`${i},${j}`);
      if (e === undefined) {
        if (cell !== null) issues.push(`matriz de adjacência: célula (${i},${j}) ocupada sem aresta`);
      } else if (
        cell === null ||
        cell.edgeId !== e.id ||
        'weight' in cell !== 'weight' in e ||
        !Object.is(cell.weight, e.weight)
      ) {
        issues.push(`matriz de adjacência: célula (${i},${j}) não corresponde à aresta ${e.id}`);
      }
    }
  }

  // 7. Ordem: vizinhos crescentes por vértice (adjacência) e arestas crescentes por inserção (incidência).
  for (const row of al) {
    const p = row.entries.map((x) => pos.get(x.vertexId) ?? -1);
    if (p.some((v, k) => k > 0 && v <= p[k - 1]!)) issues.push(`lista de adjacência: ordem dos vizinhos em ${row.vertexId}`);
  }
  il.rows.forEach((row, i) => {
    const p = row.map((x) => edgePos.get(x.edgeId) ?? -1);
    if (p.some((v, k) => k > 0 && v <= p[k - 1]!)) issues.push(`lista de incidência: ordem das arestas em ${vertexIds[i]}`);
  });

  // 8. Identidades (grafos pequenos): B·Bᵀ = D + A (não orientado) e B·Bᵀ = D − (A + Aᵀ) (orientado),
  //    com A binária pela EXISTÊNCIA das arestas (calculada direto do grafo, ignorando pesos).
  if (n <= 12) issues.push(...identityViolations(graph, im));

  return issues;
}

function identityViolations(graph: Graph, im: IncidenceMatrix): string[] {
  const issues: string[] = [];
  const n = graph.vertices.length;
  const pos = new Map(graph.vertices.map((v, i) => [v.id, i] as const));
  const a = graph.vertices.map(() => graph.vertices.map(() => 0));
  const d = graph.vertices.map(() => 0);
  for (const e of graph.edges) {
    const s = pos.get(e.source)!;
    const t = pos.get(e.target)!;
    a[s]![t] = 1;
    if (!graph.directed) a[t]![s] = 1;
    d[s]!++;
    d[t]!++;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const produto = im.edgeIds.reduce((t, _, k) => t + (im.cells[i]?.[k] ?? 0) * (im.cells[j]?.[k] ?? 0), 0);
      const esperado =
        i === j ? d[i]! : graph.directed ? -(a[i]![j]! + a[j]![i]!) : a[i]![j]!;
      if (produto !== esperado) issues.push(`identidade B·Bᵀ falha em (${i},${j}): ${produto} ≠ ${esperado}`);
    }
  }
  return issues;
}

const expectConsistent = (graph: Graph) => expect(findViolations(graph, buildReps(graph))).toStrictEqual([]);

// ---------------------------------------------------------------------------------------------
// Exemplos independentes, com as quatro estruturas calculadas à mão.
// ---------------------------------------------------------------------------------------------

/** G1 orientado: e1 v1→v2 (peso 0), e2 v2→v1 (peso −2), e3 v2→v3 (sem peso), e4 v3→v1 (peso 5); v4 isolado. */
const G1 = (() => {
  let graph = withVertices(4, true);
  graph = connect(graph, 'v1', 'v2', 0);
  graph = connect(graph, 'v2', 'v1', -2);
  graph = connect(graph, 'v2', 'v3');
  return connect(graph, 'v3', 'v1', 5);
})();

/** G2 não orientado: e1 v4–v2 (3), e2 v1–v2 (0), e3 v3–v4 (−1,5), e4 v1–v4 (sem peso); v5 isolado. */
const G2 = (() => {
  let graph = withVertices(5);
  graph = connect(graph, 'v4', 'v2', 3);
  graph = connect(graph, 'v1', 'v2', 0);
  graph = connect(graph, 'v3', 'v4', -1.5);
  return connect(graph, 'v1', 'v4');
})();

describe('exemplo G1 (orientado, com arcos opostos e quatro estados de peso), calculado à mão', () => {
  const r = buildReps(G1);

  it('lista de adjacência: só arcos de saída, vizinhos pela ordem dos vértices', () => {
    expect(r.al).toStrictEqual([
      { vertexId: 'v1', entries: [{ vertexId: 'v2', edgeId: 'e1', weight: 0 }] },
      {
        vertexId: 'v2',
        entries: [
          { vertexId: 'v1', edgeId: 'e2', weight: -2 },
          { vertexId: 'v3', edgeId: 'e3' },
        ],
      },
      { vertexId: 'v3', entries: [{ vertexId: 'v1', edgeId: 'e4', weight: 5 }] },
      { vertexId: 'v4', entries: [] },
    ]);
  });

  it('matriz de adjacência: null só onde não há arco; peso 0 e sem peso são células ocupadas', () => {
    expect(r.am).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4'],
      cells: [
        [null, { edgeId: 'e1', weight: 0 }, null, null],
        [{ edgeId: 'e2', weight: -2 }, null, { edgeId: 'e3' }, null],
        [{ edgeId: 'e4', weight: 5 }, null, null, null],
        [null, null, null, null],
      ],
    });
  });

  it('matriz de incidência: +1 na origem, −1 no destino, sem pesos', () => {
    expect(r.im).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4'],
      edgeIds: ['e1', 'e2', 'e3', 'e4'],
      cells: [
        [1, -1, 0, -1], // v1: sai e1; recebe e2 e e4
        [-1, 1, 1, 0], // v2: recebe e1; sai e2 e e3
        [0, 0, -1, 1], // v3: recebe e3; sai e4
        [0, 0, 0, 0], // v4 isolado
      ],
    });
  });

  it('lista de incidência: arestas na ordem de inserção, com papel, oposto e peso', () => {
    expect(r.il).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4'],
      rows: [
        [
          { edgeId: 'e1', oppositeVertexId: 'v2', role: 'outgoing', weight: 0 },
          { edgeId: 'e2', oppositeVertexId: 'v2', role: 'incoming', weight: -2 },
          { edgeId: 'e4', oppositeVertexId: 'v3', role: 'incoming', weight: 5 },
        ],
        [
          { edgeId: 'e1', oppositeVertexId: 'v1', role: 'incoming', weight: 0 },
          { edgeId: 'e2', oppositeVertexId: 'v1', role: 'outgoing', weight: -2 },
          { edgeId: 'e3', oppositeVertexId: 'v3', role: 'outgoing' },
        ],
        [
          { edgeId: 'e3', oppositeVertexId: 'v2', role: 'incoming' },
          { edgeId: 'e4', oppositeVertexId: 'v1', role: 'outgoing', weight: 5 },
        ],
        [],
      ],
    });
  });

  it('as quatro reconstruções coincidem com as arestas escritas à mão', () => {
    const issues: string[] = [];
    const aMao: Rec[] = [
      { id: 'e1', a: 'v1', b: 'v2', weight: 0 },
      { id: 'e2', a: 'v2', b: 'v1', weight: -2 },
      { id: 'e3', a: 'v2', b: 'v3' },
      { id: 'e4', a: 'v3', b: 'v1', weight: 5 },
    ];

    expect(fromAdjacencyList(r.al, true, issues)).toStrictEqual(aMao);
    expect(fromAdjacencyMatrix(r.am, true, issues)).toStrictEqual(aMao);
    expect(fromIncidenceList(r.il, true, issues)).toStrictEqual(aMao);
    expect(fromIncidenceMatrix(r.im, true, issues)).toStrictEqual(aMao.map(stripWeight));
    expect(issues).toStrictEqual([]);
  });

  it('o verificador aprova G1', () => {
    expectConsistent(G1);
  });
});

describe('exemplo G2 (não orientado, com isolado e quatro estados de peso), calculado à mão', () => {
  const r = buildReps(G2);

  it('lista de adjacência: cada aresta nas duas linhas, vizinhos pela ordem dos vértices', () => {
    expect(r.al).toStrictEqual([
      {
        vertexId: 'v1',
        entries: [
          { vertexId: 'v2', edgeId: 'e2', weight: 0 },
          { vertexId: 'v4', edgeId: 'e4' },
        ],
      },
      {
        vertexId: 'v2',
        entries: [
          { vertexId: 'v1', edgeId: 'e2', weight: 0 },
          { vertexId: 'v4', edgeId: 'e1', weight: 3 },
        ],
      },
      { vertexId: 'v3', entries: [{ vertexId: 'v4', edgeId: 'e3', weight: -1.5 }] },
      {
        vertexId: 'v4',
        entries: [
          { vertexId: 'v1', edgeId: 'e4' },
          { vertexId: 'v2', edgeId: 'e1', weight: 3 },
          { vertexId: 'v3', edgeId: 'e3', weight: -1.5 },
        ],
      },
      { vertexId: 'v5', entries: [] },
    ]);
  });

  it('matriz de adjacência simétrica', () => {
    expect(r.am.cells).toStrictEqual([
      [null, { edgeId: 'e2', weight: 0 }, null, { edgeId: 'e4' }, null],
      [{ edgeId: 'e2', weight: 0 }, null, null, { edgeId: 'e1', weight: 3 }, null],
      [null, null, null, { edgeId: 'e3', weight: -1.5 }, null],
      [{ edgeId: 'e4' }, { edgeId: 'e1', weight: 3 }, { edgeId: 'e3', weight: -1.5 }, null, null],
      [null, null, null, null, null],
    ]);
  });

  it('matriz de incidência: +1 nas duas pontas de cada aresta', () => {
    expect(r.im).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5'],
      edgeIds: ['e1', 'e2', 'e3', 'e4'],
      cells: [
        [0, 1, 0, 1], // v1: e2 e e4
        [1, 1, 0, 0], // v2: e1 e e2
        [0, 0, 1, 0], // v3: e3
        [1, 0, 1, 1], // v4: e1, e3 e e4
        [0, 0, 0, 0], // v5 isolado
      ],
    });
  });

  it('lista de incidência: ordem das arestas (e1, e3, e4 em v4), não a dos vizinhos', () => {
    expect(r.il.rows).toStrictEqual([
      [
        { edgeId: 'e2', oppositeVertexId: 'v2', role: 'undirected', weight: 0 },
        { edgeId: 'e4', oppositeVertexId: 'v4', role: 'undirected' },
      ],
      [
        { edgeId: 'e1', oppositeVertexId: 'v4', role: 'undirected', weight: 3 },
        { edgeId: 'e2', oppositeVertexId: 'v1', role: 'undirected', weight: 0 },
      ],
      [{ edgeId: 'e3', oppositeVertexId: 'v4', role: 'undirected', weight: -1.5 }],
      [
        { edgeId: 'e1', oppositeVertexId: 'v2', role: 'undirected', weight: 3 },
        { edgeId: 'e3', oppositeVertexId: 'v3', role: 'undirected', weight: -1.5 },
        { edgeId: 'e4', oppositeVertexId: 'v1', role: 'undirected' },
      ],
      [],
    ]);
  });

  it('as quatro reconstruções coincidem com as arestas escritas à mão', () => {
    const issues: string[] = [];
    const aMao: Rec[] = [
      { id: 'e1', a: 'v2', b: 'v4', weight: 3 },
      { id: 'e2', a: 'v1', b: 'v2', weight: 0 },
      { id: 'e3', a: 'v3', b: 'v4', weight: -1.5 },
      { id: 'e4', a: 'v1', b: 'v4' },
    ];

    expect(fromAdjacencyList(r.al, false, issues)).toStrictEqual(aMao);
    expect(fromAdjacencyMatrix(r.am, false, issues)).toStrictEqual(aMao);
    expect(fromIncidenceList(r.il, false, issues)).toStrictEqual(aMao);
    expect(fromIncidenceMatrix(r.im, false, issues)).toStrictEqual(aMao.map(stripWeight));
    expect(issues).toStrictEqual([]);
  });

  it('o verificador aprova G2', () => {
    expectConsistent(G2);
  });
});

// ---------------------------------------------------------------------------------------------
// Consistência estrutural e de pesos em vários grafos.
// ---------------------------------------------------------------------------------------------

describe('consistência estrutural das quatro representações', () => {
  const fixtures: [string, Graph][] = [
    ['grafo vazio', withVertices(0)],
    ['grafo vazio orientado', withVertices(0, true)],
    ['um vértice isolado', withVertices(1)],
    ['três vértices isolados (orientado)', withVertices(3, true)],
    ['não orientado, desconexo (U)', U],
    ['orientado com arcos opostos, fonte e sorvedouro (D)', D],
    ['não orientado ponderado (W)', W],
    ['orientado ponderado (WD)', WD],
    ['G1', G1],
    ['G2', G2],
    ['K6', completeGraph(6, false)],
    ['K5 orientado completo', completeGraph(5, true)],
  ];

  it.each(fixtures)('as quatro descrevem o mesmo grafo: %s', (_nome, graph) => {
    expectConsistent(graph);
  });

  it('vértices isolados aparecem nas quatro (linha vazia/zero e coluna/linha de null)', () => {
    for (const graph of [U, D]) {
      const r = buildReps(graph);
      const k = graph.vertices.findIndex((v) => v.id === 'v5');

      expect(r.al[k]!.entries).toHaveLength(0);
      expect(r.am.cells[k]!.every((cell) => cell === null)).toBe(true);
      expect(r.am.cells.every((row) => row[k] === null)).toBe(true);
      expect(r.im.cells[k]!.every((value) => value === 0)).toBe(true);
      expect(r.il.rows[k]).toHaveLength(0);
    }
  });

  it('arcos opostos são diferenciados nas quatro (G1: e1 v1→v2 e e2 v2→v1)', () => {
    const r = buildReps(G1);

    expect(r.al[0]!.entries[0]).toMatchObject({ vertexId: 'v2', edgeId: 'e1' });
    expect(r.al[1]!.entries[0]).toMatchObject({ vertexId: 'v1', edgeId: 'e2' });
    expect(r.am.cells[0]![1]!.edgeId).toBe('e1');
    expect(r.am.cells[1]![0]!.edgeId).toBe('e2');
    expect(r.im.cells.map((row) => row[0])).toStrictEqual([1, -1, 0, 0]); // e1
    expect(r.im.cells.map((row) => row[1])).toStrictEqual([-1, 1, 0, 0]); // e2: sinais trocados
    expect(r.il.rows[0]!.map((x) => [x.edgeId, x.role])).toStrictEqual([
      ['e1', 'outgoing'],
      ['e2', 'incoming'],
      ['e4', 'incoming'],
    ]);
  });

  it('a ordem estabelecida de cada estrutura é preservada, mesmo com arestas criadas fora de ordem', () => {
    const r = buildReps(U); // e1 v3–v4, e2 v3–v1, e3 v3–v2, e4 v2–v1

    expect(r.al[2]!.entries.map((x) => x.vertexId)).toStrictEqual(['v1', 'v2', 'v4']); // por vértice
    expect(r.il.rows[2]!.map((x) => x.oppositeVertexId)).toStrictEqual(['v4', 'v1', 'v2']); // por aresta
    expect(r.im.edgeIds).toStrictEqual(['e1', 'e2', 'e3', 'e4']);
  });
});

describe('pesos: sem peso, zero, positivo e negativo; ausência nunca vira peso zero', () => {
  /** v1–v2 peso 0; v2–v3 sem peso; v3–v4 peso −4; v4–v5 peso 6; v1–v3 e outros pares NÃO existem. */
  const Z = (() => {
    let graph = withVertices(5);
    graph = connect(graph, 'v1', 'v2', 0);
    graph = connect(graph, 'v2', 'v3');
    graph = connect(graph, 'v3', 'v4', -4);
    return connect(graph, 'v4', 'v5', 6);
  })();

  it('as três estruturas que guardam pesos distinguem os quatro estados e concordam entre si', () => {
    const r = buildReps(Z);
    const issues: string[] = [];
    const doAdj = fromAdjacencyList(r.al, false, issues);
    const daMatriz = fromAdjacencyMatrix(r.am, false, issues);
    const daIncidencia = fromIncidenceList(r.il, false, issues);

    expect(issues).toStrictEqual([]);
    expect(doAdj).toStrictEqual(daMatriz);
    expect(daMatriz).toStrictEqual(daIncidencia);
    expect(doAdj.map((x) => [x.id, 'weight' in x ? x.weight : 'sem peso'])).toStrictEqual([
      ['e1', 0],
      ['e2', 'sem peso'],
      ['e3', -4],
      ['e4', 6],
    ]);
  });

  it('ausência de aresta é diferente de peso zero em cada estrutura', () => {
    const r = buildReps(Z);

    expect(r.am.cells[0]![1]).toStrictEqual({ edgeId: 'e1', weight: 0 }); // aresta de peso zero
    expect(r.am.cells[0]![2]).toBeNull(); // não há aresta v1–v3
    expect(r.al[0]!.entries).toStrictEqual([{ vertexId: 'v2', edgeId: 'e1', weight: 0 }]);
    expect(r.il.rows[0]).toStrictEqual([
      { edgeId: 'e1', oppositeVertexId: 'v2', role: 'undirected', weight: 0 },
    ]);
    expect(r.im.cells[0]).toStrictEqual([1, 0, 0, 0]); // aresta de peso zero ainda é incidência
    expect(r.im.cells[2]).toStrictEqual([0, 1, 1, 0]); // v3: e2 e e3
  });

  it('a matriz de incidência não depende dos pesos', () => {
    const semPesos = connect(connect(connect(connect(withVertices(5), 'v1', 'v2'), 'v2', 'v3'), 'v3', 'v4'), 'v4', 'v5');

    expect(incidenceMatrix(Z)).toStrictEqual(incidenceMatrix(semPesos));
    for (const peso of [undefined, 0, -1, 99]) {
      expect(incidenceMatrix(must(setEdgeWeight(Z, 'e1', peso)))).toStrictEqual(incidenceMatrix(Z));
    }
  });

  it('mudar um peso muda exatamente as estruturas que o contêm, nas duas pontas', () => {
    const antes = buildReps(Z);
    const depois = buildReps(must(setEdgeWeight(Z, 'e3', 8)));

    expect(depois.im).toStrictEqual(antes.im);
    expect(depois.am.cells[2]![3]).toStrictEqual({ edgeId: 'e3', weight: 8 });
    expect(depois.am.cells[3]![2]).toStrictEqual({ edgeId: 'e3', weight: 8 });
    expect(depois.al[2]!.entries.find((x) => x.edgeId === 'e3')?.weight).toBe(8);
    expect(depois.al[3]!.entries.find((x) => x.edgeId === 'e3')?.weight).toBe(8);
    expect(depois.il.rows[2]!.find((x) => x.edgeId === 'e3')?.weight).toBe(8);
    expect(depois.il.rows[3]!.find((x) => x.edgeId === 'e3')?.weight).toBe(8);
    expectConsistent(must(setEdgeWeight(Z, 'e3', 8)));
  });

  it('rótulos não influenciam nenhuma das quatro (comparação estrutural)', () => {
    const renomeado = must(setVertexLabel(G1, 'v2', 'Qualquer nome'));

    expect(buildReps(renomeado)).toStrictEqual(buildReps(G1));
  });
});

describe('invariantes e identidades', () => {
  it('B·Bᵀ = D + A (não orientado) e B·Bᵀ = D − (A + Aᵀ) (orientado), com A binária ignorando pesos', () => {
    for (const graph of [U, W, G2, completeGraph(4, false), D, WD, G1, completeGraph(4, true)]) {
      expect(identityViolations(graph, incidenceMatrix(graph))).toStrictEqual([]);
    }
  });

  it('total de incidências = 2·|E| e arcos listados = |E| (orientado) ou 2·|E| (não orientado)', () => {
    for (const graph of [U, D, G1, G2]) {
      const r = buildReps(graph);
      const e = graph.edges.length;

      expect(r.il.rows.flat()).toHaveLength(2 * e);
      expect(r.im.cells.flat().filter((v) => v !== 0)).toHaveLength(2 * e);
      expect(r.al.flatMap((row) => row.entries)).toHaveLength(graph.directed ? e : 2 * e);
      expect(r.am.cells.flat().filter((cell) => cell !== null)).toHaveLength(graph.directed ? e : 2 * e);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Controle negativo: o verificador precisa ACUSAR representações corrompidas (senão ele seria vazio).
// ---------------------------------------------------------------------------------------------

describe('o verificador detecta representações corrompidas', () => {
  const corrupcoes: [string, (r: Reps) => void][] = [
    ['lista de adjacência: entrada removida', (r) => void (r.al[1]!.entries as unknown[]).pop()],
    ['lista de adjacência: edgeId errado', (r) => void ((r.al[1]!.entries[0] as { edgeId: string }).edgeId = 'e9')],
    ['lista de adjacência: peso zero perdido', (r) => void delete (r.al[0]!.entries[0] as { weight?: number }).weight],
    ['lista de adjacência: ordem das linhas', (r) => void (r.al as unknown[]).reverse()],
    ['matriz de adjacência: célula de peso zero vira ausente', (r) => void ((r.am.cells[0] as unknown[])[1] = null)],
    ['matriz de adjacência: arco invertido (transposto)', (r) => {
      const cell = r.am.cells[0]![1];
      (r.am.cells[0] as unknown[])[1] = null;
      (r.am.cells[1] as unknown[])[0] = cell;
    }],
    ['matriz de adjacência: linha removida', (r) => void (r.am.cells as unknown[]).pop()],
    ['matriz de adjacência: peso com sinal trocado', (r) => void ((r.am.cells[1]![0] as { weight: number }).weight = 2)],
    ['matriz de incidência: sinais trocados', (r) => void ((r.im.cells[0] as number[])[0] = -1)],
    ['matriz de incidência: coluna removida', (r) => void r.im.cells.forEach((row) => (row as number[]).pop())],
    ['matriz de incidência: ordem dos vértices', (r) => void (r.im.vertexIds as string[]).reverse()],
    ['lista de incidência: papel trocado', (r) => void ((r.il.rows[0]![0] as { role: string }).role = 'incoming')],
    ['lista de incidência: outro extremo errado', (r) => void ((r.il.rows[0]![0] as { oppositeVertexId: string }).oppositeVertexId = 'v4')],
    ['lista de incidência: aresta só em uma ponta', (r) => void (r.il.rows[1] as unknown[]).shift()],
    ['lista de incidência: peso zero perdido', (r) => void delete (r.il.rows[0]![0] as { weight?: number }).weight],
  ];

  it.each(corrupcoes)('acusa: %s', (_nome, corromper) => {
    const r = copy(buildReps(G1));
    expect(findViolations(G1, r)).toStrictEqual([]); // a cópia limpa passa
    corromper(r);

    expect(findViolations(G1, r).length).toBeGreaterThan(0);
  });

  it('também acusa quando o ERRO está no grafo de entrada das identidades (matriz de incidência adulterada)', () => {
    const im = copy(incidenceMatrix(G2));
    (im.cells[0] as number[])[0] = 1;

    expect(identityViolations(G2, im).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Independência, imutabilidade e determinismo.
// ---------------------------------------------------------------------------------------------

function objectsOf(value: unknown, into: Set<object> = new Set()): Set<object> {
  if (typeof value === 'object' && value !== null && !into.has(value)) {
    into.add(value);
    for (const child of Object.values(value)) objectsOf(child, into);
  }
  return into;
}

describe('independência, imutabilidade e determinismo', () => {
  const grafos: [string, Graph][] = [
    ['U', U], ['D', D], ['W', W], ['WD', WD], ['G1', G1], ['G2', G2], ['K4 orientado', completeGraph(4, true)],
  ];

  it.each(grafos)('nenhuma representação compartilha objeto ou array com o grafo nem entre si (%s)', (_nome, graph) => {
    const r = buildReps(graph);
    const conjuntos: Record<string, Set<object>> = {
      grafo: objectsOf(graph),
      al: objectsOf(r.al),
      am: objectsOf(r.am),
      im: objectsOf(r.im),
      il: objectsOf(r.il),
    };
    const nomes = Object.keys(conjuntos);

    for (const x of nomes) {
      for (const y of nomes) {
        if (x >= y) continue;
        const comuns = [...conjuntos[x]!].filter((objeto) => conjuntos[y]!.has(objeto));
        expect([x, y, comuns.length]).toStrictEqual([x, y, 0]);
      }
    }
  });

  const chaves = ['al', 'am', 'im', 'il'] as const;
  const adulterar: Record<(typeof chaves)[number], (r: Reps) => void> = {
    al: (r) => {
      (r.al[0]!.entries[0] as { weight?: number }).weight = 999;
      (r.al as unknown[]).push('lixo');
    },
    am: (r) => {
      (r.am.cells[0]![1] as { weight?: number }).weight = 999;
      (r.am.vertexIds as string[])[0] = 'lixo';
    },
    im: (r) => {
      (r.im.cells[0] as number[])[0] = 9;
      (r.im.edgeIds as string[])[0] = 'lixo';
    },
    il: (r) => {
      (r.il.rows[0]![0] as { weight?: number }).weight = 999;
      (r.il.vertexIds as string[])[0] = 'lixo';
    },
  };

  it.each(chaves)('alterar a saída de `%s` não modifica as outras três nem o grafo', (chave) => {
    const graph = G2;
    const referencia = buildReps(graph);
    const grafoAntes = JSON.stringify(graph);
    const r = buildReps(graph);

    adulterar[chave](r);

    for (const outra of chaves.filter((c) => c !== chave)) {
      expect(r[outra]).toStrictEqual(referencia[outra]);
    }
    expect(JSON.stringify(graph)).toBe(grafoAntes);
    expect(buildReps(graph)).toStrictEqual(referencia); // novas chamadas continuam iguais ao original
  });

  it('as funções não alteram o grafo recebido (grafos congelados)', () => {
    const antes = grafos.map(([, graph]) => JSON.stringify(graph));

    for (const [, graph] of grafos) buildReps(graph);

    expect(grafos.map(([, graph]) => JSON.stringify(graph))).toStrictEqual(antes);
  });

  it('o resultado é determinístico: novas chamadas e grafos equivalentes dão as mesmas estruturas', () => {
    for (const [, graph] of grafos) {
      expect(buildReps(graph)).toStrictEqual(buildReps(graph));
      expect(JSON.stringify(buildReps(graph))).toBe(JSON.stringify(buildReps(graph)));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Grafos pseudoaleatórios de semente fixa.
// ---------------------------------------------------------------------------------------------

describe('grafos pseudoaleatórios reproduzíveis', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('as quatro representações são consistentes em 200 grafos (orientado = %s)', (directed) => {
    const falhas: string[] = [];
    for (const seed of sementes) {
      const graph = randomGraph(seed, directed);
      for (const problema of findViolations(graph, buildReps(graph))) falhas.push(`semente ${seed}: ${problema}`);
    }

    expect(falhas).toStrictEqual([]);
  });

  it('a mesma semente gera as mesmas quatro estruturas', () => {
    expect(buildReps(randomGraph(42, true))).toStrictEqual(buildReps(randomGraph(42, true)));
    expect(buildReps(randomGraph(7, false))).toStrictEqual(buildReps(randomGraph(7, false)));
  });
});

// ---------------------------------------------------------------------------------------------
// Sequências determinísticas de operações válidas e inválidas, comparadas com um modelo independente.
// ---------------------------------------------------------------------------------------------

type ModelEdge = { id: string; source: string; target: string; weight?: number };
type Model = {
  directed: boolean;
  vertices: { id: string; label: string }[];
  edges: ModelEdge[];
  nextVertex: number;
  nextEdge: number;
};
type Prediction = { ok: true } | { ok: false; code: string };
type Applied = {
  name: string;
  result: Result<Graph>;
  predicted: Prediction;
  /** Operação válida que não muda nada deve devolver o MESMO grafo (mesma referência). */
  expectSameRef: boolean;
  commit: () => void;
};
type Stats = { valid: number; noops: number; codes: Record<string, number>; operations: Record<string, number> };

const MAX_VERTICES = 9;
const WEIGHT_CHOICES: unknown[] = [undefined, undefined, 0, -3, 2.5, 7, -0, Number.NaN, Number.POSITIVE_INFINITY, '3', null];
const ADD_LABELS: unknown[] = [' Nó ', 'X', 'a'.repeat(64), '😀'.repeat(64)];
const INVALID_LABELS: unknown[] = ['', '   ', 'z'.repeat(65), '😀'.repeat(65), null, 7, {}];
const SET_LABELS: unknown[] = ['X', ' Y ', 'A', 'a'.repeat(64), '', '   ', 'b'.repeat(65), 5];

/** Rótulo padrão do modelo, escrito de forma independente da implementação (recursiva). */
const defaultLabelOf = (n: number): string =>
  n <= 26 ? String.fromCharCode(64 + n) : defaultLabelOf(Math.floor((n - 1) / 26)) + defaultLabelOf(((n - 1) % 26) + 1);

function checkLabel(label: unknown): { ok: true; label: string } | { ok: false } {
  if (typeof label !== 'string') return { ok: false };
  const trimmed = label.trim();
  return trimmed === '' || [...trimmed].length > 64 ? { ok: false } : { ok: true, label: trimmed };
}

const isValidWeight = (weight: unknown) => weight === undefined || (typeof weight === 'number' && Number.isFinite(weight));
const normalizedWeight = (weight: unknown): number | undefined =>
  weight === undefined ? undefined : (weight as number) === 0 ? 0 : (weight as number);

function randomOperation(random: () => number, graph: Graph, model: Model): Applied {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const vertexIds = model.vertices.map((v) => v.id);
  const edgeIds = model.edges.map((e) => e.id);
  const existingOr = (ids: string[], missing: string) => (ids.length > 0 && random() > 0.15 ? pick(ids) : missing);
  let kind = Math.floor(random() * 12);
  if (kind <= 1 && vertexIds.length >= MAX_VERTICES) kind = 3; // mantém os grafos pequenos

  switch (kind) {
    case 0:
    case 1:
    case 2: {
      const label: unknown = kind === 0 ? undefined : kind === 1 ? pick(ADD_LABELS) : pick(INVALID_LABELS);
      const checked = label === undefined ? ({ ok: true, label: defaultLabelOf(model.nextVertex) } as const) : checkLabel(label);
      const added = addVertex(graph, label as string | undefined);
      return {
        name: 'addVertex',
        result: added.ok ? ok(added.value.graph) : added,
        predicted: checked.ok ? { ok: true } : { ok: false, code: 'INVALID_VERTEX_LABEL' },
        expectSameRef: false,
        commit: () => {
          if (checked.ok) model.vertices.push({ id: `v${model.nextVertex}`, label: checked.label });
          model.nextVertex++;
        },
      };
    }
    case 3: {
      const id = existingOr(vertexIds, 'v999');
      return {
        name: 'removeVertex',
        result: removeVertex(graph, id),
        predicted: vertexIds.includes(id) ? { ok: true } : { ok: false, code: 'VERTEX_NOT_FOUND' },
        expectSameRef: false,
        commit: () => {
          model.vertices = model.vertices.filter((v) => v.id !== id);
          model.edges = model.edges.filter((e) => e.source !== id && e.target !== id);
        },
      };
    }
    case 4:
    case 5:
    case 6:
    case 7: {
      let source = existingOr(vertexIds, 'v999');
      let target = existingOr(vertexIds, 'v998');
      if (vertexIds.length >= 2 && random() > 0.25) {
        source = pick(vertexIds);
        target = pick(vertexIds.filter((id) => id !== source));
      }
      const weight = pick(WEIGHT_CHOICES);
      let predicted: Prediction = { ok: true };
      if (!vertexIds.includes(source) || !vertexIds.includes(target)) predicted = { ok: false, code: 'VERTEX_NOT_FOUND' };
      else if (source === target) predicted = { ok: false, code: 'SELF_LOOP' };
      else if (!isValidWeight(weight)) predicted = { ok: false, code: 'INVALID_WEIGHT' };
      else if (model.edges.some((e) => (e.source === source && e.target === target) || (!model.directed && e.source === target && e.target === source))) {
        predicted = { ok: false, code: 'DUPLICATE_EDGE' };
      }
      const added = addEdge(graph, { source, target, weight: weight as number | undefined });
      return {
        name: 'addEdge',
        result: added.ok ? ok(added.value.graph) : added,
        predicted,
        expectSameRef: false,
        commit: () => {
          const w = normalizedWeight(weight);
          model.edges.push({ id: `e${model.nextEdge}`, source, target, ...(w === undefined ? {} : { weight: w }) });
          model.nextEdge++;
        },
      };
    }
    case 8: {
      const id = existingOr(edgeIds, 'e999');
      return {
        name: 'removeEdge',
        result: removeEdge(graph, id),
        predicted: edgeIds.includes(id) ? { ok: true } : { ok: false, code: 'EDGE_NOT_FOUND' },
        expectSameRef: false,
        commit: () => void (model.edges = model.edges.filter((e) => e.id !== id)),
      };
    }
    case 9: {
      const id = existingOr(vertexIds, 'v999');
      const label = pick(SET_LABELS);
      const checked = checkLabel(label);
      const vertex = model.vertices.find((v) => v.id === id);
      let predicted: Prediction = { ok: true };
      if (!vertex) predicted = { ok: false, code: 'VERTEX_NOT_FOUND' };
      else if (!checked.ok) predicted = { ok: false, code: 'INVALID_VERTEX_LABEL' };
      return {
        name: 'setVertexLabel',
        result: setVertexLabel(graph, id, label as string),
        predicted,
        expectSameRef: vertex !== undefined && checked.ok && vertex.label === checked.label,
        commit: () => {
          if (vertex && checked.ok) vertex.label = checked.label;
        },
      };
    }
    default: {
      const id = existingOr(edgeIds, 'e999');
      const weight = pick(WEIGHT_CHOICES);
      const edge = model.edges.find((e) => e.id === id);
      let predicted: Prediction = { ok: true };
      if (!edge) predicted = { ok: false, code: 'EDGE_NOT_FOUND' };
      else if (!isValidWeight(weight)) predicted = { ok: false, code: 'INVALID_WEIGHT' };
      const next = normalizedWeight(weight);
      return {
        name: 'setEdgeWeight',
        result: setEdgeWeight(graph, id, weight as number | undefined),
        predicted,
        expectSameRef: edge !== undefined && Object.is(edge.weight, next),
        commit: () => {
          if (!edge) return;
          if (next === undefined) delete edge.weight;
          else edge.weight = next;
        },
      };
    }
  }
}

function modelMismatch(graph: Graph, model: Model): boolean {
  const esperado = {
    directed: model.directed,
    vertices: model.vertices,
    edges: model.edges,
    nextVertexSeq: model.nextVertex,
    nextEdgeSeq: model.nextEdge,
  };
  const real = {
    directed: graph.directed,
    vertices: graph.vertices,
    edges: graph.edges,
    nextVertexSeq: graph.nextVertexSeq,
    nextEdgeSeq: graph.nextEdgeSeq,
  };
  return !same(real, esperado);
}

function runSequence(seed: number, directed: boolean, steps: number, stats: Stats): { problems: string[]; final: Graph } {
  const random = seededRandom(seed * 1_000_003 + (directed ? 17 : 5));
  const problems: string[] = [];
  let graph = deepFreeze(createGraph({ id: 'g', directed }));
  const model: Model = { directed, vertices: [], edges: [], nextVertex: 1, nextEdge: 1 };
  let previous = buildReps(graph);

  for (let step = 1; step <= steps; step++) {
    const tag = `semente ${seed} (${directed ? 'orientado' : 'não orientado'}), passo ${step}`;
    const applied = randomOperation(random, graph, model);
    stats.operations[applied.name] = (stats.operations[applied.name] ?? 0) + 1;
    const { result, predicted } = applied;

    if (result.ok !== predicted.ok) {
      problems.push(`${tag}: ${applied.name} devolveu ok=${result.ok}, o modelo previa ok=${predicted.ok}`);
      break;
    }

    if (!result.ok) {
      // Operação inválida: código previsto, nada mudou, ids não foram consumidos, representações iguais.
      const code = result.error.code;
      stats.codes[code] = (stats.codes[code] ?? 0) + 1;
      if (!predicted.ok && code !== predicted.code) problems.push(`${tag}: ${applied.name} código ${code}, previsto ${predicted.ok ? '' : predicted.code}`);
      if (modelMismatch(graph, model)) problems.push(`${tag}: operação inválida alterou o grafo ou os contadores de ids`);
      if (!same(buildReps(graph), previous)) problems.push(`${tag}: representações mudaram depois de operação inválida`);
      continue;
    }

    // Operação válida: atualiza o modelo, congela o novo grafo e confere tudo de novo.
    applied.commit();
    stats.valid++;
    const next = deepFreeze(result.value);
    if (applied.expectSameRef) {
      stats.noops++;
      if (next !== graph) problems.push(`${tag}: ${applied.name} sem mudança deveria devolver o mesmo grafo`);
    }
    graph = next;
    if (modelMismatch(graph, model)) {
      problems.push(`${tag}: ${applied.name} deixou o grafo diferente do modelo`);
      break;
    }
    const reps = buildReps(graph);
    for (const violation of findViolations(graph, reps).slice(0, 3)) problems.push(`${tag}: ${violation}`);
    if (!same(buildReps(graph), reps)) problems.push(`${tag}: representações não determinísticas`);
    if (applied.expectSameRef && !same(reps, previous)) problems.push(`${tag}: no-op alterou as representações`);
    previous = reps;
  }
  return { problems, final: graph };
}

describe('sequências determinísticas de operações válidas e inválidas (modelo independente)', () => {
  const SEEDS = 100;
  const STEPS = 80;

  it.each([false, true])('as quatro permanecem consistentes a cada passo (orientado = %s)', (directed) => {
    const stats: Stats = { valid: 0, noops: 0, codes: {}, operations: {} };
    const problems: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) problems.push(...runSequence(seed, directed, STEPS, stats).problems);

    expect(problems).toStrictEqual([]);
    // Sanidade do gerador: precisa exercitar todos os tipos de operação e todos os códigos de erro.
    expect(stats.valid).toBeGreaterThan(SEEDS * STEPS * 0.3);
    expect(stats.noops).toBeGreaterThan(0);
    for (const code of ['VERTEX_NOT_FOUND', 'EDGE_NOT_FOUND', 'SELF_LOOP', 'DUPLICATE_EDGE', 'INVALID_WEIGHT', 'INVALID_VERTEX_LABEL']) {
      expect(stats.codes[code] ?? 0).toBeGreaterThan(0);
    }
    for (const name of ['addVertex', 'removeVertex', 'addEdge', 'removeEdge', 'setVertexLabel', 'setEdgeWeight']) {
      expect(stats.operations[name] ?? 0).toBeGreaterThan(0);
    }
  });

  it('é reproduzível: a mesma semente gera a mesma sequência e o mesmo grafo final', () => {
    const a = runSequence(11, true, STEPS, { valid: 0, noops: 0, codes: {}, operations: {} });
    const b = runSequence(11, true, STEPS, { valid: 0, noops: 0, codes: {}, operations: {} });

    expect(a.problems).toStrictEqual([]);
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
    expect(buildReps(a.final)).toStrictEqual(buildReps(b.final));
  });

  it('o modelo e o verificador não são vácuos: um domínio com defeito seria apontado', () => {
    // Sequência curta, mas com um grafo final corrompido à mão depois: o verificador precisa reprovar.
    const { final } = runSequence(3, false, STEPS, { valid: 0, noops: 0, codes: {}, operations: {} });
    const r = copy(buildReps(final));
    expect(findViolations(final, r)).toStrictEqual([]);
    if (final.edges.length > 0) {
      (r.im.cells[0] as number[])[0] = (r.im.cells[0]![0] ?? 0) === 0 ? 1 : 0;
      expect(findViolations(final, r).length).toBeGreaterThan(0);
    }
  });
});
