import {
  addEdge,
  addVertex,
  createGraph,
  findEdge,
  getEdge,
  getVertex,
  order,
  removeEdge,
  removeVertex,
  size,
  GRAPH_SCHEMA_VERSION,
  type Graph,
  type Result,
} from './index';

/** Congela o grafo inteiro: qualquer mutação nas operações vira TypeError (módulos são strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

function errorOf(result: Result<unknown>) {
  if (result.ok) throw new Error('esperava erro, mas a operação teve sucesso');
  return result.error;
}

/** Grafo congelado com os vértices v1..vN (rótulos A, B, C…). */
function withVertices(count: number, directed = false): Graph {
  let graph = deepFreeze(createGraph({ id: 'g', directed }));
  for (let i = 0; i < count; i++) graph = deepFreeze(addVertex(graph).graph);
  return graph;
}

function connect(graph: Graph, source: string, target: string, weight?: number): Graph {
  return deepFreeze(must(addEdge(graph, { source, target, weight })).graph);
}

describe('createGraph', () => {
  it('cria um grafo vazio, simples e não orientado por padrão', () => {
    const graph = createGraph({ id: 'g1' });

    expect(graph).toEqual({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      id: 'g1',
      name: '',
      directed: false,
      vertices: [],
      edges: [],
      nextVertexSeq: 1,
      nextEdgeSeq: 1,
    });
    expect(order(graph)).toBe(0);
    expect(size(graph)).toBe(0);
  });

  it('aceita nome e orientação', () => {
    const graph = createGraph({ id: 'g2', name: 'Meu dígrafo', directed: true });

    expect(graph.name).toBe('Meu dígrafo');
    expect(graph.directed).toBe(true);
  });
});

describe('addVertex', () => {
  it('emite ids sequenciais e rótulos padrão A, B, C…', () => {
    const graph = withVertices(3);

    expect(graph.vertices).toEqual([
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'B' },
      { id: 'v3', label: 'C' },
    ]);
    expect(order(graph)).toBe(3);
  });

  it('devolve o vértice criado junto do novo grafo', () => {
    const { graph, vertex } = addVertex(deepFreeze(createGraph({ id: 'g' })), 'Origem');

    expect(vertex).toEqual({ id: 'v1', label: 'Origem' });
    expect(getVertex(graph, 'v1')).toBe(vertex);
  });

  it('aceita rótulos vazios e repetidos: a identidade é o id', () => {
    let graph = deepFreeze(createGraph({ id: 'g' }));
    graph = deepFreeze(addVertex(graph, '').graph);
    graph = deepFreeze(addVertex(graph, '').graph);

    expect(graph.vertices.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(graph.vertices.map((v) => v.label)).toEqual(['', '']);
  });

  it('continua o alfabeto depois do Z (Z, AA, AB…)', () => {
    const graph = withVertices(53);
    const labels = graph.vertices.map((v) => v.label);

    expect(labels[0]).toBe('A');
    expect(labels[25]).toBe('Z');
    expect(labels[26]).toBe('AA');
    expect(labels[27]).toBe('AB');
    expect(labels[51]).toBe('AZ');
    expect(labels[52]).toBe('BA');
  });

  it('não reaproveita ids nem rótulos padrão depois de uma remoção', () => {
    let graph = withVertices(3);
    graph = deepFreeze(must(removeVertex(graph, 'v3')));
    const { vertex } = addVertex(graph);

    expect(vertex).toEqual({ id: 'v4', label: 'D' });
  });
});

describe('addEdge em grafo não orientado', () => {
  it('cria arestas com ids sequenciais e sem peso', () => {
    let graph = withVertices(3);
    graph = connect(graph, 'v1', 'v2');
    graph = connect(graph, 'v2', 'v3');

    expect(graph.edges).toEqual([
      { id: 'e1', source: 'v1', target: 'v2' },
      { id: 'e2', source: 'v2', target: 'v3' },
    ]);
    expect(size(graph)).toBe(2);
    expect('weight' in graph.edges[0]!).toBe(false);
  });

  it('rejeita a aresta repetida nas duas ordens, apontando a existente', () => {
    const graph = connect(withVertices(2), 'v1', 'v2');

    expect(errorOf(addEdge(graph, { source: 'v1', target: 'v2' }))).toEqual({
      code: 'DUPLICATE_EDGE',
      existingEdgeId: 'e1',
    });
    expect(errorOf(addEdge(graph, { source: 'v2', target: 'v1' }))).toEqual({
      code: 'DUPLICATE_EDGE',
      existingEdgeId: 'e1',
    });
    expect(size(graph)).toBe(1);
  });

  it('rejeita laços', () => {
    expect(errorOf(addEdge(withVertices(2), { source: 'v1', target: 'v1' }))).toEqual({
      code: 'SELF_LOOP',
      vertexId: 'v1',
    });
  });
});

