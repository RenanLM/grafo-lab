import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';

import { canvasSize } from './canvas-size';
import { positionOf } from './core';
import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { LabContent } from './lab-screen';

// O toque no canvas de ponta a ponta, sem dispositivo: o gesto (simulado com os utilitários do Gesture Handler 3) chega ao núcleo
// puro (`tapToEditorAction`), a store aplica a ação e a cena é redesenhada. O toque simulado é em dp, local ao canvas. A conferência
// real (toque por `adb`) está em docs/ARCHITECTURE.md.

const HIDDEN = { includeHiddenElements: true } as const;
const mount = (ui: ReactElement) => render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);
const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };
const circles = () => screen.queryAllByTestId(/^vertex-circle-/, HIDDEN).length;
const labelOf = (id: string): string => {
  const [span] = screen.getByTestId(`vertex-label-${id}`, HIDDEN).children;
  return typeof span === 'string' || span === undefined ? '' : String(span.props.content);
};

const NOVO = 'Novo grafo não orientado';

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
  const tapAt = async (x: number, y: number, extra: { absoluteX?: number; absoluteY?: number } = {}) => {
    const controller = createGestureController(getByGestureTestId('canvas-tap'));
    const event = { x, y, ...extra };
    await act(async () => {
      controller.begin(event);
      controller.activate(event);
      controller.end(event);
    });
  };
  const cancelledTap = async (how: 'cancel' | 'fail', x: number, y: number) => {
    const controller = createGestureController(getByGestureTestId('canvas-tap'));
    await act(async () => {
      controller.begin({ x, y });
      if (how === 'cancel') {
        controller.activate({ x, y });
        controller.cancel({ x, y });
      } else {
        controller.fail({ x, y });
      }
    });
  };
  return { store, editor, press, pressMode, measure, tapAt, cancelledTap, user };
}

/** A tela com um grafo novo não orientado, o modo Adicionar vértice (o do Novo grafo) e o canvas medido em 360 dp (360 × 324). */
async function newGraphScreen() {
  const ctx = await setup();
  await ctx.press(NOVO);
  await ctx.measure(360);
  return ctx;
}

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('toque no canvas: criar vértices', () => {
  it('o primeiro toque cria o vértice A, no ponto tocado; a cena e o resumo são atualizados e Desfazer habilita', async () => {
    const { editor, tapAt } = await newGraphScreen();
    await tapAt(120, 90);

    expect(editor().graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]);
    expect(positionOf(editor().layout, 'v1')).toStrictEqual({ x: 120, y: 90 });
    expect(circle('v1')).toMatchObject({ cx: 120, cy: 90, r: 20 }); // o círculo está sob o toque
    expect(labelOf('v1')).toBe('A');
    expect(screen.getByTestId('graph-canvas', HIDDEN).props.accessibilityLabel).toBe(
      'Grafo não orientado com 1 vértice e 0 arestas. O vértice A está isolado.',
    );
    expect(screen.getByRole('button', { name: 'Desfazer' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByText('Toque no espaço para adicionar o primeiro vértice.')).toBeNull();
  });

  it('tocar justamente onde está a mensagem do quadro vazio cria o vértice do mesmo jeito', async () => {
    const { editor, tapAt } = await newGraphScreen();
    expect(screen.getByTestId('canvas-hint')).toBeOnTheScreen();
    await tapAt(180, 162); // o centro do quadro, onde a mensagem é desenhada

    expect(editor().graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]);
    expect(circle('v1')).toMatchObject({ cx: 180, cy: 162 });
  });

  it('o segundo toque cria B; um toque = um vértice e um passo de histórico (nenhuma criação duplicada)', async () => {
    const { editor, tapAt } = await newGraphScreen();
    await tapAt(120, 90);
    expect(editor().history.past).toHaveLength(1);
    await tapAt(240, 200);

    expect(editor().graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }, { id: 'v2', label: 'B' }]);
    expect(editor().history.past).toHaveLength(2);
    expect(circle('v2')).toMatchObject({ cx: 240, cy: 200 });
    expect(circles()).toBe(2);
  });

  it('as coordenadas do toque são as LOCAIS: absoluteX e absoluteY (da tela) não deslocam o vértice', async () => {
    const { tapAt } = await newGraphScreen();
    await tapAt(120, 90, { absoluteX: 500, absoluteY: 1200 });

    expect(circle('v1')).toMatchObject({ cx: 120, cy: 90 });
  });

  it('toques consecutivos criam v1, v2, v3 nas posições tocadas, em dp, sem deslocar os anteriores', async () => {
    const { tapAt } = await newGraphScreen();
    await tapAt(60, 60);
    const primeiro = { ...circle('v1') };
    await tapAt(180, 60);
    await tapAt(300, 60);

    expect(circle('v1')).toStrictEqual(primeiro);
    expect(['v1', 'v2', 'v3'].map((id) => [circle(id).cx, circle(id).cy])).toStrictEqual([[60, 60], [180, 60], [300, 60]]);
    expect(['v1', 'v2', 'v3'].map(labelOf)).toStrictEqual(['A', 'B', 'C']);
  });

  it('o canvas não muda de posição nem de tamanho ao criar vértices', async () => {
    const { tapAt } = await newGraphScreen();
    const antes = screen.getByTestId('graph-canvas', HIDDEN).props.style;
    await tapAt(100, 100);
    await tapAt(200, 100);
    const size = canvasSize(360)!;

    expect(screen.getByTestId('graph-canvas', HIDDEN).props.style).toStrictEqual(antes);
    expect(screen.getByTestId('graph-canvas', HIDDEN).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: size.width, height: size.height })]),
    );
  });
});

