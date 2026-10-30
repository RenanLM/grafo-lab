import {
  adjacencyAsNumbers,
  adjacencyList,
  adjacencyMatrix,
  getEdge,
  inDegree,
  outDegree,
  degree,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  size,
  type AdjacencyCell,
  type AdjacencyMatrix,
  type Edge,
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

// Atalhos para escrever as matrizes esperadas: `x` = sem aresta (null), `c('e1')` = aresta sem peso,
// `c('e2', 0)` = aresta de peso zero.
const x = null;
const c = (edgeId: string, weight?: number): AdjacencyCell =>
  weight === undefined ? { edgeId } : { edgeId, weight };

/** A célula esperada para uma aresta do grafo (peso copiado sem conversão). */
const cellOf = (edge: Edge): AdjacencyCell =>
  edge.weight === undefined ? { edgeId: edge.id } : { edgeId: edge.id, weight: edge.weight };

const nonNullCount = (cells: readonly (AdjacencyCell | null)[]) =>
  cells.filter((cell) => cell !== null).length;
const totalNonNull = (matrix: AdjacencyMatrix) =>
  matrix.cells.reduce((total, row) => total + nonNullCount(row), 0);
const column = (matrix: AdjacencyMatrix, j: number) => matrix.cells.map((row) => row[j] ?? null);
const isPatternSymmetric = (matrix: AdjacencyMatrix) =>
  matrix.cells.every((row, i) => row.every((cell, j) => (cell === null) === (matrix.cells[j]![i] === null)));

describe('grafo vazio e vértices isolados', () => {
  it('grafo vazio → matriz 0×0 (orientado ou não)', () => {
    expect(adjacencyMatrix(withVertices(0))).toStrictEqual({ vertexIds: [], cells: [] });
    expect(adjacencyMatrix(withVertices(0, true))).toStrictEqual({ vertexIds: [], cells: [] });
  });

  it('um vértice → matriz 1×1 com a diagonal vazia', () => {
    expect(adjacencyMatrix(withVertices(1))).toStrictEqual({ vertexIds: ['v1'], cells: [[x]] });
    expect(adjacencyMatrix(withVertices(1, true))).toStrictEqual({ vertexIds: ['v1'], cells: [[x]] });
  });

  it('vários vértices isolados → grade inteira de null', () => {
    expect(adjacencyMatrix(withVertices(3))).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3'],
      cells: [
        [x, x, x],
        [x, x, x],
        [x, x, x],
      ],
    });
  });

  it('o vértice isolado tem linha e coluna inteiras de null mesmo cercado de conectados', () => {
    for (const graph of [U, D]) {
      const matrix = adjacencyMatrix(graph);
      const k = matrix.vertexIds.indexOf('v5');

      expect(matrix.cells[k]!.every((cell) => cell === null)).toBe(true);
      expect(column(matrix, k).every((cell) => cell === null)).toBe(true);
    }
  });
});

describe('grafo não orientado', () => {
  const matrix = adjacencyMatrix(U);

  it('descreve cada aresta nas duas posições simétricas, na ordem dos vértices', () => {
    expect(matrix).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5'],
      cells: [
        [x, c('e4'), c('e2'), x, x],
        [c('e4'), x, c('e3'), x, x],
        [c('e2'), c('e3'), x, c('e1'), x],
        [x, x, c('e1'), x, x],
        [x, x, x, x, x],
      ],
    });
  });

  it('é quadrada, simétrica (mesmo edgeId e peso) e com a diagonal vazia', () => {
    const { vertexIds, cells } = matrix;

    expect(cells).toHaveLength(vertexIds.length);
    for (let i = 0; i < cells.length; i++) {
      expect(cells[i]).toHaveLength(vertexIds.length);
      expect(cells[i]![i]).toBeNull();
      for (let j = 0; j < cells.length; j++) expect(cells[i]![j]).toStrictEqual(cells[j]![i]);
    }
  });

  it('tem 2·|E| células ocupadas', () => {
    expect(totalNonNull(matrix)).toBe(2 * size(U));
  });

  it('a aresta criada como (b, a) ou (a, b) dá a mesma matriz', () => {
    expect(adjacencyMatrix(graphOf(2, [['v2', 'v1']]))).toStrictEqual(
      adjacencyMatrix(graphOf(2, [['v1', 'v2']])),
    );
  });
});

