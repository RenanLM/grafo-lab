import * as core from './index';
import {
  centerOn,
  clampScale,
  DEFAULT_SCALE_LIMITS,
  fitToBounds,
  isValidCamera,
  NEUTRAL_CAMERA,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Bounds,
  type Camera,
  type Point,
  type ScaleLimits,
  type Viewport,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Câmera (ver camera.ts): mundo → tela `tela = mundo · scale + (x, y)`, em dp, eixos X para a direita e Y para baixo.

const camera = (x: number, y: number, scale: number): Camera => ({ x, y, scale });
const point = (x: number, y: number): Point => ({ x, y });
const viewport = (width: number, height: number): Viewport => ({ width, height });
const bounds = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });

/** Tolerância relativa de 1e-9 à magnitude do valor (mínimo 1) e às magnitudes intermediárias informadas. */
const tolerance = (expected: number, magnitude = 0) => 1e-9 * Math.max(1, Math.abs(expected), magnitude);
const isNear = (actual: number, expected: number, magnitude = 0) =>
  Math.abs(actual - expected) <= tolerance(expected, magnitude);

function expectNear(actual: number, expected: number, magnitude = 0) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance(expected, magnitude));
}
function expectPointNear(actual: Point, expected: Point, magnitude = 0) {
  expectNear(actual.x, expected.x, magnitude);
  expectNear(actual.y, expected.y, magnitude);
}
function expectCameraNear(actual: Camera, expected: Camera, magnitude = 0) {
  expectNear(actual.x, expected.x, magnitude);
  expectNear(actual.y, expected.y, magnitude);
  expectNear(actual.scale, expected.scale);
}
const isFiniteCamera = (c: Camera) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.scale) && c.scale > 0;

describe('convenção', () => {
  it('a câmera neutra é a identidade (mundo = tela) e é compartilhada, então congelada', () => {
    expect(NEUTRAL_CAMERA).toStrictEqual({ x: 0, y: 0, scale: 1 });
    expect(Object.isFrozen(NEUTRAL_CAMERA)).toBe(true);
    try {
      (NEUTRAL_CAMERA as { x: number }).x = 5; // em modo estrito lança; fora dele é ignorado: nos dois casos não muda
    } catch {
      // esperado em modo estrito
    }
    expect(NEUTRAL_CAMERA.x).toBe(0);
    for (const p of [point(0, 0), point(3, -7), point(1.5, 2.25), point(-1000, 1e6)]) {
      expect(worldToScreen(NEUTRAL_CAMERA, p)).toStrictEqual(p);
      expect(screenToWorld(NEUTRAL_CAMERA, p)).toStrictEqual(p);
    }
  });

  it('limites padrão provisórios: 0,25 a 4 (congelados)', () => {
    expect(DEFAULT_SCALE_LIMITS).toStrictEqual({ min: 0.25, max: 4 });
    expect(Object.isFrozen(DEFAULT_SCALE_LIMITS)).toBe(true);
  });

  it('a origem do mundo aparece em (camera.x, camera.y)', () => {
    expect(worldToScreen(camera(20, 10, 2), point(0, 0))).toStrictEqual(point(20, 10));
    expect(worldToScreen(camera(-35.5, 8, 0.5), point(0, 0))).toStrictEqual(point(-35.5, 8));
  });

  it('X cresce para a direita e Y para baixo; 1 unidade de mundo vale `scale` dp', () => {
    const c = camera(20, 10, 2);
    const origem = worldToScreen(c, point(0, 0));
    const direita = worldToScreen(c, point(1, 0));
    const abaixo = worldToScreen(c, point(0, 1));

    expect(direita.x - origem.x).toBe(2);
    expect(direita.y).toBe(origem.y);
    expect(abaixo.y - origem.y).toBe(2); // y de mundo maior = mais embaixo na tela
    expect(abaixo.x).toBe(origem.x);
  });

  it('exemplo do enunciado: câmera (20, 10, 2) leva o ponto (5, 8) a (30, 26)', () => {
    expect(worldToScreen(camera(20, 10, 2), point(5, 8))).toStrictEqual(point(30, 26));
    expect(screenToWorld(camera(20, 10, 2), point(30, 26))).toStrictEqual(point(5, 8));
  });

  it('o módulo exporta a câmera pela API do núcleo', () => {
    expect(Object.keys(core)).toEqual(
      expect.arrayContaining([
        'DEFAULT_SCALE_LIMITS',
        'NEUTRAL_CAMERA',
        'centerOn',
        'clampScale',
        'fitToBounds',
        'isValidCamera',
        'panBy',
        'screenToWorld',
        'worldToScreen',
        'zoomAt',
      ]),
    );
  });
});

