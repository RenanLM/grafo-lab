import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  NEUTRAL_CAMERA,
  buildGraphScene,
  emptyLayout,
  placeVertex,
  positionOf,
  type Camera,
  type EditorMode,
  type GraphScene,
  type Point,
} from './core';
import { createEditorStore, type EditorStore } from './editor-store';
import { createVertexDragController, type DragContext, type VertexDragController } from './vertex-drag-controller';

// Controlador do arrasto (ver vertex-drag-controller.ts), com a store REAL e sem React. O que se garante: o ciclo begin → touchMove → activated → update →
// release/cancel, UMA ação `move-vertex` ao soltar (e nenhuma ao cancelar), NENHUMA notificação da store durante o gesto, e o descarte quando o editor deixa
// de ser o da sessão (modo, outro grafo, desfazer, vértice removido, contexto desabilitado, desmontagem).

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Setup = {
  readonly store: EditorStore;
  readonly controller: VertexDragController;
  readonly dragging: jest.Mock;
  readonly camera: Camera;
  /** Quantas vezes a store avisou os assinantes desde `mount`. */
  readonly storeUpdates: () => number;
  readonly sceneOf: () => GraphScene;
  readonly context: (patch?: Partial<DragContext>) => DragContext;
};

/** v1 (60, 60), v2 (200, 60), v3 (130, 200); arestas v1—v2 (peso 2,5) e v1—v3. Câmera neutra, modo Selecionar. */
function mount({ mode = 'select' as EditorMode, directed = false, camera = NEUTRAL_CAMERA, edges = [[1, 2, 2.5], [1, 3]] as readonly (readonly number[])[] } = {}): Setup {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  for (const [x, y] of [[60, 60], [200, 60], [130, 200]] as const) {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  }
  for (const [source, target, weight] of edges) {
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, weight })).graph;
  }
  const store = createEditorStore({ graph, layout, mode });
  const dragging = jest.fn();
  const sceneOf = (): GraphScene => {
    const { editor } = store.getState();
    return buildGraphScene(editor.graph, editor.layout, camera, { viewport: VIEWPORT })!;
  };
  const context = (patch: Partial<DragContext> = {}): DragContext => ({
    camera,
    viewport: VIEWPORT,
    scene: sceneOf(),
    enabled: true,
    onDraggingChange: dragging,
    ...patch,
  });
  const controller = createVertexDragController(store);
  controller.setContext(context());
  let updates = 0;
  store.subscribe(() => {
    updates++;
  });
  return { store, controller, dragging, camera, storeUpdates: () => updates, sceneOf, context };
}

/** O dedo desce em `at`, anda até `to` e o Gesture Handler ativa o arrasto (o que o detector faria). Devolve se o controlador pediu a ativação. */
function startAndActivate(setup: Setup, at: Point, to: Point): boolean {
  const { handlers } = setup.controller;
  handlers.begin(at);
  const requested = handlers.touchMove(to);
  if (requested) handlers.activated();
  return requested;
}

const positionOfVertex = (store: EditorStore, id: string) => positionOf(store.getState().editor.layout, id);

