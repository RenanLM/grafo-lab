import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';

import { type EditorAction, type Point, type RepresentationKind } from './core';
import * as representationView from './core/representation-view';
import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { recordGestureStateRequests, sendTouches } from './gesture-test-helpers';
import { LabContent } from './lab-screen';

// O painel "Representações do grafo" DENTRO do Laboratório, de ponta a ponta e sem dispositivo (incremento 3.11): onde fica, que não desloca nada, que a edição continua possível com ele aberto, que acompanha
// cada alteração do grafo e QUANDO ele recalcula. O recálculo é conferido por um espião que repassa a chamada de `buildRepresentationView` (a função de apresentação); o domínio e o adaptador têm os seus testes.

jest.mock('./core/representation-view', () => {
  const actual = jest.requireActual<typeof import('./core/representation-view')>('./core/representation-view');
  return { ...actual, buildRepresentationView: jest.fn(actual.buildRepresentationView) };
});

const build = representationView.buildRepresentationView as unknown as jest.Mock;
const HIDDEN = { includeHiddenElements: true } as const;
const mount = (ui: ReactElement) => render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);
const NOVO = 'Novo grafo não orientado';
const NOVO_ORIENTADO = 'Novo grafo orientado';

let recorder: ReturnType<typeof recordGestureStateRequests>;
beforeEach(() => {
  recorder = recordGestureStateRequests();
  build.mockClear();
});
afterEach(() => {
  recorder.restore();
});

// Em um grafo novo (câmera neutra) o ponto tocado é o ponto do mundo: v1 = A, v2 = B, v3 = C
const A = { x: 60, y: 80 };
const B = { x: 190, y: 60 };
const C = { x: 130, y: 220 };
const BACKGROUND = { x: 320, y: 280 };

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
  const press = (name: string | RegExp) => user.press(screen.getByRole('button', { name }));
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
  /** Um dedo que anda de `from` a `to` pelo protocolo do aparelho (o pan de um dedo: arrasto de vértice ou pan da câmera, quem decide é o dono do gesto). */
  const dragFinger = async (from: Point, to: Point, steps = 4) => {
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
    await act(async () => {
      if (!activated) pan.fail(event(steps));
      else pan.end(event(steps));
    });
    return { activated };
  };
  /** Dois dedos que ampliam: o foco parado e a escala acumulada de 1 até `scale`. */
  const pinch = async (focal: Point, scale: number, steps = 4) => {
    const controller = createGestureController(getByGestureTestId('canvas-pinch'));
    await act(async () => {
      controller.begin({ focalX: focal.x, focalY: focal.y });
      controller.activate({ focalX: focal.x, focalY: focal.y, scale: 1, scaleChange: 1 });
    });
    for (let k = 1; k <= steps; k++) {
      const accumulated = 1 + ((scale - 1) * k) / steps;
      await act(async () => {
        controller.update({ focalX: focal.x, focalY: focal.y, scale: accumulated, scaleChange: 1, numberOfPointers: 2 });
      });
    }
    await act(async () => {
      controller.end({ focalX: focal.x, focalY: focal.y, scale, scaleChange: 1 });
    });
  };
  const typeInSheet = (text: string) => fireEvent.changeText(screen.getByTestId('sheet-input'), text);
  const toggle = () => user.press(screen.getByRole('button', { name: 'Representações do grafo' }));
  const tab = (kind: RepresentationKind, title: string) => user.press(screen.getByRole('tab', { name: title }));
  return { store, editor, press, pressMode, measure, tapAt, dispatch, dragFinger, pinch, typeInSheet, toggle, tab, user };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const TITLES = {
  'adjacency-list': 'Lista de adjacência',
  'adjacency-matrix': 'Matriz de adjacência',
  'incidence-matrix': 'Matriz de incidência',
  'incidence-list': 'Lista de incidência',
} as const;

