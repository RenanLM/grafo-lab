import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  DRAG_START_DISTANCE_DP,
  NEUTRAL_CAMERA,
  applyAction,
  createEditorState,
  dragActivated,
  dragCommitAction,
  dragFinalPosition,
  dragPreviewPosition,
  emptyLayout,
  finishDrag,
  hitTest,
  isDragSessionValid,
  moveVertex,
  placeVertex,
  positionOf,
  removePosition,
  screenToWorld,
  startDrag,
  worldToScreen,
  type Camera,
  type DragSession,
  type EditorMode,
  type EditorState,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Matemática pura do arrasto (ver drag.ts). O hit-testing não é refeito aqui: o `hitTest` do 3.3 é o oráculo. Os exemplos são contas feitas
// à mão (câmera neutra, `{40, −30, 2}`, escalas 0,25 e 4). Quem aplica a ação final é o `applyAction`; a sessão nunca altera nada.

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

function stateOf({ mode = 'select', directed = false, vertices = [[60, 60], [200, 60], [130, 200]], edges = [] }: Spec = {}): EditorState {
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

const begin = (state: EditorState, at: Point, camera: Camera = NEUTRAL_CAMERA): DragSession => {
  const session = startDrag(state, camera, at, VIEWPORT);
  if (session === undefined) throw new Error(`esperava uma sessão em (${at.x}, ${at.y})`);
  return session;
};

/** Um grafo com um único vértice que, com a câmera dada, aparece no centro do canvas; o dedo desce sobre ele, deslocado por `finger`. */
function centered(camera: Camera, finger: Point = point(0, 0)) {
  const world = screenToWorld(camera, point(180, 160));
  const state = stateOf({ vertices: [[world.x, world.y]] });
  return { state, session: begin(state, point(180 + finger.x, 160 + finger.y), camera) };
}

const CAMERAS: readonly Camera[] = [
  NEUTRAL_CAMERA,
  { x: 0, y: 0, scale: 0.25 },
  { x: 0, y: 0, scale: 4 },
  { x: 40, y: -30, scale: 2 },
  { x: -120, y: 75, scale: 0.25 },
  { x: 200, y: -50, scale: 4 },
  { x: -5.5, y: 12.25, scale: 1.5 },
];

describe('startDrag: quando o arrasto começa', () => {
  it('sobre o centro de um vértice: a sessão guarda o id técnico, a posição no mundo, o ponto do dedo e a câmera', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));

    expect(session).toMatchObject({
      graphId: 'g',
      vertexId: 'v1',
      startWorldPosition: { x: 60, y: 60 },
      startScreenPoint: { x: 60, y: 60 },
      grabOffset: { x: 0, y: 0 },
      camera: { x: 0, y: 0, scale: 1 },
    });
    expect(session.baseGraph).toBe(state.graph);
    expect(session.baseLayout).toBe(state.layout);
  });

  it('com o dedo fora do centro, o grab offset é a diferença entre o dedo e o centro na tela: (70, 55) − (60, 60) = (10, −5)', () => {
    const session = begin(stateOf(), point(70, 55));

    expect(session.grabOffset).toStrictEqual({ x: 10, y: -5 });
    expect(session.startScreenPoint).toStrictEqual({ x: 70, y: 55 });
    expect(session.startWorldPosition).toStrictEqual({ x: 60, y: 60 });
  });

  it('com a câmera {40, −30, 2}: o centro de v1 está em (160, 90) na tela; o dedo em (170, 85) dá offset (10, −5) e a posição do mundo continua (60, 60)', () => {
    const camera = { x: 40, y: -30, scale: 2 };
    const session = begin(stateOf(), point(170, 85), camera);

    expect(worldToScreen(camera, point(60, 60))).toStrictEqual({ x: 160, y: 90 });
    expect(session.grabOffset).toStrictEqual({ x: 10, y: -5 });
    expect(session.startWorldPosition).toStrictEqual({ x: 60, y: 60 });
    expect(session.camera).toStrictEqual(camera);
  });

  it('o grab offset é em dp de tela e não depende da escala: o mesmo dedo a 10 dp do centro dá 10, com escala 0,25 ou 4', () => {
    for (const scale of [0.25, 1, 4]) {
      const { session } = centered({ x: 15, y: -8, scale }, point(10, 0));

      expect(session.grabOffset.x).toBeCloseTo(10, 9);
      expect(session.grabOffset.y).toBeCloseTo(0, 9);
    }
  });

  it('o alvo de toque do vértice é o do hit-testing (48 dp): a 23 dp do centro começa; a 25 dp não', () => {
    const state = stateOf();

    expect(startDrag(state, NEUTRAL_CAMERA, point(60 + 23, 60), VIEWPORT)?.vertexId).toBe('v1');
    expect(startDrag(state, NEUTRAL_CAMERA, point(60 + 25, 60), VIEWPORT)).toBeUndefined();
  });

  it('começar no fundo não move vértice nenhum: nenhuma sessão', () => {
    expect(startDrag(stateOf(), NEUTRAL_CAMERA, point(320, 280), VIEWPORT)).toBeUndefined();
    expect(startDrag(stateOf({ vertices: [] }), NEUTRAL_CAMERA, point(100, 100), VIEWPORT)).toBeUndefined(); // até em grafo vazio
  });

  it('começar sobre uma aresta não move vértice nenhum (o ponto médio de v1—v2 está longe dos dois)', () => {
    const state = stateOf({ edges: [[1, 2]] });

    expect(hitTest(state.graph, state.layout, NEUTRAL_CAMERA, point(130, 60))).toMatchObject({ type: 'edge' });
    expect(startDrag(state, NEUTRAL_CAMERA, point(130, 60), VIEWPORT)).toBeUndefined();
  });

  it('vértice sobre aresta: o vértice vence (prioridade vértice > aresta), e o arrasto é do vértice', () => {
    const state = stateOf({ vertices: [[60, 60], [200, 60], [130, 60]], edges: [[1, 2]] }); // v3 em cima da aresta v1—v2

    expect(startDrag(state, NEUTRAL_CAMERA, point(130, 60), VIEWPORT)?.vertexId).toBe('v3');
  });

  it('só no modo Selecionar: em Adicionar vértice e em Conectar, tocar num vértice não começa arrasto', () => {
    expect(startDrag(stateOf({ mode: 'add-vertex' }), NEUTRAL_CAMERA, point(60, 60), VIEWPORT)).toBeUndefined();
    expect(startDrag(stateOf({ mode: 'connect' }), NEUTRAL_CAMERA, point(60, 60), VIEWPORT)).toBeUndefined();
    expect(startDrag(stateOf({ mode: 'select' }), NEUTRAL_CAMERA, point(60, 60), VIEWPORT)).toBeDefined();
  });

  it('o ponto inicial precisa estar dentro do canvas, com os limites incluídos', () => {
    const state = stateOf({ vertices: [[10, 60], [350, 160]] });

    expect(startDrag(state, NEUTRAL_CAMERA, point(0, 60), VIEWPORT)?.vertexId).toBe('v1'); // x = 0 conta
    expect(startDrag(state, NEUTRAL_CAMERA, point(-1, 60), VIEWPORT)).toBeUndefined();
    expect(startDrag(state, NEUTRAL_CAMERA, point(360, 160), VIEWPORT)?.vertexId).toBe('v2'); // x = largura conta
    expect(startDrag(state, NEUTRAL_CAMERA, point(361, 160), VIEWPORT)).toBeUndefined();
  });

  it('câmera inválida (escala zero, negativa, não finita; translação não finita): nenhuma sessão', () => {
    const state = stateOf();
    const invalid: Camera[] = [
      { x: 0, y: 0, scale: 0 },
      { x: 0, y: 0, scale: -1 },
      { x: 0, y: 0, scale: NaN },
      { x: Infinity, y: 0, scale: 1 },
      { x: 0, y: NaN, scale: 1 },
    ];

    for (const camera of invalid) expect(startDrag(state, camera, point(60, 60), VIEWPORT)).toBeUndefined();
  });

  it('viewport inválido ou ponto não finito: nenhuma sessão', () => {
    const state = stateOf();

    expect(startDrag(state, NEUTRAL_CAMERA, point(60, 60), { width: 0, height: 320 })).toBeUndefined();
    expect(startDrag(state, NEUTRAL_CAMERA, point(60, 60), { width: 360, height: NaN })).toBeUndefined();
    expect(startDrag(state, NEUTRAL_CAMERA, point(NaN, 60), VIEWPORT)).toBeUndefined();
    expect(startDrag(state, NEUTRAL_CAMERA, point(60, Infinity), VIEWPORT)).toBeUndefined();
  });

  it('layout de outro grafo, ou vértice sem posição: nenhuma sessão', () => {
    const state = stateOf();
    const otherLayout = placeVertex(emptyLayout('outro'), 'v1', point(60, 60));

    expect(startDrag({ ...state, layout: otherLayout }, NEUTRAL_CAMERA, point(60, 60), VIEWPORT)).toBeUndefined();
    expect(startDrag({ ...state, layout: removePosition(state.layout, 'v1') }, NEUTRAL_CAMERA, point(60, 60), VIEWPORT)).toBeUndefined();
  });

  it('vértices sobrepostos: vence o de centro mais próximo do dedo; o empate exato fica com o primeiro da ordem de inserção', () => {
    const state = stateOf({ vertices: [[60, 60], [80, 60]] });

    expect(startDrag(state, NEUTRAL_CAMERA, point(70, 60), VIEWPORT)?.vertexId).toBe('v1'); // a 10 dp dos dois
    expect(startDrag(state, NEUTRAL_CAMERA, point(75, 60), VIEWPORT)?.vertexId).toBe('v2');
    expect(startDrag(state, NEUTRAL_CAMERA, point(64, 60), VIEWPORT)?.vertexId).toBe('v1');
  });

  it('as opções de geometria e de hit-testing chegam ao hit-test: com raio 5 e alvo mínimo de 20 dp, a 15 dp do centro já não acerta', () => {
    const state = stateOf();

    expect(startDrag(state, NEUTRAL_CAMERA, point(75, 60), VIEWPORT)?.vertexId).toBe('v1');
    expect(startDrag(state, NEUTRAL_CAMERA, point(75, 60), VIEWPORT, { vertexRadius: 5, minTouchDiameter: 20 })).toBeUndefined();
  });

  it('a sessão é imutável e não guarda alias da câmera nem do ponto recebidos', () => {
    const camera = { x: 40, y: -30, scale: 2 };
    const touch = { x: 170, y: 85 };
    const session = begin(stateOf(), touch, camera);
    camera.x = 999;
    touch.x = 999;

    expect(session.camera).toStrictEqual({ x: 40, y: -30, scale: 2 });
    expect(session.startScreenPoint).toStrictEqual({ x: 170, y: 85 });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.camera)).toBe(true);
    expect(Object.isFrozen(session.startWorldPosition)).toBe(true);
    expect(Object.isFrozen(session.startScreenPoint)).toBe(true);
    expect(Object.isFrozen(session.grabOffset)).toBe(true);
  });

  it('o zero negativo vira zero (o mesmo cuidado da câmera e do layout)', () => {
    const state = stateOf({ vertices: [[0, 0]] });
    const session = begin(state, point(-0, -0));

    expect(Object.is(session.startScreenPoint.x, 0)).toBe(true);
    expect(Object.is(session.startScreenPoint.y, 0)).toBe(true);
    expect(Object.is(session.grabOffset.x, 0)).toBe(true);
    expect(Object.is(session.grabOffset.y, 0)).toBe(true);
  });

  it('não altera o estado recebido (entradas congeladas) e é determinística', () => {
    const state = deepFreeze(stateOf({ edges: [[1, 2]] }));
    const camera = deepFreeze({ x: 40, y: -30, scale: 2 });
    const a = startDrag(state, camera, point(170, 85), VIEWPORT);
    const b = startDrag(state, camera, point(170, 85), VIEWPORT);

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
  });

  it('500 sorteios com semente fixa: a sessão existe exatamente quando o hitTest (oráculo) acerta um vértice, e é a do mesmo vértice', () => {
    const random = seededRandom(20260513);
    const between = (min: number, max: number) => min + random() * (max - min);
    for (let round = 0; round < 500; round++) {
      const count = 2 + Math.floor(random() * 6);
      const vertices = Array.from({ length: count }, () => [between(-150, 450), between(-150, 450)] as const);
      const edges: [number, number][] = [];
      for (let k = 0; k < count; k++) edges.push([1 + Math.floor(random() * count), 1 + Math.floor(random() * count)]);
      const state = stateOf({
        vertices,
        edges: edges.filter(([a, b], index) => a !== b && edges.findIndex(([c, d]) => (c === a && d === b) || (c === b && d === a)) === index),
      });
      const camera = CAMERAS[Math.floor(random() * CAMERAS.length)]!;
      const touch = point(between(-5, 365), between(-5, 325));

      const session = startDrag(state, camera, touch, VIEWPORT);
      const inside = touch.x >= 0 && touch.y >= 0 && touch.x <= VIEWPORT.width && touch.y <= VIEWPORT.height;
      const hit = inside ? hitTest(state.graph, state.layout, camera, touch) : undefined;

      if (hit?.type === 'vertex') {
        expect(session?.vertexId).toBe(hit.vertexId);
        const center = worldToScreen(camera, positionOf(state.layout, hit.vertexId)!);
        expect(session?.grabOffset.x).toBeCloseTo(touch.x - center.x, 9);
        expect(session?.grabOffset.y).toBeCloseTo(touch.y - center.y, 9);
      } else {
        expect(session).toBeUndefined();
      }
    }
  });
});