describe('começo do arrasto', () => {
  it('o dedo desce sobre um vértice: a sessão é armada, e o limiar de 10 dp decide o pedido de ativação', () => {
    const { controller } = mount();
    controller.handlers.begin(point(62, 58));

    expect(controller.handlers.touchMove(point(62 + 9, 58))).toBe(false);
    expect(controller.handlers.touchMove(point(62 + 10, 58))).toBe(true);
    expect(controller.isDragging()).toBe(false); // armado não é arrasto: pode virar toque
  });

  it('o dedo desce no fundo: nada é armado, e nenhum movimento pede a ativação (a página rola)', () => {
    const { controller } = mount();
    controller.handlers.begin(point(320, 280));

    expect(controller.handlers.touchMove(point(320, 100))).toBe(false);
    expect(controller.handlers.touchMove(point(100, 100))).toBe(false);
  });

  it('o dedo desce sobre uma aresta: nada é armado (o ponto médio de v1—v2 fica longe dos dois vértices)', () => {
    const { controller } = mount();
    controller.handlers.begin(point(130, 60));

    expect(controller.handlers.touchMove(point(130, 200))).toBe(false);
  });

  it.each(['add-vertex', 'connect'] as const)('no modo %s o arrasto não começa, mesmo com o dedo sobre um vértice', (mode) => {
    const { controller } = mount({ mode });
    controller.handlers.begin(point(60, 60));

    expect(controller.handlers.touchMove(point(100, 60))).toBe(false);
  });

  it('contexto desabilitado (folha aberta, nenhum grafo), sem câmera ou sem área medida: nada é armado', () => {
    const setup = mount();
    for (const patch of [{ enabled: false }, { camera: undefined }, { viewport: undefined }]) {
      setup.controller.setContext(setup.context(patch));
      setup.controller.handlers.begin(point(60, 60));

      expect(setup.controller.handlers.touchMove(point(100, 60))).toBe(false);
    }
  });

  it('um novo begin substitui a sessão anterior (o dedo desceu em outro lugar)', () => {
    const { controller } = mount();
    controller.handlers.begin(point(60, 60));
    controller.handlers.begin(point(320, 280)); // fundo

    expect(controller.handlers.touchMove(point(100, 60))).toBe(false);
  });

  it('o vértice é identificado UMA vez, no início: arrastar sobre outro vértice continua movendo o mesmo', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(75, 60));
    setup.controller.handlers.update(point(140, 0)); // o dedo passa por cima de v2 (200, 60)? não: (200, 60) é o destino
    setup.controller.handlers.update(point(140, 0));
    const preview = setup.controller.getPreview()!;

    expect(preview.vertex.id).toBe('v1');
    expect(preview.vertex.center).toStrictEqual({ x: 200, y: 60 }); // exatamente sobre v2, e ainda é v1
  });
});

describe('durante o arrasto: só a prévia muda', () => {
  it('a prévia traz o vértice e as arestas dele na posição do dedo; os outros ficam de fora', () => {
    const setup = mount();
    startAndActivate(setup, point(70, 55), point(85, 55));
    setup.controller.handlers.update(point(30, 40));
    const preview = setup.controller.getPreview()!;

    expect(preview.vertex.id).toBe('v1');
    expect(preview.vertex.center).toStrictEqual({ x: 90, y: 100 });
    expect(preview.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2']);
    expect(setup.dragging).toHaveBeenCalledTimes(1);
    expect(setup.dragging).toHaveBeenLastCalledWith(true);
    expect(setup.controller.isDragging()).toBe(true);
  });

  it('o grafo, o layout e o histórico da store ficam EXATAMENTE como estavam, e a store não avisa ninguém, em 200 atualizações', () => {
    const setup = mount();
    const before = setup.store.getState().editor;
    const updatesBefore = setup.storeUpdates();
    startAndActivate(setup, point(60, 60), point(80, 60));
    for (let step = 1; step <= 200; step++) setup.controller.handlers.update(point(step, step / 2));
    const after = setup.store.getState().editor;

    expect(after).toBe(before);
    expect(after.graph).toBe(before.graph);
    expect(after.layout).toBe(before.layout);
    expect(after.history.past).toHaveLength(0);
    expect(setup.storeUpdates()).toBe(updatesBefore);
  });

  it('cada atualização avisa os assinantes da prévia; a referência da prévia só muda quando há atualização', () => {
    const setup = mount();
    const listener = jest.fn();
    setup.controller.subscribe(listener);
    startAndActivate(setup, point(60, 60), point(80, 60));
    expect(listener).not.toHaveBeenCalled();

    setup.controller.handlers.update(point(20, 0));
    const first = setup.controller.getPreview();
    expect(setup.controller.getPreview()).toBe(first);
    setup.controller.handlers.update(point(30, 0));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(setup.controller.getPreview()).not.toBe(first);
  });

  it('cancelar a assinatura da prévia a desliga', () => {
    const setup = mount();
    const listener = jest.fn();
    const unsubscribe = setup.controller.subscribe(listener);
    startAndActivate(setup, point(60, 60), point(80, 60));
    unsubscribe();
    setup.controller.handlers.update(point(20, 0));

    expect(listener).not.toHaveBeenCalled();
  });

  it('atualizar antes de ativar, ou com deslocamento inválido, não cria prévia', () => {
    const setup = mount();
    setup.controller.handlers.begin(point(60, 60));
    setup.controller.handlers.update(point(50, 50)); // ainda não ativou
    expect(setup.controller.getPreview()).toBeUndefined();

    setup.controller.handlers.activated(); // sem pedido de ativação, mas a sessão está armada: ativa
    setup.controller.handlers.update(point(NaN, 0));
    expect(setup.controller.getPreview()).toBeUndefined();
  });

  it('o editor mudou ENTRE descer e ativar (outro modo, ou outro grafo com os mesmos ids): o arrasto não ativa e nada é desenhado', () => {
    const mode = mount();
    mode.controller.handlers.begin(point(60, 60));
    mode.store.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    mode.controller.handlers.activated();
    mode.controller.handlers.update(point(40, 40));

    expect(mode.controller.isDragging()).toBe(false);
    expect(mode.controller.getPreview()).toBeUndefined();
    expect(mode.dragging).not.toHaveBeenCalled();

    const reset = mount();
    reset.controller.handlers.begin(point(60, 60));
    reset.store.getState().reset({ graph: createGraph({ id: 'g' }), mode: 'select' });
    reset.controller.handlers.activated();

    expect(reset.controller.isDragging()).toBe(false);
    expect(reset.dragging).not.toHaveBeenCalled();
  });

  it('ativar sem sessão armada (o dedo caiu no fundo) é ignorado', () => {
    const setup = mount();
    setup.controller.handlers.begin(point(320, 280));
    setup.controller.handlers.activated();

    expect(setup.controller.isDragging()).toBe(false);
    expect(setup.dragging).not.toHaveBeenCalled();
  });

  it('em grafo orientado a prévia mantém a seta apontando para o destino e as direções originais', () => {
    const setup = mount({ directed: true, edges: [[1, 2, 1], [2, 1, 2]] });
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(40, 90));
    const preview = setup.controller.getPreview()!;

    expect(preview.edges.map((edge) => [edge.sourceId, edge.targetId])).toStrictEqual([['v1', 'v2'], ['v2', 'v1']]);
    expect(preview.edges.every((edge) => edge.path.kind === 'quadratic' && edge.arrow !== undefined)).toBe(true);
  });
});

