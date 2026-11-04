import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import {
  DEFAULT_LABEL_FONT_SIZE,
  DEFAULT_SCENE_MARGIN,
  DEFAULT_VERTEX_RADIUS,
  NEUTRAL_CAMERA,
  buildGraphScene,
  circularLayout,
  edgeGeometries,
  emptyLayout,
  fitCameraToGraph,
  graphContentBounds,
  hitTestEdge,
  hitTestVertex,
  placeVertex,
  positionOf,
  worldToScreen,
  type Camera,
  type GraphLayout,
  type GraphScene,
  type Point,
} from './index';
import { formatWeight, truncateLabel } from './scene';
import { deepFreeze, seededRandom } from './test-helpers';

// Cena do grafo (ver scene.ts): a descrição visual em dp de tela. Valores esperados calculados à mão.

// ---------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------

const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type EdgeSpec = readonly [source: string, target: string, weight?: number];

function buildGraph(options: { vertices: number; edges?: readonly EdgeSpec[]; directed?: boolean; labels?: readonly string[] }): Graph {
  let graph = createGraph({ id: 'g', directed: options.directed ?? false });
  for (let i = 0; i < options.vertices; i++) graph = must(addVertex(graph, options.labels?.[i])).graph;
  for (const [source, target, weight] of options.edges ?? []) {
    graph = must(addEdge(graph, { source, target, ...(weight !== undefined && { weight }) })).graph;
  }
  return graph;
}

function layoutOf(entries: readonly (readonly [string, number, number])[], graphId = 'g'): GraphLayout {
  return entries.reduce((layout, [id, x, y]) => placeVertex(layout, id, point(x, y)), emptyLayout(graphId));
}

/** Cena de um grafo com camera e opções; falha o teste se a cena for recusada. */
function sceneOf(graph: Graph, layout: GraphLayout, camera: Camera = NEUTRAL_CAMERA, options = {}): GraphScene {
  const scene = buildGraphScene(graph, layout, camera, options);
  if (scene === undefined) throw new Error('cena recusada');
  return scene;
}

function expectPoint(actual: Point | undefined, x: number, y: number, digits = 9): void {
  if (actual === undefined) throw new Error('ponto ausente');
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** O grafo do exemplo da tela, montado à mão: orientado, A→B, B→A (peso 0), B→C (−2), C→A (5) e D isolado. */
function exampleLike(): { graph: Graph; layout: GraphLayout } {
  const graph = buildGraph({
    vertices: 4,
    directed: true,
    edges: [['v1', 'v2'], ['v2', 'v1', 0], ['v2', 'v3', -2], ['v3', 'v1', 5]],
  });
  return { graph, layout: circularLayout(graph) };
}

// ---------------------------------------------------------------------------------------------
// Casos pequenos calculados à mão
// ---------------------------------------------------------------------------------------------

describe('buildGraphScene: valores calculados à mão', () => {
  // v1 em (0,0) e v2 em (100,0), raio 20; câmera (10, 20, escala 2): tela = mundo·2 + (10, 20)
  const graph = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2', 0]] });
  const layout = layoutOf([['v1', 0, 0], ['v2', 100, 0]]);
  const camera: Camera = { x: 10, y: 20, scale: 2 };

  it('vértices: centro = mundo·2 + (10, 20) e raio = 20·2 = 40 (a escala vale UMA vez)', () => {
    const scene = sceneOf(graph, layout, camera);

    expect(scene.vertices.map((v) => [v.id, v.center, v.radius])).toStrictEqual([
      ['v1', { x: 10, y: 20 }, 40],
      ['v2', { x: 210, y: 20 }, 40],
    ]);
    expect(scene.graphId).toBe('g');
    expect(scene.directed).toBe(true);
  });

  it('aresta: traço de (20,0)–(80,0) do mundo vira (50,20)–(170,20) em dp', () => {
    const [edge] = sceneOf(graph, layout, camera).edges;

    expect(edge!.path).toStrictEqual({ kind: 'line', from: { x: 50, y: 20 }, to: { x: 170, y: 20 } });
    expect(edge!.id).toBe(graph.edges[0]!.id);
    expect([edge!.sourceId, edge!.targetId]).toStrictEqual(['v1', 'v2']);
  });

  it('seta: ponta em (170,20) e base em (146,20), com asas em (146,30) e (146,10)', () => {
    const [edge] = sceneOf(graph, layout, camera).edges;

    expect(edge!.arrow).toStrictEqual({
      tip: { x: 170, y: 20 },
      base: { x: 146, y: 20 },
      right: { x: 146, y: 30 },
      left: { x: 146, y: 10 },
    });
  });

  it('peso 0: o texto "0" na âncora (110,20), com a caixa estimada (1 caractere · 14 · 0,6 + 8; 14 + 8)', () => {
    const [edge] = sceneOf(graph, layout, camera).edges;

    expect(edge!.weight).toStrictEqual({ text: '0', anchor: { x: 110, y: 20 }, width: 16.4, height: 22 });
  });

  it('câmera neutra: a cena coincide com a geometria do mundo', () => {
    const scene = sceneOf(graph, layout);

    expect(scene.vertices[0]).toMatchObject({ center: { x: 0, y: 0 }, radius: 20 });
    expect(scene.edges[0]!.path).toStrictEqual({ kind: 'line', from: { x: 20, y: 0 }, to: { x: 80, y: 0 } });
  });

  it('o corpo da fonte é configurável (e inválido vale o padrão)', () => {
    expect(sceneOf(graph, layout, camera).labelFontSize).toBe(DEFAULT_LABEL_FONT_SIZE);
    expect(sceneOf(graph, layout, camera, { labelFontSize: 20 }).labelFontSize).toBe(20);
    for (const invalido of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sceneOf(graph, layout, camera, { labelFontSize: invalido }).labelFontSize).toBe(DEFAULT_LABEL_FONT_SIZE);
    }
  });

  it('as opções de geometria valem: raio 10 dá círculo de 20 dp com escala 2', () => {
    expect(sceneOf(graph, layout, camera, { vertexRadius: 10 }).vertices[0]!.radius).toBe(20);
  });
});

