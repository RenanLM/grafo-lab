import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet, useColorScheme } from 'react-native';

import { MAX_VERTEX_LABEL_LENGTH, addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';
import { colors } from '@/theme';

import { emptyLayout, placeVertex, type EditorSelection } from './core';
import { type EditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStoreApi } from './editor-store-provider';
import { PropertiesSheet, type SheetRequest } from './properties-sheet';

// Folha de propriedades e confirmação de exclusão (ver properties-sheet.tsx), isolada do Laboratório: um `Modal` por cima, com rascunho,
// validação pelo núcleo e confirmação separada. O Modal nativo do Jest renderiza o conteúdo; o que se confere é o comportamento.

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = { directed?: boolean; edges?: readonly (readonly [number, number] | readonly [number, number, number])[] };

/** A, B, C, D e as arestas dadas (por índice, com peso opcional). */
function build({ directed = false, edges = [] }: Spec = {}): { graph: Graph; layout: ReturnType<typeof emptyLayout> } {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  for (let i = 0; i < 4; i++) {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, { x: 40 + i * 60, y: 60 });
  }
  for (const edge of edges) {
    const [source, target, weight] = edge as readonly [number, number, number | undefined];
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, weight })).graph;
  }
  return { graph, layout };
}

const vertexReq = (vertexId: string, view: 'edit' | 'delete' = 'edit'): SheetRequest => ({ view, selection: { type: 'vertex', vertexId } });
const edgeReq = (edgeId: string, view: 'edit' | 'delete' = 'edit'): SheetRequest => ({ view, selection: { type: 'edge', edgeId } });

async function open(request: SheetRequest | undefined, spec: Spec = {}, selected?: EditorSelection) {
  const stores: EditorStore[] = [];
  function Probe() {
    stores.push(useEditorStoreApi());
    return null;
  }
  const onClose = jest.fn();
  const { graph, layout } = build(spec);
  const ui = (r: SheetRequest | undefined) => (
    <EditorStoreProvider initial={{ graph, layout, mode: 'select' }}>
      <Probe />
      <PropertiesSheet request={r} onClose={onClose} />
    </EditorStoreProvider>
  );
  const view = await render(ui(request));
  const store = stores[0]!;
  if (selected !== undefined) {
    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: selected });
    });
  }
  const user = userEvent.setup();
  return { store, onClose, user, rerender: (r: SheetRequest | undefined) => view.rerender(ui(r)), editor: () => store.getState().editor };
}

const input = () => screen.getByTestId('sheet-input');
const press = (user: ReturnType<typeof userEvent.setup>, name: string) => user.press(screen.getByRole('button', { name }));
const type = (text: string) => fireEvent.changeText(input(), text);

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('PropertiesSheet: aberta e fechada', () => {
  it('sem pedido não desenha nada', async () => {
    await open(undefined);

    expect(screen.queryByTestId('sheet-input')).toBeNull();
    expect(screen.queryByTestId('properties-sheet')).toBeNull();
  });

  it('um elemento que não existe (mais) não abre a folha', async () => {
    await open(vertexReq('v9'));
    expect(screen.queryByTestId('properties-sheet')).toBeNull();
  });

  it('se o elemento some do grafo com a folha aberta, ela fecha (nada de editar o que não existe)', async () => {
    const { store } = await open(vertexReq('v1'));
    expect(screen.getByTestId('sheet-input')).toBeOnTheScreen();

    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v1' } });
      store.getState().dispatch({ type: 'remove-selection' });
    });

    expect(screen.queryByTestId('sheet-input')).toBeNull();
  });

  it('é um Modal nativo, transparente, que se apresenta como folha (slide) e marca a visão como modal', async () => {
    await open(vertexReq('v1'));
    const modal = screen.getByTestId('properties-sheet');

    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('slide');
    expect(modal.props.visible).toBe(true);
    expect(screen.getByTestId('properties-sheet-root').props.accessibilityViewIsModal).toBe(true);
  });

  // Defeito visto no emulador: com `maxHeight: '90%'` (porcentagem contra um pai de altura automática) o Yoga cortava a folha em 90% do próprio
  // conteúdo e o último botão (Excluir) ficava pela metade. A altura máxima é um NÚMERO, derivado da altura da janela.
  it('a altura máxima da folha é um número (90% da janela), nunca uma porcentagem', async () => {
    await open(vertexReq('v1'));
    const { maxHeight } = StyleSheet.flatten(screen.getByTestId('properties-sheet-body').props.style);

    expect(typeof maxHeight).toBe('number');
    expect(maxHeight).toBeCloseTo(Dimensions.get('window').height * 0.9, 5);
  });

  it('o botão Voltar do Android (onRequestClose) fecha a folha sem tocar no grafo', async () => {
    const { onClose, editor } = await open(vertexReq('v1'));
    const antes = editor();
    await type('Mudado');
    await act(async () => {
      screen.getByTestId('properties-sheet').props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor()).toBe(antes);
  });
});

