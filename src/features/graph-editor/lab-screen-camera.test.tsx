import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';

import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { recordGestureStateRequests, sendTouches } from './gesture-test-helpers';
import { LabContent } from './lab-screen';
import { positionOf, type EditorAction, type Point } from './core';

// Câmera, de ponta a ponta e sem dispositivo (incremento 3.10): os botões Centralizar e Ajustar ao grafo, a política da câmera depois de cada operação e o hit-testing com a câmera
// nova. Nenhum destes comandos pode mexer no grafo, no layout nem no histórico. A câmera não é lida de dentro: é conferida pelo que está DESENHADO (o centro e o raio dos círculos).
// Os gestos (pan e pinça) têm o seu bloco no fim do arquivo.

const HIDDEN = { includeHiddenElements: true } as const;
const mount = (ui: ReactElement) => render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);
const NOVO = 'Novo grafo não orientado';
const NOVO_ORIENTADO = 'Novo grafo orientado';

let recorder: ReturnType<typeof recordGestureStateRequests>;
beforeEach(() => {
  recorder = recordGestureStateRequests();
});
afterEach(() => {
  recorder.restore();
});

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
  const tapAt = async (at: Point) => {
    const controller = createGestureController(getByGestureTestId('canvas-tap'));
    await act(async () => {
      controller.begin({ x: at.x, y: at.y });
      controller.activate({ x: at.x, y: at.y });
      controller.end({ x: at.x, y: at.y });
    });
  };
  const dispatch = (action: EditorAction) =>
    act(async () => {
      store.getState().dispatch(action);
    });
  /**
   * Um dedo que desce em `from` e anda em linha reta até `to` em `steps` passos, pelo MESMO protocolo do aparelho: o pan desce (`begin`), os eventos de toque chegam, o JavaScript decide e pede
   * a ativação, o "módulo nativo" ativa (`activate`) e os passos seguintes viram `update`. A `translationX/Y` imita a do aparelho (nasce na ATIVAÇÃO); o código usa a posição local (`x`, `y`).
   * `finish`: `release` (o dedo sobe), `cancel` (o sistema cancela) ou `hold` (o dedo fica; o teste decide o resto). Devolve se o pan ativou, quanto o dedo andou DEPOIS da ativação (`moved`: é o
   * que a câmera, ou o vértice, acompanha) e o controlador, para o teste continuar o gesto.
   */
  const dragFinger = async (from: Point, to: Point, { finish = 'release' as 'release' | 'cancel' | 'hold', steps = 4 } = {}) => {
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    const before = recorder.requests.mock.calls.length;
    let activated = false;
    let activatedAt: Point | undefined;
    const at = (k: number): Point => ({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
    const event = (k: number) => ({
      x: at(k).x,
      y: at(k).y,
      translationX: at(k).x - (activatedAt ?? from).x,
      translationY: at(k).y - (activatedAt ?? from).y,
    });
    await act(async () => {
      pan.begin({ x: from.x, y: from.y });
    });
    for (let k = 1; k <= steps; k++) {
      await sendTouches('canvas-pan', 'move', at(k));
      if (!activated && recorder.requests.mock.calls.length > before) {
        activated = true;
        activatedAt = at(k);
        await act(async () => {
          pan.activate(event(k));
        });
      }
      if (activated) {
        await act(async () => {
          pan.update(event(k));
        });
      }
    }
    const moved: Point = activatedAt === undefined ? { x: 0, y: 0 } : { x: to.x - activatedAt.x, y: to.y - activatedAt.y };
    if (finish !== 'hold') {
      await act(async () => {
        if (!activated) pan.fail(event(steps));
        else if (finish === 'release') pan.end(event(steps));
        else pan.cancel(event(steps));
      });
    }
    return { activated, moved, pan, last: event(steps) };
  };

  /**
   * Dois dedos que fazem a pinça: o foco anda de `from` até `to` em linha reta e a escala ACUMULADA vai de 1 até `scale` em `steps` passos (a escala nativa nasce em 1 na ativação). `finish`:
   * `end` (os dedos sobem), `cancel` ou `hold`. `scaleChange` é enviado mas nunca usado pelo código (só a acumulada vale).
   */
  const pinchFingers = async (from: Point, to: Point, scale: number, { finish = 'end' as 'end' | 'cancel' | 'hold', steps = 4 } = {}) => {
    const pinch = createGestureController(getByGestureTestId('canvas-pinch'));
    const focal = (k: number): Point => ({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
    const accumulated = (k: number): number => 1 + ((scale - 1) * k) / steps;
    await act(async () => {
      pinch.begin({ focalX: from.x, focalY: from.y });
      pinch.activate({ focalX: from.x, focalY: from.y, scale: 1, scaleChange: 1 });
    });
    for (let k = 1; k <= steps; k++) {
      await act(async () => {
        pinch.update({ focalX: focal(k).x, focalY: focal(k).y, scale: accumulated(k), scaleChange: accumulated(k) / accumulated(k - 1), numberOfPointers: 2 });
      });
    }
    if (finish !== 'hold') {
      await act(async () => {
        if (finish === 'end') pinch.end({ focalX: to.x, focalY: to.y, scale, scaleChange: 1 });
        else pinch.cancel({ focalX: to.x, focalY: to.y, scale, scaleChange: 1 });
      });
    }
    return { pinch };
  };
  return { store, editor, press, pressMode, measure, tapAt, dispatch, dragFinger, pinchFingers, user };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Grafo novo não orientado com A, B e C criados por toque (câmera neutra: ponto tocado = ponto do mundo), canvas de 360 dp (altura 324), e as arestas A—B e B—C. */
async function threeVertices(directed = false): Promise<Ctx> {
  const ctx = await setup();
  await ctx.press(directed ? NOVO_ORIENTADO : NOVO);
  await ctx.measure(360);
  await ctx.tapAt({ x: 60, y: 80 });
  await ctx.tapAt({ x: 190, y: 60 });
  await ctx.tapAt({ x: 130, y: 220 });
  await ctx.pressMode('Conectar');
  await ctx.tapAt({ x: 60, y: 80 });
  await ctx.tapAt({ x: 190, y: 60 });
  await ctx.tapAt({ x: 190, y: 60 });
  await ctx.tapAt({ x: 130, y: 220 });
  await ctx.pressMode('Selecionar');
  return ctx;
}

const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };
const scaleOf = (): number => circle('v1').r / 20;
const layoutOrder = () =>
  screen.queryAllByTestId(/^(mode-select|canvas-area|camera-center|camera-fit|selection-status-row|history-undo)$/).map((node) => String(node.props.testID));
const notice = () => screen.queryByTestId('camera-notice');
const position = (store: EditorStore, id: string) => positionOf(store.getState().editor.layout, id);
const CANVAS = { width: 360, height: 324 };

describe('Câmera: os botões e o que eles NÃO tocam', () => {
  it('Centralizar e Ajustar ao grafo ficam ABAIXO do canvas e ACIMA do histórico, acessíveis por papel e nome', async () => {
    await threeVertices();

    expect(layoutOrder()).toStrictEqual(['mode-select', 'canvas-area', 'camera-center', 'camera-fit', 'selection-status-row', 'history-undo']);
    expect(screen.getByRole('button', { name: 'Centralizar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ajustar ao grafo' })).toBeOnTheScreen();
  });

  it('Centralizar mantém o zoom e leva o centro do conteúdo ao centro do quadro (o conteúdo de A, B e C ocupa x de 40 a 210 e y de 40 a 240: centro em (125, 140))', async () => {
    const { press } = await threeVertices();
    await press('Centralizar');
    const centers = ['v1', 'v2', 'v3'].map(circle);
    const minX = Math.min(...centers.map((c) => c.cx - c.r));
    const maxX = Math.max(...centers.map((c) => c.cx + c.r));
    const minY = Math.min(...centers.map((c) => c.cy - c.r));
    const maxY = Math.max(...centers.map((c) => c.cy + c.r));

    expect(scaleOf()).toBe(1);
    expect((minX + maxX) / 2).toBeCloseTo(CANVAS.width / 2, 6);
    expect((minY + maxY) / 2).toBeCloseTo(CANVAS.height / 2, 6);
    // o conteúdo todo se deslocou o MESMO tanto: A passou de (60, 80) para (60 + 55, 80 + 22)
    expect(circle('v1').cx).toBeCloseTo(115, 6);
    expect(circle('v1').cy).toBeCloseTo(102, 6);
  });

  it('Centralizar DEPOIS de ampliar mantém o zoom atual (não volta à câmera neutra): a escala continua 2 e o centro do conteúdo vai ao centro do quadro', async () => {
    const { press, pinchFingers } = await threeVertices();
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 2);
    await press('Centralizar');
    const centers = ['v1', 'v2', 'v3'].map(circle);
    const minX = Math.min(...centers.map((c) => c.cx - c.r));
    const maxX = Math.max(...centers.map((c) => c.cx + c.r));
    const minY = Math.min(...centers.map((c) => c.cy - c.r));
    const maxY = Math.max(...centers.map((c) => c.cy + c.r));

    expect(scaleOf()).toBe(2);
    expect((minX + maxX) / 2).toBeCloseTo(CANVAS.width / 2, 6);
    expect((minY + maxY) / 2).toBeCloseTo(CANVAS.height / 2, 6);
  });

  it('Centralizar e Ajustar não alteram o grafo, o layout nem o histórico (os mesmos objetos, nenhum passo novo)', async () => {
    const { press, editor } = await threeVertices();
    const { graph, layout, history } = editor();
    await press('Centralizar');
    await press('Ajustar ao grafo');
    await press('Centralizar');

    expect(editor().graph).toBe(graph);
    expect(editor().layout).toBe(layout);
    expect(editor().history.past).toHaveLength(history.past.length);
    expect(editor().history.future).toHaveLength(0);
  });

  it('Ajustar ao grafo enquadra com margem de 24 dp: todo círculo fica dentro do quadro e o conteúdo é centrado', async () => {
    const { press, dispatch } = await threeVertices();
    await dispatch({ type: 'move-vertex', vertexId: 'v1', position: { x: 10, y: 10 } });
    await dispatch({ type: 'move-vertex', vertexId: 'v3', position: { x: 300, y: 250 } });
    await press('Ajustar ao grafo');
    const circles = ['v1', 'v2', 'v3'].map(circle);
    const minX = Math.min(...circles.map((c) => c.cx - c.r));
    const maxX = Math.max(...circles.map((c) => c.cx + c.r));
    const minY = Math.min(...circles.map((c) => c.cy - c.r));
    const maxY = Math.max(...circles.map((c) => c.cy + c.r));

    expect(minX).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(maxX).toBeLessThanOrEqual(CANVAS.width - 24 + 1e-6);
    expect(minY).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(maxY).toBeLessThanOrEqual(CANVAS.height - 24 + 1e-6);
    expect((minX + maxX) / 2).toBeCloseTo(CANVAS.width / 2, 6);
    expect((minY + maxY) / 2).toBeCloseTo(CANVAS.height / 2, 6);
    // o lado que limita toca a área útil: a largura (ou a altura) do conteúdo vale 312 (ou 276) dp
    expect(Math.max(maxX - minX - (CANVAS.width - 48), maxY - minY - (CANVAS.height - 48))).toBeCloseTo(0, 6);
  });

  it('Ajustar ao grafo pode mudar o zoom; o aviso só aparece quando o zoom mínimo não basta', async () => {
    const { press, dispatch } = await threeVertices();
    await press('Ajustar ao grafo');
    expect(scaleOf()).not.toBe(1);
    expect(notice()).toBeNull(); // coube

    await dispatch({ type: 'move-vertex', vertexId: 'v3', position: { x: 4000, y: 0 } });
    await press('Ajustar ao grafo');

    expect(scaleOf()).toBe(0.25); // o limite mínimo, que nunca é desrespeitado
    expect(notice()).toBeTruthy();
    expect(screen.getByTestId('camera-notice')).toHaveTextContent(/O grafo é maior que o quadro no zoom mínimo/);
  });

  it('o aviso some sozinho quando a câmera muda por outro comando (Centralizar) ou quando começa outro grafo', async () => {
    const { press, dispatch } = await threeVertices();
    await dispatch({ type: 'move-vertex', vertexId: 'v3', position: { x: 4000, y: 0 } });
    await press('Ajustar ao grafo');
    expect(notice()).toBeTruthy();
    await press('Centralizar');
    expect(notice()).toBeNull();

    await press('Ajustar ao grafo');
    expect(notice()).toBeTruthy();
    await press(NOVO);
    expect(notice()).toBeNull();
  });

  it('Centralizar com o grafo vazio usa a câmera neutra: depois dele, tocar cria o vértice exatamente onde se tocou', async () => {
    const { press, pressMode, dispatch, tapAt } = await threeVertices();
    await press('Ajustar ao grafo'); // câmera fora da neutra
    for (const id of ['v1', 'v2', 'v3']) {
      await dispatch({ type: 'select', selection: { type: 'vertex', vertexId: id } });
      await dispatch({ type: 'remove-selection' });
    }
    await press('Centralizar');
    await pressMode('Adicionar vértice');
    await tapAt({ x: 100, y: 100 });
    const created = screen.queryAllByTestId(/^vertex-circle-/, HIDDEN)[0]!.props as { cx: number; cy: number; r: number };

    expect(created).toMatchObject({ cx: 100, cy: 100, r: 20 });
  });

  it('desfazer e refazer não mudam a câmera: um vértice que não foi tocado fica no mesmo lugar e com o mesmo tamanho', async () => {
    const { press, dispatch } = await threeVertices();
    await press('Ajustar ao grafo');
    const before = { ...circle('v2') };
    await dispatch({ type: 'move-vertex', vertexId: 'v1', position: { x: 500, y: 500 } });
    await press('Desfazer');
    await press('Refazer');
    await press('Desfazer');

    expect(circle('v2')).toStrictEqual(before);
  });

  it('adicionar, conectar, selecionar e editar não mudam a câmera', async () => {
    const { press, pressMode, tapAt, dispatch } = await threeVertices();
    await press('Ajustar ao grafo');
    const before = { ...circle('v2') };
    const v1 = circle('v1');
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 40 });
    await pressMode('Selecionar');
    await tapAt({ x: v1.cx, y: v1.cy });
    await dispatch({ type: 'set-label', vertexId: 'v1', label: 'Início' });

    expect(circle('v2')).toStrictEqual(before);
  });

  it('o layout da tela não salta ao usar os botões: a ordem e o estilo do canvas continuam', async () => {
    const { press } = await threeVertices();
    const order = layoutOrder();
    const style = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    await press('Centralizar');
    await press('Ajustar ao grafo');

    expect(layoutOrder()).toStrictEqual(order);
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(style);
  });

  it('Novo grafo e Carregar exemplo começam outra sessão: a câmera do grafo anterior não vale', async () => {
    const { press, tapAt, pressMode } = await threeVertices();
    await press('Ajustar ao grafo');
    expect(scaleOf()).not.toBe(1);
    await press(NOVO);
    await tapAt({ x: 100, y: 100 });
    expect(circle('v1')).toMatchObject({ cx: 100, cy: 100, r: 20 }); // neutra

    await press('Carregar exemplo');
    expect(screen.queryAllByTestId(/^vertex-circle-/, HIDDEN)).toHaveLength(4);
    await pressMode('Selecionar');
  });
});