describe('dragActivated: o limiar do arrasto é o do toque', () => {
  const session = () => begin(stateOf(), point(60, 60));

  it('o limiar padrão é de 10 dp, o mesmo `maxDistance` do toque', () => {
    expect(DRAG_START_DISTANCE_DP).toBe(10);
  });

  it('a distância euclidiana desde o ponto inicial: 9,99 dp não ativa; 10 dp ativa (nos dois eixos e na diagonal 6–8–10)', () => {
    expect(dragActivated(session(), point(60 + 9.99, 60))).toBe(false);
    expect(dragActivated(session(), point(60 + 10, 60))).toBe(true);
    expect(dragActivated(session(), point(60, 60 - 10))).toBe(true);
    expect(dragActivated(session(), point(60 - 6, 60 + 8))).toBe(true); // hipotenusa exata: 10
    expect(dragActivated(session(), point(60 + 7, 60 + 7))).toBe(false); // 9,899
  });

  it('o ponto parado, ou um pequeno tremor do dedo, não ativa', () => {
    expect(dragActivated(session(), point(60, 60))).toBe(false);
    expect(dragActivated(session(), point(62, 58))).toBe(false);
  });

  it('um limiar diferente vale; um limiar inválido (0, negativo, NaN) volta ao padrão', () => {
    expect(dragActivated(session(), point(65, 60), 5)).toBe(true);
    expect(dragActivated(session(), point(64, 60), 5)).toBe(false);
    for (const threshold of [0, -3, NaN, Infinity]) {
      expect(dragActivated(session(), point(65, 60), threshold)).toBe(false);
      expect(dragActivated(session(), point(70, 60), threshold)).toBe(true);
    }
  });

  it('ponto não finito: não ativa', () => {
    expect(dragActivated(session(), point(NaN, 60))).toBe(false);
    expect(dragActivated(session(), point(60, Infinity))).toBe(false);
  });
});

