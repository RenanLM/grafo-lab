import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import {
  DEFAULT_ARROW_HALF_WIDTH,
  DEFAULT_ARROW_LENGTH,
  DEFAULT_CURVATURE,
  DEFAULT_CURVE_SAMPLES,
  DEFAULT_EDGE_TOLERANCE,
  DEFAULT_MIN_TOUCH_DIAMETER,
  DEFAULT_VERTEX_RADIUS,
  NEUTRAL_CAMERA,
  circularLayout,
  edgeGeometries,
  edgeGeometry,
  emptyLayout,
  hitTest,
  hitTestEdge,
  hitTestVertex,
  placeVertex,
  positionOf,
  reconcileLayout,
  screenToWorld,
  worldToScreen,
  type Camera,
  type EdgeGeometry,
  type GraphLayout,
  type Point,
  type QuadraticCurve,
} from './index';
import { distanceToCurve, distanceToSegment, quadraticPoint } from './geometry';
import { deepFreeze, seededRandom } from './test-helpers';

// Geometria das arestas e hit-testing (ver geometry.ts). Valores esperados calculados à mão ou por uma reimplementação
// independente, fora do código testado.

// ---------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type EdgeSpec = readonly [source: string, target: string, weight?: number];

/** Grafo `id` com v1..vN e as arestas dadas, na ordem dada. */
function buildGraph(options: { id?: string; vertices: number; edges?: readonly EdgeSpec[]; directed?: boolean }): Graph {
  let graph = createGraph({ id: options.id ?? 'g', directed: options.directed ?? false });
  for (let i = 0; i < options.vertices; i++) graph = must(addVertex(graph)).graph;
  for (const [source, target, weight] of options.edges ?? []) {
    graph = must(addEdge(graph, { source, target, ...(weight !== undefined && { weight }) })).graph;
  }
  return graph;
}

/** Layout do grafo `graphId` com as posições dadas, montado só com a API pública. */
function layoutOf(graphId: string, entries: readonly (readonly [string, number, number])[]): GraphLayout {
  return entries.reduce((layout, [id, x, y]) => placeVertex(layout, id, { x, y }), emptyLayout(graphId));
}

const point = (x: number, y: number): Point => ({ x, y });

function expectPoint(actual: Point | undefined, x: number, y: number, digits = 9): void {
  if (actual === undefined) throw new Error('ponto ausente');
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
}

/** Geometria da primeira aresta do grafo, ou falha do teste. */
function onlyGeometry(graph: Graph, layout: GraphLayout, options = {}): EdgeGeometry {
  const first = graph.edges[0];
  if (first === undefined) throw new Error('grafo sem arestas');
  const geometry = edgeGeometry(graph, layout, first.id, options);
  if (geometry === undefined) throw new Error('sem geometria');
  return geometry;
}

/** Todos os números de um valor (objetos e arrays aninhados). */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(numbersIn);
  return [];
}

const allFiniteAndClean = (value: unknown): boolean =>
  numbersIn(value).every((n) => Number.isFinite(n) && !Object.is(n, -0));

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------------------------
// 3.3A: geometria das arestas
// ---------------------------------------------------------------------------------------------

describe('edgeGeometry: arestas não orientadas (raio 20)', () => {
  it('horizontal: da borda de v1 à borda de v2, e a âncora do peso no meio', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 20, y: 0 }, to: { x: 80, y: 0 } });
    expect(geometry.labelAnchor).toStrictEqual({ x: 50, y: 0 });
    expect(geometry.edgeId).toBe(graph.edges[0]!.id);
    expect(geometry.sourceId).toBe('v1');
    expect(geometry.targetId).toBe('v2');
  });

  it('não desenha seta em grafo não orientado (nem a chave `arrow` existe)', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]), { arrowLength: 30 });

    expect(geometry.arrow).toBeUndefined();
    expect('arrow' in geometry).toBe(false);
  });

  it('origem e destino são os da aresta, não os da posição: `v2 — v1` começa na borda de v2', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v2', 'v1']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 80, y: 0 }, to: { x: 20, y: 0 } });
    expect(geometry.sourceId).toBe('v2');
    expect(geometry.targetId).toBe('v1');
  });

  it('vertical (para cima na tela, Y negativo)', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 0, -100]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 0, y: -20 }, to: { x: 0, y: -80 } });
    expect(geometry.labelAnchor).toStrictEqual({ x: 0, y: -50 });
  });

  it('diagonal 3-4-5: (0,0) → (30,40), d = 50, u = (0,6; 0,8), borda a 20 dos centros', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 30, 40]]));

    expect(geometry.path.kind).toBe('line');
    expectPoint(geometry.path.from, 12, 16);
    expectPoint(geometry.path.to, 18, 24);
    expectPoint(geometry.labelAnchor, 15, 20);
  });

  it('coordenadas negativas e deslocadas', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', -100, -40], ['v2', -100, 60]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: -100, y: -20 }, to: { x: -100, y: 40 } });
    expect(geometry.labelAnchor).toStrictEqual({ x: -100, y: 10 });
  });

  it('o raio é configurável: com 10 a reta vai de x = 10 a x = 90', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]), { vertexRadius: 10 });

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 10, y: 0 }, to: { x: 90, y: 0 } });
  });

  it('a linha NÃO atravessa os círculos: começa e termina na borda, nunca nos centros', () => {
    const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const a = point(-30, 17);
    const b = point(120, 90);
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', a.x, a.y], ['v2', b.x, b.y]]));

    expect(distance(geometry.path.from, a)).toBeCloseTo(20, 9);
    expect(distance(geometry.path.to, b)).toBeCloseTo(20, 9);
    expect(distance(geometry.path.from, b)).toBeGreaterThan(20);
    // o comprimento visível é a distância entre os centros menos os dois raios
    expect(distance(geometry.path.from, geometry.path.to)).toBeCloseTo(distance(a, b) - 40, 9);
  });

  it('as constantes padrão são as documentadas', () => {
    expect([DEFAULT_VERTEX_RADIUS, DEFAULT_ARROW_LENGTH, DEFAULT_ARROW_HALF_WIDTH, DEFAULT_CURVATURE]).toStrictEqual([20, 12, 5, 0.3]);
  });
});

describe('edgeGeometry: casos sem geometria (nunca lança)', () => {
  const graph = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
  const edgeId = graph.edges[0]!.id;

  it.each([
    ['mesma posição', 0, 0],
    ['tangentes (d = 2r = 40)', 40, 0],
    ['sobrepostos (d = 39,999)', 39.999, 0],
    ['muito próximos na diagonal (d = 30)', 18, 24],
  ])('vértices %s: nenhuma geometria', (_nome, x, y) => {
    expect(edgeGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', x, y]]), edgeId)).toBeUndefined();
  });

  it('logo acima de 2r já há geometria, e o traço visível é minúsculo', () => {
    const geometry = onlyGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 40.001, 0]]));

    expect(distance(geometry.path.from, geometry.path.to)).toBeCloseTo(0.001, 9);
    expect(allFiniteAndClean(geometry)).toBe(true);
  });

  it('o limite depende do raio configurado: d = 50 serve com r = 20 e não com r = 25 nem r = 30', () => {
    const layout = layoutOf('g', [['v1', 0, 0], ['v2', 50, 0]]);

    expect(edgeGeometry(graph, layout, edgeId)).toBeDefined();
    expect(edgeGeometry(graph, layout, edgeId, { vertexRadius: 25 })).toBeUndefined();
    expect(edgeGeometry(graph, layout, edgeId, { vertexRadius: 30 })).toBeUndefined();
  });

  it('posição ausente em uma das pontas (ou nas duas): nenhuma geometria; edgeGeometries pula só essa aresta', () => {
    const tres = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3'], ['v1', 'v3']] });
    const incompleto = layoutOf('g', [['v1', 0, 0], ['v3', 200, 0]]);

    expect(edgeGeometry(tres, incompleto, tres.edges[0]!.id)).toBeUndefined();
    expect(edgeGeometry(tres, incompleto, tres.edges[1]!.id)).toBeUndefined();
    expect(edgeGeometry(tres, emptyLayout('g'), tres.edges[2]!.id)).toBeUndefined();
    expect(edgeGeometries(tres, incompleto).map((g) => g.edgeId)).toStrictEqual([tres.edges[2]!.id]);
    expect(edgeGeometries(tres, emptyLayout('g'))).toStrictEqual([]);
  });

  it('aresta inexistente: nenhuma geometria', () => {
    expect(edgeGeometry(graph, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]), 'e999')).toBeUndefined();
  });

  it('layout de OUTRO grafo, mesmo com ids coincidentes: nenhuma geometria (nada é reconciliado aqui)', () => {
    const outro = layoutOf('outro-grafo', [['v1', 0, 0], ['v2', 100, 0]]);

    expect(edgeGeometry(graph, outro, edgeId)).toBeUndefined();
    expect(edgeGeometries(graph, outro)).toStrictEqual([]);
  });

  it('posição não finita num layout corrompido conta como ausente', () => {
    const corrompido = { graphId: 'g', positions: { v1: { x: Number.NaN, y: 0 }, v2: { x: 100, y: 0 } } } as unknown as GraphLayout;

    expect(edgeGeometry(graph, corrompido, edgeId)).toBeUndefined();
  });

  it('um laço (que o domínio não permite) fica sem geometria em vez de gerar NaN', () => {
    const comLaco: Graph = { ...graph, edges: [{ id: 'e1', source: 'v1', target: 'v1' }] };

    expect(edgeGeometry(comLaco, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]), 'e1')).toBeUndefined();
  });

  it('grafo vazio e vértice isolado: nenhuma geometria', () => {
    expect(edgeGeometries(buildGraph({ vertices: 0 }), emptyLayout('g'))).toStrictEqual([]);
    expect(edgeGeometries(buildGraph({ vertices: 1 }), layoutOf('g', [['v1', 0, 0]]))).toStrictEqual([]);
  });

  it('coordenadas enormes: sem NaN/Infinity (geometria finita ou ausente)', () => {
    const enorme = layoutOf('g', [['v1', -1.7e308, 0], ['v2', 1.7e308, 0]]); // dx estoura
    const grande = layoutOf('g', [['v1', 1e300, 1e300], ['v2', 1e300 + 1e290, 1e300]]);
    const ok = layoutOf('g', [['v1', 1e6, 1e6], ['v2', 1e6 + 100, 1e6]]);

    expect(edgeGeometry(graph, enorme, edgeId)).toBeUndefined();
    for (const layout of [grande, ok]) {
      const geometry = edgeGeometry(graph, layout, edgeId);
      if (geometry !== undefined) expect(allFiniteAndClean(geometry)).toBe(true);
    }
    expectPoint(onlyGeometry(graph, ok).path.from, 1e6 + 20, 1e6, 6);
  });

  it('opções inválidas valem o padrão (sem exceção)', () => {
    const layout = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]);
    const padrao = edgeGeometry(graph, layout, edgeId);

    for (const invalido of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY, undefined]) {
      expect(edgeGeometry(graph, layout, edgeId, { vertexRadius: invalido })).toStrictEqual(padrao);
      expect(edgeGeometry(graph, layout, edgeId, { arrowLength: invalido })).toStrictEqual(padrao);
      expect(edgeGeometry(graph, layout, edgeId, { arrowHalfWidth: invalido })).toStrictEqual(padrao);
      expect(edgeGeometry(graph, layout, edgeId, { curvature: invalido })).toStrictEqual(padrao);
    }
  });
});

