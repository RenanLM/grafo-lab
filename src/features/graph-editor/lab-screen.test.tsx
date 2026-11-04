import { fireEvent, render, screen, userEvent, act } from '@testing-library/react-native';
import { Profiler } from 'react';
import { useColorScheme } from 'react-native';

import { createGraph } from '@/domain/graph';

import { canvasSize } from './canvas-size';
import { buildGraphScene, positionOf, type CreateEditorStateOptions } from './core';
import { selectGraph, type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStore, useEditorStoreApi } from './editor-store-provider';
import { EXAMPLE_GRAPH_ID } from './example-graph';
import { LabContent, LabScreen } from './lab-screen';

// O desenho da cena é contado para provar que repetir a medida não recalcula nada; a função real é chamada normalmente.
jest.mock('./core', () => {
  const actual = jest.requireActual('./core');
  return { ...actual, buildGraphScene: jest.fn(actual.buildGraphScene) };
});

// Tela do Laboratório (somente leitura): estado vazio, carregamento do exemplo, reset da sessão, medida do canvas. As consultas ao
// SVG pedem `includeHiddenElements` porque a imagem inteira é uma só para os leitores de tela (ver svg-graph-renderer.tsx).
// Nada aqui é validação visual: isso é conferido no emulador (docs/ARCHITECTURE.md).

const HIDDEN = { includeHiddenElements: true } as const;
const count = (pattern: RegExp): number => screen.queryAllByTestId(pattern, HIDDEN).length;

const layoutOfWidth = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });

async function measure(width: number): Promise<void> {
  await fireEvent(screen.getByTestId('canvas-area'), 'layout', layoutOfWidth(width));
}

