import {
  adjacencyMatrix,
  degree,
  getEdge,
  inDegree,
  incidenceMatrix,
  outDegree,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  size,
  type Graph,
  type IncidenceMatrix,
} from './index';
import {
  connect,
  digraphWithOpposites as D,
  graphOf,
  must,
  randomGraph,
  triangleWithTail as U,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Convenção testada (Boaventura & Jurkiewicz, §2.1, p. 20): orientado → +1 na origem e −1 no destino;
// não orientado → +1 nas duas pontas; 0 = sem incidência. Linhas = vértices, colunas = arestas, ambas na
// ordem de inserção.

const column = (matrix: IncidenceMatrix, j: number) => matrix.cells.map((row) => row[j]!);
const count = (values: readonly number[], wanted: number) => values.filter((v) => v === wanted).length;
const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);
const absSum = (values: readonly number[]) => values.reduce((total, v) => total + Math.abs(v), 0);
const nonZero = (values: readonly number[]) => values.filter((v) => v !== 0).length;

function completeGraph(n: number, directed: boolean): Graph {
  let graph = withVertices(n, directed);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      if (i === j || (!directed && i > j)) continue;
      graph = connect(graph, `v${i}`, `v${j}`);
    }
  }
  return graph;
}

describe('grafo vazio e grafo sem arestas', () => {
  it('grafo vazio → arrays vazios (orientado ou não)', () => {
    expect(incidenceMatrix(withVertices(0))).toStrictEqual({ vertexIds: [], edgeIds: [], cells: [] });
    expect(incidenceMatrix(withVertices(0, true))).toStrictEqual({ vertexIds: [], edgeIds: [], cells: [] });
  });

  it('um vértice isolado → uma linha vazia', () => {
    expect(incidenceMatrix(withVertices(1))).toStrictEqual({ vertexIds: ['v1'], edgeIds: [], cells: [[]] });
    expect(incidenceMatrix(withVertices(1, true))).toStrictEqual({
      vertexIds: ['v1'],
      edgeIds: [],
      cells: [[]],
    });
  });

  it('vários vértices sem arestas → uma linha vazia para cada um, na ordem dos vértices', () => {
    for (const directed of [false, true]) {
      expect(incidenceMatrix(withVertices(3, directed))).toStrictEqual({
        vertexIds: ['v1', 'v2', 'v3'],
        edgeIds: [],
        cells: [[], [], []],
      });
    }
  });

  it('as linhas vazias são arrays independentes', () => {
    const { cells } = incidenceMatrix(withVertices(3));

    expect(new Set(cells).size).toBe(3);
  });

  it('um vértice isolado entre outros conectados tem a linha inteira de zeros', () => {
    for (const graph of [U, D]) {
      const matrix = incidenceMatrix(graph);
      const k = matrix.vertexIds.indexOf('v5');

      expect(matrix.cells[k]).toHaveLength(matrix.edgeIds.length);
      expect(matrix.cells[k]!.every((v) => v === 0)).toBe(true);
    }
  });
});

describe('uma única aresta', () => {
  it('não orientada: +1 nas duas pontas, qualquer que seja a ordem em que foi criada', () => {
    const esperado = { vertexIds: ['v1', 'v2'], edgeIds: ['e1'], cells: [[1], [1]] };

    expect(incidenceMatrix(graphOf(2, [['v1', 'v2']]))).toStrictEqual(esperado);
    expect(incidenceMatrix(graphOf(2, [['v2', 'v1']]))).toStrictEqual(esperado);
  });

  it('orientada: +1 na origem e −1 no destino (e o sentido importa)', () => {
    expect(incidenceMatrix(graphOf(2, [['v1', 'v2']], true)).cells).toStrictEqual([[1], [-1]]);
    expect(incidenceMatrix(graphOf(2, [['v2', 'v1']], true)).cells).toStrictEqual([[-1], [1]]);
  });
});