describe('Câmera: os toques depois de um zoom acertam', () => {
  it('Adicionar vértice depois de Ajustar cria o vértice sob o dedo, e a posição no MUNDO é a convertida pela câmera (o círculo aparece exatamente onde se tocou)', async () => {
    const { press, pressMode, tapAt, store } = await threeVertices();
    await press('Ajustar ao grafo');
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 40 });
    const created = circle('v4');

    expect(created.cx).toBeCloseTo(300, 6);
    expect(created.cy).toBeCloseTo(40, 6);
    expect(created.r).toBeCloseTo(20 * scaleOf(), 9);
    // no mundo: o ponto está à direita e acima do que já existia, nunca no ponto de tela
    const world = position(store, 'v4')!;
    expect(world.x).not.toBe(300);
    expect(store.getState().editor.graph.vertices).toHaveLength(4);
  });

  it('Conectar depois de Ajustar escolhe os vértices certos (origem e destino pelo toque na tela)', async () => {
    const { press, pressMode, tapAt, editor } = await threeVertices();
    await press('Ajustar ao grafo');
    await pressMode('Conectar');
    const v1 = circle('v1');
    const v3 = circle('v3');
    await tapAt({ x: v1.cx, y: v1.cy });
    await tapAt({ x: v3.cx, y: v3.cy });

    const edge = editor().graph.edges.at(-1)!;
    expect([edge.source, edge.target]).toStrictEqual(['v1', 'v3']);
    expect(editor().graph.edges).toHaveLength(3);
  });

  it('Selecionar depois de Ajustar identifica o elemento certo: o vértice e a aresta', async () => {
    const { press, tapAt, editor } = await threeVertices();
    await press('Ajustar ao grafo');
    const v2 = circle('v2');
    await tapAt({ x: v2.cx, y: v2.cy });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v2' });

    const a = circle('v1');
    const b = circle('v2');
    await tapAt({ x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 });
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
  });

  it('Arrastar um vértice depois de Ajustar preserva o grab offset: o centro anda exatamente o que o dedo andou, em dp, com o zoom que for', async () => {
    const { press, dragFinger, store } = await threeVertices();
    await press('Ajustar ao grafo');
    const v3 = circle('v3');
    const before = position(store, 'v3')!;
    const s = scaleOf();
    await dragFinger({ x: v3.cx + 6, y: v3.cy - 4 }, { x: v3.cx + 6 + 40, y: v3.cy - 4 + 30 });
    const after = circle('v3');

    expect(after.cx - v3.cx).toBeCloseTo(40, 6);
    expect(after.cy - v3.cy).toBeCloseTo(30, 6);
    const world = position(store, 'v3')!;
    expect(world.x - before.x).toBeCloseTo(40 / s, 6); // no mundo: o deslocamento em dp dividido pela escala
    expect(world.y - before.y).toBeCloseTo(30 / s, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// GESTOS (3.10): o pan de um dedo no fundo e a pinça de dois dedos, de ponta a ponta com o gesto simulado pelo protocolo do aparelho. O que o Jest NÃO mostra (a negociação com o ScrollView
// nativo, o atraso do JavaScript, a ordem real dos eventos do segundo dedo) foi conferido no emulador (docs/ARCHITECTURE.md).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Circle = { cx: number; cy: number; r: number };
const IDS = ['v1', 'v2', 'v3'] as const;
const circles = (): Record<(typeof IDS)[number], Circle> => ({ v1: { ...circle('v1') }, v2: { ...circle('v2') }, v3: { ...circle('v3') } });
const BACKGROUND = { x: 320, y: 280 }; // longe de qualquer vértice e de qualquer aresta de `threeVertices`
const MIDDLE_A_B = { x: 125, y: 70 }; // o meio da aresta A—B: longe dos dois vértices
const SMALL_PAN = { x: 300, y: 220 }; // um pan curto a partir do fundo: os três vértices continuam dentro do quadro

/** A propriedade `scrollEnabled` do ScrollView da página (o ancestral nativo do canvas); `undefined` e `true` são rolável. */
function pageScrollEnabled(): boolean | undefined {
  for (let node = screen.getByTestId('canvas-area').parent; node !== null; node = node.parent) {
    if (String(node.type) === 'RCTScrollView') return node.props.scrollEnabled as boolean | undefined;
  }
  throw new Error('o canvas não está dentro de um ScrollView');
}

/** Todos os círculos andaram `shift` na tela, sem mudar de tamanho? */
function expectAllMoved(before: ReturnType<typeof circles>, shift: Point): void {
  const after = circles();
  for (const id of IDS) {
    expect(after[id].cx - before[id].cx).toBeCloseTo(shift.x, 6);
    expect(after[id].cy - before[id].cy).toBeCloseTo(shift.y, 6);
    expect(after[id].r).toBeCloseTo(before[id].r, 9);
  }
}

describe('Câmera: pan de um dedo no fundo', () => {
  it('um toque curto no fundo NÃO dispara o pan: a câmera continua e nenhuma ativação é pedida', async () => {
    const { tapAt } = await threeVertices();
    const before = circles();
    await tapAt(BACKGROUND);

    expect(circles()).toStrictEqual(before);
    expect(recorder.requests).not.toHaveBeenCalled();
  });

  it('deslizar no fundo move a câmera: todos os vértices andam o que o dedo andou DEPOIS do reconhecimento, e nada mais muda (grafo, layout, histórico, zoom)', async () => {
    const { dragFinger, editor } = await threeVertices();
    const { graph, layout, history } = editor();
    const before = circles();
    const { activated, moved } = await dragFinger(BACKGROUND, { x: 280, y: 160 });

    expect(activated).toBe(true);
    expect(moved.x).not.toBe(0);
    expectAllMoved(before, moved);
    expect(editor().graph).toBe(graph);
    expect(editor().layout).toBe(layout);
    expect(editor().history.past).toHaveLength(history.past.length);
  });

  it('as arestas e os pesos acompanham: o traço de A—B anda o mesmo deslocamento que os vértices', async () => {
    const { dragFinger } = await threeVertices();
    const stroke = () => screen.getByTestId('edge-stroke-e1', HIDDEN).props as { x1: number; y1: number; x2: number; y2: number };
    const before = { ...stroke() };
    const { moved } = await dragFinger(BACKGROUND, { x: 300, y: 200 });

    expect(stroke().x1 - before.x1).toBeCloseTo(moved.x, 6);
    expect(stroke().y2 - before.y2).toBeCloseTo(moved.y, 6);
  });

  it('o pan acompanha o dedo ENQUANTO ele anda e o quadro não salta ao reconhecer: com o dedo parado logo depois do limiar, nada se deslocou', async () => {
    const { dragFinger } = await threeVertices();
    const before = circles();
    const { activated, moved } = await dragFinger(BACKGROUND, { x: BACKGROUND.x, y: BACKGROUND.y - 18 }, { steps: 1, finish: 'hold' });

    expect(activated).toBe(true);
    expect(moved).toStrictEqual({ x: 0, y: 0 }); // o deslocamento é medido a partir do ponto da ativação
    expect(circles()).toStrictEqual(before);
  });

  it('o mundo não muda: a posição de cada vértice no layout continua a mesma depois de mover a câmera', async () => {
    const { dragFinger, store } = await threeVertices();
    const worlds = IDS.map((id) => ({ ...position(store, id)! }));
    await dragFinger(BACKGROUND, { x: 200, y: 100 });

    expect(IDS.map((id) => position(store, id))).toStrictEqual(worlds);
  });

  it('o pan não mexe no zoom: o raio dos círculos é o mesmo', async () => {
    const { dragFinger } = await threeVertices();
    await dragFinger(BACKGROUND, { x: 100, y: 100 });

    expect(scaleOf()).toBe(1);
  });

  it('um pan cancelado PRESERVA a câmera (não restaura a posição inicial)', async () => {
    const { dragFinger } = await threeVertices();
    const before = circles();
    const { moved } = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'cancel' });

    expectAllMoved(before, moved);
    expect(moved.x).not.toBe(0);
  });

  it('o ScrollView da página nunca é desligado, durante nem depois do pan', async () => {
    const { dragFinger } = await threeVertices();
    expect(pageScrollEnabled()).not.toBe(false);
    await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    expect(pageScrollEnabled()).not.toBe(false);
  });

  it('a rolagem fora do canvas continua acessível: Centralizar, Ajustar e Desfazer ficam FORA do canvas, dentro do ScrollView da página', async () => {
    await threeVertices();
    for (const id of ['camera-center', 'camera-fit', 'history-undo']) {
      const ancestors: string[] = [];
      let insideCanvas = false;
      for (let node = screen.getByTestId(id).parent; node !== null; node = node.parent) {
        ancestors.push(String(node.type));
        if (node.props.testID === 'canvas-area') insideCanvas = true;
      }

      expect(insideCanvas).toBe(false);
      expect(ancestors).toContain('RCTScrollView');
    }
  });

  it('as ações do editor continuam disponíveis depois de mover a câmera: Desfazer, Centralizar e os modos respondem', async () => {
    const { dragFinger, press, pressMode, editor } = await threeVertices();
    await dragFinger(BACKGROUND, { x: 250, y: 120 });
    await press('Desfazer');
    expect(editor().history.future).toHaveLength(1);
    await press('Refazer');
    await pressMode('Adicionar vértice');
    await press('Centralizar');
    expect(screen.getByRole('radio', { name: 'Adicionar vértice' })).toBeOnTheScreen();
  });
});

describe('Câmera: quem é o dono do deslize', () => {
  it('um deslize sobre um vértice em Selecionar ARRASTA O VÉRTICE e não move a câmera: só a posição dele muda, e entra um passo de histórico', async () => {
    const { dragFinger, store, editor } = await threeVertices();
    const before = circles();
    const worldBefore = { ...position(store, 'v3')! };
    const past = editor().history.past.length;
    await dragFinger({ x: before.v3.cx + 5, y: before.v3.cy - 3 }, { x: before.v3.cx + 5 + 40, y: before.v3.cy - 3 + 30 });

    const after = circles();
    expect(after.v1).toStrictEqual(before.v1); // a câmera NÃO se mexeu: os outros vértices ficaram
    expect(after.v2).toStrictEqual(before.v2);
    expect(after.v3.cx - before.v3.cx).toBeCloseTo(40, 6);
    expect(after.v3.cy - before.v3.cy).toBeCloseTo(30, 6);
    expect(editor().history.past).toHaveLength(past + 1);
    expect(position(store, 'v3')).not.toStrictEqual(worldBefore);
  });

  it('um deslize sobre o fundo NÃO move nenhum vértice no layout nem cria prévia de arrasto', async () => {
    const { dragFinger, store, editor } = await threeVertices();
    const layout = editor().layout;
    const { activated } = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });

    expect(activated).toBe(true);
    expect(editor().layout).toBe(layout);
    expect(position(store, 'v1')).toStrictEqual({ x: 60, y: 80 });
  });

  it('um deslize sobre uma ARESTA não faz nada: nenhuma ativação, a câmera e os vértices ficam, e a rolagem da página fica livre', async () => {
    const { dragFinger, editor } = await threeVertices();
    const before = circles();
    const layout = editor().layout;
    const { activated } = await dragFinger(MIDDLE_A_B, { x: 125, y: 190 });

    expect(activated).toBe(false);
    expect(recorder.requests).not.toHaveBeenCalled();
    expect(circles()).toStrictEqual(before);
    expect(editor().layout).toBe(layout);
  });

  it('em Adicionar vértice: o fundo move a câmera; um vértice não inicia pan nenhum; e nada é criado', async () => {
    const { dragFinger, pressMode, editor } = await threeVertices();
    await pressMode('Adicionar vértice');
    const graph = editor().graph;
    const before = circles();
    const onVertex = await dragFinger({ x: before.v1.cx, y: before.v1.cy }, { x: before.v1.cx + 80, y: before.v1.cy + 40 });
    expect(onVertex.activated).toBe(false);
    expect(circles()).toStrictEqual(before);

    const onBackground = await dragFinger(BACKGROUND, { x: 250, y: 120 });
    expect(onBackground.activated).toBe(true);
    expectAllMoved(before, onBackground.moved);
    expect(editor().graph).toBe(graph);
  });

  it('em Conectar: o fundo move a câmera; um vértice não inicia pan nem escolhe origem; nenhuma aresta nasce', async () => {
    const { dragFinger, pressMode, editor, store } = await threeVertices();
    await pressMode('Conectar');
    const edges = editor().graph.edges;
    const before = circles();
    const onVertex = await dragFinger({ x: before.v3.cx, y: before.v3.cy }, { x: before.v3.cx + 90, y: before.v3.cy });
    expect(onVertex.activated).toBe(false);

    const onBackground = await dragFinger(BACKGROUND, { x: 250, y: 120 });
    expect(onBackground.activated).toBe(true);
    expect(editor().graph.edges).toBe(edges);
    expect(store.getState().connection.sourceVertexId).toBeUndefined();
  });

  it('o pan da câmera nunca cria histórico: Desfazer continua refletindo só as edições', async () => {
    const { dragFinger, editor } = await threeVertices();
    const past = editor().history.past.length;
    await dragFinger(BACKGROUND, { x: 250, y: 120 });
    await dragFinger(BACKGROUND, { x: 50, y: 250 });

    expect(editor().history.past).toHaveLength(past);
    expect(editor().history.future).toHaveLength(0);
  });
});

