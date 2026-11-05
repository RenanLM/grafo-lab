import { addVertex, createGraph, type Graph } from '@/domain/graph';

import {
  applyAction,
  circularLayout,
  createEditorState,
  positionOf,
  type EditorAction,
  type EditorState,
} from './core';
import {
  createEditorStore,
  selectCanRedo,
  selectCanUndo,
  selectEditor,
  selectError,
  selectGraph,
  selectLayout,
  selectMode,
  selectSelection,
  type EditorStore,
  type EditorStoreState,
} from './editor-store';

// Store do editor (ver editor-store.ts): guarda o estado e avisa quem observa; as regras são do núcleo puro. Testada sem
// renderizar componente.

declare const __dirname: string; // o Jest (CommonJS) fornece; evita depender dos tipos do Node
const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');

const point = (x: number, y: number) => ({ x, y });
const newStore = (directed = false): EditorStore => createEditorStore({ graph: createGraph({ id: 'g', directed }) });
const editor = (store: EditorStore): EditorState => store.getState().editor;
const vertexIds = (store: EditorStore): string[] => editor(store).graph.vertices.map((vertex) => vertex.id);
const vertexLabels = (store: EditorStore): string[] => editor(store).graph.vertices.map((vertex) => vertex.label);

const dispatch = (store: EditorStore, ...actions: EditorAction[]): void => {
  for (const action of actions) store.getState().dispatch(action);
};

/** Quantas vezes os assinantes foram avisados enquanto `act` roda. */
function notifications(store: EditorStore, act: () => void): number {
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  act();
  unsubscribe();
  return listener.mock.calls.length;
}

describe('estado inicial', () => {
  it('é o estado inicial do núcleo para as opções dadas, com as ações expostas', () => {
    const graph = createGraph({ id: 'g' });
    const store = createEditorStore({ graph, historyLimit: 7, mode: 'connect' });
    const state = store.getState();

    expect(state.editor).toStrictEqual(createEditorState({ graph, historyLimit: 7, mode: 'connect' }));
    expect(state.editor.graph).toBe(graph);
    expect(state.editor.history.limit).toBe(7);
    expect(state.editor.mode).toBe('connect');
    expect(state.editor.selection).toStrictEqual({ type: 'none' });
    expect(state.editor.error).toBeUndefined();
    expect(typeof state.dispatch).toBe('function');
    expect(typeof state.reset).toBe('function');
  });

  it('um grafo com vértices ganha o layout reconciliado pelo núcleo', () => {
    const graph: Graph = [1, 2, 3].reduce((g) => {
      const added = addVertex(g);
      if (!added.ok) throw new Error('addVertex');
      return added.value.graph;
    }, createGraph({ id: 'g' }));
    const store = createEditorStore({ graph });

    expect(editor(store).layout).toStrictEqual(circularLayout(graph));
  });

  it('cada fábrica cria uma store independente', () => {
    const a = newStore();
    const b = newStore();
    dispatch(a, { type: 'add-vertex', position: point(0, 0) });

    expect(vertexIds(a)).toStrictEqual(['v1']);
    expect(vertexIds(b)).toStrictEqual([]);
  });
});