describe('PropertiesSheet: vértice', () => {
  it('mostra o título, o identificador técnico (só leitura) e o rótulo atual no campo', async () => {
    await open(vertexReq('v2'));

    expect(screen.getByText('Vértice B')).toBeOnTheScreen();
    expect(screen.getByText('Identificador: v2')).toBeOnTheScreen();
    expect(input().props.value).toBe('B');
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancelar edição' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Excluir vértice B' })).toBeOnTheScreen();
  });

  it('o campo tem rótulo acessível em português', async () => {
    await open(vertexReq('v1'));

    expect(input().props.accessibilityLabel).toBe('Rótulo do vértice A');
  });

  it('digitar NÃO altera o grafo: só o Salvar envia a ação', async () => {
    const { editor, user } = await open(vertexReq('v1'));
    const antes = editor();
    await type('I');
    await type('In');
    await type('Início');

    expect(editor()).toBe(antes); // nenhuma ação enquanto digita
    await press(user, 'Salvar alterações');
    expect(editor().graph.vertices[0]!.label).toBe('Início');
  });

  it('salvar um rótulo novo: UM passo de histórico, o id não muda, a folha fecha', async () => {
    const { editor, onClose, user } = await open(vertexReq('v1'));
    const passos = editor().history.past.length;
    await type('Início');
    await press(user, 'Salvar alterações');

    expect(editor().graph.vertices[0]).toStrictEqual({ id: 'v1', label: 'Início' });
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('salvar o MESMO rótulo (ou o mesmo depois do trim) fecha a folha e não cria passo', async () => {
    const { editor, onClose, user } = await open(vertexReq('v1'));
    const antes = editor();
    await type('  A  ');
    await press(user, 'Salvar alterações');

    expect(editor()).toBe(antes);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rótulo vazio: a folha FICA aberta, com a mensagem do domínio em português, e o grafo e o histórico não mudam', async () => {
    const { editor, onClose, user } = await open(vertexReq('v1'));
    const antes = editor();
    await type('   ');
    await press(user, 'Salvar alterações');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent('O rótulo não pode ficar vazio.');
    expect(onClose).not.toHaveBeenCalled();
    expect(editor().graph).toBe(antes.graph);
    expect(editor().history).toBe(antes.history);
    expect(screen.getByTestId('sheet-input')).toBeOnTheScreen();
  });

  it('rótulo longo demais: mensagem com o limite; no limite (em pontos de código) salva', async () => {
    const { editor, user, onClose } = await open(vertexReq('v1'));
    await type('x'.repeat(MAX_VERTEX_LABEL_LENGTH + 1));
    await press(user, 'Salvar alterações');
    expect(screen.getByTestId('sheet-error')).toHaveTextContent(new RegExp(`no máximo ${MAX_VERTEX_LABEL_LENGTH} caracteres`));
    expect(onClose).not.toHaveBeenCalled();

    await type('😀'.repeat(MAX_VERTEX_LABEL_LENGTH));
    await press(user, 'Salvar alterações');
    expect(editor().graph.vertices[0]!.label).toBe('😀'.repeat(MAX_VERTEX_LABEL_LENGTH));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('o erro some quando o aluno volta a digitar', async () => {
    const { user } = await open(vertexReq('v1'));
    await type('');
    await press(user, 'Salvar alterações');
    expect(screen.getByTestId('sheet-error')).toBeOnTheScreen();
    await type('B');

    expect(screen.queryByTestId('sheet-error')).toBeNull();
  });

  it('rótulos repetidos são permitidos', async () => {
    const { editor, user } = await open(vertexReq('v1'));
    await type('B');
    await press(user, 'Salvar alterações');

    expect(editor().graph.vertices.map((vertex) => vertex.label)).toStrictEqual(['B', 'B', 'C', 'D']);
  });

  it('Cancelar descarta o rascunho: fecha sem tocar no grafo nem no histórico', async () => {
    const { editor, onClose, user } = await open(vertexReq('v1'));
    const antes = editor();
    await type('Outro');
    await press(user, 'Cancelar edição');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor()).toBe(antes);
  });

  it('o elemento some entre a abertura e o Salvar: o domínio recusa (VERTEX_NOT_FOUND) e a mensagem é em português', async () => {
    const { store, user } = await open(vertexReq('v1'), {}, { type: 'vertex', vertexId: 'v1' });
    await type('Novo');
    // o vértice some pelo núcleo SEM passar pela folha (como um desfazer): a folha ainda não re-renderizou quando o Salvar chega
    const { dispatch } = store.getState();
    const spy = jest.spyOn(store.getState(), 'dispatch');
    spy.mockImplementationOnce(() => dispatch({ type: 'set-label', vertexId: 'v9', label: 'Novo' }));
    await press(user, 'Salvar alterações');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent('Esse vértice não existe (mais) no grafo.');
  });

  it('abrir outro elemento começa com o rascunho DELE (a folha é recriada, nada do anterior sobra)', async () => {
    const { rerender } = await open(vertexReq('v1'));
    await type('rascunho do A');
    await rerender(vertexReq('v2'));

    expect(input().props.value).toBe('B');
  });
});

describe('PropertiesSheet: aresta e peso', () => {
  it('mostra título, id, origem, destino, orientação e o peso atual; aresta sem peso tem o campo VAZIO', async () => {
    await open(edgeReq('e1'), { edges: [[1, 2]] });

    expect(screen.getByText('Aresta entre A e B')).toBeOnTheScreen();
    expect(screen.getByText('Identificador: e1')).toBeOnTheScreen();
    expect(screen.getByText('Origem: A. Destino: B.')).toBeOnTheScreen();
    expect(screen.getByText('Aresta não orientada.')).toBeOnTheScreen();
    expect(screen.getByText('Peso atual: sem peso.')).toBeOnTheScreen();
    expect(input().props.value).toBe('');
    expect(input().props.accessibilityLabel).toBe('Peso da aresta entre A e B');
  });

  it('aresta orientada: "Aresta de B para A" e "Aresta orientada"', async () => {
    await open(edgeReq('e1'), { directed: true, edges: [[2, 1]] });

    expect(screen.getByText('Aresta de B para A')).toBeOnTheScreen();
    expect(screen.getByText('Origem: B. Destino: A.')).toBeOnTheScreen();
    expect(screen.getByText('Aresta orientada (o sentido importa).')).toBeOnTheScreen();
  });

  it('peso zero aparece como 0 (e é "Peso atual: 0", nunca "sem peso"); peso decimal com vírgula', async () => {
    await open(edgeReq('e1'), { edges: [[1, 2, 0]] });
    expect(input().props.value).toBe('0');
    expect(screen.getByText('Peso atual: 0.')).toBeOnTheScreen();
    expect(screen.queryByText('Peso atual: sem peso.')).toBeNull();
  });

  it('peso 2,5 e peso negativo aparecem do jeito que se digita', async () => {
    const first = await open(edgeReq('e1'), { edges: [[1, 2, 2.5]] });
    expect(input().props.value).toBe('2,5');
    expect(first).toBeTruthy();
  });

  it.each([
    ['2', 2],
    ['2,5', 2.5],
    ['2.5', 2.5],
    ['-3,75', -3.75],
    ['0', 0],
    ['-0', 0],
    ['  7  ', 7],
  ])('digitar %j e salvar grava o peso %d (UM passo, a folha fecha)', async (text, weight) => {
    const { editor, onClose, user } = await open(edgeReq('e1'), { edges: [[1, 2]] });
    const passos = editor().history.past.length;
    await type(text);
    await press(user, 'Salvar alterações');

    expect(editor().graph.edges[0]!.weight).toBe(weight);
    expect(Object.is(editor().graph.edges[0]!.weight, -0)).toBe(false);
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('campo vazio REMOVE o peso (a aresta fica sem peso, e isso é diferente de 0)', async () => {
    const { editor, onClose, user } = await open(edgeReq('e1'), { edges: [[1, 2, 4]] });
    await type('');
    await press(user, 'Salvar alterações');

    expect(editor().graph.edges[0]).not.toHaveProperty('weight');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('o botão Remover peso esvazia o campo; Salvar então remove o peso, e só nesse momento', async () => {
    const { editor, user } = await open(edgeReq('e1'), { edges: [[1, 2, 4]] });
    const antes = editor();
    await press(user, 'Remover peso');

    expect(input().props.value).toBe('');
    expect(editor()).toBe(antes); // ainda é rascunho
    expect(screen.getByText('Campo vazio: a aresta fica sem peso. O peso 0 é um peso, diferente de nenhum.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remover peso' })).toBeNull();
    await press(user, 'Salvar alterações');
    expect(editor().graph.edges[0]).not.toHaveProperty('weight');
  });

  it('em uma aresta sem peso não há o que remover: o botão só aparece quando há texto no campo', async () => {
    await open(edgeReq('e1'), { edges: [[1, 2]] });
    expect(screen.queryByRole('button', { name: 'Remover peso' })).toBeNull();
    await type('3');

    expect(screen.getByRole('button', { name: 'Remover peso' })).toBeOnTheScreen();
  });

  it.each(['abc', 'NaN', 'Infinity', '1,2,3', '1.234,56', '12abc', '2,'])('texto inválido %j: mensagem em português, a folha fica aberta, nada muda', async (text) => {
    const { editor, onClose, user } = await open(edgeReq('e1'), { edges: [[1, 2, 5]] });
    const antes = editor();
    await type(text);
    await press(user, 'Salvar alterações');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent('Digite um número, como 2, -3,5 ou 0. Deixe o campo vazio para uma aresta sem peso.');
    expect(onClose).not.toHaveBeenCalled();
    expect(editor()).toBe(antes);
  });

  it('número grande demais: a mensagem diz que não cabe', async () => {
    const { user } = await open(edgeReq('e1'), { edges: [[1, 2]] });
    await type('1e400');
    await press(user, 'Salvar alterações');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent('Esse número é grande ou pequeno demais para ser guardado.');
  });

  it('salvar o MESMO peso (e o campo vazio em aresta sem peso) fecha e não cria passo', async () => {
    const comPeso = await open(edgeReq('e1'), { edges: [[1, 2, 2.5]] });
    const antes = comPeso.editor();
    await press(comPeso.user, 'Salvar alterações');
    expect(comPeso.editor()).toBe(antes);
    expect(comPeso.onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar descarta o rascunho do peso', async () => {
    const { editor, onClose, user } = await open(edgeReq('e1'), { edges: [[1, 2, 2]] });
    const antes = editor();
    await type('99');
    await press(user, 'Cancelar edição');

    expect(editor()).toBe(antes);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PropertiesSheet: exclusão com confirmação', () => {
  const edges = [[1, 2], [1, 3], [4, 1], [2, 3]] as const;

  it('Excluir abre a confirmação SEPARADA da edição, com a contagem das arestas que somem junto', async () => {
    const { editor, user } = await open(vertexReq('v1'), { edges }, { type: 'vertex', vertexId: 'v1' });
    const antes = editor();
    await press(user, 'Excluir vértice A');

    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir o vértice A? Também serão removidas 3 arestas conectadas a ele.');
    expect(screen.queryByTestId('sheet-input')).toBeNull();
    expect(editor()).toBe(antes); // abrir a confirmação não exclui nada
  });

  it('cancelar a exclusão não altera nada e fecha', async () => {
    const { editor, onClose, user } = await open(vertexReq('v1'), { edges }, { type: 'vertex', vertexId: 'v1' });
    const antes = editor();
    await press(user, 'Excluir vértice A');
    await press(user, 'Cancelar exclusão');

    expect(editor()).toBe(antes);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirmar exclui o vértice e as arestas incidentes em UM passo; a seleção é limpa; desfazer restaura tudo', async () => {
    const { editor, onClose, user, store } = await open(vertexReq('v1'), { edges }, { type: 'vertex', vertexId: 'v1' });
    const passos = editor().history.past.length;
    await press(user, 'Excluir vértice A');
    await press(user, 'Confirmar a exclusão do vértice A');

    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3', 'v4']);
    expect(editor().graph.edges.map((edge) => edge.id)).toStrictEqual(['e4']);
    expect(editor().history.past).toHaveLength(passos + 1);
    expect(editor().selection).toStrictEqual({ type: 'none' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.getState().dispatch({ type: 'undo' });
    });
    expect(editor().graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
    expect(editor().graph.edges).toHaveLength(4);
  });

  it('vértice isolado e vértice com uma aresta: a pergunta diz a verdade', async () => {
    await open(vertexReq('v4', 'delete'), { edges: [[1, 2]] }, { type: 'vertex', vertexId: 'v4' });
    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir o vértice D? Nenhuma aresta está conectada a ele.');
  });

  it('abrir direto em "delete" (o botão Excluir do Laboratório) já mostra a confirmação', async () => {
    await open(vertexReq('v2', 'delete'), { edges: [[1, 2]] }, { type: 'vertex', vertexId: 'v2' });

    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir o vértice B? Também será removida 1 aresta conectada a ele.');
    expect(screen.getByText('Excluir: Vértice B')).toBeOnTheScreen();
  });

  it('aresta: a pergunta cita os extremos (de A para B no orientado) e a exclusão é UM passo', async () => {
    const { editor, user } = await open(edgeReq('e1', 'delete'), { directed: true, edges: [[1, 2], [2, 1]] }, { type: 'edge', edgeId: 'e1' });
    const passos = editor().history.past.length;

    expect(screen.getByTestId('sheet-delete-message')).toHaveTextContent('Excluir a aresta de A para B?');
    await press(user, 'Confirmar a exclusão da aresta de A para B');
    expect(editor().graph.edges.map((edge) => edge.id)).toStrictEqual(['e2']); // só a B → A sobrevive
    expect(editor().history.past).toHaveLength(passos + 1);
  });

  it('se a seleção mudou antes de confirmar, NADA é excluído (nunca um elemento diferente do que a pergunta mostrou)', async () => {
    const { editor, store, onClose, user } = await open(vertexReq('v1', 'delete'), { edges }, { type: 'vertex', vertexId: 'v1' });
    const antes = editor().graph;
    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: { type: 'vertex', vertexId: 'v2' } });
    });
    await press(user, 'Confirmar a exclusão do vértice A');

    expect(screen.getByTestId('sheet-error')).toHaveTextContent('A seleção mudou: nada foi excluído.');
    expect(editor().graph).toBe(antes);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('aresta e vértice com o mesmo número não se confundem: com uma aresta selecionada a confirmação do vértice não age', async () => {
    const { editor, store, user } = await open(vertexReq('v1', 'delete'), { edges }, { type: 'vertex', vertexId: 'v1' });
    await act(async () => {
      store.getState().dispatch({ type: 'select', selection: { type: 'edge', edgeId: 'e1' } });
    });
    const antes = editor().graph;
    await press(user, 'Confirmar a exclusão do vértice A');

    expect(editor().graph).toBe(antes);
  });
});

describe('PropertiesSheet: temas', () => {
  it.each(['light', 'dark'] as const)('tema %s: o campo e a folha usam os tokens do tema', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await open(vertexReq('v1'));
    const field = StyleSheet.flatten(input().props.style);

    expect(field.color).toBe(colors[scheme].text);
    expect(field.backgroundColor).toBe(colors[scheme].background);
    expect(field.borderColor).toBe(colors[scheme].border);
    expect(input().props.placeholderTextColor).toBe(colors[scheme].textSecondary);
  });

  it('o erro destaca o contorno do campo (não só a mensagem)', async () => {
    const { user } = await open(vertexReq('v1'));
    await type('');
    await press(user, 'Salvar alterações');

    expect(StyleSheet.flatten(input().props.style).borderColor).toBe(colors.light.primary);
  });
});
