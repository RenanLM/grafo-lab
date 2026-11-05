import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';

import { buildGraphScene, moveVertex, positionOf, type GraphLayout, type Point } from './core';
import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { ACTIVE_STATE, recordGestureStateRequests, sendTouches } from './gesture-test-helpers';
import { LabContent } from './lab-screen';

// Arrastar vértices, de ponta a ponta e sem dispositivo (incremento 3.9): o gesto é simulado com os utilitários do Gesture Handler 3 e passa pelo
// MESMO protocolo do aparelho: o pan desce (\`begin\`), os eventos de toque chegam, o JavaScript decide e pede a ativação, o "módulo nativo" ativa (\`activate\`),
// o dedo anda (\`update\`) e sobe (\`end\`) ou o gesto é cancelado. O oráculo do desenho é a cena definitiva: a prévia tem que ser igual ao que \`buildGraphScene\`
// desenha com o layout movido. O que o Jest NÃO mostra (o ScrollView nativo, o atraso real do JavaScript) foi conferido no emulador (docs/ARCHITECTURE.md).

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

let recorder: ReturnType<typeof recordGestureStateRequests>;
beforeEach(() => {
  recorder = recordGestureStateRequests();
});
afterEach(() => {
  recorder.restore();
});

type Finish = 'release' | 'cancel' | 'hold';

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

  /**
   * Um dedo que desce em \`from\` e anda em linha reta até \`to\` em \`steps\` passos. A cada passo chega o evento de toque; se o JavaScript PEDIR a ativação, o "módulo
   * nativo" ativa o pan e os passos seguintes viram \`update\`. \`finish\`: \`release\` (o dedo sobe), \`cancel\` (o sistema cancela) ou \`hold\` (o dedo fica; o teste
   * decide o resto). Devolve se o arrasto chegou a ativar.
   */
  const dragFinger = async (from: Point, to: Point, { finish = 'release' as Finish, steps = 4 } = {}) => {
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    const requestsBefore = recorder.requests.mock.calls.length;
    let activated = false;
    const at = (k: number): Point => ({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
    // Como no aparelho (medido no emulador): a `translationX/Y` do pan com ativação manual começa em 0 no passo da ATIVAÇÃO, não onde o dedo desceu. O código
    // não pode depender dela; o que vale é a posição local (`x`, `y`).
    let activatedAt: Point | undefined;
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
      if (!activated && recorder.requests.mock.calls.length > requestsBefore) {
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
    if (finish === 'hold') return { activated, pan, event: event(steps) };
    await act(async () => {
      if (!activated) pan.fail(event(steps));
      else if (finish === 'release') pan.end(event(steps));
      else pan.cancel(event(steps));
    });
    return { activated, pan, event: event(steps) };
  };

  return { store, editor, press, pressMode, measure, tapAt, dragFinger, user };
}

/** Grafo novo A, B e C com as arestas pedidas (criadas pelo modo Conectar de verdade), o canvas medido em 360 dp e o modo Selecionar escolhido. */
async function dragScreen({ directed = false, edges = ['A-B', 'A-C'] as readonly string[] } = {}) {
  const ctx = await setup();
  await ctx.press(directed ? NOVO_ORIENTADO : NOVO);
  await ctx.measure(360);
  await ctx.tapAt(A);
  await ctx.tapAt(B);
  await ctx.tapAt(C);
  await ctx.pressMode('Conectar');
  const point = { A, B, C } as const;
  for (const edge of edges) {
    const [from, to] = edge.split('-') as ['A' | 'B' | 'C', 'A' | 'B' | 'C'];
    await ctx.tapAt(point[from]);
    await ctx.tapAt(point[to]);
  }
  await ctx.pressMode('Selecionar');
  return ctx;
}

const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };
/** O texto SVG entrega `x` e `y` como listas de um elemento; aqui viram números. */
function labelProps(id: string): { x: number; y: number } {
  const { x, y } = screen.getByTestId(`vertex-label-${id}`, HIDDEN).props as { x: number | number[]; y: number | number[] };
  return { x: Number(Array.isArray(x) ? x[0] : x), y: Number(Array.isArray(y) ? y[0] : y) };
}
const stroke = (id: string) => screen.getByTestId(`edge-stroke-${id}`, HIDDEN).props as { x1: number; y1: number; x2: number; y2: number; d?: string };
const numbersOf = (d: string): number[] => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
const ringOf = (id: string) => screen.queryByTestId(`vertex-selection-ring-${id}`, HIDDEN);
const hasCircle = (id: string) => screen.queryAllByTestId(`vertex-circle-${id}`, HIDDEN).length;
const position = (store: EditorStore, id: string) => positionOf(store.getState().editor.layout, id);
const layoutOf = (store: EditorStore): GraphLayout => store.getState().editor.layout;

/** A propriedade `scrollEnabled` do ScrollView da página (o ancestral nativo do canvas). `undefined` e `true` são rolável. */
function pageScrollEnabled(): boolean | undefined {
  for (let node = screen.getByTestId('canvas-area').parent; node !== null; node = node.parent) {
    if (String(node.type) === 'RCTScrollView') return node.props.scrollEnabled as boolean | undefined;
  }
  throw new Error('o canvas não está dentro de um ScrollView');
}

/** As arestas e o vértice que a cena definitiva desenharia com \`vertexId\` em \`world\` (o oráculo da prévia). */
function sceneWith(store: EditorStore, vertexId: string, world: Point, camera = { x: 0, y: 0, scale: 1 }) {
  const { graph, layout } = store.getState().editor;
  const scene = buildGraphScene(graph, moveVertex(layout, vertexId, world), camera, { viewport: { width: 360, height: 320 } })!;
  return scene;
}

describe('Arrastar: o gesto move o vértice', () => {
  it('toque curto seleciona e não move nada; nenhum pedido de ativação ao Gesture Handler', async () => {
    const { tapAt, editor, store } = await dragScreen();
    const before = layoutOf(store);
    await tapAt(A);

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(layoutOf(store)).toBe(before);
    expect(recorder.requests).not.toHaveBeenCalled();
  });

  it('arrasto iniciado sobre um vértice pede a ativação, move e confirma UMA vez: A de (60, 60) para (100, 140)', async () => {
    const { dragFinger, store, editor } = await dragScreen();
    const pastBefore = editor().history.past.length;
    const { activated } = await dragFinger(A, { x: 100, y: 140 });

    expect(activated).toBe(true);
    expect(recorder.requests).toHaveBeenCalledTimes(1);
    expect(recorder.requests.mock.calls[0]![1]).toBe(ACTIVE_STATE);
    expect(position(store, 'v1')).toStrictEqual({ x: 100, y: 140 });
    expect(editor().history.past).toHaveLength(pastBefore + 1);
    expect(circle('v1')).toMatchObject({ cx: 100, cy: 140 });
    expect(labelProps('v1').x).toBe(100);
  });

  it('o vértice acompanha o dedo ENQUANTO ele anda: a prévia se move e o layout da store NÃO muda até soltar', async () => {
    const { dragFinger, store, editor } = await dragScreen();
    const layoutBefore = layoutOf(store);
    const pastBefore = editor().history.past.length;
    await dragFinger(A, { x: 100, y: 140 }, { finish: 'hold' });

    expect(circle('v1')).toMatchObject({ cx: 100, cy: 140 }); // o desenho já está no dedo
    expect(layoutOf(store)).toBe(layoutBefore); // o layout, não
    expect(position(store, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(editor().history.past).toHaveLength(pastBefore);
  });

  it('o grab offset é mantido: o dedo desce 8 dp à direita e 5 abaixo do centro, e o centro anda exatamente o que o dedo andou', async () => {
    const { dragFinger, store } = await dragScreen();
    await dragFinger({ x: 68, y: 65 }, { x: 108, y: 165 });

    expect(position(store, 'v1')).toStrictEqual({ x: 100, y: 160 }); // 60 + 40, 60 + 100: não "salta" para o dedo
  });

  it('um arrasto de menos de 10 dp não é arrasto: nada é pedido e nada se move (o toque cuida dele)', async () => {
    const { dragFinger, store } = await dragScreen();
    const before = layoutOf(store);
    const { activated } = await dragFinger(A, { x: 66, y: 66 }, { steps: 3 });

    expect(activated).toBe(false);
    expect(recorder.requests).not.toHaveBeenCalled();
    expect(layoutOf(store)).toBe(before);
  });

  it('arrasto iniciado no FUNDO não move vértice nenhum e não pede ativação: a rolagem da página não é tocada', async () => {
    const { dragFinger, store, editor } = await dragScreen();
    const before = layoutOf(store);
    const past = editor().history.past.length;
    const { activated } = await dragFinger(FUNDO, { x: 320, y: 40 });

    expect(activated).toBe(false);
    expect(recorder.requests).not.toHaveBeenCalled();
    expect(layoutOf(store)).toBe(before);
    expect(editor().history.past).toHaveLength(past);
  });

  it('arrasto iniciado sobre uma ARESTA não move vértice nenhum nem pede ativação', async () => {
    const { dragFinger, store } = await dragScreen();
    const before = layoutOf(store);
    const { activated } = await dragFinger(MEIO_A_B, { x: 130, y: 180 });

    expect(activated).toBe(false);
    expect(recorder.requests).not.toHaveBeenCalled();
    expect(layoutOf(store)).toBe(before);
  });

  it('o arrasto não cria vértices nem arestas: o grafo é o mesmo objeto', async () => {
    const { dragFinger, editor } = await dragScreen();
    const graph = editor().graph;
    await dragFinger(B, { x: 280, y: 250 });
    await dragFinger(FUNDO, { x: 40, y: 250 });

    expect(editor().graph).toBe(graph);
    expect(editor().graph.vertices).toHaveLength(3);
    expect(editor().graph.edges).toHaveLength(2);
  });

  it('o arrasto passa por cima de outro vértice e continua movendo o MESMO: v1 chega ao centro de v2, e v2 não se mexe', async () => {
    const { dragFinger, store } = await dragScreen();
    await dragFinger(A, B, { finish: 'hold' });

    expect(circle('v1')).toMatchObject({ cx: 200, cy: 60 });
    expect(circle('v2')).toMatchObject({ cx: 200, cy: 60 });
    expect(hasCircle('v1')).toBe(1);
    expect(hasCircle('v2')).toBe(1);
    expect(position(store, 'v2')).toStrictEqual({ x: 200, y: 60 });
  });

  it('um vértice sem arestas também se arrasta, sem prévia de arestas', async () => {
    const ctx = await dragScreen({ edges: [] });
    await ctx.dragFinger(C, { x: 150, y: 250 });

    expect(position(ctx.store, 'v3')).toStrictEqual({ x: 150, y: 250 });
  });
});

describe('Arrastar: as arestas, os pesos e os rótulos acompanham o vértice', () => {
  it('as arestas incidentes seguem a prévia (iguais à cena definitiva); as outras e os outros vértices não se mexem', async () => {
    const { dragFinger, store } = await dragScreen({ edges: ['A-B', 'A-C', 'B-C'] });
    const stillB = circle('v2');
    const stillBC = stroke('e3');
    await dragFinger(A, { x: 100, y: 140 }, { finish: 'hold' });
    const expected = sceneWith(store, 'v1', { x: 100, y: 140 });

    for (const edgeId of ['e1', 'e2']) {
      const wanted = expected.edges.find((edge) => edge.id === edgeId)!.path;
      expect(stroke(edgeId)).toMatchObject({ x1: wanted.from.x, y1: wanted.from.y, x2: wanted.to.x, y2: wanted.to.y });
    }
    expect(circle('v2')).toStrictEqual(stillB);
    expect(stroke('e3')).toStrictEqual(stillBC);
    expect(circle('v3')).toMatchObject({ cx: 130, cy: 200 });
  });

  it('a origem e o destino das arestas continuam os mesmos do grafo, durante e depois do arrasto', async () => {
    const { dragFinger, editor } = await dragScreen({ directed: true, edges: ['A-B', 'C-A'] });
    const before = editor().graph.edges.map((edge) => [edge.id, edge.source, edge.target]);
    await dragFinger(A, { x: 90, y: 120 }, { finish: 'hold' });
    expect(editor().graph.edges.map((edge) => [edge.id, edge.source, edge.target])).toStrictEqual(before);
    expect(before).toStrictEqual([['e1', 'v1', 'v2'], ['e2', 'v3', 'v1']]);
  });

  it('em grafo orientado a seta continua apontando para o destino: a ponta da seta de A → B fica na borda de B e a de C → A, na de A que se move', async () => {
    const { dragFinger } = await dragScreen({ directed: true, edges: ['A-B', 'C-A'] });
    await dragFinger(A, { x: 90, y: 120 }, { finish: 'hold' });
    const parse = (id: string) => numbersOf(String(screen.getByTestId(`edge-arrow-${id}`, HIDDEN).props.d)); // o polígono chega como o caminho 'M ponta esquerda direita z'
    const [tipX1, tipY1] = parse('e1') as [number, number];
    const [tipX2, tipY2] = parse('e2') as [number, number];

    expect(Math.hypot(tipX1 - B.x, tipY1 - B.y)).toBeCloseTo(20, 6); // a ponta de A → B está a um raio do centro de B
    expect(Math.hypot(tipX2 - 90, tipY2 - 120)).toBeCloseTo(20, 6); // a de C → A está a um raio do centro de A, na posição NOVA
  });

  it('arcos opostos (A → B e B → A) acompanham o movimento, continuam curvos e em lados opostos da reta entre os centros', async () => {
    const { dragFinger, store } = await dragScreen({ directed: true, edges: ['A-B', 'B-A'] });
    await dragFinger(A, { x: 70, y: 150 }, { finish: 'hold' });
    const control = (id: string) => {
      const [, , cx, cy] = numbersOf(String(stroke(id).d)) as [number, number, number, number];
      return { x: cx, y: cy };
    };
    const side = (c: Point) => Math.sign((B.x - 70) * (c.y - 150) - (B.y - 150) * (c.x - 70));

    expect(stroke('e1').d).toBeDefined();
    expect(stroke('e2').d).toBeDefined();
    expect(side(control('e1'))).not.toBe(0);
    expect(side(control('e1'))).toBe(-side(control('e2')));
    const expected = sceneWith(store, 'v1', { x: 70, y: 150 });
    const wanted = expected.edges.find((edge) => edge.id === 'e1')!.path;
    expect(numbersOf(String(stroke('e1').d))).toStrictEqual([wanted.from.x, wanted.from.y, (wanted as { control: Point }).control.x, (wanted as { control: Point }).control.y, wanted.to.x, wanted.to.y]);
  });

  it('o peso acompanha a aresta (âncora da cena definitiva) e o rótulo acompanha o vértice', async () => {
    const { dragFinger, store } = await dragScreen();
    await act(async () => {
      store.getState().dispatch({ type: 'set-weight', edgeId: 'e1', weight: 2.5 });
    });
    await dragFinger(A, { x: 90, y: 150 }, { finish: 'hold' });
    const expected = sceneWith(store, 'v1', { x: 90, y: 150 });
    const anchor = expected.edges.find((edge) => edge.id === 'e1')!.weight!.anchor;

    const box = screen.getByTestId('weight-box-e1', HIDDEN).props as { x: number; y: number; width: number; height: number };
    expect(box.x + box.width / 2).toBeCloseTo(anchor.x, 9);
    expect(box.y + box.height / 2).toBeCloseTo(anchor.y, 9);
    expect(labelProps('v1').x).toBe(90);
    expect(labelProps('v1').y).toBeGreaterThan(150); // a linha de base fica um pouco abaixo do centro, como na cena
    expect(labelProps('v1').y).toBeLessThan(160);
  });

  it('aresta com peso zero mostra o zero durante o arrasto (zero é um peso)', async () => {
    const { dragFinger, store } = await dragScreen();
    await act(async () => {
      store.getState().dispatch({ type: 'set-weight', edgeId: 'e2', weight: 0 });
    });
    await dragFinger(A, { x: 80, y: 90 }, { finish: 'hold' });

    expect(screen.getByTestId('weight-text-e2', HIDDEN)).toBeTruthy();
  });
});

describe('Arrastar: seleção', () => {
  it('o anel de seleção acompanha o vértice selecionado enquanto ele é arrastado', async () => {
    const { tapAt, dragFinger } = await dragScreen();
    await tapAt(A);
    await dragFinger(A, { x: 110, y: 150 }, { finish: 'hold' });

    expect(ringOf('v1')?.props).toMatchObject({ cx: 110, cy: 150 });
  });

  it('arrastar NÃO seleciona o vértice (um gesto não faz as duas coisas) e não desfaz a seleção que havia', async () => {
    const { tapAt, dragFinger, editor } = await dragScreen();
    await dragFinger(A, { x: 110, y: 150 });
    expect(editor().selection).toStrictEqual({ type: 'none' });

    await tapAt(C);
    await dragFinger(A, { x: 70, y: 100 });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v3' });
  });

  it('depois de arrastar, tocar no vértice o seleciona (o toque continua funcionando)', async () => {
    const { tapAt, dragFinger, editor } = await dragScreen();
    await dragFinger(A, { x: 110, y: 150 });
    await tapAt({ x: 110, y: 150 });

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });
});

describe('Arrastar: cancelamentos', () => {
  it('gesto cancelado pelo sistema: a posição volta, nenhum passo de histórico, a prévia some', async () => {
    const { dragFinger, store, editor } = await dragScreen();
    const before = layoutOf(store);
    const past = editor().history.past.length;
    await dragFinger(A, { x: 140, y: 170 }, { finish: 'cancel' });

    expect(layoutOf(store)).toBe(before);
    expect(editor().history.past).toHaveLength(past);
    expect(circle('v1')).toMatchObject({ cx: 60, cy: 60 }); // restaurado na tela
    expect(stroke('e1')).toMatchObject({ x1: 80, y1: 60 });
  });

  it('trocar de modo durante o arrasto o descarta: a prévia some e soltar depois não confirma nada', async () => {
    const { dragFinger, pressMode, store, editor } = await dragScreen();
    const before = layoutOf(store);
    const { pan, event } = await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    await pressMode('Adicionar vértice');

    expect(circle('v1')).toMatchObject({ cx: 60, cy: 60 });
    await act(async () => {
      pan.end(event);
    });
    expect(layoutOf(store)).toBe(before);
    expect(editor().history.past.filter((_, i) => i >= 5)).toHaveLength(0);
  });

  it('Novo grafo durante o arrasto descarta a prévia: o grafo novo (com os mesmos ids técnicos) não recebe movimento algum', async () => {
    const { dragFinger, press, tapAt, store } = await dragScreen();
    const { pan, event } = await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    await press(NOVO);
    await tapAt({ x: 60, y: 60 }); // modo Adicionar vértice: v1 do grafo novo em (60, 60), o mesmo id e a mesma posição de antes

    await act(async () => {
      pan.end(event);
    });
    expect(position(store, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(circle('v1')).toMatchObject({ cx: 60, cy: 60 });
    expect(store.getState().editor.history.past).toHaveLength(1); // só a criação do vértice
  });

  it('Carregar exemplo durante o arrasto descarta a prévia', async () => {
    const { dragFinger, press, store } = await dragScreen();
    const { pan, event } = await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    await press('Carregar exemplo');
    const exampleLayout = layoutOf(store);

    await act(async () => {
      pan.end(event);
    });
    expect(layoutOf(store)).toBe(exampleLayout);
    expect(store.getState().editor.history.past).toHaveLength(0);
  });

  it('o vértice é removido durante o arrasto: a prévia some e nada é confirmado', async () => {
    const { dragFinger, store } = await dragScreen();
    const { pan, event } = await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
      store.getState().dispatch({ type: 'remove-selection' });
    });
    await act(async () => {
      pan.end(event);
    });

    expect(hasCircle('v1')).toBe(0);
    expect(position(store, 'v1')).toBeUndefined();
  });

  it('a folha de propriedades aberta impede o arrasto', async () => {
    const { tapAt, dragFinger, user, store } = await dragScreen();
    await tapAt(A);
    await user.press(screen.getByRole('button', { name: 'Editar propriedades do vértice A' }));
    const before = layoutOf(store);
    const { activated } = await dragFinger(B, { x: 250, y: 120 });

    expect(activated).toBe(false);
    expect(layoutOf(store)).toBe(before);
  });

  it('desmontar a tela durante o arrasto não confirma nada nem deixa erro', async () => {
    const { dragFinger, store } = await dragScreen();
    const before = layoutOf(store);
    const { pan, event } = await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    await screen.unmount();
    await act(async () => {
      pan.end(event);
    });

    expect(layoutOf(store)).toBe(before);
  });
});

describe('Arrastar: histórico, desfazer e refazer', () => {
  it('arrastar e soltar cria UM passo; desfazer devolve A à posição anterior; refazer a nova; as arestas e os ids não mudam', async () => {
    const { dragFinger, press, store, editor } = await dragScreen();
    const edges = editor().graph.edges;
    const pastBefore = editor().history.past.length;
    await dragFinger(A, { x: 100, y: 140 });
    expect(editor().history.past).toHaveLength(pastBefore + 1);

    await press('Desfazer');
    expect(position(store, 'v1')).toStrictEqual({ x: 60, y: 60 });
    expect(circle('v1')).toMatchObject({ cx: 60, cy: 60 });
    await press('Refazer');
    expect(position(store, 'v1')).toStrictEqual({ x: 100, y: 140 });
    expect(circle('v1')).toMatchObject({ cx: 100, cy: 140 });
    expect(editor().graph.edges).toBe(edges);
    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
  });

  it('um movimento novo depois de desfazer descarta o ramo de refazer', async () => {
    const { dragFinger, press, editor } = await dragScreen();
    await dragFinger(A, { x: 100, y: 140 });
    await press('Desfazer');
    expect(editor().history.future).toHaveLength(1);
    await dragFinger(B, { x: 240, y: 100 });

    expect(editor().history.future).toHaveLength(0);
  });

  it('dois arrastos em sequência são dois passos independentes', async () => {
    const { dragFinger, editor, store } = await dragScreen();
    const past = editor().history.past.length;
    await dragFinger(A, { x: 100, y: 140 });
    await dragFinger(B, { x: 240, y: 100 });

    expect(editor().history.past).toHaveLength(past + 2);
    expect(position(store, 'v1')).toStrictEqual({ x: 100, y: 140 });
    expect(position(store, 'v2')).toStrictEqual({ x: 240, y: 100 });
  });

  it('um arrasto que volta ao ponto de partida não cria passo', async () => {
    const { editor } = await dragScreen();
    const past = editor().history.past.length;
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
    });
    await sendTouches('canvas-pan', 'move', { x: 90, y: 60 });
    await act(async () => {
      pan.activate({ x: 90, y: 60, translationX: 30, translationY: 0 });
      pan.update({ x: 90, y: 60, translationX: 30, translationY: 0 });
      pan.update({ x: 60, y: 60, translationX: 0, translationY: 0 });
      pan.end({ x: 60, y: 60, translationX: 0, translationY: 0 });
    });

    expect(editor().history.past).toHaveLength(past);
  });
});

describe('Arrastar: câmera, canvas e os outros modos', () => {
  it('a câmera e o canvas não se deslocam: os outros vértices e a posição dos blocos da tela ficam onde estavam, mesmo com o vértice fora da área', async () => {
    const { dragFinger } = await dragScreen();
    const order = () => screen.queryAllByTestId(/^(mode-select|canvas-area|selection-status-row|history-undo)$/).map((node) => String(node.props.testID));
    const before = order();
    await dragFinger(A, { x: 900, y: -500 }, { finish: 'hold' }); // muito além da borda do quadro

    expect(order()).toStrictEqual(before);
    expect(circle('v2')).toMatchObject({ cx: 200, cy: 60 });
    expect(circle('v3')).toMatchObject({ cx: 130, cy: 200 });
    expect(circle('v1')).toMatchObject({ cx: 900, cy: -500 }); // fora da área, sem a câmera se mexer
  });

  it('soltar fora da área visível é válido; desfazer traz o vértice de volta', async () => {
    const { dragFinger, press, store } = await dragScreen();
    await dragFinger(A, { x: 900, y: -500 });
    expect(position(store, 'v1')).toStrictEqual({ x: 900, y: -500 });
    await press('Desfazer');
    expect(position(store, 'v1')).toStrictEqual({ x: 60, y: 60 });
  });

  it('no exemplo (câmera enquadrada, com zoom): o vértice acompanha o dedo na tela dp por dp', async () => {
    const ctx = await setup();
    await ctx.press('Carregar exemplo');
    await ctx.measure(360);
    const start = circle('v1');
    const finger = { x: start.cx + 6, y: start.cy - 4 };
    await ctx.dragFinger(finger, { x: finger.x + 50, y: finger.y + 30 }, { finish: 'hold' });

    expect(circle('v1').cx).toBeCloseTo(start.cx + 50, 6);
    expect(circle('v1').cy).toBeCloseTo(start.cy + 30, 6);
  });

  it('nos modos Adicionar vértice e Conectar o arrasto não faz nada (os toques deles seguem como antes)', async () => {
    const { dragFinger, pressMode, store, tapAt, editor } = await dragScreen();
    const before = layoutOf(store);
    await pressMode('Adicionar vértice');
    expect((await dragFinger(A, { x: 140, y: 170 })).activated).toBe(false);
    await pressMode('Conectar');
    expect((await dragFinger(A, { x: 140, y: 170 })).activated).toBe(false);
    expect(layoutOf(store)).toBe(before);

    await tapAt(B); // Conectar: escolhe a origem
    expect(store.getState().connection.sourceVertexId).toBe('v2');
    expect(editor().graph.edges).toHaveLength(2);
  });

  it('a rolagem da página nunca é desligada: o ScrollView da tela continua rolável durante e depois do arrasto', async () => {
    const { dragFinger } = await dragScreen();
    expect(pageScrollEnabled()).not.toBe(false);
    await dragFinger(A, { x: 140, y: 170 }, { finish: 'hold' });
    expect(pageScrollEnabled()).not.toBe(false);
    await dragFinger(FUNDO, { x: 320, y: 40 });
    expect(pageScrollEnabled()).not.toBe(false);
  });

  it('abrir as propriedades depois de mover um vértice funciona e mostra o vértice selecionado', async () => {
    const { dragFinger, tapAt, user, editor } = await dragScreen();
    await dragFinger(A, { x: 110, y: 150 });
    await tapAt({ x: 110, y: 150 });
    await user.press(screen.getByRole('button', { name: 'Editar propriedades do vértice A' }));

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(screen.getByTestId('properties-sheet')).toBeTruthy();
  });
});