describe('dispatch', () => {
  it('delega ao núcleo: a transição devolvida e o estado guardado são os de applyAction', () => {
    const store = newStore();
    const before = editor(store);
    const action: EditorAction = { type: 'add-vertex', position: point(10, 20) };
    const transition = store.getState().dispatch(action);

    expect(transition).toStrictEqual(applyAction(before, action));
    expect(editor(store)).toBe(transition.state);
    expect(vertexIds(store)).toStrictEqual(['v1']);
    expect(positionOf(editor(store).layout, 'v1')).toStrictEqual(point(10, 20));
    expect(editor(store).history.past).toHaveLength(1);
  });

  it('o estado anterior não é alterado', () => {
    const store = newStore();
    const before = editor(store);
    const foto = JSON.stringify(before);
    dispatch(store, { type: 'add-vertex', position: point(1, 1) });

    expect(JSON.stringify(before)).toBe(foto);
  });

  it('ação recusada: guarda o erro estruturado, não toca no grafo, no layout nem no histórico, e devolve o erro', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) });
    const before = editor(store);
    const transition = store.getState().dispatch({ type: 'connect', source: 'v1', target: 'v1' });

    expect(transition.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'SELF_LOOP', vertexId: 'v1' } });
    expect(editor(store).error).toBe(transition.error);
    expect(editor(store).graph).toBe(before.graph);
    expect(editor(store).layout).toBe(before.layout);
    expect(editor(store).history).toBe(before.history);
    expect(selectError(store.getState())).toBe(transition.error);
  });

  it('o erro some na próxima ação aplicada', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(Number.NaN, 0) });

    expect(editor(store).error).toStrictEqual({ code: 'INVALID_POSITION' });
    dispatch(store, { type: 'add-vertex', position: point(0, 0) });

    expect(editor(store).error).toBeUndefined();
    expect(vertexIds(store)).toStrictEqual(['v1']); // o id não foi consumido pela recusa
  });

  it('seleção e modo', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) }, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } }, { type: 'set-mode', mode: 'add-vertex' });

    expect(selectSelection(store.getState())).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(selectMode(store.getState())).toBe('add-vertex');
    expect(editor(store).history.past).toHaveLength(1); // seleção e modo fora do histórico
    dispatch(store, { type: 'clear-selection' });

    expect(selectSelection(store.getState())).toStrictEqual({ type: 'none' });
  });

  it('desfazer e refazer pela store: A, B, C → desfazer C → novo vértice v4 com o rótulo C; ids não recuam', () => {
    const store = newStore();
    dispatch(
      store,
      { type: 'add-vertex', position: point(0, 0) },
      { type: 'add-vertex', position: point(100, 0) },
      { type: 'add-vertex', position: point(200, 0) },
      { type: 'undo' },
    );

    expect(vertexIds(store)).toStrictEqual(['v1', 'v2']);
    expect(selectCanUndo(store.getState())).toBe(true);
    expect(selectCanRedo(store.getState())).toBe(true);
    dispatch(store, { type: 'add-vertex', position: point(300, 0) });

    expect(editor(store).graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v4', 'C']]);
    expect(selectCanRedo(store.getState())).toBe(false);
    dispatch(store, { type: 'undo' }, { type: 'redo' });

    expect(vertexLabels(store)).toStrictEqual(['A', 'B', 'C']);
    expect(vertexIds(store)).toStrictEqual(['v1', 'v2', 'v4']);
  });

  it('pode conectar e remover pela store, mantendo grafo e layout juntos', () => {
    const store = newStore(true);
    dispatch(
      store,
      { type: 'add-vertex', position: point(0, 0) },
      { type: 'add-vertex', position: point(100, 0) },
      { type: 'connect', source: 'v1', target: 'v2' },
      { type: 'connect', source: 'v2', target: 'v1' },
      { type: 'select', selection: { type: 'vertex', vertexId: 'v2' } },
      { type: 'remove-selection' },
    );

    expect(vertexIds(store)).toStrictEqual(['v1']);
    expect(editor(store).graph.edges).toStrictEqual([]);
    expect(positionOf(editor(store).layout, 'v2')).toBeUndefined();
    expect(Object.keys(editor(store).layout.positions)).toStrictEqual(['v1']);
  });
});

describe('notificações e seleção eficiente', () => {
  it('uma ação aplicada avisa uma vez; uma recusada também (o erro mudou); uma sem efeito não avisa ninguém', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) });

    expect(notifications(store, () => dispatch(store, { type: 'add-vertex', position: point(5, 5) }))).toBe(1);
    expect(notifications(store, () => dispatch(store, { type: 'connect', source: 'v1', target: 'v1' }))).toBe(1);
    // sem efeito: o mesmo rótulo, mover para onde já está, selecionar o já selecionado, desfazer sem histórico, limpar erro sem erro
    dispatch(store, { type: 'clear-error' });
    const semEfeito: EditorAction[] = [
      { type: 'set-label', vertexId: 'v1', label: 'A' },
      { type: 'move-vertex', vertexId: 'v1', position: point(0, 0) },
      { type: 'set-mode', mode: 'select' },
      { type: 'clear-selection' },
      { type: 'redo' },
      { type: 'clear-error' },
    ];
    const antes = store.getState();

    expect(notifications(store, () => dispatch(store, ...semEfeito))).toBe(0);
    expect(store.getState()).toBe(antes); // nem o estado da store foi recriado
  });

  it('desfazer sem histórico não avisa; selecionar o já selecionado não avisa', () => {
    const store = newStore();

    expect(notifications(store, () => dispatch(store, { type: 'undo' }))).toBe(0);
    dispatch(store, { type: 'add-vertex', position: point(0, 0) }, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });

    expect(notifications(store, () => dispatch(store, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } }))).toBe(0);
  });

  it('selectCanUndo e selectCanRedo acompanham o histórico: falsos no início e depois de esgotado, verdadeiros quando há o que fazer', () => {
    const store = newStore();
    const flags = () => [selectCanUndo(store.getState()), selectCanRedo(store.getState())];

    expect(flags()).toStrictEqual([false, false]);
    dispatch(store, { type: 'add-vertex', position: point(0, 0) });
    expect(flags()).toStrictEqual([true, false]);
    dispatch(store, { type: 'undo' });
    expect(flags()).toStrictEqual([false, true]);
    dispatch(store, { type: 'redo' });
    expect(flags()).toStrictEqual([true, false]);
  });

  it('os seletores devolvem referências estáveis: selecionar ou trocar o modo não troca o grafo nem o layout', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) });
    const graph = selectGraph(store.getState());
    const layout = selectLayout(store.getState());
    dispatch(store, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } }, { type: 'set-mode', mode: 'connect' });

    expect(selectGraph(store.getState())).toBe(graph);
    expect(selectLayout(store.getState())).toBe(layout);
    expect(selectEditor(store.getState())).toBe(editor(store));
    // e um assinante do grafo só é acordado quando o grafo muda
    let changes = 0;
    let last = selectGraph(store.getState());
    const stop = store.subscribe((state) => {
      if (selectGraph(state) !== last) {
        changes++;
        last = selectGraph(state);
      }
    });
    dispatch(store, { type: 'clear-selection' }, { type: 'set-mode', mode: 'select' }, { type: 'move-vertex', vertexId: 'v1', position: point(9, 9) });
    expect(changes).toBe(0); // mover só muda o layout
    dispatch(store, { type: 'add-vertex', position: point(1, 1) });
    stop();

    expect(changes).toBe(1);
  });

  it('o assinante recebe o estado novo e o anterior', () => {
    const store = newStore();
    const seen: [number, number][] = [];
    const stop = store.subscribe((state, previous) => seen.push([previous.editor.graph.vertices.length, state.editor.graph.vertices.length]));
    dispatch(store, { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 1) }, { type: 'undo' });
    stop();

    expect(seen).toStrictEqual([[0, 1], [1, 2], [2, 1]]);
  });
});