describe('buildGraphScene: orientação, pesos e arcos opostos', () => {
  it('grafo não orientado: nenhuma seta (nem a chave `arrow`)', () => {
    const g = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const scene = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]]));

    expect(scene.directed).toBe(false);
    expect(scene.edges[0]!.arrow).toBeUndefined();
    expect('arrow' in scene.edges[0]!).toBe(false);
  });

  it('a seta aponta para o destino correto: v2 → v1 tem a ponta junto de v1', () => {
    const g = buildGraph({ vertices: 2, directed: true, edges: [['v2', 'v1']] });
    const scene = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]]));
    const { arrow } = scene.edges[0]!;

    expectPoint(arrow!.tip, 20, 0);
    expectPoint(arrow!.base, 32, 0);
  });

  it('peso ausente: sem texto e sem a chave `weight`; peso 0 aparece; negativo e decimal também', () => {
    const g = buildGraph({
      vertices: 5,
      edges: [['v1', 'v2'], ['v1', 'v3', 0], ['v1', 'v4', -2], ['v1', 'v5', 1.5]],
    });
    const scene = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 200, 0], ['v3', 0, 200], ['v4', -200, 0], ['v5', 0, -200]]));
    const texts = scene.edges.map((e) => e.weight?.text);

    expect(texts).toStrictEqual([undefined, '0', '-2', '1,5']);
    expect('weight' in scene.edges[0]!).toBe(false);
  });

  it('formatWeight: inteiros, negativos, decimais com vírgula e notação científica', () => {
    expect([0, 5, -2, 1.5, -0.25, 1e21, 1.5e-7].map(formatWeight)).toStrictEqual(['0', '5', '-2', '1,5', '-0,25', '1e+21', '1,5e-7']);
  });

  it('a âncora do peso está sobre a aresta: no meio da reta e sobre a curva dos arcos opostos', () => {
    const g = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2', 3], ['v2', 'v1', 4]] });
    const [ida, volta] = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]])).edges;

    expectPoint(ida!.weight!.anchor, 50, 20.144958, 5);
    expectPoint(volta!.weight!.anchor, 50, -20.144958, 5);
  });

  it('arcos opostos: duas curvas distintas, de lados opostos, cada seta no seu destino', () => {
    const g = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2'], ['v2', 'v1']] });
    const [ida, volta] = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]])).edges;

    expect(ida!.path.kind).toBe('quadratic');
    expect(volta!.path.kind).toBe('quadratic');
    if (ida!.path.kind !== 'quadratic' || volta!.path.kind !== 'quadratic') throw new Error('esperava curvas');
    expectPoint(ida!.path.control, 50, 30);
    expectPoint(volta!.path.control, 50, -30);
    expect(ida!.path).not.toStrictEqual(volta!.path);
    expect(distance(ida!.arrow!.tip, point(100, 0))).toBeCloseTo(20, 9);
    expect(distance(volta!.arrow!.tip, point(0, 0))).toBeCloseTo(20, 9);
  });

  it('uma aresta sem oposto continua reta, mesmo em grafo orientado', () => {
    const g = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2']] });

    expect(sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]])).edges[0]!.path.kind).toBe('line');
  });
});

