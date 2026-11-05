import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';

import { createGraph } from '@/domain/graph';
import { colors, minTouchTarget } from '@/theme';

import { NEUTRAL_CAMERA, positionOf, type EditorMode } from './core';
import { type EditorStore } from './editor-store';
import { ConnectStatus, HistoryBar, ModeBar } from './editor-controls';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';

// Barra de modos, linha de estado do modo Conectar e barra de histórico (ver editor-controls.tsx): só despacham ações do núcleo (ou
// chamam a store) e mostram o estado sem depender de cor (marca "✓", contorno tracejado, legenda e estados acessíveis).

const HIDDEN = { includeHiddenElements: true } as const;
const VIEWPORT = { width: 360, height: 324 };

async function mountControls(mode: EditorMode = 'select') {
  const stores: EditorStore[] = [];
  function Probe() {
    stores.push(useEditorStoreApi());
    return null;
  }
  await render(
    <EditorStoreProvider initial={{ graph: createGraph({ id: 'g' }), mode }}>
      <Probe />
      <ModeBar />
      <ConnectStatus />
      <HistoryBar />
    </EditorStoreProvider>,
  );
  const store = stores[0]!;
  const add = async (x: number, y: number) => {
    await act(async () => {
      store.getState().dispatch({ type: 'add-vertex', position: { x, y } });
    });
  };
  /** Um toque no canvas no modo Conectar (câmera neutra: o ponto de tela é o do mundo). */
  const tapConnect = async (x: number, y: number) => {
    await act(async () => {
      store.getState().connectTap(NEUTRAL_CAMERA, { x, y }, VIEWPORT);
    });
  };
  const editor = () => store.getState().editor;
  return { store, add, tapConnect, editor, user: userEvent.setup() };
}

