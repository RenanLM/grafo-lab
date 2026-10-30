import {
  adjacencyList,
  adjacencyMatrix,
  addVertex,
  createGraph,
  GRAPH_SCHEMA_VERSION,
  incidenceList,
  incidenceMatrix,
  parseGraph,
  parseGraphJson,
  serializeGraph,
  type Edge,
  type Graph,
  type GraphError,
  type Result,
} from './index';
import {
  connect,
  deepFreeze,
  digraphWithOpposites as D,
  directedOppositeArcs,
  listGolden,
  listGoldenVersions,
  must,
  randomGraph,
  randomHistory,
  randomOperation,
  readGolden,
  seededRandom,
  startOfHistory,
  triangleWithTail as U,
  undirectedAfterRemovals,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Contrato de persistência do esquema v1: o que uma versão futura do app (esquema v2, migrações, camada de
// persistência) NÃO pode quebrar. Usa só a API pública (`./index`) e uma coleção de grafos, e olha para a
// FRONTEIRA entre `serializeGraph` e `parseGraph`/`parseGraphJson`. Os detalhes de cada lado já têm suíte própria
// (`serialization.test.ts`: formato; `deserialization.test.ts`: validação) e não são repetidos aqui.
//
// Mapa dos contratos (numeração do Incremento 4.3):
//   1 compatibilidade serializador × leitor ........ "o serializador e o leitor são inversos"
//   2 estabilidade do formato v1 ................... "arquivos de referência" e "o formato v1 é o documentado"
//   3 a 8 identidade, orientação, vértices, arestas, rótulos, pesos (ausente × zero), contadores e ordem
//                                                     "o formato distingue …" (um grafo diferente dá um texto
//                                                     diferente, e a leitura devolve exatamente o gravado)
//   6 contadores e 9 representações ao longo do uso . "persistir é transparente ao longo de gerações"
//   10 determinismo ................................. "determinismo"
//   compatibilidade de versões ...................... "versões futuras do esquema"

type Obj = Record<string, unknown>;

const DOC_KEYS = 'schemaVersion,id,name,directed,vertices,edges,nextVertexSeq,nextEdgeSeq';

// ---------------------------------------------------------------------------------------------
// Coleção de grafos do contrato
// ---------------------------------------------------------------------------------------------

/** Textos e pesos nos limites: aspas, barra invertida, quebra de linha, Unicode, 64 pontos de código, `__proto__`. */
function extremesGraph(): Graph {
  let graph = createGraph({ id: 'g-ç/ü"\\', name: 'Königsberg 日本語 🙂 "aspas" \\ \n', directed: false });
  for (const label of ['a'.repeat(64), '😀'.repeat(64), 'A B', '__proto__']) {
    graph = must(addVertex(graph, label)).graph;
  }
  graph = connect(graph, 'v1', 'v2', Number.MAX_VALUE);
  graph = connect(graph, 'v2', 'v3', 5e-324);
  graph = connect(graph, 'v3', 'v4', -1e21);
  return connect(graph, 'v4', 'v1');
}

const CORPUS: readonly (readonly [name: string, graph: Graph])[] = [
  ['vazio', createGraph({ id: 'g1' })],
  ['vazio, orientado, com nome', createGraph({ id: 'g-dir', name: 'Meu dígrafo', directed: true })],
  ['um vértice', withVertices(1)],
  ['vértices isolados', withVertices(4)],
  ['triângulo com haste (U)', U],
  ['orientado com arcos opostos (D)', D],
  ['pesos nos quatro estados (W)', W],
  ['orientado ponderado (WD)', WD],
  ['referência: não orientado depois de remoções', undirectedAfterRemovals()],
  ['referência: orientado com arcos opostos', directedOppositeArcs()],
  ['textos e pesos nos limites', extremesGraph()],
  ...[1, 2, 3, 4, 5, 6].flatMap((seed): [string, Graph][] => [
    [`aleatório ${seed} (não orientado)`, randomGraph(seed * 7, false)],
    [`aleatório ${seed} (orientado)`, randomGraph(seed * 7, true)],
  ]),
  ...[11, 12, 13, 14].flatMap((seed): [string, Graph][] => [
    [`após edições ${seed} (não orientado)`, randomHistory(seed, false, 80).at(-1)!],
    [`após edições ${seed} (orientado)`, randomHistory(seed, true, 80).at(-1)!],
  ]),
];

// ---------------------------------------------------------------------------------------------
// Verificador do formato v1, escrito a partir da tabela de ARCHITECTURE.md (independe do serializador)
// ---------------------------------------------------------------------------------------------

/** Problemas de FORMA de um texto compacto (não precisa do grafo): chaves, ordem, tipos, ausência de espaços. */
function shapeProblems(text: string): string[] {
  const problems: string[] = [];
  const doc = JSON.parse(text) as Obj & { vertices: Obj[]; edges: Obj[] };
  if (JSON.stringify(doc) !== text) problems.push('não é o JSON compacto');
  if (Object.keys(doc).join() !== DOC_KEYS) problems.push('chaves da raiz');
  if (doc.schemaVersion !== 1) problems.push('schemaVersion');
  if (typeof doc.id !== 'string' || typeof doc.name !== 'string' || typeof doc.directed !== 'boolean') {
    problems.push('tipos de id/name/directed');
  }
  if (!Number.isSafeInteger(doc.nextVertexSeq) || !Number.isSafeInteger(doc.nextEdgeSeq)) problems.push('contadores');
  for (const vertex of doc.vertices) {
    if (Object.keys(vertex).join() !== 'id,label') problems.push('chaves de vértice');
  }
  for (const edge of doc.edges) {
    const keys = Object.keys(edge).join();
    if (keys !== 'id,source,target' && keys !== 'id,source,target,weight') problems.push('chaves de aresta');
    if ('weight' in edge && typeof edge.weight !== 'number') problems.push('tipo do peso');
  }
  return problems;
}

/** Forma + conteúdo: o texto de `graph` diz exatamente o que o grafo tem, na ordem do grafo. */
function specProblems(graph: Graph, text: string): string[] {
  const problems = shapeProblems(text);
  const doc = JSON.parse(text) as Obj & { vertices: Obj[]; edges: Obj[] };
  if (doc.id !== graph.id || doc.name !== graph.name || doc.directed !== graph.directed) problems.push('identidade');
  if (doc.nextVertexSeq !== graph.nextVertexSeq || doc.nextEdgeSeq !== graph.nextEdgeSeq) problems.push('contadores');
  if (JSON.stringify(doc.vertices) !== JSON.stringify(graph.vertices.map((v) => ({ id: v.id, label: v.label })))) {
    problems.push('vértices');
  }
  const edges = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.weight === undefined ? {} : { weight: e.weight }) }));
  if (JSON.stringify(doc.edges) !== JSON.stringify(edges)) problems.push('arestas');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// 2. Estabilidade do formato v1
