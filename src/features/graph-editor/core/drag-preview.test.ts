import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import * as geometry from './geometry';
import {
  NEUTRAL_CAMERA,
  buildDragPreview,
  buildGraphScene,
  emptyLayout,
  moveVertex,
  placeVertex,
  planDragPreview,
  removePosition,
  worldToScreen,
  type Camera,
  type GraphLayout,
  type GraphScene,
  type Point,
} from './index';
import { seededRandom } from './test-helpers';

// Prévia do arrasto (ver drag-preview.ts). O oráculo é a cena definitiva: para qualquer grafo, câmera e posição, a prévia do vértice e das
// arestas dele tem que ser IGUAL ao que `buildGraphScene` desenha depois de mover o vértice no layout. Além disso, os casos feitos à mão
// (arestas, setas, pesos, arcos opostos) e o custo: Θ(grau), uma geometria por aresta incidente e nenhuma da cena inteira.

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type World = {
  graph: Graph;
  layout: GraphLayout;
};

/** Vértices v1, v2… nas posições dadas; arestas por índice (1-based) com peso opcional. */
function worldOf(
  vertices: readonly (readonly [number, number])[],
  edges: readonly (readonly [number, number] | readonly [number, number, number])[] = [],
  directed = false,
): World {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  for (const edge of edges) {
    const [source, target, weight] = edge as readonly [number, number, number | undefined];
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, weight })).graph;
  }
  return { graph, layout };
}

const sceneOf = (world: World, camera: Camera = NEUTRAL_CAMERA): GraphScene => {
  const scene = buildGraphScene(world.graph, world.layout, camera, { viewport: VIEWPORT });
  if (scene === undefined) throw new Error('esperava uma cena');
  return scene;
};

function planOf(world: World, vertexId: string, camera: Camera = NEUTRAL_CAMERA) {
  const plan = planDragPreview(world.graph, world.layout, sceneOf(world, camera), camera, vertexId, { viewport: VIEWPORT });
  if (plan === undefined) throw new Error('esperava um plano');
  return plan;
}

/** A cena definitiva depois de mover o vértice: o que a prévia precisa igualar. */
function afterMove(world: World, vertexId: string, position: Point, camera: Camera = NEUTRAL_CAMERA) {
  const moved = moveVertex(world.layout, vertexId, position);
  const scene = buildGraphScene(world.graph, moved, camera, { viewport: VIEWPORT })!;
  return {
    vertex: scene.vertices.find((vertex) => vertex.id === vertexId),
    edges: scene.edges.filter((edge) => edge.sourceId === vertexId || edge.targetId === vertexId),
  };
}

