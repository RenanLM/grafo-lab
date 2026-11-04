import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { CreateEditorStateOptions } from './core';
import { createEditorStore, type EditorStore, type EditorStoreState } from './editor-store';

// Liga a store do editor (Zustand "vanilla", uma por sessão) ao React. A store é criada UMA vez por montagem do provider, num
// inicializador preguiçoso de `useState`: re-renderizar nunca a recria. Não há singleton de módulo: cada provider tem a sua, e
// quando ele desmonta a sessão acaba (sem persistência nesta etapa). Os componentes assinam FATIAS do estado com seletores:
// `useEditorStore(selectGraph)` só re-renderiza quando o grafo muda de fato.

const EditorStoreContext = createContext<EditorStore | undefined>(undefined);

type ProviderProps = {
  /** Estado inicial da sessão. Vale só na montagem; para trocar de grafo depois use `reset` da store. */
  initial: CreateEditorStateOptions;
  children: ReactNode;
};

export function EditorStoreProvider({ initial, children }: ProviderProps) {
  const [store] = useState(() => createEditorStore(initial));
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>;
}

/** A store da sessão (para `getState`, `subscribe`, `dispatch` fora de renderização). Só dentro de `EditorStoreProvider`. */
export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (store === undefined) throw new Error('useEditorStore precisa estar dentro de <EditorStoreProvider>.');
  return store;
}

/** Assina uma fatia do estado da store: re-renderiza só quando o valor do seletor muda (`Object.is`). */
export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  return useStore(useEditorStoreApi(), selector);
}
