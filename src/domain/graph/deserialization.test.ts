import {
  addEdge,
  addVertex,
  adjacencyList,
  adjacencyMatrix,
  createGraph,
  degree,
  GRAPH_SCHEMA_VERSION,
  inDegree,
  incidenceList,
  incidenceMatrix,
  outDegree,
  parseGraph,
  parseGraphJson,
  removeEdge,
  removeVertex,
  serializeGraph,
  setEdgeWeight,
  setVertexLabel,
  type DocumentCause,
  type Graph,
  type GraphError,
  type InvalidDocumentReason,
  type ParseGraphOptions,
  type Result,
} from './index';
import {
  connect,
  deepFreeze,
  digraphWithOpposites as D,
  directedOppositeArcs,
  errorOf,
  must,
  randomGraph,
  randomHistory,
  readGolden as golden,
  seededRandom,
  triangleWithTail as U,
  undirectedAfterRemovals,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Leitura de documentos (ver deserialization.ts): ida e volta com o `serializeGraph`, validação de entradas
// inválidas, segurança contra entradas hostis e concordância com as regras do domínio.

type Obj = Record<string, unknown>;
type Doc = Obj & { vertices: Obj[]; edges: Obj[] };

const DOC_KEYS = ['schemaVersion', 'id', 'name', 'directed', 'vertices', 'edges', 'nextVertexSeq', 'nextEdgeSeq'];

/** Documento válido e pequeno, novo a cada chamada (os testes o alteram). Equivale a `validGraph()`. */
function validDoc(): Doc {
  return {
    schemaVersion: 1,
    id: 'g-base',
    name: 'Base',
    directed: false,
    vertices: [
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'B' },
      { id: 'v3', label: 'C' },
    ],
    edges: [
      { id: 'e1', source: 'v1', target: 'v2', weight: 2 },
      { id: 'e2', source: 'v2', target: 'v3' },
    ],
    nextVertexSeq: 4,
    nextEdgeSeq: 3,
  };
}

/** O mesmo grafo de `validDoc()`, montado pelas operações do domínio. */
function validGraph(): Graph {
  let graph = createGraph({ id: 'g-base', name: 'Base' });
  for (const label of ['A', 'B', 'C']) graph = must(addVertex(graph, label)).graph;
  graph = connect(graph, 'v1', 'v2', 2);
  return connect(graph, 'v2', 'v3');
}

const withDoc = (change: (doc: Doc) => void): Doc => {
  const doc = validDoc();
  change(doc);
  return doc;
};
const drop = (target: Obj, key: string) => {
  delete target[key];
};

const bad = (path: string, reason: InvalidDocumentReason): GraphError => ({ code: 'INVALID_DOCUMENT', path, reason });
const rule = (path: string, cause: DocumentCause): GraphError => ({
  code: 'INVALID_DOCUMENT',
  path,
  reason: 'DOMAIN_RULE',
  cause,
});
const unsupported = (version: number): GraphError => ({
  code: 'UNSUPPORTED_SCHEMA_VERSION',
  version,
  supported: [1],
});
const badLabel = (path: string, reason: 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG' | 'NOT_NORMALIZED') =>
  rule(path, { code: 'INVALID_VERTEX_LABEL', reason });
const badWeight = (path: string) => rule(path, { code: 'INVALID_WEIGHT' });

function expectError(result: Result<Graph>, expected: GraphError) {
  expect(result).toStrictEqual({ ok: false, error: expected });
}

/** Verificador independente das invariantes do modelo: lista o que estiver errado em um `Graph`. */
function violations(graph: Graph): string[] {
  const found: string[] = [];
  const sequenceOf = (id: string, prefix: string) =>
    new RegExp(`^${prefix}[1-9][0-9]*$`).test(id) ? Number(id.slice(1)) : Number.NaN;

  if (JSON.stringify(Object.keys(graph)) !== JSON.stringify(DOC_KEYS)) found.push('chaves do grafo');
  if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION) found.push('schemaVersion');

  const vertexIds = new Set<string>();
  let maxVertex = 0;
  for (const vertex of graph.vertices) {
    const sequence = sequenceOf(vertex.id, 'v');
    if (!Number.isSafeInteger(sequence)) found.push(`id de vértice ${vertex.id}`);
    if (vertexIds.has(vertex.id)) found.push(`vértice repetido ${vertex.id}`);
    vertexIds.add(vertex.id);
    maxVertex = Math.max(maxVertex, sequence);
    const probe = addVertex(createGraph({ id: 'sonda' }), vertex.label);
    if (!probe.ok || probe.value.vertex.label !== vertex.label) found.push(`rótulo ${JSON.stringify(vertex.label)}`);
  }

  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  let maxEdge = 0;
  for (const edge of graph.edges) {
    const sequence = sequenceOf(edge.id, 'e');
    if (!Number.isSafeInteger(sequence)) found.push(`id de aresta ${edge.id}`);
    if (edgeIds.has(edge.id)) found.push(`aresta repetida ${edge.id}`);
    edgeIds.add(edge.id);
    maxEdge = Math.max(maxEdge, sequence);
    if (!vertexIds.has(edge.source) || !vertexIds.has(edge.target)) found.push(`extremo inexistente em ${edge.id}`);
    if (edge.source === edge.target) found.push(`laço em ${edge.id}`);
    const pair = graph.directed || edge.source < edge.target ? `${edge.source}>${edge.target}` : `${edge.target}>${edge.source}`;
    if (pairs.has(pair)) found.push(`par repetido em ${edge.id}`);
    pairs.add(pair);
    if ('weight' in edge && (typeof edge.weight !== 'number' || !Number.isFinite(edge.weight) || Object.is(edge.weight, -0))) {
      found.push(`peso de ${edge.id}`);
    }
    const keys = Object.keys(edge).join();
    if (keys !== 'id,source,target' && keys !== 'id,source,target,weight') found.push(`chaves de ${edge.id}`);
  }

  if (!(graph.nextVertexSeq > maxVertex) || !Number.isSafeInteger(graph.nextVertexSeq)) found.push('nextVertexSeq');
  if (!(graph.nextEdgeSeq > maxEdge) || !Number.isSafeInteger(graph.nextEdgeSeq)) found.push('nextEdgeSeq');
  return found;
}

/** Forma de um erro de leitura: só os códigos novos, `path` só com nomes do esquema e índices, `cause` só em DOMAIN_RULE. */
const PATH_SHAPE =
  /^(|options(\.max(Vertices|Edges|TextLength))?|schemaVersion|id|name|directed|vertices|edges|nextVertexSeq|nextEdgeSeq|(vertices|edges)\[\d+\](\.(id|label|source|target|weight))?)$/;
