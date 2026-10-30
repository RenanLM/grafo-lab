import * as api from './index';
import {
  createGraph,
  fail,
  ok,
  parseGraph,
  parseGraphJson,
  serializeGraph,
  type DocumentCause,
  type Graph,
  type GraphError,
  type InvalidDocumentReason,
  type InvalidLabelReason,
  type ParseGraphOptions,
  type Result,
  type SerializeOptions,
} from './index';
import { connect, errorOf, must, withVertices } from './test-helpers';

// Superfície pública do domínio de grafos (`index.ts`). Mudar qualquer lista abaixo é mudar o contrato com a
// camada de estado e a interface: precisa ser uma decisão explícita (e registrada no ROADMAP/ARCHITECTURE).
// Os tipos não existem em tempo de execução; os `satisfies` abaixo são conferidos pelo `tsc` (`npm run check`).

describe('nomes exportados por index.ts', () => {
  // Valores (funções e constantes), em ordem alfabética.
  const VALORES = [
    'GRAPH_SCHEMA_VERSION',
    'MAX_VERTEX_LABEL_LENGTH',
    'addEdge',
    'addVertex',
    'adjacencyAsNumbers',
    'adjacencyList',
    'adjacencyMatrix',
    'createGraph',
    'degree',
    'fail',
    'findEdge',
    'getEdge',
    'getVertex',
    'inDegree',
    'incidenceList',
    'incidenceMatrix',
    'isIsolated',
    'isolatedVertices',
    'neighbors',
    'ok',
    'order',
    'outDegree',
    'parseGraph',
    'parseGraphJson',
    'predecessors',
    'removeEdge',
    'removeVertex',
    'serializeGraph',
    'setEdgeWeight',
    'setVertexLabel',
    'size',
    'successors',
  ];

  it('são exatamente estes (nenhum a mais, nenhum a menos)', () => {
    expect(Object.keys(api).sort()).toStrictEqual(VALORES);
  });

  it('helpers internos continuam privados', () => {
    for (const interno of ['weightField', 'isValidWeight', 'normalizeWeight', 'checkLabel', 'readGolden', 'must']) {
      expect(api).not.toHaveProperty(interno);
    }
  });

  it('são funções, exceto as duas constantes', () => {
    for (const nome of VALORES) {
      const valor = (api as Record<string, unknown>)[nome];
      if (nome === 'GRAPH_SCHEMA_VERSION' || nome === 'MAX_VERTEX_LABEL_LENGTH') expect(typeof valor).toBe('number');
      else expect(typeof valor).toBe('function');
    }
    expect(api.GRAPH_SCHEMA_VERSION).toBe(1);
    expect(api.MAX_VERTEX_LABEL_LENGTH).toBe(64);
  });
});

describe('assinaturas das APIs de persistência', () => {
  // Atribuições conferidas só em tempo de compilação: se a assinatura mudar de forma incompatível, o `tsc` falha.
  const assinaturas = {
    serializeGraph: serializeGraph satisfies (graph: Graph, options?: SerializeOptions) => string,
    parseGraph: parseGraph satisfies (input: unknown, options?: ParseGraphOptions) => Result<Graph>,
    parseGraphJson: parseGraphJson satisfies (text: string, options?: ParseGraphOptions) => Result<Graph>,
  };

  it('opções são sempre opcionais e as três funções devolvem texto ou Result, nunca lançam', () => {
    const graph = connect(withVertices(2), 'v1', 'v2', 0);
    const texto = assinaturas.serializeGraph(graph);

    expect(typeof texto).toBe('string');
    expect(assinaturas.parseGraph(JSON.parse(texto))).toStrictEqual({ ok: true, value: graph });
    expect(assinaturas.parseGraphJson(texto)).toStrictEqual({ ok: true, value: graph });
    expect(assinaturas.parseGraphJson('{')).toStrictEqual({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', path: '', reason: 'INVALID_JSON' },
    });
  });
});

