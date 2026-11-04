import { fail } from '@/domain/graph';

import { buildExampleGraph } from './example-graph';

// Se uma operação do domínio falhar durante a montagem do exemplo, o erro volta no `Result` (nada lança, nada fica pela metade).
// O domínio é substituído por um envoltório que delega ao real e falha na chamada pedida.

jest.mock('@/domain/graph', () => {
  const actual = jest.requireActual('@/domain/graph');
  return { ...actual, addVertex: jest.fn(actual.addVertex), addEdge: jest.fn(actual.addEdge) };
});

const { addEdge, addVertex } = jest.requireMock('@/domain/graph') as {
  addEdge: jest.Mock;
  addVertex: jest.Mock;
};

afterEach(() => {
  addVertex.mockClear();
  addEdge.mockClear();
});

describe('buildExampleGraph: falhas do domínio', () => {
  it('sem falhas, o exemplo é construído (o envoltório delega ao domínio real)', () => {
    expect(buildExampleGraph().ok).toBe(true);
    expect(addVertex).toHaveBeenCalledTimes(4);
    expect(addEdge).toHaveBeenCalledTimes(4);
  });

  it('uma falha ao criar o 3º vértice devolve o erro do domínio e para: nenhuma aresta é tentada', () => {
    const erro = { code: 'INVALID_VERTEX_LABEL', label: 'C', reason: 'EMPTY' } as const;
    const real = addVertex.getMockImplementation()!;
    addVertex.mockImplementationOnce(real).mockImplementationOnce(real).mockImplementationOnce(() => fail(erro));
    const resultado = buildExampleGraph();

    expect(resultado).toStrictEqual({ ok: false, error: erro });
    expect(addVertex).toHaveBeenCalledTimes(3);
    expect(addEdge).not.toHaveBeenCalled();
  });

  it('uma falha ao criar a 3ª aresta devolve o erro do domínio, sem tentar a 4ª', () => {
    const erro = { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } as const;
    const real = addEdge.getMockImplementation()!;
    addEdge.mockImplementationOnce(real).mockImplementationOnce(real).mockImplementationOnce(() => fail(erro));
    const resultado = buildExampleGraph();

    expect(resultado).toStrictEqual({ ok: false, error: erro });
    expect(addEdge).toHaveBeenCalledTimes(3);
  });
});