describe('edgeGeometry: arestas orientadas e setas', () => {
  const orientado = (edges: readonly EdgeSpec[], vertices = 2) => buildGraph({ vertices, edges, directed: true });

  it('horizontal v1 → v2: ponta na borda do destino (80, 0), base 12 para trás, asas a ±5', () => {
    const geometry = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 20, y: 0 }, to: { x: 80, y: 0 } });
    expect(geometry.arrow).toStrictEqual({
      tip: { x: 80, y: 0 },
      base: { x: 68, y: 0 },
      right: { x: 68, y: 5 }, // a direita de quem anda para leste, na tela (Y para baixo), é o sul
      left: { x: 68, y: -5 },
    });
  });

  it('invertida (v2 → v1): a ponta passa para v1 e o sentido se inverte', () => {
    const geometry = onlyGeometry(orientado([['v2', 'v1']]), layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]));

    expect(geometry.path).toStrictEqual({ kind: 'line', from: { x: 80, y: 0 }, to: { x: 20, y: 0 } });
    expect(geometry.arrow).toStrictEqual({
      tip: { x: 20, y: 0 },
      base: { x: 32, y: 0 },
      right: { x: 32, y: -5 },
      left: { x: 32, y: 5 },
    });
  });

  it('vertical para cima: ponta em (0, −80), a direita de quem sobe é o leste', () => {
    const geometry = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 0, -100]]));

    expect(geometry.arrow).toStrictEqual({
      tip: { x: 0, y: -80 },
      base: { x: 0, y: -68 },
      right: { x: 5, y: -68 },
      left: { x: -5, y: -68 },
    });
  });

  it('diagonal 3-4-5: (0,0) → (60,80), d = 100, u = (0,6; 0,8): ponta (48, 64), base (40,8; 54,4), asas (36,8; 57,4) e (44,8; 51,4)', () => {
    const arrow = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 60, 80]])).arrow!;

    expectPoint(arrow.tip, 48, 64);
    expectPoint(arrow.base, 40.8, 54.4); // 12 para trás: (48 − 7,2; 64 − 9,6)
    expectPoint(arrow.right, 36.8, 57.4); // base + 5·(−0,8; 0,6)
    expectPoint(arrow.left, 44.8, 51.4);
  });

  it('diagonal curta (d = 50): só sobram 10 de traço visível e a seta é cortada em 10 (base na borda da origem)', () => {
    const arrow = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 30, 40]])).arrow!;

    expectPoint(arrow.tip, 18, 24);
    expectPoint(arrow.base, 12, 16);
  });

  it('o corpo não atravessa o círculo de destino: a ponta está na borda e a base fica antes dela, sobre o traço', () => {
    const a = point(-40, 25);
    const b = point(90, -60);
    const geometry = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', a.x, a.y], ['v2', b.x, b.y]]));
    const arrow = geometry.arrow!;

    expect(distance(arrow.tip, b)).toBeCloseTo(20, 9);
    expect(distance(arrow.base, b)).toBeCloseTo(32, 9); // 20 do raio + 12 da seta
    expect(distance(arrow.base, a)).toBeGreaterThan(20); // e a base está fora do círculo de origem
    // base e ponta estão no traço: a soma das duas distâncias à extremidade `from` fecha com o comprimento
    expect(distance(geometry.path.from, arrow.base) + distance(arrow.base, arrow.tip)).toBeCloseTo(distance(geometry.path.from, arrow.tip), 9);
  });

  it('dimensões configuráveis: comprimento 20 e meia-largura 8', () => {
    const arrow = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]), {
      arrowLength: 20,
      arrowHalfWidth: 8,
    }).arrow!;

    expect(arrow).toStrictEqual({
      tip: { x: 80, y: 0 },
      base: { x: 60, y: 0 },
      right: { x: 60, y: 8 },
      left: { x: 60, y: -8 },
    });
  });

  it('seta maior que o traço visível: o comprimento efetivo é o do traço (a base não passa da borda da origem)', () => {
    // d = 50, r = 20: sobram 10 de traço visível
    const geometry = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 50, 0]]));

    expect(geometry.arrow!.tip).toStrictEqual({ x: 30, y: 0 });
    expect(geometry.arrow!.base).toStrictEqual({ x: 20, y: 0 });
    expect(geometry.arrow!.base.x).toBeGreaterThanOrEqual(geometry.path.from.x);
  });

  it('a ponta coincide com o fim do traço, em objetos distintos', () => {
    const geometry = onlyGeometry(orientado([['v1', 'v2']]), layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]));

    expect(geometry.arrow!.tip).toStrictEqual(geometry.path.to);
    expect(geometry.arrow!.tip).not.toBe(geometry.path.to);
  });

  it('só há um arco entre os dois (sem oposto): continua reta', () => {
    const grafo = orientado([['v1', 'v2'], ['v2', 'v3']], 3);
    const geometries = edgeGeometries(grafo, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0], ['v3', 200, 100]]));

    expect(geometries.map((g) => g.path.kind)).toStrictEqual(['line', 'line']);
  });
});

