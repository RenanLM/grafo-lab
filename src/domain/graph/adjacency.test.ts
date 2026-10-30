import {
  adjacencyList,
  getEdge,
  outDegree,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  size,
  successors,
  type AdjacencyEntry,
  type AdjacencyRow,
  type Graph,
} from './index';
import { connect, graphOf, must, randomGraph, withVertices } from './test-helpers';

// As arestas dos grafos de referência são criadas de propósito FORA da ordem dos vértices:
// as listas devem seguir a ordem dos vértices (v1, v2, …), não a ordem de criação das arestas.

/** Triângulo v1-v2-v3, haste v3-v4 e v5 isolado. Arestas: e1 v3-v4, e2 v3-v1, e3 v3-v2, e4 v2-v1. */
const U = graphOf(5, [
  ['v3', 'v4'],
  ['v3', 'v1'],
  ['v3', 'v2'],
  ['v2', 'v1'],
]);

/**
 * Dígrafo de 6 vértices (v5 isolado). Arcos: e1 v4→v1, e2 v3→v1, e3 v1→v3, e4 v2→v3, e5 v1→v2, e6 v3→v6.
 * Há arcos opostos (v1→v3 e v3→v1), uma fonte (v4) e um sorvedouro (v6).
 */
const D = graphOf(
  6,
  [
    ['v4', 'v1'],
    ['v3', 'v1'],
    ['v1', 'v3'],
    ['v2', 'v3'],
    ['v1', 'v2'],
    ['v3', 'v6'],
  ],
  true,
);

/** Não orientado com os três estados de peso: e1 sem peso, e2 peso 0, e3 peso −2,5, e4 peso 7. */
const W = (() => {
  let graph = withVertices(4);
  graph = connect(graph, 'v1', 'v2');
  graph = connect(graph, 'v2', 'v3', 0);
  graph = connect(graph, 'v3', 'v4', -2.5);
  return connect(graph, 'v1', 'v4', 7);
})();

/** Orientado: e1 v1→v2 peso 0, e2 v2→v1 peso −1 (arco oposto), e3 v2→v3 sem peso. */
const WD = (() => {
  let graph = withVertices(3, true);
  graph = connect(graph, 'v1', 'v2', 0);
  graph = connect(graph, 'v2', 'v1', -1);
  return connect(graph, 'v2', 'v3');
})();

const rowOf = (list: readonly AdjacencyRow[], vertexId: string) =>
  list.find((row) => row.vertexId === vertexId)!;
const idsOf = (row: AdjacencyRow) => row.entries.map((entry) => entry.vertexId);
const totalEntries = (list: readonly AdjacencyRow[]) =>
  list.reduce((total, row) => total + row.entries.length, 0);

describe('grafo vazio e vértices isolados', () => {
  it('grafo vazio → lista vazia (orientado ou não)', () => {
    expect(adjacencyList(withVertices(0))).toStrictEqual([]);
    expect(adjacencyList(withVertices(0, true))).toStrictEqual([]);
  });

  it('um vértice isolado → uma linha sem entradas', () => {
    expect(adjacencyList(withVertices(1))).toStrictEqual([{ vertexId: 'v1', entries: [] }]);
    expect(adjacencyList(withVertices(1, true))).toStrictEqual([{ vertexId: 'v1', entries: [] }]);
  });

  it('vários vértices isolados → uma linha vazia para cada um, na ordem dos vértices', () => {
    expect(adjacencyList(withVertices(4))).toStrictEqual([
      { vertexId: 'v1', entries: [] },
      { vertexId: 'v2', entries: [] },
      { vertexId: 'v3', entries: [] },
      { vertexId: 'v4', entries: [] },
    ]);
  });

  it('o isolado aparece mesmo cercado de vértices conectados', () => {
    expect(rowOf(adjacencyList(U), 'v5').entries).toStrictEqual([]);
    expect(rowOf(adjacencyList(D), 'v5').entries).toStrictEqual([]);
  });
});