const radio = (name: string) => screen.getByRole('radio', { name });
const button = (name: string) => screen.getByRole('button', { name });
const style = (element: ReturnType<typeof radio>) => StyleSheet.flatten(element.props.style);

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('ModeBar', () => {
  it('é um grupo de modos com três opções: Selecionar, Adicionar vértice e Conectar', async () => {
    await mountControls();

    // o grupo NÃO é `accessible` de propósito (isso esconderia os três botões dos leitores de tela): o papel é lido pelo rótulo
    expect(screen.getByLabelText('Modo de edição').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    for (const nome of ['Selecionar', 'Adicionar vértice', 'Conectar']) expect(radio(nome)).toBeOnTheScreen();
  });

  it('o modo ativo é identificado por estado acessível E por marca visual (não só cor)', async () => {
    await mountControls('add-vertex');

    expect(screen.getByRole('radio', { name: 'Adicionar vértice', selected: true })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Selecionar', selected: true })).toBeNull();
    // a marca "✓" aparece só no ativo (escondida dos leitores de tela: o estado `selected` já a substitui)
    expect(screen.getAllByText('✓', HIDDEN)).toHaveLength(1);
    expect(radio('Adicionar vértice').props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(radio('Selecionar').props.accessibilityState).toMatchObject({ selected: false });
  });

  // Visto no Android: sem `flexShrink` o rótulo de duas linhas ("Adicionar vértice") não quebra dentro da linha e empurra a marca "✓"
  // para fora do botão, onde ela é cortada.
  it('o rótulo pode encolher e quebrar dentro do botão, sem empurrar a marca "✓" para fora', async () => {
    await mountControls('add-vertex');

    expect(within(radio('Adicionar vértice')).getByText('Adicionar vértice')).toHaveStyle({ flexShrink: 1 });
  });

  it('a marca e o estado acompanham o modo: Selecionar ativo → a marca está no Selecionar', async () => {
    const { user } = await mountControls('select');
    expect(screen.getByRole('radio', { name: 'Selecionar', selected: true })).toBeOnTheScreen();

    await user.press(radio('Adicionar vértice'));
    expect(screen.getByRole('radio', { name: 'Adicionar vértice', selected: true })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Selecionar', selected: true })).toBeNull();
    expect(screen.getAllByText('✓', HIDDEN)).toHaveLength(1);
  });

  it('escolher um modo despacha `set-mode` e NÃO cria entrada de histórico (o objeto `history` é o mesmo)', async () => {
    const { user, editor } = await mountControls('select');
    const historico = editor().history;
    await user.press(radio('Adicionar vértice'));

    expect(editor().mode).toBe('add-vertex');
    expect(editor().history).toBe(historico);
    await user.press(radio('Selecionar'));
    expect(editor().mode).toBe('select');
    expect(editor().history).toBe(historico);
  });

  it('tocar no modo já ativo não muda o estado (o mesmo objeto)', async () => {
    const { user, editor } = await mountControls('add-vertex');
    const antes = editor();
    await user.press(radio('Adicionar vértice'));

    expect(editor()).toBe(antes);
  });

  it('Conectar com menos de dois vértices fica desabilitado, com legenda e dica de adicionar vértices, e tocá-lo não faz nada', async () => {
    const { user, editor, add } = await mountControls('add-vertex');
    for (const vertices of [0, 1]) {
      if (vertices === 1) await add(60, 60);
      const antes = editor();

      expect(radio('Conectar').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
      expect(screen.getByRole('radio', { name: 'Conectar', disabled: true })).toBeOnTheScreen();
      expect(screen.getByText('2+ vértices')).toBeOnTheScreen();
      // a legenda cabe em UMA linha: no emulador, "precisa de 2 vértices" quebrava em duas, o botão crescia ~13 dp e, ao sumir com o
      // segundo vértice, a barra encolhia e o canvas subia no mesmo toque (os vértices A e B ficaram fora do ponto tocado)
      expect(screen.getByText('2+ vértices').props.numberOfLines).toBe(1);
      expect(radio('Conectar').props.accessibilityHint).toBe('Adicione pelo menos dois vértices para poder conectar');
      await user.press(radio('Conectar'));

      expect(editor()).toBe(antes);
      expect(editor().mode).toBe('add-vertex');
    }
  });

  it('com dois vértices o Conectar habilita (sem a legenda, sem "em breve"), e escolhê-lo usa set-mode sem criar histórico', async () => {
    const { user, editor, add } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    const history = editor().history;

    expect(screen.getByRole('radio', { name: 'Conectar', disabled: false })).toBeOnTheScreen();
    expect(screen.queryByText('2+ vértices')).toBeNull();
    expect(screen.queryByText('em breve')).toBeNull();
    expect(radio('Conectar').props.accessibilityHint).toBe('Toque em um vértice para escolher a origem e em outro para escolher o destino');
    expect(style(radio('Conectar')).borderStyle).toBe('solid');
    await user.press(radio('Conectar'));

    expect(editor().mode).toBe('connect');
    expect(editor().history).toBe(history); // trocar de modo não é uma edição
    expect(screen.getByRole('radio', { name: 'Conectar', selected: true })).toBeOnTheScreen();
    expect(screen.getAllByText('✓', HIDDEN)).toHaveLength(1);
  });

  it('no modo Conectar o botão segue habilitado e ativo mesmo se os vértices diminuírem (desfazer): nada fica preso', async () => {
    const { user, editor, add } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));
    await user.press(button('Desfazer'));
    await user.press(button('Desfazer'));

    expect(editor().graph.vertices).toHaveLength(0);
    expect(editor().mode).toBe('connect');
    expect(screen.getByRole('radio', { name: 'Conectar', selected: true, disabled: false })).toBeOnTheScreen();
    await user.press(radio('Adicionar vértice')); // dá para sair
    expect(editor().mode).toBe('add-vertex');
  });

  // A barra de modos fica ACIMA do canvas: se a legenda do Conectar mudasse a altura dela ao criar o segundo vértice, o canvas se
  // deslocaria nesse toque e o vértice criado ficaria longe do dedo (o defeito que o 3.6 achou no emulador).
  it('a altura da barra de modos é a mesma com e sem a legenda do Conectar (piso de duas linhas)', async () => {
    const { add } = await mountControls('add-vertex');
    const duasLinhas = 24 * 2 + 8 * 2 + 3; // 2 linhas de rótulo, enchimento e borda dos botões

    const antes = style(screen.getByLabelText('Modo de edição')).minHeight;
    await add(60, 60);
    await add(200, 60); // a legenda do Conectar some
    const depois = style(screen.getByLabelText('Modo de edição')).minHeight;

    expect(antes).toBe(duasLinhas);
    expect(depois).toBe(duasLinhas);
  });

  it('o desabilitado se distingue sem cor (contorno tracejado); os ativos têm contorno contínuo', async () => {
    await mountControls();

    expect(style(radio('Conectar')).borderStyle).toBe('dashed');
    expect(style(radio('Selecionar')).borderStyle).toBe('solid');
  });

  it('todos têm alvo de toque de pelo menos 48 dp', async () => {
    await mountControls();

    for (const nome of ['Selecionar', 'Adicionar vértice', 'Conectar']) {
      expect(style(radio(nome)).minHeight).toBeGreaterThanOrEqual(minTouchTarget);
    }
  });

  it.each(['light', 'dark'] as const)('tema %s: o ativo usa primary/onPrimary e o inativo, surface/text (tokens do tema)', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await mountControls('add-vertex');
    const paleta = colors[scheme];

    expect(style(radio('Adicionar vértice')).backgroundColor).toBe(paleta.primary);
    expect(style(radio('Selecionar')).backgroundColor).toBe(paleta.surface);
    expect(style(radio('Selecionar')).borderColor).toBe(paleta.border);
  });
});

describe('HistoryBar', () => {
  it('sem histórico, Desfazer e Refazer ficam desabilitados', async () => {
    await mountControls();

    expect(button('Desfazer').props.accessibilityState).toMatchObject({ disabled: true });
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: true });
    expect(style(button('Desfazer')).borderStyle).toBe('dashed');
  });

  it('depois de uma edição, só Desfazer habilita; o botão desfaz e então só Refazer habilita', async () => {
    const { add, editor, user } = await mountControls();
    await add(100, 100);

    expect(button('Desfazer').props.accessibilityState).toMatchObject({ disabled: false });
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: true });
    await user.press(button('Desfazer'));

    expect(editor().graph.vertices).toStrictEqual([]);
    expect(button('Desfazer').props.accessibilityState).toMatchObject({ disabled: true });
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('Refazer restaura o MESMO vértice (id, rótulo e posição)', async () => {
    const { add, editor, user } = await mountControls();
    await add(120, 80);
    const original = editor().graph.vertices[0];
    const posicao = positionOf(editor().layout, 'v1');
    await user.press(button('Desfazer'));
    await user.press(button('Refazer'));

    expect(editor().graph.vertices).toStrictEqual([original]);
    expect(editor().graph.vertices[0]).toMatchObject({ id: 'v1', label: 'A' });
    expect(positionOf(editor().layout, 'v1')).toStrictEqual(posicao);
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('A, B, C → Desfazer → novo vértice: v4 com o rótulo C; o novo ramo descarta o Refazer', async () => {
    const { add, editor, user } = await mountControls();
    await add(60, 60);
    await add(180, 60);
    await add(300, 60);
    await user.press(button('Desfazer'));
    expect(editor().graph.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2']);
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: false });
    await add(240, 200);

    expect(editor().graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v4', 'C']]);
    expect(button('Refazer').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('desfazer e refazer pelos botões não criam histórico extra: os passos acompanham só as edições', async () => {
    const { add, editor, user } = await mountControls();
    await add(60, 60);
    await add(180, 60);
    expect(editor().history.past).toHaveLength(2);
    await user.press(button('Desfazer'));
    await user.press(button('Refazer'));
    await user.press(button('Desfazer'));

    expect(editor().history.past).toHaveLength(1);
    expect(editor().history.future).toHaveLength(1);
  });

  it('pressionar um botão desabilitado não faz nada', async () => {
    const { editor, user } = await mountControls();
    const antes = editor();
    await user.press(button('Desfazer'));
    await user.press(button('Refazer'));

    expect(editor()).toBe(antes);
  });

  it('o modo não é desfeito: Desfazer só mexe no grafo (a escolha do modo fica)', async () => {
    const { add, editor, user } = await mountControls('select');
    await add(100, 100);
    await user.press(radio('Adicionar vértice'));
    await user.press(button('Desfazer'));

    expect(editor().graph.vertices).toStrictEqual([]);
    expect(editor().mode).toBe('add-vertex');
  });
});

describe('ConnectStatus', () => {
  it('só existe no modo Conectar', async () => {
    const { user, add } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);

    expect(screen.queryByTestId('connect-status')).toBeNull();
    await user.press(radio('Conectar'));
    expect(screen.getByTestId('connect-status')).toBeOnTheScreen();
    await user.press(radio('Selecionar'));
    expect(screen.queryByTestId('connect-status')).toBeNull();
  });

  it('sem origem, mostra a instrução para escolher a origem e nenhum botão Cancelar', async () => {
    const { add, user } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));

    expect(screen.getByTestId('connect-status')).toHaveTextContent('Toque em um vértice para escolher a origem da conexão.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('com a origem escolhida: "Origem: A. Toque no vértice de destino." e o botão Cancelar', async () => {
    const { add, user, tapConnect } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));
    await tapConnect(60, 60);

    expect(screen.getByTestId('connect-status')).toHaveTextContent('Origem: A. Toque no vértice de destino.');
    expect(button('Cancelar').props.accessibilityHint).toBe('Cancela a conexão em andamento, sem criar nenhuma aresta');
  });

  it('o botão Cancelar limpa a origem sem mexer no grafo nem no histórico, e avisa que cancelou', async () => {
    const { add, user, tapConnect, editor, store } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));
    await tapConnect(60, 60);
    const antes = editor();
    await user.press(button('Cancelar'));

    expect(store.getState().connection.sourceVertexId).toBeUndefined();
    expect(editor()).toBe(antes);
    expect(screen.getByTestId('connect-status')).toHaveTextContent('Conexão cancelada.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('a conexão criada é anunciada ("entre A e B" no não orientado) e a duplicata, recusada com o motivo', async () => {
    const { add, user, tapConnect } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));
    await tapConnect(60, 60);
    await tapConnect(200, 60);
    expect(screen.getByTestId('connect-status')).toHaveTextContent('Aresta criada entre A e B.');

    await tapConnect(200, 60);
    await tapConnect(60, 60);
    expect(screen.getByTestId('connect-status')).toHaveTextContent(
      'Conexão não criada. Esses dois vértices já estão ligados por uma aresta (no mesmo sentido, se o grafo é orientado).',
    );
  });

  it('é uma região viva e a linha tem a altura do botão Cancelar (nada abaixo do canvas se mexe por causa dele)', async () => {
    const { add, user, tapConnect } = await mountControls('add-vertex');
    await add(60, 60);
    await add(200, 60);
    await user.press(radio('Conectar'));

    expect(screen.getByTestId('connect-status').props.accessibilityLiveRegion).toBe('polite');
    const alturaDoCancelar = 24 + 12 * 2 + 3; // linha, enchimento e borda do botão secundário
    expect(style(screen.getByTestId('connect-status-row')).minHeight).toBe(alturaDoCancelar);
    expect(alturaDoCancelar).toBeGreaterThanOrEqual(minTouchTarget);
    await tapConnect(60, 60); // o Cancelar aparece
    expect(style(screen.getByTestId('connect-status-row')).minHeight).toBe(alturaDoCancelar);
  });
});