describe('edgeGeometry: arcos opostos (A → B e B → A)', () => {
  const grafo = buildGraph({ vertices: 2, edges: [['v1', 'v2'], ['v2', 'v1']], directed: true });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]);
  const [ida, volta] = edgeGeometries(grafo, layout) as [EdgeGeometry, EdgeGeometry];

  it('os dois viram curvas quadráticas, em lados opostos da reta entre os centros', () => {
    expect(ida.path.kind).toBe('quadratic');
    expect(volta.path.kind).toBe('quadratic');
    if (ida.path.kind !== 'quadratic' || volta.path.kind !== 'quadratic') return;
    // cada uma curva para a SUA direita (na tela, Y para baixo): v1 → v2 anda para leste e curva para o sul (y > 0);
    // v2 → v1 anda para oeste e curva para o norte (y < 0)
    expectPoint(ida.path.control, 50, 30);
    expectPoint(volta.path.control, 50, -30);
  });

  it('v1 → v2: extremos na borda (17,1499; 10,2899) e (82,8501; 10,2899), âncora (50; 20,145)', () => {
    if (ida.path.kind !== 'quadratic') throw new Error('esperava curva');

    expectPoint(ida.path.from, 17.149859, 10.289915, 5);
    expectPoint(ida.path.to, 82.850141, 10.289915, 5);
    expectPoint(ida.labelAnchor, 50, 20.144958, 5);
  });

  it('v2 → v1: é a mesma curva girada 180° em torno do ponto médio (50, 0)', () => {
    if (volta.path.kind !== 'quadratic') throw new Error('esperava curva');

    expectPoint(volta.path.from, 82.850141, -10.289915, 5);
    expectPoint(volta.path.to, 17.149859, -10.289915, 5);
    expectPoint(volta.labelAnchor, 50, -20.144958, 5);
  });

  it('as setas preservam o sentido: a ponta de cada uma está na borda do SEU destino, com a tangente final calculada', () => {
    // v1 → v2: tangente final = unit(B − C) = (0,857493; −0,514496)
    expectPoint(ida.arrow!.tip, 82.850141, 10.289915, 5);
    expectPoint(ida.arrow!.base, 72.560226, 16.463864, 5);
    expectPoint(ida.arrow!.right, 75.132705, 20.751329, 5);
    expectPoint(ida.arrow!.left, 69.987748, 12.1764, 5);
    expectPoint(volta.arrow!.tip, 17.149859, -10.289915, 5);
    expectPoint(volta.arrow!.base, 27.439774, -16.463864, 5);
    expect(distance(ida.arrow!.tip, point(100, 0))).toBeCloseTo(20, 9);
    expect(distance(volta.arrow!.tip, point(0, 0))).toBeCloseTo(20, 9);
  });

  it('a âncora de cada peso está na própria curva (t = ½) e as duas ficam a ≈ 40 uma da outra, não sobrepostas', () => {
    if (ida.path.kind !== 'quadratic' || volta.path.kind !== 'quadratic') throw new Error('esperava curvas');

    expect(ida.labelAnchor).toStrictEqual(quadraticPoint(ida.path, 0.5));
    expect(volta.labelAnchor).toStrictEqual(quadraticPoint(volta.path, 0.5));
    expect(distance(ida.labelAnchor, volta.labelAnchor)).toBeCloseTo(40.289916, 5);
  });

  it('as duas trajetórias nunca coincidem: em t = ¼, ½ e ¾ os pontos ficam sempre separados', () => {
    if (ida.path.kind !== 'quadratic' || volta.path.kind !== 'quadratic') throw new Error('esperava curvas');
    for (const t of [0.25, 0.5, 0.75]) {
      expect(distance(quadraticPoint(ida.path, t), quadraticPoint(volta.path, t))).toBeGreaterThan(15);
    }
  });

  it('o deslocamento do controle é curvatura · d, não uma constante: d = 200 → 60 (controle em (100, 60)); vertical d = 300 → 90', () => {
    const longo = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const [a] = edgeGeometries(grafo, longo);
    const vertical = edgeGeometries(grafo, layoutOf('g', [['v1', 0, 0], ['v2', 0, -300]]));

    if (a?.path.kind !== 'quadratic' || vertical[0]?.path.kind !== 'quadratic') throw new Error('esperava curvas');
    expectPoint(a.path.control, 100, 60);
    // v1 → v2 sobe (Y negativo); a direita de quem anda para cima é o leste: controle em (90, −150)
    expectPoint(vertical[0].path.control, 90, -150);
    expect(vertical[1]!.path.kind === 'quadratic' && vertical[1]!.path.control).toStrictEqual({ x: -90, y: -150 });
  });

  it('a curvatura é configurável: com 0,6 o controle sobe para (50; ±60), e valor ≤ 0 volta ao padrão', () => {
    const maior = edgeGeometries(grafo, layout, { curvature: 0.6 });
    const [a] = maior;

    if (a?.path.kind !== 'quadratic') throw new Error('esperava curva');
    expectPoint(a.path.control, 50, 60);
    expect(edgeGeometries(grafo, layout, { curvature: 0 })).toStrictEqual(edgeGeometries(grafo, layout));
  });

  it('o resultado não depende da ordem de inserção: v2 → v1 antes de v1 → v2 dá as mesmas curvas para cada sentido', () => {
    const invertido = buildGraph({ vertices: 2, edges: [['v2', 'v1'], ['v1', 'v2']], directed: true });
    const chave = (g: EdgeGeometry) => `${g.sourceId}>${g.targetId}`;
    const normal = new Map(edgeGeometries(grafo, layout).map((g) => [chave(g), g]));
    const outro = new Map(edgeGeometries(invertido, layout).map((g) => [chave(g), g]));

    for (const [k, g] of normal) {
      const h = outro.get(k)!;
      expect({ ...h, edgeId: 'x' }).toStrictEqual({ ...g, edgeId: 'x' });
    }
    // e os ids acompanham as arestas, não a posição na lista
    expect(edgeGeometries(invertido, layout).map((g) => g.edgeId)).toStrictEqual(invertido.edges.map((e) => e.id));
  });

  it('só fica curva a aresta que TEM oposto: com v1 → v2, v2 → v1 e v1 → v3, a terceira é reta', () => {
    const tres = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v1'], ['v1', 'v3']], directed: true });
    const kinds = edgeGeometries(tres, layoutOf('g', [['v1', 0, 0], ['v2', 100, 0], ['v3', 0, 100]])).map((g) => g.path.kind);

    expect(kinds).toStrictEqual(['quadratic', 'quadratic', 'line']);
  });

  it('em grafo NÃO orientado nunca há curva (um par, uma aresta)', () => {
    const naoOrientado = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });

    expect(onlyGeometry(naoOrientado, layout).path.kind).toBe('line');
  });

  it('edgeGeometry (uma aresta) e edgeGeometries (todas) concordam, curvas incluídas', () => {
    const todas = edgeGeometries(grafo, layout);

    grafo.edges.forEach((edge, index) => {
      expect(edgeGeometry(grafo, layout, edge.id)).toStrictEqual(todas[index]);
    });
  });
});

describe('edgeGeometries: ordem, ids, imutabilidade e custo', () => {
  const grafo = buildGraph({
    vertices: 4,
    edges: [['v1', 'v2'], ['v2', 'v1'], ['v3', 'v4'], ['v2', 'v3']],
    directed: true,
  });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0], ['v3', 200, 200], ['v4', 0, 200]]);

  it('devolve uma geometria por aresta, na ordem de inserção, com o id da própria aresta', () => {
    const geometries = edgeGeometries(grafo, layout);

    expect(geometries.map((g) => g.edgeId)).toStrictEqual(grafo.edges.map((e) => e.id));
    geometries.forEach((g, i) => {
      expect(g.sourceId).toBe(grafo.edges[i]!.source);
      expect(g.targetId).toBe(grafo.edges[i]!.target);
    });
  });

  it('não altera o grafo nem o layout, e o resultado não compartilha objetos com eles', () => {
    const antes = JSON.stringify([grafo, layout]);
    const geometries = edgeGeometries(deepFreeze(JSON.parse(JSON.stringify(grafo)) as Graph), layout);
    const [primeira] = geometries;
    const posicao = positionOf(layout, 'v1')!;

    expect(JSON.stringify([grafo, layout])).toBe(antes);
    expect(primeira!.path.from).not.toBe(posicao);
    if (primeira!.path.kind === 'quadratic') expect(primeira!.path.control).not.toBe(positionOf(layout, 'v2'));
    // alterar o resultado não muda o layout (os pontos do layout são congelados e os do resultado, novos)
    (primeira!.path.from as { x: number }).x = 12345;
    expect(JSON.stringify([grafo, layout])).toBe(antes);
  });

  it('é determinística: duas chamadas dão resultados idênticos', () => {
    expect(edgeGeometries(grafo, layout)).toStrictEqual(edgeGeometries(grafo, layout));
  });

  it('não procura o arco oposto aresta por aresta: edgeGeometries nunca chama find/some/filter nas arestas', () => {
    const edges = [...grafo.edges];
    const espioes = (['find', 'some', 'filter', 'findIndex', 'indexOf', 'includes'] as const).map((metodo) => jest.spyOn(edges, metodo));
    edgeGeometries({ ...grafo, edges }, layout);

    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });

  it('resultados finitos, sem -0, também com vértices em zero (eixos)', () => {
    const geometries = edgeGeometries(grafo, layout);

    expect(geometries.length).toBeGreaterThan(0);
    expect(allFiniteAndClean(geometries)).toBe(true);
  });
});

describe('integração com circularLayout e reconcileLayout', () => {
  it('um grafo orientado completo em círculo: todas as arestas têm geometria; os pares opostos curvam e o resto é reto', () => {
    const completo = buildGraph({
      vertices: 4,
      directed: true,
      edges: [['v1', 'v2'], ['v2', 'v1'], ['v2', 'v3'], ['v3', 'v4'], ['v4', 'v1']],
    });
    const geometries = edgeGeometries(completo, circularLayout(completo));

    expect(geometries).toHaveLength(5);
    expect(geometries.map((g) => g.path.kind)).toStrictEqual(['quadratic', 'quadratic', 'line', 'line', 'line']);
    expect(allFiniteAndClean(geometries)).toBe(true);
  });

  it('com o espaçamento padrão (96) e o raio padrão (20), vizinhos do círculo têm traço visível', () => {
    for (let n = 3; n <= 30; n++) {
      const ciclo = buildGraph({
        vertices: n,
        edges: Array.from({ length: n }, (_, i) => [`v${i + 1}`, `v${((i + 1) % n) + 1}`] as const),
      });
      const geometries = edgeGeometries(ciclo, circularLayout(ciclo));

      expect(geometries).toHaveLength(n);
    }
  });

  it('antes de reconciliar, a aresta sem posição não tem geometria; depois, tem', () => {
    const grafo = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3']] });
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);

    expect(edgeGeometries(grafo, parcial)).toHaveLength(1);

    const reconciliado = reconcileLayout(grafo, parcial);

    expect(edgeGeometries(grafo, reconciliado)).toHaveLength(2);
    // o que já tinha geometria não muda ao reconciliar (as posições existentes são preservadas)
    expect(edgeGeometries(grafo, reconciliado)[0]).toStrictEqual(edgeGeometries(grafo, parcial)[0]);
  });

  it('vértices sobrepostos por escolha do layout não são "consertados": a aresta fica sem geometria', () => {
    const grafo = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const sobreposto = layoutOf('g', [['v1', 10, 10], ['v2', 10, 10]]);
    const antes = JSON.stringify(sobreposto);

    expect(edgeGeometries(grafo, sobreposto)).toStrictEqual([]);
    expect(JSON.stringify(sobreposto)).toBe(antes);
  });
});

// ---------------------------------------------------------------------------------------------
// Propriedades com sementes fixas
// ---------------------------------------------------------------------------------------------