describe('grafo não orientado', () => {
  const list = adjacencyList(U); // desconexo: v5 fica de fora do componente do triângulo

  it('uma linha por vértice, vizinhos na ordem dos vértices (não na das arestas)', () => {
    expect(list).toStrictEqual([
      {
        vertexId: 'v1',
        entries: [
          { vertexId: 'v2', edgeId: 'e4' },
          { vertexId: 'v3', edgeId: 'e2' },
        ],
      },
      {
        vertexId: 'v2',
        entries: [
          { vertexId: 'v1', edgeId: 'e4' },
          { vertexId: 'v3', edgeId: 'e3' },
        ],
      },
      {
        vertexId: 'v3',
        entries: [
          { vertexId: 'v1', edgeId: 'e2' }, // criada antes de v3-v4 (e1) e v3-v2 (e3), mas v1 vem primeiro
          { vertexId: 'v2', edgeId: 'e3' },
          { vertexId: 'v4', edgeId: 'e1' },
        ],
      },
      { vertexId: 'v4', entries: [{ vertexId: 'v3', edgeId: 'e1' }] },
      { vertexId: 'v5', entries: [] },
    ]);
  });

  it('cada aresta aparece nas listas dos dois extremos, com o mesmo edgeId', () => {
    for (const edge of U.edges) {
      const naOrigem = rowOf(list, edge.source).entries.find((e) => e.edgeId === edge.id);
      const noDestino = rowOf(list, edge.target).entries.find((e) => e.edgeId === edge.id);

      expect(naOrigem?.vertexId).toBe(edge.target);
      expect(noDestino?.vertexId).toBe(edge.source);
    }
    expect(totalEntries(list)).toBe(2 * size(U));
  });

  it('funciona em grafo conexo (caminho) e com duas componentes', () => {
    const caminho = graphOf(4, [
      ['v3', 'v4'],
      ['v1', 'v2'],
      ['v2', 'v3'],
    ]);
    const duasComponentes = graphOf(4, [
      ['v4', 'v3'],
      ['v2', 'v1'],
    ]);

    expect(adjacencyList(caminho).map(idsOf)).toStrictEqual([['v2'], ['v1', 'v3'], ['v2', 'v4'], ['v3']]);
    expect(adjacencyList(duasComponentes).map(idsOf)).toStrictEqual([['v2'], ['v1'], ['v4'], ['v3']]);
  });

  it('a aresta é a mesma de qualquer ordem de criação dos extremos', () => {
    const a = adjacencyList(graphOf(2, [['v1', 'v2']]));
    const b = adjacencyList(graphOf(2, [['v2', 'v1']]));

    expect(a).toStrictEqual(b);
  });
});

describe('grafo orientado', () => {
  const list = adjacencyList(D);

  it('lista só os arcos de saída, na ordem dos vértices de destino', () => {
    expect(list).toStrictEqual([
      {
        vertexId: 'v1',
        entries: [
          { vertexId: 'v2', edgeId: 'e5' },
          { vertexId: 'v3', edgeId: 'e3' },
        ],
      },
      { vertexId: 'v2', entries: [{ vertexId: 'v3', edgeId: 'e4' }] },
      {
        vertexId: 'v3',
        entries: [
          { vertexId: 'v1', edgeId: 'e2' },
          { vertexId: 'v6', edgeId: 'e6' },
        ],
      },
      { vertexId: 'v4', entries: [{ vertexId: 'v1', edgeId: 'e1' }] },
      { vertexId: 'v5', entries: [] },
      { vertexId: 'v6', entries: [] },
    ]);
  });

  it('cada arco aparece uma única vez, só na linha da sua origem', () => {
    expect(totalEntries(list)).toBe(size(D));
    for (const edge of D.edges) {
      const aparicoes = list.flatMap((row) =>
        row.entries.filter((entry) => entry.edgeId === edge.id).map(() => row.vertexId),
      );
      expect(aparicoes).toStrictEqual([edge.source]);
    }
  });

  it('arcos em sentidos opostos viram entradas diferentes, em linhas diferentes', () => {
    const v1ParaV3 = rowOf(list, 'v1').entries.find((e) => e.vertexId === 'v3');
    const v3ParaV1 = rowOf(list, 'v3').entries.find((e) => e.vertexId === 'v1');

    expect(v1ParaV3?.edgeId).toBe('e3');
    expect(v3ParaV1?.edgeId).toBe('e2');
  });

  it('o arco só aparece na origem: o destino não ganha entrada de volta', () => {
    expect(idsOf(rowOf(list, 'v4'))).toStrictEqual(['v1']); // v4→v1
    expect(idsOf(rowOf(list, 'v6'))).toStrictEqual([]); // sorvedouro: v3→v6 não aparece aqui
  });

  it('só os arcos de saída entram: o grau de saída é o tamanho da linha', () => {
    for (const row of list) {
      expect(row.entries).toHaveLength(must(outDegree(D, row.vertexId)));
    }
  });
});