describe('buildGraphScene: vértices, ids e rótulos', () => {
  it('grafo vazio: cena vazia com o resumo "vazio"', () => {
    const scene = sceneOf(buildGraph({ vertices: 0 }), emptyLayout('g'));

    expect(scene.vertices).toStrictEqual([]);
    expect(scene.edges).toStrictEqual([]);
    expect(scene.summary).toBe('Grafo não orientado vazio: nenhum vértice e nenhuma aresta.');
  });

  it('o vértice isolado permanece na cena e é marcado `isolated`; os demais não', () => {
    const { graph, layout } = exampleLike();
    const scene = sceneOf(graph, layout);

    expect(scene.vertices.map((v) => [v.id, v.isolated])).toStrictEqual([['v1', false], ['v2', false], ['v3', false], ['v4', true]]);
  });

  it('ids e rótulos preservados, inclusive rótulos repetidos; a ordem é a de inserção', () => {
    const g = buildGraph({ vertices: 3, labels: ['Norte', 'Norte', 'Sul'] });
    const scene = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0], ['v3', 200, 0]]), { x: 0, y: 0, scale: 4 }); // r = 80: cabem 15

    expect(scene.vertices.map((v) => [v.id, v.label, v.displayLabel])).toStrictEqual([
      ['v1', 'Norte', 'Norte'],
      ['v2', 'Norte', 'Norte'],
      ['v3', 'Sul', 'Sul'],
    ]);
  });

  it('ids das arestas preservados na ordem de inserção', () => {
    const { graph, layout } = exampleLike();

    expect(sceneOf(graph, layout).edges.map((e) => e.id)).toStrictEqual(graph.edges.map((e) => e.id));
  });

  it('vértice sem posição, ou com posição não finita, fica de fora; a aresta dele também; o resumo avisa', () => {
    const g = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3']] });
    const parcial = layoutOf([['v1', 0, 0], ['v2', 200, 0]]);
    const scene = sceneOf(g, parcial);

    expect(scene.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2']);
    expect(scene.edges.map((e) => e.id)).toStrictEqual([g.edges[0]!.id]);
    expect(scene.summary).toContain('Nem todos os elementos puderam ser desenhados.');
    const corrompido = { graphId: 'g', positions: { v1: { x: Number.NaN, y: 0 }, v2: { x: 5, y: 5 } } } as unknown as GraphLayout;

    expect(sceneOf(buildGraph({ vertices: 2 }), corrompido).vertices.map((v) => v.id)).toStrictEqual(['v2']);
  });

  it('vértices sobrepostos continuam na cena, mas a aresta entre eles não tem geometria', () => {
    const g = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const scene = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 10, 0]]));

    expect(scene.vertices).toHaveLength(2);
    expect(scene.edges).toStrictEqual([]);
    expect(scene.summary).toContain('Nem todos os elementos');
  });

  it('câmera inválida ou layout de outro grafo: sem cena', () => {
    const g = buildGraph({ vertices: 1 });
    const layout = layoutOf([['v1', 0, 0]]);

    for (const camera of [{ x: 0, y: 0, scale: 0 }, { x: 0, y: 0, scale: -1 }, { x: Number.NaN, y: 0, scale: 1 }, { x: 0, y: 0, scale: Number.POSITIVE_INFINITY }]) {
      expect(buildGraphScene(g, layout, camera)).toBeUndefined();
    }
    expect(buildGraphScene(g, layoutOf([['v1', 0, 0]], 'outro'), NEUTRAL_CAMERA)).toBeUndefined();
  });

  it('raio que estoura (raio gigante × escala) não gera cena com valores não finitos', () => {
    const g = buildGraph({ vertices: 1 });

    expect(buildGraphScene(g, layoutOf([['v1', 0, 0]]), { x: 0, y: 0, scale: 4 }, { vertexRadius: 1e308 })).toBeUndefined();
  });
});

