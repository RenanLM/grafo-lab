import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import { createCameraGestureController } from './camera-gesture-controller';
import { createCameraStore, type CameraStore } from './camera-store';
import { createCanvasGestureController, type CanvasGestureContext, type CanvasGestureController } from './canvas-gesture-controller';
import {
  NEUTRAL_CAMERA,
  emptyLayout,
  panFromAnchor,
  placeVertex,
  positionOf,
  worldToScreen,
  type Camera,
  type EditorMode,
  type Point,
} from './core';
import { createEditorStore, type EditorStore } from './editor-store';
import { createVertexDragController, type VertexDragController } from './vertex-drag-controller';

// Orquestrador dos gestos do canvas (ver canvas-gesture-controller.ts), com as stores REAIS e sem React: de quem é um deslize de um dedo (vértice, câmera ou ninguém), que dois gestos
// nunca alterem o mesmo estado, o segundo dedo e o que cada evento atrasado NÃO pode fazer. Os eventos são os números que o detector entregaria.

const VIEWPORT = { width: 360, height: 324 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Setup = {
  readonly store: EditorStore;
  readonly cameraStore: CameraStore;
  readonly drag: VertexDragController;
  readonly gestures: CanvasGestureController;
  readonly editorUpdates: () => number;
  readonly cameraUpdates: () => number;
  readonly context: (patch?: Partial<CanvasGestureContext>) => CanvasGestureContext;
};

/** v1 (60, 60), v2 (200, 60), v3 (130, 200); arestas v1—v2 e v1—v3 (o meio de v1—v2 fica longe dos dois). Câmera dada, modo dado, canvas de 360 × 324. */
function mount({ mode = 'select' as EditorMode, camera = NEUTRAL_CAMERA as Camera } = {}): Setup {
  let graph = createGraph({ id: 'g' });
  let layout = emptyLayout('g');
  for (const [x, y] of [[60, 60], [200, 60], [130, 200]] as const) {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  }
  for (const target of [2, 3]) graph = must(addEdge(graph, { source: 'v1', target: `v${target}` })).graph;
  const store = createEditorStore({ graph, layout, mode });
  const cameraStore = createCameraStore(camera);
  const drag = createVertexDragController(store);
  const gestures = createCanvasGestureController({ store, cameraStore, drag, camera: createCameraGestureController(cameraStore) });
  const context = (patch: Partial<CanvasGestureContext> = {}): CanvasGestureContext => ({ viewport: VIEWPORT, enabled: true, ...patch });
  drag.setContext({ viewport: VIEWPORT, enabled: true });
  gestures.setContext(context());
  let editorCount = 0;
  let cameraCount = 0;
  store.subscribe(() => {
    editorCount++;
  });
  cameraStore.subscribe(() => {
    cameraCount++;
  });
  return { store, cameraStore, drag, gestures, editorUpdates: () => editorCount, cameraUpdates: () => cameraCount, context };
}

/** O dedo desce em `at`, anda até `to` (≥ 10 dp) e o Gesture Handler ativa o pan, com o deslocamento desde que desceu. Devolve se o pan pediu a ativação. */
function startPan(setup: Setup, at: Point, to: Point): boolean {
  setup.gestures.pan.begin(at);
  const requested = setup.gestures.pan.touchMove(to);
  if (requested) setup.gestures.pan.activated(point(to.x - at.x, to.y - at.y));
  return requested;
}

const moveBy = (setup: Setup, at: Point, to: Point, dx: number, dy: number): void => {
  setup.gestures.pan.update(point(to.x - at.x + dx, to.y - at.y + dy));
};

const history = (setup: Setup) => setup.store.getState().editor.history.past.length;
const position = (setup: Setup, id: string) => positionOf(setup.store.getState().editor.layout, id);

describe('o dono do deslize é decidido UMA vez, ao descer o dedo', () => {
  it('sobre um vértice, em Selecionar: o dono é o arrasto do vértice (a câmera não se mexe)', () => {
    const setup = mount();
    const camera = setup.cameraStore.get();

    expect(startPan(setup, point(60, 60), point(80, 60))).toBe(true);
    moveBy(setup, point(60, 60), point(80, 60), 30, 20);

    expect(setup.drag.isDragging()).toBe(true);
    expect(setup.drag.getPreview()?.vertex.id).toBe('v1');
    expect(setup.cameraStore.get()).toBe(camera);
    expect(setup.cameraUpdates()).toBe(0);
  });

  it('sobre o fundo: o dono é a câmera (o grafo, o layout e o histórico não mudam, e nenhuma prévia de vértice existe)', () => {
    const setup = mount();
    const editor = setup.store.getState().editor;

    expect(startPan(setup, point(320, 280), point(340, 280))).toBe(true);
    moveBy(setup, point(320, 280), point(340, 280), 30, -20);

    expect(setup.drag.isDragging()).toBe(false);
    expect(setup.drag.getPreview()).toBeUndefined();
    expect(setup.store.getState().editor).toBe(editor);
    expect(setup.editorUpdates()).toBe(0);
    // o deslocamento agora é (20 + 30, 0 − 20) = (50, −20); a origem do pan é o deslocamento da ativação, (20, 0), então a câmera anda (30, −20) e o quadro não saltou no reconhecimento
    expect(setup.cameraStore.get()).toStrictEqual({ x: 30, y: -20, scale: 1 });
  });

  it('o grafo se move junto: a posição de TELA de cada vértice anda o deslocamento do dedo, e a posição no MUNDO não muda', () => {
    const setup = mount();
    const before = ['v1', 'v2', 'v3'].map((id) => worldToScreen(setup.cameraStore.get(), position(setup, id)!));
    startPan(setup, point(320, 280), point(340, 280));
    moveBy(setup, point(320, 280), point(340, 280), 25, 40);
    const after = ['v1', 'v2', 'v3'].map((id) => worldToScreen(setup.cameraStore.get(), position(setup, id)!));

    after.forEach((screen, i) => {
      expect(screen.x - before[i]!.x).toBeCloseTo(25, 9);
      expect(screen.y - before[i]!.y).toBeCloseTo(40, 9);
    });
    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('o pan da câmera nunca cria histórico, nem ao soltar', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    moveBy(setup, point(320, 280), point(340, 280), 60, 60);
    setup.gestures.pan.release(point(80, 60));
    setup.gestures.pan.finalize();

    expect(history(setup)).toBe(0);
    expect(setup.editorUpdates()).toBe(0);
  });

  it('em Adicionar vértice e Conectar o fundo também move a câmera (o pan não depende do modo)', () => {
    for (const mode of ['add-vertex', 'connect'] as const) {
      const setup = mount({ mode });

      expect(startPan(setup, point(320, 280), point(340, 280))).toBe(true);
      moveBy(setup, point(320, 280), point(340, 280), 10, 10);
      expect(setup.cameraStore.get()).not.toBe(NEUTRAL_CAMERA);
    }
  });

  it('sobre um vértice em Adicionar vértice ou Conectar: ninguém — o pan nunca pede ativação e a rolagem fica livre', () => {
    for (const mode of ['add-vertex', 'connect'] as const) {
      const setup = mount({ mode });

      expect(startPan(setup, point(60, 60), point(100, 60))).toBe(false);
      expect(setup.cameraUpdates()).toBe(0);
      expect(setup.drag.isDragging()).toBe(false);
    }
  });

  it('sobre uma aresta, em qualquer modo: ninguém', () => {
    for (const mode of ['select', 'add-vertex', 'connect'] as const) {
      const setup = mount({ mode });

      expect(startPan(setup, point(130, 60), point(130, 120))).toBe(false);
      expect(setup.cameraUpdates()).toBe(0);
    }
  });

  it('um toque fora do canvas, ou sem área medida, ou com o canvas desabilitado (folha aberta): ninguém', () => {
    const outside = mount();
    expect(startPan(outside, point(-5, 60), point(40, 60))).toBe(false);

    const unmeasured = mount();
    unmeasured.gestures.setContext({ viewport: undefined, enabled: true });
    expect(startPan(unmeasured, point(320, 280), point(340, 280))).toBe(false);

    const sheet = mount();
    sheet.drag.setContext({ viewport: VIEWPORT, enabled: false });
    sheet.gestures.setContext(sheet.context({ enabled: false }));
    expect(startPan(sheet, point(320, 280), point(340, 280))).toBe(false);
    expect(startPan(sheet, point(60, 60), point(100, 60))).toBe(false);
  });

  it('abaixo do limiar de 10 dp nada é pedido (é um toque)', () => {
    const setup = mount();

    expect(startPan(setup, point(320, 280), point(326, 285))).toBe(false);
    expect(setup.cameraUpdates()).toBe(0);
  });

  it('o dono é o do começo e não muda: um deslize de câmera que passa por cima de um vértice continua movendo a câmera, e nenhum vértice é arrastado', () => {
    const setup = mount();
    startPan(setup, point(100, 120), point(100, 90)); // fundo
    setup.gestures.pan.update(point(0, -60)); // o dedo chega a (100, 60), sobre o vértice v1 (60, 60)? não: está entre v1 e v2; continua câmera
    setup.gestures.pan.update(point(-40, -60)); // agora em (60, 60): exatamente sobre v1

    expect(setup.drag.isDragging()).toBe(false);
    expect(setup.drag.getPreview()).toBeUndefined();
    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('e o inverso: um arrasto de vértice que sai por cima do fundo continua sendo arrasto de vértice, e a câmera não se mexe', () => {
    const setup = mount();
    startPan(setup, point(60, 60), point(80, 60));
    setup.gestures.pan.update(point(240, 200)); // longe, sobre o fundo
    setup.gestures.pan.release(point(240, 200));

    expect(setup.cameraUpdates()).toBe(0);
    expect(position(setup, 'v1')).toStrictEqual({ x: 300, y: 260 });
    expect(history(setup)).toBe(1);
  });

  it('usa a câmera VIVA do começo do gesto: depois de mover a câmera, o mesmo ponto de tela deixa de ser vértice', () => {
    const setup = mount();
    setup.cameraStore.command({ x: 120, y: 0, scale: 1 }); // v1 passa a aparecer em (180, 60)

    expect(startPan(setup, point(60, 60), point(60, 100))).toBe(true); // (60, 60) agora é fundo: câmera
    expect(setup.drag.isDragging()).toBe(false);
    setup.gestures.pan.finalize();
    expect(startPan(setup, point(180, 60), point(220, 60))).toBe(true); // (180, 60) é o vértice v1
    expect(setup.drag.isDragging()).toBe(true);
  });
});

describe('arrasto de vértice e câmera: cancelamento e fim de cada um', () => {
  it('arrasto de vértice cancelado: a posição não é gravada, nenhum passo, e a câmera fica como estava', () => {
    const setup = mount();
    startPan(setup, point(60, 60), point(80, 60));
    moveBy(setup, point(60, 60), point(80, 60), 90, 40);
    setup.gestures.pan.cancel();
    setup.gestures.pan.finalize();

    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(history(setup)).toBe(0);
    expect(setup.drag.getPreview()).toBeUndefined();
    expect(setup.cameraUpdates()).toBe(0);
  });

  it('pan de câmera cancelado: PRESERVA a última câmera (não restaura) e a assenta', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    moveBy(setup, point(320, 280), point(340, 280), 30, 10);
    const moved = setup.cameraStore.get();
    setup.gestures.pan.cancel();
    setup.gestures.pan.finalize();

    expect(setup.cameraStore.get()).toBe(moved);
    expect(setup.cameraStore.getSettled()).toBe(moved);
    expect(moved).not.toBe(NEUTRAL_CAMERA);
  });

  it('soltar o pan da câmera assenta a câmera, e eventos tardios do mesmo gesto não a movem mais', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    setup.gestures.pan.release(point(50, 5));
    setup.gestures.pan.finalize();
    const settled = setup.cameraStore.getSettled();
    setup.gestures.pan.update(point(500, 500));
    setup.gestures.pan.release(point(900, 900));

    expect(setup.cameraStore.get()).toBe(settled);
    expect(settled).toStrictEqual(panFromAnchor(NEUTRAL_CAMERA, point(30, 5)));
  });
});

describe('um segundo dedo: a pinça tem a vez e nenhum movimento é confirmado por acidente', () => {
  it('com o arrasto de vértice ativo, a pinça o RESTAURA sem gravar: a prévia some, a posição e o histórico ficam como estavam, e a câmera é a da pinça', () => {
    const setup = mount();
    startPan(setup, point(60, 60), point(80, 60));
    moveBy(setup, point(60, 60), point(80, 60), 50, 30);
    expect(setup.drag.isDragging()).toBe(true);

    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.gestures.pinch.update(point(180, 160), 2);

    expect(setup.drag.isDragging()).toBe(false);
    expect(setup.drag.getPreview()).toBeUndefined();
    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(history(setup)).toBe(0);
    expect(setup.cameraStore.get().scale).toBe(2);
  });

  it('o fim tardio do arrasto de vértice, depois da pinça, NÃO grava a posição (o segundo dedo nunca confirma)', () => {
    const setup = mount();
    startPan(setup, point(60, 60), point(80, 60));
    moveBy(setup, point(60, 60), point(80, 60), 50, 30);
    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.gestures.pan.release(point(70, 50)); // o evento de fim do pan chega atrasado
    setup.gestures.pan.finalize();

    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(history(setup)).toBe(0);
  });

  it('quando o módulo nativo cancela o pan (maxPointers 1) e depois a pinça ativa, o vértice volta e a pinça zoom normalmente', () => {
    const setup = mount();
    startPan(setup, point(60, 60), point(80, 60));
    moveBy(setup, point(60, 60), point(80, 60), 50, 30);
    setup.gestures.pan.cancel(); // 1º: o pan é cancelado pelo segundo dedo
    setup.gestures.pan.finalize();
    setup.gestures.pinch.activated(point(180, 160), 1); // 2º: a pinça ativa
    setup.gestures.pinch.update(point(180, 160), 1.5);
    setup.gestures.pinch.end();
    setup.gestures.pinch.finalize();

    expect(position(setup, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(history(setup)).toBe(0);
    expect(setup.cameraStore.get().scale).toBe(1.5);
    expect(setup.cameraStore.getSettled()).toBe(setup.cameraStore.get());
  });

  it('com o pan da câmera ativo, a pinça assenta a câmera do pan e continua dali, sem salto', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    moveBy(setup, point(320, 280), point(340, 280), 30, 10);
    const panned = setup.cameraStore.get();
    setup.gestures.pinch.activated(point(180, 160), 1);

    expect(setup.cameraStore.getSettled()).toBe(panned);
    setup.gestures.pinch.update(point(180, 160), 1);
    expect(setup.cameraStore.get()).toBe(panned);
  });

  it('a pinça funciona sobre qualquer coisa, em qualquer modo (vértice, aresta, fundo): o foco decide, não o que há sob os dedos', () => {
    for (const mode of ['select', 'add-vertex', 'connect'] as const) {
      const setup = mount({ mode });
      setup.gestures.pinch.activated(point(60, 60), 1); // foco sobre o vértice v1
      setup.gestures.pinch.update(point(60, 60), 2);

      expect(setup.cameraStore.get().scale).toBe(2);
      expect(setup.store.getState().editor.history.past).toHaveLength(0);
      expect(setup.store.getState().editor.selection).toStrictEqual({ type: 'none' });
    }
  });

  it('a pinça não cria vértice, aresta, seleção nem histórico: o editor continua o mesmo objeto', () => {
    const setup = mount();
    const editor = setup.store.getState().editor;
    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.gestures.pinch.update(point(190, 150), 2.5);
    setup.gestures.pinch.end();
    setup.gestures.pinch.finalize();

    expect(setup.store.getState().editor).toBe(editor);
    expect(setup.editorUpdates()).toBe(0);
  });

  it('com o canvas desabilitado (folha aberta) a pinça não faz nada', () => {
    const setup = mount();
    setup.drag.setContext({ viewport: VIEWPORT, enabled: false });
    setup.gestures.setContext(setup.context({ enabled: false }));
    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.gestures.pinch.update(point(180, 160), 3);

    expect(setup.cameraStore.get()).toBe(NEUTRAL_CAMERA);
  });
});

describe('sessões de outra vida: reset, modo, contexto e desmontagem', () => {
  it('um reset da câmera (outro grafo ou exemplo) durante o pan da câmera: os eventos atrasados não movem a câmera nova', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    setup.cameraStore.reset(NEUTRAL_CAMERA);
    moveBy(setup, point(320, 280), point(340, 280), 90, 90);
    setup.gestures.pan.release(point(150, 150));

    expect(setup.cameraStore.get()).toBe(NEUTRAL_CAMERA);
  });

  it('um reset durante a pinça: as atualizações atrasadas não movem a câmera nova', () => {
    const setup = mount();
    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.cameraStore.reset(NEUTRAL_CAMERA);
    setup.gestures.pinch.update(point(180, 160), 3);

    expect(setup.cameraStore.get()).toBe(NEUTRAL_CAMERA);
  });

  it('trocar de modo durante o pan da câmera encerra o gesto (a câmera fica como está) e os eventos seguintes não a movem', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    moveBy(setup, point(320, 280), point(340, 280), 20, 0);
    const moved = setup.cameraStore.get();
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });
    moveBy(setup, point(320, 280), point(340, 280), 200, 200);

    expect(setup.cameraStore.get()).toBe(moved);
    expect(setup.cameraStore.getSettled()).toBe(moved);
  });

  it('trocar de modo durante a pinça também a encerra', () => {
    const setup = mount();
    setup.gestures.pinch.activated(point(180, 160), 1);
    setup.gestures.pinch.update(point(180, 160), 1.5);
    const moved = setup.cameraStore.get();
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    setup.gestures.pinch.update(point(180, 160), 3);

    expect(setup.cameraStore.get()).toBe(moved);
  });

  it('desabilitar o canvas (a folha abriu) durante o gesto: o arrasto de vértice é descartado e o pan da câmera encerrado', () => {
    const drag = mount();
    startPan(drag, point(60, 60), point(80, 60));
    drag.drag.setContext({ viewport: VIEWPORT, enabled: false });
    drag.gestures.setContext(drag.context({ enabled: false }));
    expect(drag.drag.isDragging()).toBe(false);

    const camera = mount();
    startPan(camera, point(320, 280), point(340, 280));
    moveBy(camera, point(320, 280), point(340, 280), 20, 0);
    const moved = camera.cameraStore.get();
    expect(moved).not.toBe(NEUTRAL_CAMERA);
    expect(camera.cameraStore.getSettled()).toBe(NEUTRAL_CAMERA); // em andamento: ainda não assentada
    camera.gestures.setContext(camera.context({ enabled: false }));
    moveBy(camera, point(320, 280), point(340, 280), 99, 99);
    expect(camera.cameraStore.get()).toBe(moved); // os eventos seguintes não a movem
    expect(camera.cameraStore.getSettled()).toBe(moved); // e a câmera como estava foi assentada
  });

  it('cancel() (outro grafo, desmontagem) restaura o arrasto de vértice sem gravar e assenta a câmera como está', () => {
    const vertex = mount();
    startPan(vertex, point(60, 60), point(80, 60));
    moveBy(vertex, point(60, 60), point(80, 60), 40, 40);
    vertex.gestures.cancel();
    expect(vertex.drag.isDragging()).toBe(false);
    expect(position(vertex, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(history(vertex)).toBe(0);

    const camera = mount();
    startPan(camera, point(320, 280), point(340, 280));
    moveBy(camera, point(320, 280), point(340, 280), 40, 0);
    const moved = camera.cameraStore.get();
    camera.gestures.cancel();
    expect(camera.cameraStore.getSettled()).toBe(moved);
  });

  it('depois de dispose() a troca de modo não encerra mais nada (a observação da store acabou)', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    setup.gestures.dispose();
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });
    moveBy(setup, point(320, 280), point(340, 280), 20, 0);

    expect(setup.cameraStore.get()).not.toBe(NEUTRAL_CAMERA);
  });

  it('um gesto novo descarta a sessão anterior: o segundo begin não herda nada do primeiro', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    setup.gestures.pan.begin(point(60, 60)); // o dedo desceu de novo, agora sobre um vértice
    setup.gestures.pan.touchMove(point(90, 60));
    setup.gestures.pan.activated(point(30, 0));

    expect(setup.drag.isDragging()).toBe(true);
    expect(setup.cameraStore.getSettled()).toBe(setup.cameraStore.get()); // o pan anterior foi assentado
  });

  it('finalize é idempotente e não gera efeito depois do fim', () => {
    const setup = mount();
    startPan(setup, point(320, 280), point(340, 280));
    setup.gestures.pan.release(point(30, 0));
    setup.gestures.pan.finalize();
    setup.gestures.pan.finalize();
    setup.gestures.pinch.finalize();
    const cameraCalls = setup.cameraUpdates();
    setup.gestures.pan.update(point(500, 500));

    expect(setup.cameraUpdates()).toBe(cameraCalls);
  });
});