describe('pesos', () => {
  it('preserva peso ausente, zero e negativo (não orientado)', () => {
    expect(adjacencyList(W)).toStrictEqual([
      {
        vertexId: 'v1',
        entries: [
          { vertexId: 'v2', edgeId: 'e1' },
          { vertexId: 'v4', edgeId: 'e4', weight: 7 },
        ],
      },
      {
        vertexId: 'v2',
        entries: [
          { vertexId: 'v1', edgeId: 'e1' },
          { vertexId: 'v3', edgeId: 'e2', weight: 0 },
        ],
      },
      {
        vertexId: 'v3',
        entries: [
          { vertexId: 'v2', edgeId: 'e2', weight: 0 },
          { vertexId: 'v4', edgeId: 'e3', weight: -2.5 },
        ],
      },
      {
        vertexId: 'v4',
        entries: [
          { vertexId: 'v1', edgeId: 'e4', weight: 7 },
          { vertexId: 'v3', edgeId: 'e3', weight: -2.5 },
        ],
      },
    ]);
  });

  it('preserva os três estados em grafo orientado, com pesos diferentes nos arcos opostos', () => {
    expect(adjacencyList(WD)).toStrictEqual([
      { vertexId: 'v1', entries: [{ vertexId: 'v2', edgeId: 'e1', weight: 0 }] },
      {
        vertexId: 'v2',
        entries: [
          { vertexId: 'v1', edgeId: 'e2', weight: -1 },
          { vertexId: 'v3', edgeId: 'e3' },
        ],
      },
      { vertexId: 'v3', entries: [] },
    ]);
  });

  it('aresta sem peso não ganha o campo weight e nunca vira 1', () => {
    const todas = [U, D].flatMap((graph) => adjacencyList(graph).flatMap((row) => row.entries));

    expect(todas.length).toBeGreaterThan(0);
    for (const entry of todas) {
      expect(entry).not.toHaveProperty('weight');
      expect((entry as AdjacencyEntry).weight).toBeUndefined();
    }
  });

  it('peso zero continua sendo peso (campo presente), diferente de ausente', () => {
    const entrada = rowOf(adjacencyList(W), 'v2').entries.find((e) => e.edgeId === 'e2');
    const semPeso = rowOf(adjacencyList(W), 'v2').entries.find((e) => e.edgeId === 'e1');

    expect(entrada).toHaveProperty('weight', 0);
    expect(semPeso).not.toHaveProperty('weight');
  });

  it('o peso negativo sai exatamente como está (sem abs nem arredondamento)', () => {
    const entrada = rowOf(adjacencyList(W), 'v3').entries.find((e) => e.edgeId === 'e3');

    expect(entrada?.weight).toBe(-2.5);
  });
});

describe('ordem independe da ordem de criação das arestas', () => {
  const arestas: [string, string][] = [
    ['v1', 'v2'],
    ['v1', 'v4'],
    ['v2', 'v3'],
    ['v3', 'v4'],
    ['v1', 'v3'],
  ];
  const permutacoes = [
    arestas,
    [...arestas].reverse(),
    [arestas[3]!, arestas[0]!, arestas[4]!, arestas[2]!, arestas[1]!],
  ];

  it.each([false, true])('mesma lista de vizinhos em qualquer permutação (orientado = %s)', (directed) => {
    const [referencia, ...outras] = permutacoes.map((ordem) =>
      adjacencyList(graphOf(4, ordem, directed)).map(idsOf),
    );

    for (const outra of outras) expect(outra).toStrictEqual(referencia);
  });
});

