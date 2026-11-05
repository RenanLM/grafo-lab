import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  NEUTRAL_CAMERA,
  createEditorState,
  emptyLayout,
  fingerMoved,
  gestureOwnerAt,
  hitTest,
  placeVertex,
  removePosition,
  startDrag,
  type Camera,
  type EditorMode,
  type EditorState,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Dono do deslize de um dedo (ver gesture-start.ts): vértice em Selecionar arrasta o vértice, fundo move a câmera, o resto não inicia pan. O hit-testing não é refeito aqui: o
// `hitTest` do 3.3 é o oráculo, e `startDrag` (3.9) é a referência para a sessão do vértice.

const VIEWPORT = { width: 360, height: 324 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

function stateOf({ mode = 'select' as EditorMode, vertices = [[60, 60], [200, 60], [130, 200]] as readonly (readonly [number, number])[], edges = [] as readonly (readonly [number, number])[] } = {}): EditorState {
  let graph = createGraph({ id: 'g' });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  for (const [source, target] of edges) graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}` })).graph;
  return createEditorState({ graph, layout, mode });
}

const owner = (state: EditorState, at: Point, camera: Camera = NEUTRAL_CAMERA) => gestureOwnerAt(state, camera, at, VIEWPORT);

describe('gestureOwnerAt: a política dos deslizes de um dedo', () => {
  it('vértice no modo Selecionar: o dono é o vértice, com a mesma sessão que `startDrag` daria', () => {
    const state = stateOf();
    const result = owner(state, point(70, 55));

    expect(result.kind).toBe('vertex');
    expect(result).toStrictEqual({ kind: 'vertex', session: startDrag(state, NEUTRAL_CAMERA, point(70, 55), VIEWPORT) });
  });

  it('fundo: o dono é a câmera, em qualquer modo (Selecionar, Adicionar vértice e Conectar)', () => {
    for (const mode of ['select', 'add-vertex', 'connect'] as const) {
      expect(owner(stateOf({ mode }), point(320, 280))).toStrictEqual({ kind: 'camera' });
    }
  });

  it('grafo vazio: tudo é fundo, então o dono é a câmera', () => {
    expect(owner(stateOf({ vertices: [] }), point(100, 100))).toStrictEqual({ kind: 'camera' });
  });

  it('vértice nos outros modos (Adicionar vértice, Conectar): ninguém — não inicia pan', () => {
    expect(owner(stateOf({ mode: 'add-vertex' }), point(60, 60))).toStrictEqual({ kind: 'none' });
    expect(owner(stateOf({ mode: 'connect' }), point(60, 60))).toStrictEqual({ kind: 'none' });
  });

  it('aresta: ninguém, em qualquer modo (o ponto médio de v1—v2 fica longe dos dois vértices)', () => {
    for (const mode of ['select', 'add-vertex', 'connect'] as const) {
      const state = stateOf({ mode, edges: [[1, 2]] });

      expect(hitTest(state.graph, state.layout, NEUTRAL_CAMERA, point(130, 60))).toMatchObject({ type: 'edge' });
      expect(owner(state, point(130, 60))).toStrictEqual({ kind: 'none' });
    }
  });

  it('vértice sobre aresta: vence o vértice (prioridade do hit-test), e então depende do modo', () => {
    const state = stateOf({ vertices: [[60, 60], [200, 60], [130, 60]], edges: [[1, 2]] });

    expect(owner(state, point(130, 60)).kind).toBe('vertex');
    expect(owner({ ...state, mode: 'connect' }, point(130, 60)).kind).toBe('none');
  });

  it('o alvo do vértice é o de 48 dp do toque: a 23 dp do centro arrasta o vértice, a 25 dp já é fundo (câmera)', () => {
    const state = stateOf();

    expect(owner(state, point(60 + 23, 60)).kind).toBe('vertex');
    expect(owner(state, point(60 + 25, 60))).toStrictEqual({ kind: 'camera' });
  });

  it('toque inválido (fora do canvas, não finito, câmera ou área inválidas): ninguém, nunca a câmera', () => {
    const state = stateOf();

    expect(owner(state, point(-1, 60))).toStrictEqual({ kind: 'none' });
    expect(owner(state, point(361, 60))).toStrictEqual({ kind: 'none' });
    expect(owner(state, point(60, 325))).toStrictEqual({ kind: 'none' });
    expect(owner(state, point(NaN, 60))).toStrictEqual({ kind: 'none' });
    expect(owner(state, point(60, 60), { x: 0, y: 0, scale: 0 })).toStrictEqual({ kind: 'none' });
    expect(owner(state, point(60, 60), { x: NaN, y: 0, scale: 1 })).toStrictEqual({ kind: 'none' });
    expect(gestureOwnerAt(state, NEUTRAL_CAMERA, point(60, 60), { width: 0, height: 324 })).toStrictEqual({ kind: 'none' });
  });

  it('os limites do canvas contam como dentro', () => {
    const state = stateOf({ vertices: [] });

    expect(owner(state, point(0, 0))).toStrictEqual({ kind: 'camera' });
    expect(owner(state, point(360, 324))).toStrictEqual({ kind: 'camera' });
  });

  it('layout de outro grafo, ou vértice sem posição: ninguém (nada a arrastar e nada seguro a mover)', () => {
    const state = stateOf();

    expect(owner({ ...state, layout: emptyLayout('outro') }, point(60, 60))).toStrictEqual({ kind: 'none' });
    // sem posição o vértice não é acertado e o ponto vira fundo: câmera
    expect(owner({ ...state, layout: removePosition(state.layout, 'v1') }, point(60, 60))).toStrictEqual({ kind: 'camera' });
  });

  it('usa a câmera do começo do gesto: o mesmo ponto de tela é vértice ou fundo conforme o zoom e o deslocamento', () => {
    const state = stateOf();
    const zoomed = { x: 40, y: -30, scale: 2 }; // v1 aparece em (160, 90)

    expect(owner(state, point(160, 90), zoomed).kind).toBe('vertex');
    expect(owner(state, point(60, 60), zoomed)).toStrictEqual({ kind: 'camera' });
    expect(owner(state, point(60, 60)).kind).toBe('vertex');
  });

  it('as opções de hit-testing chegam ao hit-test: com raio 5 e alvo mínimo de 20 dp, a 15 dp do centro já é fundo', () => {
    const state = stateOf();

    expect(gestureOwnerAt(state, NEUTRAL_CAMERA, point(75, 60), VIEWPORT).kind).toBe('vertex');
    expect(gestureOwnerAt(state, NEUTRAL_CAMERA, point(75, 60), VIEWPORT, { vertexRadius: 5, minTouchDiameter: 20 })).toStrictEqual({ kind: 'camera' });
  });

  it('não altera o estado (congelado) e é determinística', () => {
    const state = deepFreeze(stateOf({ edges: [[1, 2]] }));
    const camera = deepFreeze({ x: 40, y: -30, scale: 2 });

    expect(gestureOwnerAt(state, camera, point(160, 90), VIEWPORT)).toStrictEqual(gestureOwnerAt(state, camera, point(160, 90), VIEWPORT));
  });

  it('500 sorteios com semente fixa: o dono é sempre o que o hitTest (oráculo) e o modo mandam', () => {
    const random = seededRandom(310);
    const between = (min: number, max: number) => min + random() * (max - min);
    const cameras: Camera[] = [NEUTRAL_CAMERA, { x: 40, y: -30, scale: 2 }, { x: -120, y: 75, scale: 0.25 }, { x: 200, y: -50, scale: 4 }];
    for (let round = 0; round < 500; round++) {
      const count = 2 + Math.floor(random() * 6);
      const vertices = Array.from({ length: count }, () => [between(-100, 450), between(-100, 450)] as const);
      const edges: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const a = 1 + Math.floor(random() * count);
        const b = 1 + Math.floor(random() * count);
        if (a !== b && !edges.some(([c, d]) => (c === a && d === b) || (c === b && d === a))) edges.push([a, b]);
      }
      const mode = (['select', 'add-vertex', 'connect'] as const)[round % 3]!;
      const state = stateOf({ mode, vertices, edges });
      const camera = cameras[round % cameras.length]!;
      const touch = point(between(-5, 365), between(-5, 330));
      const inside = touch.x >= 0 && touch.y >= 0 && touch.x <= VIEWPORT.width && touch.y <= VIEWPORT.height;
      const hit = inside ? hitTest(state.graph, state.layout, camera, touch) : undefined;
      const got = gestureOwnerAt(state, camera, touch, VIEWPORT);

      if (hit === undefined) expect(got.kind).toBe('none');
      else if (hit.type === 'background') expect(got.kind).toBe('camera');
      else if (hit.type === 'edge') expect(got.kind).toBe('none');
      else if (mode === 'select') {
        expect(got.kind).toBe('vertex');
        expect(got.kind === 'vertex' && got.session.vertexId).toBe(hit.vertexId);
      } else expect(got.kind).toBe('none');
    }
  });
});

describe('fingerMoved: o limiar do pan (de vértice ou de câmera) é o do toque', () => {
  it('a distância euclidiana desde onde o dedo desceu, ≥ 10 dp: 9,99 não e 10 sim (eixos e diagonal 6–8–10)', () => {
    const start = point(60, 60);

    expect(fingerMoved(start, point(60 + 9.99, 60))).toBe(false);
    expect(fingerMoved(start, point(60 + 10, 60))).toBe(true);
    expect(fingerMoved(start, point(60, 60 - 10))).toBe(true);
    expect(fingerMoved(start, point(60 - 6, 60 + 8))).toBe(true);
    expect(fingerMoved(start, point(60 + 7, 60 + 7))).toBe(false);
  });

  it('um limiar próprio vale; um limiar inválido volta ao padrão; ponto não finito não ativa', () => {
    const start = point(0, 0);

    expect(fingerMoved(start, point(5, 0), 5)).toBe(true);
    for (const threshold of [0, -1, NaN, Infinity]) {
      expect(fingerMoved(start, point(5, 0), threshold)).toBe(false);
      expect(fingerMoved(start, point(10, 0), threshold)).toBe(true);
    }
    expect(fingerMoved(start, point(NaN, 0))).toBe(false);
    expect(fingerMoved(point(NaN, 0), point(50, 0))).toBe(false);
  });
});
