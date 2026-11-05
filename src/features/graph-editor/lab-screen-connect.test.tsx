import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';
import { colors } from '@/theme';

import { NO_CONNECTION } from './core';
import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { LabContent } from './lab-screen';

// O modo Conectar de ponta a ponta, sem dispositivo: o gesto (simulado com os utilitários do Gesture Handler 3) chega à máquina de
// estados do núcleo, a store guarda a origem pendente e aplica a ação `connect`, e a cena é redesenhada. O toque simulado é em dp,
// local ao canvas. A conferência real (toque por `adb`) está em docs/ARCHITECTURE.md.

const HIDDEN = { includeHiddenElements: true } as const;
const mount = (ui: ReactElement) => render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);

const NOVO = 'Novo grafo não orientado';
const NOVO_ORIENTADO = 'Novo grafo orientado';

// Em um grafo novo (câmera neutra) o ponto tocado é o ponto do mundo: v1 = A, v2 = B, v3 = C
const A = { x: 60, y: 60 };
const B = { x: 200, y: 60 };
const C = { x: 130, y: 200 };
const FUNDO = { x: 320, y: 280 };
const MEIO_A_B = { x: 130, y: 60 };

async function setup() {
  const stores: EditorStore[] = [];
  function Probe() {
    stores.push(useEditorStoreApi());
    return null;
  }
  await mount(
    <EditorStoreProvider initial={{ graph: createGraph({ id: 'laboratorio' }) }}>
      <Probe />
      <LabContent />
    </EditorStoreProvider>,
  );
  const store = stores[0]!;
  const user = userEvent.setup();
  const editor = () => store.getState().editor;
  const press = (name: string) => user.press(screen.getByRole('button', { name }));
  const pressMode = (name: string) => user.press(screen.getByRole('radio', { name }));
  const measure = (width: number) =>
    fireEvent(screen.getByTestId('canvas-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });
  /** Um toque completo no ponto LOCAL (x, y), em dp. */
  const tapAt = async (at: { x: number; y: number }, extra: { absoluteX?: number; absoluteY?: number } = {}) => {
    const controller = createGestureController(getByGestureTestId('canvas-tap'));
    const event = { x: at.x, y: at.y, ...extra };
    await act(async () => {
      controller.begin(event);
      controller.activate(event);
      controller.end(event);
    });
  };
  const gestureOf = (how: 'cancel' | 'fail', at: { x: number; y: number }) => {
    const controller = createGestureController(getByGestureTestId('canvas-tap'));
    return act(async () => {
      controller.begin(at);
      if (how === 'cancel') {
        controller.activate(at);
        controller.cancel(at);
      } else {
        controller.fail(at);
      }
    });
  };
  return { store, editor, press, pressMode, measure, tapAt, gestureOf, user };
}

/** Grafo novo com A, B e C, o canvas medido em 360 dp (360 × 324) e o modo Conectar escolhido. */
async function connectScreen(directed = false) {
  const ctx = await setup();
  await ctx.press(directed ? NOVO_ORIENTADO : NOVO);
  await ctx.measure(360);
  await ctx.tapAt(A);
  await ctx.tapAt(B);
  await ctx.tapAt(C);
  await ctx.pressMode('Conectar');
  return ctx;
}

const status = () => screen.getByTestId('connect-status');
/**
 * A ordem, de cima para baixo, dos elementos que importam para o layout (a árvore é percorrida em ordem de desenho): a barra de modos,
 * o canvas, a linha de estado do Conectar e o Desfazer. A instrução e o Cancelar ficam DEPOIS do canvas; se viessem antes, deslocariam o
 * canvas quando aparecessem e o vértice criado ficaria longe do dedo.
 */
const layoutOrder = () =>
  screen.queryAllByTestId(/^(mode-connect|canvas-area|connect-status-row|history-undo)$/).map((node) => String(node.props.testID));
const LAYOUT_ORDER = ['mode-connect', 'canvas-area', 'connect-status-row', 'history-undo'];
const ring = (id: string) => screen.queryByTestId(`vertex-source-ring-${id}`, HIDDEN);
const edgeIds = () => screen.queryAllByTestId(/^edge-stroke-/, HIDDEN).map((node) => String(node.props.testID).replace('edge-stroke-', ''));
const arrowIds = () => screen.queryAllByTestId(/^edge-arrow-/, HIDDEN).map((node) => String(node.props.testID).replace('edge-arrow-', ''));
const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };
const sourceOf = (store: EditorStore) => store.getState().connection.sourceVertexId;

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('modo Conectar: habilitar', () => {
  it('com menos de dois vértices o botão fica desabilitado; com dois, habilita e escolhê-lo ativa o modo', async () => {
    const { press, pressMode, measure, tapAt, editor } = await setup();
    await press(NOVO);
    await measure(360);
    expect(screen.getByRole('radio', { name: 'Conectar', disabled: true })).toBeOnTheScreen();

    await tapAt(A);
    expect(screen.getByRole('radio', { name: 'Conectar', disabled: true })).toBeOnTheScreen();
    await tapAt(B);
    expect(screen.getByRole('radio', { name: 'Conectar', disabled: false })).toBeOnTheScreen();
    await pressMode('Conectar');

    expect(editor().mode).toBe('connect');
    expect(screen.getByRole('radio', { name: 'Conectar', selected: true })).toBeOnTheScreen();
    expect(status()).toHaveTextContent('Toque em um vértice para escolher a origem da conexão.');
  });

  it('o carregamento do exemplo (4 vértices) já permite escolher Conectar', async () => {
    const { press, pressMode, measure, editor } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    await pressMode('Conectar');

    expect(editor().mode).toBe('connect');
  });
});

describe('modo Conectar: os dois toques', () => {
  it('o primeiro toque destaca a origem (anel), diz "Origem: A. Toque no vértice de destino." e não cria aresta nem histórico', async () => {
    const { tapAt, editor } = await connectScreen();
    const passos = editor().history.past.length;
    await tapAt(A);

    expect(ring('v1')).toBeTruthy();
    expect(ring('v2')).toBeNull();
    expect(status()).toHaveTextContent('Origem: A. Toque no vértice de destino.');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
    expect(edgeIds()).toStrictEqual([]);
    expect(editor().history.past).toHaveLength(passos);
    expect(editor().graph.nextEdgeSeq).toBe(1);
  });

  it('o segundo toque cria a aresta A—B, limpa o destaque, avisa e conta UM passo de histórico', async () => {
    const { tapAt, editor } = await connectScreen();
    const passos = editor().history.past.length;
    await tapAt(A);
    await tapAt(B);

    expect(edgeIds()).toStrictEqual(['e1']);
    expect(editor().graph.edges).toStrictEqual([{ id: 'e1', source: 'v1', target: 'v2' }]);
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(ring('v1')).toBeNull();
    expect(status()).toHaveTextContent('Aresta criada entre A e B.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Desfazer' }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('depois da conexão dá para começar outra (B → C), e a ordem dos toques define origem e destino', async () => {
    const { tapAt, editor } = await connectScreen(true);
    await tapAt(A);
    await tapAt(B);
    await tapAt(C);
    await tapAt(B);

    expect(editor().graph.edges).toStrictEqual([
      { id: 'e1', source: 'v1', target: 'v2' },
      { id: 'e2', source: 'v3', target: 'v2' },
    ]);
  });

  it('a origem é o vértice que o toque acertou, a 23 dp do centro (alvo de 48 dp), e as coordenadas absolutas são ignoradas', async () => {
    const { tapAt, store } = await connectScreen();
    await tapAt({ x: A.x + 23, y: A.y }, { absoluteX: 900, absoluteY: 1500 });

    expect(sourceOf(store)).toBe('v1');
  });
});

describe('modo Conectar: histórico', () => {
  it('Desfazer remove a aresta e Refazer devolve a MESMA aresta; uma conexão nova depois de desfazer usa id novo', async () => {
    const { tapAt, user, editor } = await connectScreen();
    await tapAt(A);
    await tapAt(B);
    await user.press(screen.getByRole('button', { name: 'Desfazer' }));
    expect(edgeIds()).toStrictEqual([]);

    await user.press(screen.getByRole('button', { name: 'Refazer' }));
    expect(edgeIds()).toStrictEqual(['e1']);
    expect(editor().graph.edges).toStrictEqual([{ id: 'e1', source: 'v1', target: 'v2' }]);

    await user.press(screen.getByRole('button', { name: 'Desfazer' }));
    await tapAt(B);
    await tapAt(C);
    expect(edgeIds()).toStrictEqual(['e2']); // o e1 não é reaproveitado
    expect(screen.getByRole('button', { name: 'Refazer' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('desfazer o vértice que é a origem cancela a conexão (o destaque some e o grafo não fica apontando para o que não existe)', async () => {
    const { tapAt, user, store } = await connectScreen();
    await tapAt(C);
    expect(ring('v3')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Desfazer' })); // o último passo do histórico é a criação do v3 (trocar de modo não é passo)

    expect(sourceOf(store)).toBeUndefined();
    expect(ring('v3')).toBeNull();
  });
});

describe('modo Conectar: duplicatas (regra do domínio, mensagem em português)', () => {
  it('não orientado: B—A depois de A—B é recusado; só uma aresta, sem seta, nenhum passo extra e nenhum id gasto', async () => {
    const { tapAt, editor } = await connectScreen(false);
    await tapAt(A);
    await tapAt(B);
    const antes = editor();
    await tapAt(B);
    await tapAt(A);

    expect(edgeIds()).toStrictEqual(['e1']);
    expect(arrowIds()).toStrictEqual([]); // não orientado: aresta sem seta
    expect(editor().graph).toBe(antes.graph);
    expect(editor().graph.nextEdgeSeq).toBe(antes.graph.nextEdgeSeq);
    expect(editor().history).toBe(antes.history);
    expect(ring('v2')).toBeNull(); // a origem é limpa depois da tentativa
    expect(status()).toHaveTextContent(
      'Conexão não criada. Esses dois vértices já estão ligados por uma aresta (no mesmo sentido, se o grafo é orientado).',
    );
  });

  it('orientado: A → B e depois B → A são aceitos (duas curvas distintas, uma seta cada); repetir A → B é recusado', async () => {
    const { tapAt, editor } = await connectScreen(true);
    await tapAt(A);
    await tapAt(B);
    expect(status()).toHaveTextContent('Aresta criada de A para B.');
    await tapAt(B);
    await tapAt(A);
    await tapAt(A);
    await tapAt(B); // duplicata

    expect(edgeIds()).toStrictEqual(['e1', 'e2']);
    expect(arrowIds()).toStrictEqual(['e1', 'e2']);
    const d1 = String(screen.getByTestId('edge-stroke-e1', HIDDEN).props.d);
    const d2 = String(screen.getByTestId('edge-stroke-e2', HIDDEN).props.d);
    expect(d1).toContain(' Q '); // arcos opostos: curvas
    expect(d2).toContain(' Q ');
    expect(d1).not.toBe(d2);
    expect(editor().graph.edges).toHaveLength(2);
    expect(status()).toHaveTextContent(/^Conexão não criada. Esses dois vértices já estão ligados/);
  });

  it('o aviso de erro some quando o aluno começa outra conexão', async () => {
    const { tapAt } = await connectScreen(false);
    await tapAt(A);
    await tapAt(B);
    await tapAt(A);
    await tapAt(B); // recusada
    expect(status()).toHaveTextContent(/^Conexão não criada./);
    await tapAt(C);

    expect(status()).toHaveTextContent('Origem: C. Toque no vértice de destino.');
  });
});

describe('modo Conectar: cancelamentos (nenhum muda o grafo nem cria histórico)', () => {
  it.each([
    ['tocar de novo na própria origem', A],
    ['tocar no fundo do canvas', FUNDO],
  ])('%s', async (_nome, depois) => {
    const { tapAt, editor } = await connectScreen();
    await tapAt(A);
    const antes = editor();
    await tapAt(depois);

    expect(ring('v1')).toBeNull();
    expect(status()).toHaveTextContent('Conexão cancelada.');
    expect(editor()).toBe(antes);
    expect(edgeIds()).toStrictEqual([]);
  });

  it('tocar em uma aresta cancela', async () => {
    const { tapAt, editor } = await connectScreen();
    await tapAt(A);
    await tapAt(B); // cria A—B
    await tapAt(C);
    expect(ring('v3')).toBeTruthy();
    await tapAt(MEIO_A_B);

    expect(ring('v3')).toBeNull();
    expect(status()).toHaveTextContent('Conexão cancelada.');
    expect(editor().graph.edges).toHaveLength(1);
  });

  it('o botão Cancelar limpa a origem e avisa', async () => {
    const { tapAt, user, editor } = await connectScreen();
    await tapAt(A);
    const antes = editor();
    await user.press(screen.getByRole('button', { name: 'Cancelar' }));

    expect(ring('v1')).toBeNull();
    expect(status()).toHaveTextContent('Conexão cancelada.');
    expect(editor()).toBe(antes);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('trocar de modo durante uma conexão pendente a cancela (o destaque e o texto somem)', async () => {
    const { tapAt, pressMode, store } = await connectScreen();
    await tapAt(A);
    await pressMode('Adicionar vértice');

    expect(store.getState().connection).toBe(NO_CONNECTION);
    expect(ring('v1')).toBeNull();
    expect(screen.queryByTestId('connect-status')).toBeNull();
    await pressMode('Conectar');
    expect(ring('v1')).toBeNull(); // e a origem não volta
    expect(status()).toHaveTextContent('Toque em um vértice para escolher a origem da conexão.');
  });

  it('carregar um novo grafo ou o exemplo durante uma conexão pendente a cancela', async () => {
    const { tapAt, press, pressMode, measure, store, editor } = await connectScreen();
    await tapAt(A);
    await press(NOVO_ORIENTADO);

    expect(store.getState().connection).toBe(NO_CONNECTION);
    expect(editor().graph.vertices).toHaveLength(0);
    expect(editor().mode).toBe('add-vertex');
    expect(screen.queryByTestId('connect-status')).toBeNull();

    await measure(360);
    await tapAt(A);
    await tapAt(B);
    await pressMode('Conectar');
    await tapAt(A);
    expect(sourceOf(store)).toBe('v1');
    await press('Carregar exemplo');
    expect(store.getState().connection).toBe(NO_CONNECTION);
    expect(editor().mode).toBe('select');
    expect(editor().graph.vertices).toHaveLength(4);

  });

  it('toque cancelado ou que falhou (um deslize, por exemplo) não escolhe origem nem cria aresta', async () => {
    const { gestureOf, tapAt, store, editor } = await connectScreen();
    await gestureOf('fail', A);
    await gestureOf('cancel', A);
    expect(sourceOf(store)).toBeUndefined();

    await tapAt(A);
    const antes = editor();
    await gestureOf('fail', B);
    await gestureOf('cancel', B);
    expect(sourceOf(store)).toBe('v1'); // a origem continua e nada foi criado
    expect(editor()).toBe(antes);
  });

  it('um toque fora do canvas (além das bordas) não cancela nem escolhe nada', async () => {
    const { tapAt, store } = await connectScreen();
    await tapAt(A);
    await tapAt({ x: 361, y: 100 });
    await tapAt({ x: -2, y: 100 });

    expect(sourceOf(store)).toBe('v1');
  });
});

describe('modo Conectar: o resto do editor continua igual', () => {
  it('o modo Adicionar vértice continua criando vértices sob o toque, depois de conectar', async () => {
    const { tapAt, pressMode, editor } = await connectScreen();
    await tapAt(A);
    await tapAt(B);
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 250 });

    expect(editor().graph.vertices).toHaveLength(4);
    expect(circle('v4')).toMatchObject({ cx: 300, cy: 250 });
    expect(edgeIds()).toStrictEqual(['e1']);
  });

  it('no modo Selecionar o toque não faz nada (a seleção por toque é do 3.8)', async () => {
    const { tapAt, pressMode, editor, store } = await connectScreen();
    await pressMode('Selecionar');
    const antes = editor();
    await tapAt(A);
    await tapAt(B);

    expect(editor()).toBe(antes);
    expect(sourceOf(store)).toBeUndefined();
  });

  it('a câmera enquadrada do exemplo não muda ao conectar: os círculos ficam onde estavam', async () => {
    const { press, measure, pressMode, tapAt } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    const antes = (['v1', 'v2', 'v3', 'v4'] as const).map((id) => circle(id));
    const canvas = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    await pressMode('Conectar');
    const a = antes[0]!;
    const d = antes[3]!;
    await tapAt({ x: a.cx, y: a.cy }); // A
    await tapAt({ x: d.cx, y: d.cy }); // D, o isolado: A → D

    expect((['v1', 'v2', 'v3', 'v4'] as const).map((id) => circle(id))).toStrictEqual(antes);
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(canvas);
    expect(screen.queryAllByTestId(/^edge-stroke-/, HIDDEN)).toHaveLength(5);
    expect(status()).toHaveTextContent('Aresta criada de A para D.');
  });

  it('o toque em um vértice do exemplo ANTES de o canvas ser medido não quebra (não há câmera enquadrada ainda)', async () => {
    const { press, pressMode, tapAt, editor } = await setup();
    await press('Carregar exemplo');
    await pressMode('Conectar');
    await tapAt({ x: 100, y: 100 });

    expect(editor().graph.edges).toHaveLength(4);
  });
});

describe('modo Conectar: o canvas não se desloca', () => {
  it('a instrução e o botão Cancelar ficam DEPOIS do canvas, e nada antes dele muda quando a origem é escolhida', async () => {
    const { tapAt } = await connectScreen();
    const barra = () => StyleSheet.flatten(screen.getByLabelText('Modo de edição').props.style);
    const canvasStyle = () => StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    const antes = { barra: barra(), canvas: canvasStyle() };
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER); // a linha de estado vem DEPOIS do canvas

    await tapAt(A); // aparecem o destaque, a instrução e o Cancelar
    expect(barra()).toStrictEqual(antes.barra);
    expect(canvasStyle()).toStrictEqual(antes.canvas);
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    expect(StyleSheet.flatten(screen.getByTestId('connect-status-row').props.style).minHeight).toBe(51); // a do botão Cancelar

    await tapAt(B); // some o Cancelar, aparece o aviso
    expect(barra()).toStrictEqual(antes.barra);
    expect(canvasStyle()).toStrictEqual(antes.canvas);
  });

  it('a barra de modos tem a mesma altura mínima antes e depois de o segundo vértice habilitar o Conectar', async () => {
    const { press, measure, tapAt } = await setup();
    await press(NOVO);
    await measure(360);
    const altura = () => StyleSheet.flatten(screen.getByLabelText('Modo de edição').props.style).minHeight;
    await tapAt(A);
    const com = altura();
    await tapAt(B); // o Conectar deixa de ter a legenda
    const sem = altura();

    expect(com).toBeGreaterThan(0);
    expect(sem).toBe(com);
  });
});

describe('modo Conectar: temas', () => {
  it.each(['light', 'dark'] as const)('tema %s: o anel da origem e o texto de estado aparecem', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const { tapAt } = await connectScreen();
    await tapAt(A);

    const stroke = screen.getByTestId('vertex-source-ring-v1', HIDDEN).props.stroke as { payload: number };
    expect(stroke.payload >>> 0).toBe((0xff000000 | parseInt(colors[scheme].primary.slice(1), 16)) >>> 0);
    expect(status()).toHaveTextContent('Origem: A. Toque no vértice de destino.');
    expect(screen.getByRole('radio', { name: 'Conectar', selected: true })).toBeOnTheScreen();
  });
});
