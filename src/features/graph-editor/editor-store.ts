import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  applyAction,
  createEditorState,
  NO_CONNECTION,
  reconcileConnection,
  tapToConnectTransition,
  type Camera,
  type ConnectNotice,
  type ConnectState,
  type CreateEditorStateOptions,
  type EditorAction,
  type EditorState,
  type EditorTransition,
  type HitTestOptions,
  type Point,
  type Viewport,
} from './core';

// Store do editor (Fase 3, incremento 3.4): a camada que GUARDA o estado de edição e avisa quem o observa. Toda regra (grafo,
// layout, histórico, seleção, rótulos, contadores de id) mora no núcleo puro `core/editor.ts`; aqui só há `applyAction`,
// `createEditorState` e a guarda contra atualização redundante. Nada de SVG, gestos, animação nem React: é Zustand "vanilla".
//
// Por que `createStore` (vanilla) e não `create`: a fábrica `createEditorStore` devolve uma instância por sessão, sem estado
// global escondido num módulo, e roda em teste sem renderizar componente. A ligação ao React vem quando o primeiro componente
// existir (3.5), com `useStore(store, seletor)` de `zustand`, sem mudar este arquivo nem o núcleo.
//
// Forma do estado: `{ editor, dispatch, reset }`. O `EditorState` inteiro fica numa chave só e é substituído por inteiro a cada
// transição efetiva, então um seletor (`selectGraph`, `selectSelection`…) devolve uma referência estável enquanto aquela parte
// não muda (selecionar um vértice não troca `editor.graph`). O Zustand notifica os assinantes a CADA `setState`, mesmo com o
// mesmo conteúdo, por isso `dispatch` só chama `set` quando a transição trouxe um estado diferente do atual:
// - ação aplicada: novo estado → `set`;
// - ação recusada: novo estado só com `error` → `set` (a interface mostra a mensagem);
// - ação sem efeito: o núcleo devolve o MESMO objeto → nenhuma notificação.
//
// A câmera não está aqui: é estado de tela, fora do desfazer (decisão do incremento 3.0), e entrará na store geral junto com a
// interface.
//
// Conectar (3.7). Ao lado do `EditorState` matemático a store guarda dois estados TRANSITÓRIOS da sessão, fora do histórico, do
// `Graph`, do `GraphLayout` e do JSON: `connection` (a origem pendente, só um id) e `connectNotice` (o que o último toque do modo
// Conectar fez, para o aluno ler). A lógica de transição é do núcleo (`core/connect.ts`); aqui só se orquestra:
// - `connectTap` pede à máquina pura a transição do toque, aplica a ação `connect` pelo `applyAction` (se houver) e guarda tudo de
//   uma vez, então nenhum assinante vê a origem limpa com o grafo ainda sem a aresta;
// - `dispatch` e `reset` mantêm a origem coerente (`reconcileConnection`): trocar de modo, `reset` e a origem deixar de existir
//   (desfazer, refazer ou qualquer alteração) a limpam. O aviso some em qualquer ação efetiva e no `reset`.

export type EditorStoreState = {
  /** O estado de edição inteiro. Substituído por inteiro; nunca alterado no lugar. */
  readonly editor: EditorState;
  /** A origem pendente do modo Conectar. Pequena (um id), fora do `EditorState` e do histórico. */
  readonly connection: ConnectState;
  /** O que o último toque do modo Conectar fez (aresta criada, recusada, cancelada). Some na próxima ação efetiva. */
  readonly connectNotice: ConnectNotice | undefined;
  /** Aplica a ação pelo núcleo puro e guarda o resultado se mudou algo. Devolve a transição (o erro estruturado, se recusada). */
  readonly dispatch: (action: EditorAction) => EditorTransition;
  /**
   * Um toque no canvas no modo Conectar (`screenPoint` em dp, relativo ao canvas). Escolhe a origem, cancela ou pede a conexão
   * (um passo de histórico, ou o erro do domínio e nenhum passo). Devolve a transição do `applyAction` quando houve conexão.
   */
  readonly connectTap: (
    camera: Camera,
    screenPoint: Point,
    viewport: Viewport,
    options?: HitTestOptions,
  ) => EditorTransition | undefined;
  /** Cancela a origem pendente (botão "Cancelar"). Não muda o grafo nem o histórico. Sem origem, não faz nada. */
  readonly cancelConnection: () => void;
  /** Começa uma sessão nova (por exemplo, outro grafo): estado inicial do núcleo, histórico vazio, nenhum erro, nenhuma origem. */
  readonly reset: (options: CreateEditorStateOptions) => void;
};