describe('matrizes esperadas, calculadas à mão', () => {
  it('grafo não orientado e desconexo (U: triângulo, haste e vértice isolado)', () => {
    // e1 v3–v4, e2 v3–v1, e3 v3–v2, e4 v2–v1
    expect(incidenceMatrix(U)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5'],
      edgeIds: ['e1', 'e2', 'e3', 'e4'],
      cells: [
        [0, 1, 0, 1], // v1
        [0, 0, 1, 1], // v2
        [1, 1, 1, 0], // v3
        [1, 0, 0, 0], // v4
        [0, 0, 0, 0], // v5 isolado
      ],
    });
  });

  it('grafo orientado com arcos opostos, fonte, sorvedouro e isolado (D)', () => {
    // e1 v4→v1, e2 v3→v1, e3 v1→v3, e4 v2→v3, e5 v1→v2, e6 v3→v6
    expect(incidenceMatrix(D)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
      edgeIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
      cells: [
        [-1, -1, 1, 0, 1, 0], // v1: recebe e1 e e2, emite e3 e e5
        [0, 0, 0, 1, -1, 0], // v2
        [0, 1, -1, -1, 0, 1], // v3
        [1, 0, 0, 0, 0, 0], // v4 (fonte)
        [0, 0, 0, 0, 0, 0], // v5 (isolado)
        [0, 0, 0, 0, 0, -1], // v6 (sorvedouro)
      ],
    });
  });

  it('grafo conexo (caminho v1–v2–v3–v4), arestas criadas fora de ordem', () => {
    const caminho = graphOf(4, [
      ['v3', 'v4'],
      ['v1', 'v2'],
      ['v2', 'v3'],
    ]);

    expect(incidenceMatrix(caminho).cells).toStrictEqual([
      [0, 1, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 0, 0],
    ]);
  });

  it('grafo com duas componentes', () => {
    const duas = graphOf(4, [
      ['v4', 'v3'],
      ['v2', 'v1'],
    ]);

    expect(incidenceMatrix(duas).cells).toStrictEqual([
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 0],
    ]);
  });

  it('os pesos não aparecem: W (não orientado ponderado) e WD (orientado ponderado)', () => {
    expect(incidenceMatrix(W).cells).toStrictEqual([
      [1, 0, 0, 1],
      [1, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 1, 1],
    ]);
    expect(incidenceMatrix(WD).cells).toStrictEqual([
      [1, -1, 0],
      [-1, 1, 1],
      [0, 0, -1],
    ]);
  });
});

describe('arcos em sentidos opostos', () => {
  it('ocupam colunas diferentes, com os sinais trocados', () => {
    const matrix = incidenceMatrix(WD); // e1 v1→v2 e e2 v2→v1

    expect(matrix.edgeIds.slice(0, 2)).toStrictEqual(['e1', 'e2']);
    expect(column(matrix, 0)).toStrictEqual([1, -1, 0]);
    expect(column(matrix, 1)).toStrictEqual([-1, 1, 0]);
    expect(column(matrix, 1)).toStrictEqual(column(matrix, 0).map((v) => (v === 0 ? 0 : -v)));
  });

  it('um par de arcos opostos tem duas colunas (nunca fundidas), cada uma somando 0', () => {
    const matrix = incidenceMatrix(
      graphOf(
        2,
        [
          ['v1', 'v2'],
          ['v2', 'v1'],
        ],
        true,
      ),
    );

    expect(matrix.cells).toStrictEqual([
      [1, -1],
      [-1, 1],
    ]);
    expect(matrix.edgeIds).toHaveLength(2);
  });
});

