import {
  adjacencyList,
  degree,
  getEdge,
  inDegree,
  incidenceList,
  incidenceMatrix,
  outDegree,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  size,
  type Graph,
  type IncidenceList,
  type IncidenceListEntry,
  type IncidenceRole,
} from './index';
import {
  completeGraph,
  digraphWithOpposites as D,
  graphOf,
  must,
  randomGraph,
  triangleWithTail as U,
  weightedDigraph as WD,
  weightedGraph as W,
  withVertices,
} from './test-helpers';

// Papéis: orientado → `outgoing` na origem e `incoming` no destino (+1 / −1 na matriz de incidência);
// não orientado → `undirected` nos dois extremos (+1 nos dois). Entradas na ordem de inserção das ARESTAS.

/** Entrada esperada: `e('e1', 'v2', 'out')`, `e('e2', 'v3', 'in', 0)`, `e('e4', 'v1', 'und')`. */
const ROLES = { out: 'outgoing', in: 'incoming', und: 'undirected' } as const;
const e = (
  edgeId: string,
  oppositeVertexId: string,
  role: keyof typeof ROLES,
  weight?: number,
): IncidenceListEntry =>
  weight === undefined
    ? { edgeId, oppositeVertexId, role: ROLES[role] }
    : { edgeId, oppositeVertexId, role: ROLES[role], weight };

const rowOf = (list: IncidenceList, vertexId: string) => list.rows[list.vertexIds.indexOf(vertexId)]!;
const countRole = (row: readonly IncidenceListEntry[], role: IncidenceRole) =>
  row.filter((entry) => entry.role === role).length;
const totalEntries = (list: IncidenceList) => list.rows.reduce((total, row) => total + row.length, 0);

describe('grafo vazio e vértices isolados', () => {
  it('grafo vazio → arrays vazios (orientado ou não)', () => {
    expect(incidenceList(withVertices(0))).toStrictEqual({ vertexIds: [], rows: [] });
    expect(incidenceList(withVertices(0, true))).toStrictEqual({ vertexIds: [], rows: [] });
  });

  it('um vértice isolado → uma linha vazia', () => {
    expect(incidenceList(withVertices(1))).toStrictEqual({ vertexIds: ['v1'], rows: [[]] });
    expect(incidenceList(withVertices(1, true))).toStrictEqual({ vertexIds: ['v1'], rows: [[]] });
  });

  it('vários vértices isolados → uma linha vazia para cada um, na ordem dos vértices', () => {
    for (const directed of [false, true]) {
      expect(incidenceList(withVertices(3, directed))).toStrictEqual({
        vertexIds: ['v1', 'v2', 'v3'],
        rows: [[], [], []],
      });
    }
  });

  it('o vértice isolado aparece com linha vazia mesmo cercado de vértices conectados', () => {
    expect(rowOf(incidenceList(U), 'v5')).toStrictEqual([]);
    expect(rowOf(incidenceList(D), 'v5')).toStrictEqual([]);
  });
});