describe('toque no canvas: o que NÃO cria vértice', () => {
  it('toque sobre um vértice existente não cria outro (nem passo de histórico)', async () => {
    const { editor, tapAt } = await newGraphScreen();
    await tapAt(120, 90);
    const historico = editor().history;
    await tapAt(125, 92); // a 5,4 dp do centro: dentro do alvo mínimo

    expect(editor().graph.vertices).toHaveLength(1);
    expect(editor().history).toBe(historico);
    expect(circles()).toBe(1);
  });

  it('toque sobre uma aresta existente não cria vértice', async () => {
    const { editor, store, tapAt } = await newGraphScreen();
    await tapAt(120, 90);
    await tapAt(240, 200);
    await act(async () => {
      store.getState().dispatch({ type: 'connect', source: 'v1', target: 'v2' });
    });
    const passos = editor().history.past.length;
    await tapAt(180, 145); // o meio da aresta, longe das áreas dos vértices

    expect(editor().graph.vertices).toHaveLength(2);
    expect(editor().history.past).toHaveLength(passos);
  });

  it('modo Selecionar: tocar no vazio não faz nada; voltar a Adicionar vértice volta a criar', async () => {
    const { editor, pressMode, tapAt } = await newGraphScreen();
    await pressMode('Selecionar');
    await tapAt(100, 100);

    expect(editor().graph.vertices).toHaveLength(0);
    await pressMode('Adicionar vértice');
    await tapAt(100, 100);
    expect(editor().graph.vertices).toHaveLength(1);
  });

  it('Conectar está desabilitado: escolher esse modo não faz nada e o modo ativo continua criando', async () => {
    const { editor, pressMode, tapAt } = await newGraphScreen();
    await pressMode('Conectar');

    expect(editor().mode).toBe('add-vertex');
    await tapAt(100, 100);
    expect(editor().graph.vertices).toHaveLength(1);
  });

  it('toque cancelado (reconhecido e cancelado, ou falho) não cria vértice', async () => {
    const { editor, cancelledTap } = await newGraphScreen();
    await cancelledTap('cancel', 100, 100);
    await cancelledTap('fail', 100, 100);

    expect(editor().graph.vertices).toHaveLength(0);
    expect(editor().history.past).toHaveLength(0);
  });

  it('toque fora do canvas (coordenadas além das bordas) não cria vértice; as bordas contam', async () => {
    const { editor, tapAt } = await newGraphScreen();
    await tapAt(-5, 10);
    await tapAt(361, 10);
    await tapAt(10, -1);
    await tapAt(10, 325);

    expect(editor().graph.vertices).toHaveLength(0);
    await tapAt(0, 0);
    await tapAt(360, 324);
    expect(editor().graph.vertices).toHaveLength(2);
  });

  it('toque antes de o canvas ser medido não faz nada (sem câmera, sem cena) e não quebra', async () => {
    const { editor, press, tapAt } = await setup();
    await press(NOVO); // o quadro aparece, mas o `onLayout` ainda não rodou: sem medida, sem cena
    await tapAt(100, 100);

    expect(editor().graph.vertices).toHaveLength(0);
    expect(editor().history.past).toHaveLength(0);
  });

  // No exemplo a câmera é a ENQUADRADA, que só existe depois da medida: antes dela não há câmera (`undefined`), e passá-la ao núcleo
  // quebraria o toque. O grafo novo não pega esse caso, porque sua câmera neutra existe desde o começo.
  it('exemplo carregado e toque antes de o canvas ser medido: não há câmera enquadrada, nada acontece e nada quebra', async () => {
    const { editor, press, pressMode, tapAt } = await setup();
    await press('Carregar exemplo');
    await pressMode('Adicionar vértice');
    await tapAt(100, 100);

    expect(editor().graph.vertices).toHaveLength(4);
    expect(editor().history.past).toHaveLength(0);
  });
});