async function loadExample(): Promise<void> {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Carregar exemplo' }));
}

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('LabScreen: estado inicial', () => {
  it('explica que não há grafo, oferece o exemplo e não finge ter um editor', async () => {
    await render(<LabScreen />);

    expect(screen.getByText('Laboratório')).toBeOnTheScreen();
    expect(screen.getByText('Nenhum grafo carregado')).toBeOnTheScreen();
    expect(screen.getByText(/Criar vértices e arestas pelo toque ainda não está disponível\./)).toBeOnTheScreen();
    expect(screen.getByText('Somente leitura')).toBeOnTheScreen();
    expect(screen.getByText('O que você vai poder fazer aqui')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Carregar exemplo' })).toBeOnTheScreen();
    expect(screen.queryByTestId('canvas-area')).toBeNull();
    expect(screen.queryByTestId('graph-canvas', HIDDEN)).toBeNull();
  });

  it('só há um botão (nenhum controle de edição que ainda não funciona)', async () => {
    await render(<LabScreen />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('expõe os títulos como cabeçalhos para leitores de tela', async () => {
    await render(<LabScreen />);

    expect(screen.getByRole('header', { name: 'Laboratório' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Nenhum grafo carregado' })).toBeOnTheScreen();
  });
});

describe('LabScreen: carregar o exemplo', () => {
  it('troca o estado vazio pelo quadro; o grafo só é desenhado depois que o canvas é medido', async () => {
    await render(<LabScreen />);
    await loadExample();

    expect(screen.queryByText('Nenhum grafo carregado')).toBeNull();
    expect(screen.getByTestId('canvas-area')).toBeOnTheScreen();
    expect(screen.queryByTestId('graph-canvas', HIDDEN)).toBeNull(); // ainda sem medida: sem câmera, sem cena
    await measure(360);

    expect(screen.getByTestId('graph-canvas', HIDDEN)).toBeTruthy();
    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^vertex-label-/)).toBe(4);
    expect(count(/^edge-stroke-/)).toBe(4);
    expect(count(/^edge-arrow-/)).toBe(4);
    expect(count(/^weight-text-/)).toBe(3);
  });

  it('mostra o nome do grafo e o selo "Somente leitura", e o resumo em texto', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(screen.getByText('Exemplo orientado')).toBeOnTheScreen();
    expect(screen.getByText('Somente leitura')).toBeOnTheScreen();
    expect(screen.getByText('Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.', HIDDEN)).toBeTruthy();
  });

  it('a imagem leva o resumo como descrição acessível, derivada dos dados do grafo', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(screen.getByTestId('graph-canvas', HIDDEN).props).toMatchObject({
      accessibilityRole: 'image',
      accessibilityLabel: 'Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.',
    });
  });

  it.each([320, 360, 411, 600])('largura %i dp: o canvas tem o tamanho calculado e o grafo cabe com a margem', async (largura) => {
    await render(<LabScreen />);
    await loadExample();
    await measure(largura);
    const size = canvasSize(largura)!;
    const canvas = screen.getByTestId('graph-canvas', HIDDEN);

    expect(canvas.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: size.width, height: size.height })]));
    for (const id of ['v1', 'v2', 'v3', 'v4']) {
      const { cx, cy, r } = screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };

      expect(cx - r).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(cy - r).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(cx + r).toBeLessThanOrEqual(size.width - 24 + 1e-6);
      expect(cy + r).toBeLessThanOrEqual(size.height - 24 + 1e-6);
    }
  });

  it('o grafo é recentrado quando a largura muda (o canvas é remedido, a câmera é recalculada)', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(360);
    const antes = screen.getByTestId('vertex-circle-v2', HIDDEN).props.cx as number;
    await measure(600);
    const depois = screen.getByTestId('vertex-circle-v2', HIDDEN).props.cx as number;

    expect(depois).toBeGreaterThan(antes);
  });

  it('medir a mesma largura de novo não recalcula a câmera nem a cena (nenhum laço entre tamanho e câmera)', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(360);
    const cenas = jest.mocked(buildGraphScene).mock.calls.length;
    expect(cenas).toBeGreaterThan(0);
    await measure(360);
    await measure(360.2); // arredonda para 360
    await measure(359.7);
    await measure(360);

    expect(jest.mocked(buildGraphScene).mock.calls.length).toBe(cenas); // nenhuma cena nova
    await measure(411); // uma largura diferente, essa sim, recalcula
    expect(jest.mocked(buildGraphScene).mock.calls.length).toBeGreaterThan(cenas);
  });

  it('a tela renderiza no máximo uma vez a mais ao repetir a mesma largura (o React ainda confere o estado antes de ignorá-lo)', async () => {
    const onRender = jest.fn();
    await render(
      <Profiler id="lab" onRender={onRender}>
        <LabScreen />
      </Profiler>,
    );
    await loadExample();
    await measure(360);
    const antes = onRender.mock.calls.length;
    await measure(360);
    await measure(360);
    await measure(360);

    expect(onRender.mock.calls.length).toBeLessThanOrEqual(antes + 1);
  });

  it('largura ainda não medida (0): nenhuma cena; o quadro espera', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(0);

    expect(screen.queryByTestId('graph-canvas', HIDDEN)).toBeNull();
    expect(screen.getByTestId('canvas-area')).toBeOnTheScreen();
  });

  it('carregar o exemplo de novo deixa o mesmo grafo (não duplica nada)', async () => {
    await render(<LabScreen />);
    await loadExample();
    await measure(360);
    await loadExample();
    await loadExample();

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-stroke-/)).toBe(4);
  });

  it('no tema escuro nada some: os mesmos elementos aparecem', async () => {
    jest.mocked(useColorScheme).mockReturnValue('dark');
    await render(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-arrow-/)).toBe(4);
    expect(count(/^weight-text-/)).toBe(3);
  });

  it('cada montagem da tela é uma sessão nova (a store não vaza para a seguinte)', async () => {
    const primeira = await render(<LabScreen />);
    await loadExample();
    expect(screen.queryByText('Nenhum grafo carregado')).toBeNull();
    await primeira.unmount();
    await render(<LabScreen />);

    expect(screen.getByText('Nenhum grafo carregado')).toBeOnTheScreen();
  });
});