describe('ordem de inserção', () => {
  it('linhas seguem os vértices e colunas seguem as arestas, na ordem em que foram criados', () => {
    for (const graph of [U, D, W, WD]) {
      const matrix = incidenceMatrix(graph);

      expect(matrix.vertexIds).toStrictEqual(graph.vertices.map((v) => v.id));
      expect(matrix.edgeIds).toStrictEqual(graph.edges.map((e) => e.id));
    }
  });

  it('mudar a ordem de criação das arestas só reordena as colunas (mesmo conjunto de colunas)', () => {
    const arestas: [string, string][] = [
      ['v1', 'v2'],
      ['v1', 'v4'],
      ['v2', 'v3'],
      ['v3', 'v4'],
      ['v1', 'v3'],
    ];
    const colunasOrdenadas = (graph: Graph) => {
      const matrix = incidenceMatrix(graph);
      return matrix.edgeIds.map((_, j) => JSON.stringify(column(matrix, j))).sort();
    };

    for (const directed of [false, true]) {
      const referencia = colunasOrdenadas(graphOf(4, arestas, directed));
      expect(colunasOrdenadas(graphOf(4, [...arestas].reverse(), directed))).toStrictEqual(referencia);
      expect(
        colunasOrdenadas(graphOf(4, [arestas[3]!, arestas[0]!, arestas[4]!, arestas[2]!, arestas[1]!], directed)),
      ).toStrictEqual(referencia);
    }
  });

  it('um vértice criado depois entra como a última linha', () => {
    const base = graphOf(2, [['v1', 'v2']]);
    const maior = incidenceMatrix({ ...base, vertices: [...base.vertices, { id: 'v3', label: 'C' }] });

    expect(maior.vertexIds).toStrictEqual(['v1', 'v2', 'v3']);
    expect(maior.cells).toStrictEqual([[1], [1], [0]]);
  });
});

describe('invariantes matemáticas', () => {
  /** Confere, para um grafo qualquer, tudo o que a convenção garante. */
  function checarInvariantes(graph: Graph) {
    const matrix = incidenceMatrix(graph);
    const { vertexIds, edgeIds, cells } = matrix;

    expect(cells).toHaveLength(vertexIds.length);
    for (const row of cells) expect(row).toHaveLength(edgeIds.length);
    expect(vertexIds).toStrictEqual(graph.vertices.map((v) => v.id));
    expect(edgeIds).toStrictEqual(graph.edges.map((e) => e.id));
    expect(cells.flat().every((v) => v === -1 || v === 0 || v === 1)).toBe(true);
    expect(cells.flat().filter((v) => v !== 0)).toHaveLength(2 * size(graph));

    // Cada coluna descreve exatamente os extremos da sua aresta.
    graph.edges.forEach((edge, j) => {
      const origem = vertexIds.indexOf(edge.source);
      const destino = vertexIds.indexOf(edge.target);
      expect(cells[origem]![j]).toBe(1);
      expect(cells[destino]![j]).toBe(graph.directed ? -1 : 1);
    });

    for (let j = 0; j < edgeIds.length; j++) {
      const col = column(matrix, j);
      if (graph.directed) {
        expect(count(col, 1)).toBe(1);
        expect(count(col, -1)).toBe(1);
        expect(sum(col)).toBe(0);
      } else {
        expect(count(col, 1)).toBe(2);
        expect(nonZero(col)).toBe(2);
        expect(sum(col)).toBe(2);
      }
    }

    vertexIds.forEach((id, i) => {
      const row = cells[i]!;
      expect(absSum(row)).toBe(must(degree(graph, id)));
      if (graph.directed) {
        expect(count(row, 1)).toBe(must(outDegree(graph, id)));
        expect(count(row, -1)).toBe(must(inDegree(graph, id)));
      } else {
        expect(sum(row)).toBe(must(degree(graph, id)));
      }
    });

    if (graph.directed) expect(sum(cells.flat())).toBe(0);
  }

  it.each([
    ['não orientado (U)', U],
    ['orientado (D)', D],
    ['não orientado ponderado (W)', W],
    ['orientado ponderado (WD)', WD],
    ['K6 não orientado', completeGraph(6, false)],
    ['K5 orientado completo (todos os arcos nos dois sentidos)', completeGraph(5, true)],
  ])('vale para %s', (_nome, graph) => {
    checarInvariantes(graph);
  });

  it('não orientado: cada coluna tem exatamente duas células +1, somando 2; a soma da linha é o grau', () => {
    const matrix = incidenceMatrix(U);

    for (let j = 0; j < matrix.edgeIds.length; j++) {
      const col = column(matrix, j);
      expect(col.filter((v) => v === 1)).toHaveLength(2);
      expect(sum(col)).toBe(2);
    }
    expect(matrix.cells.map(sum)).toStrictEqual([2, 2, 3, 1, 0]);
  });

  it('orientado: cada coluna tem um +1 e um −1 (soma 0); +1 por linha = saída, −1 = entrada', () => {
    const matrix = incidenceMatrix(D);

    for (let j = 0; j < matrix.edgeIds.length; j++) {
      const col = column(matrix, j);
      expect(count(col, 1)).toBe(1);
      expect(count(col, -1)).toBe(1);
      expect(sum(col)).toBe(0);
    }
    expect(matrix.cells.map((row) => count(row, 1))).toStrictEqual([2, 1, 2, 1, 0, 0]); // graus de saída
    expect(matrix.cells.map((row) => count(row, -1))).toStrictEqual([2, 1, 2, 0, 0, 1]); // graus de entrada
    expect(matrix.cells.map(absSum)).toStrictEqual([4, 2, 4, 1, 0, 1]); // graus totais
  });
});

