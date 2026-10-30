import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  applyAction,
  createEditorState,
  type CreateEditorStateOptions,
  type EditorAction,
  type EditorState,
  type EditorTransition,
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

export type EditorStoreState = {
  /** O estado de edição inteiro. Substituído por inteiro; nunca alterado no lugar. */
  readonly editor: EditorState;
  /** Aplica a ação pelo núcleo puro e guarda o resultado se mudou algo. Devolve a transição (o erro estruturado, se recusada). */
  readonly dispatch: (action: EditorAction) => EditorTransition;
  /** Começa uma sessão nova (por exemplo, outro grafo): estado inicial do núcleo, histórico vazio, nenhum erro. */
  readonly reset: (options: CreateEditorStateOptions) => void;
};

export type EditorStore = StoreApi<EditorStoreState>;

/** Cria a store de uma sessão de edição com o estado inicial do núcleo para `options`. */
export function createEditorStore(options: CreateEditorStateOptions): EditorStore {
  return createStore<EditorStoreState>()((set, get) => ({
    editor: createEditorState(options),
    dispatch: (action) => {
      const current = get().editor;
      const transition = applyAction(current, action);
      if (transition.state !== current) set({ editor: transition.state });
      return transition;
    },
    reset: (next) => set({ editor: createEditorState(next) }),
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
export const selectCanUndo = (state: EditorStoreState): boolean => state.editor.history.past.length > 0;
export const selectCanRedo = (state: EditorStoreState): boolean => state.editor.history.future.length > 0;
