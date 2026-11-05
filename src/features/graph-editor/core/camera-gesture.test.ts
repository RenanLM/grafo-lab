import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import {
  DEFAULT_SCALE_LIMITS,
  NEUTRAL_CAMERA,
  cameraForResize,
  centerCamera,
  emptyLayout,
  fitGraphCamera,
  panBy,
  panFromAnchor,
  pinchFromAnchor,
  placeVertex,
  sameCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
  type GraphLayout,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Câmera por gesto e por comando (ver camera-gesture.ts). As contas dos exemplos são feitas à mão; as funções do 3.1 (`panBy`, `zoomAt`, `centerOn`,
// `fitToBounds`) já têm os seus testes extensos em camera.test.ts e aqui só se provam as COMPOSIÇÕES: que cada resultado é o das funções existentes e que o ponto do mundo
// sob o foco fica sob o foco.

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type World = { graph: Graph; layout: GraphLayout };

/** v1, v2… nas posições do MUNDO dadas; uma aresta entre os dois primeiros se `connect`. */
function worldOf(vertices: readonly (readonly [number, number])[], connect = false): World {
  let graph = createGraph({ id: 'g' });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  if (connect) graph = must(addEdge(graph, { source: 'v1', target: 'v2' })).graph;
  return { graph, layout };
}

const CAMERAS: readonly Camera[] = [
  NEUTRAL_CAMERA,
  { x: 40, y: -30, scale: 2 },
  { x: -120, y: 75, scale: 0.25 },
  { x: 200, y: -50, scale: 4 },
  { x: -5.5, y: 12.25, scale: 1.5 },
];

describe('panFromAnchor: o conteúdo acompanha o dedo', () => {
  it('desloca a câmera pelo deslocamento em dp (sem tocar na escala): {40, −30, 2} + (15, −10) = {55, −40, 2}', () => {
    expect(panFromAnchor({ x: 40, y: -30, scale: 2 }, point(15, -10))).toStrictEqual({ x: 55, y: -40, scale: 2 });
  });

  it('horizontal, vertical e negativo: à direita soma a x, para baixo soma a y, e os sinais negativos subtraem', () => {
    expect(panFromAnchor(NEUTRAL_CAMERA, point(30, 0))).toStrictEqual({ x: 30, y: 0, scale: 1 });
    expect(panFromAnchor(NEUTRAL_CAMERA, point(0, 45))).toStrictEqual({ x: 0, y: 45, scale: 1 });
    expect(panFromAnchor(NEUTRAL_CAMERA, point(-100, 25))).toStrictEqual({ x: -100, y: 25, scale: 1 });
  });

  it('o ponto do mundo que estava sob o dedo continua sob o dedo: a tela de cada ponto anda exatamente o deslocamento', () => {
    for (const anchor of CAMERAS) {
      const world = point(37, -12);
      const before = worldToScreen(anchor, world);
      const after = worldToScreen(panFromAnchor(anchor, point(23, -41)), world);

      expect(after.x).toBeCloseTo(before.x + 23, 9);
      expect(after.y).toBeCloseTo(before.y - 41, 9);
    }
  });

  it('deslocamento nulo ou inválido devolve a PRÓPRIA âncora (mesma referência)', () => {
    const anchor = { x: 5, y: 6, scale: 2 };

    expect(panFromAnchor(anchor, point(0, 0))).toBe(anchor);
    expect(panFromAnchor(anchor, point(0, -0))).toBe(anchor);
    expect(panFromAnchor(anchor, point(NaN, 1))).toBe(anchor);
    expect(panFromAnchor(anchor, point(1, Infinity))).toBe(anchor);
  });

  it('é calculado a partir da âncora, não da atualização anterior: o mesmo deslocamento total dá a mesma câmera por qualquer caminho', () => {
    const anchor = { x: 40, y: -30, scale: 2 };
    const direct = panFromAnchor(anchor, point(60, 20));
    const viaOthers = [point(10, 5), point(-30, 90), point(60, 20)].map((d) => panFromAnchor(anchor, d)).at(-1)!;

    expect(viaOthers).toStrictEqual(direct);
  });

  it('é `panBy` do 3.1 (a mesma função, sem fórmula nova)', () => {
    for (const anchor of CAMERAS) expect(panFromAnchor(anchor, point(13, -7))).toStrictEqual(panBy(anchor, point(13, -7)));
  });
});

describe('pinchFromAnchor: a pinça mantém o ponto sob o foco', () => {
  it('só zoom (foco parado): neutra, foco (100, 50), escala acumulada 2 → {−100, −50, 2}; o ponto (100, 50) do mundo continua em (100, 50) na tela', () => {
    const camera = pinchFromAnchor(NEUTRAL_CAMERA, point(100, 50), 2, point(100, 50));

    expect(camera).toStrictEqual({ x: -100, y: -50, scale: 2 });
    expect(worldToScreen(camera, point(100, 50))).toStrictEqual({ x: 100, y: 50 });
  });

  it('afastar: {40, −30, 2}, foco (180, 160), escala acumulada 0,5 → {110, 65, 1}', () => {
    expect(pinchFromAnchor({ x: 40, y: -30, scale: 2 }, point(180, 160), 0.5, point(180, 160))).toStrictEqual({ x: 110, y: 65, scale: 1 });
  });

  it('o foco se move junto com a pinça (dois dedos que andam): o deslocamento do foco entra UMA vez — neutra, foco (100, 50) → (130, 40), escala 2 → {−70, −60, 2}', () => {
    const camera = pinchFromAnchor(NEUTRAL_CAMERA, point(100, 50), 2, point(130, 40));

    expect(camera).toStrictEqual({ x: -70, y: -60, scale: 2 });
    expect(worldToScreen(camera, point(100, 50))).toStrictEqual({ x: 130, y: 40 }); // o ponto que estava sob o foco acompanha o foco
  });

  it('sem mudar a escala (acumulada 1) é um pan de dois dedos: o deslocamento do foco', () => {
    expect(pinchFromAnchor({ x: 40, y: -30, scale: 2 }, point(100, 100), 1, point(120, 90))).toStrictEqual({ x: 60, y: -40, scale: 2 });
  });

  it('o limite máximo corta a escala (4) e o ponto sob o foco continua sob o foco: neutra, foco (100, 50), escala 10 → {−300, −150, 4}', () => {
    const camera = pinchFromAnchor(NEUTRAL_CAMERA, point(100, 50), 10, point(100, 50));

    expect(camera).toStrictEqual({ x: -300, y: -150, scale: 4 });
    expect(worldToScreen(camera, point(100, 50))).toStrictEqual({ x: 100, y: 50 });
  });

  it('o limite mínimo corta a escala (0,25) e o ponto sob o foco continua sob o foco', () => {
    const camera = pinchFromAnchor({ x: 10, y: 20, scale: 1 }, point(180, 160), 0.01, point(180, 160));
    const world = screenToWorld({ x: 10, y: 20, scale: 1 }, point(180, 160));

    expect(camera.scale).toBe(0.25);
    expect(worldToScreen(camera, world).x).toBeCloseTo(180, 9);
    expect(worldToScreen(camera, world).y).toBeCloseTo(160, 9);
  });

  it('já no limite máximo, ampliar mais não muda a escala, mas o deslocamento do foco ainda desloca a câmera: {0, 0, 4}, escala 2, foco (100, 50) → (110, 50) = {10, 0, 4}', () => {
    expect(pinchFromAnchor({ x: 0, y: 0, scale: 4 }, point(100, 50), 2, point(110, 50))).toStrictEqual({ x: 10, y: 0, scale: 4 });
  });

  it('limites próprios valem no lugar dos padrões, e o padrão é 0,25 a 4 (não foi mudado)', () => {
    expect(DEFAULT_SCALE_LIMITS).toStrictEqual({ min: 0.25, max: 4 });
    expect(pinchFromAnchor(NEUTRAL_CAMERA, point(0, 0), 10, point(0, 0), { min: 0.5, max: 2 }).scale).toBe(2);
    expect(pinchFromAnchor(NEUTRAL_CAMERA, point(0, 0), 0.1, point(0, 0), { min: 0.5, max: 2 }).scale).toBe(0.5);
  });

  it('sem mudança devolve a PRÓPRIA âncora: escala 1 e foco parado', () => {
    const anchor = { x: 3, y: 4, scale: 2 };

    expect(pinchFromAnchor(anchor, point(50, 60), 1, point(50, 60))).toBe(anchor);
  });

  it('entradas inválidas devolvem a âncora: escala 0, negativa, NaN ou infinita; foco não finito', () => {
    const anchor = { x: 3, y: 4, scale: 2 };
    for (const scale of [0, -1, NaN, Infinity]) expect(pinchFromAnchor(anchor, point(10, 10), scale, point(10, 10))).toBe(anchor);

    expect(pinchFromAnchor(anchor, point(NaN, 10), 2, point(10, 10))).toBe(anchor);
    expect(pinchFromAnchor(anchor, point(10, 10), 2, point(10, Infinity))).toBe(anchor);
  });

  it('é `panBy(zoomAt(âncora, foco0, escala), foco − foco0)` do 3.1 (a mesma composição, sem fórmula nova)', () => {
    const random = seededRandom(31);
    for (let i = 0; i < 200; i++) {
      const anchor = CAMERAS[i % CAMERAS.length]!;
      const f0 = point(random() * 360, random() * 320);
      const f = point(random() * 360, random() * 320);
      const s = 0.2 + random() * 6;

      expect(pinchFromAnchor(anchor, f0, s, f)).toStrictEqual(panBy(zoomAt(anchor, f0, s), point(f.x - f0.x, f.y - f0.y)));
    }
  });

  it('o ponto do mundo sob o foco fica sob o foco, em 500 sorteios (câmeras, focos e escalas quaisquer, com e sem corte pelos limites)', () => {
    const random = seededRandom(77);
    for (let i = 0; i < 500; i++) {
      const anchor = CAMERAS[i % CAMERAS.length]!;
      const f0 = point(random() * 360, random() * 320);
      const f = point(random() * 360, random() * 320);
      const s = 0.1 + random() * 8;
      const world = screenToWorld(anchor, f0);
      const camera = pinchFromAnchor(anchor, f0, s, f);
      const shown = worldToScreen(camera, world);

      expect(shown.x).toBeCloseTo(f.x, 6);
      expect(shown.y).toBeCloseTo(f.y, 6);
      expect(camera.scale).toBeGreaterThanOrEqual(0.25);
      expect(camera.scale).toBeLessThanOrEqual(4);
    }
  });

  it('a escala ACUMULADA e a incremental (`scaleChange`) dão a mesma câmera quando nada é cortado — por isso só uma é usada, e nunca as duas', () => {
    const random = seededRandom(5);
    for (let round = 0; round < 50; round++) {
      const anchor = { x: random() * 100 - 50, y: random() * 100 - 50, scale: 1 };
      let focal = point(random() * 360, random() * 320);
      const f0 = focal;
      let scale = 1;
      let incremental: Camera = anchor;
      for (let step = 0; step < 6; step++) {
        const nextScale = Math.min(3.5, Math.max(0.3, scale * (0.85 + random() * 0.4)));
        const nextFocal = point(focal.x + (random() - 0.5) * 30, focal.y + (random() - 0.5) * 30);
        // passo incremental: zoom em torno do foco ANTERIOR pela razão `scaleChange` e depois o deslocamento do foco
        incremental = panBy(zoomAt(incremental, focal, nextScale / scale), point(nextFocal.x - focal.x, nextFocal.y - focal.y));
        scale = nextScale;
        focal = nextFocal;
        const accumulated = pinchFromAnchor(anchor, f0, scale, focal);

        expect(accumulated.x).toBeCloseTo(incremental.x, 6);
        expect(accumulated.y).toBeCloseTo(incremental.y, 6);
        expect(accumulated.scale).toBeCloseTo(incremental.scale, 9);
      }
    }
  });

  it('nenhum NaN, Infinity nem zero negativo com entradas válidas', () => {
    const random = seededRandom(9);
    for (let i = 0; i < 300; i++) {
      const camera = pinchFromAnchor(CAMERAS[i % CAMERAS.length]!, point(random() * 400, random() * 400), random() * 20, point(random() * 400, random() * 400));

      expect(Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.scale)).toBe(true);
      expect(Object.is(camera.x, -0) || Object.is(camera.y, -0)).toBe(false);
    }
  });
});

describe('centerCamera: Centralizar mantém a escala e leva o centro do conteúdo ao centro do canvas', () => {
  it('dois vértices (0, 0) e (200, 100) com a câmera de escala 2: o centro do conteúdo é (100, 50) e a câmera vira {−20, 60, 2}', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);
    const camera = centerCamera(graph, layout, { x: 7, y: 9, scale: 2 }, VIEWPORT);

    // conteúdo: x de −20 a 220, y de −20 a 120 (raio 20); centro (100, 50); canvas 360 × 320: x' = 180 − 100·2, y' = 160 − 50·2
    expect(camera).toStrictEqual({ x: -20, y: 60, scale: 2 });
    expect(worldToScreen(camera, point(100, 50))).toStrictEqual({ x: 180, y: 160 });
  });

  it('um vértice só: o vértice vai para o centro do canvas, qualquer que seja a escala atual', () => {
    const { graph, layout } = worldOf([[50, 70]]);
    for (const scale of [0.25, 1, 3, 4]) {
      const camera = centerCamera(graph, layout, { x: 99, y: -99, scale }, VIEWPORT);
      const shown = worldToScreen(camera, point(50, 70));

      expect(camera.scale).toBe(scale);
      expect(shown.x).toBeCloseTo(180, 9);
      expect(shown.y).toBeCloseTo(160, 9);
    }
  });

  it('o conteúdo fora do canvas é trazido sem mudar o zoom', () => {
    const { graph, layout } = worldOf([[5000, 5000], [5100, 5050]]);
    const camera = centerCamera(graph, layout, { x: 0, y: 0, scale: 2 }, VIEWPORT);
    const center = worldToScreen(camera, point(5050, 5025));

    expect(camera.scale).toBe(2);
    expect(center.x).toBeCloseTo(180, 9);
    expect(center.y).toBeCloseTo(160, 9);
  });

  it('grafo vazio: câmera neutra (nova), mesmo com outra escala; é a regra previsível sem conteúdo', () => {
    const { graph, layout } = worldOf([]);
    const camera = centerCamera(graph, layout, { x: 12, y: 34, scale: 3 }, VIEWPORT);

    expect(camera).toStrictEqual({ x: 0, y: 0, scale: 1 });
    expect(camera).not.toBe(NEUTRAL_CAMERA);
  });

  it('já centralizado devolve a mesma câmera (referência)', () => {
    const { graph, layout } = worldOf([[50, 70]]);
    const centered = centerCamera(graph, layout, NEUTRAL_CAMERA, VIEWPORT);

    expect(centerCamera(graph, layout, centered, VIEWPORT)).toBe(centered);
  });

  it('entradas inválidas devolvem a câmera: canvas sem tamanho, câmera inválida e layout de outro grafo', () => {
    const { graph, layout } = worldOf([[50, 70]]);
    const camera = { x: 1, y: 2, scale: 2 };

    expect(centerCamera(graph, layout, camera, { width: 0, height: 320 })).toBe(camera);
    expect(centerCamera(graph, layout, camera, { width: 360, height: NaN })).toBe(camera);
    const broken = { x: 0, y: 0, scale: 0 };
    expect(centerCamera(graph, layout, broken, VIEWPORT)).toBe(broken);
    expect(centerCamera(graph, emptyLayout('outro'), camera, VIEWPORT)).toBe(camera);
  });

  it('não altera as entradas (congeladas) e é determinística', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);
    const camera = deepFreeze({ x: 7, y: 9, scale: 2 });
    deepFreeze(graph);

    expect(centerCamera(graph, layout, camera, VIEWPORT)).toStrictEqual(centerCamera(graph, layout, camera, VIEWPORT));
  });
});

