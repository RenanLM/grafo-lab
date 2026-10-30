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
  setEdgeWeight,
  setVertexLabel,
  size,
  GRAPH_SCHEMA_VERSION,
  MAX_VERTEX_LABEL_LENGTH,
} from './index';
import { connect, deepFreeze, errorOf, graphOf, must, withVertices } from './test-helpers';

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
    const { graph, vertex } = must(addVertex(deepFreeze(createGraph({ id: 'g' })), 'Origem'));

    expect(vertex).toEqual({ id: 'v1', label: 'Origem' });
    expect(getVertex(graph, 'v1')).toBe(vertex);
  });

  it('aceita rótulos repetidos: a identidade é o id', () => {
    let graph = deepFreeze(createGraph({ id: 'g' }));
    graph = deepFreeze(must(addVertex(graph, 'X')).graph);
    graph = deepFreeze(must(addVertex(graph, 'X')).graph);

    expect(graph.vertices.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(graph.vertices.map((v) => v.label)).toEqual(['X', 'X']);
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
    const { vertex } = must(addVertex(graph));

    expect(vertex).toEqual({ id: 'v4', label: 'D' });
  });

  describe('rótulo informado', () => {
    const vazio = deepFreeze(createGraph({ id: 'g' }));
    const rotuloDe = (label: unknown) => must(addVertex(vazio, label as string)).vertex.label;

    it.each([
      ['espaços comuns', '  Origem  '],
      ['tab e quebras de linha', '\t\nOrigem\r\n'],
      ['espaço não separável (U+00A0)', ' Origem '],
    ])('aplica trim() antes de guardar: %s', (_nome, entrada) => {
      expect(rotuloDe(entrada)).toBe('Origem');
    });

    it('mantém os espaços do meio', () => {
      expect(rotuloDe(' Nó  inicial ')).toBe('Nó  inicial');
    });

    it.each(['α', 'グラフ', '𝒢', 'ação', 'Ünïcödé', '👨‍👩‍👧', 'Nó 1 → Nó 2'])(
      'aceita e guarda "%s" sem alterar',
      (label) => {
        expect(rotuloDe(label)).toBe(label);
      },
    );

    it('não normaliza a forma Unicode (guarda o que o aluno digitou)', () => {
      expect(rotuloDe('é')).toBe('é');
    });

    it('permite repetir o rótulo informado e também o rótulo padrão de outro vértice', () => {
      let graph = vazio;
      graph = must(addVertex(graph, 'A')).graph; // igual ao padrão do próprio v1
      graph = must(addVertex(graph, 'A')).graph;
      graph = must(addVertex(graph)).graph; // padrão do v3 seria "C"

      expect(graph.vertices.map((v) => v.label)).toEqual(['A', 'A', 'C']);
      expect(new Set(graph.vertices.map((v) => v.id)).size).toBe(3);
    });

    it('um rótulo informado não muda a sequência dos rótulos padrão', () => {
      let graph = must(addVertex(vazio, 'Origem')).graph;
      graph = must(addVertex(graph)).graph;

      expect(graph.vertices.map((v) => v.label)).toEqual(['Origem', 'B']);
    });
  });

  describe('rótulo inválido', () => {
    const vazio = deepFreeze(createGraph({ id: 'g' }));

    it.each([
      ['vazio', ''],
      ['só espaços', '   '],
      ['só tab e quebra de linha', '\t\n'],
      ['só espaço não separável', '  '],
    ])('rejeita rótulo %s (EMPTY)', (_nome, label) => {
      expect(errorOf(addVertex(vazio, label))).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label,
        reason: 'EMPTY',
      });
    });

    const naoStrings: [string, unknown][] = [
      ['número', 42],
      ['null (não equivale a "omitido")', null],
      ['objeto', {}],
      ['lista', ['A']],
      ['booleano', false],
    ];
    it.each(naoStrings)('rejeita valor que não é string: %s (NOT_A_STRING)', (_nome, valor) => {
      expect(errorOf(addVertex(vazio, valor as string))).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label: valor,
        reason: 'NOT_A_STRING',
      });
    });

    it('só undefined significa "omitido": cria com o rótulo padrão', () => {
      expect(must(addVertex(vazio, undefined)).vertex).toEqual({ id: 'v1', label: 'A' });
    });

    it('o erro devolve o texto original, sem trim', () => {
      const original = ` ${'a'.repeat(65)} `;

      expect(errorOf(addVertex(vazio, original))).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label: original,
        reason: 'TOO_LONG',
      });
    });
  });

  describe('limite de tamanho', () => {
    const vazio = deepFreeze(createGraph({ id: 'g' }));

    it('aceita exatamente 64 caracteres e rejeita 65', () => {
      const limite = 'a'.repeat(64);

      expect(must(addVertex(vazio, limite)).vertex.label).toBe(limite);
      expect(errorOf(addVertex(vazio, `${limite}a`))).toMatchObject({
        code: 'INVALID_VERTEX_LABEL',
        reason: 'TOO_LONG',
      });
    });

    it('conta pontos de código, não unidades UTF-16 (um emoji vale 1)', () => {
      expect(must(addVertex(vazio, '😀'.repeat(64))).vertex.label).toBe('😀'.repeat(64));
      expect(errorOf(addVertex(vazio, '😀'.repeat(65))).code).toBe('INVALID_VERTEX_LABEL');
    });

    it('conta cada ponto de código: "e" + acento combinante valem 2', () => {
      expect(must(addVertex(vazio, 'é'.repeat(32))).vertex.label).toHaveLength(64);
      expect(errorOf(addVertex(vazio, 'é'.repeat(33))).code).toBe('INVALID_VERTEX_LABEL');
    });

    it('o limite vale depois do trim', () => {
      const limite = 'a'.repeat(64);

      expect(must(addVertex(vazio, `  ${limite}  `)).vertex.label).toBe(limite);
      expect(errorOf(addVertex(vazio, `${limite}a  `)).code).toBe('INVALID_VERTEX_LABEL');
    });
  });

  describe('erro não altera o grafo nem consome identificadores', () => {
    it('deixa o grafo de entrada idêntico e o contador no mesmo valor', () => {
      const base = withVertices(2);
      const antes = JSON.stringify(base);

      addVertex(base, '');
      addVertex(base, 'a'.repeat(65));
      addVertex(base, 7 as unknown as string);

      expect(JSON.stringify(base)).toBe(antes);
      expect(base.nextVertexSeq).toBe(3);
    });

    it('depois de erros, o próximo vértice válido recebe o id e o rótulo padrão esperados', () => {
      let graph = must(addVertex(deepFreeze(createGraph({ id: 'g' })))).graph; // v1 "A"
      for (const invalido of ['', '   ', null, 5, 'x'.repeat(65)]) {
        expect(addVertex(graph, invalido as string).ok).toBe(false);
      }
      const { graph: depois, vertex } = must(addVertex(graph));
      graph = depois;

      expect(vertex).toEqual({ id: 'v2', label: 'B' }); // nenhum id ou letra foi gasto pelos erros
      expect(graph.nextVertexSeq).toBe(3);
      expect(order(graph)).toBe(2);
    });

    it('operações intercaladas válidas e inválidas preservam ids, ordem e rótulos', () => {
      let graph = deepFreeze(createGraph({ id: 'g' }));
      const entradas: (string | undefined)[] = ['Origem', '', undefined, '  ', ' Destino ', undefined];
      for (const entrada of entradas) {
        const resultado = addVertex(graph, entrada);
        if (resultado.ok) graph = deepFreeze(resultado.value.graph);
      }

      expect(graph.vertices).toEqual([
        { id: 'v1', label: 'Origem' },
        { id: 'v2', label: 'B' },
        { id: 'v3', label: 'Destino' },
        { id: 'v4', label: 'D' },
      ]);
    });
  });

  describe('mesmas regras do setVertexLabel', () => {
    const entradas: unknown[] = [
      '',
      '   ',
      ' A ',
      'Origem',
      'a'.repeat(64),
      'a'.repeat(65),
      '😀'.repeat(64),
      '😀'.repeat(65),
      ' X ',
      42,
      null,
      {},
    ];

    it.each(entradas.map((entrada) => [JSON.stringify(entrada) ?? String(entrada), entrada]))(
      'aceita ou recusa %s do mesmo jeito, com o mesmo resultado',
      (_nome, entrada) => {
        const porCriacao = addVertex(withVertices(0), entrada as string);
        const porEdicao = setVertexLabel(withVertices(1), 'v1', entrada as string);

        if (porCriacao.ok && porEdicao.ok) {
          expect(porCriacao.value.vertex.label).toBe(porEdicao.value.vertices[0]!.label);
        } else {
          expect(porCriacao.ok).toBe(porEdicao.ok);
          expect(errorOf(porCriacao)).toEqual(errorOf(porEdicao));
        }
      },
    );
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
    must(addVertex(base, 'novo'));
    addVertex(base, ''); // erro: também não pode mutar
    addEdge(base, { source: 'v1', target: 'v1' }); // erro: também não pode mutar

    expect(JSON.stringify(base)).toBe(antes);
  });

  it('devolve novos objetos e compartilha os itens que não mudaram', () => {
    const base = withVertices(2);
    const { graph } = must(addVertex(base));

    expect(graph).not.toBe(base);
    expect(graph.vertices[0]).toBe(base.vertices[0]);
  });
});