describe('Câmera: os toques depois de um pan acertam (hit-testing com a câmera nova)', () => {
  it('Adicionar vértice depois do pan cria o vértice sob o dedo: o círculo aparece exatamente onde se tocou, e no mundo ele ficou deslocado do ponto de tela', async () => {
    const { dragFinger, pressMode, tapAt, store } = await threeVertices();
    const { moved } = await dragFinger(BACKGROUND, { x: 250, y: 120 });
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 250 });

    expect(circle('v4').cx).toBeCloseTo(300, 6);
    expect(circle('v4').cy).toBeCloseTo(250, 6);
    expect(position(store, 'v4')!.x).toBeCloseTo(300 - moved.x, 6); // câmera deslocada: o mundo é o ponto de tela menos a translação
    expect(position(store, 'v4')!.y).toBeCloseTo(250 - moved.y, 6);
  });

  it('Selecionar depois do pan identifica o vértice e a aresta pela posição NOVA na tela (o ponto antigo já é fundo)', async () => {
    const { dragFinger, tapAt, editor } = await threeVertices();
    const old = circles();
    await dragFinger(BACKGROUND, SMALL_PAN);
    const now = circles();
    await tapAt({ x: old.v1.cx, y: old.v1.cy }); // onde A ESTAVA: agora é fundo (a distância até onde A está é grande)
    expect(editor().selection).toStrictEqual({ type: 'none' });

    await tapAt({ x: now.v1.cx, y: now.v1.cy });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });

    await tapAt({ x: (now.v1.cx + now.v2.cx) / 2, y: (now.v1.cy + now.v2.cy) / 2 });
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
  });

  it('Conectar depois do pan escolhe os vértices certos', async () => {
    const { dragFinger, pressMode, tapAt, editor } = await threeVertices();
    await dragFinger(BACKGROUND, SMALL_PAN);
    await pressMode('Conectar');
    const now = circles();
    await tapAt({ x: now.v1.cx, y: now.v1.cy });
    await tapAt({ x: now.v3.cx, y: now.v3.cy });

    const edge = editor().graph.edges.at(-1)!;
    expect([edge.source, edge.target]).toStrictEqual(['v1', 'v3']);
  });

  it('Arrastar um vértice depois do pan preserva o grab offset: o centro anda exatamente o que o dedo andou', async () => {
    const { dragFinger } = await threeVertices();
    await dragFinger(BACKGROUND, SMALL_PAN);
    const before = circles();
    await dragFinger({ x: before.v2.cx + 6, y: before.v2.cy + 4 }, { x: before.v2.cx + 6 + 25, y: before.v2.cy + 4 + 35 });

    expect(circle('v2').cx - before.v2.cx).toBeCloseTo(25, 6);
    expect(circle('v2').cy - before.v2.cy).toBeCloseTo(35, 6);
    expect(circle('v1')).toStrictEqual(before.v1);
  });

  it('desfazer e refazer depois do pan não mudam a câmera', async () => {
    const { dragFinger, press, dispatch } = await threeVertices();
    await dispatch({ type: 'move-vertex', vertexId: 'v1', position: { x: 10, y: 10 } });
    await dragFinger(BACKGROUND, { x: 250, y: 120 });
    const before = { ...circle('v2') };
    await press('Desfazer');
    await press('Refazer');
    await press('Desfazer');

    expect(circle('v2')).toStrictEqual(before);
  });
});