describe('matrizes esperadas, calculadas à mão', () => {
  it('não orientado e desconexo (U): arestas e1 v3–v4, e2 v3–v1, e3 v3–v2, e4 v2–v1', () => {
    expect(incidenceList(U)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5'],
      rows: [
        [e('e2', 'v3', 'und'), e('e4', 'v2', 'und')], // v1
        [e('e3', 'v3', 'und'), e('e4', 'v1', 'und')], // v2
        [e('e1', 'v4', 'und'), e('e2', 'v1', 'und'), e('e3', 'v2', 'und')], // v3
        [e('e1', 'v3', 'und')], // v4
        [], // v5
      ],
    });
  });

  it('orientado com arcos opostos, fonte, sorvedouro e isolado (D)', () => {
    // e1 v4→v1, e2 v3→v1, e3 v1→v3, e4 v2→v3, e5 v1→v2, e6 v3→v6
    expect(incidenceList(D)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
      rows: [
        [e('e1', 'v4', 'in'), e('e2', 'v3', 'in'), e('e3', 'v3', 'out'), e('e5', 'v2', 'out')], // v1
        [e('e4', 'v3', 'out'), e('e5', 'v1', 'in')], // v2
        [e('e2', 'v1', 'out'), e('e3', 'v1', 'in'), e('e4', 'v2', 'in'), e('e6', 'v6', 'out')], // v3
        [e('e1', 'v1', 'out')], // v4 (fonte)
        [], // v5 (isolado)
        [e('e6', 'v3', 'in')], // v6 (sorvedouro)
      ],
    });
  });

  it('o exemplo do ciclo A → B → C → A (e1, e2, e3)', () => {
    const ciclo = graphOf(
      3,
      [
        ['v1', 'v2'],
        ['v2', 'v3'],
        ['v3', 'v1'],
      ],
      true,
    );

    expect(incidenceList(ciclo)).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v3'],
      rows: [
        [e('e1', 'v2', 'out'), e('e3', 'v3', 'in')], // A: e1 sai para B; e3 chega de C
        [e('e1', 'v1', 'in'), e('e2', 'v3', 'out')], // B: e1 chega de A; e2 sai para C
        [e('e2', 'v2', 'in'), e('e3', 'v1', 'out')], // C: e2 chega de B; e3 sai para A
      ],
    });
    expect(totalEntries(incidenceList(ciclo))).toBe(2 * 3); // cada aresta participa de duas entradas
  });

  it('grafo conexo (caminho), com arestas criadas fora da ordem dos vértices', () => {
    const caminho = graphOf(4, [
      ['v3', 'v4'], // e1
      ['v1', 'v2'], // e2
      ['v2', 'v3'], // e3
    ]);

    expect(incidenceList(caminho).rows).toStrictEqual([
      [e('e2', 'v2', 'und')],
      [e('e2', 'v1', 'und'), e('e3', 'v3', 'und')],
      [e('e1', 'v4', 'und'), e('e3', 'v2', 'und')],
      [e('e1', 'v3', 'und')],
    ]);
  });

  it('grafo com duas componentes', () => {
    const duas = graphOf(4, [
      ['v4', 'v3'], // e1
      ['v2', 'v1'], // e2
    ]);

    expect(incidenceList(duas).rows).toStrictEqual([
      [e('e2', 'v2', 'und')],
      [e('e2', 'v1', 'und')],
      [e('e1', 'v4', 'und')],
      [e('e1', 'v3', 'und')],
    ]);
  });
});

describe('papéis', () => {
  it('não orientado: todas as entradas são `undirected`', () => {
    for (const graph of [U, W, completeGraph(4, false)]) {
      for (const row of incidenceList(graph).rows) {
        for (const entry of row) expect(entry.role).toBe('undirected');
      }
    }
  });

  it('orientado: `outgoing` na origem e `incoming` no destino de cada arco', () => {
    const list = incidenceList(D);

    for (const edge of D.edges) {
      const naOrigem = rowOf(list, edge.source).find((entry) => entry.edgeId === edge.id);
      const noDestino = rowOf(list, edge.target).find((entry) => entry.edgeId === edge.id);

      expect(naOrigem).toMatchObject({ role: 'outgoing', oppositeVertexId: edge.target });
      expect(noDestino).toMatchObject({ role: 'incoming', oppositeVertexId: edge.source });
    }
  });

  it('fonte só tem `outgoing`, sorvedouro só tem `incoming` e o isolado não tem nada', () => {
    const list = incidenceList(D);

    expect(rowOf(list, 'v4').every((entry) => entry.role === 'outgoing')).toBe(true);
    expect(rowOf(list, 'v6').every((entry) => entry.role === 'incoming')).toBe(true);
    expect(rowOf(list, 'v5')).toHaveLength(0);
  });

  it('o outro extremo (oppositeVertexId) nunca é o próprio dono da linha', () => {
    for (const graph of [U, D, W, WD]) {
      const list = incidenceList(graph);
      list.rows.forEach((row, i) => {
        for (const entry of row) expect(entry.oppositeVertexId).not.toBe(list.vertexIds[i]);
      });
    }
  });
});