describe('grafo orientado', () => {
  const matrix = adjacencyMatrix(D);

  it('cells[i][j] descreve o arco i→j, na ordem dos vértices', () => {
    expect(matrix).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
      cells: [
        [x, c('e5'), c('e3'), x, x, x],
        [x, x, c('e4'), x, x, x],
        [c('e2'), x, x, x, x, c('e6')],
        [c('e1'), x, x, x, x, x],
        [x, x, x, x, x, x],
        [x, x, x, x, x, x],
      ],
    });
  });

  it('cada arco ocupa exatamente uma célula: linha da origem, coluna do destino', () => {
    expect(totalNonNull(matrix)).toBe(size(D));
    for (const edge of D.edges) {
      const i = matrix.vertexIds.indexOf(edge.source);
      const j = matrix.vertexIds.indexOf(edge.target);

      expect(matrix.cells[i]![j]).toStrictEqual(cellOf(edge));
    }
  });

  it('arcos opostos (v1→v3 e v3→v1) ocupam células diferentes, com edgeId próprio', () => {
    expect(matrix.cells[0]![2]).toStrictEqual(c('e3'));
    expect(matrix.cells[2]![0]).toStrictEqual(c('e2'));
  });

  it('um arco sem o oposto deixa a posição transposta vazia (fonte v4 e sorvedouro v6)', () => {
    expect(matrix.cells[3]![0]).toStrictEqual(c('e1')); // v4→v1
    expect(matrix.cells[0]![3]).toBeNull(); // não há v1→v4
    expect(matrix.cells[2]![5]).toStrictEqual(c('e6')); // v3→v6
    expect(matrix.cells[5]![2]).toBeNull(); // não há v6→v3
  });

  it('a diagonal fica vazia', () => {
    matrix.cells.forEach((row, i) => expect(row[i]).toBeNull());
  });
});

describe('orientado: matriz simétrica ou assimétrica, conforme os arcos', () => {
  /** Todo arco tem o oposto, com o mesmo peso: e1 v1→v2 e e2 v2→v1 (peso 2); e3 v2→v3 e e4 v3→v2 (peso 5). */
  const simetrico = (() => {
    let graph = withVertices(3, true);
    graph = connect(graph, 'v1', 'v2', 2);
    graph = connect(graph, 'v2', 'v1', 2);
    graph = connect(graph, 'v2', 'v3', 5);
    return connect(graph, 'v3', 'v2', 5);
  })();

  it('pode ser simétrica em presença e em peso, mas cada sentido guarda o próprio edgeId', () => {
    const matrix = adjacencyMatrix(simetrico);

    expect(matrix.cells).toStrictEqual([
      [x, c('e1', 2), x],
      [c('e2', 2), x, c('e3', 5)],
      [x, c('e4', 5), x],
    ]);
    expect(isPatternSymmetric(matrix)).toBe(true);
    expect(matrix.cells[0]![1]!.weight).toBe(matrix.cells[1]![0]!.weight);
    expect(matrix.cells[0]![1]!.edgeId).not.toBe(matrix.cells[1]![0]!.edgeId);
  });

  it('é assimétrica quando falta o arco oposto', () => {
    expect(isPatternSymmetric(adjacencyMatrix(D))).toBe(false);
    expect(isPatternSymmetric(adjacencyMatrix(graphOf(2, [['v1', 'v2']], true)))).toBe(false);
  });

  it('pode ter presença simétrica e pesos assimétricos (arcos opostos com pesos diferentes)', () => {
    const matrix = adjacencyMatrix(WD);

    expect(isPatternSymmetric(matrix)).toBe(false); // v2→v3 não tem volta
    expect(matrix.cells[0]![1]).toStrictEqual(c('e1', 0));
    expect(matrix.cells[1]![0]).toStrictEqual(c('e2', -1));
    expect(matrix.cells[0]![1]!.weight).not.toBe(matrix.cells[1]![0]!.weight);
  });

  it('o grafo não orientado equivalente tem o mesmo padrão de presença que o orientado simétrico', () => {
    const naoOrientado = adjacencyMatrix(
      graphOf(3, [
        ['v1', 'v2'],
        ['v2', 'v3'],
      ]),
    );
    const orientado = adjacencyMatrix(simetrico);

    expect(naoOrientado.cells.map((row) => row.map((cell) => cell !== null))).toStrictEqual(
      orientado.cells.map((row) => row.map((cell) => cell !== null)),
    );
  });
});

