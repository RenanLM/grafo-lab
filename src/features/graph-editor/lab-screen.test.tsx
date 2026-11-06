import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { createGraph } from '@/domain/graph';

import { canvasSize } from './canvas-size';
import { buildGraphScene, positionOf, type CreateEditorStateOptions } from './core';
import { selectGraph, type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStore, useEditorStoreApi } from './editor-store-provider';
import { EXAMPLE_GRAPH_ID } from './example-graph';
import { LabContent, LabScreen } from './lab-screen';

// Tela do Laboratório: estado inicial, novo grafo (orientado ou não), exemplo, reset da sessão, câmera estável durante a edição e
// medida do canvas. As consultas ao SVG pedem `includeHiddenElements` porque a imagem inteira é uma só para os leitores de tela
// (ver svg-graph-renderer.tsx). Nada aqui é validação visual: isso é conferido no emulador (docs/ARCHITECTURE.md).
//
// O desenho da cena é contado para provar que repetir a medida não recalcula nada; a função real é chamada normalmente.
jest.mock('./core', () => {
  const actual = jest.requireActual('./core');
  return { ...actual, buildGraphScene: jest.fn(actual.buildGraphScene) };
});

const HIDDEN = { includeHiddenElements: true } as const;

/** O app real tem o `GestureHandlerRootView` no layout raiz; o Gesture Handler 3 exige um ancestral assim para o detector do canvas. */
const mount = (ui: ReactElement) => render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);

const count =(pattern: RegExp): number => screen.queryAllByTestId(pattern, HIDDEN).length;
const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };

const layoutOfWidth = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });

async function measure(width: number): Promise<void> {
  await fireEvent(screen.getByTestId('canvas-area'), 'layout', layoutOfWidth(width));
}

const NOVO = 'Novo grafo não orientado';
const NOVO_ORIENTADO = 'Novo grafo orientado';
const EXEMPLO = 'Carregar exemplo';

async function press(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name }));
}

const loadExample = (): Promise<void> => press(EXEMPLO);

