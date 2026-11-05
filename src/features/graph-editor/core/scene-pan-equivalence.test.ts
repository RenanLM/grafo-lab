import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import { buildGraphScene, emptyLayout, panBy, placeVertex, type Camera, type GraphLayout, type Point } from './index';

// Fundamento do pan por deslocamento do grupo do SVG (3.10, ver vertex-drag.tsx): `cena(câmera + d)` é EXATAMENTE `cena(câmera)` deslocada por `d`. Isso vale porque a câmera só soma uma translação
// quando a escala não muda; o raio, a espessura, as setas, a curvatura, os textos e as caixas dos pesos são constantes em dp. Se um dia a cena passar a depender da posição na tela (por exemplo, um
// rótulo que gruda na borda), este teste quebra e o renderizador tem de voltar a refazer a cena a cada quadro do pan.
//
// A comparação é estrutural e cobre TUDO que a cena carrega: vértices, arestas retas, curvas (arcos opostos em grafo orientado), setas, pesos e caixas. Os campos que dependem do recorte
// (`visible`, `outOfView`) e o texto do resumo acessível, que fala do que está fora da área, são ignorados: o renderizador não os usa para desenhar.

const VIEWPORT = { width: 360, height: 324 };
const CAMERAS: readonly Camera[] = [
  { x: 0, y: 0, scale: 1 },
  { x: 37.5, y: -12.25, scale: 1.8 },
  { x: -140, y: 90, scale: 0.4 },
  { x: 11, y: 3, scale: 4 },
];
const SHIFTS: readonly Point[] = [
  { x: 25, y: -10 },
  { x: -137.25, y: 66.5 },
  { x: 400, y: 400 },
];

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

/** Um grafo com de tudo: arestas simples, par de arcos opostos (curvas, no orientado) e pesos (inclusive 0 e negativo). O domínio não admite laços. */
function richGraph(directed: boolean): { graph: Graph; layout: GraphLayout } {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  const spots: readonly (readonly [number, number])[] = [[60, 60], [200, 50], [120, 200], [300, 220], [40, 260]];
  for (const [x, y] of spots) {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, { x, y });
  }
  const edges: readonly { source: string; target: string; weight?: number }[] = [
    { source: 'v1', target: 'v2', weight: 3.5 },
    { source: 'v2', target: 'v3', weight: -2 },
    { source: 'v3', target: 'v4', weight: 0 },
    ...(directed ? [{ source: 'v2', target: 'v1', weight: 7 }, { source: 'v4', target: 'v3' }] : [{ source: 'v4', target: 'v5', weight: 12 }]),
  ];
  for (const edge of edges) graph = must(addEdge(graph, edge)).graph;
  return { graph, layout };
}

const IGNORED_KEYS = new Set(['visible', 'outOfView', 'summary', 'description']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Desloca por `d` todo objeto com `x` e `y` numéricos (pontos e caixas); o resto fica igual. */
function shifted(value: unknown, d: Point): unknown {
  if (Array.isArray(value)) return value.map((item) => shifted(item, d));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = shifted(item, d);
  if (typeof value.x === 'number' && typeof value.y === 'number') {
    out.x = value.x + d.x;
    out.y = value.y + d.y;
  }
  return out;
}

/** Igualdade estrutural com tolerância nos números, ignorando os campos de recorte. Devolve a primeira diferença, ou `undefined`. */
function firstDifference(a: unknown, b: unknown, path = 'cena'): string | undefined {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: tamanhos ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((key) => !IGNORED_KEYS.has(key)));
    for (const key of keys) {
      if (!(key in a) || !(key in b)) return `${path}.${key}: presente só de um lado`;
      const found = firstDifference(a[key], b[key], `${path}.${key}`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

describe('cena(câmera + d) = cena(câmera) deslocada por d (o pan só soma uma translação)', () => {
  for (const directed of [false, true]) {
    for (const camera of CAMERAS) {
      for (const d of SHIFTS) {
        it(`${directed ? 'orientado' : 'não orientado'}, escala ${camera.scale}, câmera (${camera.x}, ${camera.y}), deslocamento (${d.x}, ${d.y})`, () => {
          const { graph, layout } = richGraph(directed);
          const base = buildGraphScene(graph, layout, camera, { viewport: VIEWPORT });
          const panned = buildGraphScene(graph, layout, panBy(camera, d), { viewport: VIEWPORT });

          expect(firstDifference(shifted(base, d), panned)).toBeUndefined();
        });
      }
    }
  }

  it('o oráculo da comparação enxerga um deslocamento errado (a cena NÃO é igual se o deslocamento for outro)', () => {
    const { graph, layout } = richGraph(true);
    const camera = CAMERAS[1]!;
    const base = buildGraphScene(graph, layout, camera, { viewport: VIEWPORT });
    const panned = buildGraphScene(graph, layout, panBy(camera, { x: 25, y: -10 }), { viewport: VIEWPORT });

    expect(firstDifference(shifted(base, { x: 25, y: -9 }), panned)).toBeDefined();
  });

  it('com outra ESCALA a cena não é um deslocamento da anterior (por isso a pinça refaz a cena)', () => {
    const { graph, layout } = richGraph(true);
    const base = buildGraphScene(graph, layout, { x: 0, y: 0, scale: 1 }, { viewport: VIEWPORT });
    const zoomed = buildGraphScene(graph, layout, { x: 0, y: 0, scale: 1.5 }, { viewport: VIEWPORT });

    expect(firstDifference(shifted(base, { x: 0, y: 0 }), zoomed)).toBeDefined();
  });
});