describe('pesos não fazem parte da matriz', () => {
  it('só há −1, 0 e 1, e os mesmos extremos com ou sem pesos dão a mesma matriz', () => {
    const semPesos = graphOf(4, [
      ['v1', 'v2'],
      ['v2', 'v3'],
      ['v3', 'v4'],
      ['v1', 'v4'],
    ]);

    expect(incidenceMatrix(W)).toStrictEqual(incidenceMatrix(semPesos));
    expect(incidenceMatrix(W).cells.flat().every((v) => [-1, 0, 1].includes(v))).toBe(true);
  });

  it('definir, trocar por zero, tornar negativo e remover pesos não altera a matriz', () => {
    const antes = incidenceMatrix(W);

    for (const peso of [5, 0, -4, undefined]) {
      expect(incidenceMatrix(must(setEdgeWeight(W, 'e1', peso)))).toStrictEqual(antes);
      expect(incidenceMatrix(must(setEdgeWeight(WD, 'e1', peso)))).toStrictEqual(incidenceMatrix(WD));
    }
  });
});

describe('rótulo, remoção de aresta e remoção de vértice', () => {
  it('mudar um rótulo não altera a matriz (só usa ids)', () => {
    expect(incidenceMatrix(must(setVertexLabel(U, 'v3', 'Nó central')))).toStrictEqual(incidenceMatrix(U));
  });

  it('remover uma aresta tira a coluna dela e mantém a ordem das outras', () => {
    const matrix = incidenceMatrix(must(removeEdge(U, 'e2'))); // tira v3–v1

    expect(matrix.edgeIds).toStrictEqual(['e1', 'e3', 'e4']);
    expect(matrix.cells).toStrictEqual([
      [0, 0, 1], // v1
      [0, 1, 1], // v2
      [1, 1, 0], // v3
      [1, 0, 0], // v4
      [0, 0, 0], // v5
    ]);
  });

  it('remover a última aresta deixa uma linha vazia por vértice', () => {
    const matrix = incidenceMatrix(must(removeEdge(graphOf(2, [['v1', 'v2']]), 'e1')));

    expect(matrix).toStrictEqual({ vertexIds: ['v1', 'v2'], edgeIds: [], cells: [[], []] });
  });

  it('remover um vértice tira a linha dele e as colunas das arestas que o tocavam', () => {
    const matrix = incidenceMatrix(must(removeVertex(U, 'v3'))); // tira e1, e2, e3 (todas tocam v3)

    expect(matrix.vertexIds).toStrictEqual(['v1', 'v2', 'v4', 'v5']);
    expect(matrix.edgeIds).toStrictEqual(['e4']);
    expect(matrix.cells).toStrictEqual([[1], [1], [0], [0]]);
  });

  it('em grafo orientado, remover um vértice tira arcos de entrada e de saída', () => {
    const matrix = incidenceMatrix(must(removeVertex(D, 'v1'))); // tira e1, e2, e3, e5

    expect(matrix.edgeIds).toStrictEqual(['e4', 'e6']);
    expect(matrix.cells).toStrictEqual([
      [1, 0], // v2
      [-1, 1], // v3
      [0, 0], // v4
      [0, 0], // v5
      [0, -1], // v6
    ]);
  });
});

