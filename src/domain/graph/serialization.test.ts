import {
  addVertex,
  createGraph,
  GRAPH_SCHEMA_VERSION,
  removeEdge,
  removeVertex,
  serializeGraph,
  setEdgeWeight,
  setVertexLabel,
  type Graph,
} from './index';
import {
  connect,
  deepFreeze,
  digraphWithOpposites as D,
  graphOf,
  must,
  randomGraph,
  triangleWithTail as U,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Formato de persistência v1 (ver serialization.ts): chaves em ordem fixa, arrays na ordem de inserção,
// `weight` só quando existe, contadores gravados como estão, sem nada de interface.

declare const __dirname: string; // o Jest (CommonJS) fornece; evita depender dos tipos do Node
const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');

/** Lê um arquivo de referência. Normaliza fim de linha e quebra final, que dependem do Git e do editor. */
const golden = (name: string) =>
  fs.readFileSync(`${__dirname}/golden/v1/${name}`, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

type Doc = {
  schemaVersion: number;
  id: string;
  name: string;
  directed: boolean;
  vertices: { id: string; label: string }[];
  edges: { id: string; source: string; target: string; weight?: number }[];
  nextVertexSeq: number;
  nextEdgeSeq: number;
};
const parse = (text: string) => JSON.parse(text) as Doc;

const DOC_KEYS = ['schemaVersion', 'id', 'name', 'directed', 'vertices', 'edges', 'nextVertexSeq', 'nextEdgeSeq'];

/** Segunda implementação, independente, do formato compacto: concatenação de texto escrita à mão. */
function manualCompact(graph: Graph): string {
  const q = (text: string) => JSON.stringify(text);
  const vertices = graph.vertices.map((v) => `{"id":${q(v.id)},"label":${q(v.label)}}`).join(',');
  const edges = graph.edges
    .map(
      (e) =>
        `{"id":${q(e.id)},"source":${q(e.source)},"target":${q(e.target)}` +
        `${e.weight === undefined ? '' : `,"weight":${String(e.weight)}`}}`,
    )
    .join(',');
  return (
    `{"schemaVersion":${graph.schemaVersion},"id":${q(graph.id)},"name":${q(graph.name)},` +
    `"directed":${graph.directed},"vertices":[${vertices}],"edges":[${edges}],` +
    `"nextVertexSeq":${graph.nextVertexSeq},"nextEdgeSeq":${graph.nextEdgeSeq}}`
  );
}

// ---------------------------------------------------------------------------------------------
// Grafos que dão origem aos arquivos de referência (os arquivos foram escritos à mão, não gerados).
// ---------------------------------------------------------------------------------------------

function undirectedAfterRemovals(): Graph {
  let graph = createGraph({ id: 'g2', name: 'Grafo de teste: ação' });
  graph = must(addVertex(graph)).graph; // v1 "A"
  graph = must(addVertex(graph, 'Königsberg')).graph; // v2
  graph = must(addVertex(graph, '日本語')).graph; // v3
  graph = must(addVertex(graph, '🙂')).graph; // v4
  graph = must(addVertex(graph, 'provisório')).graph; // v5 (será removido)
  graph = connect(graph, 'v1', 'v2'); // e1, sem peso
  graph = connect(graph, 'v2', 'v3', 0); // e2, peso zero
  graph = connect(graph, 'v3', 'v4', -2.5); // e3, peso negativo
  graph = connect(graph, 'v4', 'v1', 7); // e4, peso positivo
  graph = connect(graph, 'v1', 'v3', 1); // e5 (será removida)
  graph = must(removeEdge(graph, 'e5'));
  return must(removeVertex(graph, 'v5'));
}

function directedOppositeArcs(): Graph {
  let graph = createGraph({ id: 'g3', directed: true });
  for (const label of ['A', 'B', 'C']) graph = must(addVertex(graph, label)).graph;
  graph = connect(graph, 'v1', 'v2', 0); // e1
  graph = connect(graph, 'v2', 'v1', -1); // e2, arco oposto com outro peso
  return connect(graph, 'v2', 'v3'); // e3, sem peso
}

describe('arquivos de referência (golden) do esquema v1', () => {
  it('grafo vazio, compacto', () => {
    expect(serializeGraph(createGraph({ id: 'g1' }))).toBe(golden('empty.json'));
  });

  it('não orientado, ponderado, com Unicode e contadores adiante dos ids (depois de remoções)', () => {
    expect(serializeGraph(undirectedAfterRemovals())).toBe(golden('undirected-weighted-after-removals.json'));
  });

  it('orientado, com arcos opostos e os três estados de peso, compacto', () => {
    expect(serializeGraph(directedOppositeArcs())).toBe(golden('directed-opposite-arcs.json'));
  });

  it('o mesmo grafo orientado, legível (pretty)', () => {
    expect(serializeGraph(directedOppositeArcs(), { pretty: true })).toBe(
      golden('directed-opposite-arcs.pretty.json'),
    );
  });

  it('os arquivos de referência são canônicos e pequenos', () => {
    for (const name of ['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json']) {
      const text = golden(name);

      expect(JSON.stringify(JSON.parse(text))).toBe(text); // compacto: nada além do JSON canônico
      expect(Object.keys(JSON.parse(text))).toStrictEqual(DOC_KEYS);
      expect(text.length).toBeLessThan(600);
    }
    expect(JSON.stringify(JSON.parse(golden('directed-opposite-arcs.pretty.json')))).toBe(
      golden('directed-opposite-arcs.json'),
    );
  });

  it('a versão do esquema é 1: mudar este número exige novos arquivos de referência e uma migração', () => {
    expect(GRAPH_SCHEMA_VERSION).toBe(1);
    for (const name of ['empty.json', 'undirected-weighted-after-removals.json', 'directed-opposite-arcs.json']) {
      expect(parse(golden(name)).schemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    }
  });
});

describe('estrutura do documento', () => {
  it('grafo vazio: texto exato', () => {
    expect(serializeGraph(createGraph({ id: 'g1' }))).toBe(
      '{"schemaVersion":1,"id":"g1","name":"","directed":false,"vertices":[],"edges":[],"nextVertexSeq":1,"nextEdgeSeq":1}',
    );
  });

  it('um vértice', () => {
    const graph = must(addVertex(createGraph({ id: 'g', name: 'Um' }))).graph;

    expect(parse(serializeGraph(graph))).toStrictEqual({
      schemaVersion: 1,
      id: 'g',
      name: 'Um',
      directed: false,
      vertices: [{ id: 'v1', label: 'A' }],
      edges: [],
      nextVertexSeq: 2,
      nextEdgeSeq: 1,
    });
  });

  it('vários vértices isolados, na ordem de inserção', () => {
    const doc = parse(serializeGraph(withVertices(4)));

    expect(doc.vertices).toStrictEqual([
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'B' },
      { id: 'v3', label: 'C' },
      { id: 'v4', label: 'D' },
    ]);
    expect(doc.edges).toStrictEqual([]);
  });

  it('as chaves do documento, do vértice e da aresta estão em ordem fixa', () => {
    const doc = parse(serializeGraph(W));

    expect(Object.keys(doc)).toStrictEqual(DOC_KEYS);
    expect(Object.keys(doc.vertices[0]!)).toStrictEqual(['id', 'label']);
    expect(Object.keys(doc.edges[0]!)).toStrictEqual(['id', 'source', 'target']); // e1 sem peso
    expect(Object.keys(doc.edges[1]!)).toStrictEqual(['id', 'source', 'target', 'weight']); // e2 com peso 0
  });

  it('orientação: `directed` reflete o grafo e nada mais muda entre as duas versões', () => {
    const nao = parse(serializeGraph(graphOf(2, [['v1', 'v2']])));
    const sim = parse(serializeGraph(graphOf(2, [['v1', 'v2']], true)));

    expect(nao.directed).toBe(false);
    expect(sim.directed).toBe(true);
    expect({ ...nao, directed: true }).toStrictEqual(sim);
  });

  it('o documento usa a versão de esquema do grafo (o domínio cria grafos com a versão atual)', () => {
    expect(parse(serializeGraph(U)).schemaVersion).toBe(GRAPH_SCHEMA_VERSION);
  });
});

describe('pesos: sem peso, zero, positivo e negativo', () => {
  it('só aparece `weight` quando a aresta tem peso, e os quatro estados continuam distintos', () => {
    const doc = parse(serializeGraph(W)); // e1 sem peso, e2 peso 0, e3 −2,5, e4 7

    expect(doc.edges.map((e) => ('weight' in e ? e.weight : 'sem peso'))).toStrictEqual(['sem peso', 0, -2.5, 7]);
    expect(serializeGraph(W)).not.toContain('"weight":null');
    expect(serializeGraph(W)).not.toContain('"weight":1,');
  });

  it('o texto contém `"weight":0` para peso zero e nenhuma chave `weight` para aresta sem peso', () => {
    const semPeso = serializeGraph(graphOf(2, [['v1', 'v2']]));
    const comZero = serializeGraph(must(setEdgeWeight(graphOf(2, [['v1', 'v2']]), 'e1', 0)));

    expect(semPeso).not.toContain('weight');
    expect(comZero).toContain('"weight":0}');
    expect(comZero).not.toBe(semPeso);
  });

  it('remover o peso tira a chave; refazer com zero a traz de volta', () => {
    const base = connect(withVertices(2), 'v1', 'v2', 5);
    const removido = must(setEdgeWeight(base, 'e1', undefined));

    expect(serializeGraph(removido)).not.toContain('weight');
    expect(serializeGraph(must(setEdgeWeight(removido, 'e1', 0)))).toContain('"weight":0');
  });

  it.each([0, 1, -1, 2.5, -2.5, 0.1, 1e21, 1e-7, -1e-7, Number.MAX_VALUE, Number.MIN_VALUE])(
    'o peso %s volta exatamente igual ao ser lido do JSON',
    (weight) => {
      const doc = parse(serializeGraph(connect(withVertices(2), 'v1', 'v2', weight)));

      expect(Object.is(doc.edges[0]!.weight, weight)).toBe(true);
    },
  );
});

describe('arcos em sentidos opostos', () => {
  it('são duas arestas com ids próprios, cada uma com seu peso', () => {
    const doc = parse(serializeGraph(WD)); // e1 v1→v2 peso 0, e2 v2→v1 peso −1, e3 v2→v3

    expect(doc.edges).toStrictEqual([
      { id: 'e1', source: 'v1', target: 'v2', weight: 0 },
      { id: 'e2', source: 'v2', target: 'v1', weight: -1 },
      { id: 'e3', source: 'v2', target: 'v3' },
    ]);
  });
});

describe('rótulos Unicode e caracteres especiais', () => {
  const rotulos = ['Königsberg', '日本語', '🙂', 'é', 'aspas "duplas"', 'barra \\ invertida', 'linha\nnova', 'a b', 'tab\there'];

  it.each(rotulos)('o rótulo %j volta exatamente igual', (label) => {
    const graph = must(addVertex(createGraph({ id: 'g' }), label)).graph;

    expect(parse(serializeGraph(graph)).vertices[0]!.label).toBe(label);
  });

  it('caracteres comuns saem sem escape e só o que o JSON exige é escapado', () => {
    const graph = [...rotulos].reduce((g, label) => must(addVertex(g, label)).graph, createGraph({ id: 'g' }));
    const text = serializeGraph(graph);

    expect(text).toContain('"label":"Königsberg"');
    expect(text).toContain('"label":"日本語"');
    expect(text).toContain('"label":"🙂"');
    expect(text).not.toContain('\\u00f6'); // ö não é escapado
    expect(text).toContain('\\"duplas\\"');
    expect(text).toContain('\\\\');
    expect(text).toContain('linha\\nnova');
    expect(text).not.toContain('\n'); // o texto compacto é uma linha só
  });

  it('não normaliza a forma Unicode: "e" + acento combinante continua sendo dois pontos de código', () => {
    const graph = must(addVertex(createGraph({ id: 'g' }), 'é')).graph;

    expect(parse(serializeGraph(graph)).vertices[0]!.label).toStrictEqual('é');
    expect(parse(serializeGraph(graph)).vertices[0]!.label).not.toBe('é');
  });

  it('grava o rótulo que o domínio guardou, sem tratamento próprio (o trim já foi feito ao editar)', () => {
    const editado = must(setVertexLabel(withVertices(1), 'v1', '  Origem  '));

    expect(editado.vertices[0]!.label).toBe('Origem');
    expect(parse(serializeGraph(editado)).vertices[0]!.label).toBe('Origem');
  });

  it('um rótulo com espaços nas pontas, vindo de um grafo adulterado, sai como está (sem trim)', () => {
    const adulterado = { ...withVertices(1), vertices: [{ id: 'v1', label: '  sem trim  ' }] } as Graph;

    expect(parse(serializeGraph(adulterado)).vertices[0]!.label).toBe('  sem trim  ');
  });
});

describe('identificadores e contadores', () => {
  it('os ids saem exatamente como estão no grafo', () => {
    const doc = parse(serializeGraph(U));

    expect(doc.vertices.map((v) => v.id)).toStrictEqual(U.vertices.map((v) => v.id));
    expect(doc.edges.map((e) => e.id)).toStrictEqual(U.edges.map((e) => e.id));
  });

  it('vértice removido: o contador continua adiante, então o id removido nunca é reaproveitado', () => {
    const graph = must(removeVertex(withVertices(3), 'v3')); // v1, v2 restantes
    const doc = parse(serializeGraph(graph));

    expect(doc.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2']);
    expect(doc.nextVertexSeq).toBe(4); // não 3 (= quantidade + 1)
    expect(doc.nextVertexSeq).not.toBe(doc.vertices.length + 1);
  });

  it('aresta removida: o mesmo vale para o contador de arestas', () => {
    let graph = graphOf(3, [
      ['v1', 'v2'],
      ['v2', 'v3'],
      ['v1', 'v3'],
    ]);
    graph = must(removeEdge(graph, 'e3'));
    const doc = parse(serializeGraph(graph));

    expect(doc.edges.map((e) => e.id)).toStrictEqual(['e1', 'e2']);
    expect(doc.nextEdgeSeq).toBe(4);
  });

  it('remover um vértice remove as arestas dele, mas os dois contadores só avançam', () => {
    const doc = parse(serializeGraph(must(removeVertex(U, 'v3')))); // v3 toca e1, e2, e3

    expect(doc.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2', 'v4', 'v5']);
    expect(doc.edges.map((e) => e.id)).toStrictEqual(['e4']);
    expect(doc.nextVertexSeq).toBe(6);
    expect(doc.nextEdgeSeq).toBe(5);
  });

  it('os contadores são os do grafo, nunca recalculados', () => {
    const graph = { ...withVertices(2), nextVertexSeq: 99, nextEdgeSeq: 42 };
    const doc = parse(serializeGraph(graph));

    expect(doc.nextVertexSeq).toBe(99);
    expect(doc.nextEdgeSeq).toBe(42);
  });

  it('id e nome do grafo acompanham o documento', () => {
    const doc = parse(serializeGraph(createGraph({ id: 'abc-123', name: 'Meu grafo ✓' })));

    expect(doc.id).toBe('abc-123');
    expect(doc.name).toBe('Meu grafo ✓');
  });
});

describe('ordem de inserção', () => {
  it('vértices e arestas saem na ordem do grafo, sem ordenar', () => {
    let graph = createGraph({ id: 'g' });
    for (const label of ['Zeta', 'Alfa', 'Mu']) graph = must(addVertex(graph, label)).graph;
    graph = connect(graph, 'v3', 'v1'); // e1
    graph = connect(graph, 'v2', 'v1'); // e2
    graph = connect(graph, 'v3', 'v2', 4); // e3
    const doc = parse(serializeGraph(graph));

    expect(doc.vertices.map((v) => v.label)).toStrictEqual(['Zeta', 'Alfa', 'Mu']); // não alfabética
    expect(doc.edges.map((e) => e.id)).toStrictEqual(['e1', 'e2', 'e3']);
  });

  it('ids numericamente fora de ordem lexicográfica seguem a inserção (v10 depois de v9)', () => {
    const doc = parse(serializeGraph(withVertices(12)));

    expect(doc.vertices.map((v) => v.id)).toStrictEqual(Array.from({ length: 12 }, (_, i) => `v${i + 1}`));
    expect(doc.vertices[9]!.id).toBe('v10');
    expect(doc.vertices[8]!.id).toBe('v9');
  });

  it('a ordem do array do grafo manda, mesmo que não seja crescente', () => {
    const base = withVertices(3);
    const invertido: Graph = { ...base, vertices: [...base.vertices].reverse() };

    expect(parse(serializeGraph(invertido)).vertices.map((v) => v.id)).toStrictEqual(['v3', 'v2', 'v1']);
  });
});

describe('formato canônico: independe do objeto recebido', () => {
  it('a ordem das propriedades do objeto de entrada não altera o texto', () => {
    const embaralhado = {
      nextEdgeSeq: U.nextEdgeSeq,
      edges: U.edges.map((e) => ({ weight: e.weight, target: e.target, source: e.source, id: e.id })),
      directed: U.directed,
      vertices: U.vertices.map((v) => ({ label: v.label, id: v.id })),
      name: U.name,
      nextVertexSeq: U.nextVertexSeq,
      id: U.id,
      schemaVersion: U.schemaVersion,
    } as unknown as Graph;

    expect(serializeGraph(embaralhado)).toBe(serializeGraph(U));
  });

  it('`weight: undefined` explícito equivale a aresta sem peso (a chave não é gravada)', () => {
    const comChaveUndefined = {
      ...graphOf(2, [['v1', 'v2']]),
      edges: [{ id: 'e1', source: 'v1', target: 'v2', weight: undefined }],
    } as unknown as Graph;

    expect(serializeGraph(comChaveUndefined)).toBe(serializeGraph(graphOf(2, [['v1', 'v2']])));
    expect(serializeGraph(comChaveUndefined)).not.toContain('weight');
  });

  it('nada de interface entra no documento: propriedades extras são ignoradas', () => {
    const comExtras = {
      ...U,
      layout: { v1: { x: 10, y: 20 } },
      selection: ['v1'],
      camera: { zoom: 2 },
      vertices: U.vertices.map((v) => ({ ...v, x: 1, y: 2, selected: true })),
      edges: U.edges.map((e) => ({ ...e, color: 'red', animated: true })),
    } as unknown as Graph;
    const text = serializeGraph(comExtras);

    expect(text).toBe(serializeGraph(U));
    for (const proibido of ['layout', 'selection', 'camera', '"x"', '"y"', 'selected', 'color', 'animated']) {
      expect(text).not.toContain(proibido);
    }
  });
});

describe('sem normalização silenciosa (a função exige um Graph válido)', () => {
  it('versão de esquema, contadores e ids repetidos saem como estão: quem valida é o parseGraph (4.2)', () => {
    const adulterado = {
      ...withVertices(2),
      schemaVersion: 99,
      nextVertexSeq: 1, // menor que os ids existentes
      vertices: [
        { id: 'v1', label: 'A' },
        { id: 'v1', label: 'B' }, // id repetido
      ],
    } as Graph;
    const doc = parse(serializeGraph(adulterado));

    expect(doc.schemaVersion).toBe(99);
    expect(doc.nextVertexSeq).toBe(1);
    expect(doc.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v1']);
  });

  it('peso NaN vira `null`: o JSON não o representa e o documento resultante é inválido para o parser', () => {
    const adulterado = {
      ...graphOf(2, [['v1', 'v2']]),
      edges: [{ id: 'e1', source: 'v1', target: 'v2', weight: Number.NaN }],
    } as Graph;

    expect(serializeGraph(adulterado)).toContain('"weight":null');
  });
});

describe('formatação compacta e legível (pretty)', () => {
  const grafos: [string, Graph][] = [
    ['vazio', createGraph({ id: 'g1' })],
    ['U', U],
    ['D', D],
    ['W', W],
    ['WD', WD],
    ['com Unicode', undirectedAfterRemovals()],
  ];

  it('o compacto não tem espaço em branco fora das strings', () => {
    for (const [, graph] of grafos) {
      const text = serializeGraph(graph);

      expect(JSON.stringify(JSON.parse(text))).toBe(text);
      expect(text).not.toContain('\n');
    }
  });

  it.each(grafos)('pretty muda só a formatação, nunca os dados (%s)', (_nome, graph) => {
    const compacto = serializeGraph(graph);
    const legivel = serializeGraph(graph, { pretty: true });

    expect(JSON.parse(legivel)).toStrictEqual(JSON.parse(compacto));
    expect(JSON.stringify(JSON.parse(legivel))).toBe(compacto);
    expect(Object.keys(JSON.parse(legivel))).toStrictEqual(DOC_KEYS);
  });

  it('pretty usa recuo de 2 espaços e uma propriedade por linha', () => {
    expect(serializeGraph(createGraph({ id: 'g1' }), { pretty: true })).toBe(
      [
        '{',
        '  "schemaVersion": 1,',
        '  "id": "g1",',
        '  "name": "",',
        '  "directed": false,',
        '  "vertices": [],',
        '  "edges": [],',
        '  "nextVertexSeq": 1,',
        '  "nextEdgeSeq": 1',
        '}',
      ].join('\n'),
    );
  });

  it('sem opções, `{}`, `pretty: false` e `pretty: undefined` dão o mesmo texto compacto', () => {
    const compacto = serializeGraph(U);

    expect(serializeGraph(U, {})).toBe(compacto);
    expect(serializeGraph(U, { pretty: false })).toBe(compacto);
    expect(serializeGraph(U, { pretty: undefined })).toBe(compacto);
    expect(serializeGraph(U, { pretty: true })).not.toBe(compacto);
  });

  it('o pretty é maior só pelo espaço em branco', () => {
    const compacto = serializeGraph(U);
    const legivel = serializeGraph(U, { pretty: true });

    expect(legivel.length).toBeGreaterThan(compacto.length);
    expect(legivel.replace(/[ \n]/g, '')).toBe(compacto.replace(/ /g, '')); // U não tem espaços nos rótulos
  });
});

describe('imutabilidade e determinismo', () => {
  it('não altera o grafo recebido (grafos congelados)', () => {
    const grafos = [U, D, W, WD, undirectedAfterRemovals(), deepFreeze(directedOppositeArcs())];
    const antes = grafos.map((g) => JSON.stringify(g));

    for (const graph of grafos) {
      serializeGraph(graph);
      serializeGraph(graph, { pretty: true });
    }

    expect(grafos.map((g) => JSON.stringify(g))).toStrictEqual(antes);
  });

  it('o mesmo grafo produz sempre o mesmo texto', () => {
    expect(serializeGraph(D)).toBe(serializeGraph(D));
    expect(serializeGraph(D, { pretty: true })).toBe(serializeGraph(D, { pretty: true }));
  });

  it('grafos construídos pela mesma sequência de operações dão o mesmo texto', () => {
    expect(serializeGraph(undirectedAfterRemovals())).toBe(serializeGraph(undirectedAfterRemovals()));
    expect(serializeGraph(directedOppositeArcs())).toBe(serializeGraph(directedOppositeArcs()));
  });

  it('a string devolvida não guarda referência ao grafo: editar o grafo depois não a altera', () => {
    const antes = serializeGraph(U);
    const editado = must(setVertexLabel(U, 'v1', 'Outro'));

    expect(serializeGraph(U)).toBe(antes);
    expect(serializeGraph(editado)).not.toBe(antes);
  });

  it('rótulo diferente muda o texto; só o que está no documento o altera', () => {
    expect(serializeGraph(must(setVertexLabel(U, 'v3', 'Nó central')))).not.toBe(serializeGraph(U));
  });
});

describe('grafos pseudoaleatórios reproduzíveis (com remoções, para abrir lacunas nos contadores)', () => {
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

  it.each([false, true])('o texto coincide com a segunda implementação em 200 grafos (orientado = %s)', (directed) => {
    const divergencias: number[] = [];
    for (const seed of sementes) {
      const graph = comLacunas(seed, directed);
      if (serializeGraph(graph) !== manualCompact(graph)) divergencias.push(seed);
      if (serializeGraph(graph, { pretty: true }) !== JSON.stringify(JSON.parse(manualCompact(graph)), null, 2)) divergencias.push(-seed);
    }

    expect(divergencias).toStrictEqual([]);
  });

  it.each([false, true])('invariantes do documento em 200 grafos (orientado = %s)', (directed) => {
    const falhas: string[] = [];
    for (const seed of sementes) {
      const graph = comLacunas(seed, directed);
      const compacto = serializeGraph(graph);
      const doc = parse(compacto);
      const legivel = serializeGraph(graph, { pretty: true });
      const idsNumericos = (ids: string[]) => ids.map((id) => Number(id.slice(1)));

      if (!Object.keys(doc).every((k, i) => k === DOC_KEYS[i]) || Object.keys(doc).length !== DOC_KEYS.length) falhas.push(`${seed}: chaves`);
      if (JSON.stringify(doc.vertices.map((v) => v.id)) !== JSON.stringify(graph.vertices.map((v) => v.id))) falhas.push(`${seed}: ids de vértices`);
      if (JSON.stringify(doc.edges.map((e) => e.id)) !== JSON.stringify(graph.edges.map((e) => e.id))) falhas.push(`${seed}: ids de arestas`);
      if (doc.nextVertexSeq !== graph.nextVertexSeq || doc.nextEdgeSeq !== graph.nextEdgeSeq) falhas.push(`${seed}: contadores`);
      if (!idsNumericos(doc.vertices.map((v) => v.id)).every((n) => n < doc.nextVertexSeq)) falhas.push(`${seed}: contador de vértices menor que um id`);
      if (!idsNumericos(doc.edges.map((e) => e.id)).every((n) => n < doc.nextEdgeSeq)) falhas.push(`${seed}: contador de arestas menor que um id`);
      graph.edges.forEach((edge, i) => {
        const e = doc.edges[i]!;
        if (('weight' in e) !== (edge.weight !== undefined)) falhas.push(`${seed}: estado do peso da ${edge.id}`);
        if (!Object.is(e.weight, edge.weight)) falhas.push(`${seed}: peso da ${edge.id}`);
        if (e.source !== edge.source || e.target !== edge.target) falhas.push(`${seed}: extremos da ${edge.id}`);
      });
      if (JSON.stringify(JSON.parse(legivel)) !== compacto) falhas.push(`${seed}: pretty ≠ compacto`);
      if (serializeGraph(graph) !== compacto) falhas.push(`${seed}: não determinístico`);
      if (compacto.includes('layout') || compacto.includes('"x"')) falhas.push(`${seed}: dado de interface`);
    }

    expect(falhas).toStrictEqual([]);
  });

  it('o gerador cobre os quatro estados de peso e contadores à frente dos ids', () => {
    const estados = new Set<string>();
    let comLacuna = 0;
    for (const seed of sementes) {
      const graph = comLacunas(seed, seed % 2 === 0);
      for (const edge of graph.edges) estados.add(edge.weight === undefined ? 'sem peso' : edge.weight === 0 ? 'zero' : edge.weight < 0 ? 'negativo' : 'positivo');
      if (graph.nextVertexSeq > graph.vertices.length + 1) comLacuna++;
    }

    expect([...estados].sort()).toStrictEqual(['negativo', 'positivo', 'sem peso', 'zero']);
    expect(comLacuna).toBeGreaterThan(50);
  });
});