describe('rótulos longos: truncamento por pontos de código', () => {
  it('truncateLabel: cabe → igual; não cabe → corte + reticências; 1 → só o primeiro; 0 → nada', () => {
    expect(truncateLabel('Exemplo', 7)).toBe('Exemplo');
    expect(truncateLabel('Estação Central', 7)).toBe('Estaçã…');
    expect(truncateLabel('Estação Central', 2)).toBe('E…');
    expect(truncateLabel('Estação Central', 1)).toBe('E');
    expect(truncateLabel('Estação Central', 0)).toBe('');
    expect(truncateLabel('', 3)).toBe('');
  });

  it('nunca separa um par substituto (emoji): cada pedaço mantém os dois códigos', () => {
    const emojis = '😀😀😀😀😀😀😀😀';
    const cortado = truncateLabel(emojis, 4);

    expect(cortado).toBe('😀😀😀…');
    expect(cortado).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(truncateLabel('a😀b', 1)).toBe('a');
    expect(truncateLabel('😀b', 1)).toBe('😀');
  });

  it('na cena: com escala 2 (raio 40) cabem 7 pontos de código; o rótulo completo fica em `label`', () => {
    const g = buildGraph({ vertices: 1, labels: ['Estação Central'] });
    const [vertex] = sceneOf(g, layoutOf([['v1', 0, 0]]), { x: 0, y: 0, scale: 2 }).vertices;

    expect(vertex!.label).toBe('Estação Central');
    expect(vertex!.displayLabel).toBe('Estaçã…');
  });

  it('com zoom afastado (raio 5) sobra no mínimo 1 ponto de código; com zoom aproximado cabe mais', () => {
    const g = buildGraph({ vertices: 1, labels: ['Estação Central'] });
    const layout = layoutOf([['v1', 0, 0]]);

    expect(sceneOf(g, layout, { x: 0, y: 0, scale: 0.25 }).vertices[0]!.displayLabel).toBe('E');
    expect(sceneOf(g, layout, { x: 0, y: 0, scale: 4 }).vertices[0]!.displayLabel).toBe('Estação Central'); // r = 80, cabem 15
  });

  it('o domínio não é alterado pelo truncamento', () => {
    const g = buildGraph({ vertices: 1, labels: ['Estação Central'] });
    sceneOf(g, layoutOf([['v1', 0, 0]]), { x: 0, y: 0, scale: 2 });

    expect(g.vertices[0]!.label).toBe('Estação Central');
  });
});