describe('worldToScreen e screenToWorld: conversões calculadas à mão', () => {
  // [descrição, câmera, ponto do mundo, ponto da tela]. Todos os valores são exatos em ponto flutuante.
  const casos: [string, Camera, Point, Point][] = [
    ['só translação', camera(15, -20, 1), point(10, 10), point(25, -10)],
    ['só escala (2)', camera(0, 0, 2), point(7, -3), point(14, -6)],
    ['só escala (0,25, o mínimo)', camera(0, 0, 0.25), point(400, -80), point(100, -20)],
    ['só escala (4, o máximo)', camera(0, 0, 4), point(0.25, -0.125), point(1, -0.5)],
    ['translação e escala', camera(-50, 30, 0.5), point(100, -40), point(0, 10)],
    ['coordenadas negativas', camera(-10, -10, 2), point(-3, -4), point(-16, -18)],
    ['pontos fracionários', camera(5.5, -2.25, 1.5), point(2, 4), point(8.5, 3.75)],
    ['mundo longe da origem', camera(100, -100, 0.25), point(-400, 800), point(0, 100)],
    ['a origem', camera(12, 34, 3), point(0, 0), point(12, 34)],
  ];

  it.each(casos)('%s', (_nome, c, mundo, tela) => {
    expect(worldToScreen(c, mundo)).toStrictEqual(tela);
    expect(screenToWorld(c, tela)).toStrictEqual(mundo);
  });

  it('nunca devolve -0 (a igualdade estrutural não distingue os dois zeros)', () => {
    const resultados = [
      worldToScreen(camera(-0, -0, 1), point(-0, -0)),
      worldToScreen(camera(5, 5, 1), point(-5, -5)),
      screenToWorld(NEUTRAL_CAMERA, point(-0, -0)),
      screenToWorld(camera(5, 5, 2), point(5, 5)),
    ];

    for (const resultado of resultados) {
      expect(Object.is(resultado.x, 0)).toBe(true);
      expect(Object.is(resultado.y, 0)).toBe(true);
    }
  });

  it('com câmera válida e pontos finitos o resultado é sempre finito', () => {
    const random = seededRandom(1);
    for (let i = 0; i < 500; i++) {
      const c = randomCamera(random);
      const p = randomPoint(random, 1e6);

      for (const resultado of [worldToScreen(c, p), screenToWorld(c, p)]) {
        expect(Number.isFinite(resultado.x) && Number.isFinite(resultado.y)).toBe(true);
      }
    }
  });
});

describe('isValidCamera e clampScale', () => {
  it.each([
    ['neutra', camera(0, 0, 1), true],
    ['negativa e fracionária', camera(-5.5, 1e6, 0.25), true],
    ['escala zero', camera(0, 0, 0), false],
    ['escala negativa', camera(0, 0, -1), false],
    ['escala NaN', camera(0, 0, Number.NaN), false],
    ['escala infinita', camera(0, 0, Number.POSITIVE_INFINITY), false],
    ['x NaN', camera(Number.NaN, 0, 1), false],
    ['y infinito', camera(0, Number.NEGATIVE_INFINITY, 1), false],
  ])('isValidCamera: %s', (_nome, c, esperado) => {
    expect(isValidCamera(c)).toBe(esperado);
  });

  it.each([
    [1, 1],
    [0.25, 0.25],
    [4, 4],
    [0.1, 0.25],
    [100, 4],
    [0, 0.25],
    [-3, 0.25],
    [Number.POSITIVE_INFINITY, 4],
    [Number.NEGATIVE_INFINITY, 0.25],
    [Number.NaN, 1], // NaN vale como a escala neutra
  ])('clampScale(%p) com os limites padrão = %p', (entrada, esperado) => {
    expect(clampScale(entrada)).toBe(esperado);
  });

  it('clampScale com limites próprios; NaN é a escala neutra limitada', () => {
    const limites: ScaleLimits = { min: 2, max: 3 };

    expect(clampScale(2.5, limites)).toBe(2.5);
    expect(clampScale(1, limites)).toBe(2);
    expect(clampScale(10, limites)).toBe(3);
    expect(clampScale(Number.NaN, limites)).toBe(2); // 1, limitado a [2, 3]
    expect(clampScale(Number.NaN, { min: 0.1, max: 0.5 })).toBe(0.5);
  });
});