describe('dragPreviewPosition e dragFinalPosition: onde o vértice fica', () => {
  const origin = (camera: Camera) => begin(stateOf(), worldToScreen(camera, point(60, 60)), camera);

  it('câmera neutra: a posição é a inicial mais o deslocamento, em horizontal, em vertical e na diagonal (negativos incluídos)', () => {
    const session = origin(NEUTRAL_CAMERA);

    expect(dragPreviewPosition(session, point(30, 0))).toStrictEqual({ x: 90, y: 60 });
    expect(dragPreviewPosition(session, point(0, -20))).toStrictEqual({ x: 60, y: 40 });
    expect(dragPreviewPosition(session, point(-100, 25))).toStrictEqual({ x: -40, y: 85 });
  });

  it('o deslocamento em dp é dividido pela escala: escala 2 (30 dp = 15 unidades), 0,25 (10 dp = 40) e 4 (10 dp = 2,5)', () => {
    expect(dragPreviewPosition(origin({ x: 0, y: 0, scale: 2 }), point(30, -20))).toStrictEqual({ x: 75, y: 50 });
    expect(dragPreviewPosition(origin({ x: 0, y: 0, scale: 0.25 }), point(10, 10))).toStrictEqual({ x: 100, y: 100 });
    expect(dragPreviewPosition(origin({ x: 0, y: 0, scale: 4 }), point(10, 10))).toStrictEqual({ x: 62.5, y: 62.5 });
  });

  it('a translação da câmera não interfere: o mesmo deslocamento dá a mesma posição com {40, −30, 2} e com {−120, 75, 2}', () => {
    const a = origin({ x: 40, y: -30, scale: 2 });
    const b = origin({ x: -120, y: 75, scale: 2 });

    expect(dragPreviewPosition(a, point(30, -20))).toStrictEqual({ x: 75, y: 50 });
    expect(dragPreviewPosition(b, point(30, -20))).toStrictEqual({ x: 75, y: 50 });
  });

  it('deslocamento nulo devolve EXATAMENTE a posição inicial, sem erro de arredondamento', () => {
    const state = stateOf({ vertices: [[0.1, 0.7]] });
    const camera = { x: 0, y: 0, scale: 3 };
    const session = begin(state, worldToScreen(camera, point(0.1, 0.7)), camera);

    expect(dragPreviewPosition(session, point(0, 0))).toStrictEqual({ x: 0.1, y: 0.7 });
    expect(dragFinalPosition(session, point(0, 0))).toStrictEqual({ x: 0.1, y: 0.7 });
  });

  it('coordenadas negativas: o vértice atravessa a origem do mundo, e o zero nunca sai negativo', () => {
    const camera = { x: 100, y: 100, scale: 1 }; // o vértice (−5, 0) aparece em (95, 100)
    const session = begin(stateOf({ vertices: [[-5, 0]] }), point(95, 100), camera);
    const crossing = dragPreviewPosition(session, point(5, -0));

    expect(crossing).toStrictEqual({ x: 0, y: 0 });
    expect(Object.is(crossing?.x, 0)).toBe(true);
    expect(Object.is(crossing?.y, 0)).toBe(true);
    expect(dragPreviewPosition(session, point(-20, -30))).toStrictEqual({ x: -25, y: -30 });
  });

  it('o resultado é um objeto novo a cada chamada e as entradas não mudam', () => {
    const session = origin(NEUTRAL_CAMERA);
    const translation = deepFreeze(point(30, 10));
    const a = dragPreviewPosition(session, translation);
    const b = dragPreviewPosition(session, translation);

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
    expect(session.startWorldPosition).toStrictEqual({ x: 60, y: 60 });
  });

  it('deslocamento não finito, ou resultado que estoura: undefined', () => {
    const session = origin(NEUTRAL_CAMERA);
    const big = begin(stateOf({ vertices: [[1e308, 0]] }), point(0, 0), { x: -1e308, y: 0, scale: 1 });

    expect(dragPreviewPosition(session, point(NaN, 0))).toBeUndefined();
    expect(dragPreviewPosition(session, point(0, Infinity))).toBeUndefined();
    expect(dragFinalPosition(session, point(-Infinity, 0))).toBeUndefined();
    expect(dragPreviewPosition(big, point(1e308, 0))).toBeUndefined(); // 1e308 + 1e308 = Infinity
  });

  it('a prévia e a posição final usam a mesma fórmula: o que se viu é o que se confirma', () => {
    const random = seededRandom(7);
    for (const camera of CAMERAS) {
      const { session } = centered(camera);
      for (let i = 0; i < 40; i++) {
        const t = point((random() - 0.5) * 800, (random() - 0.5) * 800);
        expect(dragFinalPosition(session, t)).toStrictEqual(dragPreviewPosition(session, t));
      }
    }
  });

  it('equivale a `screenToWorld(câmera, dedo − grab offset)` e mantém o vértice a um grab offset do dedo, nas sete câmeras (500 sorteios)', () => {
    const random = seededRandom(99);
    for (let round = 0; round < 500; round++) {
      const camera = CAMERAS[round % CAMERAS.length]!;
      const world = point(Math.round((random() - 0.5) * 600), Math.round((random() - 0.5) * 600));
      const center = worldToScreen(camera, world);
      const grab = point((random() - 0.5) * 40, (random() - 0.5) * 40); // o dedo fora do centro, dentro do alvo de toque
      const touch = point(center.x + grab.x, center.y + grab.y);
      const state = stateOf({ vertices: [[world.x, world.y]] });
      const session = startDrag(state, camera, touch, { width: 100000, height: 100000 });
      if (session === undefined) continue; // o dedo pode cair fora do alvo (escala 0,25: raio 5 dp, alvo mínimo 24 dp)
      const t = point((random() - 0.5) * 500, (random() - 0.5) * 500);
      const fingerNow = point(touch.x + t.x, touch.y + t.y);
      const expected = screenToWorld(camera, point(fingerNow.x - session.grabOffset.x, fingerNow.y - session.grabOffset.y));
      const position = dragPreviewPosition(session, t)!;

      expect(position.x).toBeCloseTo(expected.x, 6);
      expect(position.y).toBeCloseTo(expected.y, 6);
      // na tela: centro = dedo − grab offset, ou seja, o vértice acompanha o dedo sem saltar para ele
      const shown = worldToScreen(camera, position);
      expect(shown.x).toBeCloseTo(fingerNow.x - session.grabOffset.x, 6);
      expect(shown.y).toBeCloseTo(fingerNow.y - session.grabOffset.y, 6);
    }
  });

  it('o vértice não salta para o dedo: com o dedo a (10, −5) do centro, deslocamento nulo mantém o centro e o dedo a (10, −5) dele', () => {
    const session = begin(stateOf(), point(70, 55));
    const position = dragPreviewPosition(session, point(0, 0))!;
    const center = worldToScreen(NEUTRAL_CAMERA, position);

    expect(center).toStrictEqual({ x: 60, y: 60 });
    expect(70 - center.x).toBe(session.grabOffset.x);
    expect(55 - center.y).toBe(session.grabOffset.y);
  });
});