describe('arcos em sentidos opostos', () => {
  it('v1→v3 (e3) e v3→v1 (e2) têm identificadores independentes e aparecem nas duas linhas', () => {
    const list = incidenceList(D);

    expect(rowOf(list, 'v1').filter((x) => x.oppositeVertexId === 'v3')).toStrictEqual([
      e('e2', 'v3', 'in'), // v3→v1 chega em v1
      e('e3', 'v3', 'out'), // v1→v3 sai de v1
    ]);
    expect(rowOf(list, 'v3').filter((x) => x.oppositeVertexId === 'v1')).toStrictEqual([
      e('e2', 'v1', 'out'),
      e('e3', 'v1', 'in'),
    ]);
  });

  it('um par de arcos opostos com pesos diferentes mantém cada peso no seu arco', () => {
    const list = incidenceList(WD); // e1 v1→v2 peso 0, e2 v2→v1 peso −1

    expect(rowOf(list, 'v1').slice(0, 2)).toStrictEqual([e('e1', 'v2', 'out', 0), e('e2', 'v2', 'in', -1)]);
    expect(rowOf(list, 'v2').slice(0, 2)).toStrictEqual([e('e1', 'v1', 'in', 0), e('e2', 'v1', 'out', -1)]);
  });
});

describe('pesos', () => {
  it('preserva peso ausente, zero e negativo (não orientado)', () => {
    expect(incidenceList(W).rows).toStrictEqual([
      [e('e1', 'v2', 'und'), e('e4', 'v4', 'und', 7)],
      [e('e1', 'v1', 'und'), e('e2', 'v3', 'und', 0)],
      [e('e2', 'v2', 'und', 0), e('e3', 'v4', 'und', -2.5)],
      [e('e3', 'v3', 'und', -2.5), e('e4', 'v1', 'und', 7)],
    ]);
  });

  it('preserva os três estados em grafo orientado', () => {
    expect(incidenceList(WD).rows).toStrictEqual([
      [e('e1', 'v2', 'out', 0), e('e2', 'v2', 'in', -1)],
      [e('e1', 'v1', 'in', 0), e('e2', 'v1', 'out', -1), e('e3', 'v3', 'out')],
      [e('e3', 'v2', 'in')],
    ]);
  });

  it('os dois extremos da mesma aresta carregam o mesmo peso', () => {
    for (const graph of [W, WD]) {
      const list = incidenceList(graph);
      for (const edge of graph.edges) {
        for (const id of [edge.source, edge.target]) {
          const entry = rowOf(list, id).find((x) => x.edgeId === edge.id)!;
          expect(entry.weight).toBe(edge.weight);
          expect('weight' in entry).toBe('weight' in edge);
        }
      }
    }
  });

  it('aresta sem peso não ganha o campo weight e nunca vira 1', () => {
    for (const graph of [U, D]) {
      for (const entry of incidenceList(graph).rows.flat()) {
        expect(entry).not.toHaveProperty('weight');
        expect(entry.weight).toBeUndefined();
      }
    }
  });

  it('peso zero continua sendo peso (campo presente), diferente de ausente', () => {
    const entrada = rowOf(incidenceList(W), 'v2');

    expect(entrada[1]).toHaveProperty('weight', 0);
    expect(entrada[0]).not.toHaveProperty('weight');
  });
});