describe('pesos: sem peso, zero e negativo', () => {
  it('preserva os três estados em grafo não orientado', () => {
    expect(adjacencyMatrix(W)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4'],
      cells: [
        [x, c('e1'), x, c('e4', 7)],
        [c('e1'), x, c('e2', 0), x],
        [x, c('e2', 0), x, c('e3', -2.5)],
        [c('e4', 7), x, c('e3', -2.5), x],
      ],
    });
  });

  it('preserva os três estados em grafo orientado, com pesos diferentes nos arcos opostos', () => {
    expect(adjacencyMatrix(WD)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3'],
      cells: [
        [x, c('e1', 0), x],
        [c('e2', -1), x, c('e3')],
        [x, x, x],
      ],
    });
  });

  it('ausência, aresta sem peso e peso zero são três estados diferentes', () => {
    const { cells } = adjacencyMatrix(W);
    const ausente = cells[0]![2]; // v1-v3 não existe
    const semPeso = cells[0]![1]; // e1
    const pesoZero = cells[1]![2]; // e2

    expect(ausente).toBeNull();
    expect(semPeso).not.toBeNull();
    expect(semPeso).not.toHaveProperty('weight');
    expect(pesoZero).toHaveProperty('weight', 0);
    expect(pesoZero).not.toStrictEqual(semPeso);
  });

  it('aresta sem peso nunca vira 1 e o peso negativo sai como está', () => {
    for (const graph of [U, D]) {
      for (const cell of adjacencyMatrix(graph).cells.flat()) {
        if (cell !== null) {
          expect(cell).not.toHaveProperty('weight');
          expect(cell.weight).toBeUndefined();
        }
      }
    }
    expect(adjacencyMatrix(W).cells[2]![3]!.weight).toBe(-2.5);
  });
});

describe('ordem de inserção', () => {
  it('linhas e colunas seguem os vértices, não a ordem de criação das arestas', () => {
    const arestas: [string, string][] = [
      ['v1', 'v2'],
      ['v1', 'v4'],
      ['v2', 'v3'],
      ['v3', 'v4'],
      ['v1', 'v3'],
    ];
    const permutacoes = [arestas, [...arestas].reverse(), [arestas[3]!, arestas[0]!, arestas[4]!, arestas[2]!, arestas[1]!]];
    const presenca = (graph: Graph) =>
      adjacencyMatrix(graph).cells.map((row) => row.map((cell) => cell !== null));

    for (const directed of [false, true]) {
      const [referencia, ...outras] = permutacoes.map((ordem) => presenca(graphOf(4, ordem, directed)));
      for (const outra of outras) expect(outra).toStrictEqual(referencia);
    }
  });

  it('depois de remover um vértice, os índices acompanham os vértices que restam', () => {
    const semV3 = adjacencyMatrix(must(removeVertex(U, 'v3')));

    expect(semV3.vertexIds).toStrictEqual(['v1', 'v2', 'v4', 'v5']);
    expect(semV3.cells).toStrictEqual([
      [x, c('e4'), x, x],
      [c('e4'), x, x, x],
      [x, x, x, x],
      [x, x, x, x],
    ]);
  });
});