describe('Câmera: sessões de gesto, reset, modo e o layout', () => {
  it('Novo grafo durante o pan descarta o gesto: a câmera do grafo novo é a neutra e os eventos atrasados não a movem', async () => {
    const { dragFinger, press, tapAt, pressMode } = await threeVertices();
    const held = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    await press(NOVO);
    await act(async () => {
      held.pan.update(held.last);
      held.pan.end({ ...held.last, x: held.last.x + 50 });
    });
    await tapAt({ x: 100, y: 100 });

    expect(circle('v1')).toMatchObject({ cx: 100, cy: 100, r: 20 }); // câmera neutra: ponto tocado = ponto do mundo
    await pressMode('Selecionar');
  });

  it('Carregar exemplo durante o pan: o enquadramento do exemplo vale e o gesto atrasado não o desfaz', async () => {
    const { dragFinger, press } = await threeVertices();
    const held = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    await press('Carregar exemplo');
    const framed = { ...circle('v1') };
    await act(async () => {
      held.pan.update({ ...held.last, x: held.last.x + 90, y: held.last.y + 90 });
    });

    expect(circle('v1')).toStrictEqual(framed);
  });

  it('trocar de modo durante o pan encerra o gesto: os eventos seguintes não movem a câmera', async () => {
    const { dragFinger, pressMode } = await threeVertices();
    const held = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    await pressMode('Conectar');
    const frozen = circles();
    await act(async () => {
      held.pan.update({ ...held.last, x: held.last.x + 90, y: held.last.y + 90 });
    });

    expect(circles()).toStrictEqual(frozen);
  });

  it('o layout e o canvas não saltam com o pan nem com a pinça: a ordem e o estilo continuam', async () => {
    const { dragFinger, pinchFingers } = await threeVertices();
    const order = layoutOrder();
    const style = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    await dragFinger(BACKGROUND, { x: 250, y: 120 });
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 1.8);

    expect(layoutOrder()).toStrictEqual(order);
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(style);
  });
});