describe('fitGraphCamera: Ajustar ao grafo enquadra com margem e diz se coube', () => {
  it('dois vértices: conteúdo de 240 × 140, área útil de 312 × 272 (margem 24): escala 1,3, centro do conteúdo no centro do canvas, coube', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);
    const result = fitGraphCamera(graph, layout, VIEWPORT)!;

    expect(result.camera.scale).toBeCloseTo(1.3, 9);
    expect(result.camera.x).toBeCloseTo(50, 9); // 180 − 100 · 1,3
    expect(result.camera.y).toBeCloseTo(95, 9); // 160 − 50 · 1,3
    expect(result.fits).toBe(true);
  });

  it('inclui o raio dos vértices: um vértice só ocupa 40 dp de conteúdo, e a escala é cortada no máximo (4); ele fica no centro', () => {
    const { graph, layout } = worldOf([[0, 0]]);
    const result = fitGraphCamera(graph, layout, VIEWPORT)!;

    expect(result.camera).toStrictEqual({ x: 180, y: 160, scale: 4 });
    expect(result.fits).toBe(true);
  });

  it('a margem vale nos quatro lados: com margem 24 o conteúdo mais largo toca a área útil, e uma margem maior encolhe a escala', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);
    const small = fitGraphCamera(graph, layout, VIEWPORT, { margin: 24 })!;
    const large = fitGraphCamera(graph, layout, VIEWPORT, { margin: 60 })!;

    expect(240 * small.camera.scale).toBeCloseTo(360 - 2 * 24, 9);
    expect(240 * large.camera.scale).toBeCloseTo(360 - 2 * 60, 9);
    expect(large.camera.scale).toBeLessThan(small.camera.scale);
  });

  it('o limite mínimo de escala impede o enquadramento completo: respeita o limite (0,25), mantém o conteúdo centralizado e avisa que NÃO coube', () => {
    const { graph, layout } = worldOf([[0, 0], [4000, 0]], true);
    const result = fitGraphCamera(graph, layout, VIEWPORT)!;
    const center = worldToScreen(result.camera, point(2000, 0));

    expect(result.camera.scale).toBe(0.25);
    expect(result.fits).toBe(false);
    expect(center.x).toBeCloseTo(180, 9);
    expect(center.y).toBeCloseTo(160, 9);
  });

  it('limites próprios de escala valem', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);

    expect(fitGraphCamera(graph, layout, VIEWPORT, { limits: { min: 0.25, max: 1 } })!.camera.scale).toBe(1);
  });

  it('grafo vazio: câmera neutra e coube', () => {
    const { graph, layout } = worldOf([]);

    expect(fitGraphCamera(graph, layout, VIEWPORT)).toStrictEqual({ camera: { x: 0, y: 0, scale: 1 }, fits: true });
  });

  it('grafo fora do canvas: o enquadramento ignora onde ele está e o traz inteiro', () => {
    const { graph, layout } = worldOf([[9000, -8000], [9200, -7900]], true);
    const result = fitGraphCamera(graph, layout, VIEWPORT)!;
    const a = worldToScreen(result.camera, point(9000, -8000));
    const b = worldToScreen(result.camera, point(9200, -7900));

    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThan(24);
      expect(p.x).toBeLessThan(336);
      expect(p.y).toBeGreaterThan(24);
      expect(p.y).toBeLessThan(296);
    }
  });

  it('canvas inválido (ou menor que as margens) ou layout de outro grafo: undefined', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);

    expect(fitGraphCamera(graph, layout, { width: 0, height: 320 })).toBeUndefined();
    expect(fitGraphCamera(graph, layout, { width: 40, height: 40 })).toBeUndefined(); // 2 × 24 não deixa área útil
    expect(fitGraphCamera(graph, emptyLayout('outro'), VIEWPORT)).toBeUndefined();
  });

  it('é determinística e não altera as entradas', () => {
    const { graph, layout } = worldOf([[0, 0], [200, 100]], true);
    deepFreeze(graph);

    expect(fitGraphCamera(graph, layout, VIEWPORT)).toStrictEqual(fitGraphCamera(graph, layout, VIEWPORT));
  });
});