describe('consistência com adjacencyList', () => {
  const grafos: [string, Graph][] = [
    ['não orientado', U],
    ['orientado', D],
    ['não orientado ponderado', W],
    ['orientado ponderado', WD],
  ];

  it.each(grafos)('cada célula ocupada é uma entrada da lista, e vice-versa (%s)', (_nome, graph) => {
    const matrix = adjacencyMatrix(graph);
    const list = adjacencyList(graph);

    matrix.cells.forEach((row, i) => {
      const entries = list[i]!.entries;
      expect(list[i]!.vertexId).toBe(matrix.vertexIds[i]);
      expect(nonNullCount(row)).toBe(entries.length);
      row.forEach((cell, j) => {
        const entry = entries.find((e) => e.vertexId === matrix.vertexIds[j]);
        if (cell === null) {
          expect(entry).toBeUndefined();
        } else {
          expect(entry).toBeDefined();
          expect(entry!.edgeId).toBe(cell.edgeId);
          expect(entry!.weight).toBe(cell.weight);
          expect('weight' in entry!).toBe('weight' in cell);
        }
      });
    });
  });
});

describe('consistência com os graus', () => {
  it.each([
    ['não orientado', U],
    ['orientado', D],
    ['orientado ponderado', WD],
  ])('células ocupadas por linha = grau de saída; por coluna = grau de entrada (%s)', (_nome, graph) => {
    const matrix = adjacencyMatrix(graph);

    matrix.vertexIds.forEach((id, i) => {
      expect(nonNullCount(matrix.cells[i]!)).toBe(must(outDegree(graph, id)));
      expect(nonNullCount(column(matrix, i))).toBe(must(inDegree(graph, id)));
      if (!graph.directed) expect(nonNullCount(matrix.cells[i]!)).toBe(must(degree(graph, id)));
    });
  });

  it('total de células ocupadas: |E| no orientado e 2·|E| no não orientado', () => {
    expect(totalNonNull(adjacencyMatrix(D))).toBe(size(D));
    expect(totalNonNull(adjacencyMatrix(U))).toBe(2 * size(U));
  });
});

describe('rótulo e peso editados', () => {
  it('mudar um rótulo não altera a matriz (ela só usa ids)', () => {
    expect(adjacencyMatrix(must(setVertexLabel(U, 'v3', 'Nó central')))).toStrictEqual(adjacencyMatrix(U));
  });

  it('definir peso aparece nas duas posições simétricas (não orientado), só nelas', () => {
    const { cells } = adjacencyMatrix(must(setEdgeWeight(W, 'e1', 5)));

    expect(cells[0]![1]).toStrictEqual(c('e1', 5));
    expect(cells[1]![0]).toStrictEqual(c('e1', 5));
    expect(cells[1]![2]).toStrictEqual(c('e2', 0)); // as outras não mudam
  });

  it('em grafo orientado, definir peso altera só o sentido do arco', () => {
    const { cells } = adjacencyMatrix(must(setEdgeWeight(WD, 'e1', 9)));

    expect(cells[0]![1]).toStrictEqual(c('e1', 9));
    expect(cells[1]![0]).toStrictEqual(c('e2', -1)); // o arco oposto não muda
  });

  it('remover o peso tira o campo; trocar por zero deixa o campo com 0', () => {
    const semPeso = adjacencyMatrix(must(setEdgeWeight(W, 'e2', undefined)));
    const comZero = adjacencyMatrix(must(setEdgeWeight(W, 'e1', 0)));

    expect(semPeso.cells[1]![2]).toStrictEqual(c('e2'));
    expect(semPeso.cells[2]![1]).toStrictEqual(c('e2'));
    expect(comZero.cells[0]![1]).toStrictEqual(c('e1', 0));
  });

  it('remover uma aresta esvazia as células dela', () => {
    const { cells } = adjacencyMatrix(must(removeEdge(U, 'e1'))); // tira v3-v4

    expect(cells[2]![3]).toBeNull();
    expect(cells[3]![2]).toBeNull();
  });
});