/** Grafo (orientado em ~70% dos casos) com arestas aleatórias e posições aleatórias em [−400, 400]². */
function randomCase(seed: number) {
  const random = seededRandom(seed);
  const n = 3 + Math.floor(random() * 6);
  const directed = random() < 0.7;
  let graph = buildGraph({ vertices: n, directed });
  for (let tentativa = 0; tentativa < n * 4; tentativa++) {
    const a = 1 + Math.floor(random() * n);
    const b = 1 + Math.floor(random() * n);
    const result = a === b ? undefined : addEdge(graph, { source: `v${a}`, target: `v${b}` });
    if (result?.ok) graph = result.value.graph;
  }
  const entries = graph.vertices.map((vertex) => [vertex.id, Math.round((random() * 2 - 1) * 4000) / 10, Math.round((random() * 2 - 1) * 4000) / 10] as const);
  return { graph, layout: layoutOf(graph.id, entries) };
}

describe('geometria: propriedades (sementes fixas)', () => {
  const R = DEFAULT_VERTEX_RADIUS;
  const cross = (u: Point, v: Point): number => u.x * v.y - u.y * v.x;
  const sub = (a: Point, b: Point): Point => point(a.x - b.x, a.y - b.y);

  it('500 casos: ids preservados, extremos na borda, setas na direção do destino, finito e sem -0', () => {
    const contagem = { retas: 0, curvas: 0, setas: 0, semGeometria: 0 };
    for (let seed = 1; seed <= 500; seed++) {
      const { graph, layout } = randomCase(seed);
      const geometries = edgeGeometries(graph, layout);

      expect(allFiniteAndClean(geometries)).toBe(true);
      expect(new Set(geometries.map((g) => g.edgeId)).size).toBe(geometries.length);
      contagem.semGeometria += graph.edges.length - geometries.length;
      for (const g of geometries) {
        const edge = graph.edges.find((e) => e.id === g.edgeId)!;
        const a = positionOf(layout, edge.source)!;
        const b = positionOf(layout, edge.target)!;

        expect([g.sourceId, g.targetId]).toStrictEqual([edge.source, edge.target]);
        expect(distance(g.path.from, a)).toBeCloseTo(R, 6);
        expect(distance(g.path.to, b)).toBeCloseTo(R, 6);
        expect(g.arrow !== undefined).toBe(graph.directed);
        if (g.path.kind === 'line') contagem.retas++;
        else contagem.curvas++;
        if (g.arrow !== undefined) {
          contagem.setas++;
          expect(g.arrow.tip).toStrictEqual(g.path.to);
          const direcao = sub(g.arrow.tip, g.arrow.base);
          expect(direcao.x * (b.x - a.x) + direcao.y * (b.y - a.y)).toBeGreaterThan(0); // aponta para o destino
          // as asas ficam em lados opostos do eixo da seta, à mesma distância
          const lado = (asa: Point) => cross(direcao, sub(asa, g.arrow!.base));
          expect(lado(g.arrow.right) * lado(g.arrow.left)).toBeLessThan(0);
          expect(distance(g.arrow.right, g.arrow.base)).toBeCloseTo(distance(g.arrow.left, g.arrow.base), 9);
        }
        expect(edgeGeometry(graph, layout, g.edgeId)).toStrictEqual(g);
      }
      expect(edgeGeometries(graph, layout)).toStrictEqual(geometries);
    }

    expect(contagem.retas).toBeGreaterThan(300);
    expect(contagem.curvas).toBeGreaterThan(100);
    expect(contagem.setas).toBeGreaterThan(300);
    expect(contagem.semGeometria).toBeGreaterThan(0);
  });

  it('arcos opostos: curvas de lados opostos, imagem uma da outra pelo ponto médio e trajetórias diferentes', () => {
    let pares = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const { graph, layout } = randomCase(seed);
      if (!graph.directed) continue;
      const geometries = edgeGeometries(graph, layout);
      for (const g of geometries) {
        const oposta = geometries.find((h) => h.sourceId === g.targetId && h.targetId === g.sourceId);
        if (oposta === undefined || g.path.kind !== 'quadratic' || oposta.path.kind !== 'quadratic') continue;
        pares++;
        const a = positionOf(layout, g.sourceId)!;
        const b = positionOf(layout, g.targetId)!;
        const meio = point((a.x + b.x) / 2, (a.y + b.y) / 2);
        const reflexo = (p: Point) => point(2 * meio.x - p.x, 2 * meio.y - p.y);
        const lado = (curva: Point) => cross(sub(b, a), sub(curva, a));

        expect(distance(g.path.control, meio)).toBeCloseTo(DEFAULT_CURVATURE * distance(a, b), 6); // curvatura · d
        expect(lado(g.path.control) * lado(oposta.path.control)).toBeLessThan(0);
        expect(lado(g.path.control)).toBeGreaterThan(0); // a direita de a → b, com Y para baixo
        expect(distance(reflexo(g.path.from), oposta.path.from)).toBeLessThan(1e-6);
        expect(distance(reflexo(g.path.to), oposta.path.to)).toBeLessThan(1e-6);
        expect(distance(reflexo(g.path.control), oposta.path.control)).toBeLessThan(1e-6);
        expect(distance(g.labelAnchor, oposta.labelAnchor)).toBeGreaterThan(2 * R * 0.1);
        expect(g.labelAnchor).toStrictEqual(quadraticPoint(g.path, 0.5));
      }
    }

    expect(pares).toBeGreaterThan(100);
  });

  it('inverter a direção de uma aresta inverte a seta: a ponta passa para a outra extremidade', () => {
    let casos = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const random = seededRandom(seed);
      const a = point(Math.round((random() * 2 - 1) * 3000) / 10, Math.round((random() * 2 - 1) * 3000) / 10);
      const b = point(Math.round((random() * 2 - 1) * 3000) / 10, Math.round((random() * 2 - 1) * 3000) / 10);
      const layout = layoutOf('g', [['v1', a.x, a.y], ['v2', b.x, b.y]]);
      const ida = edgeGeometries(buildGraph({ vertices: 2, edges: [['v1', 'v2']], directed: true }), layout)[0];
      const volta = edgeGeometries(buildGraph({ vertices: 2, edges: [['v2', 'v1']], directed: true }), layout)[0];
      if (ida === undefined || volta === undefined) continue;
      casos++;

      expect(distance(ida.arrow!.tip, b)).toBeCloseTo(R, 6);
      expect(distance(volta.arrow!.tip, a)).toBeCloseTo(R, 6);
      const dIda = sub(ida.arrow!.tip, ida.arrow!.base);
      const dVolta = sub(volta.arrow!.tip, volta.arrow!.base);
      expect(dIda.x + dVolta.x).toBeCloseTo(0, 9);
      expect(dIda.y + dVolta.y).toBeCloseTo(0, 9);
    }

    expect(casos).toBeGreaterThan(100);
  });

  it('o resultado não depende da ordem das arestas no grafo (cada sentido tem a mesma geometria)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { graph, layout } = randomCase(seed);
      const invertido = buildGraph({
        vertices: graph.vertices.length,
        directed: graph.directed,
        edges: [...graph.edges].reverse().map((e) => [e.source, e.target] as const),
      });
      const chave = (g: EdgeGeometry) => `${g.sourceId}>${g.targetId}`;
      const por = (g: Graph) => new Map(edgeGeometries(g, layout).map((x) => [chave(x), { ...x, edgeId: '' }]));
      const normal = por(graph);
      const outro = por(invertido);

      expect([...outro.keys()].sort()).toStrictEqual([...normal.keys()].sort());
      for (const [k, g] of normal) expect(outro.get(k)).toStrictEqual(g);
    }
  });

  it('as entradas não são alteradas e a mesma entrada dá o mesmo resultado', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { graph, layout } = randomCase(seed);
      const antes = JSON.stringify([graph, layout]);
      const primeira = edgeGeometries(graph, layout);

      expect(JSON.stringify([graph, layout])).toBe(antes);
      expect(edgeGeometries(graph, layout)).toStrictEqual(primeira);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3B: hit-testing
// ---------------------------------------------------------------------------------------------

/** As câmeras do teste: escalas 0,25, 1 e 4, com translações positivas, negativas e nulas. */
const CAMERAS: readonly Camera[] = [
  ...[0.25, 1, 4].flatMap((scale) => [
    { x: 0, y: 0, scale },
    { x: 120, y: -80, scale },
    { x: -300, y: 200, scale },
  ]),
];

/** Raio da área de toque do vértice na tela, em dp, nas condições padrão (raio visual 20 mundo, alvo mínimo de 48 dp). */
const reach = (scale: number): number => Math.max(DEFAULT_MIN_TOUCH_DIAMETER / 2, DEFAULT_VERTEX_RADIUS * scale);

describe('distanceToSegment (valores calculados à mão)', () => {
  const a = point(0, 0);
  const b = point(10, 0);

  it.each([
    ['ao lado do segmento', point(5, 3), 3],
    ['sobre o segmento', point(7, 0), 0],
    ['além da extremidade b (não é a reta infinita)', point(13, 4), 5],
    ['além da extremidade a', point(-3, 4), 5],
    ['sobre a extremidade', point(10, 0), 0],
  ])('%s', (_nome, p, esperado) => {
    expect(distanceToSegment(p, a, b)).toBeCloseTo(esperado, 12);
  });

  it('a reta infinita diria 3, o segmento diz hypot(10, 3): o ponto (20, 3) está longe do segmento', () => {
    expect(distanceToSegment(point(20, 3), a, b)).toBeCloseTo(Math.hypot(10, 3), 12);
  });

  it('segmento diagonal 3-4-5: de (4, 3) a (0,0)–(3,4) são 1,4 (projeção em t = 0,96)', () => {
    expect(distanceToSegment(point(4, 3), point(0, 0), point(3, 4))).toBeCloseTo(Math.hypot(1.12, 0.84), 12);
  });

  it('segmento degenerado (a = b): a distância ao ponto', () => {
    expect(distanceToSegment(point(3, 4), point(0, 0), point(0, 0))).toBe(5);
  });
});

describe('distanceToCurve: poligonal de Bézier', () => {
  const curve: QuadraticCurve = { kind: 'quadratic', from: point(0, 0), control: point(50, 100), to: point(100, 0) };

  it('o ápice da curva é B(½) = (50, 50), e a distância dali é 0 (a amostra t = ½ cai nele)', () => {
    expect(quadraticPoint(curve, 0.5)).toStrictEqual({ x: 50, y: 50 });
    expect(distanceToCurve(point(50, 50), curve, DEFAULT_CURVE_SAMPLES)).toBeCloseTo(0, 12);
  });

  it('quadraticPoint normaliza -0: nenhuma coordenada do resultado é -0', () => {
    // em t = 1 os pesos são (0, 0, 1); 0 · negativo dá -0, e -0 + -0 + -0 continuaria -0 sem a normalização
    const comMenosZero: QuadraticCurve = { kind: 'quadratic', from: point(-5, -5), control: point(-3, -3), to: point(-0, -0) };
    const ponto = quadraticPoint(comMenosZero, 1);

    expect(Object.is(ponto.x, 0)).toBe(true);
    expect(Object.is(ponto.y, 0)).toBe(true);
  });

  it('(50, 60) está a 10 do ápice (a tangente ali é horizontal)', () => {
    expect(distanceToCurve(point(50, 60), curve, DEFAULT_CURVE_SAMPLES)).toBeCloseTo(10, 9);
  });

  it('a corda NÃO conta: (50, 0) está sobre a corda e bem longe da curva (≈ 43,5)', () => {
    expect(distanceToCurve(point(50, 0), curve, DEFAULT_CURVE_SAMPLES)).toBeGreaterThan(40);
  });

  it('os extremos pertencem à curva', () => {
    expect(distanceToCurve(point(0, 0), curve, DEFAULT_CURVE_SAMPLES)).toBe(0);
    expect(distanceToCurve(point(100, 0), curve, DEFAULT_CURVE_SAMPLES)).toBe(0);
  });

  it('erro da poligonal ≤ h²·|C − m|/2 em relação a uma amostragem densa (sementes fixas)', () => {
    const random = seededRandom(77);
    for (let caso = 0; caso < 300; caso++) {
      const grande = (): number => (random() * 2 - 1) * 400;
      const c: QuadraticCurve = { kind: 'quadratic', from: point(grande(), grande()), control: point(grande(), grande()), to: point(grande(), grande()) };
      const p = point(grande(), grande());
      let denso = Infinity;
      for (let i = 0; i <= 20000; i++) denso = Math.min(denso, distance(p, quadraticPoint(c, i / 20000)));
      const meio = point((c.from.x + c.to.x) / 2, (c.from.y + c.to.y) / 2);
      const limite = (distance(c.control, meio) / (DEFAULT_CURVE_SAMPLES * DEFAULT_CURVE_SAMPLES)) / 2;
      const aproximado = distanceToCurve(p, c, DEFAULT_CURVE_SAMPLES);

      // a poligonal fica dentro da curva do lado côncavo (distância menor) e fora do convexo (maior), nunca além do desvio máximo
      expect(Math.abs(aproximado - denso)).toBeLessThanOrEqual(limite + 1e-9);
    }
  });

  it('mais amostras, menos erro: 1 segmento é a corda; 256 quase coincide com a curva', () => {
    const umSegmento = distanceToCurve(point(50, 50), curve, 1);
    const muitos = distanceToCurve(point(50, 50), curve, 256);

    expect(umSegmento).toBeCloseTo(50, 9); // a corda está em y = 0
    expect(muitos).toBeLessThan(1e-9);
  });
});

describe('hitTestVertex', () => {
  const grafo = buildGraph({ vertices: 2 });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 1000, 0]]);

  it('o toque no centro acerta o vértice, a distância 0, com qualquer câmera', () => {
    for (const camera of CAMERAS) {
      expect(hitTestVertex(grafo, layout, camera, worldToScreen(camera, point(0, 0)))).toStrictEqual({ vertexId: 'v1', distance: 0 });
      expect(hitTestVertex(grafo, layout, camera, worldToScreen(camera, point(1000, 0)))).toStrictEqual({ vertexId: 'v2', distance: 0 });
    }
  });

  it('o alcance é max(24 dp, 20·escala): 24 nas escalas 0,25 e 1 e 80 em 4, nas fronteiras exatas e 1 dp além', () => {
    for (const camera of CAMERAS) {
      const centro = worldToScreen(camera, point(0, 0));
      const alcance = reach(camera.scale);
      const em = (distancia: number) => hitTestVertex(grafo, layout, camera, point(centro.x + distancia, centro.y));

      expect(em(alcance)?.vertexId).toBe('v1'); // a borda conta
      expect(em(alcance - 1)?.vertexId).toBe('v1');
      expect(em(alcance + 1)).toBeUndefined();
      expect(em(alcance)?.distance).toBeCloseTo(alcance, 9);
    }
  });

  it('com zoom afastado (0,25) o círculo visual tem 5 dp, mas o alvo continua com 48 dp de diâmetro', () => {
    const camera: Camera = { x: 50, y: 50, scale: 0.25 };
    const centro = worldToScreen(camera, point(0, 0));

    expect(DEFAULT_VERTEX_RADIUS * camera.scale).toBe(5);
    expect(hitTestVertex(grafo, layout, camera, point(centro.x + 23, centro.y))?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, layout, camera, point(centro.x, centro.y - 23))?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, layout, camera, point(centro.x + 25, centro.y))).toBeUndefined();
  });

  it('com zoom aproximado (4) vale o raio visual: 80 dp', () => {
    const camera: Camera = { x: -300, y: 200, scale: 4 };
    const centro = worldToScreen(camera, point(0, 0));

    expect(hitTestVertex(grafo, layout, camera, point(centro.x + 79, centro.y))?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, layout, camera, point(centro.x + 81, centro.y))).toBeUndefined();
  });

  it('fora da área de interação, nenhum vértice (falsos positivos)', () => {
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(500, 500))).toBeUndefined();
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(24.5, 0))).toBeUndefined();
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(-17, 18))).toBeUndefined(); // hypot = 24,7
  });

  it('vértices sobrepostos: vence o de centro mais próximo do toque', () => {
    const dois = buildGraph({ vertices: 2 });
    const sobrepostos = layoutOf('g', [['v1', 0, 0], ['v2', 10, 0]]);

    expect(hitTestVertex(dois, sobrepostos, NEUTRAL_CAMERA, point(4, 0))).toStrictEqual({ vertexId: 'v1', distance: 4 });
    expect(hitTestVertex(dois, sobrepostos, NEUTRAL_CAMERA, point(6, 0))).toStrictEqual({ vertexId: 'v2', distance: 4 });
    expect(hitTestVertex(dois, sobrepostos, NEUTRAL_CAMERA, point(14, 7))?.vertexId).toBe('v2');
  });

  it('empate exato: vence o primeiro na ordem de inserção do grafo (não o menor id nem o mais próximo no array do layout)', () => {
    const dois = buildGraph({ vertices: 2 });
    const sobrepostos = layoutOf('g', [['v2', 10, 0], ['v1', 0, 0]]); // layout inserido ao contrário

    expect(hitTestVertex(dois, sobrepostos, NEUTRAL_CAMERA, point(5, 0))?.vertexId).toBe('v1');
    // grafo com os vértices em outra ordem de inserção (como pode vir de um documento): v2 antes de v1
    const trocados: Graph = { ...dois, vertices: [dois.vertices[1]!, dois.vertices[0]!] };

    expect(hitTestVertex(trocados, sobrepostos, NEUTRAL_CAMERA, point(5, 0))?.vertexId).toBe('v2');
  });

  it('mesma posição: o empate é de todos os pontos, e vence o primeiro', () => {
    const dois = buildGraph({ vertices: 2 });
    const iguais = layoutOf('g', [['v1', 7, 7], ['v2', 7, 7]]);

    expect(hitTestVertex(dois, iguais, NEUTRAL_CAMERA, point(0, 0))?.vertexId).toBe('v1');
    expect(hitTestVertex(dois, iguais, NEUTRAL_CAMERA, point(7, 7))).toStrictEqual({ vertexId: 'v1', distance: 0 });
  });

  it('vértices extremamente próximos (0,001 de distância): ainda se distinguem pela distância ao centro', () => {
    const dois = buildGraph({ vertices: 2 });
    const colados = layoutOf('g', [['v1', 0, 0], ['v2', 0.001, 0]]);

    expect(hitTestVertex(dois, colados, NEUTRAL_CAMERA, point(-1, 0))?.vertexId).toBe('v1');
    expect(hitTestVertex(dois, colados, NEUTRAL_CAMERA, point(1, 0))?.vertexId).toBe('v2');
  });

  it('vértice sem posição não é acertado; vértice isolado e grafo vazio funcionam', () => {
    const parcial = layoutOf('g', [['v1', 0, 0]]);

    expect(hitTestVertex(grafo, parcial, NEUTRAL_CAMERA, point(0, 0))?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, emptyLayout('g'), NEUTRAL_CAMERA, point(0, 0))).toBeUndefined();
    expect(hitTestVertex(buildGraph({ vertices: 0 }), emptyLayout('g'), NEUTRAL_CAMERA, point(0, 0))).toBeUndefined();
    expect(hitTestVertex(buildGraph({ vertices: 1 }), layoutOf('g', [['v1', -50, -50]]), NEUTRAL_CAMERA, point(-50, -50))?.vertexId).toBe('v1');
  });

  it('opções: o alvo mínimo e o raio visual são configuráveis; inválidas valem o padrão', () => {
    const centro = point(0, 0);

    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(40, 0), { minTouchDiameter: 100 })?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(40, 0), { vertexRadius: 45 })?.vertexId).toBe('v1');
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(30, 0), { minTouchDiameter: 20, vertexRadius: 5 })).toBeUndefined();
    for (const invalido of [Number.NaN, 0, -48, Number.POSITIVE_INFINITY]) {
      expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(25, 0), { minTouchDiameter: invalido })).toBeUndefined();
      expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, centro, { minTouchDiameter: invalido })?.vertexId).toBe('v1');
    }
  });

  it('entradas inválidas: câmera, toque ou layout de outro grafo dão undefined, sem exceção', () => {
    const centro = point(0, 0);

    for (const camera of [
      { x: 0, y: 0, scale: 0 },
      { x: 0, y: 0, scale: -1 },
      { x: Number.NaN, y: 0, scale: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, scale: 1 },
      { x: 0, y: 0, scale: Number.NaN },
    ]) {
      expect(hitTestVertex(grafo, layout, camera, centro)).toBeUndefined();
    }
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(Number.NaN, 0))).toBeUndefined();
    expect(hitTestVertex(grafo, layout, NEUTRAL_CAMERA, point(0, Number.POSITIVE_INFINITY))).toBeUndefined();
    expect(hitTestVertex(grafo, layoutOf('outro', [['v1', 0, 0]]), NEUTRAL_CAMERA, centro)).toBeUndefined();
  });

  it('alcance que estoura (raio gigante × escala) não vira "acerta tudo": nenhum vértice', () => {
    expect(hitTestVertex(grafo, layout, { x: 0, y: 0, scale: 4 }, point(5000, 5000), { vertexRadius: 1e308 })).toBeUndefined();
    expect(hitTest(grafo, layout, { x: 0, y: 0, scale: 4 }, point(5000, 5000), { vertexRadius: 1e308 })).toStrictEqual({ type: 'background' });
  });

  it('coordenadas enormes: sem exceção e sem acertar o que não existe na tela', () => {
    const longe = layoutOf('g', [['v1', 1.7e308, 1.7e308], ['v2', -1.7e308, 0]]);

    expect(hitTestVertex(grafo, longe, { x: 0, y: 0, scale: 4 }, point(0, 0))).toBeUndefined();
    expect(hitTestVertex(grafo, longe, NEUTRAL_CAMERA, point(0, 0))).toBeUndefined();
  });

  it('só lê vértices e o layout: nunca as arestas (Θ(V))', () => {
    const comArestas = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
    const semLerArestas = { ...comArestas };
    Object.defineProperty(semLerArestas, 'edges', {
      get() {
        throw new Error('hitTestVertex não deve ler arestas');
      },
    });

    expect(hitTestVertex(semLerArestas, layout, NEUTRAL_CAMERA, point(0, 0))?.vertexId).toBe('v1');
  });
});