describe('cameraForResize: o centro do canvas continua sobre o mesmo ponto do mundo', () => {
  it('{10, 20, 2} de 360 × 320 para 400 × 300: o ponto (85, 70) do mundo, antes no centro, fica no novo centro → {30, 10, 2}', () => {
    expect(cameraForResize({ x: 10, y: 20, scale: 2 }, VIEWPORT, { width: 400, height: 300 })).toStrictEqual({ x: 30, y: 10, scale: 2 });
  });

  it('o ponto do mundo sob o centro antigo fica sob o centro novo, para qualquer câmera e tamanhos', () => {
    const random = seededRandom(3);
    for (let i = 0; i < 300; i++) {
      const camera = CAMERAS[i % CAMERAS.length]!;
      const to = { width: 200 + random() * 400, height: 200 + random() * 400 };
      const world = screenToWorld(camera, point(VIEWPORT.width / 2, VIEWPORT.height / 2));
      const shown = worldToScreen(cameraForResize(camera, VIEWPORT, to), world);

      expect(shown.x).toBeCloseTo(to.width / 2, 6);
      expect(shown.y).toBeCloseTo(to.height / 2, 6);
    }
  });

  it('não muda a escala e não reenquadra', () => {
    expect(cameraForResize({ x: 10, y: 20, scale: 3 }, VIEWPORT, { width: 500, height: 450 }).scale).toBe(3);
  });

  it('o mesmo tamanho, ou um tamanho inválido, devolve a mesma câmera (referência)', () => {
    const camera = { x: 10, y: 20, scale: 2 };

    expect(cameraForResize(camera, VIEWPORT, { ...VIEWPORT })).toBe(camera);
    expect(cameraForResize(camera, VIEWPORT, { width: 0, height: 100 })).toBe(camera);
    expect(cameraForResize(camera, { width: NaN, height: 100 }, VIEWPORT)).toBe(camera);
  });
});

describe('sameCamera', () => {
  it('compara os três números', () => {
    expect(sameCamera({ x: 1, y: 2, scale: 3 }, { x: 1, y: 2, scale: 3 })).toBe(true);
    expect(sameCamera({ x: 1, y: 2, scale: 3 }, { x: 1, y: 2, scale: 4 })).toBe(false);
    expect(sameCamera({ x: 1, y: 2, scale: 3 }, { x: 0, y: 2, scale: 3 })).toBe(false);
  });
});