describe('zoomAt', () => {
  it('zoom in (×2) em torno de (100, 50): o ponto do mundo sob o foco não sai do lugar', () => {
    const resultado = zoomAt(NEUTRAL_CAMERA, point(100, 50), 2);

    expect(resultado).toStrictEqual(camera(-100, -50, 2));
    // o ponto do mundo que estava sob (100, 50) é (100, 50) e continua lá
    expect(worldToScreen(resultado, point(100, 50))).toStrictEqual(point(100, 50));
  });

  it('zoom out (×0,5) desfaz o anterior', () => {
    expect(zoomAt(camera(-100, -50, 2), point(100, 50), 0.5)).toStrictEqual(camera(0, 0, 1));
  });

  it('foco no canto (0, 0) da área de desenho', () => {
    // câmera (20, 10, 2), foco (0, 0): ponto do mundo sob o foco = (−10, −5); depois do zoom continua em (0, 0)
    const resultado = zoomAt(camera(20, 10, 2), point(0, 0), 2);

    expect(resultado).toStrictEqual(camera(40, 20, 4));
    expect(worldToScreen(resultado, point(-10, -5))).toStrictEqual(point(0, 0));
  });

  it('foco no centro de uma área de 400 × 300: o centro do mundo visível continua no centro', () => {
    const resultado = zoomAt(NEUTRAL_CAMERA, point(200, 150), 2);

    expect(resultado).toStrictEqual(camera(-200, -150, 2));
    expect(screenToWorld(resultado, point(200, 150))).toStrictEqual(point(200, 150));
  });

  it('foco fora do centro e câmera deslocada', () => {
    // câmera (−30, 12, 0.5): sob o foco (300, 40) está o ponto do mundo ((300+30)/0.5, (40−12)/0.5) = (660, 56)
    const antes = camera(-30, 12, 0.5);
    const noFoco = screenToWorld(antes, point(300, 40));
    const resultado = zoomAt(antes, point(300, 40), 3);

    expect(noFoco).toStrictEqual(point(660, 56));
    expect(resultado.scale).toBe(1.5);
    expectPointNear(worldToScreen(resultado, noFoco), point(300, 40));
  });

  it('fator 1 devolve a própria câmera', () => {
    const c = camera(7, -3, 1.5);

    expect(zoomAt(c, point(10, 10), 1)).toBe(c);
  });

  describe('limites de escala: a translação usa a escala EFETIVA, não o fator pedido', () => {
    it('máximo: de 1 com fator 8 a escala é 4 (razão 4, não 8)', () => {
      const resultado = zoomAt(NEUTRAL_CAMERA, point(10, 20), 8);

      expect(resultado).toStrictEqual(camera(-30, -60, 4)); // 10 − 10·4 e 20 − 20·4 (com razão 8 seria −70 e −140)
      expect(worldToScreen(resultado, point(10, 20))).toStrictEqual(point(10, 20));
    });

    it('mínimo: de 0,5 com fator 0,1 a escala é 0,25 (razão 0,5, não 0,1)', () => {
      const resultado = zoomAt(camera(0, 0, 0.5), point(8, 8), 0.1);

      expect(resultado).toStrictEqual(camera(4, 4, 0.25)); // 8 − 8·0,5 (com razão 0,1 seria 7,2)
    });

    it('já no limite: devolve a própria câmera', () => {
      const noMaximo = camera(5, 5, 4);
      const noMinimo = camera(-5, 9, 0.25);

      expect(zoomAt(noMaximo, point(1, 1), 2)).toBe(noMaximo);
      expect(zoomAt(noMinimo, point(1, 1), 0.5)).toBe(noMinimo);
    });

    it('depois de limitada, a escala nunca passa dos limites, qualquer que seja o fator', () => {
      for (const fator of [1e-300, Number.MIN_VALUE, 0.001, 0.5, 2, 1e6, 1e300, Number.MAX_VALUE]) {
        for (const escala of [0.25, 1, 4]) {
          const resultado = zoomAt(camera(3, -4, escala), point(100, 100), fator);

          expect(resultado.scale).toBeGreaterThanOrEqual(0.25);
          expect(resultado.scale).toBeLessThanOrEqual(4);
          expect(isFiniteCamera(resultado)).toBe(true);
        }
      }
    });

    it('limites próprios', () => {
      expect(zoomAt(NEUTRAL_CAMERA, point(10, 10), 4, { min: 1, max: 2 })).toStrictEqual(camera(-10, -10, 2));
      expect(zoomAt(NEUTRAL_CAMERA, point(10, 10), 0.1, { min: 0.5, max: 2 })).toStrictEqual(camera(5, 5, 0.5));
      const fixa = camera(2, 3, 0.5);
      expect(zoomAt(fixa, point(1, 1), 3, { min: 0.5, max: 0.5 })).toBe(fixa);
    });

    it('uma câmera que já está fora dos limites é trazida para dentro', () => {
      expect(zoomAt(camera(0, 0, 10), point(0, 0), 1)).toStrictEqual(camera(0, 0, 4));
      expect(zoomAt(camera(0, 0, 0.01), point(0, 0), 1)).toStrictEqual(camera(0, 0, 0.25));
    });
  });

  describe('entradas inválidas: a própria câmera, sem exceção', () => {
    const c = camera(5, 6, 2);

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, -0.5])('fator %p', (fator) => {
      expect(zoomAt(c, point(10, 10), fator)).toBe(c);
    });

    it.each([
      point(Number.NaN, 0),
      point(0, Number.NaN),
      point(Number.POSITIVE_INFINITY, 0),
      point(0, Number.NEGATIVE_INFINITY),
    ])('foco %p', (foco) => {
      expect(zoomAt(c, foco, 2)).toBe(c);
    });

    it.each<[string, ScaleLimits]>([
      ['mínimo zero', { min: 0, max: 4 }],
      ['mínimo negativo', { min: -1, max: 4 }],
      ['mínimo maior que o máximo', { min: 2, max: 1 }],
      ['mínimo NaN', { min: Number.NaN, max: 4 }],
      ['máximo infinito', { min: 1, max: Number.POSITIVE_INFINITY }],
    ])('limites inválidos: %s', (_nome, limites) => {
      expect(zoomAt(c, point(10, 10), 2, limites)).toBe(c);
    });

    it('estouro numérico na translação devolve a própria câmera (nunca Infinity)', () => {
      const enorme = camera(1e308, 0, 1);

      expect(zoomAt(enorme, point(-1e308, 0), 2)).toBe(enorme);
    });
  });
});

describe('panBy', () => {
  it('desloca em X, em Y e nos dois, sem mexer na escala', () => {
    const c = camera(10, 20, 2);

    expect(panBy(c, point(3, 0))).toStrictEqual(camera(13, 20, 2));
    expect(panBy(c, point(0, -7))).toStrictEqual(camera(10, 13, 2));
    expect(panBy(c, point(5, -7))).toStrictEqual(camera(15, 13, 2));
    expect(panBy(c, point(-10, -20))).toStrictEqual(camera(0, 0, 2));
  });

  it('deslocamento zero dá uma câmera igual (e nova)', () => {
    const c = camera(10, 20, 2);
    const resultado = panBy(c, point(0, 0));

    expect(resultado).toStrictEqual(c);
    expect(resultado).not.toBe(c);
  });

  it('o conteúdo acompanha o dedo: arrastar +dx faz todo ponto aparecer dx dp mais à direita', () => {
    const c = camera(40, -10, 1.5);
    const resultado = panBy(c, point(25, -4));

    for (const p of [point(0, 0), point(10, 10), point(-33, 7)]) {
      const antes = worldToScreen(c, p);
      const depois = worldToScreen(resultado, p);

      expect(depois.x - antes.x).toBe(25);
      expect(depois.y - antes.y).toBe(-4);
    }
  });

  it('não devolve -0', () => {
    const resultado = panBy(camera(-0, -5, 1), point(-0, 5));

    expect(Object.is(resultado.x, 0)).toBe(true);
    expect(Object.is(resultado.y, 0)).toBe(true);
  });

  it.each([point(Number.NaN, 0), point(0, Number.POSITIVE_INFINITY), point(Number.NEGATIVE_INFINITY, 1)])(
    'deslocamento inválido %p: a própria câmera',
    (delta) => {
      const c = camera(1, 2, 3);

      expect(panBy(c, delta)).toBe(c);
    },
  );

  it('estouro da soma devolve a própria câmera', () => {
    const c = camera(Number.MAX_VALUE, 0, 1);

    expect(panBy(c, point(Number.MAX_VALUE, 0))).toBe(c);
  });
});

