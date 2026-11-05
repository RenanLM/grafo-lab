import { createGraph } from '@/domain/graph';

import { NEUTRAL_CAMERA, NO_CONNECTION, type Point } from './core';
import { createEditorStore, selectConnectNotice, selectConnectSource, selectConnection, type EditorStore } from './editor-store';

// Modo Conectar na store (ver editor-store.ts): a origem pendente e o aviso do último toque ficam AO LADO do `EditorState`, fora do
// histórico, e a store só orquestra a máquina de estados do núcleo. Testada sem renderizar componente.

const VIEWPORT = { width: 360, height: 324 };
const point = (x: number, y: number): Point => ({ x, y });

// v1 em (60, 60), v2 em (200, 60), v3 em (130, 200); a aresta v1—v2 passa por (130, 60), longe dos três vértices
const V1 = point(60, 60);
const V2 = point(200, 60);
const V3 = point(130, 200);
const FUNDO = point(320, 280);
const MEIO_V1_V2 = point(130, 60);

function setup(directed = false, mode: 'connect' | 'add-vertex' = 'connect'): EditorStore {
  const store = createEditorStore({ graph: createGraph({ id: 'g', directed }) });
  for (const position of [V1, V2, V3]) store.getState().dispatch({ type: 'add-vertex', position });
  store.getState().dispatch({ type: 'set-mode', mode });
  return store;
}

