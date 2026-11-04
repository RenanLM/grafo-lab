import { act, render, screen } from '@testing-library/react-native';
import { Profiler } from 'react';
import { Text } from 'react-native';

import { createGraph } from '@/domain/graph';

import { selectMode } from './editor-store';
import type { EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStore, useEditorStoreApi } from './editor-store-provider';

// Provider e hook da store (ver editor-store-provider.tsx): uma store por montagem, estável, sem singleton, com assinatura por fatia.

const initial = (id: string) => ({ graph: createGraph({ id }) });

/** Registra a store de cada renderização e quantas vezes o componente renderizou. */
function Probe({ onStore, onRender }: { onStore: (store: EditorStore) => void; onRender?: () => void }) {
  onStore(useEditorStoreApi());
  onRender?.();
  return null;
}

describe('EditorStoreProvider', () => {
  it('cria a store uma vez: re-renderizar (inclusive com outro `initial`) devolve a MESMA store e o mesmo grafo', async () => {
    const seen: EditorStore[] = [];
    const tree = (id: string) => (
      <EditorStoreProvider initial={initial(id)}>
        <Probe onStore={(store) => seen.push(store)} />
      </EditorStoreProvider>
    );
    const { rerender } = await render(tree('primeiro'));
    await rerender(tree('segundo'));
    await rerender(tree('terceiro'));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]!.getState().editor.graph.id).toBe('primeiro'); // o `initial` vale só na montagem
  });

  it('não há singleton: dois providers têm stores independentes', async () => {
    const stores: EditorStore[] = [];
    await render(
      <>
        <EditorStoreProvider initial={initial('a')}>
          <Probe onStore={(store) => stores.push(store)} />
        </EditorStoreProvider>
        <EditorStoreProvider initial={initial('b')}>
          <Probe onStore={(store) => stores.push(store)} />
        </EditorStoreProvider>
      </>,
    );
    const [a, b] = [stores[0]!, stores[1]!];
    await act(async () => {
      a.getState().dispatch({ type: 'add-vertex', position: { x: 0, y: 0 } });
    });

    expect(a).not.toBe(b);
    expect(a.getState().editor.graph.vertices).toHaveLength(1);
    expect(b.getState().editor.graph.vertices).toHaveLength(0);
  });

  it('uma sessão nova depois de desmontar começa do zero (nada vaza de uma montagem para a outra)', async () => {
    let store: EditorStore | undefined;
    const tree = (
      <EditorStoreProvider initial={initial('x')}>
        <Probe onStore={(s) => (store = s)} />
      </EditorStoreProvider>
    );
    const primeira = await render(tree);
    await act(async () => {
      store!.getState().dispatch({ type: 'add-vertex', position: { x: 0, y: 0 } });
    });
    expect(store!.getState().editor.graph.vertices).toHaveLength(1);
    await primeira.unmount();
    await render(tree);

    expect(store!.getState().editor.graph.vertices).toHaveLength(0);
  });
});

describe('useEditorStore / useEditorStoreApi', () => {
  it('fora do provider: erro claro (erro de programação, não de usuário)', async () => {
    const erro = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(render(<Probe onStore={() => undefined} />)).rejects.toThrow('useEditorStore precisa estar dentro de <EditorStoreProvider>.');
    erro.mockRestore();
  });

  it('assina uma fatia: só re-renderiza quando o valor do seletor muda', async () => {
    let store: EditorStore | undefined;
    const renders = { modo: 0, grafo: 0 };
    function Modo() {
      return <Text testID="modo">{useEditorStore(selectMode)}</Text>;
    }
    function Vertices() {
      return <Text testID="vertices">{String(useEditorStore((state) => state.editor.graph.vertices.length))}</Text>;
    }
    await render(
      <EditorStoreProvider initial={initial('g')}>
        <Probe onStore={(s) => (store = s)} />
        <Profiler id="modo" onRender={() => renders.modo++}>
          <Modo />
        </Profiler>
        <Profiler id="grafo" onRender={() => renders.grafo++}>
          <Vertices />
        </Profiler>
      </EditorStoreProvider>,
    );
    expect(screen.getByTestId('modo')).toHaveTextContent('select');
    const base = { ...renders };

    // adicionar um vértice muda a contagem de vértices, não o modo
    await act(async () => {
      store!.getState().dispatch({ type: 'add-vertex', position: { x: 0, y: 0 } });
    });
    expect(screen.getByTestId('vertices')).toHaveTextContent('1');
    expect(renders.grafo).toBe(base.grafo + 1);
    expect(renders.modo).toBe(base.modo);

    // trocar o modo muda o modo, não a contagem
    await act(async () => {
      store!.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    });
    expect(screen.getByTestId('modo')).toHaveTextContent('connect');
    expect(renders.modo).toBe(base.modo + 1);
    expect(renders.grafo).toBe(base.grafo + 1);

    // uma ação sem efeito não acorda ninguém
    const antes = { ...renders };
    await act(async () => {
      store!.getState().dispatch({ type: 'set-mode', mode: 'connect' });
    });
    expect(renders).toStrictEqual(antes);
  });

  it('o hook e a API enxergam a mesma store', async () => {
    let store: EditorStore | undefined;
    function Lista() {
      return <Text testID="n">{String(useEditorStore((state) => state.editor.graph.vertices.length))}</Text>;
    }
    await render(
      <EditorStoreProvider initial={initial('g')}>
        <Probe onStore={(s) => (store = s)} />
        <Lista />
      </EditorStoreProvider>,
    );
    await act(async () => {
      store!.getState().dispatch({ type: 'add-vertex', position: { x: 1, y: 1 } });
      store!.getState().dispatch({ type: 'add-vertex', position: { x: 2, y: 2 } });
    });

    expect(screen.getByTestId('n')).toHaveTextContent('2');
  });
});