describe('isDragSessionValid: a sessão só vale para o editor em que começou', () => {
  it('vale para o mesmo grafo e o mesmo layout, no modo Selecionar; selecionar algo ou limpar o erro não a invalida', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));
    const selected = applyAction(state, { type: 'select', selection: { type: 'vertex', vertexId: 'v2' } }).state;

    expect(isDragSessionValid(session, state)).toBe(true);
    expect(isDragSessionValid(session, selected)).toBe(true);
  });

  it('deixa de valer ao trocar de modo', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));

    expect(isDragSessionValid(session, applyAction(state, { type: 'set-mode', mode: 'connect' }).state)).toBe(false);
    expect(isDragSessionValid(session, applyAction(state, { type: 'set-mode', mode: 'add-vertex' }).state)).toBe(false);
  });

  it('deixa de valer se o grafo ou o layout foram trocados, mesmo por outros com os MESMOS ids técnicos (outro grafo, mesmo `g`/`v1`)', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));
    const sameIds = stateOf(); // outro objeto, mesmo id do grafo, mesmos ids e posições

    expect(sameIds.graph.id).toBe(state.graph.id);
    expect(isDragSessionValid(session, sameIds)).toBe(false);
    expect(isDragSessionValid(session, { ...state, layout: moveVertex(state.layout, 'v1', point(1, 1)) })).toBe(false);
    expect(isDragSessionValid(session, { ...state, graph: { ...state.graph } })).toBe(false);
  });

  it('deixa de valer ao remover o vértice, desfazer ou refazer', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));
    const selected = applyAction(state, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } }).state;
    const removed = applyAction(selected, { type: 'remove-selection' }).state;
    const moved = applyAction(state, { type: 'move-vertex', vertexId: 'v3', position: point(1, 1) }).state;
    const undone = applyAction(moved, { type: 'undo' }).state;

    expect(isDragSessionValid(session, removed)).toBe(false);
    expect(isDragSessionValid(session, moved)).toBe(false);
    // desfazer volta aos MESMOS objetos do início (o instantâneo os guarda): o editor está de novo exatamente onde a sessão começou
    expect(isDragSessionValid(session, undone)).toBe(true);
    expect(isDragSessionValid(session, applyAction(undone, { type: 'redo' }).state)).toBe(false);
  });
});

