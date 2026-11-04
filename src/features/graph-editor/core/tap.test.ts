import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  NEUTRAL_CAMERA,
  applyAction,
  createEditorState,
  emptyLayout,
  hitTest,
  placeVertex,
  positionOf,
  screenToWorld,
  tapToEditorAction,
  worldToScreen,
  type Camera,
  type EditorMode,
  type EditorState,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Tradução do toque em ação (ver tap.ts). O toque está em dp RELATIVO ao canvas, a mesma origem da câmera e da cena. O
// hit-testing não é refeito aqui: os testes usam o `hitTest` do 3.3 como oráculo de "o que está sob o dedo".

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = {
  mode?: EditorMode;
  directed?: boolean;
  /** Vértices v1, v2… nas posições do MUNDO dadas. */
  vertices?: readonly (readonly [number, number])[];
  /** Arestas por índice de vértice (1-based). */
  edges?: readonly (readonly [number, number])[];
};

/** Estado do editor montado só com a API pública (domínio, layout e núcleo). */
function stateOf({ mode = 'add-vertex', directed = false, vertices = [], edges = [] }: Spec = {}): EditorState {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  for (const [source, target] of edges) graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}` })).graph;
  return createEditorState({ graph, layout, mode });
}

const tap = (state: EditorState, camera: Camera, screenPoint: Point, viewport = VIEWPORT) =>
  tapToEditorAction(state, camera, screenPoint, viewport);

describe('tapToEditorAction: o caso básico', () => {
  it('grafo vazio, modo Adicionar vértice: o toque vira add-vertex na mesma posição (câmera neutra)', () => {
    expect(tap(stateOf(), NEUTRAL_CAMERA, point(100, 150))).toStrictEqual({ type: 'add-vertex', position: { x: 100, y: 150 } });
  });

  it('os cantos e as bordas do canvas contam como dentro: (0,0) e (largura, altura)', () => {
    expect(tap(stateOf(), NEUTRAL_CAMERA, point(0, 0))).toStrictEqual({ type: 'add-vertex', position: { x: 0, y: 0 } });
    expect(tap(stateOf(), NEUTRAL_CAMERA, point(360, 320))).toStrictEqual({ type: 'add-vertex', position: { x: 360, y: 320 } });
  });

  it('a posição devolvida é um objeto novo (sem alias do ponto tocado)', () => {
    const toque = point(10, 20);
    const acao = tap(stateOf(), NEUTRAL_CAMERA, toque);

    expect(acao?.type === 'add-vertex' && acao.position).not.toBe(toque);
  });
});

describe('tapToEditorAction: conversão de dp de tela para mundo (calculada à mão)', () => {
  it.each([
    // [câmera, toque em dp, posição esperada no mundo]
    [{ x: 0, y: 0, scale: 1 }, point(180, 160), point(180, 160)],
    [{ x: 40, y: -30, scale: 2 }, point(200, 130), point(80, 80)], // ((200 − 40)/2, (130 + 30)/2)
    [{ x: 0, y: 0, scale: 0.25 }, point(30, 40), point(120, 160)], // zoom afastado: dp / 0,25
    [{ x: -100, y: -60, scale: 4 }, point(100, 100), point(50, 40)], // zoom aproximado: (100 + 100)/4 e (100 + 60)/4
    [{ x: 300, y: 200, scale: 1 }, point(100, 100), point(-200, -100)], // translação positiva leva a coordenadas negativas
    [{ x: -50, y: 25, scale: 0.5 }, point(0, 0), point(100, -50)],
  ])('câmera %j, toque %j → mundo %j', (camera, toque, esperado) => {
    expect(tap(stateOf(), camera, toque)).toStrictEqual({ type: 'add-vertex', position: esperado });
  });

  it('o ponto convertido volta exatamente ao toque por `worldToScreen` (ida e volta)', () => {
    for (const camera of [NEUTRAL_CAMERA, { x: 40, y: -30, scale: 2 }, { x: 0, y: 0, scale: 0.25 }, { x: -100, y: -60, scale: 4 }]) {
      const acao = tap(stateOf(), camera, point(123.5, 77.25));
      if (acao?.type !== 'add-vertex') throw new Error('esperava add-vertex');

      expect(worldToScreen(camera, acao.position).x).toBeCloseTo(123.5, 9);
      expect(worldToScreen(camera, acao.position).y).toBeCloseTo(77.25, 9);
      expect(acao.position).toStrictEqual(screenToWorld(camera, point(123.5, 77.25)));
    }
  });

  it('a escala e a translação valem UMA vez cada: nenhuma delas é aplicada em dobro', () => {
    const camera: Camera = { x: 20, y: 10, scale: 4 };
    const acao = tap(stateOf(), camera, point(100, 90));

    expect(acao).toStrictEqual({ type: 'add-vertex', position: { x: 20, y: 20 } }); // ((100 − 20)/4, (90 − 10)/4)
    expect(acao).not.toStrictEqual({ type: 'add-vertex', position: { x: 5, y: 5 } }); // escala em dobro: 80/16
    expect(acao).not.toStrictEqual({ type: 'add-vertex', position: { x: 25, y: 22.5 } }); // sem a translação: 100/4 e 90/4
  });

  it('o eixo Y não é invertido nem deslocado: dois toques na mesma coluna mantêm a ordem em Y', () => {
    const cima = tap(stateOf(), { x: 30, y: 50, scale: 2 }, point(100, 60));
    const baixo = tap(stateOf(), { x: 30, y: 50, scale: 2 }, point(100, 260));

    if (cima?.type !== 'add-vertex' || baixo?.type !== 'add-vertex') throw new Error('esperava add-vertex');
    expect(baixo.position.y).toBeGreaterThan(cima.position.y);
    expect(baixo.position.y - cima.position.y).toBe(100); // 200 dp / escala 2
  });
});

describe('tapToEditorAction: o modo', () => {
  it.each<EditorMode>(['select', 'connect'])('modo %s: nenhuma ação (a interação ainda não está autorizada)', (mode) => {
    expect(tap(stateOf({ mode }), NEUTRAL_CAMERA, point(100, 100))).toBeUndefined();
    expect(tap(stateOf({ mode, vertices: [[200, 200]] }), NEUTRAL_CAMERA, point(100, 100))).toBeUndefined();
  });

  it('só o modo add-vertex cria (o mesmo toque, três modos)', () => {
    const resultados = (['select', 'add-vertex', 'connect'] as const).map((mode) => tap(stateOf({ mode }), NEUTRAL_CAMERA, point(50, 50))?.type);

    expect(resultados).toStrictEqual([undefined, 'add-vertex', undefined]);
  });
});

describe('tapToEditorAction: o que está sob o dedo (hit-testing do 3.3)', () => {
  it('toque sobre um vértice não cria nada: o alvo mínimo de 24 dp de raio vale até a fronteira exata', () => {
    const estado = stateOf({ vertices: [[100, 100]] });

    expect(tap(estado, NEUTRAL_CAMERA, point(100, 100))).toBeUndefined(); // no centro
    expect(tap(estado, NEUTRAL_CAMERA, point(124, 100))).toBeUndefined(); // a 24 dp (conta)
    expect(tap(estado, NEUTRAL_CAMERA, point(124.01, 100))?.type).toBe('add-vertex'); // logo além
    expect(tap(estado, NEUTRAL_CAMERA, point(120, 120))?.type).toBe('add-vertex'); // a 28,3 dp na diagonal
    expect(tap(estado, NEUTRAL_CAMERA, point(116, 116))).toBeUndefined(); // a 22,6 dp na diagonal: dentro da área
  });

  it('com zoom afastado (0,25) o alvo continua 24 dp; com zoom aproximado (4) vale o raio visual de 80 dp', () => {
    const longe = stateOf({ vertices: [[400, 400]] }); // em (100, 100) com escala 0,25
    const perto = stateOf({ vertices: [[50, 50]] }); // em (200, 200) com escala 4

    expect(tap(longe, { x: 0, y: 0, scale: 0.25 }, point(123, 100))).toBeUndefined();
    expect(tap(longe, { x: 0, y: 0, scale: 0.25 }, point(125, 100))?.type).toBe('add-vertex');
    expect(tap(perto, { x: 0, y: 0, scale: 4 }, point(279, 200))).toBeUndefined();
    expect(tap(perto, { x: 0, y: 0, scale: 4 }, point(281, 200))?.type).toBe('add-vertex');
  });

  it('toque sobre uma aresta não cria nada: 12 dp de tolerância, e logo além cria', () => {
    // vértices em (60,160) e (300,160): o traço vai de (80,160) a (280,160); o meio, (180,160), está longe das áreas dos vértices
    const estado = stateOf({ vertices: [[60, 160], [300, 160]], edges: [[1, 2]] });

    expect(tap(estado, NEUTRAL_CAMERA, point(180, 160))).toBeUndefined();
    expect(tap(estado, NEUTRAL_CAMERA, point(180, 172))).toBeUndefined(); // a 12 dp
    expect(tap(estado, NEUTRAL_CAMERA, point(180, 172.01))?.type).toBe('add-vertex');
    expect(tap(estado, NEUTRAL_CAMERA, point(180, 148))).toBeUndefined();
    expect(tap(estado, NEUTRAL_CAMERA, point(180, 147.99))?.type).toBe('add-vertex');
  });

  it('a tolerância da aresta é em dp: com zoom 0,25 e 4 o limite continua a 12 dp do traço', () => {
    for (const scale of [0.25, 4]) {
      const camera: Camera = { x: 0, y: 0, scale };
      const estado = stateOf({ vertices: [[0, 0], [2000, 0]], edges: [[1, 2]] });
      const meio = worldToScreen(camera, point(1000, 0));

      expect(tap(estado, camera, point(meio.x, meio.y + 11), { width: 5000, height: 5000 })).toBeUndefined();
      expect(tap(estado, camera, point(meio.x, meio.y + 13), { width: 5000, height: 5000 })?.type).toBe('add-vertex');
    }
  });

  it('a aresta curva de um arco oposto também bloqueia (a trajetória de Bézier, não a corda)', () => {
    const estado = stateOf({ directed: true, vertices: [[60, 160], [260, 160]], edges: [[1, 2], [2, 1]] });
    // o ápice do arco v1 → v2 fica a ≈ 30 dp abaixo da corda (y > 160); o meio da corda (160,160) NÃO acerta nenhuma aresta
    const apice = point(160, 160 + 30);

    expect(tap(estado, NEUTRAL_CAMERA, apice)).toBeUndefined();
    expect(tap(estado, NEUTRAL_CAMERA, point(160, 160))?.type).toBe('add-vertex');
  });

  it('as opções de hit-testing do desenho valem: com alvo mínimo de 100 dp um toque a 40 dp do vértice é bloqueado', () => {
    const estado = stateOf({ vertices: [[100, 100]] });

    expect(tap(estado, NEUTRAL_CAMERA, point(140, 100))?.type).toBe('add-vertex');
    expect(tapToEditorAction(estado, NEUTRAL_CAMERA, point(140, 100), VIEWPORT, { minTouchDiameter: 100 })).toBeUndefined();
  });

  it('uma ação válida, quando aplicada, cria o vértice ONDE foi o toque (A, na posição do toque)', () => {
    const camera: Camera = { x: 40, y: -30, scale: 2 };
    const acao = tap(stateOf(), camera, point(200, 130));
    if (acao === undefined) throw new Error('esperava uma ação');
    const { state } = applyAction(stateOf(), acao);

    expect(state.graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]);
    const centro = worldToScreen(camera, positionOf(state.layout, 'v1')!);
    expect(centro.x).toBeCloseTo(200, 9);
    expect(centro.y).toBeCloseTo(130, 9);
  });
});

describe('tapToEditorAction: entradas inválidas e fora do canvas', () => {
  it.each([
    ['x negativo', point(-0.01, 10)],
    ['y negativo', point(10, -0.01)],
    ['além da largura', point(360.01, 10)],
    ['além da altura', point(10, 320.01)],
    ['bem fora', point(5000, -3000)],
  ])('toque fora do canvas (%s): nenhuma ação', (_nome, toque) => {
    expect(tap(stateOf(), NEUTRAL_CAMERA, toque)).toBeUndefined();
  });

  it.each([point(Number.NaN, 10), point(10, Number.NaN), point(Number.POSITIVE_INFINITY, 10), point(10, Number.NEGATIVE_INFINITY)])(
    'toque não finito %j: nenhuma ação',
    (toque) => {
      expect(tap(stateOf(), NEUTRAL_CAMERA, toque)).toBeUndefined();
    },
  );

  it.each([
    { x: 0, y: 0, scale: 0 },
    { x: 0, y: 0, scale: -1 },
    { x: Number.NaN, y: 0, scale: 1 },
    { x: 0, y: Number.POSITIVE_INFINITY, scale: 1 },
    { x: 0, y: 0, scale: Number.NaN },
  ])('câmera inválida %j: nenhuma ação', (camera) => {
    expect(tap(stateOf(), camera, point(100, 100))).toBeUndefined();
  });

  it.each([
    { width: 0, height: 320 },
    { width: 360, height: 0 },
    { width: -10, height: 320 },
    { width: Number.NaN, height: 320 },
    { width: 360, height: Number.POSITIVE_INFINITY },
  ])('área do canvas inválida %j: nenhuma ação', (viewport) => {
    expect(tapToEditorAction(stateOf(), NEUTRAL_CAMERA, point(100, 100), viewport)).toBeUndefined();
  });

  // Com largura (ou altura) 0, um toque exatamente na borda (x = 0 ou y = 0) passaria pela checagem de limites: a área degenerada
  // precisa ser recusada por si só, não só porque o toque cai fora dela.
  it.each([
    [{ width: 0, height: 320 }, point(0, 100)],
    [{ width: 360, height: 0 }, point(100, 0)],
    [{ width: 0, height: 0 }, point(0, 0)],
  ])('área do canvas degenerada %j com o toque sobre a borda %j: nenhuma ação', (viewport, toque) => {
    expect(tapToEditorAction(stateOf(), NEUTRAL_CAMERA, toque, viewport)).toBeUndefined();
  });

  it('layout de outro grafo (estado incoerente): nenhuma ação', () => {
    const estado = stateOf();
    const incoerente = { ...estado, layout: emptyLayout('outro') } as EditorState;

    expect(tap(incoerente, NEUTRAL_CAMERA, point(100, 100))).toBeUndefined();
  });

  it('um toque cuja conversão estoura (escala minúscula) não gera posição não finita', () => {
    expect(tap(stateOf(), { x: 0, y: 0, scale: 1e-320 }, point(100, 100))).toBeUndefined();
  });
});

describe('tapToEditorAction: propriedades (sementes fixas)', () => {
  it('500 casos: só há ação se o modo é add-vertex, o toque está no canvas e o hitTest diz fundo; a posição volta ao toque', () => {
    const contagem = { acao: 0, bloqueado: 0, foraOuModo: 0 };
    for (let seed = 1; seed <= 500; seed++) {
      const random = seededRandom(seed);
      const camera: Camera = { x: Math.round((random() * 2 - 1) * 300), y: Math.round((random() * 2 - 1) * 300), scale: [0.25, 1, 4][seed % 3]! };
      const viewport = { width: 200 + Math.floor(random() * 300), height: 200 + Math.floor(random() * 300) };
      const n = Math.floor(random() * 5);
      // os vértices nascem em pontos de tela DENTRO do canvas e são convertidos para o mundo
      const vertices = Array.from({ length: n }, () => {
        const mundo = screenToWorld(camera, point(random() * viewport.width, random() * viewport.height));
        return [mundo.x, mundo.y] as const;
      });
      const edges: [number, number][] = n >= 2 && random() < 0.7 ? [[1, 2]] : [];
      const mode: EditorMode = random() < 0.85 ? 'add-vertex' : random() < 0.5 ? 'select' : 'connect';
      const estado = stateOf({ mode, directed: random() < 0.5, vertices, edges });
      // metade dos toques cai perto de um vértice (±40 dp do centro na tela), para exercitar o bloqueio
      const alvoVertice = n > 0 && random() < 0.5 ? worldToScreen(camera, point(...vertices[Math.floor(random() * n)]!)) : undefined;
      const toque =
        alvoVertice === undefined
          ? point(Math.round(random() * (viewport.width + 80) - 40), Math.round(random() * (viewport.height + 80) - 40))
          : point(Math.round(alvoVertice.x + (random() * 2 - 1) * 40), Math.round(alvoVertice.y + (random() * 2 - 1) * 40));
      const dentro = toque.x >= 0 && toque.y >= 0 && toque.x <= viewport.width && toque.y <= viewport.height;
      const alvo = hitTest(estado.graph, estado.layout, camera, toque);
      const acao = tapToEditorAction(estado, camera, toque, viewport);

      if (mode === 'add-vertex' && dentro && alvo?.type === 'background') {
        contagem.acao++;
        if (acao?.type !== 'add-vertex') throw new Error(`seed ${seed}: esperava add-vertex`);
        const volta = worldToScreen(camera, acao.position);

        expect(Math.abs(volta.x - toque.x)).toBeLessThan(1e-9 * Math.max(1, Math.abs(toque.x)));
        expect(Math.abs(volta.y - toque.y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(toque.y)));
      } else {
        expect(acao).toBeUndefined();
        if (mode === 'add-vertex' && dentro) contagem.bloqueado++;
        else contagem.foraOuModo++;
      }
    }

    expect(contagem.acao).toBeGreaterThan(150);
    expect(contagem.bloqueado).toBeGreaterThan(30);
    expect(contagem.foraOuModo).toBeGreaterThan(100);
  });

  it('não altera o estado, a câmera nem o toque (congelados) e é determinística', () => {
    const estado = deepFreeze(stateOf({ vertices: [[100, 100]] }));
    const camera = deepFreeze({ x: 5, y: 6, scale: 2 });
    const toque = deepFreeze(point(250, 200));
    const antes = JSON.stringify([estado, camera, toque]);
    const primeira = tapToEditorAction(estado, camera, toque, VIEWPORT);

    expect(primeira).toBeDefined();
    expect(tapToEditorAction(estado, camera, toque, VIEWPORT)).toStrictEqual(primeira);
    expect(JSON.stringify([estado, camera, toque])).toBe(antes);
  });
});

describe('tapToEditorAction + applyAction: A, B, C, desfazer C, novo C com id diferente', () => {
  /** Aplica o toque ao estado; falha o teste se ele não gerar ação. */
  function toque(estado: EditorState, camera: Camera, ponto: Point): EditorState {
    const acao = tapToEditorAction(estado, camera, ponto, VIEWPORT);
    if (acao === undefined) throw new Error(`o toque ${JSON.stringify(ponto)} deveria gerar uma ação`);
    return applyAction(estado, acao).state;
  }

  it('toques consecutivos num grafo vazio: v1 A, v2 B, v3 C; desfazer; o novo toque dá v4 com o rótulo C', () => {
    const camera: Camera = { x: 10, y: 20, scale: 1.5 };
    let estado = stateOf();
    estado = toque(estado, camera, point(60, 60));
    estado = toque(estado, camera, point(180, 60));
    estado = toque(estado, camera, point(300, 60));

    expect(estado.graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v3', 'C']]);
    estado = applyAction(estado, { type: 'undo' }).state;
    expect(estado.graph.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2']);
    estado = toque(estado, camera, point(240, 200));

    expect(estado.graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v4', 'C']]);
    for (const [id, tela] of [['v1', point(60, 60)], ['v2', point(180, 60)], ['v4', point(240, 200)]] as const) {
      const centro = worldToScreen(camera, positionOf(estado.layout, id)!);

      expect(centro.x).toBeCloseTo(tela.x, 9);
      expect(centro.y).toBeCloseTo(tela.y, 9);
    }
  });

  it('um toque sobre o vértice recém-criado não cria outro (o histórico não ganha passo)', () => {
    const camera = NEUTRAL_CAMERA;
    const comUm = toque(stateOf(), camera, point(100, 100));
    const passos = comUm.history.past.length;

    expect(tap(comUm, camera, point(105, 98))).toBeUndefined();
    expect(comUm.history.past.length).toBe(passos);
  });
});