describe('ordem das entradas = ordem de inserção das arestas (não a dos vizinhos)', () => {
  it('em U, a linha de v3 segue as arestas e1 (v4), e2 (v1), e3 (v2)', () => {
    expect(rowOf(incidenceList(U), 'v3').map((x) => x.oppositeVertexId)).toStrictEqual(['v4', 'v1', 'v2']);
  });

  it('difere da lista de adjacência, que ordena pelos vértices vizinhos (v1, v2, v4)', () => {
    const adjacentes = adjacencyList(U)[2]!.entries.map((x) => x.vertexId);

    expect(adjacentes).toStrictEqual(['v1', 'v2', 'v4']);
    expect(rowOf(incidenceList(U), 'v3').map((x) => x.oppositeVertexId)).not.toStrictEqual(adjacentes);
    // …mas o conjunto de vizinhos e de arestas é o mesmo.
    expect(
      rowOf(incidenceList(U), 'v3')
        .map((x) => x.oppositeVertexId)
        .sort(),
    ).toStrictEqual([...adjacentes].sort());
  });

  it('em toda linha, os ids das arestas crescem (cada id vem da ordem de criação)', () => {
    for (const graph of [U, D, W, WD, ...[1, 2, 3, 4, 5].map((s) => randomGraph(s, s % 2 === 0))]) {
      const numeros = (row: readonly IncidenceListEntry[]) => row.map((x) => Number(x.edgeId.slice(1)));
      for (const row of incidenceList(graph).rows) {
        expect(numeros(row)).toStrictEqual([...numeros(row)].sort((a, b) => a - b));
      }
    }
  });

  it('mudar a ordem de criação das arestas reordena as entradas, mas o conjunto por vértice é o mesmo', () => {
    const arestas: [string, string][] = [
      ['v1', 'v2'],
      ['v1', 'v4'],
      ['v2', 'v3'],
      ['v3', 'v4'],
      ['v1', 'v3'],
    ];
    const conjuntos = (graph: Graph) =>
      incidenceList(graph).rows.map((row) =>
        row.map((x) => `${x.oppositeVertexId}:${x.role}`).sort(),
      );

    for (const directed of [false, true]) {
      const referencia = conjuntos(graphOf(4, arestas, directed));
      expect(conjuntos(graphOf(4, [...arestas].reverse(), directed))).toStrictEqual(referencia);
    }
  });
});

describe('invariantes matemáticas', () => {
  function checarInvariantes(graph: Graph) {
    const list = incidenceList(graph);

    expect(list.vertexIds).toStrictEqual(graph.vertices.map((v) => v.id));
    expect(list.rows).toHaveLength(graph.vertices.length);
    expect(totalEntries(list)).toBe(2 * size(graph));

    // Cada aresta aparece exatamente uma vez em cada extremo e em nenhuma outra linha.
    for (const edge of graph.edges) {
      const donos = list.vertexIds.filter((_, i) => list.rows[i]!.some((x) => x.edgeId === edge.id));
      expect(donos.sort()).toStrictEqual([edge.source, edge.target].sort());
      for (const id of [edge.source, edge.target]) {
        expect(rowOf(list, id).filter((x) => x.edgeId === edge.id)).toHaveLength(1);
      }
    }

    list.vertexIds.forEach((id, i) => {
      const row = list.rows[i]!;
      expect(row).toHaveLength(must(degree(graph, id)));
      if (graph.directed) {
        expect(countRole(row, 'outgoing')).toBe(must(outDegree(graph, id)));
        expect(countRole(row, 'incoming')).toBe(must(inDegree(graph, id)));
        expect(countRole(row, 'undirected')).toBe(0);
      } else {
        expect(countRole(row, 'undirected')).toBe(row.length);
      }
    });
  }

  it.each([
    ['não orientado (U)', U],
    ['orientado (D)', D],
    ['não orientado ponderado (W)', W],
    ['orientado ponderado (WD)', WD],
    ['K6 não orientado', completeGraph(6, false)],
    ['K5 orientado completo', completeGraph(5, true)],
  ])('vale para %s', (_nome, graph) => {
    checarInvariantes(graph);
  });

  it('cada aresta gera exatamente duas incidências: total de entradas = 2·|E|', () => {
    expect(totalEntries(incidenceList(U))).toBe(8);
    expect(totalEntries(incidenceList(D))).toBe(12);
  });

  it('não orientado: cada vértice tem exatamente `degree(v)` entradas; orientado: out/in/total', () => {
    expect(incidenceList(U).rows.map((row) => row.length)).toStrictEqual([2, 2, 3, 1, 0]);
    const d = incidenceList(D);
    expect(d.rows.map((row) => countRole(row, 'outgoing'))).toStrictEqual([2, 1, 2, 1, 0, 0]);
    expect(d.rows.map((row) => countRole(row, 'incoming'))).toStrictEqual([2, 1, 2, 0, 0, 1]);
    expect(d.rows.map((row) => row.length)).toStrictEqual([4, 2, 4, 1, 0, 1]);
  });
});