describe('centerOn', () => {
  it('um vértice em (200, 100) fica no centro de uma área de 400 × 300', () => {
    const resultado = centerOn(NEUTRAL_CAMERA, point(200, 100), viewport(400, 300));

    expect(resultado).toStrictEqual(camera(0, 50, 1));
    expect(worldToScreen(resultado, point(200, 100))).toStrictEqual(point(200, 150));
  });

  it('a escala é mantida e entra na conta: o ponto cai no centro com qualquer escala', () => {
    expect(centerOn(camera(999, -999, 2), point(200, 100), viewport(400, 300))).toStrictEqual(camera(-200, -50, 2));
    expect(centerOn(camera(0, 0, 0.5), point(200, 100), viewport(400, 300))).toStrictEqual(camera(100, 100, 0.5));
  });

  it('a posição anterior da câmera não importa', () => {
    const a = centerOn(camera(0, 0, 2), point(-30, 70), viewport(360, 640));
    const b = centerOn(camera(-5000, 123, 2), point(-30, 70), viewport(360, 640));

    expect(a).toStrictEqual(b);
    expect(worldToScreen(a, point(-30, 70))).toStrictEqual(point(180, 320));
  });

  it('o ponto do mundo na origem fica no centro: a câmera é (largura/2, altura/2)', () => {
    expect(centerOn(NEUTRAL_CAMERA, point(0, 0), viewport(400, 300))).toStrictEqual(camera(200, 150, 1));
  });

  it.each([
    viewport(0, 300),
    viewport(400, 0),
    viewport(-1, 300),
    viewport(400, -1),
    viewport(Number.NaN, 300),
    viewport(400, Number.POSITIVE_INFINITY),
  ])('viewport inválido %p: a própria câmera', (area) => {
    const c = camera(1, 2, 3);

    expect(centerOn(c, point(10, 10), area)).toBe(c);
  });

  it.each([point(Number.NaN, 0), point(0, Number.POSITIVE_INFINITY)])('ponto inválido %p: a própria câmera', (p) => {
    const c = camera(1, 2, 3);

    expect(centerOn(c, p, viewport(400, 300))).toBe(c);
  });

  it('estouro devolve a própria câmera', () => {
    const c = camera(0, 0, 4);

    expect(centerOn(c, point(Number.MAX_VALUE, 0), viewport(400, 300))).toBe(c);
  });
});

