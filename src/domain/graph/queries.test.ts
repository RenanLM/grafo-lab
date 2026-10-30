import {
  degree,
  inDegree,
  isIsolated,
  isolatedVertices,
  neighbors,
  outDegree,
  predecessors,
  removeEdge,
  removeVertex,
  size,
  successors,
  type Graph,
  type Result,
} from './index';
import { connect, errorOf, graphOf, must, withVertices } from './test-helpers';

// Arestas criadas de propósito fora da ordem dos vértices: o resultado das consultas deve
// seguir a ordem de inserção dos VÉRTICES (v1, v2, …), não a ordem de criação das arestas.

/** Triângulo v1-v2-v3, haste v3-v4 e v5 isolado. Graus: v1=2, v2=2, v3=3, v4=1, v5=0. */
const U = graphOf(5, [
  ['v3', 'v4'], // e1
  ['v3', 'v1'], // e2
  ['v3', 'v2'], // e3
  ['v2', 'v1'], // e4
]);

/**
 * Dígrafo de 6 vértices (v5 isolado). Arcos: v4→v1, v3→v1, v1→v3, v2→v3, v1→v2, v3→v6.
 * Note os arcos opostos v1→v3 e v3→v1, a fonte v4 (só sai) e o sorvedouro v6 (só entra).
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

function allIds(graph: Graph): string[] {
  return graph.vertices.map((vertex) => vertex.id);
}

function completeGraph(count: number, directed: boolean): Graph {
  let graph = withVertices(count, directed);
  for (let i = 1; i <= count; i++) {
    for (let j = 1; j <= count; j++) {
      if (i === j) continue;
      if (!directed && i > j) continue;
      graph = connect(graph, `v${i}`, `v${j}`);
    }
  }
  return graph;
}

describe('grafo vazio', () => {
  const empty = withVertices(0);

  it('não tem vértices isolados', () => {
    expect(isolatedVertices(empty)).toEqual([]);
  });

  it('qualquer consulta de vértice falha com VERTEX_NOT_FOUND', () => {
    expect(errorOf(degree(empty, 'v1'))).toEqual({ code: 'VERTEX_NOT_FOUND', vertexId: 'v1' });
    expect(errorOf(neighbors(empty, 'v1')).code).toBe('VERTEX_NOT_FOUND');
  });
});

describe('vértice inexistente', () => {
  const consultas: [string, (graph: Graph, vertexId: string) => Result<unknown>][] = [
    ['degree', degree],
    ['inDegree', inDegree],
    ['outDegree', outDegree],
    ['neighbors', neighbors],
    ['successors', successors],
    ['predecessors', predecessors],
    ['isIsolated', isIsolated],
  ];

  it.each(consultas)('%s devolve VERTEX_NOT_FOUND (não orientado e orientado)', (_nome, consulta) => {
    for (const graph of [U, D]) {
      expect(errorOf(consulta(graph, 'v99'))).toEqual({ code: 'VERTEX_NOT_FOUND', vertexId: 'v99' });
    }
  });

  it('um vértice removido deixa de existir (e não vira "grau 0")', () => {
    const semV5 = must(removeVertex(U, 'v5'));

    expect(errorOf(degree(semV5, 'v5')).code).toBe('VERTEX_NOT_FOUND');
    expect(errorOf(isIsolated(semV5, 'v5')).code).toBe('VERTEX_NOT_FOUND');
  });
});

describe('grafo não orientado', () => {
  it.each([
    ['v1', 2],
    ['v2', 2],
    ['v3', 3],
    ['v4', 1],
    ['v5', 0],
  ])('o grau de %s é %i (e entrada = saída = grau)', (vertexId, esperado) => {
    expect(must(degree(U, vertexId))).toBe(esperado);
    expect(must(inDegree(U, vertexId))).toBe(esperado);
    expect(must(outDegree(U, vertexId))).toBe(esperado);
  });

  it.each([
    ['v1', ['v2', 'v3']],
    ['v2', ['v1', 'v3']],
    ['v3', ['v1', 'v2', 'v4']], // arestas criadas na ordem v4, v1, v2
    ['v4', ['v3']],
    ['v5', []],
  ])('os vizinhos de %s são %j, na ordem dos vértices', (vertexId, esperado) => {
    expect(must(neighbors(U, vertexId))).toEqual(esperado);
  });

  it('sucessores e predecessores coincidem com os vizinhos', () => {
    for (const id of allIds(U)) {
      const vizinhos = must(neighbors(U, id));
      expect(must(successors(U, id))).toEqual(vizinhos);
      expect(must(predecessors(U, id))).toEqual(vizinhos);
    }
  });

  it('a vizinhança é simétrica e independe de como a aresta foi criada', () => {
    for (const u of allIds(U)) {
      for (const v of must(neighbors(U, u))) {
        expect(must(neighbors(U, v))).toContain(u);
      }
    }
    const invertida = graphOf(2, [['v2', 'v1']]);
    expect(must(neighbors(invertida, 'v1'))).toEqual(['v2']);
    expect(must(neighbors(invertida, 'v2'))).toEqual(['v1']);
  });

  it('o grau é igual ao número de vizinhos (grafo simples)', () => {
    for (const id of allIds(U)) {
      expect(must(degree(U, id))).toBe(must(neighbors(U, id)).length);
    }
  });

  it('soma dos graus = 2·|E| (lema do aperto de mãos)', () => {
    const soma = allIds(U).reduce((total, id) => total + must(degree(U, id)), 0);
    expect(soma).toBe(2 * size(U));
  });
});

describe('grafo orientado', () => {
  it.each([
    // vértice, entrada, saída, total
    ['v1', 2, 2, 4],
    ['v2', 1, 1, 2],
    ['v3', 2, 2, 4],
    ['v4', 0, 1, 1],
    ['v5', 0, 0, 0],
    ['v6', 1, 0, 1],
  ])('%s: entrada %i, saída %i, total %i', (vertexId, entrada, saida, total) => {
    expect(must(inDegree(D, vertexId))).toBe(entrada);
    expect(must(outDegree(D, vertexId))).toBe(saida);
    expect(must(degree(D, vertexId))).toBe(total);
  });

  it.each([
    // vértice, sucessores, predecessores, vizinhos
    ['v1', ['v2', 'v3'], ['v3', 'v4'], ['v2', 'v3', 'v4']],
    ['v2', ['v3'], ['v1'], ['v1', 'v3']],
    ['v3', ['v1', 'v6'], ['v1', 'v2'], ['v1', 'v2', 'v6']],
    ['v4', ['v1'], [], ['v1']],
    ['v5', [], [], []],
    ['v6', [], ['v3'], ['v3']],
  ])('%s: sucessores %j, predecessores %j, vizinhos %j', (vertexId, succ, pred, viz) => {
    expect(must(successors(D, vertexId))).toEqual(succ);
    expect(must(predecessors(D, vertexId))).toEqual(pred);
    expect(must(neighbors(D, vertexId))).toEqual(viz);
  });

  it('respeita o sentido: v1→v2 faz de v2 sucessor de v1, e não o contrário', () => {
    expect(must(successors(D, 'v1'))).toContain('v2');
    expect(must(predecessors(D, 'v1'))).not.toContain('v2');
    expect(must(predecessors(D, 'v2'))).toContain('v1');
    expect(must(successors(D, 'v2'))).not.toContain('v1');
  });

  it('arcos em sentidos opostos contam 2 no grau e 1 na vizinhança', () => {
    const oposto = graphOf(
      2,
      [
        ['v1', 'v2'],
        ['v2', 'v1'],
      ],
      true,
    );

    for (const id of ['v1', 'v2']) {
      expect(must(degree(oposto, id))).toBe(2);
      expect(must(inDegree(oposto, id))).toBe(1);
      expect(must(outDegree(oposto, id))).toBe(1);
      expect(must(neighbors(oposto, id))).toHaveLength(1);
    }
    expect(must(successors(oposto, 'v1'))).toEqual(['v2']);
    expect(must(predecessors(oposto, 'v1'))).toEqual(['v2']);
  });

  it('grau total = entrada + saída em todo vértice', () => {
    for (const id of allIds(D)) {
      expect(must(degree(D, id))).toBe(must(inDegree(D, id)) + must(outDegree(D, id)));
    }
  });

  it('Σ entrada = Σ saída = |E| e Σ grau = 2·|E|', () => {
    const soma = (consulta: (graph: Graph, id: string) => Result<number>) =>
      allIds(D).reduce((total, id) => total + must(consulta(D, id)), 0);

    expect(soma(inDegree)).toBe(size(D));
    expect(soma(outDegree)).toBe(size(D));
    expect(soma(degree)).toBe(2 * size(D));
  });
});

describe('grafos completos (caso extremo)', () => {
  it('K6 não orientado: todo vértice tem grau 5 e |E| = 15', () => {
    const k6 = completeGraph(6, false);

    expect(size(k6)).toBe(15);
    for (const id of allIds(k6)) {
      expect(must(degree(k6, id))).toBe(5);
      expect(must(neighbors(k6, id))).toEqual(allIds(k6).filter((other) => other !== id));
    }
  });

  it('K6 orientado (todos os arcos nos dois sentidos): entrada = saída = 5, grau 10, 5 vizinhos', () => {
    const k6 = completeGraph(6, true);

    expect(size(k6)).toBe(30);
    for (const id of allIds(k6)) {
      expect(must(inDegree(k6, id))).toBe(5);
      expect(must(outDegree(k6, id))).toBe(5);
      expect(must(degree(k6, id))).toBe(10);
      expect(must(neighbors(k6, id))).toHaveLength(5);
    }
  });
});

describe('vértices isolados', () => {
  it('lista os isolados na ordem dos vértices', () => {
    expect(isolatedVertices(U)).toEqual(['v5']);
    expect(isolatedVertices(D)).toEqual(['v5']);
    expect(isolatedVertices(graphOf(4, [['v1', 'v4']]))).toEqual(['v2', 'v3']);
  });

  it('sem nenhuma aresta, todos os vértices são isolados', () => {
    expect(isolatedVertices(withVertices(3))).toEqual(['v1', 'v2', 'v3']);
    expect(isolatedVertices(withVertices(3, true))).toEqual(['v1', 'v2', 'v3']);
  });

  it('isIsolated distingue isolado de fonte e de sorvedouro', () => {
    expect(must(isIsolated(U, 'v5'))).toBe(true);
    expect(must(isIsolated(U, 'v4'))).toBe(false);
    expect(must(isIsolated(D, 'v5'))).toBe(true);
    expect(must(isIsolated(D, 'v4'))).toBe(false); // fonte: só tem arco de saída
    expect(must(isIsolated(D, 'v6'))).toBe(false); // sorvedouro: só tem arco de entrada
  });

  it('um vértice passa a ser isolado quando perde a última aresta', () => {
    const semHaste = must(removeEdge(U, 'e1')); // remove v3-v4

    expect(must(isIsolated(semHaste, 'v4'))).toBe(true);
    expect(must(isIsolated(semHaste, 'v3'))).toBe(false);
    expect(isolatedVertices(semHaste)).toEqual(['v4', 'v5']);
  });

  it('remover um vértice pode isolar os que dependiam dele', () => {
    const semV3 = must(removeVertex(U, 'v3'));

    expect(isolatedVertices(semV3)).toEqual(['v4', 'v5']);
    expect(must(neighbors(semV3, 'v1'))).toEqual(['v2']);
  });
});

describe('consultas não alteram o grafo', () => {
  it('rodam sobre grafos congelados e deixam o grafo idêntico', () => {
    const antes = [JSON.stringify(U), JSON.stringify(D)];

    for (const graph of [U, D]) {
      for (const id of allIds(graph)) {
        degree(graph, id);
        inDegree(graph, id);
        outDegree(graph, id);
        neighbors(graph, id);
        successors(graph, id);
        predecessors(graph, id);
        isIsolated(graph, id);
      }
      isolatedVertices(graph);
    }

    expect([JSON.stringify(U), JSON.stringify(D)]).toEqual(antes);
  });

  it('devolve listas novas a cada chamada (alterar uma não afeta o grafo nem as outras)', () => {
    const a = must(neighbors(U, 'v3'));
    const b = must(neighbors(U, 'v3'));

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.push('lixo');
    expect(must(neighbors(U, 'v3'))).toEqual(['v1', 'v2', 'v4']);
  });
});