describe('hitTestEdge: retas', () => {
  const grafo = buildGraph({ vertices: 2, edges: [['v1', 'v2']] });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]); // o traço vai de (20, 0) a (80, 0)
  const edgeId = grafo.edges[0]!.id;

  it('sobre o traço, a distância é 0; a 12 dp (a tolerância) ainda acerta, e um pouco além, não', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 0))).toStrictEqual({ edgeId, distance: 0 });
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 12))).toStrictEqual({ edgeId, distance: 12 });
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, -12))?.edgeId).toBe(edgeId);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 12.001))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, -13))).toBeUndefined();
  });

  it('a distância é ao SEGMENTO: além da ponta, não ao longo da reta infinita', () => {
    // (76, 14): fora da área do vértice v2 (hypot(24, 14) = 27,8 > 24), a 14,0 do traço (que termina em x = 80)... longe
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(60, 30))).toBeUndefined();
    // a reta infinita y = 0 passaria por (150, 0), mas o segmento termina em x = 80 e o vértice v2 só cobre até x = 124
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(150, 0))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(-60, 0))).toBeUndefined();
  });

  it('a tolerância é em dp: com qualquer escala e deslocamento, 11 dp acerta e 13 dp não', () => {
    const longe = layoutOf('g', [['v1', 0, 0], ['v2', 2000, 0]]); // meio do traço em x = 1000 (mundo), longe dos dois vértices

    for (const camera of CAMERAS) {
      const meio = worldToScreen(camera, point(1000, 0));
      const dentro = hitTestEdge(grafo, longe, camera, point(meio.x, meio.y + 11));
      const fora = hitTestEdge(grafo, longe, camera, point(meio.x, meio.y + 13));

      expect(dentro?.edgeId).toBe(edgeId);
      expect(dentro?.distance).toBeCloseTo(11, 9);
      expect(fora).toBeUndefined();
    }
  });

  it('a tolerância é configurável (e inválida vale o padrão)', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 20), { edgeTolerance: 25 })?.edgeId).toBe(edgeId);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 5), { edgeTolerance: 3 })).toBeUndefined();
    // tolerância 0 é válida: só o traço exato acerta (e não vale o padrão 12)
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 0), { edgeTolerance: 0 })?.edgeId).toBe(edgeId);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 5), { edgeTolerance: 0 })).toBeUndefined();
    for (const invalido of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 12), { edgeTolerance: invalido })?.edgeId).toBe(edgeId);
      expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 13), { edgeTolerance: invalido })).toBeUndefined();
    }
    expect(DEFAULT_EDGE_TOLERANCE).toBe(12);
  });

  it('as opções de geometria (raio visual) valem também no hit-test: o traço começa na borda configurada', () => {
    const opcoes = { vertexRadius: 10, minTouchDiameter: 10, edgeTolerance: 3 };

    // com raio 10 o traço vai de x = 10 a x = 90; (12, 0) está fora da área do vértice (alcance 10) e sobre o traço
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(12, 0), opcoes)?.edgeId).toBe(edgeId);
    // com o raio padrão o traço só começa em x = 20, a 8 do toque: fora da tolerância de 3
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(12, 0), { minTouchDiameter: 10, edgeTolerance: 3 })).toBeUndefined();
  });

  it('um toque na área de um vértice NUNCA seleciona aresta, mesmo sobre o traço', () => {
    // (22, 5): hypot = 22,6 ≤ 24 → dentro da área de v1; a distância ao traço seria 5
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(22, 5))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(100, 0))).toBeUndefined(); // centro de v2
    // 0,1 dp fora da área de v1 (alcance 24, em x = 24,1) e sobre o traço: aresta
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(24.1, 0))?.edgeId).toBe(edgeId);
  });

  it('com zoom aproximado a área do vértice cresce e engole o começo do traço', () => {
    const camera: Camera = { x: 0, y: 0, scale: 4 }; // v1 em (0, 0) com alcance 80; traço em x = 80..320 (tela)

    expect(hitTestEdge(grafo, layout, camera, point(70, 0))).toBeUndefined(); // dentro da área de v1
    expect(hitTestEdge(grafo, layout, camera, point(85, 5))?.edgeId).toBe(edgeId);
  });

  it('desempate por menor distância; empate exato → a primeira aresta inserida', () => {
    const quatro = buildGraph({ vertices: 4, edges: [['v1', 'v2'], ['v3', 'v4']] });
    const paralelas = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0], ['v3', 0, 20], ['v4', 200, 20]]);
    const [e1, e2] = quatro.edges;

    expect(hitTestEdge(quatro, paralelas, NEUTRAL_CAMERA, point(100, 4))).toStrictEqual({ edgeId: e1!.id, distance: 4 });
    expect(hitTestEdge(quatro, paralelas, NEUTRAL_CAMERA, point(100, 16))).toStrictEqual({ edgeId: e2!.id, distance: 4 });
    // a meio caminho (distância 10 das duas) vence a primeira
    expect(hitTestEdge(quatro, paralelas, NEUTRAL_CAMERA, point(100, 10))).toStrictEqual({ edgeId: e1!.id, distance: 10 });
    // inserindo as arestas na ordem inversa, vence a outra
    const invertido = buildGraph({ vertices: 4, edges: [['v3', 'v4'], ['v1', 'v2']] });

    expect(hitTestEdge(invertido, paralelas, NEUTRAL_CAMERA, point(100, 10))?.edgeId).toBe(invertido.edges[0]!.id);
    expect(invertido.edges[0]!.source).toBe('v3');
  });

  it('arestas que se cruzam: perto do cruzamento vence a mais próxima; exatamente nele, o resultado é um dos dois e estável', () => {
    const x = buildGraph({ vertices: 4, edges: [['v1', 'v2'], ['v3', 'v4']] });
    const cruzadas = layoutOf('g', [['v1', 0, 0], ['v2', 200, 200], ['v3', 200, 0], ['v4', 0, 200]]);
    const [e1, e2] = x.edges;

    expect(hitTestEdge(x, cruzadas, NEUTRAL_CAMERA, point(110, 110))?.edgeId).toBe(e1!.id); // sobre y = x
    expect(hitTestEdge(x, cruzadas, NEUTRAL_CAMERA, point(110, 90))?.edgeId).toBe(e2!.id); // sobre x + y = 200
    expect(hitTestEdge(x, cruzadas, NEUTRAL_CAMERA, point(90, 110))?.edgeId).toBe(e2!.id);
    const noCruzamento = hitTestEdge(x, cruzadas, NEUTRAL_CAMERA, point(100, 100));

    expect([e1!.id, e2!.id]).toContain(noCruzamento?.edgeId);
    expect(noCruzamento?.distance).toBeLessThan(1e-9);
    expect(hitTestEdge(x, cruzadas, NEUTRAL_CAMERA, point(100, 100))).toStrictEqual(noCruzamento);
  });

  it('aresta sem geometria (ponta sem posição, vértices colados) nunca é acertada', () => {
    const tres = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3']] });
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const colados = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0], ['v3', 210, 0]]);

    expect(hitTestEdge(tres, parcial, NEUTRAL_CAMERA, point(300, 0))).toBeUndefined();
    expect(hitTestEdge(tres, colados, NEUTRAL_CAMERA, point(205, 0))).toBeUndefined(); // dentro das áreas dos vértices
    expect(hitTestEdge(tres, colados, NEUTRAL_CAMERA, point(100, 0))?.edgeId).toBe(tres.edges[0]!.id);
  });

  it('entradas inválidas: câmera, toque ou layout de outro grafo dão undefined', () => {
    expect(hitTestEdge(grafo, layout, { x: 0, y: 0, scale: 0 }, point(50, 0))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(Number.NaN, 0))).toBeUndefined();
    expect(hitTestEdge(grafo, layoutOf('outro', [['v1', 0, 0], ['v2', 100, 0]]), NEUTRAL_CAMERA, point(50, 0))).toBeUndefined();
  });
});