describe('planDragPreview e buildDragPreview: a prévia é a cena definitiva do vértice e das arestas dele', () => {
  it('aresta reta: o traço vai de borda a borda e acompanha o vértice; o outro extremo fica onde estava (conta feita à mão)', () => {
    // v1 (100, 100) e v2 (300, 100), raio 20. Arrastar v1 para (100, 200): a reta vai de v1 (100, 200) até v2 (300, 100).
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const preview = buildDragPreview(planOf(world, 'v1'), point(100, 200))!;
    const [edge] = preview.edges;
    const length = Math.hypot(200, 100);
    const ux = 200 / length;
    const uy = -100 / length;

    expect(preview.vertex.center).toStrictEqual({ x: 100, y: 200 });
    expect(edge!.path).toMatchObject({ kind: 'line' });
    expect(edge!.path.from.x).toBeCloseTo(100 + ux * 20, 9);
    expect(edge!.path.from.y).toBeCloseTo(200 + uy * 20, 9);
    expect(edge!.path.to.x).toBeCloseTo(300 - ux * 20, 9);
    expect(edge!.path.to.y).toBeCloseTo(100 - uy * 20, 9);
  });

  it('o vértice e a aresta da prévia são iguais aos da cena reconstruída depois de mover (câmera neutra, com peso)', () => {
    const world = worldOf([[100, 100], [300, 100], [200, 250]], [[1, 2, 2.5], [2, 3], [1, 3, 0]]);
    const position = point(120, 40);
    const preview = buildDragPreview(planOf(world, 'v1'), position)!;
    const expected = afterMove(world, 'v1', position);

    expect(preview.vertex).toStrictEqual(expected.vertex);
    expect(preview.edges).toStrictEqual(expected.edges);
    expect(preview.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e3']); // e2 (v2—v3) não é do vértice
  });

  it('o rótulo e o raio vêm do vértice da cena; só o centro e a visibilidade mudam', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const scene = sceneOf(world);
    const preview = buildDragPreview(planOf(world, 'v1'), point(5000, 5000))!;
    const base = scene.vertices[0]!;

    expect(preview.vertex).toStrictEqual({ ...base, center: { x: 5000, y: 5000 }, visible: false });
    expect(base.center).toStrictEqual({ x: 100, y: 100 }); // a cena original não foi tocada
  });

  it('em grafo orientado a seta continua apontando para o DESTINO: a ponta fica na borda do destino, nos dois sentidos de arrasto', () => {
    // v1 → v2. Arrastar a origem (v1) e arrastar o destino (v2): a ponta da seta é sempre path.to, a um raio do centro do destino.
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]], true);
    for (const [vertexId, position, targetCenter] of [
      ['v1', point(150, 220), point(300, 100)],
      ['v2', point(260, 20), point(260, 20)],
    ] as const) {
      const [edge] = buildDragPreview(planOf(world, vertexId), position)!.edges;

      expect(edge!.arrow).toBeDefined();
      expect(edge!.arrow!.tip).toStrictEqual(edge!.path.to);
      expect(Math.hypot(edge!.arrow!.tip.x - targetCenter.x, edge!.arrow!.tip.y - targetCenter.y)).toBeCloseTo(20, 9);
      expect(edge!.sourceId).toBe('v1'); // origem e destino do grafo não mudam
      expect(edge!.targetId).toBe('v2');
    }
  });

  it('arcos opostos A → B e B → A: as duas arestas são curvas e ficam em lados OPOSTOS da reta entre os centros, em qualquer posição', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2], [2, 1]], true);
    const plan = planOf(world, 'v1');
    const side = (control: Point, a: Point, b: Point) => Math.sign((b.x - a.x) * (control.y - a.y) - (b.y - a.y) * (control.x - a.x));

    for (const position of [point(100, 100), point(60, 220), point(140, 20), point(0, 100)]) {
      const preview = buildDragPreview(plan, position)!;
      const [forward, backward] = preview.edges;

      expect(preview.edges).toHaveLength(2);
      expect(forward!.path.kind).toBe('quadratic');
      expect(backward!.path.kind).toBe('quadratic');
      const a = position;
      const b = point(300, 100);
      const sides = [side((forward!.path as { control: Point }).control, a, b), side((backward!.path as { control: Point }).control, a, b)];
      expect(sides[0]).not.toBe(0);
      expect(sides[0]).toBe(-sides[1]!);
      expect(preview.edges).toStrictEqual(afterMove(world, 'v1', position).edges);
    }
  });

  it('o peso acompanha a aresta: a âncora é o ponto médio do traço e o texto não muda (2,5 → "2,5"; 0 → "0")', () => {
    const world = worldOf([[100, 100], [300, 100], [200, 250]], [[1, 2, 2.5], [1, 3, 0], [2, 3]]);
    const preview = buildDragPreview(planOf(world, 'v1'), point(80, 180))!;
    const [first, second] = preview.edges;

    expect(first!.weight!.text).toBe('2,5');
    expect(second!.weight!.text).toBe('0');
    for (const edge of preview.edges) {
      expect(edge.weight!.anchor.x).toBeCloseTo((edge.path.from.x + edge.path.to.x) / 2, 9);
      expect(edge.weight!.anchor.y).toBeCloseTo((edge.path.from.y + edge.path.to.y) / 2, 9);
    }
    expect(preview.edges).toStrictEqual(afterMove(world, 'v1', point(80, 180)).edges);
  });

  it('aresta sem peso não ganha o campo weight', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);

    expect(buildDragPreview(planOf(world, 'v1'), point(100, 160))!.edges[0]).not.toHaveProperty('weight');
  });

  it('os outros vértices e as arestas não relacionadas ficam fora da prévia (a camada estática os desenha)', () => {
    const world = worldOf([[100, 100], [300, 100], [200, 250], [320, 260]], [[1, 2], [2, 3], [3, 4]]);
    const preview = buildDragPreview(planOf(world, 'v2'), point(310, 40))!;

    expect(preview.vertex.id).toBe('v2');
    expect(preview.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2']);
    expect([...preview.hiddenEdgeIds]).toStrictEqual(['e1', 'e2']);
  });

  it('o conjunto de arestas ocultas é O MESMO objeto em toda atualização do arrasto (só muda no começo e no fim)', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const plan = planOf(world, 'v1');

    expect(buildDragPreview(plan, point(90, 90))!.hiddenEdgeIds).toBe(buildDragPreview(plan, point(10, 10))!.hiddenEdgeIds);
    expect(buildDragPreview(plan, point(90, 90))!.hiddenEdgeIds).toBe(plan.hiddenEdgeIds);
  });

  it('vértice isolado: nenhuma aresta na prévia, e nada a ocultar', () => {
    const world = worldOf([[100, 100], [300, 100]]);
    const preview = buildDragPreview(planOf(world, 'v1'), point(150, 150))!;

    expect(preview.edges).toStrictEqual([]);
    expect(preview.hiddenEdgeIds.size).toBe(0);
    expect(preview.vertex.isolated).toBe(true);
  });

  it('aresta sem geometria (os círculos se tocam) some da prévia e volta ao afastar, como na cena definitiva', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const plan = planOf(world, 'v1');

    expect(buildDragPreview(plan, point(290, 100))!.edges).toStrictEqual([]); // a 10 dp de v2: 10 ≤ 2·raio
    expect(buildDragPreview(plan, point(250, 100))!.edges).toHaveLength(1); // a 50 dp: 50 > 40
    expect(buildDragPreview(plan, point(290, 100))!.edges).toStrictEqual(afterMove(world, 'v1', point(290, 100)).edges);
    expect([...plan.hiddenEdgeIds]).toStrictEqual(['e1']); // a camada estática nunca a desenha durante o arrasto
  });

  it('uma aresta que já não tinha geometria no começo (vértices sobrepostos) aparece quando o arrasto os separa', () => {
    const world = worldOf([[100, 100], [110, 100]], [[1, 2]]);
    const plan = planOf(world, 'v1');

    expect(sceneOf(world).edges).toHaveLength(0);
    expect(buildDragPreview(plan, point(100, 100))!.edges).toHaveLength(0);
    expect(buildDragPreview(plan, point(10, 100))!.edges).toHaveLength(1);
  });

  it('a outra ponta sem posição: a aresta não tem geometria (como na cena) e a prévia não quebra', () => {
    const world = worldOf([[100, 100], [300, 100], [200, 250]], [[1, 2], [1, 3]]);
    const broken = { graph: world.graph, layout: removePosition(world.layout, 'v3') };
    const scene = buildGraphScene(broken.graph, broken.layout, NEUTRAL_CAMERA, { viewport: VIEWPORT })!;
    const plan = planDragPreview(broken.graph, broken.layout, scene, NEUTRAL_CAMERA, 'v1', { viewport: VIEWPORT })!;
    const preview = buildDragPreview(plan, point(110, 90))!;

    expect(preview.edges.map((edge) => edge.id)).toStrictEqual(['e1']);
  });

  it('posição não finita: undefined (nada é desenhado), sem lançar', () => {
    const plan = planOf(worldOf([[100, 100], [300, 100]], [[1, 2]]), 'v1');

    expect(buildDragPreview(plan, point(NaN, 0))).toBeUndefined();
    expect(buildDragPreview(plan, point(Infinity, 0))).toBeUndefined();
  });

  it('o plano é undefined para layout ou cena de OUTRO grafo, ou para vértice fora da cena', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const scene = sceneOf(world);
    const other = worldOf([[100, 100]]);
    const otherGraph = { ...other.graph, id: 'outro' };

    expect(planDragPreview(otherGraph, world.layout, scene, NEUTRAL_CAMERA, 'v1')).toBeUndefined(); // layout é de 'g'
    expect(planDragPreview(world.graph, world.layout, { ...scene, graphId: 'outro' }, NEUTRAL_CAMERA, 'v1')).toBeUndefined();
    expect(planDragPreview(world.graph, world.layout, scene, NEUTRAL_CAMERA, 'v9')).toBeUndefined();
  });

  it('com zoom e translação (câmera {40, −30, 2}) a prévia ainda é a cena definitiva em dp de tela', () => {
    const camera = { x: 40, y: -30, scale: 2 };
    const world = worldOf([[60, 60], [200, 60], [130, 200]], [[1, 2, 3], [1, 3]]);
    const position = point(75, 50);
    const preview = buildDragPreview(planOf(world, 'v1', camera), position)!;
    const expected = afterMove(world, 'v1', position, camera);

    expect(preview.vertex.center).toStrictEqual(worldToScreen(camera, position));
    expect(preview.vertex).toStrictEqual(expected.vertex);
    expect(preview.edges).toStrictEqual(expected.edges);
    expect(preview.vertex.radius).toBe(40); // 20 · 2
  });

  it('300 sorteios com semente fixa (grafos orientados e não orientados, arcos opostos, pesos, sete câmeras): a prévia sempre é a cena reconstruída', () => {
    const random = seededRandom(20260514);
    const between = (min: number, max: number) => min + random() * (max - min);
    const cameras: Camera[] = [
      NEUTRAL_CAMERA,
      { x: 0, y: 0, scale: 0.25 },
      { x: 0, y: 0, scale: 4 },
      { x: 40, y: -30, scale: 2 },
      { x: -120, y: 75, scale: 0.25 },
      { x: 200, y: -50, scale: 4 },
      { x: -5.5, y: 12.25, scale: 1.5 },
    ];
    for (let round = 0; round < 300; round++) {
      const count = 2 + Math.floor(random() * 7);
      const directed = random() < 0.5;
      const vertices = Array.from({ length: count }, () => [Math.round(between(-100, 400)), Math.round(between(-100, 400))] as const);
      const wanted: ([number, number] | [number, number, number])[] = [];
      for (let k = 0; k < count * 2; k++) {
        const a = 1 + Math.floor(random() * count);
        const b = 1 + Math.floor(random() * count);
        if (a === b) continue;
        const duplicate = wanted.some(([x, y]) => (x === a && y === b) || (!directed && x === b && y === a));
        if (!duplicate) wanted.push(random() < 0.4 ? [a, b, Math.round(between(-9, 9) * 10) / 10] : [a, b]);
      }
      const world = worldOf(vertices, wanted, directed);
      const camera = cameras[round % cameras.length]!;
      const vertexId = `v${1 + Math.floor(random() * count)}`;
      const plan = planOf(world, vertexId, camera);
      for (let step = 0; step < 4; step++) {
        const position = point(between(-300, 600), between(-300, 600));
        const preview = buildDragPreview(plan, position)!;
        const expected = afterMove(world, vertexId, position, camera);

        expect(preview.vertex).toStrictEqual(expected.vertex);
        expect(preview.edges).toStrictEqual(expected.edges);
      }
    }
  });
});