describe('Câmera: pinça de dois dedos', () => {
  it('amplia em torno do foco: o vértice sob o foco fica sob o foco e os outros se afastam dele na razão da escala', async () => {
    const { pinchFingers } = await threeVertices();
    const before = circles();
    const focal = { x: before.v2.cx, y: before.v2.cy };
    await pinchFingers(focal, focal, 2);
    const after = circles();

    expect(after.v2.cx).toBeCloseTo(focal.x, 6);
    expect(after.v2.cy).toBeCloseTo(focal.y, 6);
    expect(after.v2.r).toBeCloseTo(40, 9);
    expect(after.v1.cx - focal.x).toBeCloseTo((before.v1.cx - focal.x) * 2, 6);
    expect(after.v3.cy - focal.y).toBeCloseTo((before.v3.cy - focal.y) * 2, 6);
  });

  it('reduz em torno de um foco FORA do centro e fora de qualquer vértice: cada círculo vai para F + (c − F)·escala', async () => {
    const { pinchFingers } = await threeVertices();
    const before = circles();
    const focal = { x: 300, y: 250 };
    await pinchFingers(focal, focal, 0.5);
    const after = circles();

    for (const id of IDS) {
      expect(after[id].cx).toBeCloseTo(focal.x + (before[id].cx - focal.x) * 0.5, 6);
      expect(after[id].cy).toBeCloseTo(focal.y + (before[id].cy - focal.y) * 0.5, 6);
      expect(after[id].r).toBeCloseTo(10, 9);
    }
  });

  it('respeita os limites de zoom: a escala 0,25 e a 4 nunca são ultrapassadas, e o ponto sob o foco continua sob o foco', async () => {
    const { pinchFingers } = await threeVertices();
    const before = circles();
    const focal = { x: before.v2.cx, y: before.v2.cy };
    await pinchFingers(focal, focal, 100);
    expect(scaleOf()).toBe(4);
    expect(circle('v2').cx).toBeCloseTo(focal.x, 6);

    await pinchFingers(focal, focal, 0.0001);
    expect(scaleOf()).toBe(0.25); // a escala acumulada do gesto novo parte da câmera atual (4) e é cortada no mínimo
    expect(circle('v2').cx).toBeCloseTo(focal.x, 6);
  });

  it('o foco que se move junto (dois dedos que andam): o ponto do mundo sob o foco da ativação acompanha o foco', async () => {
    const { pinchFingers } = await threeVertices();
    const before = circles();
    const f0 = { x: before.v2.cx, y: before.v2.cy };
    const f1 = { x: f0.x + 40, y: f0.y + 30 };
    await pinchFingers(f0, f1, 1.5);
    const after = circles();

    expect(after.v2.cx).toBeCloseTo(f1.x, 6);
    expect(after.v2.cy).toBeCloseTo(f1.y, 6);
    expect(after.v1.cx).toBeCloseTo(f1.x + (before.v1.cx - f0.x) * 1.5, 6);
    expect(after.v1.cy).toBeCloseTo(f1.y + (before.v1.cy - f0.y) * 1.5, 6);
  });

  it('a pinça não cria vértice, aresta, seleção nem histórico, e não muda o layout: o editor continua o mesmo objeto', async () => {
    const { pinchFingers, editor } = await threeVertices();
    const state = editor();
    await pinchFingers({ x: 180, y: 160 }, { x: 200, y: 150 }, 2.2);

    expect(editor()).toBe(state);
    expect(editor().history.past).toHaveLength(state.history.past.length);
  });

  it('a pinça funciona sobre um vértice, uma aresta e o fundo, em qualquer modo, sem selecionar nem arrastar nada', async () => {
    const { pinchFingers, pressMode, editor } = await threeVertices();
    for (const mode of ['Selecionar', 'Adicionar vértice', 'Conectar'] as const) {
      await pressMode(mode);
      const before = scaleOf();
      const focal = mode === 'Selecionar' ? { x: circle('v1').cx, y: circle('v1').cy } : MIDDLE_A_B;
      await pinchFingers(focal, focal, 1.2);

      expect(scaleOf()).toBeCloseTo(before * 1.2, 9);
      expect(editor().selection).toStrictEqual({ type: 'none' });
    }
  });

  it('depois de ampliar, os toques acertam: Adicionar cria sob o dedo e Selecionar acha o vértice pela posição nova', async () => {
    const { pinchFingers, pressMode, tapAt, editor } = await threeVertices();
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 2);
    const v3 = circles().v3;
    await tapAt({ x: v3.cx, y: v3.cy });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v3' });

    await pressMode('Adicionar vértice');
    await tapAt({ x: 250, y: 60 });
    expect(circle('v4').cx).toBeCloseTo(250, 6);
    expect(circle('v4').cy).toBeCloseTo(60, 6);
    expect(circle('v4').r).toBeCloseTo(40, 9);
  });

  it('arrastar um vértice depois de ampliar preserva o grab offset, em dp, com o zoom que for', async () => {
    const { pinchFingers, dragFinger, store } = await threeVertices();
    const focal = { x: circle('v2').cx, y: circle('v2').cy };
    await pinchFingers(focal, focal, 2); // o vértice sob o foco fica no lugar e segue dentro do quadro
    const before = circles().v2;
    const world = { ...position(store, 'v2')! };
    await dragFinger({ x: before.cx + 7, y: before.cy - 2 }, { x: before.cx + 7 + 30, y: before.cy - 2 + 20 });

    expect(circle('v2').cx - before.cx).toBeCloseTo(30, 6);
    expect(circle('v2').cy - before.cy).toBeCloseTo(20, 6);
    expect(position(store, 'v2')!.x - world.x).toBeCloseTo(30 / 2, 6); // no mundo, o deslocamento em dp dividido pela escala
  });

  it('o dedo que sobe não move a câmera: a última atualização do Gesture Handler, com UM ponteiro e o foco no dedo que restou, é ignorada (medido no Android)', async () => {
    const { pinchFingers } = await threeVertices();
    const focal = { x: 180, y: 160 };
    const held = await pinchFingers(focal, focal, 2, { finish: 'hold' });
    const before = circles();
    await act(async () => {
      // o aparelho mandou exatamente isto ao levantar o primeiro dedo: o foco salta para o dedo restante e a escala fica igual
      held.pinch.update({ focalX: 300, focalY: 250, scale: 2, scaleChange: 1, numberOfPointers: 1 });
      held.pinch.end({ focalX: 300, focalY: 250, scale: 2, scaleChange: 1 });
    });

    expect(circles()).toStrictEqual(before);
    expect(scaleOf()).toBe(2);
  });

  it('a pinça cancelada PRESERVA a câmera (não restaura)', async () => {
    const { pinchFingers } = await threeVertices();
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 2, { finish: 'cancel' });

    expect(scaleOf()).toBe(2);
  });

  it('Novo grafo durante a pinça: a câmera é a neutra e as atualizações atrasadas não a movem', async () => {
    const { pinchFingers, press, tapAt } = await threeVertices();
    const held = await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 2, { finish: 'hold' });
    await press(NOVO);
    await act(async () => {
      held.pinch.update({ focalX: 180, focalY: 160, scale: 3, scaleChange: 1.5 });
    });
    await tapAt({ x: 100, y: 100 });

    expect(circle('v1')).toMatchObject({ cx: 100, cy: 100, r: 20 });
  });
});