describe('setVertexLabel', () => {
  // v1="A", v2="B", v3="C"; arestas e1 (v1-v2) e e2 (v2-v3).
  const base = graphOf(3, [
    ['v1', 'v2'],
    ['v2', 'v3'],
  ]);

  it('troca o rótulo preservando id, posição, conexões e os demais vértices', () => {
    const next = must(setVertexLabel(base, 'v2', 'Origem'));

    expect(next.vertices).toEqual([
      { id: 'v1', label: 'A' },
      { id: 'v2', label: 'Origem' },
      { id: 'v3', label: 'C' },
    ]);
    expect(next.vertices[0]).toBe(base.vertices[0]);
    expect(next.vertices[2]).toBe(base.vertices[2]);
    expect(next.edges).toEqual(base.edges);
    // Todo o resto do grafo (nome, orientação, contadores, arestas) fica idêntico.
    expect({ ...next, vertices: [] }).toEqual({ ...base, vertices: [] });
  });

  describe('trim', () => {
    it.each([
      ['espaços comuns', '  Origem  '],
      ['tab e quebras de linha', '\t\nOrigem\r\n'],
      ['espaço não separável (U+00A0)', ' Origem '],
      ['espaço largo (U+2003)', ' Origem '],
    ])('remove espaços das pontas: %s', (_nome, entrada) => {
      expect(must(setVertexLabel(base, 'v1', entrada)).vertices[0]!.label).toBe('Origem');
    });

    it('mantém os espaços do meio', () => {
      expect(must(setVertexLabel(base, 'v1', ' Nó  inicial ')).vertices[0]!.label).toBe(
        'Nó  inicial',
      );
    });
  });

  describe('rótulos inválidos', () => {
    it.each([
      ['vazio', ''],
      ['só espaços', '   '],
      ['só tab e quebra de linha', '\t\n'],
      ['só espaço não separável', '  '],
    ])('rejeita rótulo %s (EMPTY)', (_nome, label) => {
      expect(errorOf(setVertexLabel(base, 'v1', label))).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label,
        reason: 'EMPTY',
      });
    });

    const naoStrings: [string, unknown][] = [
      ['número', 42],
      ['null', null],
      ['undefined', undefined],
      ['objeto', {}],
      ['lista', ['A']],
    ];
    it.each(naoStrings)('rejeita valor que não é string: %s (NOT_A_STRING)', (_nome, valor) => {
      expect(errorOf(setVertexLabel(base, 'v1', valor as string))).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label: valor,
        reason: 'NOT_A_STRING',
      });
    });

    it('o erro devolve o texto original, sem trim', () => {
      const error = errorOf(setVertexLabel(base, 'v1', ` ${'a'.repeat(65)} `));

      expect(error).toEqual({
        code: 'INVALID_VERTEX_LABEL',
        label: ` ${'a'.repeat(65)} `,
        reason: 'TOO_LONG',
      });
    });

    it('o grafo de entrada não muda quando o rótulo é inválido', () => {
      const antes = JSON.stringify(base);
      setVertexLabel(base, 'v1', '');
      setVertexLabel(base, 'v1', 7 as unknown as string);

      expect(JSON.stringify(base)).toBe(antes);
    });
  });

  describe('limite de tamanho', () => {
    it('o limite é de 64 pontos de código', () => {
      expect(MAX_VERTEX_LABEL_LENGTH).toBe(64);
    });

    it('aceita exatamente 64 caracteres e rejeita 65', () => {
      const limite = 'a'.repeat(64);

      expect(must(setVertexLabel(base, 'v1', limite)).vertices[0]!.label).toBe(limite);
      expect(errorOf(setVertexLabel(base, 'v1', `${limite}a`))).toMatchObject({
        code: 'INVALID_VERTEX_LABEL',
        reason: 'TOO_LONG',
      });
    });

    it('conta pontos de código, não unidades UTF-16 (um emoji vale 1)', () => {
      const emojis = '😀'.repeat(64);

      expect(emojis.length).toBe(128); // 128 unidades UTF-16, mas 64 pontos de código
      expect(must(setVertexLabel(base, 'v1', emojis)).vertices[0]!.label).toBe(emojis);
      expect(errorOf(setVertexLabel(base, 'v1', '😀'.repeat(65))).code).toBe(
        'INVALID_VERTEX_LABEL',
      );
    });

    it('conta cada ponto de código: "e" + acento combinante valem 2', () => {
      const decomposto = 'é'; // aparece como "é", mas são 2 pontos de código

      expect(must(setVertexLabel(base, 'v1', decomposto.repeat(32))).vertices[0]!.label).toHaveLength(
        64,
      );
      expect(errorOf(setVertexLabel(base, 'v1', decomposto.repeat(33))).code).toBe(
        'INVALID_VERTEX_LABEL',
      );
    });

    it('o limite vale depois do trim', () => {
      const limite = 'a'.repeat(64);

      expect(must(setVertexLabel(base, 'v1', `  ${limite}  `)).vertices[0]!.label).toBe(limite);
      expect(errorOf(setVertexLabel(base, 'v1', `${limite}a  `)).code).toBe('INVALID_VERTEX_LABEL');
    });
  });

  describe('Unicode', () => {
    it.each(['α', 'グラフ', '𝒢', 'ação', 'Ünïcödé', '👨‍👩‍👧', 'Nó 1 → Nó 2'])(
      'aceita e guarda "%s" sem alterar',
      (label) => {
        expect(must(setVertexLabel(base, 'v1', label)).vertices[0]!.label).toBe(label);
      },
    );

    it('não normaliza a forma Unicode (guarda o que o aluno digitou)', () => {
      const decomposto = 'é';

      expect(must(setVertexLabel(base, 'v1', decomposto)).vertices[0]!.label).toBe(decomposto);
      expect(decomposto).not.toBe('é');
    });

    it('limitação conhecida: trim() não remove caracteres invisíveis como U+200B', () => {
      expect(must(setVertexLabel(base, 'v1', '​')).vertices[0]!.label).toBe('​');
    });
  });

  describe('rótulos repetidos', () => {
    it('permite o mesmo rótulo em vários vértices (a identidade é o id)', () => {
      const next = must(setVertexLabel(base, 'v2', 'A')); // v1 já se chama "A"

      expect(next.vertices.map((v) => v.label)).toEqual(['A', 'A', 'C']);
      expect(new Set(next.vertices.map((v) => v.id)).size).toBe(3);
    });
  });

  describe('vértice inexistente', () => {
    it('falha com VERTEX_NOT_FOUND', () => {
      expect(errorOf(setVertexLabel(base, 'v9', 'X'))).toEqual({
        code: 'VERTEX_NOT_FOUND',
        vertexId: 'v9',
      });
      expect(errorOf(setVertexLabel(withVertices(0), 'v1', 'X')).code).toBe('VERTEX_NOT_FOUND');
    });

    it('vértice inexistente vence rótulo inválido', () => {
      expect(errorOf(setVertexLabel(base, 'v9', '')).code).toBe('VERTEX_NOT_FOUND');
    });

    it('um vértice removido não pode mais ser renomeado', () => {
      const semV1 = must(removeVertex(base, 'v1'));

      expect(errorOf(setVertexLabel(semV1, 'v1', 'X')).code).toBe('VERTEX_NOT_FOUND');
    });
  });

  describe('estrutura preservada', () => {
    it('mantém orientação e conexões em grafo orientado', () => {
      const directed = graphOf(2, [['v1', 'v2']], true);
      const next = must(setVertexLabel(directed, 'v1', 'Fonte'));

      expect(next.directed).toBe(true);
      expect(findEdge(next, 'v1', 'v2')?.id).toBe('e1');
      expect(findEdge(next, 'v2', 'v1')).toBeUndefined();
    });

    it('não mexe nos contadores: o próximo vértice segue a sequência e o rótulo padrão', () => {
      const renomeado = must(setVertexLabel(withVertices(1), 'v1', 'X'));

      expect(must(addVertex(renomeado)).vertex).toEqual({ id: 'v2', label: 'B' });
    });
  });

  describe('sem mudança', () => {
    it('devolve o mesmo grafo quando o rótulo não muda, também depois do trim', () => {
      expect(must(setVertexLabel(base, 'v1', 'A'))).toBe(base);
      expect(must(setVertexLabel(base, 'v1', '  A '))).toBe(base);
    });
  });

  describe('imutabilidade e determinismo', () => {
    it('não altera o grafo de entrada (entradas congeladas)', () => {
      const antes = JSON.stringify(base);

      must(setVertexLabel(base, 'v1', 'Novo'));
      setVertexLabel(base, 'v9', 'X');

      expect(JSON.stringify(base)).toBe(antes);
    });

    it('é determinístico e idempotente; vale o último rótulo', () => {
      const a = must(setVertexLabel(base, 'v1', ' X '));
      const b = must(setVertexLabel(base, 'v1', 'X'));

      expect(a).toEqual(b);
      expect(must(setVertexLabel(a, 'v1', 'X'))).toBe(a);
      expect(must(setVertexLabel(a, 'v1', 'Y')).vertices[0]!.label).toBe('Y');
    });
  });
});