describe('addEdge em grafo orientado', () => {
  it('permite os arcos u→v e v→u como arestas distintas', () => {
    let graph = withVertices(2, true);
    graph = connect(graph, 'v1', 'v2');
    graph = connect(graph, 'v2', 'v1');

    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      ['v1', 'v2'],
      ['v2', 'v1'],
    ]);
  });

  it('rejeita repetir o mesmo arco', () => {
    const graph = connect(withVertices(2, true), 'v1', 'v2');

    expect(errorOf(addEdge(graph, { source: 'v1', target: 'v2' }))).toEqual({
      code: 'DUPLICATE_EDGE',
      existingEdgeId: 'e1',
    });
  });

  it('continua rejeitando laços', () => {
    expect(errorOf(addEdge(withVertices(1, true), { source: 'v1', target: 'v1' })).code).toBe(
      'SELF_LOOP',
    );
  });
});

describe('addEdge: pesos', () => {
  it.each([
    ['positivo', 2.5],
    ['zero', 0],
    ['negativo', -3],
  ])('guarda peso %s', (_nome, weight) => {
    const graph = connect(withVertices(2), 'v1', 'v2', weight);

    expect(graph.edges[0]!.weight).toBe(weight);
  });

  it('distingue peso zero de aresta sem peso', () => {
    let graph = withVertices(3);
    graph = connect(graph, 'v1', 'v2', 0);
    graph = connect(graph, 'v2', 'v3');

    expect(graph.edges[0]).toHaveProperty('weight', 0);
    expect(graph.edges[1]).not.toHaveProperty('weight');
  });

  it('normaliza -0 para 0', () => {
    const graph = connect(withVertices(2), 'v1', 'v2', -0);

    expect(Object.is(graph.edges[0]!.weight, 0)).toBe(true);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['texto', '3' as unknown as number],
    ['null', null as unknown as number],
  ])('rejeita peso inválido (%s)', (_nome, weight) => {
    const graph = withVertices(2);

    expect(errorOf(addEdge(graph, { source: 'v1', target: 'v2', weight })).code).toBe(
      'INVALID_WEIGHT',
    );
    expect(size(graph)).toBe(0);
  });
});

describe('addEdge: vértices inexistentes e precedência dos erros', () => {
  const graph = connect(withVertices(2), 'v1', 'v2');

  it('indica qual extremo não existe (origem antes do destino)', () => {
    expect(errorOf(addEdge(graph, { source: 'x', target: 'v1' }))).toEqual({
      code: 'VERTEX_NOT_FOUND',
      vertexId: 'x',
    });
    expect(errorOf(addEdge(graph, { source: 'v1', target: 'y' }))).toEqual({
      code: 'VERTEX_NOT_FOUND',
      vertexId: 'y',
    });
    expect(errorOf(addEdge(graph, { source: 'x', target: 'y' }))).toEqual({
      code: 'VERTEX_NOT_FOUND',
      vertexId: 'x',
    });
  });

  it('vértice inexistente vence laço', () => {
    expect(errorOf(addEdge(graph, { source: 'x', target: 'x' })).code).toBe('VERTEX_NOT_FOUND');
  });

  it('laço vence peso inválido', () => {
    expect(errorOf(addEdge(graph, { source: 'v1', target: 'v1', weight: Number.NaN })).code).toBe(
      'SELF_LOOP',
    );
  });

  it('peso inválido vence aresta repetida', () => {
    expect(errorOf(addEdge(graph, { source: 'v1', target: 'v2', weight: Number.NaN })).code).toBe(
      'INVALID_WEIGHT',
    );
  });
});