describe('consistência com a matriz de incidência', () => {
  /**
   * A lista e a matriz precisam descrever exatamente as mesmas incidências, na mesma ordem:
   * +1 ↔ `outgoing` (orientado) ou `undirected` (não orientado); −1 ↔ `incoming`.
   */
  function compararComAMatriz(graph: Graph) {
    const list = incidenceList(graph);
    const matrix = incidenceMatrix(graph);

    expect(list.vertexIds).toStrictEqual(matrix.vertexIds);
    matrix.cells.forEach((cellsRow, i) => {
      const esperado = cellsRow.flatMap((value, j) => {
        if (value === 0) return [];
        const outroIndice = matrix.cells.findIndex((r, k) => k !== i && r[j] !== 0);
        const role: IncidenceRole = value === -1 ? 'incoming' : graph.directed ? 'outgoing' : 'undirected';
        return [[matrix.edgeIds[j], matrix.vertexIds[outroIndice], role]];
      });
      const real = list.rows[i]!.map((x) => [x.edgeId, x.oppositeVertexId, x.role]);

      expect(real).toStrictEqual(esperado);
    });

    // O mesmo conjunto de incidências (vértice, aresta), sem sobra nem falta.
    const daMatriz = matrix.cells
      .flatMap((cellsRow, i) =>
        cellsRow.flatMap((value, j) => (value === 0 ? [] : [`${matrix.vertexIds[i]}|${matrix.edgeIds[j]}`])),
      )
      .sort();
    const daLista = list.rows
      .flatMap((row, i) => row.map((x) => `${list.vertexIds[i]}|${x.edgeId}`))
      .sort();
    expect(daLista).toStrictEqual(daMatriz);
  }

  it.each([
    ['não orientado (U)', U],
    ['orientado (D), com arcos opostos', D],
    ['ponderado não orientado (W)', W],
    ['ponderado orientado (WD), com arcos opostos', WD],
    ['K4 não orientado', completeGraph(4, false)],
    ['K4 orientado completo (todos os arcos nos dois sentidos)', completeGraph(4, true)],
    ['grafo sem arestas', withVertices(3)],
    ['grafo vazio', withVertices(0, true)],
  ])('lista e matriz descrevem as mesmas incidências — %s', (_nome, graph) => {
    compararComAMatriz(graph);
  });

  it('+1 da matriz é `outgoing` no orientado e −1 é `incoming` (exemplo explícito, WD)', () => {
    const matrix = incidenceMatrix(WD);
    const list = incidenceList(WD);

    expect(matrix.cells[0]![0]).toBe(1);
    expect(rowOf(list, 'v1')[0]).toMatchObject({ edgeId: 'e1', role: 'outgoing' });
    expect(matrix.cells[0]![1]).toBe(-1);
    expect(rowOf(list, 'v1')[1]).toMatchObject({ edgeId: 'e2', role: 'incoming' });
  });

  it('os edgeId e vertexId são os mesmos das outras representações', () => {
    for (const graph of [U, D, W, WD]) {
      const list = incidenceList(graph);
      const matrix = incidenceMatrix(graph);
      const adjacencia = adjacencyList(graph);

      expect(list.vertexIds).toStrictEqual(adjacencia.map((row) => row.vertexId));
      const idsDaLista = new Set(list.rows.flat().map((x) => x.edgeId));
      expect([...idsDaLista].sort()).toStrictEqual([...matrix.edgeIds].sort());
      expect([...idsDaLista].sort()).toStrictEqual(graph.edges.map((edge) => edge.id).sort());
    }
  });
});

