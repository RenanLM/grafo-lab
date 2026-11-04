import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';

import { createGraph } from '@/domain/graph';
import { colors, minTouchTarget } from '@/theme';

import { positionOf, type EditorMode } from './core';
import { type EditorStore } from './editor-store';
import { HistoryBar, ModeBar } from './editor-controls';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';

// Barra de modos e barra de histórico (ver editor-controls.tsx): só despacham ações do núcleo e mostram o estado sem depender
// de cor (marca "✓", contorno tracejado, legenda e estados acessíveis).

const HIDDEN = { includeHiddenElements: true } as const;

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
      <HistoryBar />
    </EditorStoreProvider>,
  );
  const store = stores[0]!;
  const add = async (x: number, y: number) => {
    await act(async () => {
      store.getState().dispatch({ type: 'add-vertex', position: { x, y } });
    });
  };
  const editor = () => store.getState().editor;
  return { store, add, editor, user: userEvent.setup() };
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

  it('Conectar fica desabilitado, com legenda "em breve" e dica, e tocá-lo não faz nada', async () => {
    const { user, editor } = await mountControls('add-vertex');
    const antes = editor();

    expect(radio('Conectar').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByRole('radio', { name: 'Conectar', disabled: true })).toBeOnTheScreen();
    expect(screen.getByText('em breve')).toBeOnTheScreen();
    expect(radio('Conectar').props.accessibilityHint).toBe('Ainda não está disponível');
    await user.press(radio('Conectar'));

    expect(editor()).toBe(antes);
    expect(editor().mode).toBe('add-vertex');
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