function errorShapeProblems(error: GraphError): string[] {
  if (error.code === 'UNSUPPORTED_SCHEMA_VERSION') {
    return JSON.stringify(error.supported) === '[1]' && typeof error.version === 'number' ? [] : ['versão'];
  }
  if (error.code !== 'INVALID_DOCUMENT') return [`código ${error.code}`];
  const problems: string[] = [];
  if (!PATH_SHAPE.test(error.path)) problems.push(`path ${error.path}`);
  if ((error.reason === 'DOMAIN_RULE') !== (error.cause !== undefined)) problems.push('cause');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Arquivos de referência
// ---------------------------------------------------------------------------------------------

describe('arquivos de referência (golden) do esquema v1', () => {
  // Escritos à mão, a partir do texto dos arquivos, sem passar pelas funções do domínio.
  const EMPTY: Graph = {
    schemaVersion: 1,
    id: 'g1',
    name: '',
    directed: false,
    vertices: [],
    edges: [],
    nextVertexSeq: 1,
    nextEdgeSeq: 1,
  };
  const UNDIRECTED: Graph = {
    schemaVersion: 1,
    id: 'g2',
    name: 'Grafo de teste: ação',
    directed: false,
    vertices: [
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'Königsberg' },
      { id: 'v3', label: '日本語' },
      { id: 'v4', label: '🙂' },
    ],
    edges: [
      { id: 'e1', source: 'v1', target: 'v2' },
      { id: 'e2', source: 'v2', target: 'v3', weight: 0 },
      { id: 'e3', source: 'v3', target: 'v4', weight: -2.5 },
      { id: 'e4', source: 'v4', target: 'v1', weight: 7 },
    ],
    nextVertexSeq: 6,
    nextEdgeSeq: 6,
  };
  const DIRECTED: Graph = {
    schemaVersion: 1,
    id: 'g3',
    name: '',
    directed: true,
    vertices: [
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'B' },
      { id: 'v3', label: 'C' },
    ],
    edges: [
      { id: 'e1', source: 'v1', target: 'v2', weight: 0 },
      { id: 'e2', source: 'v2', target: 'v1', weight: -1 },
      { id: 'e3', source: 'v2', target: 'v3' },
    ],
    nextVertexSeq: 4,
    nextEdgeSeq: 4,
  };

  it.each([
    ['empty.json', EMPTY],
    ['undirected-weighted-after-removals.json', UNDIRECTED],
    ['directed-opposite-arcs.json', DIRECTED],
    ['directed-opposite-arcs.pretty.json', DIRECTED],
  ] as const)('%s é lido como o grafo esperado, igual ao escrito à mão', (file, expected) => {
    const result = parseGraphJson(golden(file));

    expect(result).toStrictEqual({ ok: true, value: expected });
  });

  it('os grafos escritos à mão coincidem com os montados pelas operações do domínio', () => {
    expect(must(parseGraphJson(golden('empty.json')))).toStrictEqual(createGraph({ id: 'g1' }));
    expect(must(parseGraphJson(golden('undirected-weighted-after-removals.json')))).toStrictEqual(undirectedAfterRemovals());
    expect(must(parseGraphJson(golden('directed-opposite-arcs.json')))).toStrictEqual(directedOppositeArcs());
  });

  it.each(['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json'])(
    'serializeGraph(parseGraphJson(%s)) devolve exatamente o texto do arquivo',
    (file) => {
      expect(serializeGraph(must(parseGraphJson(golden(file))))).toBe(golden(file));
    },
  );

  it('o arquivo legível (pretty) volta ao compacto e a ele mesmo', () => {
    const graph = must(parseGraphJson(golden('directed-opposite-arcs.pretty.json')));

    expect(serializeGraph(graph)).toBe(golden('directed-opposite-arcs.json'));
    expect(serializeGraph(graph, { pretty: true })).toBe(golden('directed-opposite-arcs.pretty.json'));
  });

  it('parseGraph aceita o mesmo documento já decodificado e dá o mesmo grafo', () => {
    for (const file of ['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json']) {
      expect(parseGraph(JSON.parse(golden(file)))).toStrictEqual(parseGraphJson(golden(file)));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Ida e volta
// ---------------------------------------------------------------------------------------------

describe('ida e volta: parseGraphJson(serializeGraph(g)) é igual a g', () => {
  const fixos: [string, Graph][] = [
    ['vazio', createGraph({ id: 'g1' })],
    ['vazio, orientado, com nome', createGraph({ id: 'g-dir', name: 'Meu dígrafo', directed: true })],
    ['um vértice', withVertices(1)],
    ['vértices isolados', withVertices(4)],
    ['triângulo com haste e isolado (U)', U],
    ['orientado com arcos opostos (D)', D],
    ['pesos nos quatro estados (W)', W],
    ['orientado ponderado (WD)', WD],
    ['não orientado depois de remoções', undirectedAfterRemovals()],
    ['orientado com arcos opostos', directedOppositeArcs()],
  ];

  it.each(fixos)('%s: compacto e legível, por texto e por objeto', (_nome, graph) => {
    const compacto = serializeGraph(graph);
    const legivel = serializeGraph(graph, { pretty: true });

    expect(parseGraphJson(compacto)).toStrictEqual({ ok: true, value: graph });
    expect(parseGraphJson(legivel)).toStrictEqual({ ok: true, value: graph });
    expect(parseGraph(JSON.parse(compacto))).toStrictEqual({ ok: true, value: graph });
    expect(serializeGraph(must(parseGraphJson(compacto)))).toBe(compacto);
    expect(serializeGraph(must(parseGraphJson(legivel)), { pretty: true })).toBe(legivel);
  });

  it('preserva a ordem das chaves, dos vértices e das arestas e a presença do peso', () => {
    for (const [, graph] of fixos) {
      const restaurado = must(parseGraphJson(serializeGraph(graph)));

      expect(Object.keys(restaurado)).toStrictEqual(Object.keys(graph));
      expect(restaurado.vertices.map((v) => v.id)).toStrictEqual(graph.vertices.map((v) => v.id));
      expect(restaurado.edges.map((e) => e.id)).toStrictEqual(graph.edges.map((e) => e.id));
      graph.edges.forEach((edge, i) => {
        expect('weight' in restaurado.edges[i]!).toBe('weight' in edge);
        expect(Object.keys(restaurado.edges[i]!)).toStrictEqual(Object.keys(edge));
      });
    }
  });

  it('a ordem não é reescrita: arestas criadas fora da ordem dos vértices voltam na mesma ordem', () => {
    expect(must(parseGraphJson(serializeGraph(U))).edges.map((e) => e.id)).toStrictEqual(['e1', 'e2', 'e3', 'e4']);
    expect(must(parseGraphJson(serializeGraph(U))).edges.map((e) => `${e.source}${e.target}`)).toStrictEqual([
      'v3v4',
      'v3v1',
      'v3v2',
      'v2v1',
    ]);
  });

  it('o resultado não é o objeto original, nem compartilha arrays ou objetos com ele', () => {
    const restaurado = must(parseGraphJson(serializeGraph(U)));

    expect(restaurado).not.toBe(U);
    expect(restaurado.vertices).not.toBe(U.vertices);
    expect(restaurado.edges).not.toBe(U.edges);
    restaurado.vertices.forEach((vertex, i) => expect(vertex).not.toBe(U.vertices[i]));
    restaurado.edges.forEach((edge, i) => expect(edge).not.toBe(U.edges[i]));
  });

  describe('pesos', () => {
    const pesos = [0, -1, 1, 2.5, -2.5, 0.1 + 0.2, 1e21, -1e21, 1e-7, 5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER];

    it.each(pesos)('o peso %p volta idêntico (inclusive o sinal e a precisão)', (peso) => {
      const graph = connect(withVertices(2), 'v1', 'v2', peso);
      const restaurado = must(parseGraphJson(serializeGraph(graph)));

      expect(restaurado.edges[0]!.weight).toBe(peso);
      expect(restaurado).toStrictEqual(graph);
    });

    it('sem peso, peso zero e peso negativo continuam diferentes; ausente nunca vira 0 nem 1', () => {
      const restaurado = must(parseGraphJson(serializeGraph(W)));

      expect(restaurado.edges.map((e) => e.weight)).toStrictEqual([undefined, 0, -2.5, 7]);
      expect('weight' in restaurado.edges[0]!).toBe(false);
      expect('weight' in restaurado.edges[1]!).toBe(true);
      expect(Object.is(restaurado.edges[1]!.weight, 0)).toBe(true);
    });

    it('`-0` no texto vira 0 (como faz o domínio) e não vira peso ausente', () => {
      const texto = serializeGraph(connect(withVertices(2), 'v1', 'v2', 5)).replace('"weight":5', '"weight":-0');
      const aresta = must(parseGraphJson(texto)).edges[0]!;

      expect(Object.is(aresta.weight, 0)).toBe(true);
      expect(serializeGraph(must(parseGraphJson(texto)))).toContain('"weight":0');
    });
  });

  describe('textos especiais em nome e rótulos', () => {
    const textos = [
      'a"b',
      'a\\b',
      'a/b',
      'linha1\nlinha2',
      'tab\tstop',
      '\u0000',
      '\u001f',
      '\u007f',
      ' x ',
      '\ud800',
      '\udc00',
      'a\ud800b',
      '😀',
      'é',
      'x‮y',
      'Königsberg',
      '日本語',
      '\u{1F468}‍\u{1F469}‍\u{1F467}',
      '</script>',
      '{"id":"v1"}',
      '__proto__',
      'constructor',
      'toString',
      'A B  C',
      'a'.repeat(64),
      '😀'.repeat(64),
    ];

    it('nomes de qualquer texto voltam idênticos (o domínio não restringe o nome)', () => {
      for (const nome of ['', ...textos, 'n'.repeat(10000)]) {
        const graph = createGraph({ id: 'g', name: nome });

        expect(parseGraphJson(serializeGraph(graph))).toStrictEqual({ ok: true, value: graph });
      }
    });

    it('rótulos que o domínio aceita sem alterar voltam idênticos', () => {
      let graph = createGraph({ id: 'g' });
      let aceitos = 0;
      for (const texto of textos) {
        const criado = addVertex(graph, texto);
        if (criado.ok && criado.value.vertex.label === texto) {
          graph = criado.value.graph;
          aceitos++;
        }
      }

      expect(aceitos).toBeGreaterThan(15);
      expect(parseGraphJson(serializeGraph(graph))).toStrictEqual({ ok: true, value: graph });
      expect(parseGraphJson(serializeGraph(graph, { pretty: true }))).toStrictEqual({ ok: true, value: graph });
    });

    it('o id do grafo também volta idêntico (inclusive vazio: o domínio não o restringe)', () => {
      for (const id of ['', 'g', '0', 'id com espaço', 'üñí', '\ud800']) {
        const graph = createGraph({ id });

        expect(parseGraphJson(serializeGraph(graph))).toStrictEqual({ ok: true, value: graph });
      }
    });
  });

  describe('contadores e ids depois de remoções', () => {
    it('os contadores voltam como estavam, sem ser recalculados pela quantidade de elementos', () => {
      const restaurado = must(parseGraphJson(serializeGraph(undirectedAfterRemovals())));

      expect(restaurado.vertices).toHaveLength(4);
      expect(restaurado.nextVertexSeq).toBe(6); // e não 5
      expect(restaurado.edges).toHaveLength(4);
      expect(restaurado.nextEdgeSeq).toBe(6); // e não 5
    });

    it('um id removido não é reaproveitado depois de restaurar (vértices e arestas)', () => {
      let graph = withVertices(3);
      graph = connect(graph, 'v1', 'v2');
      graph = connect(graph, 'v2', 'v3');
      graph = must(removeVertex(graph, 'v3')); // v3 e e2 somem
      const restaurado = must(parseGraphJson(serializeGraph(graph)));

      const comNovo = must(addVertex(restaurado));
      expect(comNovo.vertex.id).toBe('v4');
      const ligado = must(addEdge(comNovo.graph, { source: 'v1', target: 'v4' }));
      expect(ligado.edge.id).toBe('e3');
      expect(restaurado.vertices.map((v) => v.id)).not.toContain('v3');
    });

    it('operações inválidas sobre o grafo restaurado não consomem ids', () => {
      const restaurado = deepFreeze(must(parseGraphJson(serializeGraph(undirectedAfterRemovals()))));

      expect(errorOf(addVertex(restaurado, '   ')).code).toBe('INVALID_VERTEX_LABEL');
      expect(errorOf(addEdge(restaurado, { source: 'v1', target: 'v1' })).code).toBe('SELF_LOOP');
      expect(errorOf(addEdge(restaurado, { source: 'v1', target: 'v2' })).code).toBe('DUPLICATE_EDGE');
      expect(errorOf(addEdge(restaurado, { source: 'v1', target: 'v4', weight: Number.NaN })).code).toBe('INVALID_WEIGHT');
      expect(restaurado.nextVertexSeq).toBe(6);
      expect(restaurado.nextEdgeSeq).toBe(6);
      expect(must(addVertex(restaurado)).vertex.id).toBe('v6');
    });

    it('um grafo restaurado se comporta como o original em edições seguintes', () => {
      const original = undirectedAfterRemovals();
      const restaurado = must(parseGraphJson(serializeGraph(original)));
      const editar = (g: Graph) => {
        const comVertice = must(addVertex(g, 'Novo')).graph;
        const comAresta = must(addEdge(comVertice, { source: 'v2', target: 'v6', weight: 3 })).graph;
        return must(setEdgeWeight(must(setVertexLabel(comAresta, 'v1', 'Outro')), 'e1', 0));
      };

      expect(editar(restaurado)).toStrictEqual(editar(original));
    });
  });

  describe('grafos pseudoaleatórios de sementes fixas', () => {
    const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

    /** Grafo aleatório e, quando possível, sem o primeiro vértice e sem a primeira aresta restante. */
    function comLacunas(seed: number, directed: boolean): Graph {
      let graph = randomGraph(seed, directed);
      const primeiroVertice = graph.vertices[0];
      if (primeiroVertice) graph = must(removeVertex(graph, primeiroVertice.id));
      const primeiraAresta = graph.edges[0];
      if (primeiraAresta) graph = must(removeEdge(graph, primeiraAresta.id));
      return graph;
    }

    it.each([false, true])('200 grafos voltam idênticos e com o mesmo texto (orientado = %s)', (directed) => {
      const divergencias: number[] = [];
      for (const seed of sementes) {
        const graph = comLacunas(seed, directed);
        const texto = serializeGraph(graph);
        const compacto = parseGraphJson(texto);
        const legivel = parseGraphJson(serializeGraph(graph, { pretty: true }));
        const porObjeto = parseGraph(JSON.parse(texto));
        const igual = (r: Result<Graph>) => r.ok && JSON.stringify(r.value) === JSON.stringify(graph);
        if (!igual(compacto) || !igual(legivel) || !igual(porObjeto)) divergencias.push(seed);
        if (compacto.ok && serializeGraph(compacto.value) !== texto) divergencias.push(-seed);
        expect(compacto).toStrictEqual({ ok: true, value: graph });
      }

      expect(divergencias).toStrictEqual([]);
    });
  });

  describe('sequências determinísticas de operações', () => {
    it.each([false, true])('cada grafo intermediário de 60 sequências volta idêntico (orientado = %s)', (directed) => {
      let total = 0;
      let comPeso = 0;
      let comLacuna = 0;
      for (let seed = 1; seed <= 60; seed++) {
        for (const graph of randomHistory(seed, directed, 60)) {
          const texto = serializeGraph(graph);

          expect(parseGraphJson(texto)).toStrictEqual({ ok: true, value: graph });
          expect(serializeGraph(must(parseGraphJson(texto)))).toBe(texto);
          total++;
          if (graph.edges.some((e) => e.weight !== undefined)) comPeso++;
          if (graph.nextVertexSeq - 1 > graph.vertices.length) comLacuna++;
        }
      }

      // A sequência exercita o que precisa: muitos grafos, com peso e com ids removidos.
      expect(total).toBeGreaterThan(1000);
      expect(comPeso).toBeGreaterThan(100);
      expect(comLacuna).toBeGreaterThan(100);
    });

    it('a mesma semente gera os mesmos grafos', () => {
      expect(randomHistory(7, true, 60)).toStrictEqual(randomHistory(7, true, 60));
    });
  });

  describe('JSON válido mas não canônico: os dados se preservam, a forma é reescrita', () => {
    const esperado = golden('undirected-weighted-after-removals.json');

    it('chaves em outra ordem, espaços e quebras de linha', () => {
      const original = JSON.parse(esperado) as Obj;
      const embaralhado = JSON.stringify(
        Object.fromEntries(Object.entries(original).reverse()),
        null,
        '\t',
      );
      const reordenado = embaralhado.replace(/\{\s*"id":\s*"v1",\s*"label":\s*"A"\s*\}/, '{ "label" : "A" , "id" : "v1" }');

      expect(reordenado).not.toBe(esperado);
      expect(serializeGraph(must(parseGraphJson(reordenado)))).toBe(esperado);
      expect(serializeGraph(must(parseGraphJson(`\n  ${esperado}\r\n`)))).toBe(esperado);
    });

    it('números escritos de outro jeito (2.50, 7.0, 1e0, -0.0) dão os mesmos valores', () => {
      const texto = esperado
        .replace('"weight":-2.5', '"weight":-2.50')
        .replace('"weight":7', '"weight":7.0')
        .replace('"weight":0', '"weight":-0.0')
        .replace('"nextVertexSeq":6', '"nextVertexSeq":6.0')
        .replace('"nextEdgeSeq":6', '"nextEdgeSeq":0.6e1');

      expect(texto).not.toBe(esperado);
      expect(serializeGraph(must(parseGraphJson(texto)))).toBe(esperado);
    });

    it('escapes equivalentes dentro das strings (\\u00e7, \\u00e3, par substituto \\ud83d\\ude42, \\u003a)', () => {
      const texto = esperado
        .replace('ação', 'a\\u00e7\\u00e3o')
        .replace('🙂', '\\ud83d\\ude42')
        .replace('teste:', 'teste\\u003a');

      expect(texto).not.toBe(esperado);
      expect(serializeGraph(must(parseGraphJson(texto)))).toBe(esperado);
    });

    it('o resultado do JSON não canônico é o mesmo grafo do canônico', () => {
      const pretty = JSON.stringify(JSON.parse(esperado), null, 4);

      expect(parseGraphJson(pretty)).toStrictEqual(parseGraphJson(esperado));
    });
  });

  it('parseGraph aceita um Graph do domínio (inclusive congelado) e devolve uma cópia profunda', () => {
    for (const graph of [U, D, W, WD, deepFreeze(undirectedAfterRemovals())]) {
      const copia = must(parseGraph(graph));

      expect(copia).toStrictEqual(graph);
      expect(copia).not.toBe(graph);
      expect(copia.vertices).not.toBe(graph.vertices);
      expect(Object.isFrozen(copia)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Consistência com as representações e propriedades matemáticas
// ---------------------------------------------------------------------------------------------

describe('depois de restaurar, as quatro representações coincidem com as do original', () => {
  const grafos: [string, Graph][] = [
    ['vazio', createGraph({ id: 'g1' })],
    ['U', U],
    ['D', D],
    ['W', W],
    ['WD', WD],
    ['depois de remoções', undirectedAfterRemovals()],
    ['arcos opostos', directedOppositeArcs()],
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed): [string, Graph][] => [
      [`aleatório ${seed} (não orientado)`, randomGraph(seed, false)],
      [`aleatório ${seed} (orientado)`, randomGraph(seed, true)],
    ]),
  ];

  it.each(grafos)('%s', (_nome, graph) => {
    const restaurado = must(parseGraphJson(serializeGraph(graph)));

    expect(adjacencyList(restaurado)).toStrictEqual(adjacencyList(graph));
    expect(adjacencyMatrix(restaurado)).toStrictEqual(adjacencyMatrix(graph));
    expect(incidenceMatrix(restaurado)).toStrictEqual(incidenceMatrix(graph)); // só ±1/0: não carrega pesos
    expect(incidenceList(restaurado)).toStrictEqual(incidenceList(graph));
  });

  it.each(grafos)('%s: graus e contagem de arestas', (_nome, graph) => {
    const restaurado = must(parseGraphJson(serializeGraph(graph)));
    const graus = (g: Graph, f: typeof degree) => g.vertices.reduce((soma, v) => soma + must(f(g, v.id)), 0);

    expect(restaurado.vertices).toHaveLength(graph.vertices.length);
    expect(restaurado.edges).toHaveLength(graph.edges.length);
    for (const vertex of graph.vertices) {
      expect(must(degree(restaurado, vertex.id))).toBe(must(degree(graph, vertex.id)));
      expect(must(inDegree(restaurado, vertex.id))).toBe(must(inDegree(graph, vertex.id)));
      expect(must(outDegree(restaurado, vertex.id))).toBe(must(outDegree(graph, vertex.id)));
    }
    if (restaurado.directed) {
      expect(graus(restaurado, inDegree)).toBe(restaurado.edges.length);
      expect(graus(restaurado, outDegree)).toBe(restaurado.edges.length);
    } else {
      expect(graus(restaurado, degree)).toBe(2 * restaurado.edges.length);
    }
  });

  it('o grafo restaurado satisfaz as invariantes do modelo (verificador independente)', () => {
    for (const [, graph] of grafos) {
      expect(violations(must(parseGraphJson(serializeGraph(graph))))).toStrictEqual([]);
    }
  });

  it('o verificador independente enxerga defeitos (controle negativo)', () => {
    const base = validGraph();
    const defeituosos: Graph[] = [
      { ...base, nextVertexSeq: 3 },
      { ...base, nextEdgeSeq: 2 },
      { ...base, vertices: [...base.vertices, { id: 'v1', label: 'X' }] },
      { ...base, vertices: [{ id: 'v01', label: 'A' }] },
      { ...base, vertices: [{ id: 'v1', label: ' A' }] },
      { ...base, edges: [{ id: 'e1', source: 'v1', target: 'v1' }] },
      { ...base, edges: [{ id: 'e1', source: 'v1', target: 'v9' }] },
      { ...base, edges: [{ id: 'e1', source: 'v1', target: 'v2' }, { id: 'e2', source: 'v2', target: 'v1' }] },
      { ...base, edges: [{ id: 'e1', source: 'v1', target: 'v2', weight: Number.NaN }] },
      { ...base, edges: [{ id: 'e1', source: 'v1', target: 'v2', weight: -0 }] },
      { ...base, schemaVersion: 2 },
    ];

    for (const defeituoso of defeituosos) expect(violations(defeituoso).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Entradas inválidas
// ---------------------------------------------------------------------------------------------

describe('o documento de partida do corpus é válido', () => {
  it('validDoc() lido é igual ao grafo montado pelo domínio', () => {
    expect(parseGraph(validDoc())).toStrictEqual({ ok: true, value: validGraph() });
    expect(parseGraphJson(JSON.stringify(validDoc()))).toStrictEqual({ ok: true, value: validGraph() });
  });
});

describe('entradas inválidas representáveis em JSON: mesmo erro por texto e por objeto', () => {
  type Caso = readonly [nome: string, mudar: (doc: Doc) => void, esperado: GraphError];
  const longo = (n: number) => 'x'.repeat(n);

  const versao: Caso[] = [
    ['sem schemaVersion', (d) => drop(d, 'schemaVersion'), bad('schemaVersion', 'MISSING_FIELD')],
    ['schemaVersion em texto', (d) => (d.schemaVersion = '1'), bad('schemaVersion', 'WRONG_TYPE')],
    ['schemaVersion nulo', (d) => (d.schemaVersion = null), bad('schemaVersion', 'WRONG_TYPE')],
    ['schemaVersion booleano', (d) => (d.schemaVersion = true), bad('schemaVersion', 'WRONG_TYPE')],
    ['schemaVersion 2', (d) => (d.schemaVersion = 2), unsupported(2)],
    ['schemaVersion 0', (d) => (d.schemaVersion = 0), unsupported(0)],
    ['schemaVersion negativo', (d) => (d.schemaVersion = -1), unsupported(-1)],
    ['schemaVersion fracionário', (d) => (d.schemaVersion = 1.5), unsupported(1.5)],
    ['schemaVersion 99', (d) => (d.schemaVersion = 99), unsupported(99)],
    [
      'versão futura com campos novos e sem `name`: é recusada pela versão, não por campo desconhecido',
      (d) => {
        d.schemaVersion = 2;
        drop(d, 'name');
        d.edges.forEach((e) => (e.capacity = 3));
        d.layout = {};
      },
      unsupported(2),
    ],
    ['versão desconhecida vem antes de qualquer outro erro', (d) => {
      d.schemaVersion = 3;
      d.directed = 'sim';
      d.vertices = null as never;
    }, unsupported(3)],
  ];

  const camposAusentes: Caso[] = [
    ...['id', 'name', 'directed', 'vertices', 'edges', 'nextVertexSeq', 'nextEdgeSeq'].map(
      (campo): Caso => [`sem ${campo}`, (d) => drop(d, campo), bad(campo, 'MISSING_FIELD')],
    ),
    ['sem `id` nem `name`: aponta o primeiro na ordem do esquema', (d) => { drop(d, 'name'); drop(d, 'id'); }, bad('id', 'MISSING_FIELD')],
    ['documento vazio', (d) => { for (const k of Object.keys(d)) drop(d, k); d.schemaVersion = 1; }, bad('id', 'MISSING_FIELD')],
    ['vértice sem id', (d) => drop(d.vertices[1]!, 'id'), bad('vertices[1].id', 'MISSING_FIELD')],
    ['vértice sem label', (d) => drop(d.vertices[2]!, 'label'), bad('vertices[2].label', 'MISSING_FIELD')],
    ['vértice sem nada', (d) => (d.vertices[0] = {}), bad('vertices[0].id', 'MISSING_FIELD')],
    ['aresta sem id', (d) => drop(d.edges[0]!, 'id'), bad('edges[0].id', 'MISSING_FIELD')],
    ['aresta sem source', (d) => drop(d.edges[1]!, 'source'), bad('edges[1].source', 'MISSING_FIELD')],
    ['aresta sem target', (d) => drop(d.edges[1]!, 'target'), bad('edges[1].target', 'MISSING_FIELD')],
    ['aresta sem nada', (d) => (d.edges[1] = {}), bad('edges[1].id', 'MISSING_FIELD')],
  ];

  const camposDesconhecidos: Caso[] = [
    ['campo extra na raiz', (d) => (d.extra = 1), bad('', 'UNKNOWN_FIELD')],
    ['coordenadas visuais na raiz (layout)', (d) => (d.layout = { v1: { x: 1, y: 2 } }), bad('', 'UNKNOWN_FIELD')],
    ['campo extra no vértice', (d) => (d.vertices[1]!.x = 10), bad('vertices[1]', 'UNKNOWN_FIELD')],
    ['campo extra na aresta', (d) => (d.edges[0]!.color = 'red'), bad('edges[0]', 'UNKNOWN_FIELD')],
    ['capacity (campo de uma versão futura) na aresta', (d) => (d.edges[1]!.capacity = 3), bad('edges[1]', 'UNKNOWN_FIELD')],
    ['campo com nome parecido (maiúscula)', (d) => (d.Name = 'x'), bad('', 'UNKNOWN_FIELD')],
    ['campo ausente tem prioridade sobre campo desconhecido', (d) => { d.extra = 1; drop(d, 'name'); }, bad('name', 'MISSING_FIELD')],
    ['campo desconhecido com nome enorme: o nome não aparece no erro', (d) => (d[longo(100000)] = 1), bad('', 'UNKNOWN_FIELD')],
  ];

  const tipos: Caso[] = [
    ['id do grafo numérico', (d) => (d.id = 5), bad('id', 'WRONG_TYPE')],
    ['id do grafo nulo', (d) => (d.id = null), bad('id', 'WRONG_TYPE')],
    ['name numérico', (d) => (d.name = 5), bad('name', 'WRONG_TYPE')],
    ['name nulo', (d) => (d.name = null), bad('name', 'WRONG_TYPE')],
    ['name objeto', (d) => (d.name = {}), bad('name', 'WRONG_TYPE')],
    ['directed em texto', (d) => (d.directed = 'false'), bad('directed', 'WRONG_TYPE')],
    ['directed numérico (0)', (d) => (d.directed = 0), bad('directed', 'WRONG_TYPE')],
    ['directed nulo', (d) => (d.directed = null), bad('directed', 'WRONG_TYPE')],
    ['vertices objeto', (d) => (d.vertices = {} as never), bad('vertices', 'NOT_AN_ARRAY')],
    ['vertices nulo', (d) => (d.vertices = null as never), bad('vertices', 'NOT_AN_ARRAY')],
    ['vertices texto', (d) => (d.vertices = 'v1' as never), bad('vertices', 'NOT_AN_ARRAY')],
    ['edges objeto', (d) => (d.edges = {} as never), bad('edges', 'NOT_AN_ARRAY')],
    ['edges nulo', (d) => (d.edges = null as never), bad('edges', 'NOT_AN_ARRAY')],
    ['edges numérico', (d) => (d.edges = 3 as never), bad('edges', 'NOT_AN_ARRAY')],
    ['nextVertexSeq em texto', (d) => (d.nextVertexSeq = '4'), bad('nextVertexSeq', 'WRONG_TYPE')],
    ['nextVertexSeq nulo', (d) => (d.nextVertexSeq = null), bad('nextVertexSeq', 'WRONG_TYPE')],
    ['nextEdgeSeq booleano', (d) => (d.nextEdgeSeq = true), bad('nextEdgeSeq', 'WRONG_TYPE')],
    ...[null, [], 5, 'v1', true].map(
      (valor): Caso => [`vértice ${JSON.stringify(valor)}`, (d) => (d.vertices[1] = valor as never), bad('vertices[1]', 'NOT_AN_OBJECT')],
    ),
    ...[null, [], [1], 5, 'e1', false].map(
      (valor): Caso => [`aresta ${JSON.stringify(valor)}`, (d) => (d.edges[0] = valor as never), bad('edges[0]', 'NOT_AN_OBJECT')],
    ),
    ['id de vértice numérico', (d) => (d.vertices[0]!.id = 1), bad('vertices[0].id', 'WRONG_TYPE')],
    ['id de aresta numérico', (d) => (d.edges[1]!.id = 2), bad('edges[1].id', 'WRONG_TYPE')],
    ['source numérico', (d) => (d.edges[0]!.source = 1), bad('edges[0].source', 'WRONG_TYPE')],
    ['target nulo', (d) => (d.edges[0]!.target = null), bad('edges[0].target', 'WRONG_TYPE')],
    ['source objeto', (d) => (d.edges[0]!.source = { id: 'v1' }), bad('edges[0].source', 'WRONG_TYPE')],
  ];

  const contadores: Caso[] = [
    ...[0, -1, 1.5, 0.1, 1e300, 9007199254740992, 1e21].map(
      (valor): Caso => [`nextVertexSeq ${valor}`, (d) => (d.nextVertexSeq = valor), bad('nextVertexSeq', 'INVALID_COUNTER')],
    ),
    ...[0, -3, 2.5, 9007199254740993].map(
      (valor): Caso => [`nextEdgeSeq ${valor}`, (d) => (d.nextEdgeSeq = valor), bad('nextEdgeSeq', 'INVALID_COUNTER')],
    ),
    ['nextVertexSeq igual ao maior id (v3)', (d) => (d.nextVertexSeq = 3), bad('nextVertexSeq', 'COUNTER_TOO_LOW')],
    ['nextVertexSeq 1 com vértices', (d) => (d.nextVertexSeq = 1), bad('nextVertexSeq', 'COUNTER_TOO_LOW')],
    ['nextEdgeSeq igual ao maior id (e2)', (d) => (d.nextEdgeSeq = 2), bad('nextEdgeSeq', 'COUNTER_TOO_LOW')],
    ['nextEdgeSeq 1 com arestas', (d) => (d.nextEdgeSeq = 1), bad('nextEdgeSeq', 'COUNTER_TOO_LOW')],
    [
      'contador abaixo do maior id, não da quantidade: v7 sozinho com nextVertexSeq 2',
      (d) => {
        d.vertices = [{ id: 'v7', label: 'A' }];
        d.edges = [];
        d.nextVertexSeq = 2;
        d.nextEdgeSeq = 1;
      },
      bad('nextVertexSeq', 'COUNTER_TOO_LOW'),
    ],
    [
      'o maior id seguro não admite contador válido (v9007199254740991)',
      (d) => {
        d.vertices = [{ id: 'v9007199254740991', label: 'A' }];
        d.edges = [];
        d.nextVertexSeq = 9007199254740991;
        d.nextEdgeSeq = 1;
      },
      bad('nextVertexSeq', 'COUNTER_TOO_LOW'),
    ],
    ['contador inválido vem antes do conteúdo dos vértices', (d) => { d.nextVertexSeq = 0; d.vertices[0]!.id = 'x'; }, bad('nextVertexSeq', 'INVALID_COUNTER')],
  ];

  const idsDeVertice: Caso[] = [
    ...['v0', 'v01', 'V1', '1', 'v', 'vv1', 'v-1', 'v+1', 'v1.5', 'v1e2', 'v 1', 'v1 ', ' v1', 'v١', 'v１', 'e1', 'v1_', 'x1', '', 'v0x1', 'v९'].map(
      (id): Caso => [`id de vértice ${JSON.stringify(id)}`, (d) => (d.vertices[0]!.id = id), bad('vertices[0].id', 'INVALID_ID')],
    ),
    ['id de vértice acima do inteiro seguro (16 dígitos)', (d) => (d.vertices[0]!.id = 'v9007199254740992'), bad('vertices[0].id', 'INVALID_ID')],
    ['id de vértice com 17 dígitos', (d) => (d.vertices[0]!.id = 'v99999999999999999'), bad('vertices[0].id', 'INVALID_ID')],
    ['id de vértice gigante', (d) => (d.vertices[0]!.id = `v${'9'.repeat(100000)}`), bad('vertices[0].id', 'INVALID_ID')],
    ['id de vértice repetido', (d) => (d.vertices[2]!.id = 'v1'), bad('vertices[2].id', 'DUPLICATE_ID')],
    ['id de vértice repetido (consecutivo)', (d) => (d.vertices[1]!.id = 'v1'), bad('vertices[1].id', 'DUPLICATE_ID')],
    ['id de vértice fora de ordem é válido; id inválido depois dele é apontado', (d) => { d.vertices[0]!.id = 'v3'; d.vertices[2]!.id = 'v01'; }, bad('vertices[2].id', 'INVALID_ID')],
  ];

  const rotulos: Caso[] = [
    ['label numérico', (d) => (d.vertices[1]!.label = 5), badLabel('vertices[1].label', 'NOT_A_STRING')],
    ['label nulo', (d) => (d.vertices[1]!.label = null), badLabel('vertices[1].label', 'NOT_A_STRING')],
    ['label objeto', (d) => (d.vertices[1]!.label = { a: 1 }), badLabel('vertices[1].label', 'NOT_A_STRING')],
    ['label vazio', (d) => (d.vertices[1]!.label = ''), badLabel('vertices[1].label', 'EMPTY')],
    ['label só com espaços', (d) => (d.vertices[1]!.label = '   '), badLabel('vertices[1].label', 'EMPTY')],
    ['label só com espaços Unicode', (d) => (d.vertices[1]!.label = '   '), badLabel('vertices[1].label', 'EMPTY')],
    ...[' A', 'A ', ' A ', '\tA', 'A\n', ' A', '﻿A', 'A ', '　A　'].map(
      (label): Caso => [`label ${JSON.stringify(label)} exigiria trim()`, (d) => (d.vertices[0]!.label = label), badLabel('vertices[0].label', 'NOT_NORMALIZED')],
    ),
    ['label com 65 caracteres', (d) => (d.vertices[0]!.label = 'a'.repeat(65)), badLabel('vertices[0].label', 'TOO_LONG')],
    ['label com 65 emojis (65 pontos de código)', (d) => (d.vertices[0]!.label = '😀'.repeat(65)), badLabel('vertices[0].label', 'TOO_LONG')],
    ['label longo com espaços nas pontas', (d) => (d.vertices[0]!.label = ` ${'a'.repeat(65)} `), badLabel('vertices[0].label', 'TOO_LONG')],
    ['label gigante', (d) => (d.vertices[2]!.label = longo(1_000_000)), badLabel('vertices[2].label', 'TOO_LONG')],
    ['rótulo inválido do primeiro vértice vem antes do segundo', (d) => { d.vertices[1]!.label = ''; d.vertices[0]!.label = ' A'; }, badLabel('vertices[0].label', 'NOT_NORMALIZED')],
  ];

  const idsDeAresta: Caso[] = [
    ...['e0', 'e01', 'E1', 'v1', 'e', 'e-1', 'e1.0', 'e 1', '', 'ee1'].map(
      (id): Caso => [`id de aresta ${JSON.stringify(id)}`, (d) => (d.edges[0]!.id = id), bad('edges[0].id', 'INVALID_ID')],
    ),
    ['id de aresta repetido', (d) => (d.edges[1]!.id = 'e1'), bad('edges[1].id', 'DUPLICATE_ID')],
    ['id de aresta com 17 dígitos', (d) => (d.edges[0]!.id = 'e99999999999999999'), bad('edges[0].id', 'INVALID_ID')],
  ];

  const extremos: Caso[] = [
    ['source inexistente', (d) => (d.edges[0]!.source = 'v9'), rule('edges[0].source', { code: 'VERTEX_NOT_FOUND' })],
    ['target inexistente', (d) => (d.edges[0]!.target = 'v9'), rule('edges[0].target', { code: 'VERTEX_NOT_FOUND' })],
    ['source e target inexistentes: aponta o source', (d) => { d.edges[0]!.source = 'v8'; d.edges[0]!.target = 'v9'; }, rule('edges[0].source', { code: 'VERTEX_NOT_FOUND' })],
    ['source vazio', (d) => (d.edges[1]!.source = ''), rule('edges[1].source', { code: 'VERTEX_NOT_FOUND' })],
    ['source é id de aresta', (d) => (d.edges[1]!.source = 'e1'), rule('edges[1].source', { code: 'VERTEX_NOT_FOUND' })],
    ['source "__proto__"', (d) => (d.edges[1]!.source = '__proto__'), rule('edges[1].source', { code: 'VERTEX_NOT_FOUND' })],
    ['source com id do vértice mas em maiúsculas', (d) => (d.edges[1]!.source = 'V2'), rule('edges[1].source', { code: 'VERTEX_NOT_FOUND' })],
    ['source gigante: o texto não aparece no erro', (d) => (d.edges[1]!.source = longo(100000)), rule('edges[1].source', { code: 'VERTEX_NOT_FOUND' })],
    ['laço', (d) => (d.edges[1]!.target = 'v2'), rule('edges[1]', { code: 'SELF_LOOP' })],
    ['laço em grafo orientado', (d) => { d.directed = true; d.edges[0]!.target = 'v1'; }, rule('edges[0]', { code: 'SELF_LOOP' })],
    ['aresta repetida (mesmo sentido)', (d) => d.edges.push({ id: 'e3', source: 'v1', target: 'v2' }) && (d.nextEdgeSeq = 4), rule('edges[2]', { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' })],
    ['aresta repetida no sentido oposto, grafo não orientado', (d) => d.edges.push({ id: 'e3', source: 'v2', target: 'v1' }) && (d.nextEdgeSeq = 4), rule('edges[2]', { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' })],
    ['aresta repetida (mesmo sentido), grafo orientado', (d) => { d.directed = true; d.edges.push({ id: 'e3', source: 'v2', target: 'v3', weight: 1 }); d.nextEdgeSeq = 4; }, rule('edges[2]', { code: 'DUPLICATE_EDGE', existingEdgeId: 'e2' })],
    ['a repetição é apontada na segunda ocorrência, com o id da primeira', (d) => { d.edges = [{ id: 'e1', source: 'v2', target: 'v3' }, { id: 'e2', source: 'v1', target: 'v2' }, { id: 'e5', source: 'v3', target: 'v2' }]; d.nextEdgeSeq = 6; }, rule('edges[2]', { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' })],
  ];

  const pesos: Caso[] = [
    ...[null, '1', 'abc', '', true, false, {}, [], [1]].map(
      (valor): Caso => [`peso ${JSON.stringify(valor)}`, (d) => (d.edges[0]!.weight = valor), badWeight('edges[0].weight')],
    ),
    ['peso em texto numérico na segunda aresta', (d) => (d.edges[1]!.weight = '3'), badWeight('edges[1].weight')],
  ];

  const ordem: Caso[] = [
    ['id inválido vem antes de extremo inexistente', (d) => { d.edges[0]!.id = 'x'; d.edges[0]!.source = 'v9'; }, bad('edges[0].id', 'INVALID_ID')],
    ['tipo do target vem antes de source inexistente', (d) => { d.edges[0]!.source = 'v9'; d.edges[0]!.target = 5; }, bad('edges[0].target', 'WRONG_TYPE')],
    ['source inexistente vem antes do laço e do peso', (d) => { d.edges[0]!.source = 'v9'; d.edges[0]!.weight = null; }, rule('edges[0].source', { code: 'VERTEX_NOT_FOUND' })],
    ['laço vem antes do peso inválido', (d) => { d.edges[0]!.target = 'v1'; d.edges[0]!.weight = null; }, rule('edges[0]', { code: 'SELF_LOOP' })],
    ['peso inválido vem antes da repetição', (d) => { d.edges.push({ id: 'e3', source: 'v1', target: 'v2', weight: null }); d.nextEdgeSeq = 4; }, badWeight('edges[2].weight')],
    ['vértices são lidos por inteiro antes das arestas', (d) => { d.edges[0]!.source = 'v9'; d.vertices[2]!.label = ''; }, badLabel('vertices[2].label', 'EMPTY')],
    ['vertices não-array vem antes de qualquer elemento de edges', (d) => { d.vertices = 3 as never; d.edges[0] = null as never; }, bad('vertices', 'NOT_AN_ARRAY')],
    ['tipos dos campos simples vêm antes dos arrays', (d) => { d.directed = 'x'; d.vertices = null as never; }, bad('directed', 'WRONG_TYPE')],
    ['campos obrigatórios ausentes vêm antes dos tipos', (d) => { drop(d, 'nextEdgeSeq'); d.name = 1; }, bad('nextEdgeSeq', 'MISSING_FIELD')],
  ];

  const grupos: [string, Caso[]][] = [
    ['versão do esquema', versao],
    ['campos ausentes', camposAusentes],
    ['campos desconhecidos', camposDesconhecidos],
    ['tipos', tipos],
    ['contadores', contadores],
    ['ids de vértice', idsDeVertice],
    ['rótulos', rotulos],
    ['ids de aresta', idsDeAresta],
    ['extremos, laços e repetições', extremos],
    ['pesos', pesos],
    ['ordem das verificações', ordem],
  ];

  for (const [titulo, casos] of grupos) {
    describe(titulo, () => {
      it.each(casos)('%s', (_nome, mudar, esperado) => {
        const doc = withDoc(mudar);

        expectError(parseGraph(doc), esperado);
        expectError(parseGraphJson(JSON.stringify(doc)), esperado);
      });
    });
  }

  it('o corpus é grande e cobre cada motivo de recusa do JSON', () => {
    const todos = grupos.flatMap(([, casos]) => casos);
    const motivos = new Set(
      todos.map(([, , erro]) => (erro.code === 'INVALID_DOCUMENT' ? erro.reason : erro.code)),
    );

    expect(todos.length).toBeGreaterThan(150);
    for (const esperado of [
      'MISSING_FIELD',
      'UNKNOWN_FIELD',
      'WRONG_TYPE',
      'NOT_AN_OBJECT',
      'NOT_AN_ARRAY',
      'INVALID_ID',
      'DUPLICATE_ID',
      'INVALID_COUNTER',
      'COUNTER_TOO_LOW',
      'DOMAIN_RULE',
      'UNSUPPORTED_SCHEMA_VERSION',
    ]) {
      expect(motivos).toContain(esperado);
    }
  });

  it('nenhum erro do corpus tem forma fora do contrato', () => {
    for (const [, casos] of grupos) {
      for (const [, mudar] of casos) {
        const resultado = parseGraph(withDoc(mudar));

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
      }
    }
  });
});

describe('o que é aceito: limites exatos das regras', () => {
  it('rótulo com exatamente 64 caracteres, 64 emojis, espaços e quebras no meio, NUL e surrogate solto', () => {
    for (const label of ['a'.repeat(64), '😀'.repeat(64), 'A B', 'a\nb', '\u0000', '\ud800', 'x'.repeat(63) + '😀']) {
      const doc = withDoc((d) => (d.vertices[0]!.label = label));

      expect(must(parseGraph(doc)).vertices[0]!.label).toBe(label);
    }
  });

  it('rótulos repetidos são permitidos (a identidade é o id)', () => {
    const doc = withDoc((d) => d.vertices.forEach((v) => (v.label = 'igual')));

    expect(must(parseGraph(doc)).vertices.map((v) => v.label)).toStrictEqual(['igual', 'igual', 'igual']);
  });

  it('ids em ordem não crescente são aceitos e a ordem é mantida', () => {
    const doc = withDoc((d) => {
      d.vertices = [{ id: 'v3', label: 'C' }, { id: 'v1', label: 'A' }, { id: 'v2', label: 'B' }];
      d.edges = [{ id: 'e2', source: 'v2', target: 'v3' }, { id: 'e1', source: 'v3', target: 'v1' }];
    });
    const graph = must(parseGraph(doc));

    expect(graph.vertices.map((v) => v.id)).toStrictEqual(['v3', 'v1', 'v2']);
    expect(graph.edges.map((e) => e.id)).toStrictEqual(['e2', 'e1']);
  });

  it('contador exatamente um acima do maior id é aceito; com lacuna grande também', () => {
    expect(must(parseGraph(validDoc())).nextVertexSeq).toBe(4);
    expect(must(parseGraph(withDoc((d) => (d.nextVertexSeq = 1e15)))).nextVertexSeq).toBe(1e15);
    expect(must(parseGraph(withDoc((d) => (d.nextEdgeSeq = Number.MAX_SAFE_INTEGER)))).nextEdgeSeq).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('o maior id que admite contador válido: v9007199254740990 com nextVertexSeq 9007199254740991', () => {
    const doc = withDoc((d) => {
      d.vertices = [{ id: 'v9007199254740990', label: 'A' }];
      d.edges = [];
      d.nextVertexSeq = 9007199254740991;
    });

    expect(must(parseGraph(doc)).vertices[0]!.id).toBe('v9007199254740990');
  });

  it('arcos em sentidos opostos são válidos em grafo orientado (e repetição em não orientado não)', () => {
    const arcos = (directed: boolean) =>
      withDoc((d) => {
        d.directed = directed;
        d.edges = [{ id: 'e1', source: 'v1', target: 'v2' }, { id: 'e2', source: 'v2', target: 'v1' }];
      });

    expect(must(parseGraph(arcos(true))).edges).toHaveLength(2);
    expectError(parseGraph(arcos(false)), rule('edges[1]', { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' }));
  });

  it('peso ausente, 0 e negativo são aceitos e continuam diferentes', () => {
    const doc = withDoc((d) => {
      d.edges = [
        { id: 'e1', source: 'v1', target: 'v2' },
        { id: 'e2', source: 'v2', target: 'v3', weight: 0 },
        { id: 'e3', source: 'v1', target: 'v3', weight: -4 },
      ];
      d.nextEdgeSeq = 4;
    });
    const arestas = must(parseGraph(doc)).edges;

    expect(arestas.map((e) => e.weight)).toStrictEqual([undefined, 0, -4]);
    expect(arestas.map((e) => 'weight' in e)).toStrictEqual([false, true, true]);
  });

  it('`-0` em memória é normalizado para 0', () => {
    const graph = must(parseGraph(withDoc((d) => (d.edges[0]!.weight = -0))));

    expect(Object.is(graph.edges[0]!.weight, 0)).toBe(true);
    expect(Object.is(graph.edges[0]!.weight, -0)).toBe(false);
  });

  it('`Object.create(null)` e objetos de outro realm são objetos simples', () => {
    const vm = jest.requireActual<{ runInNewContext(code: string): unknown }>('node:vm');
    const semProtótipo = Object.assign(Object.create(null) as Obj, validDoc());
    const deOutroRealm = vm.runInNewContext(`(${JSON.stringify(validDoc())})`);

    expect(parseGraph(semProtótipo)).toStrictEqual({ ok: true, value: validGraph() });
    expect(parseGraph(deOutroRealm)).toStrictEqual({ ok: true, value: validGraph() });
  });
});

describe('entradas inválidas que só existem em memória', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['número', 5],
    ['texto', '{}'],
    ['booleano', true],
    ['bigint', 1n],
    ['símbolo', Symbol('doc')],
    ['função', () => validDoc()],
    ['array vazio', []],
    ['array com o documento', [validDoc()]],
    ['Map', new Map(Object.entries(validDoc()))],
    ['Date', new Date(0)],
    ['instância de classe com os campos certos', Object.assign(new (class Documento {})(), validDoc())],
    ['objeto cujo protótipo tem os campos (herdados)', Object.create(validDoc())],
    ['objeto com `__proto__` literal (define o protótipo)', { __proto__: validDoc() }],
    ['objeto em torno de outro (Object.create(Object.create({})))', Object.assign(Object.create(Object.create({})), validDoc())],
    ['array sem protótipo com as chaves do documento', Object.assign(Object.setPrototypeOf([], null) as Obj, validDoc())],
  ])('raiz inválida: %s', (_nome, entrada) => {
    expectError(parseGraph(entrada), bad('', 'NOT_AN_OBJECT'));
  });

  it('um array sem protótipo no lugar de vértice ou aresta também não é objeto', () => {
    const arraySemPrototipo = () => Object.setPrototypeOf([], null) as Obj;

    expectError(parseGraph(withDoc((d) => (d.vertices[1] = arraySemPrototipo()))), bad('vertices[1]', 'NOT_AN_OBJECT'));
    expectError(parseGraph(withDoc((d) => (d.edges[0] = arraySemPrototipo()))), bad('edges[0]', 'NOT_AN_OBJECT'));
  });

  it('schemaVersion NaN e Infinity são versões não suportadas', () => {
    expectError(parseGraph(withDoc((d) => (d.schemaVersion = Number.NaN))), unsupported(Number.NaN));
    expectError(parseGraph(withDoc((d) => (d.schemaVersion = Number.POSITIVE_INFINITY))), unsupported(Number.POSITIVE_INFINITY));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['undefined explícito (diferente de ausente)', undefined],
    ['bigint', 1n],
    ['Number embrulhado', new Number(1)],
    ['símbolo', Symbol('1')],
    ['função', () => 1],
  ])('peso inválido: %s', (_nome, peso) => {
    expectError(parseGraph(withDoc((d) => (d.edges[0]!.weight = peso))), badWeight('edges[0].weight'));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-0', -0],
    ['bigint', 4n],
  ])('contador inválido: %s', (_nome, valor) => {
    const esperado = typeof valor === 'bigint' ? bad('nextVertexSeq', 'WRONG_TYPE') : bad('nextVertexSeq', 'INVALID_COUNTER');

    expectError(parseGraph(withDoc((d) => (d.nextVertexSeq = valor))), esperado);
  });

  it('id e rótulo que não são strings (objeto com toString, símbolo)', () => {
    const maroto = { toString: () => 'v1' };

    expectError(parseGraph(withDoc((d) => (d.vertices[0]!.id = maroto))), bad('vertices[0].id', 'WRONG_TYPE'));
    expectError(parseGraph(withDoc((d) => (d.vertices[0]!.label = maroto))), badLabel('vertices[0].label', 'NOT_A_STRING'));
    expectError(parseGraph(withDoc((d) => (d.edges[0]!.source = Symbol('v1')))), bad('edges[0].source', 'WRONG_TYPE'));
  });

  describe('arrays esparsos e array-likes', () => {
    it('buraco no meio de `vertices`', () => {
      const doc = withDoc(() => undefined);
      doc.vertices = [{ id: 'v1', label: 'A' }, , { id: 'v3', label: 'C' }] as Obj[];

      expectError(parseGraph(doc), bad('vertices[1]', 'SPARSE_ARRAY'));
    });

    it('array só de buracos (new Array(3)) e buraco no fim (length maior que os elementos)', () => {
      expectError(parseGraph(withDoc((d) => (d.vertices = new Array(3) as Obj[]))), bad('vertices[0]', 'SPARSE_ARRAY'));
      expectError(
        parseGraph(withDoc((d) => { d.edges.length = 4; })),
        bad('edges[2]', 'SPARSE_ARRAY'),
      );
    });

    it('buraco em `edges`', () => {
      const doc = withDoc((d) => { delete d.edges[0]; });

      expectError(parseGraph(doc), bad('edges[0]', 'SPARSE_ARRAY'));
    });

    it('elemento `undefined` explícito não é buraco: é um valor que não é objeto', () => {
      expectError(parseGraph(withDoc((d) => (d.vertices[1] = undefined as never))), bad('vertices[1]', 'NOT_AN_OBJECT'));
    });

    it('`delete` no último elemento de um array real também deixa buraco', () => {
      const doc = withDoc((d) => { delete d.vertices[2]; });

      expectError(parseGraph(doc), bad('vertices[2]', 'SPARSE_ARRAY'));
    });

    it.each([
      ['objeto array-like', { length: 1, 0: { id: 'v1', label: 'A' } }],
      ['Set', new Set([{ id: 'v1', label: 'A' }])],
      ['Uint8Array', new Uint8Array(2)],
      ['texto', 'abc'],
    ])('`vertices` que parece mas não é array: %s', (_nome, valor) => {
      expectError(parseGraph(withDoc((d) => (d.vertices = valor as never))), bad('vertices', 'NOT_AN_ARRAY'));
    });

    it('arrays vazios no lugar dos objetos', () => {
      expectError(parseGraph(withDoc((d) => (d.vertices[0] = [] as never))), bad('vertices[0]', 'NOT_AN_OBJECT'));
    });

    it('um array propriamente dito com propriedade extra não-índice é lido só pelos elementos', () => {
      const vertices = Object.assign([{ id: 'v1', label: 'A' }], { extra: 'ignorado' });
      const graph = must(parseGraph(withDoc((d) => { d.vertices = vertices; d.edges = []; d.nextVertexSeq = 2; d.nextEdgeSeq = 1; })));

      expect(graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]);
      expect(Object.keys(graph.vertices)).toStrictEqual(['0']);
    });
  });

  describe('campos desconhecidos que só existem em memória', () => {
    it('chave com símbolo', () => {
      const comSimbolo = (alvo: Obj) => Object.defineProperty(alvo, Symbol('x'), { value: 1, enumerable: true });

      expectError(parseGraph(withDoc((d) => comSimbolo(d))), bad('', 'UNKNOWN_FIELD'));
      expectError(parseGraph(withDoc((d) => comSimbolo(d.vertices[0]!))), bad('vertices[0]', 'UNKNOWN_FIELD'));
    });

    it('propriedade extra não enumerável', () => {
      const doc = withDoc((d) => Object.defineProperty(d.edges[1]!, 'oculta', { value: 1, enumerable: false }));

      expectError(parseGraph(doc), bad('edges[1]', 'UNKNOWN_FIELD'));
    });

    it('propriedade do esquema não enumerável é ilegível', () => {
      const doc = withDoc((d) => Object.defineProperty(d, 'name', { value: 'x', enumerable: false, configurable: true, writable: true }));

      expectError(parseGraph(doc), bad('name', 'UNREADABLE'));
    });

    it('propriedade herdada não conta como campo: o campo continua ausente', () => {
      const prototipoRaiz = Object.assign(Object.create(null) as Obj, { name: 'herdado' }); // protótipo sem protótipo
      const doc = Object.assign(Object.create(prototipoRaiz) as Obj, validDoc());
      drop(doc, 'name');

      expect(doc.name).toBe('herdado');
      expectError(parseGraph(doc), bad('name', 'MISSING_FIELD'));
    });

    it('protótipo comum com propriedades herdadas: a raiz deixa de ser um objeto simples', () => {
      const doc = Object.assign(Object.create({ name: 'herdado' }) as Obj, validDoc());
      drop(doc, 'name');

      expectError(parseGraph(doc), bad('', 'NOT_AN_OBJECT'));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Texto JSON
// ---------------------------------------------------------------------------------------------

describe('parseGraphJson: sintaxe e tipos de raiz', () => {
  const texto = golden('undirected-weighted-after-removals.json');

  it.each([
    ['vazio', ''],
    ['só espaços', '   \n\t '],
    ['chave aberta', '{'],
    ['chave fechada', '}'],
    ['valor ausente', '{"a":}'],
    ['vírgula sobrando', '{"schemaVersion":1,}'],
    ['aspas simples', "{'schemaVersion':1}"],
    ['chave sem aspas', '{schemaVersion:1}'],
    ['undefined', 'undefined'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['array aberto', '[1,2'],
    ['chave a mais', '{"a":1}}'],
    ['dois documentos', `${texto}${texto}`],
    ['lixo no fim', `${texto}x`],
    ['BOM no início (não é JSON; quem lê o arquivo o retira)', `﻿${texto}`],
    ['zero à esquerda', '{"schemaVersion":01}'],
    ['comentário', `/* x */${texto}`],
    ['string não terminada', '{"schemaVersion'],
    ['escape inválido', '{"id":"\\x"}'],
    ['caractere de controle numa string', '{"id":"a\nb"}'],
  ])('sintaxe inválida: %s', (_nome, entrada) => {
    expectError(parseGraphJson(entrada), bad('', 'INVALID_JSON'));
  });

  it('todo prefixo próprio de um documento válido é JSON inválido (nenhum lança)', () => {
    for (let n = 0; n < texto.length; n++) {
      expectError(parseGraphJson(texto.slice(0, n)), bad('', 'INVALID_JSON'));
    }
    expect(parseGraphJson(texto).ok).toBe(true);
  });

  it.each([
    ['null', 'null'],
    ['número', '123'],
    ['texto', '"texto"'],
    ['booleano', 'true'],
    ['array vazio', '[]'],
    ['array com o documento', `[${texto}]`],
  ])('JSON válido que não é objeto: %s', (_nome, entrada) => {
    expectError(parseGraphJson(entrada), bad('', 'NOT_AN_OBJECT'));
  });

  it('1e999 no texto vira Infinity no JSON.parse e é recusado como peso ou contador', () => {
    expectError(parseGraphJson(texto.replace('"weight":7', '"weight":1e999')), badWeight('edges[3].weight'));
    expectError(parseGraphJson(texto.replace('"weight":7', '"weight":-1e999')), badWeight('edges[3].weight'));
    expectError(parseGraphJson(texto.replace('"nextEdgeSeq":6', '"nextEdgeSeq":1e999')), bad('nextEdgeSeq', 'INVALID_COUNTER'));
  });

  it('inteiros acima de 2^53 perdem precisão no JSON.parse e são recusados como contador', () => {
    expectError(parseGraphJson(texto.replace('"nextVertexSeq":6', '"nextVertexSeq":9007199254740993')), bad('nextVertexSeq', 'INVALID_COUNTER'));
  });

  it('a primeira chave repetida perde: vale a última (comportamento do JSON.parse), e o resultado é canônico', () => {
    const repetido = texto.replace('"name":"Grafo de teste: ação"', '"name":"primeiro","name":"Grafo de teste: ação"');

    expect(serializeGraph(must(parseGraphJson(repetido)))).toBe(texto);
  });

  it('aninhamento gigantesco devolve erro (sem estourar a pilha nem lançar)', () => {
    const profundidade = 200_000;
    const colchetes = '['.repeat(profundidade) + ']'.repeat(profundidade);
    const objetos = '{"a":'.repeat(profundidade) + '1' + '}'.repeat(profundidade);
    const noNome = texto.replace('"name":"Grafo de teste: ação"', `"name":${colchetes}`);

    for (const entrada of [colchetes, objetos, noNome, '['.repeat(profundidade)]) {
      const resultado = parseGraphJson(entrada);

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
    }
  });

  it('o erro de sintaxe não repassa a mensagem do motor (que cita o texto)', () => {
    const resultado = parseGraphJson('{"segredo-no-texto": tru}');

    expect(JSON.stringify(resultado)).not.toContain('segredo');
    expect(resultado).toStrictEqual({ ok: false, error: bad('', 'INVALID_JSON') });
  });

  it('o parâmetro que não é string (chamador sem tipos) é recusado', () => {
    for (const entrada of [undefined, null, 5, {}, [], validDoc(), Symbol('x')]) {
      expectError(parseGraphJson(entrada as never), bad('', 'WRONG_TYPE'));
    }
  });

  it('caracteres especiais em nome e rótulos, com escapes, voltam do texto', () => {
    const grafo = {
      ...validDoc(),
      name: 'a"b\\c\n \ud800😀',
      vertices: [{ id: 'v1', label: 'ç"\\/\u0000' }],
      edges: [],
      nextVertexSeq: 2,
      nextEdgeSeq: 1,
    };
    const lido = must(parseGraphJson(JSON.stringify(grafo)));

    expect(lido.name).toBe('a"b\\c\n \ud800😀');
    expect(lido.vertices[0]!.label).toBe('ç"\\/\u0000');
  });
});

// ---------------------------------------------------------------------------------------------
// Limites e opções
// ---------------------------------------------------------------------------------------------

describe('limites configuráveis', () => {
  const texto = golden('undirected-weighted-after-removals.json'); // 4 vértices, 4 arestas

  it('maxTextLength: igual ao tamanho passa; um a menos recusa', () => {
    expect(parseGraphJson(texto, { maxTextLength: texto.length }).ok).toBe(true);
    expectError(parseGraphJson(texto, { maxTextLength: texto.length - 1 }), bad('', 'LIMIT_EXCEEDED'));
    expectError(parseGraphJson(texto, { maxTextLength: 0 }), bad('', 'LIMIT_EXCEEDED'));
  });

  it('maxTextLength é conferido ANTES do JSON.parse, mesmo para texto que nem é JSON', () => {
    const parse = jest.spyOn(JSON, 'parse');
    let chamadas: number;
    let resultados: Result<Graph>[];
    try {
      resultados = [
        parseGraphJson('x'.repeat(1000), { maxTextLength: 999 }),
        parseGraphJson(texto, { maxTextLength: 10 }),
      ];
      chamadas = parse.mock.calls.length;
    } finally {
      parse.mockRestore();
    }

    expect(chamadas).toBe(0);
    for (const resultado of resultados) expectError(resultado, bad('', 'LIMIT_EXCEEDED'));
  });

  it('maxTextLength mede unidades UTF-16 (text.length), não bytes nem pontos de código', () => {
    const doc = JSON.stringify({ ...validDoc(), name: '😀😀' });

    expect(parseGraphJson(doc, { maxTextLength: doc.length }).ok).toBe(true);
    expect(parseGraphJson(doc, { maxTextLength: doc.length - 1 }).ok).toBe(false);
  });

  it('maxVertices: igual passa, um a menos recusa; zero só aceita grafo sem vértices', () => {
    expect(parseGraphJson(texto, { maxVertices: 4 }).ok).toBe(true);
    expectError(parseGraphJson(texto, { maxVertices: 3 }), bad('vertices', 'LIMIT_EXCEEDED'));
    expectError(parseGraph(JSON.parse(texto), { maxVertices: 0 }), bad('vertices', 'LIMIT_EXCEEDED'));
    expect(parseGraphJson(golden('empty.json'), { maxVertices: 0, maxEdges: 0 }).ok).toBe(true);
  });

  it('maxEdges: igual passa, um a menos recusa', () => {
    expect(parseGraphJson(texto, { maxEdges: 4 }).ok).toBe(true);
    expectError(parseGraphJson(texto, { maxEdges: 3 }), bad('edges', 'LIMIT_EXCEEDED'));
  });

  it('os limites valem juntos e o de vértices é conferido primeiro', () => {
    expectError(parseGraphJson(texto, { maxVertices: 1, maxEdges: 1 }), bad('vertices', 'LIMIT_EXCEEDED'));
    expect(parseGraphJson(texto, { maxTextLength: 1000, maxVertices: 4, maxEdges: 4 }).ok).toBe(true);
  });

  it('sem opções não há limite (o domínio não define valores padrão)', () => {
    const grande = withDoc((d) => {
      d.vertices = Array.from({ length: 5000 }, (_, i) => ({ id: `v${i + 1}`, label: 'N' }));
      d.edges = [];
      d.nextVertexSeq = 5001;
      d.nextEdgeSeq = 1;
    });

    expect(must(parseGraph(grande)).vertices).toHaveLength(5000);
    expect(must(parseGraph(grande, {})).vertices).toHaveLength(5000);
    expect(must(parseGraph(grande, { maxVertices: undefined })).vertices).toHaveLength(5000);
  });

  it('o limite é conferido antes de ler qualquer elemento do array', () => {
    const leituras: string[] = [];
    const vigiado = new Proxy(validDoc().vertices, {
      getOwnPropertyDescriptor(alvo, chave) {
        leituras.push(String(chave));
        return Reflect.getOwnPropertyDescriptor(alvo, chave);
      },
    });
    const resultado = parseGraph(withDoc((d) => (d.vertices = vigiado)), { maxVertices: 2 });

    expectError(resultado, bad('vertices', 'LIMIT_EXCEEDED'));
    expect(leituras).toStrictEqual(['length']);
  });

  it('um array gigantesco e esparso (length 2^32 − 1) é recusado pelo limite e, sem limite, no primeiro buraco', () => {
    const arestasGigantes = withDoc((d) => (d.edges = new Array(2 ** 32 - 1) as Obj[]));

    expectError(parseGraph(arestasGigantes, { maxEdges: 0 }), bad('edges', 'LIMIT_EXCEEDED'));
    expectError(parseGraph(arestasGigantes), bad('edges[0]', 'SPARSE_ARRAY'));
    expectError(parseGraph(withDoc((d) => (d.vertices = new Array(2 ** 32 - 1) as Obj[])), { maxVertices: 100 }), bad('vertices', 'LIMIT_EXCEEDED'));
  });

  describe('teto técnico de vértices (⌊√(2⁵³−1)⌋ = 94 906 265, para a chave exata dos pares de extremos)', () => {
    const TETO = 94_906_265;
    const comVertices = (n: number) => withDoc((d) => (d.vertices = new Array(n) as Obj[]));

    it('no teto o array é lido (e recusado no primeiro buraco); um acima é LIMIT_EXCEEDED, sem ler elemento algum', () => {
      expectError(parseGraph(comVertices(TETO)), bad('vertices[0]', 'SPARSE_ARRAY'));
      expectError(parseGraph(comVertices(TETO + 1)), bad('vertices', 'LIMIT_EXCEEDED'));
      expectError(parseGraph(comVertices(2 ** 32 - 1)), bad('vertices', 'LIMIT_EXCEEDED'));
    });

    it('maxVertices acima do teto não o contorna; abaixo dele vale o menor', () => {
      expectError(parseGraph(comVertices(TETO + 1), { maxVertices: 2 ** 40 }), bad('vertices', 'LIMIT_EXCEEDED'));
      expectError(parseGraph(comVertices(TETO), { maxVertices: 10 }), bad('vertices', 'LIMIT_EXCEEDED'));
      expectError(parseGraph(comVertices(TETO), { maxVertices: TETO }), bad('vertices[0]', 'SPARSE_ARRAY'));
    });
  });

  it('rótulo gigante não vira lista de pontos de código (nenhum Array.from)', () => {
    const enormes = [
      withDoc((d) => (d.vertices[0]!.label = 'x'.repeat(5_000_000))),
      withDoc((d) => (d.vertices[0]!.label = '😀'.repeat(2_000_000))),
      withDoc((d) => (d.vertices[0]!.label = ` ${'y'.repeat(300)} `)),
    ];
    const from = jest.spyOn(Array, 'from');
    let chamadas: number;
    let resultados: Result<Graph>[];
    try {
      resultados = enormes.map((doc) => parseGraph(doc));
      chamadas = from.mock.calls.length;
    } finally {
      from.mockRestore();
    }

    expect(chamadas).toBe(0);
    for (const resultado of resultados) expectError(resultado, badLabel('vertices[0].label', 'TOO_LONG'));
  });

  it('id gigante é recusado sem varrer o texto (custo O(1), não O(tamanho do id))', () => {
    const doc = withDoc((d) => (d.vertices[0]!.id = `v${'9'.repeat(1_000_000)}`));
    const charCodeAt = jest.spyOn(String.prototype, 'charCodeAt');
    let chamadas: number;
    let resultado: Result<Graph>;
    try {
      resultado = parseGraph(doc);
      chamadas = charCodeAt.mock.calls.length;
    } finally {
      charCodeAt.mockRestore();
    }

    expectError(resultado, bad('vertices[0].id', 'INVALID_ID'));
    expect(chamadas).toBeLessThan(100);
  });

  describe('opções inválidas (erro de quem chama, devolvido como valor)', () => {
    it.each([
      ['maxVertices', -1],
      ['maxVertices', 1.5],
      ['maxVertices', Number.NaN],
      ['maxVertices', Number.POSITIVE_INFINITY],
      ['maxVertices', '10'],
      ['maxVertices', null],
      ['maxVertices', 2 ** 53],
      ['maxEdges', -1],
      ['maxEdges', 0.5],
      ['maxEdges', '5'],
      ['maxEdges', true],
      ['maxTextLength', -1],
      ['maxTextLength', Number.NaN],
      ['maxTextLength', {}],
      ['maxTextLength', 10n],
    ])('%s = %p', (campo, valor) => {
      const opcoes = { [campo]: valor } as ParseGraphOptions;
      const esperado = bad(`options.${campo}`, 'INVALID_OPTION');

      expectError(parseGraph(validDoc(), opcoes), esperado);
      expectError(parseGraphJson(JSON.stringify(validDoc()), opcoes), esperado);
    });

    it('opções que não são objeto', () => {
      for (const opcoes of [null, 5, 'x', true, () => 1]) {
        expectError(parseGraph(validDoc(), opcoes as never), bad('options', 'INVALID_OPTION'));
        expectError(parseGraphJson('{}', opcoes as never), bad('options', 'INVALID_OPTION'));
      }
    });

    it('opções com getter que lança não lançam para fora', () => {
      const hostil = {
        get maxVertices(): number {
          throw new Error('boom');
        },
      };

      expectError(parseGraph(validDoc(), hostil), bad('options', 'INVALID_OPTION'));
    });

    it('as opções são conferidas antes do documento', () => {
      expectError(parseGraph(null, { maxEdges: -1 }), bad('options.maxEdges', 'INVALID_OPTION'));
      expectError(parseGraphJson('{', { maxTextLength: 1.5 }), bad('options.maxTextLength', 'INVALID_OPTION'));
    });

    it('opções desconhecidas são ignoradas; zero e valores grandes são válidos', () => {
      const opcoes = { maxVertices: 0, maxEdges: Number.MAX_SAFE_INTEGER, outra: 1 } as ParseGraphOptions;

      expect(parseGraph(validDoc(), opcoes).ok).toBe(false);
      expect(parseGraph(validDoc(), { maxVertices: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
    });

    it('maxTextLength é ignorado por parseGraph (não há texto), mas continua sendo validado', () => {
      expect(parseGraph(validDoc(), { maxTextLength: 1 }).ok).toBe(true);
      expectError(parseGraph(validDoc(), { maxTextLength: -1 }), bad('options.maxTextLength', 'INVALID_OPTION'));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------------------------

describe('segurança: entradas hostis', () => {
  const texto = golden('directed-opposite-arcs.json');
  const protótipos = () => Object.getOwnPropertyNames(Object.prototype).sort();

  describe('propriedades perigosas', () => {
    const hostis = [
      '"__proto__":{"polluted":"sim"}',
      '"__proto__":null',
      '"__proto__":[]',
      '"constructor":{"prototype":{"polluted":"sim"}}',
      '"prototype":{"polluted":"sim"}',
      '"toString":"x"',
      '"hasOwnProperty":1',
      '"valueOf":null',
    ];

    it.each(hostis)('na raiz: %s', (campo) => {
      const resultado = parseGraphJson(`{${campo},${texto.slice(1)}`);

      expectError(resultado, bad('', 'UNKNOWN_FIELD'));
      expect(({} as Obj).polluted).toBeUndefined();
    });

    it.each(hostis)('no vértice: %s', (campo) => {
      const resultado = parseGraphJson(texto.replace('{"id":"v1"', `{${campo},"id":"v1"`));

      expectError(resultado, bad('vertices[0]', 'UNKNOWN_FIELD'));
      expect(({} as Obj).polluted).toBeUndefined();
    });

    it.each(hostis)('na aresta: %s', (campo) => {
      const resultado = parseGraphJson(texto.replace('{"id":"e2"', `{${campo},"id":"e2"`));

      expectError(resultado, bad('edges[1]', 'UNKNOWN_FIELD'));
      expect(({} as Obj).polluted).toBeUndefined();
    });

    it('depois de todos os casos o Object.prototype continua intacto', () => {
      const antes = protótipos();
      for (const campo of hostis) {
        parseGraphJson(`{${campo},${texto.slice(1)}`);
        parseGraph(JSON.parse(`{${campo},${texto.slice(1)}`));
      }

      expect(protótipos()).toStrictEqual(antes);
      expect(Object.keys(Object.prototype)).toStrictEqual([]);
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it('`__proto__` como valor (id, rótulo, nome) é só texto: não é campo nem altera protótipos', () => {
      const antes = protótipos();
      const doc = withDoc((d) => {
        d.name = '__proto__';
        d.id = 'constructor';
        d.vertices[0]!.label = '__proto__';
      });
      const graph = must(parseGraph(doc));

      expect(graph.name).toBe('__proto__');
      expect(graph.id).toBe('constructor');
      expect(graph.vertices[0]!.label).toBe('__proto__');
      expect(Object.getPrototypeOf(graph)).toBe(Object.prototype);
      expect(protótipos()).toStrictEqual(antes);
    });

    it('o grafo resultante e seus elementos têm o protótipo padrão e só as chaves do esquema', () => {
      const graph = must(parseGraphJson(texto));

      for (const objeto of [graph, ...graph.vertices, ...graph.edges]) {
        expect(Object.getPrototypeOf(objeto)).toBe(Object.prototype);
      }
      expect(Object.keys(graph)).toStrictEqual(DOC_KEYS);
      expect(Object.getOwnPropertySymbols(graph)).toHaveLength(0);
    });

    it('documento com protótipo substituído de verdade (setPrototypeOf) é recusado', () => {
      const doc = validDoc();
      Object.setPrototypeOf(doc, { polluted: true });

      expectError(parseGraph(doc), bad('', 'NOT_AN_OBJECT'));
    });
  });

  describe('getters e setters nunca são executados', () => {
    function comGetter(alvo: Obj, chave: string, valor: unknown): { chamadas: () => number } {
      let chamadas = 0;
      Object.defineProperty(alvo, chave, {
        enumerable: true,
        configurable: true,
        get() {
          chamadas++;
          return valor;
        },
      });
      return { chamadas: () => chamadas };
    }

    it.each([
      ['schemaVersion', (d: Doc) => d, 'schemaVersion', 1, 'schemaVersion'],
      ['name', (d: Doc) => d, 'name', 'x', 'name'],
      ['vertices', (d: Doc) => d, 'vertices', [], 'vertices'],
      ['nextEdgeSeq', (d: Doc) => d, 'nextEdgeSeq', 3, 'nextEdgeSeq'],
      ['id do vértice', (d: Doc) => d.vertices[0]!, 'id', 'v1', 'vertices[0].id'],
      ['label do vértice', (d: Doc) => d.vertices[2]!, 'label', 'C', 'vertices[2].label'],
      ['source da aresta', (d: Doc) => d.edges[1]!, 'source', 'v2', 'edges[1].source'],
      ['weight da aresta', (d: Doc) => d.edges[0]!, 'weight', 2, 'edges[0].weight'],
    ])('getter em %s', (_nome, alvo, chave, valor, caminho) => {
      const doc = validDoc();
      const espiao = comGetter(alvo(doc), chave, valor);

      expectError(parseGraph(doc), bad(caminho, 'UNREADABLE'));
      expect(espiao.chamadas()).toBe(0);
    });

    it('getter num elemento de array (defineProperty no índice)', () => {
      const doc = validDoc();
      let chamadas = 0;
      Object.defineProperty(doc.vertices, 1, {
        enumerable: true,
        configurable: true,
        get() {
          chamadas++;
          return { id: 'v2', label: 'B' };
        },
      });

      expectError(parseGraph(doc), bad('vertices[1]', 'UNREADABLE'));
      expect(chamadas).toBe(0);
    });

    it('setter sem getter também é ilegível (e não é chamado)', () => {
      const doc = validDoc();
      let chamadas = 0;
      Object.defineProperty(doc, 'id', {
        enumerable: true,
        set() {
          chamadas++;
        },
      });

      expectError(parseGraph(doc), bad('id', 'UNREADABLE'));
      expect(chamadas).toBe(0);
    });

    it('getter que lançaria não lança: nunca é chamado', () => {
      const doc = validDoc();
      Object.defineProperty(doc.edges[0]!, 'weight', {
        enumerable: true,
        get() {
          throw new Error('não deveria ser chamado');
        },
      });

      expectError(parseGraph(doc), bad('edges[0].weight', 'UNREADABLE'));
    });

    it('toString/valueOf/toJSON dos valores nunca são chamados', () => {
      const chamadas: string[] = [];
      const armadilha = {
        toString: () => (chamadas.push('toString'), 'v1'),
        valueOf: () => (chamadas.push('valueOf'), 1),
        toJSON: () => (chamadas.push('toJSON'), 'x'),
        [Symbol.toPrimitive]: () => (chamadas.push('toPrimitive'), 1),
      };
      for (const posicao of ['id', 'name', 'directed', 'schemaVersion', 'nextVertexSeq'] as const) {
        parseGraph(withDoc((d) => (d[posicao] = armadilha)));
      }
      parseGraph(withDoc((d) => (d.vertices[0]!.label = armadilha)));
      parseGraph(withDoc((d) => (d.edges[0]!.weight = armadilha)));
      parseGraph(withDoc((d) => (d.edges[0]!.source = armadilha)));

      expect(chamadas).toStrictEqual([]);
    });
  });

  describe('proxies', () => {
    const transparente = <T extends object>(alvo: T, tratadores: ProxyHandler<T> = {}) => new Proxy(alvo, tratadores);

    it('um proxy transparente é só dados: lido, sem usar [[Get]], e o resultado não é o proxy', () => {
      const get = jest.fn(() => {
        throw new Error('[[Get]] não deve ser usado');
      });
      const base = validDoc();
      base.vertices = base.vertices.map((v) => transparente(v, { get }));
      base.edges = base.edges.map((e) => transparente(e, { get }));
      base.vertices = transparente(base.vertices, { get });
      base.edges = transparente(base.edges, { get });
      const doc = transparente(base, { get });
      const resultado = parseGraph(doc);

      expect(resultado).toStrictEqual({ ok: true, value: validGraph() });
      expect(get).not.toHaveBeenCalled();
    });

    it('proxy cujo ownKeys lança: ilegível, sem lançar', () => {
      const lancar = () => {
        throw new Error('boom');
      };

      expectError(parseGraph(transparente(validDoc(), { ownKeys: lancar })), bad('', 'UNREADABLE'));
      expectError(parseGraph(withDoc((d) => (d.vertices[1] = transparente({ id: 'v2', label: 'B' }, { ownKeys: lancar })))), bad('vertices[1]', 'UNREADABLE'));
      expectError(parseGraph(withDoc((d) => (d.edges[0] = transparente(d.edges[0]!, { ownKeys: lancar })))), bad('edges[0]', 'UNREADABLE'));
    });

    it('proxy cujo getPrototypeOf ou getOwnPropertyDescriptor lança', () => {
      const lancar = () => {
        throw new Error('boom');
      };

      expectError(parseGraph(transparente(validDoc(), { getPrototypeOf: lancar })), bad('', 'UNREADABLE'));
      expectError(parseGraph(transparente(validDoc(), { getOwnPropertyDescriptor: lancar })), bad('', 'UNREADABLE'));
      expectError(
        parseGraph(withDoc((d) => (d.vertices = transparente(d.vertices, { getOwnPropertyDescriptor: lancar })))),
        bad('vertices', 'UNREADABLE'),
      );
    });

    it('proxy revogado (raiz, array, elemento)', () => {
      const revogado = <T extends object>(alvo: T): T => {
        const { proxy, revoke } = Proxy.revocable(alvo, {});
        revoke();
        return proxy;
      };

      expectError(parseGraph(revogado(validDoc())), bad('', 'UNREADABLE'));
      expectError(parseGraph(withDoc((d) => (d.vertices = revogado(d.vertices)))), bad('vertices', 'UNREADABLE'));
      expectError(parseGraph(withDoc((d) => (d.edges[1] = revogado(d.edges[1]!)))), bad('edges[1]', 'UNREADABLE'));
    });

    it('cada propriedade é lida UMA vez (um proxy que muda de valor não faz o resultado divergir do validado)', () => {
      const leituras = new Map<string, number>();
      const contar = (chave: string) => leituras.set(chave, (leituras.get(chave) ?? 0) + 1);
      const mentiroso = <T extends Obj>(alvo: T, nome: string): T =>
        new Proxy(alvo, {
          ownKeys(t) {
            contar(`${nome}:ownKeys`);
            return Reflect.ownKeys(t);
          },
          getOwnPropertyDescriptor(t, chave) {
            contar(`${nome}:${String(chave)}`);
            const descritor = Reflect.getOwnPropertyDescriptor(t, chave);
            // da segunda leitura em diante, devolve lixo que, se fosse usado, quebraria o resultado
            return (leituras.get(`${nome}:${String(chave)}`) ?? 0) > 1 && descritor && 'value' in descritor ? { ...descritor, value: ' lixo ' } : descritor;
          },
        });
      const doc = mentiroso(validDoc(), 'raiz');
      doc.vertices[0] = mentiroso({ id: 'v1', label: 'A' }, 'v0');
      doc.edges[0] = mentiroso({ id: 'e1', source: 'v1', target: 'v2', weight: 2 }, 'e0');
      const graph = must(parseGraph(doc));

      expect(graph).toStrictEqual(validGraph());
      for (const [chave, vezes] of leituras) expect([chave, vezes]).toStrictEqual([chave, 1]);
      expect(leituras.size).toBeGreaterThan(15);
    });
  });

  describe('sem compartilhar nada com a entrada', () => {
    it('alterar a entrada depois de ler não altera o grafo (por objeto)', () => {
      const doc = validDoc();
      const graph = must(parseGraph(doc));
      const antes = JSON.stringify(graph);

      doc.name = 'mudou';
      doc.vertices[0]!.label = 'mudou';
      doc.vertices.push({ id: 'v9', label: 'novo' });
      doc.edges[0]!.weight = 99;
      doc.edges.length = 0;
      doc.nextVertexSeq = 100;

      expect(JSON.stringify(graph)).toBe(antes);
      expect(graph).toStrictEqual(validGraph());
    });

    it('nenhum objeto ou array do resultado é um objeto da entrada', () => {
      const doc = validDoc();
      const daEntrada = new Set<unknown>([doc, doc.vertices, doc.edges, ...doc.vertices, ...doc.edges]);
      const graph = must(parseGraph(doc));
      const doResultado = [graph, graph.vertices, graph.edges, ...graph.vertices, ...graph.edges];

      for (const objeto of doResultado) expect(daEntrada.has(objeto)).toBe(false);
    });

    it('o resultado é mutável como qualquer grafo do domínio e editá-lo não toca na entrada', () => {
      const doc = deepFreeze(validDoc());
      const antes = JSON.stringify(doc);
      const graph = must(parseGraph(doc));

      expect(Object.isFrozen(graph)).toBe(false);
      expect(Object.isFrozen(graph.vertices)).toBe(false);
      (graph.vertices as unknown as Obj[]).push({ id: 'v9', label: 'x' });
      expect(JSON.stringify(doc)).toBe(antes);
    });

    it('a entrada congelada é lida sem erro e não é alterada (nem por leitura inválida)', () => {
      for (const mudar of [() => undefined, (d: Doc) => (d.nextVertexSeq = 1), (d: Doc) => (d.edges[0]!.weight = null)]) {
        const doc = deepFreeze(withDoc(mudar));
        const antes = JSON.stringify(doc);
        parseGraph(doc);

        expect(JSON.stringify(doc)).toBe(antes);
      }
    });

    it('os descritores da entrada não mudam (nada é definido, apagado ou congelado nela)', () => {
      const doc = validDoc();
      const antes = JSON.stringify(Object.getOwnPropertyDescriptors(doc));
      parseGraph(doc);

      expect(JSON.stringify(Object.getOwnPropertyDescriptors(doc))).toBe(antes);
      expect(Object.isFrozen(doc)).toBe(false);
      expect(Object.isExtensible(doc)).toBe(true);
    });

    it('os erros não guardam referência a objetos da entrada nem copiam texto do documento', () => {
      const segredo = 'SEGREDO-9f3a';
      const alvos: [string, (d: Doc) => void][] = [
        ['campo desconhecido', (d) => (d[segredo] = { dentro: segredo })],
        ['campo desconhecido no vértice', (d) => (d.vertices[0]![segredo] = segredo)],
        ['peso', (d) => (d.edges[0]!.weight = { segredo })],
        ['peso em texto', (d) => (d.edges[0]!.weight = segredo)],
        ['rótulo não normalizado', (d) => (d.vertices[0]!.label = ` ${segredo} `)],
        ['rótulo longo', (d) => (d.vertices[0]!.label = segredo.repeat(100))],
        ['rótulo de outro tipo', (d) => (d.vertices[0]!.label = { segredo })],
        ['id de vértice', (d) => (d.vertices[0]!.id = segredo)],
        ['id de aresta', (d) => (d.edges[0]!.id = segredo)],
        ['extremo inexistente', (d) => (d.edges[0]!.source = segredo)],
        ['tipo do extremo', (d) => (d.edges[0]!.target = [segredo])],
        ['nome', (d) => (d.name = [segredo])],
        ['directed', (d) => (d.directed = segredo)],
        ['vértice', (d) => (d.vertices[1] = segredo as never)],
        ['contador', (d) => (d.nextVertexSeq = segredo)],
        ['versão em texto', (d) => (d.schemaVersion = segredo)],
        ['vertices', (d) => (d.vertices = { segredo } as never)],
      ];

      for (const [nome, mudar] of alvos) {
        const doc = withDoc(mudar);
        const resultado = parseGraph(doc);

        expect([nome, resultado.ok]).toStrictEqual([nome, false]);
        expect([nome, JSON.stringify(resultado).includes('SEGREDO')]).toStrictEqual([nome, false]);
        if (!resultado.ok) expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
      }
    });

    it('o erro de versão não vaza conteúdo: só o número e a lista de versões suportadas, nova a cada chamada', () => {
      const a = errorOf(parseGraph(withDoc((d) => (d.schemaVersion = 7)))) as Extract<GraphError, { code: 'UNSUPPORTED_SCHEMA_VERSION' }>;
      const b = errorOf(parseGraph(withDoc((d) => (d.schemaVersion = 7)))) as Extract<GraphError, { code: 'UNSUPPORTED_SCHEMA_VERSION' }>;

      expect(a).toStrictEqual(unsupported(7));
      expect(a.supported).not.toBe(b.supported);
      (a.supported as number[]).push(99);
      expect(b.supported).toStrictEqual([1]);
    });
  });

  it('nenhuma entrada inválida chega a lançar: texto, objeto e opções, em todas as combinações', () => {
    const entradas: unknown[] = [
      undefined, null, 0, 1, '', 'x', true, [], [[]], {}, { schemaVersion: 1 }, () => 1, Symbol('s'), 1n,
      new Date(NaN), /x/, new Error('x'), new Proxy({}, {}), Object.create(null),
    ];
    const opcoes: unknown[] = [undefined, {}, null, { maxVertices: 0 }, { maxTextLength: 1 }, 5];

    for (const entrada of entradas) {
      for (const opcao of opcoes) {
        expect(() => parseGraph(entrada, opcao as never)).not.toThrow();
        expect(() => parseGraphJson(entrada as never, opcao as never)).not.toThrow();
        for (const resultado of [parseGraph(entrada, opcao as never), parseGraphJson(entrada as never, opcao as never)]) {
          if (!resultado.ok) expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Concordância com as regras do domínio
// ---------------------------------------------------------------------------------------------

describe('o leitor concorda com o domínio (comparação com addVertex e addEdge)', () => {
  it('rótulos: aceita exatamente o que addVertex aceita SEM alterar; recusa pelo mesmo motivo', () => {
    const random = seededRandom(2024);
    const alfabeto = [' ', ' ', 'a', 'b', 'é', '😀', '\t', ' ', '\u0000', '\ud800', ' '];
    const rotulos: unknown[] = ['', ' ', 'A', ' A', 'A ', 'a'.repeat(64), 'a'.repeat(65), '😀'.repeat(64), '😀'.repeat(65)];
    for (let i = 0; i < 1500; i++) {
      const tamanho = Math.floor(random() * 70);
      rotulos.push(Array.from({ length: tamanho }, () => alfabeto[Math.floor(random() * alfabeto.length)]).join(''));
    }
    const estatisticas = { aceitos: 0, naoNormalizados: 0, vazios: 0, longos: 0 };

    for (const rotulo of rotulos) {
      const doc = withDoc((d) => {
        d.vertices = [{ id: 'v1', label: rotulo }];
        d.edges = [];
        d.nextVertexSeq = 2;
        d.nextEdgeSeq = 1;
      });
      const lido = parseGraph(doc);
      const criado = addVertex(createGraph({ id: 'g-base', name: 'Base' }), rotulo as string);

      if (!criado.ok) {
        const motivo = criado.error.code === 'INVALID_VERTEX_LABEL' ? criado.error.reason : 'outro';
        expect([rotulo, lido]).toStrictEqual([rotulo, { ok: false, error: badLabel('vertices[0].label', motivo as never) }]);
        if (motivo === 'EMPTY') estatisticas.vazios++;
        if (motivo === 'TOO_LONG') estatisticas.longos++;
      } else if (criado.value.vertex.label !== rotulo) {
        expect([rotulo, lido]).toStrictEqual([rotulo, { ok: false, error: badLabel('vertices[0].label', 'NOT_NORMALIZED') }]);
        estatisticas.naoNormalizados++;
      } else {
        expect([rotulo, lido]).toStrictEqual([rotulo, { ok: true, value: { ...criado.value.graph, nextVertexSeq: 2 } }]);
        estatisticas.aceitos++;
      }
    }

    expect(estatisticas.aceitos).toBeGreaterThan(100);
    expect(estatisticas.naoNormalizados).toBeGreaterThan(100);
    expect(estatisticas.vazios).toBeGreaterThan(5);
    expect(estatisticas.longos).toBeGreaterThan(5);
  });

  it.each([false, true])('arestas: o primeiro erro e o grafo final são os da criação por addEdge (orientado = %s)', (directed) => {
    const random = seededRandom(directed ? 77 : 78);
    const sorteia = <T>(itens: readonly T[]): T => itens[Math.floor(random() * itens.length)]!;
    const PESOS_VALIDOS: readonly unknown[] = ['sem', 'sem', 0, -0, 2.5, -3];
    const PESOS_INVALIDOS: readonly unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, null, '5'];
    const estatisticas: Record<string, number> = {};

    for (let caso = 0; caso < 600; caso++) {
      // 3 a 5 vértices, com um removido em metade dos casos (lacuna nos ids); 'v99' nunca existe
      let base = withVertices(3 + Math.floor(random() * 3), directed);
      if (random() < 0.5) base = must(removeVertex(base, sorteia(base.vertices).id));
      const ids = [...base.vertices.map((v) => v.id), ...base.vertices.map((v) => v.id), 'v99'];
      const pedidos = Array.from({ length: Math.floor(random() * 9) }, () => ({
        source: sorteia(ids),
        target: sorteia(ids),
        weight: random() < 0.12 ? sorteia(PESOS_INVALIDOS) : sorteia(PESOS_VALIDOS),
      }));

      // o que o domínio diz, uma aresta por vez
      let grafo = base;
      let esperado: Result<Graph> = { ok: true, value: grafo };
      for (const [k, pedido] of pedidos.entries()) {
        const criada = addEdge(grafo, {
          source: pedido.source,
          target: pedido.target,
          weight: pedido.weight === 'sem' ? undefined : (pedido.weight as number),
        });
        if (criada.ok) {
          grafo = criada.value.graph;
          esperado = { ok: true, value: grafo };
          continue;
        }
        const erro = criada.error;
        const caminho = `edges[${k}]`;
        let causa: DocumentCause;
        let onde = caminho;
        if (erro.code === 'VERTEX_NOT_FOUND') {
          causa = { code: 'VERTEX_NOT_FOUND' };
          onde = `${caminho}.${erro.vertexId === pedido.source ? 'source' : 'target'}`;
        } else if (erro.code === 'SELF_LOOP') causa = { code: 'SELF_LOOP' };
        else if (erro.code === 'INVALID_WEIGHT') {
          causa = { code: 'INVALID_WEIGHT' };
          onde = `${caminho}.weight`;
        } else if (erro.code === 'DUPLICATE_EDGE') causa = { code: 'DUPLICATE_EDGE', existingEdgeId: erro.existingEdgeId };
        else throw new Error(`código inesperado ${erro.code}`);
        estatisticas[erro.code] = (estatisticas[erro.code] ?? 0) + 1;
        esperado = { ok: false, error: rule(onde, causa) };
        break;
      }
      if (esperado.ok) estatisticas.ACEITO = (estatisticas.ACEITO ?? 0) + 1;

      // o mesmo conteúdo, como documento (ids e-sequenciais, como o domínio os teria emitido)
      const doc: Doc = {
        schemaVersion: 1,
        id: base.id,
        name: base.name,
        directed,
        vertices: base.vertices.filter((v) => v.id !== 'v99').map((v) => ({ id: v.id, label: v.label })),
        edges: pedidos.map((p, k) => ({
          id: `e${k + 1}`,
          source: p.source,
          target: p.target,
          ...(p.weight === 'sem' ? {} : { weight: p.weight }),
        })),
        nextVertexSeq: base.nextVertexSeq,
        nextEdgeSeq: pedidos.length + 1,
      };

      expect([caso, parseGraph(doc)]).toStrictEqual([caso, esperado]);
    }

    expect(estatisticas.ACEITO).toBeGreaterThan(30);
    for (const codigo of ['VERTEX_NOT_FOUND', 'SELF_LOOP', 'INVALID_WEIGHT', 'DUPLICATE_EDGE']) {
      expect(estatisticas[codigo]).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Entradas corrompidas aleatoriamente
// ---------------------------------------------------------------------------------------------

describe('entradas corrompidas aleatoriamente (nunca lança; se aceita, é um grafo válido)', () => {
  it('3000 documentos em memória com um campo trocado por lixo', () => {
    const random = seededRandom(31337);
    const sorteia = <T>(itens: readonly T[]): T => itens[Math.floor(random() * itens.length)]!;
    const lixo: unknown[] = [
      undefined, null, true, false, 0, -1, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0, 9007199254740993, '', 'x', 'v1', 'v2',
      'e1', 'v99', ' A ', 'A', '😀'.repeat(70), [], [1], {}, { a: 1 }, Symbol('s'), 10n, () => 1, new Date(0), 'v0', 'e2', 7, 4, 3,
    ];
    const acoes = ['trocar', 'trocar', 'trocar', 'apagar', 'extra'] as const;
    const resumo = { ok: 0, recusado: 0 };

    for (let i = 0; i < 3000; i++) {
      const doc = validDoc();
      const alvos: Obj[] = [doc, doc.vertices[sorteia([0, 1, 2])]!, doc.edges[sorteia([0, 1])]!, doc.edges[0]!];
      const alvo = sorteia(alvos);
      const chave = sorteia(Object.keys(alvo));
      const acao = sorteia(acoes);
      if (acao === 'trocar') alvo[chave] = sorteia(lixo);
      else if (acao === 'apagar') delete alvo[chave];
      else alvo[sorteia(['extra', 'x', 'weight', 'label', 'id', 'capacity'])] = sorteia(lixo);
      if (random() < 0.2) doc[sorteia(['vertices', 'edges'])] = sorteia(lixo) as never;

      const resultado = parseGraph(doc);
      if (resultado.ok) {
        resumo.ok++;
        expect(violations(resultado.value)).toStrictEqual([]);
        expect(parseGraphJson(serializeGraph(resultado.value))).toStrictEqual(resultado);
      } else {
        resumo.recusado++;
        expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
      }
    }

    expect(resumo.ok).toBeGreaterThan(50);
    expect(resumo.recusado).toBeGreaterThan(1500);
  });

  it('2500 textos com caracteres trocados, apagados ou inseridos', () => {
    const random = seededRandom(424242);
    const fontes = ['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json'].map(golden);
    const insercoes = ['"', '\\', '{', '}', '[', ']', ',', ':', '0', '9', '-', 'e', 'v', 'null', '1e999', '"\\u0000"', ' ', '\n'];
    const resumo = { ok: 0, recusado: 0 };

    for (let i = 0; i < 2500; i++) {
      let texto = fontes[i % fontes.length]!;
      for (let k = 0; k < 1 + Math.floor(random() * 3); k++) {
        const posicao = Math.floor(random() * texto.length);
        const insercao = insercoes[Math.floor(random() * insercoes.length)]!;
        const sorte = random();
        if (sorte < 0.4) texto = texto.slice(0, posicao) + insercao + texto.slice(posicao + 1);
        else if (sorte < 0.7) texto = texto.slice(0, posicao) + texto.slice(posicao + 1);
        else texto = texto.slice(0, posicao) + insercao + texto.slice(posicao);
      }

      const resultado = parseGraphJson(texto);
      if (resultado.ok) {
        resumo.ok++;
        expect(violations(resultado.value)).toStrictEqual([]);
        expect(parseGraphJson(serializeGraph(resultado.value))).toStrictEqual(resultado);
      } else {
        resumo.recusado++;
        expect(errorShapeProblems(resultado.error)).toStrictEqual([]);
      }
    }

    expect(resumo.ok).toBeGreaterThan(20);
    expect(resumo.recusado).toBeGreaterThan(1500);
  });
});

// ---------------------------------------------------------------------------------------------
// Escala
// ---------------------------------------------------------------------------------------------

describe('escala: a validação é linear (nenhuma busca quadrática)', () => {
  it('30 mil vértices e 120 mil arestas: leitura por texto e por objeto, ida e volta exata', () => {
    // Com busca linear por aresta o custo seria da ordem de 120 000² = 1,4·10¹⁰ passos e estouraria o tempo do teste.
    const n = 30_000;
    const vertices = Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, label: `N${i + 1}` }));
    const edges: Obj[] = [];
    for (let i = 0; i < n; i++) {
      for (const salto of [1, 7, 31, 127]) {
        const peso = edges.length % 3 === 0 ? { weight: edges.length % 5 } : {};
        edges.push({ id: `e${edges.length + 1}`, source: `v${i + 1}`, target: `v${((i + salto) % n) + 1}`, ...peso });
      }
    }
    const doc = { schemaVersion: 1, id: 'g-grande', name: 'Grande', directed: false, vertices, edges, nextVertexSeq: n + 1, nextEdgeSeq: edges.length + 1 };
    const texto = JSON.stringify(doc);
    const porTexto = must(parseGraphJson(texto, { maxVertices: n, maxEdges: 4 * n, maxTextLength: texto.length }));
    const porObjeto = must(parseGraph(doc));

    expect(porTexto.vertices).toHaveLength(n);
    expect(porTexto.edges).toHaveLength(4 * n);
    expect(porObjeto).toStrictEqual(porTexto);
    expect(serializeGraph(porTexto)).toBe(texto);
  });

  it('uma aresta repetida no meio de 100 mil é achada (a busca por pares é por mapa)', () => {
    const n = 20_000;
    const doc = withDoc((d) => {
      d.vertices = Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, label: 'N' }));
      d.edges = [];
      for (let i = 0; i < n; i++) {
        for (const salto of [1, 3, 5, 9, 11]) {
          d.edges.push({ id: `e${d.edges.length + 1}`, source: `v${i + 1}`, target: `v${((i + salto) % n) + 1}` });
        }
      }
      d.edges.push({ id: `e${d.edges.length + 1}`, source: 'v10001', target: 'v10002' }); // repete a aresta v10001 → v10002
      d.nextVertexSeq = n + 1;
      d.nextEdgeSeq = d.edges.length + 1;
    });
    const resultado = parseGraph(doc);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toMatchObject({
        code: 'INVALID_DOCUMENT',
        path: `edges[${doc.edges.length - 1}]`,
        cause: { code: 'DUPLICATE_EDGE', existingEdgeId: `e${5 * 10000 + 1}` },
      });
    }
  });
});