// ---------------------------------------------------------------------------------------------

describe('arquivos de referência: o contrato de compatibilidade do v1', () => {
  // Alterar esta lista, ou o conteúdo de um arquivo, é uma DECISÃO EXPLÍCITA de mudar o contrato: documente-a no
  // ROADMAP/ARCHITECTURE. Os arquivos de uma versão nunca são regenerados; versões novas ganham pasta nova.
  const ARQUIVOS = [
    'directed-opposite-arcs.json',
    'directed-opposite-arcs.pretty.json',
    'empty.json',
    'undirected-weighted-after-removals.json',
  ];

  it('existe uma pasta por versão do esquema (hoje só a v1) e os arquivos são os esperados', () => {
    expect(listGoldenVersions()).toStrictEqual(['v1']);
    expect(listGolden()).toStrictEqual(ARQUIVOS);
  });

  it.each(ARQUIVOS)('%s: forma do v1, leitura sem perdas e texto idêntico ao reescrever', (arquivo) => {
    const texto = readGolden(arquivo);
    const legivel = texto.includes('\n');
    const compacto = legivel ? JSON.stringify(JSON.parse(texto)) : texto;
    const graph = must(parseGraphJson(texto));

    expect(shapeProblems(compacto)).toStrictEqual([]);
    expect(graph.schemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    expect(specProblems(graph, compacto)).toStrictEqual([]);
    expect(serializeGraph(graph, { pretty: legivel })).toBe(texto);
  });

  it('as versões de documento que o app grava são as que ele lê: a v1 é a única e vem do mesmo número', () => {
    expect(GRAPH_SCHEMA_VERSION).toBe(1);
    expect(listGoldenVersions()).toStrictEqual([`v${GRAPH_SCHEMA_VERSION}`]);
  });
});

describe('o formato v1 é o documentado', () => {
  it.each(CORPUS)('%s: o texto compacto cumpre a especificação do v1', (_nome, graph) => {
    expect(specProblems(graph, serializeGraph(graph))).toStrictEqual([]);
  });

  it.each(CORPUS)('%s: o texto legível é o mesmo documento com recuo de 2 espaços', (_nome, graph) => {
    const legivel = serializeGraph(graph, { pretty: true });

    expect(JSON.stringify(JSON.parse(legivel), null, 2)).toBe(legivel);
    expect(JSON.stringify(JSON.parse(legivel))).toBe(serializeGraph(graph));
  });

  it('o verificador da especificação acusa desvios (controle negativo)', () => {
    const texto = serializeGraph(W);
    const doc = JSON.parse(texto) as Obj & { edges: Obj[] };
    const trocaChaves = JSON.stringify({ id: doc.id, schemaVersion: doc.schemaVersion, ...doc });
    const peso1 = JSON.stringify({ ...doc, edges: doc.edges.map((e) => ({ weight: 1, ...e })) });

    expect(shapeProblems(texto)).toStrictEqual([]);
    expect(shapeProblems(JSON.stringify(doc, null, 1))).toContain('não é o JSON compacto');
    expect(shapeProblems(trocaChaves)).toContain('chaves da raiz');
    expect(shapeProblems(peso1)).toContain('chaves de aresta');
    expect(specProblems(U, texto)).not.toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 1. Compatibilidade entre o serializador e o leitor
// ---------------------------------------------------------------------------------------------

describe('o serializador e o leitor são inversos', () => {
  it.each(CORPUS)('%s', (_nome, graph) => {
    const compacto = serializeGraph(graph);
    const legivel = serializeGraph(graph, { pretty: true });

    expect(parseGraphJson(compacto)).toStrictEqual({ ok: true, value: graph });
    expect(parseGraphJson(legivel)).toStrictEqual({ ok: true, value: graph });
    expect(parseGraph(JSON.parse(compacto))).toStrictEqual({ ok: true, value: graph });
    // ponto fixo: reescrever o que se leu não muda uma vírgula
    expect(serializeGraph(must(parseGraphJson(compacto)))).toBe(compacto);
    expect(serializeGraph(must(parseGraphJson(legivel)), { pretty: true })).toBe(legivel);
  });
});

// ---------------------------------------------------------------------------------------------
// 3 a 8. Identidade, orientação, vértices, arestas, rótulos, pesos, contadores e ordem
// ---------------------------------------------------------------------------------------------

const hasOppositePair = (graph: Graph) =>
  graph.edges.some((a) => graph.edges.some((b) => a.source === b.target && a.target === b.source));
const swapFirstTwo = <T>(items: readonly T[]): T[] | undefined =>
  items.length < 2 ? undefined : [items[1]!, items[0]!, ...items.slice(2)];
const replaceEdge = (graph: Graph, index: number, edge: Edge): Graph => ({
  ...graph,
  edges: graph.edges.map((e, i) => (i === index ? edge : e)),
});
const withoutWeight = ({ weight: _weight, ...rest }: Edge): Edge => rest;

/**
 * Um grafo que difere de `graph` em UM aspecto do contrato (ou `undefined` se o aspecto não se aplica ou geraria
 * um grafo inválido). Montado por cópia de objetos, sem as operações do domínio, para poder trocar a ordem.
 */
type Variant = readonly [aspect: string, make: (graph: Graph) => Graph | undefined];
const VARIANTS: readonly Variant[] = [
  ['identidade: id do grafo', (g) => ({ ...g, id: `${g.id}-2` })],
  ['identidade: nome do grafo', (g) => ({ ...g, name: `${g.name} (cópia)` })],
  [
    'orientação',
    (g) => (!g.directed ? { ...g, directed: true } : hasOppositePair(g) ? undefined : { ...g, directed: false }),
  ],
  ['ordem dos vértices', (g) => { const v = swapFirstTwo(g.vertices); return v && { ...g, vertices: v }; }],
  ['ordem das arestas', (g) => { const e = swapFirstTwo(g.edges); return e && { ...g, edges: e }; }],
  [
    'rótulo de um vértice',
    (g) => g.vertices.length === 0 ? undefined : { ...g, vertices: g.vertices.map((v, i) => (i === 0 ? { ...v, label: 'Rótulo novo' } : v)) },
  ],
  [
    'peso: ausente → zero',
    (g) => { const i = g.edges.findIndex((e) => e.weight === undefined); return i < 0 ? undefined : replaceEdge(g, i, { ...g.edges[i]!, weight: 0 }); },
  ],
  [
    'peso: zero → ausente',
    (g) => { const i = g.edges.findIndex((e) => e.weight === 0); return i < 0 ? undefined : replaceEdge(g, i, withoutWeight(g.edges[i]!)); },
  ],
  [
    'peso: valor (o sinal troca)',
    (g) => { const i = g.edges.findIndex((e) => e.weight !== undefined && e.weight !== 0); return i < 0 ? undefined : replaceEdge(g, i, { ...g.edges[i]!, weight: -g.edges[i]!.weight! }); },
  ],
  [
    'extremos de uma aresta (a ordem em que foi criada)',
    (g) => {
      const edge = g.edges[0];
      if (edge === undefined) return undefined;
      const swapped = { ...edge, source: edge.target, target: edge.source };
      const clash = g.directed && g.edges.some((o) => o.source === swapped.source && o.target === swapped.target);
      return clash ? undefined : replaceEdge(g, 0, swapped);
    },
  ],
  ['contador de vértices', (g) => ({ ...g, nextVertexSeq: g.nextVertexSeq + 1 })],
  ['contador de arestas', (g) => ({ ...g, nextEdgeSeq: g.nextEdgeSeq + 1 })],
];

describe.each(VARIANTS)('o formato distingue: %s', (_aspecto, make) => {
  it('um grafo diferente dá um texto diferente, e a leitura devolve exatamente o gravado', () => {
    let aplicados = 0;
    for (const [nome, graph] of CORPUS) {
      const variant = make(graph);
      if (variant === undefined) continue;
      aplicados++;
      const texto = serializeGraph(variant);

      expect([nome, texto === serializeGraph(graph)]).toStrictEqual([nome, false]);
      expect(parseGraphJson(texto)).toStrictEqual({ ok: true, value: variant });
      expect([nome, parseGraphJson(texto)]).not.toStrictEqual([nome, { ok: true, value: graph }]);
    }

    // o aspecto é exercitado de verdade (não passa por vacuidade)
    expect(aplicados).toBeGreaterThanOrEqual(6);
  });
});

describe('o formato iguala grafos iguais', () => {
  it('cópia profunda feita por outro caminho gera o mesmo texto', () => {
    for (const [, graph] of CORPUS) {
      const copia = JSON.parse(JSON.stringify(graph)) as Graph;

      expect(serializeGraph(copia)).toBe(serializeGraph(graph));
      expect(serializeGraph(must(parseGraph(copia)))).toBe(serializeGraph(graph));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 6 e 9. Contadores e representações ao longo do uso
// ---------------------------------------------------------------------------------------------

describe('persistir é transparente ao longo de gerações de editar e salvar', () => {
  /** Quatro representações, para comparar de uma vez. */
  const representations = (graph: Graph) => [adjacencyList(graph), adjacencyMatrix(graph), incidenceMatrix(graph), incidenceList(graph)];
  const numericId = (id: string) => Number(id.slice(1));

  it.each([false, true])('25 histórias de 12 gerações: o grafo salvo e relido é igual ao que nunca foi salvo (orientado = %s)', (directed) => {
    let gerações = 0;
    let idsNovos = 0;
    let idsRemovidos = 0;

    for (let seed = 1; seed <= 25; seed++) {
      const sorteioA = seededRandom(5000 + seed);
      const sorteioB = seededRandom(5000 + seed);
      let persistido = startOfHistory(seed, directed); // passa pelo texto a cada geração
      let gemeo = startOfHistory(seed, directed); // nunca passa pelo texto
      let anterior = persistido;

      for (let geração = 1; geração <= 12; geração++) {
        for (let k = 0; k < 6; k++) {
          persistido = randomOperation(persistido, sorteioA);
          gemeo = randomOperation(gemeo, sorteioB);
        }
        const texto = serializeGraph(persistido);
        persistido = must(parseGraphJson(texto));
        gerações++;

        // transparência: salvar e reler não muda o que as edições seguintes enxergam
        expect(persistido).toStrictEqual(gemeo);
        expect(texto).toBe(serializeGraph(gemeo));
        expect(representations(persistido)).toStrictEqual(representations(gemeo));

        // contadores: nunca recuam, e todo id novo vem do contador anterior em diante (nenhum id reaproveitado)
        expect(persistido.nextVertexSeq).toBeGreaterThanOrEqual(anterior.nextVertexSeq);
        expect(persistido.nextEdgeSeq).toBeGreaterThanOrEqual(anterior.nextEdgeSeq);
        const antesV = new Set(anterior.vertices.map((v) => v.id));
        const antesE = new Set(anterior.edges.map((e) => e.id));
        for (const vertex of persistido.vertices) {
          if (antesV.has(vertex.id)) continue;
          idsNovos++;
          expect(numericId(vertex.id)).toBeGreaterThanOrEqual(anterior.nextVertexSeq);
        }
        for (const edge of persistido.edges) {
          if (antesE.has(edge.id)) continue;
          idsNovos++;
          expect(numericId(edge.id)).toBeGreaterThanOrEqual(anterior.nextEdgeSeq);
        }
        const agoraV = new Set(persistido.vertices.map((v) => v.id));
        idsRemovidos += anterior.vertices.filter((v) => !agoraV.has(v.id)).length;
        anterior = persistido;
      }
    }

    // a história exercita o que o contrato protege: muitas gerações, ids novos e ids removidos
    expect(gerações).toBe(300);
    expect(idsNovos).toBeGreaterThan(100);
    expect(idsRemovidos).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------
// 10. Determinismo
// ---------------------------------------------------------------------------------------------

describe('determinismo', () => {
  const emTodos = () => CORPUS.map(([, graph]) => {
    const texto = serializeGraph(graph);
    const legivel = serializeGraph(graph, { pretty: true });
    return [texto, legivel, parseGraphJson(texto), parseGraph(JSON.parse(legivel))] as const;
  });

  it('o mesmo grafo dá o mesmo texto e o mesmo grafo lido, sempre', () => {
    expect(emTodos()).toStrictEqual(emTodos());
  });

  it('não depende de relógio, aleatoriedade, ordenação nem localidade', () => {
    const esperado = emTodos();
    const proibido = (nome: string) => () => {
      throw new Error(`${nome} não deve ser usado`);
    };
    const espioes = [
      jest.spyOn(Math, 'random').mockImplementation(proibido('Math.random')),
      jest.spyOn(Date, 'now').mockImplementation(proibido('Date.now')),
      jest.spyOn(Array.prototype, 'sort').mockImplementation(proibido('Array.prototype.sort')),
      jest.spyOn(String.prototype, 'localeCompare').mockImplementation(proibido('localeCompare')),
      jest.spyOn(Number.prototype, 'toLocaleString').mockImplementation(proibido('toLocaleString')),
    ];
    let obtido: ReturnType<typeof emTodos>;
    try {
      obtido = emTodos();
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }

    expect(obtido).toStrictEqual(esperado);
  });

  it('o texto não muda quando o objeto recebido chega com as propriedades em outra ordem', () => {
    for (const [, graph] of CORPUS) {
      const embaralhado = {
        nextEdgeSeq: graph.nextEdgeSeq,
        edges: graph.edges.map((e) => Object.fromEntries(Object.entries(e).reverse())),
        directed: graph.directed,
        vertices: graph.vertices.map((v) => ({ label: v.label, id: v.id })),
        name: graph.name,
        id: graph.id,
        nextVertexSeq: graph.nextVertexSeq,
        schemaVersion: graph.schemaVersion,
      } as unknown as Graph;

      expect(serializeGraph(embaralhado)).toBe(serializeGraph(graph));
    }
  });
});

describe('o leitor nunca "conserta" um documento: o que não é canônico é recusado, não corrigido', () => {
  // O único ajuste permitido é `-0` → `0` (o domínio faz o mesmo); todo o resto que exigiria correção é erro.
  const docs: [string, (doc: Obj & { vertices: Obj[]; edges: Obj[] }) => void][] = [
    ['rótulo com espaço nas pontas', (d) => (d.vertices[0]!.label = ' A')],
    ['rótulo com quebra de linha no fim', (d) => (d.vertices[0]!.label = 'A\n')],
    ['id de vértice com zero à esquerda', (d) => (d.vertices[0]!.id = 'v01')],
    ['contador atrás dos ids', (d) => (d.nextVertexSeq = 1)],
    ['peso nulo no lugar de ausente', (d) => (d.edges[0]!.weight = null)],
    ['peso em texto', (d) => (d.edges[0]!.weight = '0')],
    ['campo extra de interface', (d) => (d.vertices[0]!.x = 10)],
  ];

  it.each(docs)('%s', (_nome, mudar) => {
    const doc = JSON.parse(readGolden('directed-opposite-arcs.json')) as Obj & { vertices: Obj[]; edges: Obj[] };
    mudar(doc);

    for (const resultado of [parseGraph(doc), parseGraphJson(JSON.stringify(doc))]) {
      expect(resultado.ok).toBe(false);
      expect(resultado).not.toHaveProperty('value');
    }
  });

  it('o ajuste de `-0` para `0` é o único: o resultado sai como o domínio o teria gravado', () => {
    const doc = JSON.parse(readGolden('directed-opposite-arcs.json')) as Obj & { edges: Obj[] };
    doc.edges[0]!.weight = -0;

    expect(must(parseGraph(doc)).edges[0]!.weight).toBe(0);
    expect(Object.is(must(parseGraph(doc)).edges[0]!.weight, -0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Compatibilidade de versões: o leitor v1 diante de documentos de versões futuras
// ---------------------------------------------------------------------------------------------

describe('versões futuras do esquema', () => {
  // Documentos FICTÍCIOS da versão 2, só para este teste (não são arquivos de referência e nada os lê).
  // (a) v2 aditiva: tem todos os campos do v1 e acrescenta outros (o caso mais enganoso para um leitor frouxo).
  const v2Aditivo = (): Obj => ({
    schemaVersion: 2,
    id: 'g-futuro',
    name: 'Documento da versão 2',
    directed: true,
    vertices: [
      { id: 'v1', label: 'Fonte', kind: 'source' },
      { id: 'v2', label: 'Sorvedouro', kind: 'sink' },
    ],
    edges: [{ id: 'e1', source: 'v1', target: 'v2', weight: 3, capacity: 10 }],
    layout: { v1: { x: 0, y: 0 }, v2: { x: 100, y: 0 } },
    nextVertexSeq: 3,
    nextEdgeSeq: 2,
  });
  // (b) v2 reestruturada: campos renomeados, movidos e removidos (`edges` → `arcs`, contadores agrupados, sem `name`).
  const v2Reestruturado = (): Obj => ({
    schemaVersion: 2,
    graph: { id: 'g-futuro', directed: true },
    vertices: [{ id: 'v1', label: 'A' }],
    arcs: [],
    counters: { vertex: 2, edge: 1 },
  });
  const unsupported = (version: number): GraphError => ({ code: 'UNSUPPORTED_SCHEMA_VERSION', version, supported: [GRAPH_SCHEMA_VERSION] });
  const expectUnsupported = (result: Result<Graph>, version: number) => {
    expect(result).toStrictEqual({ ok: false, error: unsupported(version) });
    // nada parcial: nem `value`, nem grafo algum
    expect(Object.keys(result)).toStrictEqual(['ok', 'error']);
    expect('value' in result).toBe(false);
  };

  it.each([
    ['aditiva (campos novos)', v2Aditivo],
    ['reestruturada (campos renomeados e movidos)', v2Reestruturado],
  ])('v2 %s: a versão é identificada e o documento inteiro é recusado', (_nome, doc) => {
    expectUnsupported(parseGraph(doc()), 2);
    expectUnsupported(parseGraphJson(JSON.stringify(doc())), 2);
    expectUnsupported(parseGraphJson(JSON.stringify(doc(), null, 2)), 2);
    expectUnsupported(parseGraphJson(`\n ${JSON.stringify(doc())} \n`), 2);
  });

  it('o erro diz o que fazer: a versão do documento e as versões que este leitor entende', () => {
    const resultado = parseGraph(v2Aditivo());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.error.code === 'UNSUPPORTED_SCHEMA_VERSION') {
      expect(resultado.error.version).toBe(2);
      expect(resultado.error.supported).toStrictEqual([GRAPH_SCHEMA_VERSION]);
      expect(resultado.error.version).toBeGreaterThan(Math.max(...resultado.error.supported));
    }
  });

  it('não há migração silenciosa: só o número da versão separa o aceito do recusado', () => {
    const v1 = (): Obj => {
      const doc = v2Aditivo();
      doc.schemaVersion = 1;
      doc.vertices = (doc.vertices as Obj[]).map(({ id, label }) => ({ id, label }));
      doc.edges = (doc.edges as Obj[]).map(({ id, source, target, weight }) => ({ id, source, target, weight }));
      delete doc.layout;
      return doc;
    };

    // o mesmo conteúdo, sem os campos novos, é um v1 válido…
    expect(must(parseGraph(v1())).edges[0]).toStrictEqual({ id: 'e1', source: 'v1', target: 'v2', weight: 3 });
    // …mas com a versão 2 é recusado, mesmo sendo legível como v1
    expectUnsupported(parseGraph({ ...v1(), schemaVersion: 2 }), 2);
    // e um documento v2 com o número trocado para 1 NÃO passa por v1: os campos novos são desconhecidos
    expect(parseGraph({ ...v2Aditivo(), schemaVersion: 1 })).toStrictEqual({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', path: '', reason: 'UNKNOWN_FIELD' },
    });
    expect(parseGraph({ ...v2Reestruturado(), schemaVersion: 1 })).toStrictEqual({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', path: 'id', reason: 'MISSING_FIELD' },
    });
  });

  it('campos desconhecidos da versão futura não escondem o erro de versão', () => {
    const doc = v2Aditivo();
    doc.vertices = [{ id: 'v1', label: 'A', cor: 'azul' }];
    doc.edges = [{ id: 'e1', source: 'v1', target: 'v9', capacity: 'muita' }];
    doc.metadata = { autor: 'alguém' };
    drop(doc, 'name');

    expectUnsupported(parseGraph(doc), 2);
  });

  it('a recusa não mexe na entrada nem devolve referência a ela', () => {
    const doc = deepFreeze(v2Aditivo());
    const antes = JSON.stringify(doc);
    const resultado = parseGraph(doc);

    expectUnsupported(resultado, 2);
    expect(JSON.stringify(doc)).toBe(antes);
    expect(JSON.stringify(resultado)).not.toContain('Fonte');
  });

  describe('a versão vence qualquer outro defeito do documento', () => {
    const FUTURAS = [2, 3, 10, 1.5, 0, -1, 1.0000001, 2 ** 31, Number.MAX_SAFE_INTEGER];
    const SO_EM_MEMORIA = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN];
    const LIXO: unknown[] = [null, undefined, true, 'x', 7, -1, 1.5, [], {}, [1], { a: 1 }, 'v1', ' A ', Number.NaN];

    /** Estraga o documento de um jeito qualquer, sem tocar em `schemaVersion`. */
    function estragar(doc: Obj, random: () => number) {
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const objetos = (valor: unknown): Obj[] => (Array.isArray(valor) ? valor.filter((x): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)) : []);
      const alvo = pick([doc, ...objetos(doc.vertices), ...objetos(doc.edges)]);
      const chaves = Object.keys(alvo).filter((k) => !(alvo === doc && k === 'schemaVersion'));
      const sorte = random();
      if (sorte < 0.35 && chaves.length > 0) delete alvo[pick(chaves)];
      else if (sorte < 0.7 && chaves.length > 0) alvo[pick(chaves)] = pick(LIXO);
      else alvo[`extra${Math.floor(random() * 5)}`] = pick(LIXO);
    }

    it.each(['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json'])(
      '%s com até 3 defeitos e uma versão futura: sempre UNSUPPORTED_SCHEMA_VERSION',
      (arquivo) => {
        const random = seededRandom(arquivo.length * 977);
        const escolha = <T>(itens: readonly T[]): T => itens[Math.floor(random() * itens.length)]!;
        let recusados = 0;

        for (let i = 0; i < 300; i++) {
          const doc = JSON.parse(readGolden(arquivo)) as Obj;
          for (let k = 0; k < 1 + Math.floor(random() * 3); k++) estragar(doc, random);
          const versão = escolha(FUTURAS);
          doc.schemaVersion = versão;

          expectUnsupported(parseGraph(doc), versão);
          expectUnsupported(parseGraphJson(JSON.stringify(doc)), versão);
          const emMemoria = escolha(SO_EM_MEMORIA);
          doc.schemaVersion = emMemoria;
          expectUnsupported(parseGraph(doc), emMemoria);
          recusados++;
        }

        expect(recusados).toBe(300);
      },
    );

    it('versão que não é número não é "futura": é tipo errado; sem versão, é campo ausente', () => {
      for (const valor of ['2', null, true, [], {}, 2n]) {
        const doc = v2Aditivo();
        doc.schemaVersion = valor;

        expect(parseGraph(doc)).toStrictEqual({ ok: false, error: { code: 'INVALID_DOCUMENT', path: 'schemaVersion', reason: 'WRONG_TYPE' } });
      }
      const semVersao = v2Aditivo();
      delete semVersao.schemaVersion;
      expect(parseGraph(semVersao)).toStrictEqual({ ok: false, error: { code: 'INVALID_DOCUMENT', path: 'schemaVersion', reason: 'MISSING_FIELD' } });
    });

    it('a versão 1 escrita como 1.0 ou 1e0 no texto é a versão 1 (JSON não distingue inteiro de decimal)', () => {
      const texto = readGolden('empty.json');

      for (const escrita of ['1.0', '1e0', '10e-1']) {
        expect(parseGraphJson(texto.replace('"schemaVersion":1', `"schemaVersion":${escrita}`)).ok).toBe(true);
      }
    });

    it('limite documentado: a raiz é inspecionada antes da versão, então um getter em campo do esquema vence o erro de versão', () => {
      const doc = v2Aditivo();
      Object.defineProperty(doc, 'name', { enumerable: true, get: () => 'x' });

      expect(parseGraph(doc)).toStrictEqual({ ok: false, error: { code: 'INVALID_DOCUMENT', path: 'name', reason: 'UNREADABLE' } });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Garantias de segurança que a documentação afirma (e só elas)
// ---------------------------------------------------------------------------------------------

describe('o que um Proxy enxerga (as armadilhas que a leitura executa)', () => {
  it('só getOwnPropertyDescriptor, getPrototypeOf e ownKeys: nunca get, has, set, defineProperty ou delete', () => {
    const chamadas = new Set<string>();
    const registrar = <T>(nome: string, valor: T): T => {
      chamadas.add(nome);
      return valor;
    };
    const espiar = <T extends object>(alvo: T): T =>
      new Proxy(alvo, {
        get: (t, k, r) => registrar('get', Reflect.get(t, k, r)),
        has: (t, k) => registrar('has', Reflect.has(t, k)),
        set: (t, k, v, r) => registrar('set', Reflect.set(t, k, v, r)),
        deleteProperty: (t, k) => registrar('deleteProperty', Reflect.deleteProperty(t, k)),
        defineProperty: (t, k, d) => registrar('defineProperty', Reflect.defineProperty(t, k, d)),
        setPrototypeOf: (t, p) => registrar('setPrototypeOf', Reflect.setPrototypeOf(t, p)),
        isExtensible: (t) => registrar('isExtensible', Reflect.isExtensible(t)),
        preventExtensions: (t) => registrar('preventExtensions', Reflect.preventExtensions(t)),
        getPrototypeOf: (t) => registrar('getPrototypeOf', Reflect.getPrototypeOf(t)),
        getOwnPropertyDescriptor: (t, k) => registrar('getOwnPropertyDescriptor', Reflect.getOwnPropertyDescriptor(t, k)),
        ownKeys: (t) => registrar('ownKeys', Reflect.ownKeys(t)),
      });
    const embrulhar = (valor: unknown): unknown =>
      Array.isArray(valor)
        ? espiar(valor.map(embrulhar))
        : typeof valor === 'object' && valor !== null
          ? espiar(Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, embrulhar(v)])))
          : valor;
    const texto = readGolden('directed-opposite-arcs.json');

    const resultado = parseGraph(embrulhar(JSON.parse(texto)));

    expect(resultado).toStrictEqual(parseGraphJson(texto));
    expect([...chamadas].sort()).toStrictEqual(['getOwnPropertyDescriptor', 'getPrototypeOf', 'ownKeys']);
  });
});

function drop(target: Obj, key: string) {
  delete target[key];
}