describe('vocabulário de erros', () => {
  // `satisfies Record<…, true>` falha na compilação se um código ou motivo for acrescentado ou removido sem
  // atualizar esta lista.
  const CODIGOS = {
    VERTEX_NOT_FOUND: true,
    EDGE_NOT_FOUND: true,
    SELF_LOOP: true,
    DUPLICATE_EDGE: true,
    INVALID_WEIGHT: true,
    INVALID_VERTEX_LABEL: true,
    INVALID_DOCUMENT: true,
    UNSUPPORTED_SCHEMA_VERSION: true,
  } satisfies Record<GraphError['code'], true>;
  const MOTIVOS_DE_DOCUMENTO = {
    INVALID_JSON: true,
    NOT_AN_OBJECT: true,
    NOT_AN_ARRAY: true,
    SPARSE_ARRAY: true,
    UNREADABLE: true,
    MISSING_FIELD: true,
    UNKNOWN_FIELD: true,
    WRONG_TYPE: true,
    INVALID_ID: true,
    DUPLICATE_ID: true,
    INVALID_COUNTER: true,
    COUNTER_TOO_LOW: true,
    LIMIT_EXCEEDED: true,
    INVALID_OPTION: true,
    DOMAIN_RULE: true,
  } satisfies Record<InvalidDocumentReason, true>;
  const MOTIVOS_DE_ROTULO = { NOT_A_STRING: true, EMPTY: true, TOO_LONG: true } satisfies Record<InvalidLabelReason, true>;
  const CAUSAS = {
    VERTEX_NOT_FOUND: true,
    SELF_LOOP: true,
    DUPLICATE_EDGE: true,
    INVALID_WEIGHT: true,
    INVALID_VERTEX_LABEL: true,
  } satisfies Record<DocumentCause['code'], true>;

  it('os códigos de erro do domínio são estes', () => {
    expect(Object.keys(CODIGOS)).toStrictEqual([
      'VERTEX_NOT_FOUND',
      'EDGE_NOT_FOUND',
      'SELF_LOOP',
      'DUPLICATE_EDGE',
      'INVALID_WEIGHT',
      'INVALID_VERTEX_LABEL',
      'INVALID_DOCUMENT',
      'UNSUPPORTED_SCHEMA_VERSION',
    ]);
    expect(Object.keys(MOTIVOS_DE_DOCUMENTO)).toHaveLength(15);
    expect(Object.keys(MOTIVOS_DE_ROTULO)).toHaveLength(3);
    expect(Object.keys(CAUSAS)).toHaveLength(5);
  });

  it('as causas de documento são códigos de erro do domínio', () => {
    for (const causa of Object.keys(CAUSAS)) expect(CODIGOS).toHaveProperty(causa);
  });

  it('erros reais usam só códigos e motivos do vocabulário', () => {
    const base = withVertices(2);
    const erros: GraphError[] = [
      errorOf(api.addEdge(base, { source: 'v9', target: 'v1' })),
      errorOf(api.removeEdge(base, 'e9')),
      errorOf(api.addEdge(base, { source: 'v1', target: 'v1' })),
      errorOf(api.addEdge(connect(base, 'v1', 'v2'), { source: 'v2', target: 'v1' })),
      errorOf(api.addEdge(base, { source: 'v1', target: 'v2', weight: Number.NaN })),
      errorOf(api.addVertex(base, '')),
      errorOf(parseGraphJson('{')),
      errorOf(parseGraph({ schemaVersion: 2 })),
    ];

    for (const erro of erros) {
      expect(CODIGOS).toHaveProperty(erro.code);
      if (erro.code === 'INVALID_DOCUMENT') expect(MOTIVOS_DE_DOCUMENTO).toHaveProperty(erro.reason);
    }
    expect(new Set(erros.map((e) => e.code)).size).toBe(8);
  });
});

describe('Result', () => {
  it('ok e fail montam os dois formatos, e nenhuma operação do domínio lança', () => {
    expect(ok(1)).toStrictEqual({ ok: true, value: 1 });
    expect(fail({ code: 'SELF_LOOP', vertexId: 'v1' })).toStrictEqual({
      ok: false,
      error: { code: 'SELF_LOOP', vertexId: 'v1' },
    });
    expect(() => api.addEdge(createGraph({ id: 'g' }), { source: 'x', target: 'y' })).not.toThrow();
    expect(must(api.addVertex(createGraph({ id: 'g' }))).vertex.id).toBe('v1');
  });
});