describe('soltar confirma UMA vez', () => {
  it('soltar depois de arrastar: UMA ação move-vertex, um passo de histórico, a prévia some e o vértice fica onde estava a prévia', () => {
    const setup = mount();
    startAndActivate(setup, point(70, 55), point(85, 55));
    setup.controller.handlers.update(point(30, -20));
    const previewCenter = setup.controller.getPreview()!.vertex.center;
    const updatesBefore = setup.storeUpdates();
    setup.controller.handlers.release(point(30, -20));
    setup.controller.handlers.finalize(); // o detector chama finalize logo depois

    const { editor } = setup.store.getState();
    expect(setup.storeUpdates()).toBe(updatesBefore + 1); // exatamente uma atualização da store
    expect(editor.history.past).toHaveLength(1);
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 90, y: 40 });
    expect(previewCenter).toStrictEqual({ x: 90, y: 40 }); // sem salto: a prévia já estava na posição final
    expect(setup.controller.getPreview()).toBeUndefined();
    expect(setup.controller.isDragging()).toBe(false);
    expect(setup.dragging.mock.calls).toStrictEqual([[true], [false]]);
  });

  it('só o layout muda: o grafo é o mesmo objeto, as arestas mantêm origem, destino e peso, e os ids não andam', () => {
    const setup = mount();
    const graph = setup.store.getState().editor.graph;
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(25, 25));
    setup.controller.handlers.release(point(25, 25));
    const after = setup.store.getState().editor;

    expect(after.graph).toBe(graph);
    expect(after.graph.edges.map((edge) => [edge.id, edge.source, edge.target, edge.weight])).toStrictEqual([
      ['e1', 'v1', 'v2', 2.5],
      ['e2', 'v1', 'v3', undefined],
    ]);
    expect(positionOfVertex(setup.store, 'v2')).toStrictEqual({ x: 200, y: 60 }); // os outros não se mexeram
    expect(positionOfVertex(setup.store, 'v3')).toStrictEqual({ x: 130, y: 200 });
  });

  // Visto no emulador: o último movimento do dedo chega junto com o evento de fim (4 dp num deslize de 100 ms). A posição onde o dedo SUBIU é a verdadeira.
  it('a posição confirmada é a do evento de FIM (onde o dedo subiu), mesmo que a última prévia esteja um quadro atrás', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(30, 0));
    setup.controller.handlers.release(point(34, 3));

    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 94, y: 63 });
  });

  it('só se o deslocamento do evento de fim não for finito vale a última prévia', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(30, 0));
    setup.controller.handlers.release(point(NaN, 5));

    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 90, y: 60 });
  });

  it('sem nenhuma atualização, vale o deslocamento do evento de fim', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.release(point(20, 10));

    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 80, y: 70 });
  });

  it('soltar no mesmo lugar (deslocamento nulo) não cria passo de histórico nem avisa a store', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(0, 0));
    const updatesBefore = setup.storeUpdates();
    setup.controller.handlers.release(point(0, 0));

    expect(setup.store.getState().editor.history.past).toHaveLength(0);
    expect(setup.storeUpdates()).toBe(updatesBefore);
    expect(setup.controller.getPreview()).toBeUndefined();
  });

  it('um segundo release (ou finalize) depois do primeiro não duplica a operação', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(40, 0));
    setup.controller.handlers.release(point(40, 0));
    setup.controller.handlers.release(point(40, 0));
    setup.controller.handlers.finalize();
    setup.controller.handlers.cancel();

    expect(setup.store.getState().editor.history.past).toHaveLength(1);
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 100, y: 60 });
  });

  it('soltar fora da área visível é válido: a posição vai para o layout e desfazer a traz de volta', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(900, -700));
    setup.controller.handlers.release(point(900, -700));

    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 960, y: -640 });
    setup.store.getState().dispatch({ type: 'undo' });
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('desfazer e refazer: voltam à posição anterior e à nova; um movimento novo depois de desfazer descarta o refazer', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(50, 0));
    setup.controller.handlers.release(point(50, 0));
    const { dispatch } = setup.store.getState();

    dispatch({ type: 'undo' });
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 60 });
    dispatch({ type: 'redo' });
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 110, y: 60 });
    dispatch({ type: 'undo' });

    setup.controller.setContext(setup.context());
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(0, 40));
    setup.controller.handlers.release(point(0, 40));

    expect(setup.store.getState().editor.history.future).toHaveLength(0);
    expect(setup.store.getState().editor.history.past).toHaveLength(1);
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 100 });
  });

  it('com zoom e translação (câmera {40, −30, 2}): 30 dp = 15 unidades de mundo', () => {
    const camera = { x: 40, y: -30, scale: 2 };
    const setup = mount({ camera }); // v1 aparece em (160, 90)
    startAndActivate(setup, point(170, 85), point(190, 85));
    setup.controller.handlers.update(point(30, -20));
    setup.controller.handlers.release(point(30, -20));

    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 75, y: 50 });
  });
});