describe('visibilidade', () => {
  const g = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3']] });
  const layout = layoutOf([['v1', 50, 50], ['v2', 300, 50], ['v3', 500, 500]]);

  it('sem área de desenho, tudo é visível', () => {
    const scene = sceneOf(g, layout);

    expect(scene.vertices.every((v) => v.visible)).toBe(true);
    expect(scene.edges.every((e) => e.visible)).toBe(true);
    expect(scene.summary).not.toContain('fora da área visível');
  });

  it('com área 100 × 100: o que não a cruza é invisível, e o resumo avisa', () => {
    const scene = sceneOf(g, layout, NEUTRAL_CAMERA, { viewport: { width: 100, height: 100 } });

    expect(scene.vertices.map((v) => v.visible)).toStrictEqual([true, false, false]);
    expect(scene.edges.map((e) => e.visible)).toStrictEqual([true, false]); // v1–v2 cruza a área; v2–v3 não
    expect(scene.summary).toContain('Parte do grafo está fora da área visível.');
  });

  it('um círculo que só encosta pela borda ainda conta (centro fora, raio dentro)', () => {
    const um = buildGraph({ vertices: 1 });

    expect(sceneOf(um, layoutOf([['v1', -10, 50]]), NEUTRAL_CAMERA, { viewport: { width: 100, height: 100 } }).vertices[0]!.visible).toBe(true);
    expect(sceneOf(um, layoutOf([['v1', -30, 50]]), NEUTRAL_CAMERA, { viewport: { width: 100, height: 100 } }).vertices[0]!.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Resumo acessível
// ---------------------------------------------------------------------------------------------

describe('resumo acessível', () => {
  it('o exemplo: orientado, 4 vértices e 4 arestas, D isolado, 3 arestas com peso', () => {
    const { graph, layout } = exampleLike();

    expect(sceneOf(graph, layout).summary).toBe('Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.');
  });

  it('singular e plural', () => {
    expect(sceneOf(buildGraph({ vertices: 1 }), layoutOf([['v1', 0, 0]])).summary).toBe(
      'Grafo não orientado com 1 vértice e 0 arestas. O vértice A está isolado.',
    );
    const par = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });

    expect(sceneOf(par, layoutOf([['v1', 0, 0], ['v2', 100, 0]])).summary).toBe('Grafo não orientado com 2 vértices e 1 aresta.');
  });

  it.each([
    [2, 'Os vértices A e B estão isolados.'],
    [3, 'Os vértices A, B e C estão isolados.'],
    [5, 'Os vértices A, B, C, D e E estão isolados.'],
    [6, '6 vértices estão isolados.'],
  ])('%i vértices isolados: "%s"', (n, frase) => {
    const g = buildGraph({ vertices: n });
    const layout = layoutOf(g.vertices.map((v, i) => [v.id, i * 100, 0] as const));

    expect(sceneOf(g, layout).summary).toContain(frase);
  });

  it('o isolado é citado pelo RÓTULO (não pelo id técnico)', () => {
    const g = buildGraph({ vertices: 2, labels: ['Casa', 'Escola'] });
    const summary = sceneOf(g, layoutOf([['v1', 0, 0], ['v2', 100, 0]])).summary;

    expect(summary).toContain('Os vértices Casa e Escola estão isolados.');
    expect(summary).not.toMatch(/\bv\d+\b/);
  });

  it('pesos: uma aresta com peso, todas com peso, ou uma parte', () => {
    const layout = layoutOf([['v1', 0, 0], ['v2', 200, 0], ['v3', 400, 0]]);
    const um = buildGraph({ vertices: 2, edges: [['v1', 'v2', 0]] });
    const todas = buildGraph({ vertices: 3, edges: [['v1', 'v2', 1], ['v2', 'v3', 2]] });
    const parte = buildGraph({ vertices: 3, edges: [['v1', 'v2', 1], ['v2', 'v3']] });
    const duas = buildGraph({ vertices: 4, edges: [['v1', 'v2', 1], ['v2', 'v3', 1], ['v3', 'v4']] });

    expect(sceneOf(um, layoutOf([['v1', 0, 0], ['v2', 200, 0]])).summary).toContain('A aresta tem peso.');
    expect(sceneOf(todas, layout).summary).toContain('Todas as arestas têm peso.');
    expect(sceneOf(parte, layout).summary).toContain('1 aresta tem peso.');
    expect(sceneOf(duas, layoutOf([['v1', 0, 0], ['v2', 200, 0], ['v3', 400, 0], ['v4', 600, 0]])).summary).toContain('2 arestas têm peso.');
  });

  it('reflete os dados reais: contagens e orientação coincidem com o grafo (500 grafos aleatórios)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const random = seededRandom(seed);
      const n = 1 + Math.floor(random() * 7);
      const directed = random() < 0.5;
      let g = buildGraph({ vertices: n, directed });
      for (let t = 0; t < n * 2; t++) {
        const a = 1 + Math.floor(random() * n);
        const b = 1 + Math.floor(random() * n);
        const r = a === b ? undefined : addEdge(g, { source: `v${a}`, target: `v${b}`, ...(random() < 0.5 && { weight: Math.floor(random() * 5) - 2 }) });
        if (r?.ok) g = r.value.graph;
      }
      const summary = sceneOf(g, circularLayout(g)).summary;
      const vertices = `${n} ${n === 1 ? 'vértice' : 'vértices'}`;
      const edges = `${g.edges.length} ${g.edges.length === 1 ? 'aresta' : 'arestas'}`;

      expect(summary).toContain(`Grafo ${directed ? 'orientado' : 'não orientado'} com ${vertices} e ${edges}.`);
      const isolados = g.vertices.filter((v) => !g.edges.some((e) => e.source === v.id || e.target === v.id)).length;
      expect(/isolad/.test(summary)).toBe(isolados > 0);
      expect(/\bpeso\b/.test(summary)).toBe(g.edges.some((e) => e.weight !== undefined));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Câmera: enquadramento e consistência com o hit-testing
// ---------------------------------------------------------------------------------------------

describe('fitCameraToGraph e graphContentBounds', () => {
  const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
  const layout = layoutOf([['v1', 0, 0], ['v2', 100, 0]]);
  const viewport = { width: 360, height: 640 };

  it('os limites cobrem os CÍRCULOS, não só os centros: x de −20 a 120, y de −20 a 20', () => {
    expect(graphContentBounds(graph, layout)).toStrictEqual({ minX: -20, minY: -20, maxX: 120, maxY: 20 });
    expect(graphContentBounds(graph, layout, { vertexRadius: 30 })).toStrictEqual({ minX: -30, minY: -30, maxX: 130, maxY: 30 });
  });

  it('em arcos opostos os limites incluem o ápice da curva', () => {
    const arcos = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2'], ['v2', 'v1']] });
    const bounds = graphContentBounds(arcos, layout)!;

    expect(bounds.maxY).toBeCloseTo(20.144958, 5); // o ápice (50; 20,145) passa do círculo (y = 20)
    expect(bounds.minY).toBeCloseTo(-20.144958, 5);
  });

  it('enquadra com margem de 24 dp: escala 312/140 ≈ 2,2286, conteúdo centrado em (180, 320)', () => {
    const camera = fitCameraToGraph(graph, layout, viewport)!;

    expect(camera.scale).toBeCloseTo(312 / 140, 9);
    expectPoint(worldToScreen(camera, point(50, 0)), 180, 320);
    expect(worldToScreen(camera, point(-20, 0)).x).toBeCloseTo(DEFAULT_SCENE_MARGIN, 9); // a borda esquerda do círculo
    expect(worldToScreen(camera, point(120, 0)).x).toBeCloseTo(360 - DEFAULT_SCENE_MARGIN, 9);
  });

  it('a margem é configurável', () => {
    const camera = fitCameraToGraph(graph, layout, viewport, { margin: 0 })!;

    expect(camera.scale).toBeCloseTo(360 / 140, 9);
  });

  it('um vértice só: a escala máxima (4) manda e ele fica no centro', () => {
    const um = buildGraph({ vertices: 1 });
    const camera = fitCameraToGraph(um, layoutOf([['v1', 0, 0]]), viewport)!;

    expect(camera.scale).toBe(4);
    expectPoint(worldToScreen(camera, point(0, 0)), 180, 320);
  });

  it('grafo vazio: câmera neutra', () => {
    expect(fitCameraToGraph(buildGraph({ vertices: 0 }), emptyLayout('g'), viewport)).toStrictEqual({ x: 0, y: 0, scale: 1 });
  });

  it('área de desenho inválida (ainda não medida) ou layout de outro grafo: sem câmera', () => {
    for (const invalida of [{ width: 0, height: 640 }, { width: 360, height: 0 }, { width: Number.NaN, height: 640 }, { width: -5, height: 640 }, { width: 40, height: 640 }]) {
      expect(fitCameraToGraph(graph, layout, invalida)).toBeUndefined();
    }
    expect(fitCameraToGraph(graph, layoutOf([['v1', 0, 0], ['v2', 100, 0]], 'outro'), viewport)).toBeUndefined();
    expect(fitCameraToGraph(graph, layout, viewport, { margin: 200 })).toBeUndefined(); // a margem não deixa área útil
  });

  it('o conteúdo cabe quando a escala permite: todos os círculos ficam dentro da margem (500 casos)', () => {
    let exatos = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const random = seededRandom(seed);
      const n = 1 + Math.floor(random() * 8);
      const g = buildGraph({ vertices: n, directed: random() < 0.5 });
      const l = layoutOf(g.vertices.map((v) => [v.id, Math.round((random() * 2 - 1) * 500), Math.round((random() * 2 - 1) * 500)] as const));
      const view = { width: 200 + Math.floor(random() * 400), height: 200 + Math.floor(random() * 500) };
      const camera = fitCameraToGraph(g, l, view)!;
      const scene = sceneOf(g, l, camera, { viewport: view });
      if (camera.scale > 0.25 && camera.scale < 4) {
        exatos++;
        for (const v of scene.vertices) {
          expect(v.center.x - v.radius).toBeGreaterThanOrEqual(DEFAULT_SCENE_MARGIN - 1e-6);
          expect(v.center.y - v.radius).toBeGreaterThanOrEqual(DEFAULT_SCENE_MARGIN - 1e-6);
          expect(v.center.x + v.radius).toBeLessThanOrEqual(view.width - DEFAULT_SCENE_MARGIN + 1e-6);
          expect(v.center.y + v.radius).toBeLessThanOrEqual(view.height - DEFAULT_SCENE_MARGIN + 1e-6);
        }
        expect(scene.vertices.every((v) => v.visible)).toBe(true);
      }
    }

    expect(exatos).toBeGreaterThan(300);
  });

  it('um grafo imenso não cabe: a escala para em 0,25, parte fica fora e o resumo avisa', () => {
    const grande = buildGraph({ vertices: 1500 });
    const l = circularLayout(grande);
    const camera = fitCameraToGraph(grande, l, viewport)!;
    const scene = sceneOf(grande, l, camera, { viewport });

    expect(camera.scale).toBe(0.25);
    expect(scene.vertices.some((v) => !v.visible)).toBe(true);
    expect(scene.summary).toContain('Parte do grafo está fora da área visível.');
  });
});

describe('consistência com a geometria e o hit-testing (a cena é o que se toca)', () => {
  it('cada vértice da cena está onde o hit-testing o acha: tocar no centro acerta esse vértice a distância 0', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = seededRandom(seed);
      const g = buildGraph({ vertices: 4, directed: true });
      const l = layoutOf(g.vertices.map((v) => [v.id, 300 * (g.vertices.indexOf(v) % 2) + Math.round(random() * 30), 300 * Math.floor(g.vertices.indexOf(v) / 2)] as const));
      const camera: Camera = { x: Math.round((random() * 2 - 1) * 200), y: Math.round((random() * 2 - 1) * 200), scale: [0.25, 1, 4][seed % 3]! };
      const scene = sceneOf(g, l, camera);

      for (const vertex of scene.vertices) {
        expect(hitTestVertex(g, l, camera, vertex.center)).toStrictEqual({ vertexId: vertex.id, distance: 0 });
        expect(vertex.center).toStrictEqual(worldToScreen(camera, positionOf(l, vertex.id)!));
        expect(vertex.radius).toBe(DEFAULT_VERTEX_RADIUS * camera.scale);
      }
    }
  });

  it('as arestas da cena são a geometria do mundo convertida UMA vez: pontos e ids coincidem em qualquer câmera', () => {
    const { graph, layout } = exampleLike();
    const geometries = edgeGeometries(graph, layout);

    for (const camera of [NEUTRAL_CAMERA, { x: 30, y: -40, scale: 0.25 }, { x: -200, y: 80, scale: 4 }]) {
      const scene = sceneOf(graph, layout, camera);

      expect(scene.edges.map((e) => e.id)).toStrictEqual(geometries.map((g) => g.edgeId));
      scene.edges.forEach((edge, i) => {
        const g = geometries[i]!;

        expect(edge.path.from).toStrictEqual(worldToScreen(camera, g.path.from));
        expect(edge.path.to).toStrictEqual(worldToScreen(camera, g.path.to));
        if (edge.path.kind === 'quadratic' && g.path.kind === 'quadratic') {
          expect(edge.path.control).toStrictEqual(worldToScreen(camera, g.path.control));
        }
        expect(edge.arrow?.tip).toStrictEqual(g.arrow === undefined ? undefined : worldToScreen(camera, g.arrow.tip));
        // a escala foi aplicada uma vez: o comprimento do traço cresce por `scale`, não por `scale²`
        const mundo = Math.hypot(g.path.to.x - g.path.from.x, g.path.to.y - g.path.from.y);
        const tela = Math.hypot(edge.path.to.x - edge.path.from.x, edge.path.to.y - edge.path.from.y);

        expect(tela).toBeCloseTo(mundo * camera.scale, 6);
      });
    }
  });

  it('tocar no meio de uma aresta reta da cena acerta essa aresta (fora das áreas dos vértices)', () => {
    const g = buildGraph({ vertices: 2, directed: true, edges: [['v1', 'v2']] });
    const l = layoutOf([['v1', 0, 0], ['v2', 400, 0]]);
    for (const camera of [NEUTRAL_CAMERA, { x: 20, y: 30, scale: 1.5 }, { x: -50, y: 10, scale: 0.5 }]) {
      const [edge] = sceneOf(g, l, camera).edges;
      if (edge === undefined || edge.path.kind !== 'line') throw new Error('esperava uma reta');
      const meio = point((edge.path.from.x + edge.path.to.x) / 2, (edge.path.from.y + edge.path.to.y) / 2);

      expect(hitTestEdge(g, l, camera, meio)?.edgeId).toBe(edge.id);
    }
  });
});

describe('determinismo e imutabilidade', () => {
  it('a mesma entrada dá a mesma cena, e as entradas não são alteradas', () => {
    const { graph, layout } = exampleLike();
    const camera: Camera = { x: 5, y: 6, scale: 1.7 };
    const antes = JSON.stringify([graph, layout, camera]);
    const primeira = buildGraphScene(graph, layout, camera, { viewport: { width: 300, height: 300 } });

    expect(buildGraphScene(graph, layout, camera, { viewport: { width: 300, height: 300 } })).toStrictEqual(primeira);
    expect(JSON.stringify([graph, layout, camera])).toBe(antes);
    const congelada = buildGraphScene(deepFreeze(JSON.parse(JSON.stringify(graph)) as Graph), layout, deepFreeze({ ...camera }));

    expect(congelada).toBeDefined();
  });

  it('a cena não compartilha objetos com o layout (alterá-la não muda o layout)', () => {
    const { graph, layout } = exampleLike();
    const scene = sceneOf(graph, layout);
    (scene.vertices[0]!.center as { x: number }).x = 99999;

    expect(positionOf(layout, 'v1')!.x).not.toBe(99999);
    expect(sceneOf(graph, layout).vertices[0]!.center.x).not.toBe(99999);
  });

  it('nenhum valor da cena é NaN, Infinity ou -0 (500 casos)', () => {
    const numeros = (valor: unknown): number[] =>
      typeof valor === 'number' ? [valor] : typeof valor === 'object' && valor !== null ? Object.values(valor).flatMap(numeros) : [];
    for (let seed = 1; seed <= 500; seed++) {
      const random = seededRandom(seed);
      const n = 1 + Math.floor(random() * 6);
      let g = buildGraph({ vertices: n, directed: random() < 0.6 });
      for (let t = 0; t < n * 2; t++) {
        const a = 1 + Math.floor(random() * n);
        const b = 1 + Math.floor(random() * n);
        const r = a === b ? undefined : addEdge(g, { source: `v${a}`, target: `v${b}`, ...(random() < 0.5 && { weight: Math.floor(random() * 5) - 2 }) });
        if (r?.ok) g = r.value.graph;
      }
      const l = layoutOf(g.vertices.map((v) => [v.id, Math.round((random() * 2 - 1) * 400), Math.round((random() * 2 - 1) * 400)] as const));
      const scene = sceneOf(g, l, { x: Math.round((random() * 2 - 1) * 300), y: Math.round((random() * 2 - 1) * 300), scale: [0.25, 1, 4][seed % 3]! });

      expect(numeros(scene).every((valor) => Number.isFinite(valor) && !Object.is(valor, -0))).toBe(true);
    }
  });
});