/** Grafo novo com A, B e C criados por toque (câmera neutra) e o canvas medido em 360 dp. */
async function threeVertices(directed = false): Promise<Ctx> {
  const ctx = await setup();
  await ctx.press(directed ? NOVO_ORIENTADO : NOVO);
  await ctx.measure(360);
  await ctx.tapAt(A);
  await ctx.tapAt(B);
  await ctx.tapAt(C);
  return ctx;
}

const connect = (ctx: Ctx, source: string, target: string, weight?: number) =>
  ctx.dispatch({ type: 'connect', source, target, ...(weight === undefined ? {} : { weight }) });
const openTab = async (ctx: Ctx, kind: RepresentationKind) => {
  await ctx.toggle();
  if (kind !== 'adjacency-list') await ctx.tab(kind, TITLES[kind]);
};
const cell = (testID: string) => screen.getByTestId(testID);
const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number };
const calledKinds = (): string[] => build.mock.calls.map((call) => String(call[1]));
const IDS = ['v1', 'v2', 'v3'] as const;
const circles = () => IDS.map((id) => ({ ...circle(id) }));

describe('o painel na tela do Laboratório', () => {
  it('só existe depois de começar um grafo, e começa recolhido', async () => {
    const { press } = await setup();
    expect(screen.queryByTestId('representations-panel')).toBeNull();

    await press(NOVO);
    expect(screen.getByTestId('representations-panel')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Representações do grafo' }).props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('vem DEPOIS do canvas e da barra de desfazer e refazer (nada fixo do editor muda de lugar)', async () => {
    await threeVertices();

    const order = screen.queryAllByTestId(/^(mode-add-vertex|canvas-area|history-undo|representations-panel)$/).map((node) => String(node.props.testID));
    expect(order).toStrictEqual(['mode-add-vertex', 'canvas-area', 'history-undo', 'representations-panel']);
  });

  it('o item "ver o mesmo grafo como lista e matrizes" saiu de "o que ainda vem aqui" (agora existe)', async () => {
    await setup();

    expect(screen.queryByText(/Ver o mesmo grafo como lista de adjacência/)).toBeNull();
  });

  it('expandir, trocar de aba e recolher NÃO move o canvas nem a câmera: o estilo do canvas e os círculos ficam idênticos', async () => {
    const ctx = await threeVertices();
    const { toggle, tab } = ctx;
    await connect(ctx, 'v1', 'v2');
    const style = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    const before = circles();

    await toggle();
    await tab('adjacency-matrix', TITLES['adjacency-matrix']);
    await tab('incidence-list', TITLES['incidence-list']);
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(style);
    expect(circles()).toStrictEqual(before);
    await toggle();
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(style);
    expect(circles()).toStrictEqual(before);
  });

  it('com o painel aberto a edição continua: os modos respondem, tocar no canvas cria o vértice e os botões do editor estão ali', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'adjacency-list');

    expect(screen.getByRole('radio', { name: 'Conectar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeOnTheScreen();
    await ctx.tapAt({ x: 250, y: 150 });
    expect(ctx.editor().graph.vertices).toHaveLength(4);
    expect(screen.getByText('D (v4)')).toBeOnTheScreen();
    await ctx.pressMode('Selecionar');
    expect(screen.getByRole('radio', { name: 'Selecionar' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('o painel acompanha o grafo da sessão', () => {
  it('adicionar vértice: a lista ganha o vértice, isolado, com `Sem vizinhos`', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'adjacency-list');
    expect(screen.getAllByText('Sem vizinhos')).toHaveLength(3);

    await ctx.tapAt({ x: 250, y: 150 });
    expect(screen.getByText('D (v4)')).toBeOnTheScreen();
    expect(screen.getAllByText('Sem vizinhos')).toHaveLength(4);
  });

  it('conectar vértices pelo canvas (modo Conectar): a lista, a matriz e a incidência mostram a aresta criada', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'adjacency-list');
    await ctx.pressMode('Conectar');
    await ctx.tapAt(A);
    await ctx.tapAt(B);

    expect(screen.getByText('— B (v2) | e1 | sem peso')).toBeOnTheScreen();
    expect(screen.getByText('— A (v1) | e1 | sem peso')).toBeOnTheScreen();
    await ctx.tab('adjacency-matrix', TITLES['adjacency-matrix']);
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('×');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('×');
    await ctx.tab('incidence-matrix', TITLES['incidence-matrix']);
    expect(cell('incidence-cell-v1-e1')).toHaveTextContent('1');
    expect(cell('incidence-cell-v3-e1')).toHaveTextContent('0');
    await ctx.tab('incidence-list', TITLES['incidence-list']);
    expect(screen.getAllByText(/^e1: liga a /)).toHaveLength(2);
  });

  it('arco oposto (grafo orientado): a segunda aresta ocupa a outra célula e a coluna seguinte, com os sinais trocados', async () => {
    const ctx = await threeVertices(true);
    await openTab(ctx, 'adjacency-matrix');
    await connect(ctx, 'v1', 'v2', 0);
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('0');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('—');

    await connect(ctx, 'v2', 'v1');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('×');
    await ctx.tab('incidence-matrix', TITLES['incidence-matrix']);
    expect(cell('incidence-cell-v1-e1')).toHaveTextContent('+1');
    expect(cell('incidence-cell-v2-e1')).toHaveTextContent('-1');
    expect(cell('incidence-cell-v2-e2')).toHaveTextContent('+1');
    expect(cell('incidence-cell-v1-e2')).toHaveTextContent('-1');
    expect(cell('incidence-cell-v3-e2')).toHaveTextContent('0');
  });

  it('alterar o peso pelo Selecionar e a folha de propriedades: o painel aberto por baixo atualiza depois de salvar (0 é diferente de ausência)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('×');

    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'edge', edgeId: 'e1' } });
    await ctx.press(/^Editar propriedades/);
    expect(screen.getByTestId('representations-panel')).toBeOnTheScreen(); // o painel continua montado por baixo da folha
    ctx.typeInSheet('0');
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: 'Salvar alterações' }));

    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('0');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('0');
    expect(cell('adjacency-cell-v1-v2').props.accessibilityLabel).toBe('Linha A, vértice v1; coluna B, vértice v2; aresta e1 com peso zero.');
  });

  it('remover o peso volta ao `×` (sem peso), e um peso negativo mostra o número', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2', 0);
    await openTab(ctx, 'adjacency-matrix');

    await ctx.dispatch({ type: 'set-weight', edgeId: 'e1', weight: undefined });
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('×');
    await ctx.dispatch({ type: 'set-weight', edgeId: 'e1', weight: -3.5 });
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('-3,5');
  });

  it('alterar o rótulo pela folha: os cabeçalhos e as linhas ganham o rótulo novo (o id continua)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
    await ctx.press(/^Editar propriedades/);
    ctx.typeInSheet('Origem');
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: 'Salvar alterações' }));

    expect(cell('adjacency-row-v1')).toHaveTextContent('Origemv1');
    expect(cell('adjacency-column-v1')).toHaveTextContent('Origemv1');
    expect(cell('adjacency-cell-v1-v2').props.accessibilityLabel).toBe('Linha Origem, vértice v1; coluna B, vértice v2; aresta e1 sem peso.');
  });

  it('remover um vértice (com a confirmação): a matriz perde a linha, a coluna e as arestas dele', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await connect(ctx, 'v2', 'v3');
    await openTab(ctx, 'adjacency-matrix');
    expect(cell('adjacency-cell-v2-v3')).toBeOnTheScreen();

    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v2' } });
    await ctx.press('Excluir vértice B');
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: /^Confirmar a exclusão/ }));

    expect(screen.queryByTestId('adjacency-row-v2')).toBeNull();
    expect(screen.queryByTestId('adjacency-column-v2')).toBeNull();
    expect(cell('adjacency-cell-v1-v3')).toHaveTextContent('—');
    await ctx.tab('incidence-matrix', TITLES['incidence-matrix']);
    expect(screen.getByTestId('representation-notice')).toHaveTextContent(/ainda não tem arestas/); // as duas arestas eram de B
  });

  it('remover uma aresta: some a coluna da incidência e volta a ausência na matriz', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await connect(ctx, 'v1', 'v3');
    await openTab(ctx, 'incidence-matrix');
    expect(cell('incidence-column-e2')).toBeOnTheScreen();

    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'edge', edgeId: 'e1' } });
    await ctx.press(/^Excluir aresta/);
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: /^Confirmar a exclusão/ }));

    expect(screen.queryByTestId('incidence-column-e1')).toBeNull();
    expect(cell('incidence-column-e2')).toBeOnTheScreen();
    await ctx.tab('adjacency-matrix', TITLES['adjacency-matrix']);
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('—');
    expect(cell('adjacency-cell-v1-v3')).toHaveTextContent('×');
  });

  it('desfazer e refazer com o painel aberto: acompanham o histórico (inclusive as exclusões, com os ids que sobraram)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2', 4);
    await openTab(ctx, 'adjacency-matrix');
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('4');

    await ctx.press('Desfazer'); // desfaz a aresta
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('—');
    await ctx.press('Refazer');
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('4');

    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v2' } });
    await ctx.press('Excluir vértice B');
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: /^Confirmar a exclusão/ }));
    expect(screen.queryByTestId('adjacency-column-v2')).toBeNull();
    await ctx.press('Desfazer');
    expect(cell('adjacency-column-v2')).toBeOnTheScreen();
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('4');
    await ctx.press('Refazer');
    expect(screen.queryByTestId('adjacency-column-v2')).toBeNull();
  });

  it('carregar o exemplo: o painel mostra o grafo do exemplo; começar outro grafo zera o conteúdo para o grafo vazio', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'adjacency-matrix');

    await ctx.press('Carregar exemplo');
    expect(screen.getAllByTestId(/^adjacency-row-/)).toHaveLength(4);
    expect(within(screen.getByTestId('representation-content')).getByText('Matriz de adjacência')).toBeOnTheScreen();

    await ctx.press(NOVO);
    expect(screen.getByTestId('representation-notice')).toHaveTextContent(/O grafo não tem vértices/);
    await ctx.tapAt(A);
    expect(cell('adjacency-cell-v1-v1')).toHaveTextContent('—');
  });
});