describe('fitToBounds', () => {
  const qualquer = camera(123, -456, 3); // só é devolvida quando não há o que fazer

  describe('exemplos calculados à mão (viewport 400 × 300 salvo indicação)', () => {
    it('limitado pela largura, com margem de 20 dp', () => {
      // área útil 360 × 260; escalas 360/200 = 1,8 e 260/100 = 2,6 → 1,8; centro (100, 50) → (200, 150)
      const resultado = fitToBounds(qualquer, bounds(0, 0, 200, 100), viewport(400, 300), { margin: 20 });

      expectCameraNear(resultado, camera(20, 60, 1.8));
      expectPointNear(worldToScreen(resultado, point(0, 0)), point(20, 60));
      expectPointNear(worldToScreen(resultado, point(200, 100)), point(380, 240)); // encosta nas margens esquerda e direita
    });

    it('limitado pela altura, sem margem', () => {
      // escalas 400/50 = 8 e 300/400 = 0,75 → 0,75; centro (25, 200)
      expect(fitToBounds(qualquer, bounds(0, 0, 50, 400), viewport(400, 300))).toStrictEqual(camera(181.25, 0, 0.75));
    });

    it('coordenadas negativas: centro na origem do mundo', () => {
      // escalas 400/200 = 2 e 300/100 = 3 → 2; centro (0, 0) → (200, 150)
      expect(fitToBounds(qualquer, bounds(-100, -50, 100, 50), viewport(400, 300))).toStrictEqual(camera(200, 150, 2));
    });

    it('conteúdo pequeno demais: a escala máxima (4) vale e o conteúdo fica centrado', () => {
      // desejada 30 > 4; centro (5, 5)
      expect(fitToBounds(qualquer, bounds(0, 0, 10, 10), viewport(400, 300))).toStrictEqual(camera(180, 130, 4));
    });

    it('conteúdo grande demais: a escala mínima (0,25) vale, o conteúdo continua centrado e EXCEDE o viewport', () => {
      const resultado = fitToBounds(qualquer, bounds(0, 0, 10000, 8000), viewport(400, 300));

      expect(resultado).toStrictEqual(camera(-1050, -850, 0.25));
      expect(worldToScreen(resultado, point(5000, 4000))).toStrictEqual(point(200, 150)); // o centro vai ao centro
      expect(worldToScreen(resultado, point(10000, 8000)).x - worldToScreen(resultado, point(0, 0)).x).toBe(2500); // 2500 dp > 400
    });

    it('a escala vem só do eixo com tamanho: linha vertical (largura zero)', () => {
      // margem 10 → área útil 380 × 280; só a altura conta: 280/200 = 1,4; centro (10, 100)
      expect(fitToBounds(qualquer, bounds(10, 0, 10, 200), viewport(400, 300), { margin: 10 })).toStrictEqual(
        camera(186, 10, 1.4),
      );
    });

    it('a escala vem só do eixo com tamanho: linha horizontal (altura zero)', () => {
      // 400/300; centro (150, 5)
      const resultado = fitToBounds(qualquer, bounds(0, 5, 300, 5), viewport(400, 300));

      expectCameraNear(resultado, camera(0, 150 - 5 * (4 / 3), 4 / 3));
      expectPointNear(worldToScreen(resultado, point(150, 5)), point(200, 150));
    });

    it('um único vértice (largura e altura zero): escala 1 e o ponto no centro', () => {
      expect(fitToBounds(qualquer, bounds(30, 40, 30, 40), viewport(400, 300))).toStrictEqual(camera(170, 110, 1));
    });

    it('um único vértice com limites que excluem 1: a escala 1 é limitada', () => {
      expect(fitToBounds(qualquer, bounds(30, 40, 30, 40), viewport(400, 300), { limits: { min: 2, max: 3 } })).toStrictEqual(
        camera(140, 70, 2),
      );
      expect(fitToBounds(qualquer, bounds(30, 40, 30, 40), viewport(400, 300), { limits: { min: 0.1, max: 0.5 } })).toStrictEqual(
        camera(185, 130, 0.5),
      );
    });

    it('grafo sem vértices (limites indefinidos): câmera neutra, com a escala 1 limitada', () => {
      expect(fitToBounds(qualquer, undefined, viewport(400, 300))).toStrictEqual(NEUTRAL_CAMERA);
      expect(fitToBounds(qualquer, undefined, viewport(400, 300), { limits: { min: 2, max: 3 } })).toStrictEqual(
        camera(0, 0, 2),
      );
    });
  });

  describe('viewport retangular e margem', () => {
    it('o eixo que limita muda com o formato da área (mesmos limites do conteúdo)', () => {
      const conteudo = bounds(0, 0, 100, 40);

      expect(fitToBounds(qualquer, conteudo, viewport(300, 300)).scale).toBe(3); // largura: 300/100 (altura daria 7,5)
      expect(fitToBounds(qualquer, conteudo, viewport(100, 300)).scale).toBe(1); // largura: 100/100
      expect(fitToBounds(qualquer, conteudo, viewport(300, 80)).scale).toBe(2); // altura: 80/40 (largura daria 3)
    });

    it('a margem vale nos quatro lados e reduz a escala', () => {
      const conteudo = bounds(0, 0, 100, 100);
      const sem = fitToBounds(qualquer, conteudo, viewport(300, 300));
      const com = fitToBounds(qualquer, conteudo, viewport(300, 300), { margin: 50 });

      expect(sem.scale).toBe(3);
      expect(com.scale).toBe(2); // (300 − 100) / 100
      expect(worldToScreen(com, point(0, 0))).toStrictEqual(point(50, 50));
      expect(worldToScreen(com, point(100, 100))).toStrictEqual(point(250, 250));
    });

    it('margem quase do tamanho da metade ainda é válida; a partir dela não sobra área útil', () => {
      expect(fitToBounds(qualquer, bounds(0, 0, 4, 4), viewport(100, 100), { margin: 49 }).scale).toBe(0.5); // área útil 2 / 4
      expect(fitToBounds(qualquer, bounds(0, 0, 10, 10), viewport(100, 100), { margin: 50 })).toBe(qualquer);
      expect(fitToBounds(qualquer, bounds(0, 0, 10, 10), viewport(100, 400), { margin: 50 })).toBe(qualquer);
    });

    it('limites de escala próprios mudam o enquadramento', () => {
      const conteudo = bounds(0, 0, 200, 100);

      expect(fitToBounds(qualquer, conteudo, viewport(400, 300), { limits: { min: 0.5, max: 1.5 } }).scale).toBe(1.5);
      expect(fitToBounds(qualquer, conteudo, viewport(400, 300), { limits: { min: 3, max: 4 } }).scale).toBe(3);
    });

    it('a câmera atual não influencia o resultado (só é devolvida quando não há o que fazer)', () => {
      const a = fitToBounds(camera(0, 0, 1), bounds(0, 0, 200, 100), viewport(400, 300), { margin: 20 });
      const b = fitToBounds(camera(-999, 777, 0.3), bounds(0, 0, 200, 100), viewport(400, 300), { margin: 20 });

      expect(a).toStrictEqual(b);
    });

    it('conteúdo longe da origem do mundo', () => {
      const resultado = fitToBounds(qualquer, bounds(1e6, -1e6, 1e6 + 200, -1e6 + 100), viewport(400, 300));

      expect(resultado.scale).toBe(2);
      expectPointNear(worldToScreen(resultado, point(1e6 + 100, -1e6 + 50)), point(200, 150), 1e6);
    });
  });

  describe('entradas inválidas: a própria câmera, sem exceção', () => {
    const conteudo = bounds(0, 0, 100, 100);

    it.each([
      viewport(0, 300),
      viewport(400, 0),
      viewport(-400, 300),
      viewport(400, -300),
      viewport(Number.NaN, 300),
      viewport(400, Number.NaN),
      viewport(Number.POSITIVE_INFINITY, 300),
    ])('viewport inválido %p', (area) => {
      expect(fitToBounds(qualquer, conteudo, area)).toBe(qualquer);
      expect(fitToBounds(qualquer, undefined, area)).toBe(qualquer); // vale também sem conteúdo
    });

    it.each([-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('margem inválida %p', (margin) => {
      expect(fitToBounds(qualquer, conteudo, viewport(400, 300), { margin })).toBe(qualquer);
    });

    it.each([150, 200, 1e9])('margem %p deixa sem área útil', (margin) => {
      expect(fitToBounds(qualquer, conteudo, viewport(400, 300), { margin })).toBe(qualquer);
    });

    it.each<[string, ScaleLimits]>([
      ['mínimo zero', { min: 0, max: 4 }],
      ['mínimo maior que o máximo', { min: 5, max: 4 }],
      ['máximo infinito', { min: 1, max: Number.POSITIVE_INFINITY }],
      ['NaN', { min: Number.NaN, max: Number.NaN }],
    ])('limites de escala inválidos: %s', (_nome, limits) => {
      expect(fitToBounds(qualquer, conteudo, viewport(400, 300), { limits })).toBe(qualquer);
    });

    it.each<[string, Bounds]>([
      ['mínimo maior que o máximo em X', bounds(5, 0, 1, 10)],
      ['mínimo maior que o máximo em Y', bounds(0, 5, 10, 1)],
      ['NaN', bounds(Number.NaN, 0, 10, 10)],
      ['infinito', bounds(0, 0, Number.POSITIVE_INFINITY, 10)],
      ['-infinito', bounds(Number.NEGATIVE_INFINITY, 0, 10, 10)],
      ['largura que estoura', bounds(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 10)],
      ['altura que estoura', bounds(0, -Number.MAX_VALUE, 10, Number.MAX_VALUE)],
    ])('limites do conteúdo inválidos: %s', (_nome, invalidos) => {
      expect(fitToBounds(qualquer, invalidos, viewport(400, 300))).toBe(qualquer);
    });

    it('estouro na translação devolve a própria câmera (nunca Infinity)', () => {
      const resultado = fitToBounds(qualquer, bounds(1e300, 1e300, 1e300, 1e300), viewport(400, 300), {
        limits: { min: 1e10, max: 1e10 },
      });

      expect(resultado).toBe(qualquer);
    });

    it('limites do conteúdo enormes mas válidos geram câmera finita', () => {
      const resultado = fitToBounds(qualquer, bounds(-1e300, -1e300, 1e300, 1e300), viewport(400, 300));

      expect(isFiniteCamera(resultado)).toBe(true);
      expect(resultado.scale).toBe(0.25);
    });

    it('conteúdo minúsculo (largura subnormal) vira a escala máxima, sem divisão por zero', () => {
      const resultado = fitToBounds(qualquer, bounds(0, 0, Number.MIN_VALUE, Number.MIN_VALUE), viewport(400, 300));

      expect(resultado.scale).toBe(4);
      expect(isFiniteCamera(resultado)).toBe(true);
    });
  });
});

describe('imutabilidade, determinismo e referências', () => {
  // O Jest compila os módulos fora do modo estrito (preset do React Native): escrever num objeto congelado é ignorado
  // em silêncio, em vez de lançar. Por isso a imutabilidade é conferida com argumentos NÃO congelados e comparando-os
  // com uma cópia tirada antes; a execução com argumentos congelados completa (lança em modo estrito).
  const entradas = () => ({
    c: camera(12, -7, 1.5),
    p: point(3, 4),
    area: viewport(400, 300),
    conteudo: bounds(-50, -20, 150, 80),
    limites: { min: 0.5, max: 2 } as ScaleLimits,
  });
  const chamarTodas = ({ c, p, area, conteudo, limites }: ReturnType<typeof entradas>) => [
    worldToScreen(c, p),
    screenToWorld(c, p),
    zoomAt(c, p, 1.7, limites),
    zoomAt(c, p, 100),
    zoomAt(c, p, Number.NaN),
    panBy(c, p),
    panBy(c, point(Number.NaN, 0)),
    centerOn(c, p, area),
    centerOn(c, p, viewport(0, 0)),
    fitToBounds(c, conteudo, area, { margin: 16, limits: limites }),
    fitToBounds(c, undefined, area),
    fitToBounds(c, conteudo, viewport(-1, 5)),
    clampScale(7, limites),
    isValidCamera(c),
  ];

  it('nenhuma função altera os argumentos (comparados com uma cópia feita antes)', () => {
    const dados = entradas();
    const antes = JSON.stringify(dados);

    chamarTodas(dados);

    expect(JSON.stringify(dados)).toBe(antes);
  });

  it('com os argumentos congelados tudo funciona e dá o mesmo resultado; e é determinístico', () => {
    const congelados = deepFreeze(entradas());

    expect(chamarTodas(congelados)).toStrictEqual(chamarTodas(entradas()));
    expect(chamarTodas(congelados)).toStrictEqual(chamarTodas(congelados));
  });

  it('os resultados são objetos novos, não os argumentos, quando há transformação', () => {
    const c = camera(1, 2, 3);
    const p = point(4, 5);

    expect(worldToScreen(c, p)).not.toBe(p);
    expect(screenToWorld(c, p)).not.toBe(p);
    expect(panBy(c, p)).not.toBe(c);
    expect(zoomAt(c, p, 1.1)).not.toBe(c);
    expect(centerOn(c, p, viewport(10, 10))).not.toBe(c);
    expect(fitToBounds(c, bounds(0, 0, 1, 1), viewport(10, 10))).not.toBe(c);
  });

  it('o resultado de uma recusa é a câmera recebida, inclusive quando ela está congelada', () => {
    const c = deepFreeze(camera(1, 2, 3));

    expect(zoomAt(c, point(0, 0), Number.NaN)).toBe(c);
    expect(panBy(c, point(Number.NaN, 0))).toBe(c);
    expect(centerOn(c, point(0, 0), viewport(0, 0))).toBe(c);
    expect(fitToBounds(c, bounds(0, 0, 1, 1), viewport(-1, -1))).toBe(c);
  });
});

// ---------------------------------------------------------------------------------------------
// Propriedades com sementes fixas
// ---------------------------------------------------------------------------------------------

/** Câmera válida: escala entre 0,001 e 1000 (distribuição logarítmica) e translação até ±1e4 (às vezes ±1e6). */
function randomCamera(random: () => number): Camera {
  const range = random() < 0.2 ? 1e6 : 1e4;
  return camera((random() * 2 - 1) * range, (random() * 2 - 1) * range, 10 ** (random() * 6 - 3));
}
function randomPoint(random: () => number, range: number): Point {
  return point((random() * 2 - 1) * range, (random() * 2 - 1) * range);
}
const magnitude = (...values: number[]) => Math.max(...values.map(Math.abs));

describe('propriedades (sementes fixas, tolerância relativa à magnitude)', () => {
  it('o verificador de tolerância é exigente: aceita erro de arredondamento e recusa erro de verdade', () => {
    expect(isNear(1, 1 + 1e-12)).toBe(true);
    expect(isNear(1, 1 + 1e-6)).toBe(false);
    expect(isNear(1e12, 1e12 + 100)).toBe(true); // relativo: 1e-10 da magnitude
    expect(isNear(1e12, 1e12 * (1 + 1e-6))).toBe(false);
    expect(isNear(0, 1e-12)).toBe(true);
    expect(isNear(0, 0.001)).toBe(false);
  });

  it('screenToWorld(worldToScreen(p)) ≈ p e worldToScreen(screenToWorld(q)) ≈ q (2000 casos)', () => {
    const random = seededRandom(20261030);
    for (let i = 0; i < 2000; i++) {
      const c = randomCamera(random);
      const p = randomPoint(random, random() < 0.2 ? 1e8 : 1e4);
      const naTela = worldToScreen(c, p);
      const volta = screenToWorld(c, naTela);
      // o erro de arredondamento de `p·escala + x` é relativo à magnitude da tela, e a inversa o divide pela escala
      const grande = magnitude(p.x, p.y, naTela.x / c.scale, naTela.y / c.scale);
      expectPointNear(volta, p, grande);

      const q = randomPoint(random, 1e5);
      const noMundo = screenToWorld(c, q);
      expectPointNear(worldToScreen(c, noMundo), q, magnitude(q.x, q.y, noMundo.x * c.scale, noMundo.y * c.scale));
    }
  });

  it('coordenadas muito grandes (1e12) ainda fecham a conta dentro da tolerância relativa', () => {
    const c = camera(3e11, -2e11, 4);
    const p = point(7.5e11, -9.1e11);
    const naTela = worldToScreen(c, p);

    expectPointNear(screenToWorld(c, naTela), p, magnitude(naTela.x, naTela.y));
    expect(isNear(naTela.x, 3.3e12, 1e12)).toBe(true); // 7,5e11 · 4 + 3e11
  });

  it('zoomAt mantém o ponto sob o foco no mesmo lugar da tela, com e sem limitação (3000 casos)', () => {
    const random = seededRandom(7);
    let limitados = 0;
    let livres = 0;
    for (let i = 0; i < 3000; i++) {
      const c = camera((random() * 2 - 1) * 5000, (random() * 2 - 1) * 5000, 0.25 + random() * 3.75); // dentro dos limites
      const foco = randomPoint(random, 800);
      const fator = 10 ** (random() * 3 - 1.5); // de ~0,03 a ~30
      const resultado = zoomAt(c, foco, fator);
      const pedida = c.scale * fator;
      if (pedida < 0.25 || pedida > 4) limitados++;
      else livres++;

      const sobFoco = screenToWorld(c, foco);
      expectPointNear(worldToScreen(resultado, sobFoco), foco, magnitude(foco.x, foco.y, c.x, c.y, sobFoco.x * resultado.scale));
      expect(resultado.scale).toBeGreaterThanOrEqual(0.25);
      expect(resultado.scale).toBeLessThanOrEqual(4);
      expect(isFiniteCamera(resultado)).toBe(true);
    }

    expect(limitados).toBeGreaterThan(500);
    expect(livres).toBeGreaterThan(500);
  });

  it('o foco do enunciado: worldToScreen(zoomAt(c, f, k), screenToWorld(c, f)) ≈ f', () => {
    const random = seededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const c = camera((random() * 2 - 1) * 1e3, (random() * 2 - 1) * 1e3, 0.5 + random() * 2);
      const f = randomPoint(random, 500);
      const k = 0.5 + random() * 1.5;

      expectPointNear(worldToScreen(zoomAt(c, f, k), screenToWorld(c, f)), f, magnitude(c.x, c.y, f.x, f.y) * 4);
    }
  });

  it('zooms em sequência compõem (sem limitação): a·b em um passo ≈ a e depois b', () => {
    const random = seededRandom(5);
    for (let i = 0; i < 500; i++) {
      const c = camera((random() * 2 - 1) * 1e3, (random() * 2 - 1) * 1e3, 1);
      const f = randomPoint(random, 400);
      const a = 0.8 + random() * 0.6;
      const b = 0.8 + random() * 0.6;
      const emDois = zoomAt(zoomAt(c, f, a), f, b);
      const emUm = zoomAt(c, f, a * b);

      expectCameraNear(emDois, emUm, magnitude(c.x, c.y, f.x, f.y) * 4);
    }
  });

  it('zoom e o zoom inverso, com o mesmo foco, devolvem a câmera (sem limitação)', () => {
    const random = seededRandom(11);
    for (let i = 0; i < 500; i++) {
      const c = camera((random() * 2 - 1) * 1e3, (random() * 2 - 1) * 1e3, 1);
      const f = randomPoint(random, 400);
      const k = 0.5 + random() * 3;

      expectCameraNear(zoomAt(zoomAt(c, f, k), f, 1 / k), c, magnitude(c.x, c.y, f.x, f.y) * 8);
    }
  });

  it('panBy soma o deslocamento a todo ponto e é desfeito pelo deslocamento oposto', () => {
    const random = seededRandom(3);
    for (let i = 0; i < 500; i++) {
      const c = randomCamera(random);
      const d = randomPoint(random, 1e3);
      const p = randomPoint(random, 1e3);
      const deslocada = panBy(c, d);
      const antes = worldToScreen(c, p);
      const depois = worldToScreen(deslocada, p);

      expect(deslocada.scale).toBe(c.scale);
      expectNear(depois.x - antes.x, d.x, magnitude(antes.x, depois.x, d.x));
      expectNear(depois.y - antes.y, d.y, magnitude(antes.y, depois.y, d.y));
      expectCameraNear(panBy(deslocada, point(-d.x, -d.y)), c, magnitude(c.x, c.y, d.x, d.y));
    }
  });

  it('centerOn leva o ponto exatamente ao centro do viewport, com qualquer escala', () => {
    const random = seededRandom(13);
    for (let i = 0; i < 500; i++) {
      const c = randomCamera(random);
      const p = randomPoint(random, 1e4);
      const area = viewport(100 + random() * 900, 100 + random() * 900);
      const resultado = centerOn(c, p, area);

      expect(resultado.scale).toBe(c.scale);
      expectPointNear(worldToScreen(resultado, p), point(area.width / 2, area.height / 2), magnitude(p.x * c.scale, p.y * c.scale));
    }
  });

  it('fitToBounds: centro do conteúdo no centro do viewport; conteúdo dentro da área útil, ou a escala parou no limite', () => {
    const random = seededRandom(31337);
    const contagem = { dentro: 0, noMinimo: 0, noMaximo: 0, degenerado: 0 };
    for (let i = 0; i < 3000; i++) {
      const minX = (random() * 2 - 1) * 2000;
      const minY = (random() * 2 - 1) * 2000;
      const forma = random();
      const ponto = forma >= 0.45 && forma < 0.55; // largura e altura zero (um vértice só)
      const largura = forma < 0.1 || ponto ? 0 : 10 ** (random() * 4 - 1); // 0,1 a 1000, às vezes 0
      const altura = forma > 0.9 || ponto ? 0 : 10 ** (random() * 4 - 1);
      const conteudo = bounds(minX, minY, minX + largura, minY + altura);
      const area = viewport(120 + random() * 600, 120 + random() * 600);
      const margem = random() < 0.5 ? 0 : random() * 50;
      const resultado = fitToBounds(camera(1, 1, 1), conteudo, area, { margin: margem });

      // sempre: escala dentro dos limites, câmera finita e conteúdo centrado
      expect(isFiniteCamera(resultado)).toBe(true);
      expect(resultado.scale).toBeGreaterThanOrEqual(0.25);
      expect(resultado.scale).toBeLessThanOrEqual(4);
      const centro = worldToScreen(resultado, point(minX + largura / 2, minY + altura / 2));
      expectPointNear(centro, point(area.width / 2, area.height / 2), magnitude(minX, minY) * resultado.scale);

      const canto0 = worldToScreen(resultado, point(minX, minY));
      const canto1 = worldToScreen(resultado, point(minX + largura, minY + altura));
      const utilX = area.width - 2 * margem;
      const utilY = area.height - 2 * margem;
      const folga = 1e-9 * (1 + Math.abs(canto0.x) + Math.abs(canto1.x));
      const cabe =
        canto0.x >= margem - folga && canto1.x <= area.width - margem + folga &&
        canto0.y >= margem - folga && canto1.y <= area.height - margem + folga;

      if (largura === 0 && altura === 0) {
        contagem.degenerado++;
        expect(resultado.scale).toBe(1);
      } else if (cabe) {
        contagem.dentro++;
        // enquadramento justo: se a escala não parou em nenhum limite, algum eixo encosta nas duas margens
        if (resultado.scale > 0.25 && resultado.scale < 4) {
          const justoX = largura > 0 && isNear(canto1.x - canto0.x, utilX, utilX);
          const justoY = altura > 0 && isNear(canto1.y - canto0.y, utilY, utilY);
          expect(justoX || justoY).toBe(true);
        }
        if (resultado.scale === 4) contagem.noMaximo++;
      } else {
        // não coube: só pode ser porque a escala mínima impediu (o conteúdo excede o viewport)
        contagem.noMinimo++;
        expect(resultado.scale).toBe(0.25);
      }
    }

    // a amostra exercita todos os regimes
    expect(contagem.dentro).toBeGreaterThan(500);
    expect(contagem.noMinimo).toBeGreaterThan(50);
    expect(contagem.noMaximo).toBeGreaterThan(50);
    expect(contagem.degenerado).toBeGreaterThan(50);
  });

  it('fitToBounds depois de centerOn e de zoomAt não importa: a câmera inicial é descartada', () => {
    const random = seededRandom(8);
    for (let i = 0; i < 200; i++) {
      const conteudo = bounds(-100 * random(), -100 * random(), 100 * random() + 1, 100 * random() + 1);
      const area = viewport(200 + random() * 400, 200 + random() * 400);
      const esperado = fitToBounds(NEUTRAL_CAMERA, conteudo, area, { margin: 10 });

      expect(fitToBounds(randomCamera(random), conteudo, area, { margin: 10 })).toStrictEqual(esperado);
    }
  });
});