describe('consistência com successors', () => {
  it.each([
    ['não orientado', U],
    ['orientado', D],
    ['não orientado ponderado', W],
    ['orientado ponderado', WD],
  ])('a linha de cada vértice coincide com successors (%s)', (_nome, graph) => {
    for (const row of adjacencyList(graph)) {
      expect(idsOf(row)).toStrictEqual(must(successors(graph, row.vertexId)));
    }
  });
});

describe('identificadores', () => {
  it.each([
    ['não orientado', U],
    ['orientado', D],
  ])('as linhas seguem os vértices e toda entrada aponta para ids existentes (%s)', (_nome, graph) => {
    const list = adjacencyList(graph);
    const idsDosVertices = graph.vertices.map((v) => v.id);

    expect(list.map((row) => row.vertexId)).toStrictEqual(idsDosVertices);
    for (const row of list) {
      for (const entry of row.entries) {
        expect(idsDosVertices).toContain(entry.vertexId);
        expect(getEdge(graph, entry.edgeId)).toBeDefined();
      }
    }
  });

  it('cada entrada descreve de fato a aresta indicada (extremos e peso)', () => {
    for (const graph of [U, D, W, WD]) {
      for (const row of adjacencyList(graph)) {
        for (const entry of row.entries) {
          const edge = getEdge(graph, entry.edgeId)!;
          const extremos = [edge.source, edge.target];

          expect(extremos).toContain(row.vertexId);
          expect(extremos).toContain(entry.vertexId);
          expect(entry.weight).toBe(edge.weight);
          expect('weight' in entry).toBe('weight' in edge);
        }
      }
    }
  });
});

describe('rótulo e peso editados', () => {
  it('mudar um rótulo não altera a lista (ela só usa ids)', () => {
    const renomeado = must(setVertexLabel(U, 'v3', 'Nó central'));

    expect(adjacencyList(renomeado)).toStrictEqual(adjacencyList(U));
  });

  it('definir peso aparece nas duas pontas (não orientado) e só nelas', () => {
    const list = adjacencyList(must(setEdgeWeight(W, 'e1', 5)));

    expect(rowOf(list, 'v1').entries[0]).toStrictEqual({ vertexId: 'v2', edgeId: 'e1', weight: 5 });
    expect(rowOf(list, 'v2').entries[0]).toStrictEqual({ vertexId: 'v1', edgeId: 'e1', weight: 5 });
    expect(rowOf(list, 'v3')).toStrictEqual(rowOf(adjacencyList(W), 'v3'));
    expect(rowOf(list, 'v4')).toStrictEqual(rowOf(adjacencyList(W), 'v4'));
  });

  it('definir peso em um arco orientado só altera a linha da origem', () => {
    const list = adjacencyList(must(setEdgeWeight(WD, 'e3', 9)));

    expect(rowOf(list, 'v2').entries[1]).toStrictEqual({ vertexId: 'v3', edgeId: 'e3', weight: 9 });
    expect(rowOf(list, 'v3').entries).toStrictEqual([]);
  });

  it('remover o peso tira o campo; trocar por zero deixa o campo com 0', () => {
    const semPeso = adjacencyList(must(setEdgeWeight(W, 'e2', undefined)));
    const comZero = adjacencyList(must(setEdgeWeight(W, 'e1', 0)));

    expect(rowOf(semPeso, 'v2').entries[1]).toStrictEqual({ vertexId: 'v3', edgeId: 'e2' });
    expect(rowOf(semPeso, 'v3').entries[0]).toStrictEqual({ vertexId: 'v2', edgeId: 'e2' });
    expect(rowOf(comZero, 'v1').entries[0]).toStrictEqual({ vertexId: 'v2', edgeId: 'e1', weight: 0 });
  });

  it('remover aresta ou vértice é refletido na lista', () => {
    const semHaste = adjacencyList(must(removeEdge(U, 'e1'))); // tira v3-v4
    const semV3 = adjacencyList(must(removeVertex(U, 'v3')));

    expect(idsOf(rowOf(semHaste, 'v3'))).toStrictEqual(['v1', 'v2']);
    expect(rowOf(semHaste, 'v4').entries).toStrictEqual([]);
    expect(semV3.map((row) => row.vertexId)).toStrictEqual(['v1', 'v2', 'v4', 'v5']);
    expect(semV3.map(idsOf)).toStrictEqual([['v2'], ['v1'], [], []]);
  });
});