describe('buildDragPreview: custo e imutabilidade', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uma geometria por aresta incidente (Θ(grau)); a geometria da cena inteira nunca é refeita durante o arrasto', () => {
    const edges: [number, number][] = [];
    for (let k = 2; k <= 40; k++) edges.push([1, k]); // estrela: v1 tem grau 39
    for (let k = 2; k < 40; k++) edges.push([k, k + 1]); // e mais 38 arestas que NÃO são de v1
    const vertices = Array.from({ length: 40 }, (_, i) => [200 + 150 * Math.cos(i), 200 + 150 * Math.sin(i)] as const);
    const world = worldOf(vertices, edges);
    const plan = planOf(world, 'v1');
    const between = jest.spyOn(geometry, 'edgeGeometryBetween');
    const all = jest.spyOn(geometry, 'edgeGeometries');
    const one = jest.spyOn(geometry, 'edgeGeometry');

    for (let i = 0; i < 10; i++) buildDragPreview(plan, point(150 + i * 3, 210));

    expect(plan.incident).toHaveLength(39);
    expect(between).toHaveBeenCalledTimes(10 * 39);
    expect(all).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
  });

  it('não altera o grafo, o layout, a cena nem o plano, e é determinística', () => {
    const world = worldOf([[100, 100], [300, 100], [200, 250]], [[1, 2, 1], [2, 1, 2], [1, 3]], true);
    const scene = sceneOf(world);
    const sceneBefore = JSON.stringify(scene);
    const graphBefore = JSON.stringify(world.graph);
    const layoutBefore = JSON.stringify(world.layout);
    const plan = planOf(world, 'v1');
    const hidden = [...plan.hiddenEdgeIds];
    const a = buildDragPreview(plan, point(120, 60))!;
    const b = buildDragPreview(plan, point(120, 60))!;

    expect(a).toStrictEqual(b);
    expect(a.vertex).not.toBe(b.vertex);
    expect(JSON.stringify(scene)).toBe(sceneBefore);
    expect(JSON.stringify(world.graph)).toBe(graphBefore);
    expect(JSON.stringify(world.layout)).toBe(layoutBefore);
    expect([...plan.hiddenEdgeIds]).toStrictEqual(hidden);
  });

  it('o plano não guarda alias da câmera recebida', () => {
    const world = worldOf([[100, 100], [300, 100]], [[1, 2]]);
    const camera = { x: 0, y: 0, scale: 1 };
    const plan = planDragPreview(world.graph, world.layout, sceneOf(world, camera), camera, 'v1')!;
    camera.scale = 99;

    expect(plan.camera.scale).toBe(1);
  });
});
