import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';
import * as domain from '@/domain/graph';

import { REPRESENTATION_KINDS, buildRepresentationView, type RepresentationKind } from './index';

// QUANTO se calcula (ver representation-view.ts): `buildRepresentationView` chama SÓ a função do domínio da representação pedida, e uma matriz acima do limite de legibilidade nem é montada.
// O domínio é embrulhado em espiões que repassam a chamada real, num arquivo à parte para o `jest.mock` não afetar os outros testes do adaptador.

jest.mock('@/domain/graph', () => {
  const actual = jest.requireActual<typeof import('@/domain/graph')>('@/domain/graph');
  return {
    ...actual,
    adjacencyList: jest.fn(actual.adjacencyList),
    adjacencyMatrix: jest.fn(actual.adjacencyMatrix),
    incidenceMatrix: jest.fn(actual.incidenceMatrix),
    incidenceList: jest.fn(actual.incidenceList),
  };
});

const spies: Readonly<Record<RepresentationKind, jest.Mock>> = {
  'adjacency-list': domain.adjacencyList as unknown as jest.Mock,
  'adjacency-matrix': domain.adjacencyMatrix as unknown as jest.Mock,
  'incidence-matrix': domain.incidenceMatrix as unknown as jest.Mock,
  'incidence-list': domain.incidenceList as unknown as jest.Mock,
};

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function graphWith(vertexCount: number, edgeCount = 1): Graph {
  let graph = createGraph({ id: 'g', directed: true });
  for (let i = 0; i < vertexCount; i++) graph = must(addVertex(graph)).graph;
  for (let k = 0; k < edgeCount; k++) graph = must(addEdge(graph, { source: `v${(k % (vertexCount - 1)) + 1}`, target: `v${vertexCount}` })).graph;
  return graph;
}

const callCounts = (): Record<RepresentationKind, number> => ({
  'adjacency-list': spies['adjacency-list'].mock.calls.length,
  'adjacency-matrix': spies['adjacency-matrix'].mock.calls.length,
  'incidence-matrix': spies['incidence-matrix'].mock.calls.length,
  'incidence-list': spies['incidence-list'].mock.calls.length,
});

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe('só a representação pedida é calculada', () => {
  it.each(REPRESENTATION_KINDS)('%s: chama a própria função do domínio uma vez e nenhuma das outras três', (kind) => {
    buildRepresentationView(graphWith(4, 2), kind);

    const expected = { 'adjacency-list': 0, 'adjacency-matrix': 0, 'incidence-matrix': 0, 'incidence-list': 0 };
    expect(callCounts()).toStrictEqual({ ...expected, [kind]: 1 });
  });

  it('o grafo vazio não chama o domínio (não há o que calcular)', () => {
    for (const kind of REPRESENTATION_KINDS) buildRepresentationView(createGraph({ id: 'g' }), kind);

    expect(callCounts()).toStrictEqual({ 'adjacency-list': 0, 'adjacency-matrix': 0, 'incidence-matrix': 0, 'incidence-list': 0 });
  });
});

describe('uma matriz grande demais NÃO é materializada', () => {
  it('adjacência: 20 × 20 (400 células) é calculada; 21 × 21 (441) não chama o domínio', () => {
    buildRepresentationView(graphWith(20), 'adjacency-matrix');
    expect(spies['adjacency-matrix']).toHaveBeenCalledTimes(1);

    spies['adjacency-matrix'].mockClear();
    const view = buildRepresentationView(graphWith(21), 'adjacency-matrix');
    expect(view.status).toBe('too-large');
    expect(spies['adjacency-matrix']).not.toHaveBeenCalled();
  });

  it('incidência: V × E acima do limite não chama o domínio, e o limite configurável vale', () => {
    const graph = graphWith(5, 4); // 5 × 4 = 20 células
    expect(buildRepresentationView(graph, 'incidence-matrix', { maxMatrixCells: 19 }).status).toBe('too-large');
    expect(spies['incidence-matrix']).not.toHaveBeenCalled();

    expect(buildRepresentationView(graph, 'incidence-matrix', { maxMatrixCells: 20 }).status).toBe('ready');
    expect(spies['incidence-matrix']).toHaveBeenCalledTimes(1);
  });

  it('as listas nunca são barradas pelo limite de matriz', () => {
    buildRepresentationView(graphWith(40, 30), 'adjacency-list', { maxMatrixCells: 0 });
    buildRepresentationView(graphWith(40, 30), 'incidence-list', { maxMatrixCells: 0 });

    expect(spies['adjacency-list']).toHaveBeenCalledTimes(1);
    expect(spies['incidence-list']).toHaveBeenCalledTimes(1);
  });
});
