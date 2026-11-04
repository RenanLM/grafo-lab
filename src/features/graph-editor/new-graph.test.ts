import { buildNewGraph } from './new-graph';

describe('buildNewGraph', () => {
  it('grafo não orientado: vazio, com id próprio e o nome da orientação', () => {
    const graph = buildNewGraph(false, 1);

    expect(graph).toStrictEqual({
      schemaVersion: 1,
      id: 'novo-grafo-1',
      name: 'Novo grafo não orientado',
      directed: false,
      vertices: [],
      edges: [],
      nextVertexSeq: 1,
      nextEdgeSeq: 1,
    });
  });

  it('grafo orientado: vazio e orientado', () => {
    const graph = buildNewGraph(true, 2);

    expect(graph).toMatchObject({ id: 'novo-grafo-2', name: 'Novo grafo orientado', directed: true, vertices: [], edges: [] });
  });

  it('cada número dá um id diferente, e a mesma entrada dá sempre o mesmo grafo (sem relógio nem sorteio)', () => {
    expect(buildNewGraph(false, 1).id).not.toBe(buildNewGraph(false, 2).id);
    expect(buildNewGraph(true, 7)).toStrictEqual(buildNewGraph(true, 7));
    expect(buildNewGraph(true, 7)).not.toBe(buildNewGraph(true, 7));
  });
});