export type EditorStore = StoreApi<EditorStoreState>;

/** Cria a store de uma sessão de edição com o estado inicial do núcleo para `options`. */
export function createEditorStore(options: CreateEditorStateOptions): EditorStore {
  return createStore<EditorStoreState>()((set, get) => ({
    editor: createEditorState(options),
    connection: NO_CONNECTION,
    connectNotice: undefined,
    dispatch: (action) => {
      const { editor: current, connection } = get();
      const transition = applyAction(current, action);
      if (transition.state !== current) {
        set({
          editor: transition.state,
          connection: reconcileConnection(connection, transition.state),
          connectNotice: undefined,
        });
      }
      return transition;
    },
    connectTap: (camera, screenPoint, viewport, hitOptions) => {
      const { editor, connection } = get();
      const step = tapToConnectTransition(editor, connection, camera, screenPoint, viewport, hitOptions);
      if (step.outcome === 'ignored' && step.connection === connection) return undefined;

      let next = editor;
      let transition: EditorTransition | undefined;
      let notice: ConnectNotice | undefined;
      if (step.action !== undefined) {
        transition = applyAction(editor, step.action);
        next = transition.state;
        notice =
          transition.error === undefined
            ? { kind: 'created', source: step.action.source, target: step.action.target }
            : { kind: 'refused' };
      } else {
        if (step.outcome === 'cancelled') notice = { kind: 'cancelled' };
        // um aviso de erro antigo não deve ficar na tela enquanto o aluno começa outra conexão ou cancela
        if (editor.error !== undefined) next = applyAction(editor, { type: 'clear-error' }).state;
      }
      set({ editor: next, connection: reconcileConnection(step.connection, next), connectNotice: notice });
      return transition;
    },
    cancelConnection: () => {
      if (get().connection.sourceVertexId === undefined) return;
      set({ connection: NO_CONNECTION, connectNotice: { kind: 'cancelled' } });
    },
    reset: (next) => set({ editor: createEditorState(next), connection: NO_CONNECTION, connectNotice: undefined }),
  }));
}

// Seletores: projeções simples, sem regra. Devolvem a própria referência (ou um primitivo), então um assinante só é acordado
// quando a parte que lhe interessa de fato mudou.
export const selectEditor = (state: EditorStoreState): EditorState => state.editor;
export const selectGraph = (state: EditorStoreState) => state.editor.graph;
export const selectLayout = (state: EditorStoreState) => state.editor.layout;
export const selectSelection = (state: EditorStoreState) => state.editor.selection;
export const selectMode = (state: EditorStoreState) => state.editor.mode;
export const selectError = (state: EditorStoreState) => state.editor.error;
export const selectConnection = (state: EditorStoreState) => state.connection;
/** O id da origem pendente do modo Conectar, ou `undefined`. Primitivo: só acorda o assinante quando a origem muda. */
export const selectConnectSource = (state: EditorStoreState) => state.connection.sourceVertexId;
export const selectConnectNotice = (state: EditorStoreState) => state.connectNotice;
export const selectVertexCount = (state: EditorStoreState): number => state.editor.graph.vertices.length;
export const selectCanUndo = (state: EditorStoreState): boolean => state.editor.history.past.length > 0;
export const selectCanRedo = (state: EditorStoreState): boolean => state.editor.history.future.length > 0;