describe('imutabilidade e determinismo', () => {
  it('não altera o grafo recebido (grafos congelados)', () => {
    const antes = [U, D, W, WD].map((graph) => JSON.stringify(graph));

    for (const graph of [U, D, W, WD]) incidenceMatrix(graph);

    expect([U, D, W, WD].map((graph) => JSON.stringify(graph))).toStrictEqual(antes);
  });

  it('o mesmo grafo produz sempre a mesma matriz', () => {
    const a = incidenceMatrix(D);
    const b = incidenceMatrix(D);

    expect(a).toStrictEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('devolve estruturas novas a cada chamada: alterar uma cópia não afeta a outra', () => {
    const a = incidenceMatrix(U);
    const b = incidenceMatrix(U);

    expect(a).not.toBe(b);
    expect(a.cells).not.toBe(b.cells);
    expect(a.cells[0]).not.toBe(b.cells[0]);
    expect(a.vertexIds).not.toBe(b.vertexIds);
    expect(a.edgeIds).not.toBe(b.edgeIds);
    (a.cells[0] as number[])[0] = 99;
    (a.vertexIds as string[])[0] = 'lixo';
    (a.edgeIds as string[])[0] = 'lixo';

    expect(incidenceMatrix(U)).toStrictEqual(b);
  });

  it('as linhas são arrays independentes (nenhuma é compartilhada)', () => {
    const { cells } = incidenceMatrix(U);

    expect(new Set(cells).size).toBe(cells.length);
  });
});

/** Produto B·Bᵀ (V × V), feito de propósito de forma simples: só para exemplos pequenos de teste. */
function multiplyByTranspose(cells: readonly (readonly number[])[]): number[][] {
  return cells.map((linhaI) =>
    cells.map((linhaJ) => linhaI.reduce((total, valor, k) => total + valor * linhaJ[k]!, 0)),
  );
}

/** Matriz de adjacência BINÁRIA pela existência das arestas (ignora pesos: não usa adjacencyAsNumbers). */
function binaryAdjacency(graph: Graph): number[][] {
  return adjacencyMatrix(graph).cells.map((row) => row.map((cell) => (cell === null ? 0 : 1)));
}

/** Diagonal dos graus: grau comum (não orientado) ou total (orientado), como matriz V × V. */
function degreeDiagonal(graph: Graph): number[][] {
  const ids = graph.vertices.map((v) => v.id);
  return ids.map((id, i) => ids.map((_, j) => (i === j ? must(degree(graph, id)) : 0)));
}

/** O lado direito da identidade: D + A (não orientado) ou D − (A + Aᵀ) (orientado). */
function identityRightSide(graph: Graph): number[][] {
  const d = degreeDiagonal(graph);
  const a = binaryAdjacency(graph);
  return d.map((linha, i) =>
    linha.map((valor, j) => (graph.directed ? valor - (a[i]![j]! + a[j]![i]!) : valor + a[i]![j]!)),
  );
}

describe('identidades entre a incidência (B) e a adjacência binária (A)', () => {
  // Não orientado: B·Bᵀ = D + A.   Orientado: B·Bᵀ = D − (A + Aᵀ).   D = diagonal dos graus.
  // A é binária: vem da EXISTÊNCIA das arestas, independentemente dos pesos.

  it.each([
    ['grafo vazio', withVertices(0)],
    ['três vértices isolados', withVertices(3)],
    ['uma aresta', graphOf(2, [['v1', 'v2']])],
    ['triângulo com haste e isolado (U)', U],
    ['ponderado, com pesos 0 e negativos (W)', W],
    ['K4', completeGraph(4, false)],
  ])('não orientado: B·Bᵀ = D + A — %s', (_nome, graph) => {
    expect(multiplyByTranspose(incidenceMatrix(graph).cells)).toStrictEqual(identityRightSide(graph));
  });

  it.each([
    ['grafo vazio', withVertices(0, true)],
    ['três vértices isolados', withVertices(3, true)],
    ['um arco', graphOf(2, [['v1', 'v2']], true)],
    ['arcos opostos', graphOf(2, [['v1', 'v2'], ['v2', 'v1']], true)],
    ['fonte, sorvedouro e arcos opostos (D)', D],
    ['ponderado, com pesos 0 e negativos (WD)', WD],
    ['K4 orientado completo', completeGraph(4, true)],
  ])('orientado: B·Bᵀ = D − (A + Aᵀ) — %s', (_nome, graph) => {
    expect(multiplyByTranspose(incidenceMatrix(graph).cells)).toStrictEqual(identityRightSide(graph));
  });

  it('os arcos opostos pesam −2 fora da diagonal (um para cada sentido)', () => {
    const produto = multiplyByTranspose(
      incidenceMatrix(graphOf(2, [['v1', 'v2'], ['v2', 'v1']], true)).cells,
    );

    expect(produto).toStrictEqual([
      [2, -2],
      [-2, 2],
    ]);
  });

  it('a fórmula do não orientado NÃO vale no orientado (o teste discrimina)', () => {
    const produto = multiplyByTranspose(incidenceMatrix(WD).cells);
    const errada = degreeDiagonal(WD).map((linha, i) =>
      linha.map((valor, j) => valor + binaryAdjacency(WD)[i]![j]!),
    );

    expect(produto).not.toStrictEqual(errada);
  });

  it('vale em 100 grafos pequenos pseudoaleatórios (até 6 vértices), orientados e não orientados', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const directed of [false, true]) {
        const graph = randomGraph(seed, directed, 6);
        expect(multiplyByTranspose(incidenceMatrix(graph).cells)).toStrictEqual(identityRightSide(graph));
      }
    }
  });
});