describe('rótulo, peso e remoções', () => {
  it('mudar um rótulo não altera a lista (ela só usa ids)', () => {
    expect(incidenceList(must(setVertexLabel(U, 'v3', 'Nó central')))).toStrictEqual(incidenceList(U));
  });

  it('definir peso aparece nas duas pontas e só nelas', () => {
    const list = incidenceList(must(setEdgeWeight(W, 'e1', 5))); // e1 v1–v2

    expect(rowOf(list, 'v1')[0]).toStrictEqual(e('e1', 'v2', 'und', 5));
    expect(rowOf(list, 'v2')[0]).toStrictEqual(e('e1', 'v1', 'und', 5));
    expect(rowOf(list, 'v3')).toStrictEqual(rowOf(incidenceList(W), 'v3'));
    expect(rowOf(list, 'v4')).toStrictEqual(rowOf(incidenceList(W), 'v4'));
  });

  it('em grafo orientado, o peso novo vai para o `outgoing` e para o `incoming` do mesmo arco', () => {
    const list = incidenceList(must(setEdgeWeight(WD, 'e3', 9))); // e3 v2→v3

    expect(rowOf(list, 'v2')[2]).toStrictEqual(e('e3', 'v3', 'out', 9));
    expect(rowOf(list, 'v3')[0]).toStrictEqual(e('e3', 'v2', 'in', 9));
  });

  it('remover o peso tira o campo nas duas pontas; trocar por zero deixa o campo com 0', () => {
    const semPeso = incidenceList(must(setEdgeWeight(W, 'e2', undefined)));
    const comZero = incidenceList(must(setEdgeWeight(W, 'e1', 0)));

    expect(rowOf(semPeso, 'v2')[1]).toStrictEqual(e('e2', 'v3', 'und'));
    expect(rowOf(semPeso, 'v3')[0]).toStrictEqual(e('e2', 'v2', 'und'));
    expect(rowOf(comZero, 'v1')[0]).toStrictEqual(e('e1', 'v2', 'und', 0));
    expect(rowOf(comZero, 'v2')[0]).toStrictEqual(e('e1', 'v1', 'und', 0));
  });

  it('remover uma aresta tira as duas entradas dela', () => {
    expect(incidenceList(must(removeEdge(U, 'e2'))).rows).toStrictEqual([
      [e('e4', 'v2', 'und')], // v1
      [e('e3', 'v3', 'und'), e('e4', 'v1', 'und')], // v2
      [e('e1', 'v4', 'und'), e('e3', 'v2', 'und')], // v3
      [e('e1', 'v3', 'und')], // v4
      [], // v5
    ]);
  });

  it('remover um vértice tira a linha dele e as entradas das arestas que o tocavam nas outras linhas', () => {
    expect(incidenceList(must(removeVertex(U, 'v3')))).toStrictEqual({
      vertexIds: ['v1', 'v2', 'v4', 'v5'],
      rows: [[e('e4', 'v2', 'und')], [e('e4', 'v1', 'und')], [], []],
    });
    expect(incidenceList(must(removeVertex(D, 'v1')))).toStrictEqual({
      vertexIds: ['v2', 'v3', 'v4', 'v5', 'v6'],
      rows: [
        [e('e4', 'v3', 'out')],
        [e('e4', 'v2', 'in'), e('e6', 'v6', 'out')],
        [],
        [],
        [e('e6', 'v3', 'in')],
      ],
    });
  });

  it('remover a única aresta deixa todas as linhas vazias', () => {
    expect(incidenceList(must(removeEdge(graphOf(2, [['v1', 'v2']]), 'e1'))).rows).toStrictEqual([[], []]);
  });
});