describe('hitTestEdge: arcos opostos (curvas)', () => {
  const grafo = buildGraph({ vertices: 2, edges: [['v1', 'v2'], ['v2', 'v1']], directed: true });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0]]);
  const ida = grafo.edges[0]!;
  const volta = grafo.edges[1]!;

  it('cada curva acerta no seu lado: (50; 20) é v1 → v2 e (50; −20) é v2 → v1', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 20))?.edgeId).toBe(ida.id);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, -20))?.edgeId).toBe(volta.id);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 20))?.distance).toBeCloseTo(0.145, 2);
  });

  it('a corda entre os vértices não acerta nada (só a curva): (50, 0) fica a ≈ 20 das duas', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 0))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(40, 0))).toBeUndefined();
  });

  it('a tolerância mede a distância à CURVA: apex em y = 20,145, então y = 9 acerta (11,1) e y = 8 não (12,1)', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 9))?.edgeId).toBe(ida.id);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 8))).toBeUndefined();
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, -9))?.edgeId).toBe(volta.id);
  });

  it('com zoom ≥ 1 e qualquer deslocamento, o toque no ápice de cada curva acerta a curva certa', () => {
    // com escala 0,25 o ápice (50, ±20) cai a ≈ 13 dp do centro de v1, dentro da área de toque mínima de 48 dp, e o vértice vence
    for (const camera of CAMERAS.filter((c) => c.scale >= 1)) {
      for (const [indice, edge] of [ida, volta].entries()) {
        const geometry = edgeGeometries(grafo, layout)[indice]!;
        const toque = worldToScreen(camera, geometry.labelAnchor);

        expect(hitTest(grafo, layout, camera, toque)).toStrictEqual({ type: 'edge', edgeId: edge.id, distance: expect.closeTo(0, 6) });
      }
    }
  });

  it('o número de amostras vale: com 1 segmento a curva vira a corda da curva (y ≈ 10,29), e (50, 10) passa a acertar', () => {
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 10), { curveSamples: 1 })?.edgeId).toBe(ida.id);
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, point(50, 20), { curveSamples: 1 })?.edgeId).toBe(ida.id); // 9,7 da corda
    expect(DEFAULT_CURVE_SAMPLES).toBe(24);
  });

  it('`curveSamples` inválido vale o padrão (24) e acima de 256 vale 256; o resultado é o mesmo em todos esses casos', () => {
    const toque = point(50, 18.7);
    const padrao = hitTestEdge(grafo, layout, NEUTRAL_CAMERA, toque);

    expect(padrao?.edgeId).toBe(ida.id);
    for (const invalido of [Number.NaN, 0, -3, 1.5, Number.POSITIVE_INFINITY]) {
      expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, toque, { curveSamples: invalido })).toStrictEqual(padrao);
    }
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, toque, { curveSamples: 1e9 })).toStrictEqual(
      hitTestEdge(grafo, layout, NEUTRAL_CAMERA, toque, { curveSamples: 256 }),
    );
    // e mais amostras aproximam a distância verdadeira (a poligonal de 24 segmentos erra por menos de 0,02 dp aqui)
    expect(hitTestEdge(grafo, layout, NEUTRAL_CAMERA, toque, { curveSamples: 256 })!.distance).toBeCloseTo(padrao!.distance, 1);
  });
});