const editor = (store: EditorStore) => store.getState().editor;
const tap = (store: EditorStore, at: Point) => store.getState().connectTap(NEUTRAL_CAMERA, at, VIEWPORT);
const source = (store: EditorStore) => selectConnectSource(store.getState());
const edges = (store: EditorStore) => editor(store).graph.edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}`);

/** Quantas vezes os assinantes foram avisados enquanto `act` roda. */
function notifications(store: EditorStore, act: () => void): number {
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  act();
  unsubscribe();
  return listener.mock.calls.length;
}

describe('estado inicial', () => {
  it('nenhuma conexão em andamento e nenhum aviso; as ações novas estão expostas', () => {
    const state = createEditorStore({ graph: createGraph({ id: 'g' }) }).getState();

    expect(state.connection).toBe(NO_CONNECTION);
    expect(state.connectNotice).toBeUndefined();
    expect(typeof state.connectTap).toBe('function');
    expect(typeof state.cancelConnection).toBe('function');
  });

  it('o EditorState matemático não ganhou nenhum campo da conexão (ela mora ao lado, fora do histórico)', () => {
    const { editor } = createEditorStore({ graph: createGraph({ id: 'g' }) }).getState();

    expect(Object.keys(editor).sort()).toStrictEqual(['graph', 'history', 'layout', 'mode', 'selection']);
  });
});

describe('primeiro toque: a origem', () => {
  it('escolhe a origem sem criar aresta, sem gastar id e sem histórico (o EditorState é o mesmo objeto)', () => {
    const store = setup();
    const antes = editor(store);
    const transition = tap(store, V1);

    expect(transition).toBeUndefined();
    expect(source(store)).toBe('v1');
    expect(editor(store)).toBe(antes);
    expect(editor(store).graph.nextEdgeSeq).toBe(1);
    expect(editor(store).history.past).toHaveLength(3); // só os três vértices
    expect(selectConnectNotice(store.getState())).toBeUndefined();
  });

  it('avisa os assinantes UMA vez', () => {
    const store = setup();

    expect(notifications(store, () => tap(store, V1))).toBe(1);
  });

  it('um toque que não faz nada não avisa ninguém: fundo e aresta sem origem, toque fora do canvas, modo diferente', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2); // cria v1—v2: agora há uma aresta
    expect(notifications(store, () => tap(store, FUNDO))).toBe(0);
    expect(notifications(store, () => tap(store, MEIO_V1_V2))).toBe(0);
    expect(notifications(store, () => tap(store, point(-5, 10)))).toBe(0);
    expect(notifications(store, () => tap(store, point(400, 10)))).toBe(0);

    store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });
    expect(notifications(store, () => tap(store, V1))).toBe(0);
    expect(source(store)).toBeUndefined();
  });
});

describe('segundo toque: o destino', () => {
  it('cria UMA aresta pelo applyAction, UM passo de histórico, limpa a origem e avisa UMA vez', () => {
    const store = setup();
    tap(store, V1);
    const passos = editor(store).history.past.length;
    let transition: ReturnType<typeof tap>;
    const avisos = notifications(store, () => {
      transition = tap(store, V2);
    });

    expect(transition!.error).toBeUndefined();
    expect(edges(store)).toStrictEqual(['e1:v1>v2']);
    expect(editor(store).history.past).toHaveLength(passos + 1);
    expect(source(store)).toBeUndefined();
    expect(selectConnection(store.getState())).toBe(NO_CONNECTION);
    expect(selectConnectNotice(store.getState())).toStrictEqual({ kind: 'created', source: 'v1', target: 'v2' });
    expect(avisos).toBe(1);
    expect(editor(store).error).toBeUndefined();
  });

  it('depois da conexão dá para começar OUTRA: o terceiro toque escolhe a nova origem', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2);
    tap(store, V2);
    tap(store, V3);

    expect(edges(store)).toStrictEqual(['e1:v1>v2', 'e2:v2>v3']);
    expect(source(store)).toBeUndefined();
  });

  it('a ordem dos toques é a ordem da aresta', () => {
    const store = setup(true);
    tap(store, V3);
    tap(store, V1);

    expect(edges(store)).toStrictEqual(['e1:v3>v1']);
  });
});

describe('cancelamentos (nenhum muda o grafo nem cria histórico)', () => {
  const casos: readonly (readonly [string, Point])[] = [
    ['tocar de novo na própria origem', V1],
    ['tocar no fundo', FUNDO],
  ];

  it.each(casos)('%s', (_nome, depois) => {
    const store = setup();
    tap(store, V1);
    const antes = editor(store);
    tap(store, depois);

    expect(source(store)).toBeUndefined();
    expect(selectConnectNotice(store.getState())).toStrictEqual({ kind: 'cancelled' });
    expect(editor(store)).toBe(antes);
    expect(editor(store).graph.edges).toHaveLength(0);
  });

  it('tocar em uma aresta cancela', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2); // v1—v2
    tap(store, V3); // origem v3
    tap(store, MEIO_V1_V2);

    expect(source(store)).toBeUndefined();
    expect(selectConnectNotice(store.getState())).toStrictEqual({ kind: 'cancelled' });
    expect(edges(store)).toStrictEqual(['e1:v1>v2']);
  });

  it('o botão Cancelar (cancelConnection) limpa a origem, avisa uma vez e não mexe no estado do editor', () => {
    const store = setup();
    tap(store, V1);
    const antes = editor(store);
    const avisos = notifications(store, () => store.getState().cancelConnection());

    expect(avisos).toBe(1);
    expect(source(store)).toBeUndefined();
    expect(selectConnectNotice(store.getState())).toStrictEqual({ kind: 'cancelled' });
    expect(editor(store)).toBe(antes);
  });

  it('cancelConnection sem origem não faz nada e não avisa ninguém', () => {
    const store = setup();

    expect(notifications(store, () => store.getState().cancelConnection())).toBe(0);
    expect(selectConnectNotice(store.getState())).toBeUndefined();
  });

  it('trocar de modo com a conexão pendente a cancela', () => {
    const store = setup();
    tap(store, V1);
    store.getState().dispatch({ type: 'set-mode', mode: 'add-vertex' });

    expect(source(store)).toBeUndefined();
    store.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    expect(source(store)).toBeUndefined(); // e a origem não volta ao reentrar no modo
  });

  it('escolher o mesmo modo (sem efeito) mantém a origem pendente', () => {
    const store = setup();
    tap(store, V1);
    store.getState().dispatch({ type: 'set-mode', mode: 'connect' });

    expect(source(store)).toBe('v1');
  });

  it('o reset (novo grafo, exemplo) limpa a origem e o aviso', () => {
    const store = setup();
    tap(store, V1);
    store.getState().reset({ graph: createGraph({ id: 'outro' }), mode: 'connect' });

    expect(source(store)).toBeUndefined();
    expect(selectConnectNotice(store.getState())).toBeUndefined();
    expect(store.getState().connection).toBe(NO_CONNECTION);
  });

  it('o reset limpa também um aviso de conexão criada', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2);
    store.getState().reset({ graph: createGraph({ id: 'outro' }), mode: 'connect' });

    expect(selectConnectNotice(store.getState())).toBeUndefined();
  });

  it('a origem que deixa de existir (desfazer o vértice) é cancelada; refazer não a traz de volta', () => {
    const store = setup();
    store.getState().dispatch({ type: 'add-vertex', position: point(300, 100) }); // v4
    tap(store, point(300, 100));
    expect(source(store)).toBe('v4');

    store.getState().dispatch({ type: 'undo' }); // v4 não existe mais
    expect(source(store)).toBeUndefined();
    store.getState().dispatch({ type: 'redo' }); // v4 volta, mas a conexão não
    expect(source(store)).toBeUndefined();
    expect(editor(store).graph.vertices.map((vertex) => vertex.id)).toContain('v4');
  });

  it('desfazer que NÃO remove a origem mantém a conexão pendente', () => {
    const store = setup();
    store.getState().dispatch({ type: 'add-vertex', position: point(300, 100) }); // v4
    tap(store, V1);
    store.getState().dispatch({ type: 'undo' }); // remove v4, a origem v1 continua

    expect(source(store)).toBe('v1');
  });

  it('remover o vértice de origem por qualquer ação cancela a conexão', () => {
    const store = setup();
    tap(store, V1);
    store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
    store.getState().dispatch({ type: 'remove-selection' });

    expect(source(store)).toBeUndefined();
  });
});

describe('o histórico da conexão', () => {
  it('desfazer remove a aresta; refazer devolve a MESMA aresta (id e extremos); uma conexão nova depois de desfazer usa id novo', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2);

    store.getState().dispatch({ type: 'undo' });
    expect(edges(store)).toStrictEqual([]);
    store.getState().dispatch({ type: 'redo' });
    expect(edges(store)).toStrictEqual(['e1:v1>v2']);

    store.getState().dispatch({ type: 'undo' });
    tap(store, V2);
    tap(store, V3);
    expect(edges(store)).toStrictEqual(['e2:v2>v3']); // o e1 não é reaproveitado
    expect(editor(store).history.future).toHaveLength(0); // o ramo de refazer foi descartado
  });

  it('qualquer ação efetiva (desfazer, adicionar vértice) apaga o aviso antigo', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2);
    expect(selectConnectNotice(store.getState())).toBeDefined();

    store.getState().dispatch({ type: 'undo' });
    expect(selectConnectNotice(store.getState())).toBeUndefined();
  });

  it('uma ação sem efeito não apaga o aviso', () => {
    const store = setup();
    tap(store, V1);
    tap(store, V2);
    store.getState().dispatch({ type: 'redo' }); // nada a refazer

    expect(selectConnectNotice(store.getState())).toBeDefined();
  });
});

describe('recusas do domínio (a store não converte recusa em sucesso silencioso)', () => {
  it('não orientado: B—A depois de A—B é duplicata; nada entra no histórico, nenhum id é gasto, a origem é limpa e o erro fica', () => {
    const store = setup(false);
    tap(store, V1);
    tap(store, V2);
    const antes = editor(store);
    tap(store, V2);
    const transition = tap(store, V1);

    expect(transition?.error).toMatchObject({ code: 'GRAPH_ERROR', error: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } });
    expect(editor(store).error).toMatchObject({ code: 'GRAPH_ERROR', error: { code: 'DUPLICATE_EDGE' } });
    expect(editor(store).graph).toBe(antes.graph);
    expect(editor(store).graph.nextEdgeSeq).toBe(antes.graph.nextEdgeSeq);
    expect(editor(store).history).toBe(antes.history);
    expect(edges(store)).toStrictEqual(['e1:v1>v2']);
    expect(source(store)).toBeUndefined();
    expect(selectConnectNotice(store.getState())).toStrictEqual({ kind: 'refused' });
  });

  it('orientado: A → B, depois B → A (permitido) e de novo A → B (duplicata)', () => {
    const store = setup(true);
    tap(store, V1);
    tap(store, V2);
    tap(store, V2);
    const ba = tap(store, V1);
    tap(store, V1);
    const again = tap(store, V2);

    expect(ba?.error).toBeUndefined();
    expect(again?.error).toMatchObject({ error: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } });
    expect(edges(store)).toStrictEqual(['e1:v1>v2', 'e2:v2>v1']);
  });

  it('depois de uma recusa o id seguinte não pulou: a próxima conexão válida recebe o id logo depois da última criada', () => {
    const store = setup(false);
    tap(store, V1);
    tap(store, V2); // e1
    tap(store, V2);
    tap(store, V1); // recusada
    tap(store, V2);
    tap(store, V3); // e2

    expect(edges(store)).toStrictEqual(['e1:v1>v2', 'e2:v2>v3']);
  });

  it('o erro antigo some quando o aluno começa outra conexão (ou cancela)', () => {
    const store = setup(false);
    tap(store, V1);
    tap(store, V2);
    tap(store, V1);
    tap(store, V2); // recusada: erro no estado
    expect(editor(store).error).toBeDefined();

    tap(store, V3); // escolhe outra origem
    expect(editor(store).error).toBeUndefined();
    expect(source(store)).toBe('v3');
  });

  it('o erro antigo some quando o aluno cancela tocando no fundo', () => {
    const store = setup(false);
    tap(store, V1);
    tap(store, V2);
    tap(store, V1);
    tap(store, V2);
    expect(editor(store).error).toBeDefined();
    tap(store, V3);
    tap(store, FUNDO);

    expect(editor(store).error).toBeUndefined();
  });
});

describe('o modo Adicionar vértice continua igual', () => {
  it('toque pelo connectTap em outro modo não cria nada (o caminho de criar é o tapToEditorAction da tela)', () => {
    const store = setup(false, 'add-vertex');
    tap(store, FUNDO);

    expect(editor(store).graph.vertices).toHaveLength(3);
  });

  it('o dispatch de ações comuns continua devolvendo a transição e só avisa quando o estado muda', () => {
    const store = setup();

    expect(notifications(store, () => store.getState().dispatch({ type: 'clear-error' }))).toBe(0);
    expect(notifications(store, () => store.getState().dispatch({ type: 'add-vertex', position: point(10, 10) }))).toBe(1);
  });
});