describe('cancelar não confirma nada', () => {
  it('cancelar um arrasto ativo: nenhuma ação, nenhum passo, a prévia some e a posição é a original', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(120, 90));
    const before = setup.store.getState().editor;
    const updatesBefore = setup.storeUpdates();
    setup.controller.handlers.cancel();
    setup.controller.handlers.finalize();

    expect(setup.store.getState().editor).toBe(before);
    expect(setup.storeUpdates()).toBe(updatesBefore);
    expect(setup.store.getState().editor.history.past).toHaveLength(0);
    expect(setup.controller.getPreview()).toBeUndefined();
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(setup.dragging.mock.calls).toStrictEqual([[true], [false]]);
  });

  it('um gesto que não chegou a ativar e termina (toque, falha): finalize descarta a sessão sem avisar ninguém', () => {
    const setup = mount();
    setup.controller.handlers.begin(point(60, 60));
    setup.controller.handlers.finalize();

    expect(setup.controller.handlers.touchMove(point(100, 60))).toBe(false); // a sessão sumiu
    expect(setup.dragging).not.toHaveBeenCalled();
    expect(setup.store.getState().editor.history.past).toHaveLength(0);
  });

  it('cancel() externo (troca de grafo, desmontagem) descarta o arrasto ativo sem confirmar', () => {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(40, 40));
    setup.controller.cancel();

    expect(setup.controller.getPreview()).toBeUndefined();
    expect(setup.controller.isDragging()).toBe(false);
    expect(setup.store.getState().editor.history.past).toHaveLength(0);
    // o gesto ainda pode mandar eventos tardios: são ignorados
    setup.controller.handlers.update(point(80, 80));
    setup.controller.handlers.release(point(80, 80));
    expect(setup.store.getState().editor.history.past).toHaveLength(0);
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });
});