describe('imutabilidade e determinismo', () => {
  it('não altera o grafo recebido (grafos congelados)', () => {
    const antes = [U, D, W, WD].map((graph) => JSON.stringify(graph));

    for (const graph of [U, D, W, WD]) adjacencyList(graph);

    expect([U, D, W, WD].map((graph) => JSON.stringify(graph))).toStrictEqual(antes);
  });

  it('o mesmo grafo produz sempre a mesma representação', () => {
    const a = adjacencyList(D);
    const b = adjacencyList(D);

    expect(a).toStrictEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('grafos construídos pela mesma sequência de operações geram listas iguais', () => {
    const outroD = graphOf(
      6,
      [
        ['v4', 'v1'],
        ['v3', 'v1'],
        ['v1', 'v3'],
        ['v2', 'v3'],
        ['v1', 'v2'],
        ['v3', 'v6'],
      ],
      true,
    );

    expect(adjacencyList(outroD)).toStrictEqual(adjacencyList(D));
  });

  it('devolve estruturas novas a cada chamada: alterar uma cópia não afeta a outra nem o grafo', () => {
    const a = adjacencyList(U);
    const b = adjacencyList(U);

    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    (a[0]!.entries as AdjacencyEntry[]).push({ vertexId: 'lixo', edgeId: 'lixo' });

    expect(adjacencyList(U)).toStrictEqual(b);
  });
});

describe('grafo completo (caso extremo)', () => {
  it('K8 não orientado: cada linha lista os outros 7 vértices em ordem', () => {
    const pares: [string, string][] = [];
    for (let i = 1; i <= 8; i++) for (let j = i + 1; j <= 8; j++) pares.push([`v${j}`, `v${i}`]);
    const k8 = graphOf(8, pares);

    for (const row of adjacencyList(k8)) {
      expect(idsOf(row)).toStrictEqual(
        k8.vertices.map((v) => v.id).filter((id) => id !== row.vertexId),
      );
    }
  });
});

describe('grafos pseudoaleatórios reproduzíveis', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('invariantes valem em 200 grafos (orientado = %s)', (directed) => {
    for (const seed of sementes) {
      const graph: Graph = randomGraph(seed, directed);
      const list = adjacencyList(graph);

      expect(list.map((row) => row.vertexId)).toStrictEqual(graph.vertices.map((v) => v.id));
      expect(totalEntries(list)).toBe(directed ? size(graph) : 2 * size(graph));

      for (const row of list) {
        expect(idsOf(row)).toStrictEqual(must(successors(graph, row.vertexId)));
        expect(row.entries).toHaveLength(must(outDegree(graph, row.vertexId)));
        for (const entry of row.entries) {
          const edge = getEdge(graph, entry.edgeId)!;
          expect(entry.weight).toBe(edge.weight);
          expect('weight' in entry).toBe('weight' in edge);
        }
      }
    }
  });

  it('no não orientado a lista é simétrica: u→w com a aresta e implica w→u com a mesma aresta', () => {
    for (const seed of sementes) {
      const list = adjacencyList(randomGraph(seed, false));

      for (const row of list) {
        for (const entry of row.entries) {
          const volta = rowOf(list, entry.vertexId).entries.find((e) => e.edgeId === entry.edgeId);
          expect(volta).toStrictEqual({ ...entry, vertexId: row.vertexId });
        }
      }
    }
  });

  it('o gerador é reproduzível: a mesma semente gera o mesmo grafo e a mesma lista', () => {
    expect(randomGraph(42, true)).toStrictEqual(randomGraph(42, true));
    expect(adjacencyList(randomGraph(42, false))).toStrictEqual(adjacencyList(randomGraph(42, false)));
  });
});