describe('removeEdge', () => {
  it('remove só a aresta indicada e preserva a ordem das demais', () => {
    let graph = withVertices(3);
    graph = connect(graph, 'v1', 'v2');
    graph = connect(graph, 'v2', 'v3');
    graph = connect(graph, 'v1', 'v3');

    const next = must(removeEdge(graph, 'e2'));

    expect(next.edges.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(order(next)).toBe(3);
    expect(size(next)).toBe(2);
  });

  it('falha para aresta inexistente', () => {
    expect(errorOf(removeEdge(withVertices(2), 'e9'))).toEqual({
      code: 'EDGE_NOT_FOUND',
      edgeId: 'e9',
    });
  });

  it('permite recriar a ligação, com um id novo', () => {
    let graph = connect(withVertices(2), 'v1', 'v2');
    graph = deepFreeze(must(removeEdge(graph, 'e1')));
    graph = connect(graph, 'v1', 'v2');

    expect(graph.edges.map((e) => e.id)).toEqual(['e2']);
  });
});

describe('removeVertex', () => {
  it('remove também as arestas incidentes (como origem e como destino)', () => {
    let graph = withVertices(4, true);
    graph = connect(graph, 'v1', 'v2'); // e1: sai de v2? não; entra em v2
    graph = connect(graph, 'v2', 'v3'); // e2: sai de v2
    graph = connect(graph, 'v3', 'v4'); // e3: não toca v2
    graph = connect(graph, 'v4', 'v2'); // e4: entra em v2

    const next = must(removeVertex(graph, 'v2'));

    expect(next.vertices.map((v) => v.id)).toEqual(['v1', 'v3', 'v4']);
    expect(next.edges.map((e) => e.id)).toEqual(['e3']);
    expect(order(next)).toBe(3);
    expect(size(next)).toBe(1);
  });

  it('em grafo não orientado remove arestas dos dois lados', () => {
    let graph = withVertices(3);
    graph = connect(graph, 'v1', 'v2');
    graph = connect(graph, 'v3', 'v2');

    expect(size(must(removeVertex(graph, 'v2')))).toBe(0);
  });

  it('remover o último vértice deixa o grafo vazio, mas mantém os contadores', () => {
    const next = must(removeVertex(withVertices(1), 'v1'));

    expect(order(next)).toBe(0);
    expect(next.nextVertexSeq).toBe(2);
  });

  it('falha para vértice inexistente', () => {
    expect(errorOf(removeVertex(withVertices(1), 'v9'))).toEqual({
      code: 'VERTEX_NOT_FOUND',
      vertexId: 'v9',
    });
  });
});

describe('consultas', () => {
  it('getVertex e getEdge devolvem o item ou undefined', () => {
    const graph = connect(withVertices(2), 'v1', 'v2');

    expect(getVertex(graph, 'v2')).toEqual({ id: 'v2', label: 'B' });
    expect(getVertex(graph, 'v9')).toBeUndefined();
    expect(getEdge(graph, 'e1')).toEqual({ id: 'e1', source: 'v1', target: 'v2' });
    expect(getEdge(graph, 'e9')).toBeUndefined();
  });

  it('findEdge respeita a orientação', () => {
    const directed = connect(withVertices(2, true), 'v1', 'v2');
    const undirected = connect(withVertices(2), 'v1', 'v2');

    expect(findEdge(directed, 'v1', 'v2')?.id).toBe('e1');
    expect(findEdge(directed, 'v2', 'v1')).toBeUndefined();
    expect(findEdge(undirected, 'v1', 'v2')?.id).toBe('e1');
    expect(findEdge(undirected, 'v2', 'v1')?.id).toBe('e1');
  });

  it('findEdge não encontra ligação entre vértices que não se conectam', () => {
    expect(findEdge(withVertices(3), 'v1', 'v3')).toBeUndefined();
  });
});

describe('imutabilidade', () => {
  it('nenhuma operação altera o grafo de entrada (entradas congeladas)', () => {
    const base = withVertices(3);
    const antes = JSON.stringify(base);

    const comAresta = must(addEdge(base, { source: 'v1', target: 'v2', weight: 4 }));
    must(removeEdge(comAresta.graph, 'e1'));
    must(removeVertex(comAresta.graph, 'v1'));
    addVertex(base, 'novo');
    addEdge(base, { source: 'v1', target: 'v1' }); // erro: também não pode mutar

    expect(JSON.stringify(base)).toBe(antes);
  });

  it('devolve novos objetos e compartilha os itens que não mudaram', () => {
    const base = withVertices(2);
    const { graph } = addVertex(base);

    expect(graph).not.toBe(base);
    expect(graph.vertices[0]).toBe(base.vertices[0]);
  });
});