describe('imutabilidade, aliasing e determinismo', () => {
  it('não altera o grafo recebido (grafos congelados)', () => {
    const antes = [U, D, W, WD].map((graph) => JSON.stringify(graph));

    for (const graph of [U, D, W, WD]) incidenceList(graph);

    expect([U, D, W, WD].map((graph) => JSON.stringify(graph))).toStrictEqual(antes);
  });

  it('o mesmo grafo produz sempre a mesma lista', () => {
    const a = incidenceList(D);
    const b = incidenceList(D);

    expect(a).toStrictEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('devolve estruturas novas a cada chamada: alterar uma cópia não afeta a outra', () => {
    const a = incidenceList(U);
    const b = incidenceList(U);

    expect(a).not.toBe(b);
    expect(a.rows).not.toBe(b.rows);
    expect(a.vertexIds).not.toBe(b.vertexIds);
    expect(a.rows[0]).not.toBe(b.rows[0]);
    expect(a.rows[0]![0]).not.toBe(b.rows[0]![0]);
    (a.rows[0] as IncidenceListEntry[]).push({ edgeId: 'lixo', oppositeVertexId: 'lixo', role: 'undirected' });
    (a.rows[0]![0] as { weight?: number }).weight = 123;
    (a.vertexIds as string[])[0] = 'lixo';

    expect(incidenceList(U)).toStrictEqual(b);
  });

  it('as duas entradas de uma aresta são objetos independentes (sem aliasing)', () => {
    const list = incidenceList(W);
    const naOrigem = rowOf(list, 'v1').find((x) => x.edgeId === 'e4')!;
    const noDestino = rowOf(list, 'v4').find((x) => x.edgeId === 'e4')!;

    expect(naOrigem).not.toBe(noDestino);
    (naOrigem as { weight?: number }).weight = 999;

    expect(noDestino.weight).toBe(7);
    expect(incidenceList(W)).toStrictEqual(incidenceList(W));
  });

  it('as linhas são arrays independentes e nenhuma entrada é objeto do grafo', () => {
    const { rows } = incidenceList(W);

    expect(new Set(rows).size).toBe(rows.length);
    for (const entry of rows.flat()) expect(W.edges).not.toContain(entry);
  });
});

describe('grafos pseudoaleatórios reproduzíveis', () => {
  const sementes = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([false, true])('as invariantes valem em 200 grafos (orientado = %s)', (directed) => {
    for (const seed of sementes) {
      const graph = randomGraph(seed, directed);
      const list = incidenceList(graph);

      expect(list.vertexIds).toStrictEqual(graph.vertices.map((v) => v.id));
      expect(totalEntries(list)).toBe(2 * size(graph));

      list.rows.forEach((row, i) => {
        const id = list.vertexIds[i]!;
        expect(row).toHaveLength(must(degree(graph, id)));
        if (directed) {
          expect(countRole(row, 'outgoing')).toBe(must(outDegree(graph, id)));
          expect(countRole(row, 'incoming')).toBe(must(inDegree(graph, id)));
        }
        for (const entry of row) {
          const edge = getEdge(graph, entry.edgeId)!;
          expect(entry.weight).toBe(edge.weight);
          expect('weight' in entry).toBe('weight' in edge);
          const [esperadoPapel, esperadoOposto] =
            edge.source === id
              ? [directed ? 'outgoing' : 'undirected', edge.target]
              : [directed ? 'incoming' : 'undirected', edge.source];
          expect(entry.role).toBe(esperadoPapel);
          expect(entry.oppositeVertexId).toBe(esperadoOposto);
        }
      });
    }
  });

  it('descreve as mesmas incidências que a matriz de incidência, na mesma ordem', () => {
    for (const seed of sementes) {
      for (const directed of [false, true]) {
        const graph = randomGraph(seed, directed);
        const list = incidenceList(graph);
        const matrix = incidenceMatrix(graph);

        matrix.cells.forEach((cellsRow, i) => {
          const daMatriz = cellsRow.flatMap((value, j) =>
            value === 0
              ? []
              : [[matrix.edgeIds[j], value === -1 ? 'incoming' : directed ? 'outgoing' : 'undirected']],
          );
          expect(list.rows[i]!.map((x) => [x.edgeId, x.role])).toStrictEqual(daMatriz);
        });
      }
    }
  });

  it('é determinístico para a mesma semente', () => {
    expect(incidenceList(randomGraph(42, true))).toStrictEqual(incidenceList(randomGraph(42, true)));
    expect(incidenceList(randomGraph(7, false))).toStrictEqual(incidenceList(randomGraph(7, false)));
  });
});