describe('reset: nova sessão', () => {
  it('troca o grafo, zera histórico, seleção e erro, e ajusta o layout ao novo grafo; os assinantes são avisados', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) }, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
    dispatch(store, { type: 'connect', source: 'v1', target: 'v1' });
    const outro = createGraph({ id: 'outro', directed: true });
    const antes = editor(store);

    expect(notifications(store, () => store.getState().reset({ graph: outro, historyLimit: 5 }))).toBe(1);
    expect(editor(store).graph).toBe(outro);
    expect(editor(store).layout.graphId).toBe('outro');
    expect(editor(store).history).toStrictEqual({ past: [], future: [], limit: 5 });
    expect(editor(store).selection).toStrictEqual({ type: 'none' });
    expect(editor(store).error).toBeUndefined();
    expect(antes.graph.id).toBe('g'); // o estado anterior ficou intacto
    expect(antes.history.past).toHaveLength(1);
  });

  it('depois do reset, a edição recomeça: ids do novo grafo e desfazer não volta ao grafo antigo', () => {
    const store = newStore();
    dispatch(store, { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 1) });
    store.getState().reset({ graph: createGraph({ id: 'novo' }) });
    dispatch(store, { type: 'add-vertex', position: point(5, 5) });

    expect(vertexIds(store)).toStrictEqual(['v1']);
    expect(editor(store).graph.id).toBe('novo');
    dispatch(store, { type: 'undo' }, { type: 'undo' });

    expect(editor(store).graph.id).toBe('novo');
    expect(vertexIds(store)).toStrictEqual([]);
  });

  it('o reset com um layout de outro grafo é reconciliado pelo núcleo', () => {
    const graph = createGraph({ id: 'g' });
    const store = createEditorStore({ graph });
    const withVertex = applyAction(createEditorState({ graph }), { type: 'add-vertex', position: point(3, 4) }).state;
    store.getState().reset({ graph: withVertex.graph, layout: { graphId: 'estranho', positions: {} } });

    expect(editor(store).layout.graphId).toBe('g');
    expect(positionOf(editor(store).layout, 'v1')).toBeDefined();
  });
});

describe('a store não duplica regras nem puxa o que não deve', () => {
  const source = fs.readFileSync(`${__dirname}/editor-store.ts`, 'utf8');
  const code = source.replace(/\/\/.*$/gm, ''); // sem os comentários
  const specifiers = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

  it('só importa o Zustand vanilla e o núcleo (nada de domínio, SVG, gestos, animação nem React)', () => {
    expect([...specifiers].sort()).toStrictEqual(['./core', 'zustand/vanilla']);
    expect(code).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('não chama as operações do domínio nem do layout nem mexe no histórico: só applyAction e createEditorState', () => {
    for (const forbidden of ['addVertex', 'addEdge', 'removeVertex', 'removeEdge', 'setVertexLabel', 'setEdgeWeight', 'placeVertex', 'moveVertex', 'nextFreeLabel', 'nextVertexSeq', 'nextEdgeSeq', 'restoredGraph']) {
      expect(code).not.toContain(forbidden);
    }
    expect(code).toContain('applyAction(');
    expect(code).toContain('createEditorState(');
  });

  it('o formato do estado da store segue o declarado (editor, dispatch, reset e, desde o 3.7, a conexão e suas duas ações)', () => {
    const state: EditorStoreState = newStore().getState();

    expect(Object.keys(state).sort()).toStrictEqual(
      ['cancelConnection', 'connectNotice', 'connectTap', 'connection', 'dispatch', 'editor', 'reset'].sort(),
    );
  });
});