describe('grafos pseudoaleatórios reproduzíveis', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('as invariantes valem em 200 grafos (orientado = %s)', (directed) => {
    for (const seed of sementes) {
      const graph = randomGraph(seed, directed);
      const matrix = incidenceMatrix(graph);

      expect(matrix.cells).toHaveLength(graph.vertices.length);
      graph.edges.forEach((edge, j) => {
        const col = column(matrix, j);
        const origem = matrix.vertexIds.indexOf(edge.source);
        const destino = matrix.vertexIds.indexOf(edge.target);

        expect(nonZero(col)).toBe(2);
        expect(col[origem]).toBe(1);
        expect(col[destino]).toBe(directed ? -1 : 1);
        expect(sum(col)).toBe(directed ? 0 : 2);
      });
      matrix.vertexIds.forEach((id, i) => {
        expect(absSum(matrix.cells[i]!)).toBe(must(degree(graph, id)));
        if (directed) {
          expect(count(matrix.cells[i]!, 1)).toBe(must(outDegree(graph, id)));
          expect(count(matrix.cells[i]!, -1)).toBe(must(inDegree(graph, id)));
        }
      });
      for (const edge of matrix.edgeIds) expect(getEdge(graph, edge)).toBeDefined();
    }
  });

  it('o resultado é determinístico para a mesma semente e ignora os pesos sorteados', () => {
    expect(incidenceMatrix(randomGraph(42, true))).toStrictEqual(incidenceMatrix(randomGraph(42, true)));
    const comPesos = randomGraph(7, false);
    const semPesos = {
      ...comPesos,
      edges: comPesos.edges.map(({ weight: _peso, ...resto }) => resto),
    };

    expect(incidenceMatrix(comPesos)).toStrictEqual(incidenceMatrix(semPesos));
  });
});