describe('finishDrag e dragCommitAction: soltar confirma uma vez; cancelar nunca confirma', () => {
  it('soltar depois de andar (30, −20) devolve UMA ação move-vertex com a posição final calculada à mão: (90, 40)', () => {
    const state = stateOf();
    const session = begin(state, point(70, 55));
    const outcome = finishDrag(session, state, { kind: 'release', translation: point(30, -20) });

    expect(outcome).toStrictEqual({ kind: 'move', action: { type: 'move-vertex', vertexId: 'v1', position: { x: 90, y: 40 } } });
    expect(dragCommitAction(session, state, point(30, -20))).toStrictEqual({
      type: 'move-vertex',
      vertexId: 'v1',
      position: { x: 90, y: 40 },
    });
  });

  it('a ação é do vértice que está sob o dedo, qualquer que seja ele (não o primeiro do grafo): v2 e v3', () => {
    const state = stateOf();
    const v2 = begin(state, point(200, 60));
    const v3 = begin(state, point(130, 200));

    expect(dragCommitAction(v2, state, point(10, 10))).toStrictEqual({ type: 'move-vertex', vertexId: 'v2', position: { x: 210, y: 70 } });
    expect(dragCommitAction(v3, state, point(-10, 5))).toStrictEqual({ type: 'move-vertex', vertexId: 'v3', position: { x: 120, y: 205 } });
    const next = applyAction(state, dragCommitAction(v3, state, point(-10, 5))!).state;
    expect(positionOf(next.layout, 'v3')).toStrictEqual({ x: 120, y: 205 });
    expect(positionOf(next.layout, 'v1')).toBe(positionOf(state.layout, 'v1')); // o primeiro vértice não foi tocado
  });

  it('com zoom e translação (câmera {40, −30, 2}): 30 dp para a direita e 20 dp para cima são (15, −10) unidades', () => {
    const camera = { x: 40, y: -30, scale: 2 };
    const state = stateOf();
    const session = begin(state, point(170, 85), camera);

    expect(dragCommitAction(session, state, point(30, -20))?.position).toStrictEqual({ x: 75, y: 50 });
  });

  it('soltar sem ter andado, ou voltando exatamente ao ponto de partida, não confirma nada (nenhum passo de histórico)', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));

    expect(finishDrag(session, state, { kind: 'release', translation: point(0, 0) })).toStrictEqual({ kind: 'discard', reason: 'unchanged' });
    expect(dragCommitAction(session, state, point(0, -0))).toBeUndefined();
  });

  it('cancelar NUNCA devolve ação, nem com um deslocamento grande já feito', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));

    expect(finishDrag(session, state, { kind: 'cancel' })).toStrictEqual({ kind: 'discard', reason: 'cancelled' });
  });

  it('sessão que não vale mais (modo, grafo, layout ou vértice removido): descarta como "stale", sem ação', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));
    const release = { kind: 'release', translation: point(40, 40) } as const;

    expect(finishDrag(session, applyAction(state, { type: 'set-mode', mode: 'connect' }).state, release)).toStrictEqual({ kind: 'discard', reason: 'stale' });
    expect(finishDrag(session, stateOf(), release)).toStrictEqual({ kind: 'discard', reason: 'stale' });
    expect(dragCommitAction(session, stateOf(), point(40, 40))).toBeUndefined();
  });

  it('deslocamento final inválido: descarta como "invalid"', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));

    expect(finishDrag(session, state, { kind: 'release', translation: point(NaN, 0) })).toStrictEqual({ kind: 'discard', reason: 'invalid' });
  });

  it('aplicar a ação: UM passo de histórico, só o layout muda, os ids e as arestas ficam como estavam', () => {
    const state = stateOf({ edges: [[1, 2], [1, 3]] });
    const session = begin(state, point(70, 55));
    const action = dragCommitAction(session, state, point(30, -20))!;
    const next = applyAction(state, action);

    expect(next.error).toBeUndefined();
    expect(next.state.history.past).toHaveLength(1);
    expect(next.state.history.future).toHaveLength(0);
    expect(positionOf(next.state.layout, 'v1')).toStrictEqual({ x: 90, y: 40 });
    expect(positionOf(next.state.layout, 'v2')).toBe(positionOf(state.layout, 'v2')); // os outros, os mesmos objetos
    expect(positionOf(next.state.layout, 'v3')).toBe(positionOf(state.layout, 'v3'));
    expect(next.state.graph).toBe(state.graph); // grafo intocado: mesmas arestas, origens, destinos, pesos e contadores
    expect(next.state.graph.edges.map((edge) => [edge.id, edge.source, edge.target])).toStrictEqual([
      ['e1', 'v1', 'v2'],
      ['e2', 'v1', 'v3'],
    ]);
  });

  it('desfazer devolve o vértice à posição anterior (o MESMO objeto de layout); refazer restaura a nova; um movimento novo descarta o refazer', () => {
    const state = stateOf();
    const moved = applyAction(state, dragCommitAction(begin(state, point(60, 60)), state, point(30, 0))!).state;
    const undone = applyAction(moved, { type: 'undo' }).state;
    const redone = applyAction(undone, { type: 'redo' }).state;

    expect(undone.layout).toBe(state.layout);
    expect(positionOf(undone.layout, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(positionOf(redone.layout, 'v1')).toStrictEqual({ x: 90, y: 60 });
    expect(redone.history.future).toHaveLength(0);

    const again = begin(undone, point(60, 60));
    const second = applyAction(undone, dragCommitAction(again, undone, point(0, 50))!).state;
    expect(second.history.future).toHaveLength(0); // o ramo "refazer" foi descartado
    expect(second.history.past).toHaveLength(1);
    expect(positionOf(second.layout, 'v1')).toStrictEqual({ x: 60, y: 110 });
  });

  it('os ids são estáveis: o arrasto não gasta nem recicla id de vértice ou de aresta', () => {
    const state = stateOf({ edges: [[1, 2]] });
    const next = applyAction(state, dragCommitAction(begin(state, point(60, 60)), state, point(10, 10))!).state;

    expect(next.graph.nextVertexSeq).toBe(state.graph.nextVertexSeq);
    expect(next.graph.nextEdgeSeq).toBe(state.graph.nextEdgeSeq);
    expect(next.graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
  });

  it('a posição final pode ficar fora da área visível; é válida e desfazer a traz de volta (a câmera não é assunto do arrasto)', () => {
    const state = stateOf();
    const session = begin(state, point(60, 60));
    const action = dragCommitAction(session, state, point(5000, -4000))!;
    const next = applyAction(state, action).state;

    expect(positionOf(next.layout, 'v1')).toStrictEqual({ x: 5060, y: -3940 });
    expect(positionOf(applyAction(next, { type: 'undo' }).state.layout, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('não altera o estado nem a sessão (congelados) e é determinística', () => {
    const state = deepFreeze(stateOf({ edges: [[1, 2]] }));
    const session = begin(state, point(70, 55));
    const a = finishDrag(session, state, { kind: 'release', translation: point(30, -20) });
    const b = finishDrag(session, state, { kind: 'release', translation: point(30, -20) });

    expect(a).toStrictEqual(b);
    expect(session.startWorldPosition).toStrictEqual({ x: 60, y: 60 });
  });
});