describe('setEdgeWeight', () => {
  // e1 (v1-v2) peso 5, e2 (v2-v3) peso 0, e3 (v1-v3) sem peso.
  const mixed = (() => {
    let graph = withVertices(3);
    graph = connect(graph, 'v1', 'v2', 5);
    graph = connect(graph, 'v2', 'v3', 0);
    return connect(graph, 'v1', 'v3');
  })();

  const weightOf = (graph: typeof mixed, edgeId: string) => getEdge(graph, edgeId)!.weight;

  describe('definir e redefinir', () => {
    it.each([
      ['positivo', 2.5],
      ['zero', 0],
      ['negativo', -3],
      ['muito grande', Number.MAX_VALUE],
      ['muito grande e negativo', -Number.MAX_VALUE],
      ['menor positivo', Number.MIN_VALUE],
    ])('define peso %s em aresta sem peso', (_nome, peso) => {
      expect(weightOf(must(setEdgeWeight(mixed, 'e3', peso)), 'e3')).toBe(peso);
    });

    it('substitui um peso existente', () => {
      expect(weightOf(must(setEdgeWeight(mixed, 'e1', 7)), 'e1')).toBe(7);
      expect(weightOf(must(setEdgeWeight(mixed, 'e1', -1)), 'e1')).toBe(-1);
    });

    it('normaliza -0 para 0', () => {
      const next = must(setEdgeWeight(mixed, 'e3', -0));

      expect(Object.is(weightOf(next, 'e3'), 0)).toBe(true);
    });
  });

  describe('remover o peso (undefined) × peso zero', () => {
    it('undefined remove o campo, e a aresta volta a ser não ponderada', () => {
      const next = must(setEdgeWeight(mixed, 'e1', undefined));

      expect(getEdge(next, 'e1')).toEqual({ id: 'e1', source: 'v1', target: 'v2' });
      expect(getEdge(next, 'e1')).not.toHaveProperty('weight');
    });

    it('remover um peso zero também deixa a aresta sem peso', () => {
      const next = must(setEdgeWeight(mixed, 'e2', undefined));

      expect(getEdge(next, 'e2')).not.toHaveProperty('weight');
      expect(weightOf(next, 'e2')).toBeUndefined();
    });

    it('peso zero é um peso, não ausência de peso', () => {
      const comZero = must(setEdgeWeight(mixed, 'e3', 0));

      expect(getEdge(comZero, 'e3')).toHaveProperty('weight', 0);
      expect(getEdge(comZero, 'e3')).not.toEqual(getEdge(mixed, 'e3'));
    });

    it('sequência de remoções e redefinições, sempre distinguindo 0 de ausente', () => {
      let graph = mixed;
      const passos: [number | undefined, boolean][] = [
        [undefined, false], // sem peso
        [0, true], // peso zero
        [undefined, false], // sem peso de novo
        [9, true],
        [0, true],
      ];
      for (const [peso, temPeso] of passos) {
        graph = must(setEdgeWeight(graph, 'e1', peso));
        expect('weight' in getEdge(graph, 'e1')!).toBe(temPeso);
        expect(weightOf(graph, 'e1')).toBe(peso);
      }
    });
  });

  describe('pesos inválidos', () => {
    const invalidos: [string, unknown][] = [
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['texto', '3'],
      ['null (não remove: só undefined remove)', null],
      ['objeto', {}],
      ['booleano', true],
    ];

    it.each(invalidos)('rejeita %s com INVALID_WEIGHT', (_nome, peso) => {
      const antes = JSON.stringify(mixed);

      expect(errorOf(setEdgeWeight(mixed, 'e1', peso as number))).toEqual({
        code: 'INVALID_WEIGHT',
        weight: peso,
      });
      expect(JSON.stringify(mixed)).toBe(antes);
    });
  });

  describe('aresta inexistente', () => {
    it('falha com EDGE_NOT_FOUND', () => {
      expect(errorOf(setEdgeWeight(mixed, 'e9', 1))).toEqual({
        code: 'EDGE_NOT_FOUND',
        edgeId: 'e9',
      });
      expect(errorOf(setEdgeWeight(withVertices(2), 'e1', 1)).code).toBe('EDGE_NOT_FOUND');
    });

    it('aresta inexistente vence peso inválido', () => {
      expect(errorOf(setEdgeWeight(mixed, 'e9', Number.NaN)).code).toBe('EDGE_NOT_FOUND');
    });

    it('uma aresta removida não pode mais receber peso', () => {
      const semE1 = must(removeEdge(mixed, 'e1'));

      expect(errorOf(setEdgeWeight(semE1, 'e1', 1)).code).toBe('EDGE_NOT_FOUND');
    });
  });

  describe('estrutura preservada', () => {
    it('mantém ids, extremos, ordem, vértices, orientação e contadores', () => {
      const next = must(setEdgeWeight(mixed, 'e2', 9));

      expect(next.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
      expect(next.edges.map((e) => [e.source, e.target])).toEqual(
        mixed.edges.map((e) => [e.source, e.target]),
      );
      expect(next.edges[0]).toBe(mixed.edges[0]);
      expect(next.edges[2]).toBe(mixed.edges[2]);
      // Todo o resto do grafo (vértices, orientação, contadores, nome) fica idêntico.
      expect({ ...next, edges: [] }).toEqual({ ...mixed, edges: [] });
    });

    it('mantém a orientação dos arcos em grafo orientado', () => {
      let directed = withVertices(2, true);
      directed = connect(directed, 'v1', 'v2', 1);
      directed = connect(directed, 'v2', 'v1', 2);

      const next = must(setEdgeWeight(directed, 'e1', 10));

      expect(next.directed).toBe(true);
      expect(findEdge(next, 'v1', 'v2')).toEqual({ id: 'e1', source: 'v1', target: 'v2', weight: 10 });
      expect(findEdge(next, 'v2', 'v1')).toEqual({ id: 'e2', source: 'v2', target: 'v1', weight: 2 });
    });

    it('funciona em aresta recém-criada e não atrapalha novas arestas', () => {
      const criada = must(addEdge(withVertices(3), { source: 'v1', target: 'v2' }));
      const ponderada = must(setEdgeWeight(criada.graph, criada.edge.id, 4));
      const proxima = must(addEdge(ponderada, { source: 'v2', target: 'v3' }));

      expect(weightOf(ponderada, 'e1')).toBe(4);
      expect(proxima.edge.id).toBe('e2');
    });
  });

  describe('sem mudança', () => {
    it('devolve o mesmo grafo quando o peso não muda', () => {
      expect(must(setEdgeWeight(mixed, 'e1', 5))).toBe(mixed); // mesmo peso
      expect(must(setEdgeWeight(mixed, 'e2', 0))).toBe(mixed); // mesmo zero
      expect(must(setEdgeWeight(mixed, 'e2', -0))).toBe(mixed); // -0 equivale a 0
      expect(must(setEdgeWeight(mixed, 'e3', undefined))).toBe(mixed); // já sem peso
    });
  });

  describe('imutabilidade e determinismo', () => {
    it('não altera o grafo de entrada (entradas congeladas)', () => {
      const antes = JSON.stringify(mixed);

      must(setEdgeWeight(mixed, 'e1', 99));
      must(setEdgeWeight(mixed, 'e1', undefined));
      setEdgeWeight(mixed, 'e9', 1);

      expect(JSON.stringify(mixed)).toBe(antes);
    });

    it('é determinístico e idempotente; vale o último peso', () => {
      const a = must(setEdgeWeight(mixed, 'e3', 3));
      const b = must(setEdgeWeight(mixed, 'e3', 3));

      expect(a).toEqual(b);
      expect(must(setEdgeWeight(a, 'e3', 3))).toBe(a);
      expect(weightOf(must(setEdgeWeight(a, 'e3', 8)), 'e3')).toBe(8);
    });
  });
});