describe('imutabilidade, aliasing e determinismo', () => {
  it('não altera o grafo recebido (grafos congelados)', () => {
    const antes = [U, D, W, WD].map((graph) => JSON.stringify(graph));

    for (const graph of [U, D, W, WD]) adjacencyMatrix(graph);

    expect([U, D, W, WD].map((graph) => JSON.stringify(graph))).toStrictEqual(antes);
  });

  it('o mesmo grafo produz sempre a mesma matriz', () => {
    const a = adjacencyMatrix(D);
    const b = adjacencyMatrix(D);

    expect(a).toStrictEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('devolve estruturas novas a cada chamada: alterar uma cópia não afeta a outra', () => {
    const a = adjacencyMatrix(U);
    const b = adjacencyMatrix(U);

    expect(a).not.toBe(b);
    expect(a.cells).not.toBe(b.cells);
    expect(a.cells[0]).not.toBe(b.cells[0]);
    (a.cells[0] as (AdjacencyCell | null)[])[1] = { edgeId: 'lixo', weight: 99 };

    expect(adjacencyMatrix(U)).toStrictEqual(b);
  });

  it('as células simétricas são objetos independentes: alterar uma não afeta a outra (sem aliasing)', () => {
    const { cells } = adjacencyMatrix(W);

    expect(cells[0]![1]).not.toBe(cells[1]![0]);
    (cells[0]![1] as { weight?: number }).weight = 123;

    expect(cells[1]![0]).toStrictEqual(c('e1')); // a simétrica continua sem peso
    expect(adjacencyMatrix(W).cells[0]![1]).toStrictEqual(c('e1'));
  });

  it('as linhas são arrays independentes e nenhuma célula é objeto do grafo', () => {
    const { cells } = adjacencyMatrix(W);

    expect(new Set(cells).size).toBe(cells.length); // nenhuma linha repetida
    for (const cell of cells.flat()) {
      if (cell !== null) expect(W.edges).not.toContain(cell);
    }
  });
});

describe('grafo completo (caso extremo)', () => {
  it('K8: todas as posições fora da diagonal ocupadas', () => {
    const pares: [string, string][] = [];
    for (let i = 1; i <= 8; i++) for (let j = i + 1; j <= 8; j++) pares.push([`v${j}`, `v${i}`]);
    const { cells } = adjacencyMatrix(graphOf(8, pares));

    cells.forEach((row, i) => row.forEach((cell, j) => expect(cell === null).toBe(i === j)));
  });
});

describe('grafos pseudoaleatórios reproduzíveis', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('invariantes valem em 200 grafos (orientado = %s)', (directed) => {
    for (const seed of sementes) {
      const graph = randomGraph(seed, directed);
      const matrix = adjacencyMatrix(graph);
      const n = graph.vertices.length;

      expect(matrix.vertexIds).toStrictEqual(graph.vertices.map((v) => v.id));
      expect(matrix.cells).toHaveLength(n);
      expect(totalNonNull(matrix)).toBe(directed ? size(graph) : 2 * size(graph));

      matrix.cells.forEach((row, i) => {
        expect(row).toHaveLength(n);
        expect(row[i]).toBeNull();
        expect(nonNullCount(row)).toBe(must(outDegree(graph, matrix.vertexIds[i]!)));
        expect(nonNullCount(column(matrix, i))).toBe(must(inDegree(graph, matrix.vertexIds[i]!)));
      });

      for (const edge of graph.edges) {
        const i = matrix.vertexIds.indexOf(edge.source);
        const j = matrix.vertexIds.indexOf(edge.target);
        expect(matrix.cells[i]![j]).toStrictEqual(cellOf(edge));
        if (!directed) expect(matrix.cells[j]![i]).toStrictEqual(cellOf(edge));
      }
      // Toda célula ocupada é uma aresta do grafo (nada inventado).
      for (const cell of matrix.cells.flat()) {
        if (cell !== null) expect(getEdge(graph, cell.edgeId)).toBeDefined();
      }
    }
  });

  it('é simétrica no não orientado e consistente com a lista de adjacência', () => {
    for (const seed of sementes) {
      for (const directed of [false, true]) {
        const graph = randomGraph(seed, directed);
        const matrix = adjacencyMatrix(graph);
        const list = adjacencyList(graph);

        if (!directed) expect(isPatternSymmetric(matrix)).toBe(true);
        matrix.cells.forEach((row, i) => {
          const daLista = list[i]!.entries.map((e) => [e.vertexId, e.edgeId, e.weight]);
          const daMatriz = row.flatMap((cell, j) =>
            cell === null ? [] : [[matrix.vertexIds[j], cell.edgeId, cell.weight]],
          );
          expect(daMatriz).toStrictEqual(daLista);
        });
      }
    }
  });

  it('o resultado é determinístico para a mesma semente', () => {
    expect(adjacencyMatrix(randomGraph(42, true))).toStrictEqual(adjacencyMatrix(randomGraph(42, true)));
  });
});

// ---------------------------------------------------------------------------------------------
// Projeção numérica: `adjacencyAsNumbers` lê a matriz estrutural como números (não é reversível).
// ---------------------------------------------------------------------------------------------

const Inf = Number.POSITIVE_INFINITY;
const ZERO_UM = { absent: 0, unweighted: 1 } as const;

describe('adjacencyAsNumbers: políticas diferentes sobre a mesma matriz', () => {
  it('{ absent: 0, unweighted: 1 } em grafo sem pesos dá uma grade só de 0 e 1 (não orientado)', () => {
    const numeros = adjacencyAsNumbers(adjacencyMatrix(U), ZERO_UM);

    expect(numeros).toStrictEqual([
      [0, 1, 1, 0, 0],
      [1, 0, 1, 0, 0],
      [1, 1, 0, 1, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
  });

  it('{ absent: 0, unweighted: 1 } em grafo orientado sem pesos mantém o sentido dos arcos', () => {
    const numeros = adjacencyAsNumbers(adjacencyMatrix(D), ZERO_UM);

    expect(numeros).toStrictEqual([
      [0, 1, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [1, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
    expect(numeros.flat().every((valor) => valor === 0 || valor === 1)).toBe(true);
  });

  it('com pesos o resultado NÃO é binário: pesos arbitrários são preservados', () => {
    const numeros = adjacencyAsNumbers(adjacencyMatrix(W), ZERO_UM);

    expect(numeros).toStrictEqual([
      [0, 1, 0, 7],
      [1, 0, 0, 0],
      [0, 0, 0, -2.5],
      [7, 0, -2.5, 0],
    ]);
    expect(numeros.flat().every((valor) => valor === 0 || valor === 1)).toBe(false);
  });

  it('{ absent: Infinity, unweighted: 1 }: ausência vira Infinity e a diagonal NÃO vira 0', () => {
    expect(adjacencyAsNumbers(adjacencyMatrix(W), { absent: Inf, unweighted: 1 })).toStrictEqual([
      [Inf, 1, Inf, 7],
      [1, Inf, 0, Inf],
      [Inf, 0, Inf, -2.5],
      [7, Inf, -2.5, Inf],
    ]);
    expect(adjacencyAsNumbers(adjacencyMatrix(WD), { absent: Inf, unweighted: 1 })).toStrictEqual([
      [Inf, 0, Inf],
      [-1, Inf, 1],
      [Inf, Inf, Inf],
    ]);
  });

  it('a diagonal vale `absent`, seja qual for (a função não assume distância zero)', () => {
    const matrix = adjacencyMatrix(W);

    for (const absent of [Inf, -7, 0, 42]) {
      adjacencyAsNumbers(matrix, { absent, unweighted: 1 }).forEach((row, i) =>
        expect(row[i]).toBe(absent),
      );
    }
  });

  it('políticas diferentes dão resultados diferentes sobre a mesma matriz', () => {
    const matrix = adjacencyMatrix(WD);

    expect(adjacencyAsNumbers(matrix, { absent: -7, unweighted: 100 })).toStrictEqual([
      [-7, 0, -7],
      [-1, -7, 100],
      [-7, -7, -7],
    ]);
    expect(adjacencyAsNumbers(matrix, ZERO_UM)).not.toStrictEqual(
      adjacencyAsNumbers(matrix, { absent: -7, unweighted: 100 }),
    );
  });

  it('as opções só afetam ausência e arestas sem peso; pesos (zero, negativo) nunca são trocados', () => {
    for (const options of [ZERO_UM, { absent: 99, unweighted: 99 }, { absent: -5, unweighted: Inf }]) {
      const numeros = adjacencyAsNumbers(adjacencyMatrix(W), options);

      expect(numeros[1]![2]).toBe(0); // peso zero continua 0
      expect(numeros[2]![3]).toBe(-2.5); // peso negativo continua igual
      expect(numeros[0]![3]).toBe(7);
    }
  });

  it('grafo vazio → [] e um vértice → [[absent]]', () => {
    expect(adjacencyAsNumbers(adjacencyMatrix(withVertices(0)), ZERO_UM)).toStrictEqual([]);
    expect(adjacencyAsNumbers(adjacencyMatrix(withVertices(1)), { absent: Inf, unweighted: 1 })).toStrictEqual([
      [Inf],
    ]);
  });
});

describe('adjacencyAsNumbers: a projeção pode perder informação', () => {
  it('peso zero e ausência viram o mesmo número quando absent = 0, mas a matriz estrutural os separa', () => {
    const matrix = adjacencyMatrix(W);
    const numeros = adjacencyAsNumbers(matrix, ZERO_UM);

    expect(numeros[1]![2]).toBe(numeros[0]![2]); // e2 (peso 0) × v1-v3 (sem aresta): ambos 0
    expect(matrix.cells[1]![2]).not.toBeNull();
    expect(matrix.cells[0]![2]).toBeNull();
  });

  it('peso 1 e aresta sem peso viram o mesmo número quando unweighted = 1, mas a estrutural os separa', () => {
    const graph = connect(connect(withVertices(3), 'v1', 'v2', 1), 'v2', 'v3');
    const matrix = adjacencyMatrix(graph);
    const numeros = adjacencyAsNumbers(matrix, ZERO_UM);

    expect(numeros[0]![1]).toBe(numeros[1]![2]);
    expect(matrix.cells[0]![1]).toStrictEqual(c('e1', 1));
    expect(matrix.cells[1]![2]).toStrictEqual(c('e2'));
  });

  it('não é reversível: matrizes estruturais diferentes projetam para a mesma grade', () => {
    const comPeso = adjacencyMatrix(must(setEdgeWeight(W, 'e1', 1)));
    const semPeso = adjacencyMatrix(W);

    expect(comPeso).not.toStrictEqual(semPeso);
    expect(adjacencyAsNumbers(comPeso, ZERO_UM)).toStrictEqual(adjacencyAsNumbers(semPeso, ZERO_UM));
  });

  it('descarta o edgeId: grafos com ids diferentes e mesma estrutura numérica coincidem', () => {
    const a = graphOf(2, [['v1', 'v2']]);

    const comIdE1 = adjacencyMatrix(a);
    const comIdE2 = adjacencyMatrix(connect(must(removeEdge(a, 'e1')), 'v1', 'v2')); // a aresta agora é e2

    expect(comIdE1.cells[0]![1]!.edgeId).toBe('e1');
    expect(comIdE2.cells[0]![1]!.edgeId).toBe('e2');
    expect(adjacencyAsNumbers(comIdE1, ZERO_UM)).toStrictEqual(adjacencyAsNumbers(comIdE2, ZERO_UM));
  });
});

describe('adjacencyAsNumbers: imutabilidade e determinismo', () => {
  it('não altera a matriz recebida (matriz congelada) e ela continua com os três estados', () => {
    const matrix = deepFreeze(adjacencyMatrix(W));
    const antes = JSON.stringify(matrix);

    adjacencyAsNumbers(matrix, ZERO_UM);
    adjacencyAsNumbers(matrix, { absent: Inf, unweighted: 7 });

    expect(JSON.stringify(matrix)).toBe(antes);
    expect(matrix.cells[0]![2]).toBeNull();
    expect(matrix.cells[0]![1]).toStrictEqual(c('e1'));
    expect(matrix.cells[1]![2]).toStrictEqual(c('e2', 0));
  });

  it('é determinística e devolve grades novas a cada chamada', () => {
    const matrix = adjacencyMatrix(D);
    const a = adjacencyAsNumbers(matrix, ZERO_UM);
    const b = adjacencyAsNumbers(matrix, ZERO_UM);

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    a[0]![0] = 123;
    expect(adjacencyAsNumbers(matrix, ZERO_UM)).toStrictEqual(b);
    expect(matrix).toStrictEqual(adjacencyMatrix(D));
  });
});

describe('adjacencyAsNumbers: consistência e sementes fixas', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('cada número vem da célula certa em 200 grafos (orientado = %s)', (directed) => {
    // -9 e 5 não aparecem entre os pesos que o gerador usa (0, -3, 2,5, 7), então os três estados ficam legíveis.
    const options = { absent: -9, unweighted: 5 };

    for (const seed of sementes) {
      const graph = randomGraph(seed, directed);
      const matrix = adjacencyMatrix(graph);
      const numeros = adjacencyAsNumbers(matrix, options);

      expect(numeros).toHaveLength(matrix.cells.length);
      matrix.cells.forEach((row, i) => {
        expect(numeros[i]).toHaveLength(row.length);
        row.forEach((cell, j) => {
          const esperado = cell === null ? -9 : (cell.weight ?? 5);
          expect(numeros[i]![j]).toBe(esperado);
        });
      });
    }
  });

  it('concorda com a lista de adjacência: ocupados ↔ entradas, com o peso ou `unweighted`', () => {
    for (const seed of sementes) {
      const graph = randomGraph(seed, seed % 2 === 0);
      const numeros = adjacencyAsNumbers(adjacencyMatrix(graph), { absent: -9, unweighted: 5 });

      adjacencyList(graph).forEach((row, i) => {
        const porColuna = new Map(row.entries.map((e) => [e.vertexId, e.weight ?? 5]));
        graph.vertices.forEach((vertex, j) => {
          expect(numeros[i]![j]).toBe(porColuna.get(vertex.id) ?? -9);
        });
      });
    }
  });
});

describe('adjacencyAsNumbers: as opções são obrigatórias (teste de tipo)', () => {
  it('as chamadas sem as duas opções não compilam (verificado pelo tsc via @ts-expect-error)', () => {
    const matrix = adjacencyMatrix(U);
    // Esta função nunca é executada: serve só para o `tsc` (npm run typecheck) conferir cada diretiva.
    // Se as opções virarem opcionais, alguma diretiva fica sem erro e o `tsc` acusa "Unused '@ts-expect-error'".
    const somenteParaOTsc = () => {
      // @ts-expect-error sem nenhuma opção
      adjacencyAsNumbers(matrix);
      // @ts-expect-error falta `unweighted`
      adjacencyAsNumbers(matrix, { absent: 0 });
      // @ts-expect-error falta `absent`
      adjacencyAsNumbers(matrix, { unweighted: 1 });
      // @ts-expect-error objeto de opções vazio
      adjacencyAsNumbers(matrix, {});
      // @ts-expect-error `absent` não pode ser undefined
      adjacencyAsNumbers(matrix, { absent: undefined, unweighted: 1 });
      // @ts-expect-error `unweighted` deve ser número
      adjacencyAsNumbers(matrix, { absent: 0, unweighted: null });
      // @ts-expect-error as opções não podem ser um número solto
      adjacencyAsNumbers(matrix, 0);
      // Controle positivo: com as duas opções a chamada compila.
      adjacencyAsNumbers(matrix, { absent: 0, unweighted: 1 });
    };

    expect(typeof somenteParaOTsc).toBe('function');
  });
});