/** Monta a tela em torno de uma store conhecida, que o teste consegue ler e alterar. */
async function mountWith(initial: CreateEditorStateOptions = { graph: createGraph({ id: 'laboratorio' }) }) {
  const stores: EditorStore[] = [];
  function Probe() {
    useEditorStore(selectGraph); // assina o grafo: renderiza de novo quando a sessão é trocada
    stores.push(useEditorStoreApi());
    return null;
  }
  await mount(
    <EditorStoreProvider initial={initial}>
      <Probe />
      <LabContent />
    </EditorStoreProvider>,
  );
  const store = stores[0]!;
  const editor = () => store.getState().editor;
  /** Cria um vértice no MUNDO (como o toque fará) e deixa a tela atualizar. */
  const addAt = async (x: number, y: number) => {
    await act(async () => {
      store.getState().dispatch({ type: 'add-vertex', position: { x, y } });
    });
  };
  return { stores, store, editor, addAt };
}

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('LabScreen: estado inicial', () => {
  it('explica que não há grafo, oferece começar um e não finge ter o que ainda não existe', async () => {
    await mount(<LabScreen />);

    expect(screen.getByText('Laboratório')).toBeOnTheScreen();
    expect(screen.getByText('Nenhum grafo carregado')).toBeOnTheScreen();
    expect(screen.getByText(/Comece um grafo vazio, adicione vértices tocando no quadro, conecte-os e edite, ou carregue o exemplo./)).toBeOnTheScreen();
    expect(screen.queryByText(/ainda não está disponível/)).toBeNull(); // conectar já existe: nada de "em breve" no texto da tela
    expect(screen.queryByText(/chega em breve/)).toBeNull();
    expect(screen.getByText('O que ainda vem aqui')).toBeOnTheScreen();
    expect(screen.getByText(/Executar BFS e DFS passo a passo/)).toBeOnTheScreen();
    expect(screen.queryByText(/Ver o mesmo grafo como lista de adjacência/)).toBeNull(); // o painel das representações já existe (3.11): não está mais em "o que ainda vem"
    expect(screen.queryByText(/Ampliar e deslocar o quadro/)).toBeNull(); // pan e pinça já existem (3.10): não estão mais em "o que ainda vem"
    expect(screen.queryByText(/Arrastar vértices/)).toBeNull(); // arrastar vértices já existe (3.9): não está mais em "o que ainda vem"
    expect(screen.queryByText(/Selecionar, editar e excluir vértices e arestas/)).toBeNull(); // já existe: não está mais em "o que ainda vem"
    expect(screen.queryByText(/Conectar vértices com arestas, tocando na tela/)).toBeNull();
    expect(screen.queryByTestId('canvas-area')).toBeNull();
    expect(screen.queryByTestId('graph-canvas', HIDDEN)).toBeNull();
  });

  it('só os três botões de começar: nenhum modo nem histórico antes de haver um grafo', async () => {
    await mount(<LabScreen />);

    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? '')).toHaveLength(3);
    for (const nome of [NOVO, NOVO_ORIENTADO, EXEMPLO]) expect(screen.getByRole('button', { name: nome })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Modo de edição')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('expõe os títulos como cabeçalhos para leitores de tela', async () => {
    await mount(<LabScreen />);

    expect(screen.getByRole('header', { name: 'Laboratório' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Nenhum grafo carregado' })).toBeOnTheScreen();
  });
});

describe('LabScreen: novo grafo', () => {
  it.each([
    [NOVO, false, 'Grafo não orientado vazio: nenhum vértice e nenhuma aresta.', 'Novo grafo não orientado'],
    [NOVO_ORIENTADO, true, 'Grafo orientado vazio: nenhum vértice e nenhuma aresta.', 'Novo grafo orientado'],
  ])('%s: sessão vazia, canvas pronto, Adicionar vértice ativo e o resumo descreve o grafo vazio', async (botao, orientado, resumo, nome) => {
    const { editor } = await mountWith();
    await press(botao);
    await measure(360);
    const { graph, layout, history, selection, error, mode } = editor();

    expect(graph).toMatchObject({ id: 'novo-grafo-1', name: nome, directed: orientado, vertices: [], edges: [] });
    expect(layout.graphId).toBe('novo-grafo-1');
    expect(Object.keys(layout.positions)).toStrictEqual([]);
    expect(history).toStrictEqual({ past: [], future: [], limit: 100 });
    expect(selection).toStrictEqual({ type: 'none' });
    expect(error).toBeUndefined();
    expect(mode).toBe('add-vertex');
    expect(screen.getByTestId('graph-canvas', HIDDEN).props.accessibilityLabel).toBe(resumo);
    expect(screen.getByText(resumo, HIDDEN)).toBeTruthy();
    expect(screen.getAllByText(nome)).toHaveLength(2); // o botão que começou o grafo e o selo com o nome dele
    expect(count(/^vertex-circle-/)).toBe(0);
    expect(screen.getByRole('radio', { name: 'Adicionar vértice', selected: true })).toBeOnTheScreen();
  });

  it('a mensagem de estado vazio muda com o modo e some com o primeiro vértice', async () => {
    const { addAt } = await mountWith();
    await press(NOVO);
    await measure(360);
    expect(screen.getByText('Toque no espaço para adicionar o primeiro vértice.')).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByRole('radio', { name: 'Selecionar' }));
    expect(screen.getByText('Selecione Adicionar vértice e toque no espaço para começar.')).toBeOnTheScreen();
    await user.press(screen.getByRole('radio', { name: 'Adicionar vértice' }));
    await addAt(100, 100);

    expect(screen.queryByText('Toque no espaço para adicionar o primeiro vértice.')).toBeNull();
    expect(screen.queryByText('Selecione Adicionar vértice e toque no espaço para começar.')).toBeNull();
    expect(screen.queryByTestId('canvas-hint')).toBeNull();
  });

  // Defeito visto no Android: com a mensagem ACIMA do quadro, o primeiro vértice a fazia sumir, o quadro subia ~36 dp e o vértice
  // criado ficava longe do dedo. Agora ela fica DENTRO do quadro, sobreposta e transparente ao toque (pointerEvents none).
  it('a mensagem do quadro vazio fica dentro do quadro, não captura toques e não ocupa lugar no fluxo (o quadro não se move)', async () => {
    const { addAt } = await mountWith();
    await press(NOVO);
    await measure(360);

    const canvas = screen.getByTestId('canvas-area');
    const hint = within(canvas).getByTestId('canvas-hint');
    expect(within(hint).getByText('Toque no espaço para adicionar o primeiro vértice.')).toBeOnTheScreen();
    expect(hint).toHaveStyle({ position: 'absolute', pointerEvents: 'none' });
    // a mensagem NÃO vem antes do quadro (a árvore é percorrida em ordem de desenho): o que some ao criar o vértice não pode deslocá-lo
    const ordem = () => screen.queryAllByTestId(/^(mode-connect|canvas-hint|canvas-area|history-undo)$/).map((node) => String(node.props.testID));
    expect(ordem()).toStrictEqual(['mode-connect', 'canvas-area', 'canvas-hint', 'history-undo']);

    await addAt(100, 100);
    expect(ordem()).toStrictEqual(['mode-connect', 'canvas-area', 'history-undo']);
  });

  it('Desfazer e Refazer começam desabilitados', async () => {
    await mountWith();
    await press(NOVO);

    expect(screen.getByRole('button', { name: 'Desfazer' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: 'Refazer' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a cena do grafo vazio é desenhada, o primeiro vértice aparece no mesmo ponto e o resumo é atualizado', async () => {
    const { addAt } = await mountWith();
    await press(NOVO_ORIENTADO);
    await measure(360);
    await addAt(100, 80);

    expect(count(/^vertex-circle-/)).toBe(1);
    expect(circle('v1')).toMatchObject({ cx: 100, cy: 80, r: 20 });
    expect(screen.getByTestId('graph-canvas', HIDDEN).props.accessibilityLabel).toBe(
      'Grafo orientado com 1 vértice e 0 arestas. O vértice A está isolado.',
    );
    expect(screen.getByRole('button', { name: 'Desfazer' }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('cada grafo novo recebe um id novo (novo-grafo-1, novo-grafo-2…)', async () => {
    const { editor } = await mountWith();
    await press(NOVO);
    await press(NOVO_ORIENTADO);

    expect(editor().graph.id).toBe('novo-grafo-2');
    expect(editor().graph.directed).toBe(true);
  });

  it('nada da sessão anterior contamina o grafo novo: grafo, layout, histórico, seleção, erro e modo recomeçam', async () => {
    const { editor, store, addAt } = await mountWith({ graph: createGraph({ id: 'antigo' }), mode: 'connect' });
    await addAt(999, 999);
    await addAt(-500, 40);
    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
      store.getState().dispatch({ type: 'connect', source: 'v1', target: 'v1' }); // recusada: erro transitório
    });
    expect(editor().history.past.length).toBe(2);
    expect(editor().error).toBeDefined();
    await press(NOVO_ORIENTADO);
    const { graph, layout, history, selection, error, mode } = editor();

    expect(graph.id).toBe('novo-grafo-1');
    expect(graph.vertices).toStrictEqual([]);
    expect(graph.edges).toStrictEqual([]);
    expect(graph.nextVertexSeq).toBe(1); // os contadores de id também recomeçam
    expect(layout.graphId).toBe('novo-grafo-1');
    expect(Object.keys(layout.positions)).toStrictEqual([]);
    expect(history).toStrictEqual({ past: [], future: [], limit: 100 });
    expect(selection).toStrictEqual({ type: 'none' });
    expect(error).toBeUndefined();
    expect(mode).toBe('add-vertex');
    await addAt(50, 60);
    expect(editor().graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]); // v1 e A de novo: sessão limpa
    expect(positionOf(editor().layout, 'v1')).toStrictEqual({ x: 50, y: 60 });
  });

  it('o exemplo continua funcionando antes e depois de um grafo novo (e cada troca zera o histórico)', async () => {
    const { editor, addAt } = await mountWith();
    await press(NOVO);
    await measure(360);
    await addAt(100, 100);
    await loadExample();

    expect(editor().graph.id).toBe(EXAMPLE_GRAPH_ID);
    expect(editor().graph.vertices).toHaveLength(4);
    expect(editor().history.past).toHaveLength(0);
    expect(editor().mode).toBe('select');
    expect(count(/^vertex-circle-/)).toBe(4);
    await press(NOVO);

    expect(editor().graph.vertices).toHaveLength(0);
    expect(count(/^vertex-circle-/)).toBe(0);
    await loadExample();
    expect(count(/^vertex-circle-/)).toBe(4);
  });
});

describe('LabScreen: câmera estável durante a edição', () => {
  it('grafo novo: câmera neutra; adicionar, desfazer, refazer e trocar de modo não mexem nos vértices já desenhados', async () => {
    const { addAt } = await mountWith();
    await press(NOVO);
    await measure(360);
    await addAt(100, 100);
    const primeiro = { ...circle('v1') };
    await addAt(300, 250);
    const user = userEvent.setup();

    expect(circle('v1')).toStrictEqual(primeiro);
    expect(circle('v2')).toMatchObject({ cx: 300, cy: 250 }); // câmera neutra: o ponto do mundo é o ponto em dp
    await user.press(screen.getByRole('button', { name: 'Desfazer' }));
    expect(circle('v1')).toStrictEqual(primeiro);
    await user.press(screen.getByRole('button', { name: 'Refazer' }));
    expect(circle('v1')).toStrictEqual(primeiro);
    expect(circle('v2')).toMatchObject({ cx: 300, cy: 250 });
    await user.press(screen.getByRole('radio', { name: 'Selecionar' }));
    expect(circle('v1')).toStrictEqual(primeiro);
  });

  it('o exemplo é enquadrado UMA vez; um vértice novo (mesmo fora dos limites) não reenquadra nada', async () => {
    const { addAt } = await mountWith();
    await loadExample();
    await measure(360);
    const antes = ['v1', 'v2', 'v3', 'v4'].map((id) => ({ ...circle(id) }));
    await addAt(900, 900); // longe do que foi enquadrado
    const depois = ['v1', 'v2', 'v3', 'v4'].map((id) => circle(id));

    expect(depois).toStrictEqual(antes);
    expect(count(/^vertex-circle-/)).toBe(5);
  });

  it('depois do exemplo, um grafo novo volta à câmera neutra (não herda o enquadramento)', async () => {
    const { addAt } = await mountWith();
    await loadExample();
    await measure(360);
    await press(NOVO);
    await addAt(50, 70);

    expect(circle('v1')).toMatchObject({ cx: 50, cy: 70, r: 20 });
  });

  // 3.10: redimensionar (ou girar) NÃO reenquadra o grafo: o ponto do mundo que estava sob o CENTRO do quadro antigo fica sob o centro do novo, com o mesmo zoom. A altura do quadro é função da
  // largura (0,9, entre 240 e 420 dp): 360 dp de largura dão 324 de altura (centro em 180, 162) e 600 dão 420 (centro em 300, 210), então tudo se desloca (120, 48) e nada muda de tamanho.
  it('redimensionar o canvas mantém o ponto do mundo que estava no centro (os vértices mantêm a posição RELATIVA ao centro, o zoom não muda) e não reenquadra', async () => {
    const { addAt } = await mountWith();
    await press(NOVO);
    await measure(360);
    await addAt(120, 90);
    await measure(600);

    expect(circle('v1')).toMatchObject({ cx: 240, cy: 138, r: 20 }); // (120 − 180, 90 − 162) a partir do novo centro (300, 210)

    await loadExample();
    await measure(360);
    const before = circle('v2');
    await measure(600);
    const after = circle('v2');

    expect(after.cx - before.cx).toBeCloseTo(120, 6);
    expect(after.cy - before.cy).toBeCloseTo(48, 6);
    expect(after.r).toBe(before.r); // o zoom é o mesmo: não houve novo enquadramento
  });

  it('voltar à largura anterior devolve a câmera ao ponto de partida (a mudança é reversível e sem resíduo)', async () => {
    const { addAt } = await mountWith();
    await press(NOVO);
    await measure(360);
    await addAt(120, 90);
    await measure(600);
    await measure(360);

    expect(circle('v1')).toMatchObject({ cx: 120, cy: 90, r: 20 });
  });
});

describe('LabScreen: carregar o exemplo', () => {
  it('troca o estado vazio pelo quadro; o grafo só é desenhado depois que o canvas é medido', async () => {
    await mount(<LabScreen />);
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

  it('mostra o nome do grafo, os controles do editor e o resumo em texto', async () => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(screen.getByText('Exemplo orientado')).toBeOnTheScreen();
    expect(screen.queryByText('Somente leitura')).toBeNull(); // o quadro já aceita vértices novos
    expect(screen.getByLabelText('Modo de edição')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Selecionar', selected: true })).toBeOnTheScreen();
    expect(screen.getByText('Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.', HIDDEN)).toBeTruthy();
  });

  it('a imagem leva o resumo como descrição acessível, derivada dos dados do grafo', async () => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(screen.getByTestId('graph-canvas', HIDDEN).props).toMatchObject({
      accessibilityRole: 'image',
      accessibilityLabel: 'Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.',
    });
  });

  it.each([320, 360, 411, 600])('largura %i dp: o canvas tem o tamanho calculado e o grafo cabe com a margem', async (largura) => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(largura);
    const size = canvasSize(largura)!;
    const canvas = screen.getByTestId('graph-canvas', HIDDEN);

    expect(canvas.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: size.width, height: size.height })]));
    for (const id of ['v1', 'v2', 'v3', 'v4']) {
      const { cx, cy, r } = circle(id);

      expect(cx - r).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(cy - r).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(cx + r).toBeLessThanOrEqual(size.width - 24 + 1e-6);
      expect(cy + r).toBeLessThanOrEqual(size.height - 24 + 1e-6);
    }
  });

  it('o grafo é recentrado quando a largura muda (o canvas é remedido, a câmera é recalculada)', async () => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(360);
    const antes = circle('v2').cx;
    await measure(600);

    expect(circle('v2').cx).toBeGreaterThan(antes);
  });

  it('medir a mesma largura de novo não recalcula a câmera nem a cena (nenhum laço entre tamanho e câmera)', async () => {
    await mount(<LabScreen />);
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

  it('largura ainda não medida (0): nenhuma cena; o quadro espera', async () => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(0);

    expect(screen.queryByTestId('graph-canvas', HIDDEN)).toBeNull();
    expect(screen.getByTestId('canvas-area')).toBeOnTheScreen();
  });

  it('carregar o exemplo de novo deixa o mesmo grafo (não duplica nada)', async () => {
    await mount(<LabScreen />);
    await loadExample();
    await measure(360);
    await loadExample();
    await loadExample();

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-stroke-/)).toBe(4);
  });

  it('no tema escuro nada some: os mesmos elementos e controles aparecem', async () => {
    jest.mocked(useColorScheme).mockReturnValue('dark');
    await mount(<LabScreen />);
    await loadExample();
    await measure(360);

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-arrow-/)).toBe(4);
    expect(count(/^weight-text-/)).toBe(3);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeOnTheScreen();
  });

  it('cada montagem da tela é uma sessão nova (a store não vaza para a seguinte)', async () => {
    const primeira = await mount(<LabScreen />);
    await loadExample();
    expect(screen.queryByText('Nenhum grafo carregado')).toBeNull();
    await primeira.unmount();
    await mount(<LabScreen />);

    expect(screen.getByText('Nenhum grafo carregado')).toBeOnTheScreen();
  });
});