describe('hitTest: alvo combinado', () => {
  const grafo = buildGraph({ vertices: 3, edges: [['v1', 'v2']] });
  const layout = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0], ['v3', 100, 300]]);
  const edgeId = grafo.edges[0]!.id;

  it('o discriminado: vértice, aresta ou fundo, cada um com o que lhe cabe', () => {
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(0, 0))).toStrictEqual({ type: 'vertex', vertexId: 'v1', distance: 0 });
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(50, 3))).toStrictEqual({ type: 'edge', edgeId, distance: 3 });
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(50, 100))).toStrictEqual({ type: 'background' });
  });

  it('prioridade: o vértice vence a aresta quando o toque está nas duas áreas; fora da área do vértice, a aresta', () => {
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(22, 4))).toMatchObject({ type: 'vertex', vertexId: 'v1' });
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(30, 4))).toMatchObject({ type: 'edge', edgeId });
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(76, 0))).toMatchObject({ type: 'vertex', vertexId: 'v2' });
  });

  it('o fundo é fundo mesmo com o toque a 13 dp da aresta; vértice isolado é acertado como qualquer outro', () => {
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(50, 13))).toStrictEqual({ type: 'background' });
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(100, 300))).toMatchObject({ type: 'vertex', vertexId: 'v3' });
  });

  it('grafo vazio e layout vazio: fundo (e não undefined: undefined é só entrada inválida)', () => {
    expect(hitTest(buildGraph({ vertices: 0 }), emptyLayout('g'), NEUTRAL_CAMERA, point(5, 5))).toStrictEqual({ type: 'background' });
    expect(hitTest(grafo, emptyLayout('g'), NEUTRAL_CAMERA, point(5, 5))).toStrictEqual({ type: 'background' });
  });

  it('entrada inválida: undefined (câmera, toque ou layout de outro grafo)', () => {
    expect(hitTest(grafo, layout, { x: 0, y: 0, scale: Number.NaN }, point(0, 0))).toBeUndefined();
    expect(hitTest(grafo, layout, NEUTRAL_CAMERA, point(0, Number.NaN))).toBeUndefined();
    expect(hitTest(grafo, layoutOf('outro', [['v1', 0, 0]]), NEUTRAL_CAMERA, point(0, 0))).toBeUndefined();
  });

  it('quando acerta um vértice, não lê as arestas (Θ(V))', () => {
    const semLerArestas = { ...grafo };
    Object.defineProperty(semLerArestas, 'edges', {
      get() {
        throw new Error('hitTest não deve ler arestas se acertou um vértice');
      },
    });

    expect(hitTest(semLerArestas, layout, NEUTRAL_CAMERA, point(0, 0))).toMatchObject({ type: 'vertex' });
  });

  it('não altera os argumentos (entradas congeladas) e é determinístico', () => {
    const congelado = deepFreeze(JSON.parse(JSON.stringify(grafo)) as Graph);
    const antes = JSON.stringify([grafo, layout]);

    for (const toque of [point(0, 0), point(50, 3), point(50, 100)]) {
      expect(hitTest(congelado, layout, NEUTRAL_CAMERA, toque)).toStrictEqual(hitTest(grafo, layout, NEUTRAL_CAMERA, toque));
    }
    expect(JSON.stringify([grafo, layout])).toBe(antes);
  });
});

describe('hit-testing com circularLayout e reconcileLayout', () => {
  it('em um ciclo orientado de 6 vértices, tocar em cada vértice e no meio de cada aresta acerta o elemento certo', () => {
    const n = 6;
    const ciclo = buildGraph({
      vertices: n,
      directed: true,
      edges: Array.from({ length: n }, (_, i) => [`v${i + 1}`, `v${((i + 1) % n) + 1}`] as const),
    });
    const layout = circularLayout(ciclo); // raio 96 (corda = 96): vizinhos a 96 unidades
    const geometries = edgeGeometries(ciclo, layout);

    expect(geometries).toHaveLength(n);
    for (const camera of CAMERAS) {
      // com escala pequena as áreas de vértices vizinhos (48 dp) engolem as arestas; testa só quando há folga
      for (const vertex of ciclo.vertices) {
        const toque = worldToScreen(camera, positionOf(layout, vertex.id)!);

        expect(hitTest(ciclo, layout, camera, toque)).toMatchObject({ type: 'vertex', vertexId: vertex.id });
      }
      if (camera.scale >= 1) {
        for (const g of geometries) {
          expect(hitTest(ciclo, layout, camera, worldToScreen(camera, g.labelAnchor))).toMatchObject({ type: 'edge', edgeId: g.edgeId });
        }
      }
    }
  });

  it('o vértice recém-criado por reconcileLayout passa a ser acertado; antes, não', () => {
    const grafo = buildGraph({ vertices: 3, edges: [['v1', 'v2'], ['v2', 'v3']] });
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const reconciliado = reconcileLayout(grafo, parcial);
    const onde = positionOf(reconciliado, 'v3')!;

    // o centroide (100, 0) de v1 e v2 está sobre a aresta v1–v2: antes de reconciliar o toque ali acerta a aresta, nunca v3
    expect(hitTest(grafo, parcial, NEUTRAL_CAMERA, onde)).toMatchObject({ type: 'edge', edgeId: grafo.edges[0]!.id });
    expect(hitTest(grafo, reconciliado, NEUTRAL_CAMERA, onde)).toMatchObject({ type: 'vertex', vertexId: 'v3' });
  });

  it('toque convertido de tela para mundo e de volta acerta o mesmo vértice (screenToWorld ∘ worldToScreen)', () => {
    const grafo = buildGraph({ vertices: 3 });
    const layout = layoutOf('g', [['v1', 10, 20], ['v2', 400, -300], ['v3', -250, 90]]);

    for (const camera of CAMERAS) {
      const mundo = screenToWorld(camera, worldToScreen(camera, positionOf(layout, 'v2')!));

      expect(hitTest(grafo, layout, camera, worldToScreen(camera, mundo))).toMatchObject({ type: 'vertex', vertexId: 'v2' });
    }
  });
});