describe('toque no canvas: histórico', () => {
  it('A, B, C → Desfazer → novo toque: v4 com o rótulo C (id novo, rótulo reaproveitado); Refazer fica desabilitado', async () => {
    const { editor, press, tapAt } = await newGraphScreen();
    await tapAt(60, 60);
    await tapAt(180, 60);
    await tapAt(300, 60);
    expect(editor().graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v3', 'C']]);
    await press('Desfazer');

    expect(editor().graph.vertices.map((v) => v.id)).toStrictEqual(['v1', 'v2']);
    expect(screen.queryByTestId('vertex-circle-v3', HIDDEN)).toBeNull(); // v3 saiu do desenho
    expect(screen.getByRole('button', { name: 'Refazer' }).props.accessibilityState).toMatchObject({ disabled: false });
    await tapAt(240, 200);

    expect(editor().graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v4', 'C']]);
    expect(circle('v4')).toMatchObject({ cx: 240, cy: 200 });
    expect(labelOf('v4')).toBe('C');
    expect(screen.getByRole('button', { name: 'Refazer' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('Desfazer remove o último vértice criado e Refazer o restaura no mesmo lugar, com o mesmo id', async () => {
    const { editor, press, tapAt } = await newGraphScreen();
    await tapAt(100, 100);
    await tapAt(250, 180);
    await press('Desfazer');

    expect(circles()).toBe(1);
    await press('Refazer');
    expect(circles()).toBe(2);
    expect(editor().graph.vertices[1]).toStrictEqual({ id: 'v2', label: 'B' });
    expect(circle('v2')).toMatchObject({ cx: 250, cy: 180 });
  });

  it('os botões de fora do canvas continuam funcionando entre os toques (o detector não os captura)', async () => {
    const { editor, press, pressMode, tapAt } = await newGraphScreen();
    await tapAt(100, 100);
    await pressMode('Selecionar');
    await pressMode('Adicionar vértice');
    await press('Desfazer');
    await tapAt(150, 150);

    expect(editor().graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v2', 'A']]);
    expect(editor().mode).toBe('add-vertex');
  });
});

describe('toque no canvas: câmera estável e tema', () => {
  it('no exemplo (câmera enquadrada), o novo vértice aparece sob o toque e NADA é reenquadrado', async () => {
    const { editor, press, pressMode, measure, tapAt } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    await pressMode('Adicionar vértice');
    const antes = ['v1', 'v2', 'v3', 'v4'].map((id) => ({ ...circle(id) }));
    await tapAt(40, 290);

    expect(editor().graph.vertices).toHaveLength(5);
    expect(circle('v5').cx).toBeCloseTo(40, 9);
    expect(circle('v5').cy).toBeCloseTo(290, 9);
    expect(['v1', 'v2', 'v3', 'v4'].map((id) => circle(id))).toStrictEqual(antes);
  });

  it('no exemplo, tocar num vértice existente (no modo Adicionar) não cria nada', async () => {
    const { editor, press, pressMode, measure, tapAt } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    await pressMode('Adicionar vértice');
    const { cx, cy } = circle('v1');
    await tapAt(cx, cy);

    expect(editor().graph.vertices).toHaveLength(4);
  });

  it('depois de redimensionar o canvas, o toque usa a câmera e a área NOVAS (o ponto tocado vira o centro do vértice)', async () => {
    const { editor, press, pressMode, measure, tapAt } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    await pressMode('Adicionar vértice');
    await measure(600); // canvas 600 × 420: o enquadramento do exemplo é refeito
    const size = canvasSize(600)!;
    await tapAt(560, size.height - 30); // um ponto que só existe na área nova (x > 360)

    expect(editor().graph.vertices).toHaveLength(5);
    expect(circle('v5').cx).toBeCloseTo(560, 9);
    expect(circle('v5').cy).toBeCloseTo(size.height - 30, 9);
  });

  it('uma área não medida (largura 0) ignora o toque, sem erro', async () => {
    const { editor, press, measure, tapAt } = await setup();
    await press(NOVO);
    await measure(0);
    await tapAt(100, 100);

    expect(editor().graph.vertices).toHaveLength(0);
  });

  it.each(['light', 'dark'] as const)('tema %s: o toque cria o vértice normalmente', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const { editor, tapAt } = await newGraphScreen();
    await tapAt(130, 120);

    expect(editor().graph.vertices).toHaveLength(1);
    expect(circle('v1')).toMatchObject({ cx: 130, cy: 120 });
  });
});