describe('LabContent: o reset da sessão ao carregar o exemplo', () => {
  /** Uma sessão antiga, com grafo de outro id, histórico, seleção e erro. */
  async function oldSession() {
    const mounted = await mountWith({ graph: createGraph({ id: 'antigo' }), mode: 'connect' });
    await mounted.addAt(999, 999);
    await mounted.addAt(-500, 40);
    await act(async () => {
      const { dispatch } = mounted.store.getState();
      dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
      dispatch({ type: 'connect', source: 'v1', target: 'v1' }); // recusada: deixa um erro transitório
    });
    return mounted;
  }

  it('a sessão antiga tem o que o reset precisa limpar (precondição)', async () => {
    const { editor } = await oldSession();

    expect(editor().history.past.length).toBe(2);
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(editor().error).toBeDefined();
    expect(editor().mode).toBe('connect');
  });

  it('carrega o grafo novo e o layout dele, e limpa histórico, seleção, erro e posições do grafo antigo', async () => {
    const { editor } = await oldSession();
    await loadExample();
    const { graph, layout, history, selection, error, mode } = editor();

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
    const { store, editor } = await oldSession();
    await loadExample();
    await act(async () => {
      store.getState().dispatch({ type: 'undo' });
    });

    expect(editor().graph.id).toBe(EXAMPLE_GRAPH_ID);
    expect(editor().graph.vertices).toHaveLength(4);
  });

  it('a store é a mesma antes e depois de carregar, de começar um grafo novo e de re-renderizar (nunca é recriada)', async () => {
    const { stores } = await mountWith({ graph: createGraph({ id: 'antigo' }) });
    await loadExample();
    await measure(360);
    await measure(411);
    await press(NOVO);
    await loadExample();

    expect(stores.length).toBeGreaterThan(1);
    expect(new Set(stores).size).toBe(1);
  });

  it('o layout e o grafo carregados chegam juntos ao desenho (a ordem dos centros no mundo é a da tela)', async () => {
    const { editor } = await mountWith({ graph: createGraph({ id: 'antigo' }) });
    await loadExample();
    await measure(360);
    const ids = ['v1', 'v2', 'v3', 'v4'];
    const posicoes = ids.map((id) => positionOf(editor().layout, id)!);
    const circulos = ids.map((id) => circle(id));

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(Math.sign(posicoes[i]!.x - posicoes[j]!.x)).toBe(Math.sign(circulos[i]!.cx - circulos[j]!.cx));
        expect(Math.sign(posicoes[i]!.y - posicoes[j]!.y)).toBe(Math.sign(circulos[i]!.cy - circulos[j]!.cy));
      }
    }
  });
});
