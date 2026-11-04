import { isolatedVertices, parseGraphJson, serializeGraph } from '@/domain/graph';

import { buildGraphScene, circularLayout, edgeGeometries, fitCameraToGraph } from './core';
import { buildExampleGraph, EXAMPLE_GRAPH_ID } from './example-graph';

function example() {
  const built = buildExampleGraph();
  if (!built.ok) throw new Error(`o exemplo deveria ser construído: ${built.error.code}`);
  return built.value;
}

describe('buildExampleGraph', () => {
  it('monta o grafo orientado de quatro vértices (A, B, C, D) pelas operações do domínio', () => {
    const graph = example();

    expect(graph.id).toBe(EXAMPLE_GRAPH_ID);
    expect(graph.directed).toBe(true);
    expect(graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v3', 'C'], ['v4', 'D']]);
    expect(graph.nextVertexSeq).toBe(5);
    expect(graph.nextEdgeSeq).toBe(5);
  });

  it('as quatro arestas: A → B sem peso, B → A com peso 0, B → C com −2 e C → A com 5', () => {
    const graph = example();

    expect(graph.edges).toStrictEqual([
      { id: 'e1', source: 'v1', target: 'v2' },
      { id: 'e2', source: 'v2', target: 'v1', weight: 0 },
      { id: 'e3', source: 'v2', target: 'v3', weight: -2 },
      { id: 'e4', source: 'v3', target: 'v1', weight: 5 },
    ]);
    expect('weight' in graph.edges[0]!).toBe(false); // sem peso é diferente de peso 0
    expect(graph.edges[1]!.weight).toBe(0);
  });

  it('exercita arcos opostos (A → B e B → A) e deixa D isolado', () => {
    const graph = example();
    const [ida, volta] = graph.edges;

    expect([ida!.source, ida!.target]).toStrictEqual([volta!.target, volta!.source]);
    expect(isolatedVertices(graph)).toStrictEqual(['v4']);
  });

  it('é um grafo válido do domínio: ida e volta pelo JSON v1 devolve o mesmo grafo', () => {
    const graph = example();

    expect(parseGraphJson(serializeGraph(graph))).toStrictEqual({ ok: true, value: graph });
  });

  it('cada chamada devolve um grafo novo e igual (sem estado compartilhado)', () => {
    const a = example();
    const b = example();

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
    expect(a.vertices).not.toBe(b.vertices);
  });

  it('com o layout circular, todas as arestas têm geometria e a cena descreve o grafo', () => {
    const graph = example();
    const layout = circularLayout(graph);
    const viewport = { width: 360, height: 320 };
    const camera = fitCameraToGraph(graph, layout, viewport)!;
    const scene = buildGraphScene(graph, layout, camera, { viewport })!;

    expect(layout.graphId).toBe(EXAMPLE_GRAPH_ID);
    expect(Object.keys(layout.positions)).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
    expect(edgeGeometries(graph, layout)).toHaveLength(4);
    expect(scene.summary).toBe('Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.');
    expect(scene.vertices.every((v) => v.visible)).toBe(true);
    expect(scene.edges.every((e) => e.visible)).toBe(true);
  });
});