describe('o editor deixa de ser o da sessão: o arrasto é descartado na hora', () => {
  function active(): Setup {
    const setup = mount();
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(40, 40));
    return setup;
  }

  function expectDiscarded(setup: Setup): void {
    expect(setup.controller.getPreview()).toBeUndefined();
    expect(setup.controller.isDragging()).toBe(false);
    expect(setup.dragging).toHaveBeenLastCalledWith(false);
    // eventos tardios do gesto não fazem nada
    const history = setup.store.getState().editor.history.past.length;
    setup.controller.handlers.update(point(60, 60));
    setup.controller.handlers.release(point(60, 60));
    expect(setup.controller.getPreview()).toBeUndefined();
    expect(setup.store.getState().editor.history.past).toHaveLength(history);
  }

  it('troca de modo', () => {
    const setup = active();
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });

    expectDiscarded(setup);
    expect(positionOfVertex(setup.store, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('novo grafo ou exemplo (reset), até com o MESMO id de grafo e os mesmos ids técnicos', () => {
    const setup = active();
    setup.store.getState().reset({ graph: createGraph({ id: 'g' }), mode: 'select' });

    expectDiscarded(setup);
  });

  it('o vértice arrastado é removido', () => {
    const setup = active();
    setup.store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
    setup.store.getState().dispatch({ type: 'remove-selection' });

    expectDiscarded(setup);
    expect(positionOfVertex(setup.store, 'v1')).toBeUndefined();
    expect(setup.store.getState().editor.history.past).toHaveLength(1); // só a remoção; o arrasto não deixou nada
  });

  it('desfazer (mudou o layout em que a sessão se baseia)', () => {
    const setup = mount();
    setup.store.getState().dispatch({ type: 'move-vertex', vertexId: 'v3', position: point(150, 210) });
    setup.controller.setContext(setup.context());
    startAndActivate(setup, point(60, 60), point(80, 60));
    setup.controller.handlers.update(point(40, 40));
    setup.store.getState().dispatch({ type: 'undo' });

    expectDiscarded(setup);
  });

  it('selecionar outro elemento NÃO descarta o arrasto (a seleção não é parte da sessão)', () => {
    const setup = active();
    setup.store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v2' } });

    expect(setup.controller.isDragging()).toBe(true);
    expect(setup.controller.getPreview()).toBeDefined();
  });

  it('contexto desabilitado (a folha de propriedades abriu)', () => {
    const setup = active();
    setup.controller.setContext(setup.context({ enabled: false }));

    expectDiscarded(setup);
  });

  it('depois de descartado, a store não é mais observada (um novo set-mode não chama onDraggingChange outra vez)', () => {
    const setup = active();
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    const calls = setup.dragging.mock.calls.length;
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'select' });
    setup.store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });

    expect(setup.dragging).toHaveBeenCalledTimes(calls);
  });

  it('a nossa própria confirmação não se descarta no meio: uma ação, e a prévia só some depois do despacho', () => {
    const setup = active();
    const order: string[] = [];
    setup.store.subscribe(() => order.push(`store:${setup.controller.getPreview() === undefined ? 'sem-prévia' : 'com-prévia'}`));
    setup.controller.subscribe(() => order.push('prévia'));
    setup.controller.handlers.release(point(40, 40));

    expect(order).toStrictEqual(['store:com-prévia', 'prévia']); // despacha primeiro (a prévia ainda existe), limpa depois
    expect(setup.store.getState().editor.history.past).toHaveLength(1);
  });
});