describe('hit-testing: propriedades (sementes fixas)', () => {
  /** Distância mundo-pura de `p` ao traço, por amostragem densa e SEM usar o código testado (só `quadraticPoint`). */
  function worldDistance(g: EdgeGeometry, p: Point): number {
    if (g.path.kind === 'line') {
      // projeção exata, escrita aqui de forma independente de `distanceToSegment`
      const ux = g.path.to.x - g.path.from.x;
      const uy = g.path.to.y - g.path.from.y;
      const t = Math.max(0, Math.min(1, ((p.x - g.path.from.x) * ux + (p.y - g.path.from.y) * uy) / (ux * ux + uy * uy)));
      return distance(p, point(g.path.from.x + t * ux, g.path.from.y + t * uy));
    }
    // curva: busca grossa (400 amostras) e refinamento ternário em torno do melhor t, até ≈ 1e-9
    const curva = g.path;
    const aT = (t: number): number => distance(p, quadraticPoint(curva, t));
    let melhor = 0;
    for (let i = 1; i <= 400; i++) if (aT(i / 400) < aT(melhor / 400)) melhor = i;
    let baixo = Math.max(0, (melhor - 1) / 400);
    let alto = Math.min(1, (melhor + 1) / 400);
    for (let passo = 0; passo < 40; passo++) {
      const a = baixo + (alto - baixo) / 3;
      const b = alto - (alto - baixo) / 3;
      if (aT(a) < aT(b)) alto = b;
      else baixo = a;
    }
    return aT((baixo + alto) / 2);
  }

  /** Cota do erro da poligonal (cabeçalho de geometry.ts), em dp: `|C − m| / (2·N²)` na tela; zero numa reta. */
  const polylineError = (g: EdgeGeometry, scale: number): number =>
    g.path.kind === 'line'
      ? 0
      : (scale * distance(g.path.control, point((g.path.from.x + g.path.to.x) / 2, (g.path.from.y + g.path.to.y) / 2))) /
        (2 * DEFAULT_CURVE_SAMPLES * DEFAULT_CURVE_SAMPLES);

  /** Grafo orientado com vértices numa grade de 300 unidades (bem separados) e arestas aleatórias. */
  function sparseCase(seed: number) {
    const random = seededRandom(seed);
    const n = 4 + Math.floor(random() * 5);
    let graph = buildGraph({ vertices: n, directed: true });
    for (let tentativa = 0; tentativa < n * 3; tentativa++) {
      const a = 1 + Math.floor(random() * n);
      const b = 1 + Math.floor(random() * n);
      const result = a === b ? undefined : addEdge(graph, { source: `v${a}`, target: `v${b}` });
      if (result?.ok) graph = result.value.graph;
    }
    const celulas = Array.from({ length: 16 }, (_, i) => i).sort(() => random() - 0.5);
    const entries = graph.vertices.map((vertex, i) => {
      const celula = celulas[i]!;
      return [vertex.id, (celula % 4) * 300 + Math.round((random() - 0.5) * 60), Math.floor(celula / 4) * 300 + Math.round((random() - 0.5) * 60)] as const;
    });
    return { graph, layout: layoutOf(graph.id, entries) };
  }

  it('um toque que acompanha a transformação do vértice acerta sempre o mesmo vértice, em qualquer zoom e deslocamento', () => {
    let verificados = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const random = seededRandom(1000 + seed);
      const { graph, layout } = sparseCase(seed);
      for (const vertex of graph.vertices) {
        const centro = positionOf(layout, vertex.id)!;
        // deslocamento de até 10 unidades de mundo em cada eixo (≤ 14,2): sempre dentro do círculo visual (raio 20)
        const toqueMundo = point(centro.x + (random() * 2 - 1) * 10, centro.y + (random() * 2 - 1) * 10);
        for (const camera of CAMERAS) {
          const alvo = hitTest(graph, layout, camera, worldToScreen(camera, toqueMundo));

          expect(alvo).toMatchObject({ type: 'vertex', vertexId: vertex.id });
          verificados++;
        }
      }
    }

    expect(verificados).toBeGreaterThan(5000);
  });

  it('um toque sobre o traço acompanha a aresta em qualquer zoom e deslocamento, e a distância em dp é a do mundo vezes a escala', () => {
    let verificados = 0;
    let curvas = 0;
    let medidas = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { graph, layout } = sparseCase(seed);
      const geometries = edgeGeometries(graph, layout);
      for (const g of geometries) {
        for (const [ordem, t] of [0.35, 0.5, 0.65].entries()) {
          const mundo = g.path.kind === 'line'
            ? point(g.path.from.x + (g.path.to.x - g.path.from.x) * t, g.path.from.y + (g.path.to.y - g.path.from.y) * t)
            : quadraticPoint(g.path, t);
          // só as arestas cujo envelope (os pontos de controle contêm a curva) chega a 12 unidades do ponto podem estar perto dele
          const pertoDoEnvelope = (h: EdgeGeometry): boolean => {
            const pontos = h.path.kind === 'line' ? [h.path.from, h.path.to] : [h.path.from, h.path.control, h.path.to];
            return (
              mundo.x >= Math.min(...pontos.map((q) => q.x)) - 12 &&
              mundo.x <= Math.max(...pontos.map((q) => q.x)) + 12 &&
              mundo.y >= Math.min(...pontos.map((q) => q.y)) - 12 &&
              mundo.y <= Math.max(...pontos.map((q) => q.y)) + 12
            );
          };
          const outraMaisPerto = Math.min(Infinity, ...geometries.filter((h) => h !== g && pertoDoEnvelope(h)).map((h) => worldDistance(h, mundo)));
          for (const [posicao, camera] of CAMERAS.entries()) {
            const toque = worldToScreen(camera, mundo);
            // só vale quando o ponto está fora da área de qualquer vértice, e nenhuma outra aresta passa por ali
            const emVertice = graph.vertices.some((v) => distance(toque, worldToScreen(camera, positionOf(layout, v.id)!)) <= reach(camera.scale));
            // (outra aresta a menos de 2 dp + o erro da poligonal: dentro disso a ordem entre traços quase coincidentes é indiferente)
            if (emVertice || outraMaisPerto * camera.scale <= 2 + polylineError(g, camera.scale)) continue;
            const alvo = hitTest(graph, layout, camera, toque);

            expect(alvo).toMatchObject({ type: 'edge', edgeId: g.edgeId });
            verificados++;
            if (g.path.kind === 'quadratic') curvas++;
            // o mesmo toque deslocado 5 dp na tela (numa câmera por ponto, pelo custo do oráculo denso): a distância em dp
            // bate com a distância no MUNDO vezes a escala, a menos do erro da poligonal (cota do cabeçalho: |C − m| / (2·N²))
            if (posicao !== (seed + ordem) % CAMERAS.length) continue;
            const deslocado = point(toque.x + 3, toque.y + 4);
            const hit = hitTestEdge(graph, layout, camera, deslocado);
            if (hit?.edgeId === g.edgeId) {
              const noMundo = screenToWorld(camera, deslocado);
              const esperado = worldDistance(g, noMundo) * camera.scale;
              medidas++;
              expect(Math.abs(hit.distance - esperado)).toBeLessThanOrEqual(polylineError(g, camera.scale) + 1e-6 + (g.path.kind === 'line' ? 0 : 0.01));
            }
          }
        }
      }
    }

    expect(verificados).toBeGreaterThan(1500);
    expect(curvas).toBeGreaterThan(100);
    expect(medidas).toBeGreaterThan(100);
  });

  it('nenhum resultado tem NaN ou Infinity; fora de tudo é fundo; o resultado é determinístico', () => {
    const random = seededRandom(5);
    for (let seed = 1; seed <= 60; seed++) {
      const { graph, layout } = sparseCase(seed);
      for (let k = 0; k < 40; k++) {
        const camera = CAMERAS[Math.floor(random() * CAMERAS.length)]!;
        const toque = point((random() * 2 - 1) * 1500, (random() * 2 - 1) * 1500);
        const alvo = hitTest(graph, layout, camera, toque);

        expect(alvo).toBeDefined();
        expect(allFiniteAndClean(alvo)).toBe(true);
        expect(hitTest(graph, layout, camera, toque)).toStrictEqual(alvo);
        if (alvo?.type === 'vertex') expect(alvo.distance).toBeLessThanOrEqual(reach(camera.scale) + 1e-9);
        if (alvo?.type === 'edge') expect(alvo.distance).toBeLessThanOrEqual(DEFAULT_EDGE_TOLERANCE + 1e-9);
      }
    }
  });

  it('as entradas não são alteradas por nenhuma consulta', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { graph, layout } = sparseCase(seed);
      const antes = JSON.stringify([graph, layout]);
      for (const camera of CAMERAS) hitTest(graph, layout, camera, point(123, 456));

      expect(JSON.stringify([graph, layout])).toBe(antes);
    }
  });
});