describe('quando o painel recalcula (e quando NÃO)', () => {
  it('recolhido, o painel não calcula nada, mesmo com o grafo mudando', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await connect(ctx, 'v2', 'v3', 0);
    await ctx.tapAt({ x: 250, y: 150 });

    expect(build).not.toHaveBeenCalled();
  });

  it('expandir calcula UMA vez, só a lista de adjacência (as duas matrizes e a lista de incidência não são calculadas)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await ctx.toggle();

    expect(calledKinds()).toStrictEqual(['adjacency-list']);
  });

  it('cada aba calcula só a própria representação, uma vez por escolha', async () => {
    const ctx = await threeVertices();
    await ctx.toggle();
    await ctx.tab('adjacency-matrix', TITLES['adjacency-matrix']);
    await ctx.tab('incidence-matrix', TITLES['incidence-matrix']);
    await ctx.tab('incidence-list', TITLES['incidence-list']);

    expect(calledKinds()).toStrictEqual(['adjacency-list', 'adjacency-matrix', 'incidence-matrix', 'incidence-list']);
  });

  it('uma alteração do grafo recalcula só a aba ativa, uma vez', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'incidence-matrix');
    build.mockClear();

    await connect(ctx, 'v1', 'v2');
    expect(calledKinds()).toStrictEqual(['incidence-matrix']);
    await connect(ctx, 'v2', 'v3', 0);
    expect(calledKinds()).toStrictEqual(['incidence-matrix', 'incidence-matrix']);
  });

  it('pan da câmera NÃO recalcula', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    build.mockClear();
    const before = circles();
    const { activated } = await ctx.dragFinger(BACKGROUND, { x: 250, y: 120 });

    expect(activated).toBe(true);
    expect(circles()).not.toStrictEqual(before); // a câmera mexeu de verdade
    expect(build).not.toHaveBeenCalled();
  });

  it('pinça NÃO recalcula', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'incidence-list');
    build.mockClear();
    const before = circles();
    await ctx.pinch({ x: 180, y: 160 }, 2);

    expect(circles()).not.toStrictEqual(before);
    expect(build).not.toHaveBeenCalled();
  });

  it('Centralizar e Ajustar ao grafo NÃO recalculam', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-list');
    build.mockClear();
    await ctx.press('Centralizar');
    await ctx.press('Ajustar ao grafo');

    expect(build).not.toHaveBeenCalled();
  });

  it('arrastar um vértice NÃO recalcula, nem durante o gesto nem ao confirmar a posição (muda o layout, não o grafo)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    await ctx.pressMode('Selecionar');
    build.mockClear();
    const before = ctx.editor().layout;
    const { activated } = await ctx.dragFinger(A, { x: 100, y: 140 });

    expect(activated).toBe(true);
    expect(ctx.editor().layout).not.toBe(before); // a posição foi confirmada: UM passo de histórico
    expect(build).not.toHaveBeenCalled();
  });

  it('desfazer e refazer o arrasto de um vértice (o mesmo grafo) também NÃO recalcula', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-list');
    await ctx.pressMode('Selecionar');
    await ctx.dragFinger(A, { x: 100, y: 140 });
    build.mockClear();
    await ctx.press('Desfazer');
    await ctx.press('Refazer');

    expect(build).not.toHaveBeenCalled();
  });

  it('selecionar um vértice ou uma aresta e trocar de modo NÃO recalculam', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    await ctx.pressMode('Selecionar');
    build.mockClear();
    await ctx.tapAt(A); // seleciona o vértice A
    await ctx.tapAt(BACKGROUND); // limpa a seleção
    await ctx.pressMode('Conectar');
    await ctx.pressMode('Adicionar vértice');

    expect(build).not.toHaveBeenCalled();
  });

  it('abrir a folha de propriedades e cancelar NÃO recalcula; salvar uma mudança recalcula uma vez', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    await ctx.pressMode('Selecionar');
    await ctx.dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
    build.mockClear();
    await ctx.press(/^Editar propriedades/);
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: 'Cancelar edição' }));
    expect(build).not.toHaveBeenCalled();

    await ctx.press(/^Editar propriedades/);
    ctx.typeInSheet('Z');
    await ctx.user.press(within(screen.getByTestId('properties-sheet')).getByRole('button', { name: 'Salvar alterações' }));
    expect(calledKinds()).toStrictEqual(['adjacency-matrix']);
  });

  it('recolher não recalcula e expandir de novo calcula uma vez a aba lembrada', async () => {
    const ctx = await threeVertices();
    await openTab(ctx, 'incidence-list');
    build.mockClear();
    await ctx.toggle(); // recolhe
    expect(build).not.toHaveBeenCalled();
    await ctx.toggle(); // expande
    expect(calledKinds()).toStrictEqual(['incidence-list']);
  });

  it('o painel assina só o grafo: mover a câmera e arrastar não re-renderizam o conteúdo (o mesmo elemento do DOM de teste permanece)', async () => {
    const ctx = await threeVertices();
    await connect(ctx, 'v1', 'v2');
    await openTab(ctx, 'adjacency-matrix');
    const table = screen.getByTestId('representation-table');
    await ctx.dragFinger(BACKGROUND, { x: 250, y: 120 });
    await ctx.pinch({ x: 180, y: 160 }, 1.5);

    expect(screen.getByTestId('representation-table')).toBe(table);
  });
});
