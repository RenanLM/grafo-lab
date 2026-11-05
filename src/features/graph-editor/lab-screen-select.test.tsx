import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { createGraph } from '@/domain/graph';
import { colors } from '@/theme';

import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { LabContent } from './lab-screen';

// Selecionar, editar propriedades e excluir, de ponta a ponta e sem dispositivo: o gesto (simulado com os utilitários do Gesture Handler 3)
// seleciona pelo núcleo, o destaque chega ao SVG, a folha de propriedades (um Modal) edita e a confirmação exclui, sempre pelo núcleo.
// O toque simulado é em dp, local ao canvas. A conferência real (toque por `adb`) está em docs/ARCHITECTURE.md.

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
const MEIO_A_C = { x: 95, y: 130 };

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
  const typeInSheet = (text: string) => fireEvent.changeText(screen.getByTestId('sheet-input'), text);
  return { store, editor, press, pressMode, measure, tapAt, gestureOf, typeInSheet, user };
}

/**
 * Grafo novo A, B e C com as arestas pedidas (A—B e/ou A—C, criadas pelo modo Conectar de verdade), o canvas medido em 360 dp e o modo
 * Selecionar escolhido.
 */
async function selectScreen({ directed = false, edges = ['A-B', 'A-C'] as readonly string[] } = {}) {
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

const status = () => screen.getByTestId('selection-status');
/** Um botão DENTRO da folha (o nome pode repetir o de um botão da tela, que fica atrás do Modal). */
const inSheet = (name: string) => within(screen.getByTestId('properties-sheet')).getByRole('button', { name });
/** O ponto do meio de uma aresta curva (a curva de Bézier quadrática, em t = 0,5), lido do traço desenhado: (P0 + 2·C + P2) / 4. */
function curveMidpoint(edgeId: string): { x: number; y: number } {
  const numbers = String(screen.getByTestId(`edge-stroke-${edgeId}`, HIDDEN).props.d).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const [x0, y0, cx, cy, x2, y2] = numbers as [number, number, number, number, number, number];
  return { x: (x0 + 2 * cx + x2) / 4, y: (y0 + 2 * cy + y2) / 4 };
}
const vertexRing = (id: string) => screen.queryByTestId(`vertex-selection-ring-${id}`, HIDDEN);
const edgeHalo = (id: string) => screen.queryByTestId(`edge-selection-${id}`, HIDDEN);
const circle = (id: string) => screen.getByTestId(`vertex-circle-${id}`, HIDDEN).props as { cx: number; cy: number; r: number; strokeWidth: number };
const edgeIds = () => screen.queryAllByTestId(/^edge-stroke-/, HIDDEN).map((node) => String(node.props.testID).replace('edge-stroke-', ''));
const textOf = (testID: string): string => {
  const [span] = screen.getByTestId(testID, HIDDEN).children;
  return typeof span === 'string' || span === undefined ? '' : String(span.props.content);
};
const hasWeightText = (edgeId: string) => screen.queryByTestId(`weight-text-${edgeId}`, HIDDEN) !== null;
const layoutOrder = () =>
  screen.queryAllByTestId(/^(mode-select|canvas-area|selection-status-row|history-undo)$/).map((node) => String(node.props.testID));
const LAYOUT_ORDER = ['mode-select', 'canvas-area', 'selection-status-row', 'history-undo'];

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('Selecionar: o toque seleciona', () => {
  it('toque em um vértice o seleciona: anel sólido no SVG, "Vértice A selecionado." e os botões Editar e Excluir', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt(A);

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(vertexRing('v1')).toBeTruthy();
    expect(vertexRing('v2')).toBeNull();
    expect(circle('v1').strokeWidth).toBe(4);
    expect(status()).toHaveTextContent('Vértice A selecionado.');
    expect(screen.getByRole('button', { name: 'Editar propriedades do vértice A' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Excluir vértice A' })).toBeOnTheScreen();
  });

  it('toque em uma aresta a seleciona: halo e traço grosso, e o estado diz "Aresta entre A e B selecionada. Sem peso."', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt(MEIO_A_B);

    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
    expect(edgeHalo('e1')).toBeTruthy();
    expect(edgeHalo('e2')).toBeNull();
    expect(screen.getByTestId('edge-stroke-e1', HIDDEN).props.strokeWidth).toBe(4);
    expect(screen.getByTestId('edge-stroke-e2', HIDDEN).props.strokeWidth).toBe(2);
    expect(status()).toHaveTextContent('Aresta entre A e B selecionada. Sem peso.');
    expect(screen.getByRole('button', { name: 'Editar propriedades da aresta entre A e B' })).toBeOnTheScreen();
  });

  it('toque no fundo limpa a seleção: some o destaque, o texto volta à instrução e os botões somem', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt(A);
    await tapAt(FUNDO);

    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(vertexRing('v1')).toBeNull();
    expect(status()).toHaveTextContent('Toque em um vértice ou em uma aresta para selecioná-lo.');
    expect(screen.queryByRole('button', { name: /Editar propriedades/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Excluir/ })).toBeNull();
  });

  it('trocar o elemento move o destaque; tocar de novo no mesmo mantém a seleção (o mesmo estado)', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt(A);
    await tapAt(B);
    expect(vertexRing('v1')).toBeNull();
    expect(vertexRing('v2')).toBeTruthy();

    const antes = editor();
    await tapAt(B);
    expect(editor()).toBe(antes);
    expect(vertexRing('v2')).toBeTruthy();
  });

  it('o vértice sobre uma aresta vence a aresta, e a aresta é selecionada onde nenhum vértice a cobre', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt({ x: 85, y: 60 }); // a 25 dp do centro de A: fora do alvo do vértice (24 dp), dentro da aresta A—B
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
    await tapAt({ x: 80, y: 60 }); // a 20 dp do centro de A: dentro do vértice
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('as coordenadas absolutas são ignoradas (só as locais valem)', async () => {
    const { tapAt, editor } = await selectScreen();
    await tapAt(A, { absoluteX: 900, absoluteY: 1500 });

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('toque cancelado, falho (um deslize) ou fora do canvas não seleciona nem limpa nada', async () => {
    const { tapAt, gestureOf, editor } = await selectScreen();
    await gestureOf('fail', A);
    await gestureOf('cancel', A);
    expect(editor().selection).toStrictEqual({ type: 'none' });

    await tapAt(A);
    await gestureOf('cancel', FUNDO);
    await gestureOf('fail', FUNDO);
    await tapAt({ x: 361, y: 100 });
    await tapAt({ x: -2, y: 100 });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('selecionar e limpar NÃO criam histórico nem mexem no grafo, nas posições ou no canvas', async () => {
    const { tapAt, editor } = await selectScreen();
    const antes = { grafo: editor().graph, historico: editor().history, layout: editor().layout };
    const circulos = (['v1', 'v2', 'v3'] as const).map((id) => ({ ...circle(id) }));
    const canvas = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    for (const at of [A, MEIO_A_B, FUNDO, C, MEIO_A_C]) await tapAt(at);

    expect(editor().graph).toBe(antes.grafo);
    expect(editor().history).toBe(antes.historico);
    expect(editor().layout).toBe(antes.layout);
    expect((['v1', 'v2', 'v3'] as const).map((id) => ({ ...circle(id), strokeWidth: 2 }))).toStrictEqual(circulos.map((c) => ({ ...c, strokeWidth: 2 })));
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(canvas);
  });

  it('no exemplo (câmera enquadrada) o toque seleciona o vértice que aparece sob o dedo, e o peso aparece no estado', async () => {
    const { press, measure, tapAt, editor } = await setup();
    await press('Carregar exemplo');
    await measure(360);
    const d = circle('v4');
    await tapAt({ x: d.cx, y: d.cy });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v4' });
    expect(status()).toHaveTextContent('Vértice D selecionado.');

    const c = circle('v3');
    const a = circle('v1');
    await tapAt({ x: (c.cx + a.cx) / 2, y: (c.cy + a.cy) / 2 }); // o meio da aresta C → A (peso 5)
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e4' });
    expect(status()).toHaveTextContent('Aresta de C para A selecionada. Peso 5.');
  });
});

describe('Selecionar: modos e sessão', () => {
  it('sair do modo Selecionar limpa a seleção (o destaque não fica em outro modo); voltar não a traz de volta', async () => {
    const { tapAt, pressMode, editor } = await selectScreen();
    await tapAt(A);
    await pressMode('Adicionar vértice');

    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(vertexRing('v1')).toBeNull();
    expect(screen.queryByTestId('selection-status')).toBeNull();
    await pressMode('Selecionar');
    expect(vertexRing('v1')).toBeNull();
    expect(status()).toHaveTextContent('Toque em um vértice ou em uma aresta para selecioná-lo.');
  });

  it('trocar de modo não cria histórico', async () => {
    const { tapAt, pressMode, editor } = await selectScreen();
    await tapAt(A);
    const historico = editor().history;
    await pressMode('Conectar');
    await pressMode('Selecionar');

    expect(editor().history).toBe(historico);
  });

  // Cada reinício precisa fechar a folha por si: o pedido da folha guarda o id do elemento (v1), e o exemplo TAMBÉM tem um v1. Sem o reinício, o pedido
  // velho reabriria a folha sobre o vértice A do exemplo (e, num grafo novo, ficaria preso e travaria os toques no canvas por causa da guarda).
  it('Novo grafo com a folha aberta: fecha a folha, limpa a seleção e o canvas volta a aceitar toques', async () => {
    const { tapAt, press, pressMode, editor, measure } = await selectScreen();
    await tapAt(A);
    await press('Editar propriedades do vértice A');
    expect(screen.getByTestId('sheet-input')).toBeOnTheScreen();

    await press(NOVO_ORIENTADO); // com a folha aberta (no teste, a tela de trás continua tocável)
    await measure(360);
    expect(screen.queryByTestId('sheet-input')).toBeNull();
    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(editor().graph.vertices).toHaveLength(0);

    await tapAt(A); // o novo grafo começa em Adicionar vértice: o toque TEM de criar o vértice (a guarda da folha não pode ficar presa)
    expect(editor().graph.vertices).toHaveLength(1);
    await pressMode('Selecionar');
    await tapAt(A);
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('Carregar exemplo com a folha aberta: a folha NÃO reaparece sobre o vértice A do exemplo, e o canvas aceita toques', async () => {
    const { tapAt, press, editor, measure } = await selectScreen();
    await tapAt(A);
    await press('Editar propriedades do vértice A');
    expect(screen.getByTestId('sheet-input')).toBeOnTheScreen();

    await press('Carregar exemplo');
    await measure(360);
    expect(editor().graph.vertices).toHaveLength(4);
    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(screen.queryByTestId('sheet-input')).toBeNull();

    const d = circle('v4');
    await tapAt({ x: d.cx, y: d.cy });
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v4' });
  });

  it('Adicionar vértice e Conectar continuam funcionando, e não deixam seleção', async () => {
    const { tapAt, pressMode, editor } = await selectScreen();
    await tapAt(A);
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 250 });
    expect(editor().graph.vertices).toHaveLength(4);
    expect(editor().selection).toStrictEqual({ type: 'none' });

    await pressMode('Conectar');
    await tapAt(B);
    await tapAt(C);
    expect(editor().graph.edges.map((edge) => `${edge.source}${edge.target}`)).toStrictEqual(['v1v2', 'v1v3', 'v2v3']);
    expect(editor().selection).toStrictEqual({ type: 'none' });
  });

  it('um toque segue UM caminho: em Selecionar não cria vértice nem escolhe origem de conexão', async () => {
    const { tapAt, editor, store } = await selectScreen();
    await tapAt(FUNDO);
    await tapAt(A);

    expect(editor().graph.vertices).toHaveLength(3);
    expect(store.getState().connection.sourceVertexId).toBeUndefined();
  });
});

describe('Editar propriedades (a folha)', () => {
  it('renomear A para "Início": um passo de histórico, o SVG e o resumo atualizam, o id não muda e a seleção continua', async () => {
    const { tapAt, press, typeInSheet, editor } = await selectScreen();
    await tapAt(A);
    const passos = editor().history.past.length;
    await press('Editar propriedades do vértice A');

    expect(screen.getByText('Vértice A')).toBeOnTheScreen();
    expect(screen.getByText('Identificador: v1')).toBeOnTheScreen();
    await typeInSheet('Início');
    expect(textOf('vertex-label-v1')).toBe('A'); // ainda é rascunho
    await press('Salvar alterações');

    expect(screen.queryByTestId('sheet-input')).toBeNull(); // a folha fechou
    expect(editor().graph.vertices[0]).toStrictEqual({ id: 'v1', label: 'Início' });
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(textOf('vertex-label-v1')).toBe('In…'); // o círculo trunca o rótulo (3.5); o completo vai no resumo e na folha
    expect(status()).toHaveTextContent('Vértice Início selecionado.');
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('pesos: 2,5 aparece como 2,5; trocar por 0 mostra 0; remover deixa a aresta SEM peso (cada um é um passo)', async () => {
    const { tapAt, press, typeInSheet, editor } = await selectScreen();
    await tapAt(MEIO_A_B);
    const passos = editor().history.past.length;

    await press('Editar propriedades da aresta entre A e B');
    expect(screen.getByText('Peso atual: sem peso.')).toBeOnTheScreen();
    await typeInSheet('2,5');
    await press('Salvar alterações');
    expect(editor().graph.edges[0]!.weight).toBe(2.5);
    expect(textOf('weight-text-e1')).toBe('2,5');
    expect(status()).toHaveTextContent('Aresta entre A e B selecionada. Peso 2,5.');

    await press('Editar propriedades da aresta entre A e B');
    expect(screen.getByTestId('sheet-input').props.value).toBe('2,5');
    await typeInSheet('0');
    await press('Salvar alterações');
    expect(editor().graph.edges[0]!.weight).toBe(0);
    expect(textOf('weight-text-e1')).toBe('0'); // peso zero APARECE
    expect(status()).toHaveTextContent(/Peso 0./);

    await press('Editar propriedades da aresta entre A e B');
    await typeInSheet('');
    await press('Salvar alterações');
    expect(editor().graph.edges[0]).not.toHaveProperty('weight');
    expect(hasWeightText('e1')).toBe(false); // sem peso: nenhum texto
    expect(status()).toHaveTextContent(/Sem peso./);
    expect(editor().history.past).toHaveLength(passos + 3);
  });

  it('desfazer e refazer um peso pelos botões de histórico', async () => {
    const { tapAt, press, typeInSheet, editor } = await selectScreen();
    await tapAt(MEIO_A_B);
    await press('Editar propriedades da aresta entre A e B');
    await typeInSheet('-3,75');
    await press('Salvar alterações');
    expect(editor().graph.edges[0]!.weight).toBe(-3.75);

    await press('Desfazer');
    expect(editor().graph.edges[0]).not.toHaveProperty('weight');
    await press('Refazer');
    expect(editor().graph.edges[0]!.weight).toBe(-3.75);
  });

  it('Cancelar descarta o rascunho: grafo e histórico intactos', async () => {
    const { tapAt, press, typeInSheet, editor } = await selectScreen();
    await tapAt(A);
    await press('Editar propriedades do vértice A');
    const antes = editor();
    await typeInSheet('Outro');
    await press('Cancelar edição');

    expect(screen.queryByTestId('sheet-input')).toBeNull();
    expect(editor().graph).toBe(antes.graph);
    expect(editor().history).toBe(antes.history);
    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  it('entrada inválida: a folha fica aberta com a mensagem, e o grafo e o histórico não mudam', async () => {
    const { tapAt, press, typeInSheet, editor } = await selectScreen();
    await tapAt(MEIO_A_B);
    await press('Editar propriedades da aresta entre A e B');
    const antes = editor();
    await typeInSheet('abc');
    await press('Salvar alterações');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent(/Digite um número/);
    expect(screen.getByTestId('sheet-input')).toBeOnTheScreen();
    expect(editor().graph).toBe(antes.graph);
    expect(editor().history).toBe(antes.history);
  });

  it('com a folha aberta nenhum toque chega ao canvas: a seleção não muda', async () => {
    const { tapAt, press, editor } = await selectScreen();
    await tapAt(A);
    await press('Editar propriedades do vértice A');
    await tapAt(B);
    await tapAt(FUNDO);

    expect(editor().selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
  });

  // Defeito visto no emulador: a folha (um Modal) montada DENTRO do ScrollView da tela herdava a captura de toques dele. Com o teclado aberto, o
  // ScrollView (keyboardShouldPersistTaps padrão) capturava o toque em Salvar, o botão nunca recebia o toque e o campo perdia o foco: o primeiro
  // toque só fechava o teclado. O Jest não simula o teclado nem a captura, então a garantia é ESTRUTURAL: nenhum ScrollView entre a folha e a raiz.
  it('a folha não é descendente do ScrollView da tela (ele capturaria os toques com o teclado aberto)', async () => {
    const { tapAt, press } = await selectScreen();
    await tapAt(A);
    await press('Editar propriedades do vértice A');

    const ancestors: string[] = [];
    for (let node = screen.getByTestId('properties-sheet').parent; node !== null; node = node.parent) ancestors.push(String(node.type));
    expect(ancestors).not.toContain('RCTScrollView');
    // e o resto da tela continua dentro do ScrollView (a Screen não mudou)
    const canvasAncestors: string[] = [];
    for (let node = screen.getByTestId('canvas-area').parent; node !== null; node = node.parent) canvasAncestors.push(String(node.type));
    expect(canvasAncestors).toContain('RCTScrollView');
  });

  it('abrir, digitar e fechar a folha NÃO desloca o canvas nem muda a câmera (a folha é sobreposta)', async () => {
    const { tapAt, press, typeInSheet } = await selectScreen();
    await tapAt(A);
    const circulos = (['v1', 'v2', 'v3'] as const).map((id) => ({ cx: circle(id).cx, cy: circle(id).cy, r: circle(id).r }));
    const canvas = StyleSheet.flatten(screen.getByTestId('canvas-area').props.style);
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);

    await press('Editar propriedades do vértice A');
    await typeInSheet('Um rótulo bem mais comprido');
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(canvas);
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    await press('Cancelar edição');

    expect((['v1', 'v2', 'v3'] as const).map((id) => ({ cx: circle(id).cx, cy: circle(id).cy, r: circle(id).r }))).toStrictEqual(circulos);
    expect(StyleSheet.flatten(screen.getByTestId('canvas-area').props.style)).toStrictEqual(canvas);
  });
});

describe('Excluir com confirmação', () => {
  it('vértice com arestas: a confirmação diz quantas somem junto; cancelar não altera nada', async () => {
    const { tapAt, press, editor } = await selectScreen();
    await tapAt(A); // A tem as arestas A—B e A—C
    const antes = editor();
    await press('Excluir vértice A');

    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir o vértice A? Também serão removidas 2 arestas conectadas a ele.');
    await press('Cancelar exclusão');
    expect(screen.queryByTestId('sheet-delete-message')).toBeNull();
    expect(editor().graph).toBe(antes.graph);
    expect(editor().history).toBe(antes.history);
  });

  it('confirmar exclui o vértice e as arestas em UM passo, limpa a seleção e some do SVG; desfazer restaura e refazer remove de novo', async () => {
    const { tapAt, press, editor } = await selectScreen();
    await tapAt(A);
    const passos = editor().history.past.length;
    const posicao = { ...circle('v1') };
    await press('Excluir vértice A');
    await press('Confirmar a exclusão do vértice A');

    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3']);
    expect(editor().graph.edges).toHaveLength(0);
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(screen.queryByTestId('vertex-circle-v1', HIDDEN)).toBeNull();
    expect(edgeIds()).toStrictEqual([]);
    expect(vertexRing('v1')).toBeNull();

    await press('Desfazer');
    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(edgeIds()).toStrictEqual(['e1', 'e2']);
    expect(circle('v1')).toMatchObject({ cx: posicao.cx, cy: posicao.cy }); // a posição volta
    await press('Refazer');
    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3']);
  });

  it('aresta: a pergunta cita os extremos e o sentido; confirmar exclui só ELA (os vértices e a aresta oposta ficam)', async () => {
    const { tapAt, press, editor } = await selectScreen({ directed: true, edges: ['A-B', 'B-A'] });
    await tapAt(curveMidpoint('e1')); // a curva A → B
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
    expect(status()).toHaveTextContent(/^Aresta de A para B selecionada./);

    await press('Excluir aresta de A para B');
    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir a aresta de A para B?');
    await press('Confirmar a exclusão da aresta de A para B');

    expect(editor().graph.edges.map((edge) => edge.id)).toStrictEqual(['e2']); // a B → A fica
    expect(editor().graph.vertices).toHaveLength(3);
    expect(editor().selection).toStrictEqual({ type: 'none' });
  });

  it('as duas curvas opostas se selecionam cada uma por si', async () => {
    const { tapAt, editor } = await selectScreen({ directed: true, edges: ['A-B', 'B-A'] });
    await tapAt(curveMidpoint('e1'));
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
    await tapAt(curveMidpoint('e2'));
    expect(editor().selection).toStrictEqual({ type: 'edge', edgeId: 'e2' });
    expect(status()).toHaveTextContent(/^Aresta de B para A selecionada./);
  });

  it('o Excluir de dentro da folha de edição leva à mesma confirmação, separada da edição', async () => {
    const { tapAt, press, editor, user } = await selectScreen();
    await tapAt(C); // C tem só A—C
    await press('Editar propriedades do vértice C');
    await user.press(inSheet('Excluir vértice C'));

    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir o vértice C? Também será removida 1 aresta conectada a ele.');
    expect(screen.queryByTestId('sheet-input')).toBeNull();
    await press('Confirmar a exclusão do vértice C');
    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2']);
  });

  it('os contadores de id continuam crescendo: depois de excluir C, um vértice novo é v4 (nunca v3 de novo)', async () => {
    const { tapAt, press, pressMode, editor } = await selectScreen();
    await tapAt(C);
    await press('Excluir vértice C');
    await press('Confirmar a exclusão do vértice C');
    await pressMode('Adicionar vértice');
    await tapAt({ x: 300, y: 250 });

    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v4']);
  });
});

describe('Selecionar: temas', () => {
  it.each(['light', 'dark'] as const)('tema %s: anel do vértice, halo da aresta e botões usam os tokens do tema', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const { tapAt } = await selectScreen();
    await tapAt(A);
    const ring = screen.getByTestId('vertex-selection-ring-v1', HIDDEN).props.stroke as { payload: number };
    expect(ring.payload >>> 0).toBe((0xff000000 | parseInt(colors[scheme].text.slice(1), 16)) >>> 0);

    await tapAt(MEIO_A_B);
    const halo = screen.getByTestId('edge-selection-e1', HIDDEN).props.stroke as { payload: number };
    expect(halo.payload >>> 0).toBe((0xff000000 | parseInt(colors[scheme].primary.slice(1), 16)) >>> 0);
    expect(screen.getByRole('radio', { name: 'Selecionar', selected: true })).toBeOnTheScreen();
  });
});

describe('Selecionar: o canvas não se desloca', () => {
  it('a linha de estado fica DEPOIS do canvas e a ordem dos elementos não muda ao selecionar, limpar ou abrir a folha', async () => {
    const { tapAt, press } = await selectScreen();
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    await tapAt(A);
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    await tapAt(MEIO_A_B);
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    await press('Editar propriedades da aresta entre A e B');
    expect(layoutOrder()).toStrictEqual(LAYOUT_ORDER);
    expect(StyleSheet.flatten(screen.getByTestId('selection-status-row').props.style).minHeight).toBe(51); // a do botão
  });

  it('o texto da seleção é uma região viva', async () => {
    const { tapAt } = await selectScreen();
    await tapAt(A);

    expect(status().props.accessibilityLiveRegion).toBe('polite');
  });
});