describe('LabContent: o reset da sessão ao carregar o exemplo', () => {
  /** Monta a tela em torno de uma store conhecida, que o teste consegue ler e alterar. */
  async function mountWith(initial: CreateEditorStateOptions) {
    const stores: EditorStore[] = [];
    function Probe() {
      useEditorStore(selectGraph); // assina o grafo: renderiza de novo quando o exemplo é carregado
      stores.push(useEditorStoreApi());
      return null;
    }
    await render(
      <EditorStoreProvider initial={initial}>
        <Probe />
        <LabContent />
      </EditorStoreProvider>,
    );
    return { stores, store: stores[0]! };
  }

  /** Uma sessão antiga, com grafo de outro id, histórico, seleção e erro. */
  async function oldSession() {
    const mounted = await mountWith({ graph: createGraph({ id: 'antigo' }), mode: 'connect' });
    await act(async () => {
      const { dispatch } = mounted.store.getState();
      dispatch({ type: 'add-vertex', position: { x: 999, y: 999 } });
      dispatch({ type: 'add-vertex', position: { x: -500, y: 40 } });
      dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
      dispatch({ type: 'connect', source: 'v1', target: 'v1' }); // recusada: deixa um erro transitório
    });
    return mounted;
  }

  it('a sessão antiga tem o que o reset precisa limpar (precondição)', async () => {
    const { store } = await oldSession();
    const editor = store.getState().editor;

    expect(editor.history.past.length).toBe(2);
    expect(editor.selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(editor.error).toBeDefined();
    expect(editor.mode).toBe('connect');
  });

  it('carrega o grafo novo e o layout dele, e limpa histórico, seleção, erro e posições do grafo antigo', async () => {
    const { store } = await oldSession();
    await loadExample();
    const { graph, layout, history, selection, error, mode } = store.getState().editor;

    expect(graph.id).toBe(EXAMPLE_GRAPH_ID);
    expect(graph.vertices.map((v) => v.label)).toStrictEqual(['A', 'B', 'C', 'D']);
    expect(layout.graphId).toBe(graph.id);
    expect(Object.keys(layout.positions)).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
    expect(positionOf(layout, 'v1')).not.toStrictEqual({ x: 999, y: 999 }); // a posição do grafo antigo não sobrevive
    expect(history).toStrictEqual({ past: [], future: [], limit: 100 });
    expect(selection).toStrictEqual({ type: 'none' });
    expect(error).toBeUndefined();
    expect(mode).toBe('select');
  });

  it('desfazer depois de carregar não volta ao grafo antigo', async () => {
    const { store } = await oldSession();
    await loadExample();
    await act(async () => {
      store.getState().dispatch({ type: 'undo' });
    });

    expect(store.getState().editor.graph.id).toBe(EXAMPLE_GRAPH_ID);
    expect(store.getState().editor.graph.vertices).toHaveLength(4);
  });

  it('a store é a mesma antes e depois de carregar e de re-renderizar (nunca é recriada)', async () => {
    const { stores } = await mountWith({ graph: createGraph({ id: 'antigo' }) });
    await loadExample();
    await measure(360);
    await measure(411);
    await loadExample();

    expect(stores.length).toBeGreaterThan(1);
    expect(new Set(stores).size).toBe(1);
  });

  it('o layout e o grafo carregados chegam juntos ao desenho (o círculo de cada vértice está onde o layout manda)', async () => {
    const { store } = await mountWith({ graph: createGraph({ id: 'antigo' }) });
    await loadExample();
    await measure(360);
    const { layout } = store.getState().editor;
    const posicoes = ['v1', 'v2', 'v3', 'v4'].map((id) => positionOf(layout, id)!);
    const circulos = ['v1', 'v2', 'v3', 'v4'].map((id) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number });

    // a ordem relativa dos centros no mundo é a mesma na tela (a câmera só escala e translada)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(Math.sign(posicoes[i]!.x - posicoes[j]!.x)).toBe(Math.sign(circulos[i]!.cx - circulos[j]!.cx));
        expect(Math.sign(posicoes[i]!.y - posicoes[j]!.y)).toBe(Math.sign(circulos[i]!.cy - circulos[j]!.cy));
      }
    }
  });
});