describe('Câmera: o segundo dedo', () => {
  it('um segundo dedo durante o ARRASTO DE VÉRTICE o cancela sem gravar (a posição volta, nenhum passo) e a pinça assume o zoom', async () => {
    const { dragFinger, pinchFingers, store, editor } = await threeVertices();
    const before = circles();
    const layout = editor().layout;
    const past = editor().history.past.length;
    const held = await dragFinger({ x: before.v3.cx + 4, y: before.v3.cy }, { x: before.v3.cx + 4 + 60, y: before.v3.cy + 40 }, { finish: 'hold' });
    expect(circle('v3').cx).toBeGreaterThan(before.v3.cx + 30); // a prévia do vértice está na tela

    await act(async () => {
      held.pan.cancel({ ...held.last }); // 1º: o módulo nativo cancela o pan (segundo dedo, `maxPointers: 1`)
    });
    expect(circle('v3').cx).toBeCloseTo(before.v3.cx, 6); // restaurado
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 1.5); // 2º: a pinça ativa

    expect(editor().layout).toBe(layout);
    expect(editor().history.past).toHaveLength(past);
    expect(position(store, 'v3')).toStrictEqual({ x: 130, y: 220 });
    expect(scaleOf()).toBeCloseTo(1.5, 9);
  });

  it('o fim TARDIO do arrasto de vértice, depois de a pinça ter ativado, nunca grava a posição', async () => {
    const { dragFinger, pinchFingers, editor, store } = await threeVertices();
    const before = circles();
    const held = await dragFinger({ x: before.v3.cx + 4, y: before.v3.cy }, { x: before.v3.cx + 4 + 60, y: before.v3.cy + 40 }, { finish: 'hold' });
    const past = editor().history.past.length;
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 1.5, { finish: 'hold' }); // a pinça tem a vez (restaura o vértice)
    await act(async () => {
      held.pan.end({ ...held.last }); // o evento de fim do pan chega atrasado
    });

    expect(editor().history.past).toHaveLength(past);
    expect(position(store, 'v3')).toStrictEqual({ x: 130, y: 220 });
  });

  it('um segundo dedo durante o PAN DA CÂMERA o cancela preservando a câmera, e a pinça continua dali sem saltar', async () => {
    const { dragFinger, pinchFingers } = await threeVertices();
    const held = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    await act(async () => {
      held.pan.cancel({ ...held.last });
    });
    const panned = circles();
    await pinchFingers({ x: 180, y: 160 }, { x: 180, y: 160 }, 1, { finish: 'hold', steps: 1 }); // pinça sem mudar a escala nem o foco

    expect(circles()).toStrictEqual(panned);
  });
});

// Como o quadro é desenhado enquanto o gesto ainda está em andamento (ver `LiveGraphRenderer`): o PAN desloca o grupo do SVG e reaproveita a cena assentada; a PINÇA refaz a cena.
describe('Câmera: o que o renderizador faz durante o gesto', () => {
  const groupShift = (): number[] => (screen.getByTestId('scene-offset', HIDDEN).props.matrix as number[]).slice(4).map((value) => value + 0);

  it('durante o pan o grupo do SVG é deslocado pelo que o dedo andou e a geometria da cena NÃO é refeita (os círculos continuam onde estavam)', async () => {
    const { dragFinger } = await threeVertices();
    const before = circles();
    const { moved } = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });

    expect(moved.x).not.toBe(0);
    expect(groupShift()).toStrictEqual([moved.x, moved.y]);
    expect(circles()).toStrictEqual(before);
  });

  it('o que se vê durante o pan é o que se vê depois de soltar: posição do círculo + deslocamento do grupo = posição final, para todos os vértices', async () => {
    const { dragFinger } = await threeVertices();
    const held = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'hold' });
    const [shiftX, shiftY] = groupShift();
    const seen = IDS.map((id) => ({ x: circle(id).cx + shiftX!, y: circle(id).cy + shiftY! }));
    await act(async () => {
      held.pan.end(held.last);
    });

    expect(groupShift()).toStrictEqual([0, 0]);
    IDS.forEach((id, index) => {
      expect(circle(id).cx).toBeCloseTo(seen[index]!.x, 9);
      expect(circle(id).cy).toBeCloseTo(seen[index]!.y, 9);
    });
  });

  it('o pan cancelado (o sistema cancela) preserva a câmera: o grupo volta a zero e a cena assentada já está na câmera nova', async () => {
    const { dragFinger } = await threeVertices();
    const before = circles();
    const { moved } = await dragFinger(BACKGROUND, { x: 250, y: 120 }, { finish: 'cancel' });

    expect(groupShift()).toStrictEqual([0, 0]);
    expect(circle('v1').cx - before.v1.cx).toBeCloseTo(moved.x, 9);
    expect(circle('v1').cy - before.v1.cy).toBeCloseTo(moved.y, 9);
  });

  it('durante a pinça a cena é REFEITA (o raio muda) e o grupo não é deslocado: só o pan desloca', async () => {
    const { pinchFingers } = await threeVertices();
    const before = circles();
    const focal = { x: 180, y: 160 };
    await pinchFingers(focal, focal, 2, { finish: 'hold' });

    expect(groupShift()).toStrictEqual([0, 0]);
    expect(circle('v1').r).toBeCloseTo(before.v1.r * 2, 9);
    expect(circle('v1').cx).toBeCloseTo(focal.x + (before.v1.cx - focal.x) * 2, 9);
  });

  it('um foco que anda durante a pinça também refaz a cena: a escala mudou, então não há deslocamento de grupo mesmo com o foco se movendo', async () => {
    const { pinchFingers } = await threeVertices();
    await pinchFingers({ x: 180, y: 160 }, { x: 220, y: 130 }, 1.5, { finish: 'hold' });

    expect(groupShift()).toStrictEqual([0, 0]);
  });

  it('um pan que volta ao ponto de ATIVAÇÃO (deslocamento zero desde a ativação) deixa o grupo em zero e a câmera onde estava; a folga anterior à ativação nunca vira deslocamento', async () => {
    const { dragFinger } = await threeVertices();
    const before = circles();
    const to = { x: 250, y: 120 };
    const held = await dragFinger(BACKGROUND, to, { finish: 'hold' });
    const activation = { x: to.x - held.moved.x, y: to.y - held.moved.y };
    await act(async () => {
      held.pan.update({ ...activation, translationX: 0, translationY: 0 });
      held.pan.end({ ...activation, translationX: 0, translationY: 0 });
    });

    expect(groupShift()).toStrictEqual([0, 0]);
    expect(circles()).toStrictEqual(before);
  });
});
