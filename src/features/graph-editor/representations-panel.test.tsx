import { render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';

import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';
import { colors } from '@/theme';

import { REPRESENTATION_KINDS, REPRESENTATION_TITLES, type RepresentationKind } from './core';
import { RepresentationsPanel } from './representations-panel';

// Painel "Representações do grafo" (ver representations-panel.tsx e representation-content.tsx), isolado da tela: recebe um grafo e desenha. O que o adaptador puro calcula já tem seus testes
// (core/representation-view.test.ts); aqui se confere o que a interface FAZ com o modelo: abas, tabelas, listas, legendas, estados vazios, limites, temas e a descrição acessível das células.

const HIDDEN = { includeHiddenElements: true } as const;

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type EdgeSpec = readonly [source: number, target: number, weight?: number];

function graphOf(labels: readonly (string | undefined)[], edges: readonly EdgeSpec[] = [], directed = false): Graph {
  let graph = createGraph({ id: 'g', directed });
  for (const label of labels) graph = must(addVertex(graph, label)).graph;
  for (const [source, target, weight] of edges) {
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, ...(weight === undefined ? {} : { weight }) })).graph;
  }
  return graph;
}

/** O dígrafo do enunciado: A, B, C isolado; e1: A → B com peso 0; e2: B → A sem peso. */
const digraph = (): Graph => graphOf([undefined, undefined, undefined], [[1, 2, 0], [2, 1]], true);

async function mount(graph: Graph, props: { initiallyExpanded?: boolean; initialKind?: RepresentationKind } = {}) {
  const view = await render(<RepresentationsPanel graph={graph} {...props} />);
  const user = userEvent.setup();
  const toggle = () => screen.getByRole('button', { name: 'Representações do grafo' });
  const tab = (kind: RepresentationKind) => screen.getByRole('tab', { name: REPRESENTATION_TITLES[kind] });
  return { ...view, user, toggle, tab };
}

const open = (graph: Graph, kind: RepresentationKind = 'adjacency-list') => mount(graph, { initiallyExpanded: true, initialKind: kind });
const cell = (testID: string) => screen.getByTestId(testID);

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('o painel: recolhido, expandido e as abas', () => {
  it('começa RECOLHIDO: só o título, com o estado acessível `expanded = false`, e nenhuma aba nem conteúdo', async () => {
    const { toggle } = await mount(digraph());

    expect(toggle()).toBeOnTheScreen();
    expect(toggle().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('representation-content')).toBeNull();
    expect(screen.queryByTestId('representations-body')).toBeNull();
  });

  it('tocar no título expande (`expanded = true`) e tocar de novo recolhe', async () => {
    const { toggle, user } = await mount(digraph());
    await user.press(toggle());

    expect(toggle().props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    await user.press(toggle());
    expect(toggle().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('o título é o nome acessível do painel e a dica muda com o estado', async () => {
    const { toggle, user } = await mount(digraph());

    expect(toggle().props.accessibilityHint).toBe('Toque para expandir e ver as quatro representações deste grafo');
    await user.press(toggle());
    expect(toggle().props.accessibilityHint).toBe('Toque para recolher o painel');
  });

  it('quatro abas, na ordem do painel, dentro de uma lista de abas; a lista de adjacência vem escolhida', async () => {
    await open(digraph());

    // o grupo NÃO é `accessible` de propósito (isso esconderia as abas dos leitores de tela): o papel é lido pelo rótulo
    expect(screen.getByLabelText('Representação mostrada').props.accessibilityRole).toBe('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toStrictEqual(REPRESENTATION_KINDS.map((kind) => REPRESENTATION_TITLES[kind]));
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toStrictEqual([true, false, false, false]);
  });

  it('só uma aba fica ativa por vez, e cada uma mostra a sua representação', async () => {
    const { tab, user } = await open(digraph());

    for (const kind of REPRESENTATION_KINDS) {
      await user.press(tab(kind));
      const selected = screen.getAllByRole('tab').filter((candidate) => candidate.props.accessibilityState.selected);
      expect(selected).toHaveLength(1);
      expect(selected[0]!.props.accessibilityLabel).toBe(REPRESENTATION_TITLES[kind]);
      expect(within(screen.getByTestId('representation-content')).getAllByText(REPRESENTATION_TITLES[kind]).length).toBeGreaterThan(0);
    }
  });

  it('a aba escolhida é lembrada quando o painel é recolhido e expandido de novo', async () => {
    const { toggle, tab, user } = await open(digraph());
    await user.press(tab('incidence-matrix'));
    await user.press(toggle()); // recolhe
    await user.press(toggle()); // expande

    expect(tab('incidence-matrix').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('incidence-cell-v1-e1')).toBeOnTheScreen();
  });

  it('cada célula, cada cabeçalho e cada linha de lista é UM elemento acessível (`accessible`), nas quatro representações', async () => {
    const { tab, user } = await open(digraph(), 'adjacency-list');
    expect(screen.getByTestId('list-line-entry-v1-e1').props.accessible).toBe(true);
    expect(screen.getByTestId('list-line-vertex-v3').props.accessible).toBe(true);

    await user.press(tab('adjacency-matrix'));
    for (const id of ['adjacency-cell-v1-v2', 'adjacency-cell-v3-v3', 'adjacency-row-v1', 'adjacency-column-v3']) {
      expect(cell(id).props.accessible).toBe(true);
    }
    await user.press(tab('incidence-matrix'));
    for (const id of ['incidence-cell-v1-e1', 'incidence-cell-v3-e2', 'incidence-row-v2', 'incidence-column-e1']) {
      expect(cell(id).props.accessible).toBe(true);
    }
    await user.press(tab('incidence-list'));
    expect(screen.getAllByTestId(/^list-line-/).every((line) => line.props.accessible === true)).toBe(true);
  });
});

describe('lista de adjacência (o dígrafo do enunciado)', () => {
  it('mostra cada vértice e seus vizinhos com a aresta e o peso; o isolado aparece com `Sem vizinhos`', async () => {
    await open(digraph(), 'adjacency-list');

    expect(screen.getAllByTestId(/^list-line-/)).toHaveLength(6);
    expect(screen.getByText('A (v1)')).toBeOnTheScreen();
    expect(screen.getByText('→ B (v2) | e1 | peso 0')).toBeOnTheScreen();
    expect(screen.getByText('B (v2)')).toBeOnTheScreen();
    expect(screen.getByText('→ A (v1) | e2 | sem peso')).toBeOnTheScreen();
    expect(screen.getByText('C (v3)')).toBeOnTheScreen();
    expect(screen.getByText('Sem vizinhos')).toBeOnTheScreen();
  });

  it('cada linha é um elemento acessível com a descrição falada completa', async () => {
    await open(digraph(), 'adjacency-list');

    expect(screen.getByLabelText('A, vértice v1: aresta e1 para B, vértice v2, com peso zero.')).toBeOnTheScreen();
    expect(screen.getByLabelText('B, vértice v2: aresta e2 para A, vértice v1, sem peso.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vértice C, vértice v3: sem vizinhos.')).toBeOnTheScreen();
  });

  it('não orientado: o travessão e a mesma aresta nas duas pontas', async () => {
    await open(graphOf(['A', 'B'], [[1, 2, 2.5]]), 'adjacency-list');

    expect(screen.getByText('— B (v2) | e1 | peso 2,5')).toBeOnTheScreen();
    expect(screen.getByText('— A (v1) | e1 | peso 2,5')).toBeOnTheScreen();
    expect(screen.getByText('Cada aresta aparece nas duas pontas, com o mesmo identificador.')).toBeOnTheScreen();
  });

  it('mostra a nota de que cada linha lista os arcos que SAEM do vértice (orientado)', async () => {
    await open(digraph(), 'adjacency-list');

    expect(screen.getByText('Cada linha lista os arcos que SAEM do vértice.')).toBeOnTheScreen();
  });
});

describe('matriz de adjacência', () => {
  it('peso zero (0), aresta sem peso (×) e ausência (—) aparecem distintos, com cabeçalhos de rótulo e id', async () => {
    await open(digraph(), 'adjacency-matrix');

    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('0');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('×');
    expect(cell('adjacency-cell-v1-v1')).toHaveTextContent('—');
    expect(cell('adjacency-cell-v3-v1')).toHaveTextContent('—');
    expect(cell('adjacency-cell-v1-v3')).toHaveTextContent('—');
    expect(cell('adjacency-column-v2')).toHaveTextContent('Bv2');
    expect(cell('adjacency-row-v1')).toHaveTextContent('Av1');
  });

  it('cada célula é um elemento com a descrição completa: origem, destino, aresta e peso', async () => {
    await open(digraph(), 'adjacency-matrix');

    expect(cell('adjacency-cell-v1-v2').props.accessibilityLabel).toBe('Origem A, vértice v1; destino B, vértice v2; aresta e1 com peso zero.');
    expect(cell('adjacency-cell-v2-v1').props.accessibilityLabel).toBe('Origem B, vértice v2; destino A, vértice v1; aresta e2 sem peso.');
    expect(cell('adjacency-cell-v1-v3').props.accessibilityLabel).toBe('Origem A, vértice v1; destino C, vértice v3; não existe aresta.');
    expect(screen.getByLabelText('Origem A, vértice v1; destino B, vértice v2; aresta e1 com peso zero.')).toBeOnTheScreen();
  });

  it('os cabeçalhos dizem se são linha ou coluna, com o rótulo e o id falados', async () => {
    await open(digraph(), 'adjacency-matrix');

    expect(cell('adjacency-row-v2').props.accessibilityLabel).toBe('Linha B, vértice v2');
    expect(cell('adjacency-column-v3').props.accessibilityLabel).toBe('Coluna C, vértice v3');
  });

  it('a legenda diz o que cada símbolo significa e a nota explica a matriz binária tradicional e a direção', async () => {
    await open(digraph(), 'adjacency-matrix');

    const legend = within(screen.getByTestId('representation-legend'));
    expect(legend.getByText('Legenda')).toBeOnTheScreen();
    expect(legend.getByText('= não existe aresta')).toBeOnTheScreen();
    expect(legend.getByText('= existe aresta sem peso')).toBeOnTheScreen();
    expect(legend.getByText('= existe aresta com peso zero')).toBeOnTheScreen();
    expect(screen.getByLabelText('traço: não existe aresta')).toBeOnTheScreen();
    expect(screen.getByLabelText('sinal de vezes: existe aresta sem peso')).toBeOnTheScreen();
    expect(screen.getByText(/A matriz binária tradicional de adjacência usa 0 e 1/)).toBeOnTheScreen();
    expect(screen.getByText('Linha = vértice de origem; coluna = vértice de destino. Arcos opostos ocupam células diferentes.')).toBeOnTheScreen();
    expect(screen.getByText('Tamanho: 3 × 3')).toBeOnTheScreen();
  });

  it('não orientado: a matriz é simétrica na tela (a mesma aresta nas duas células)', async () => {
    await open(graphOf(['A', 'B', 'C'], [[1, 2, 2.5], [2, 3]]), 'adjacency-matrix');

    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('2,5');
    expect(cell('adjacency-cell-v2-v1')).toHaveTextContent('2,5');
    expect(cell('adjacency-cell-v2-v3')).toHaveTextContent('×');
    expect(cell('adjacency-cell-v3-v2')).toHaveTextContent('×');
    expect(screen.getByText(/Matriz simétrica/)).toBeOnTheScreen();
  });

  it('pesos negativos e fracionários aparecem como número (vírgula decimal)', async () => {
    await open(graphOf(['A', 'B', 'C'], [[1, 2, -2], [1, 3, 0.5]]), 'adjacency-matrix');

    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('-2');
    expect(cell('adjacency-cell-v1-v3')).toHaveTextContent('0,5');
  });

  it('rolagem horizontal própria da tabela, dentro da página', async () => {
    await open(digraph(), 'adjacency-matrix');

    expect(screen.getByTestId('representation-scroll').props.horizontal).toBe(true);
    expect(screen.getByTestId('representation-scroll').props.nestedScrollEnabled).toBe(true);
  });

  it('os cabeçalhos das LINHAS ficam fora da área que rola (congelados) e as colunas e as células ficam dentro', async () => {
    await open(digraph(), 'adjacency-matrix');

    const scroller = within(screen.getByTestId('representation-scroll'));
    expect(scroller.queryByTestId('adjacency-row-v1')).toBeNull();
    expect(scroller.getByTestId('adjacency-column-v1')).toBeOnTheScreen();
    expect(scroller.getByTestId('adjacency-cell-v1-v2')).toBeOnTheScreen();
    expect(within(screen.getByTestId('representation-table')).getByTestId('adjacency-row-v1')).toBeOnTheScreen();
  });

  it('rótulos repetidos: o id técnico no cabeçalho distingue os vértices', async () => {
    await open(graphOf(['X', 'X'], [[1, 2]]), 'adjacency-matrix');

    expect(cell('adjacency-column-v1')).toHaveTextContent('Xv1');
    expect(cell('adjacency-column-v2')).toHaveTextContent('Xv2');
    expect(cell('adjacency-cell-v1-v2').props.accessibilityLabel).toBe('Linha X, vértice v1; coluna X, vértice v2; aresta e1 sem peso.');
  });
});

describe('matriz de incidência', () => {
  it('orientado: +1 na origem, -1 no destino, 0 fora; C tem zero em todas as colunas', async () => {
    await open(digraph(), 'incidence-matrix');

    expect(cell('incidence-cell-v1-e1')).toHaveTextContent('+1');
    expect(cell('incidence-cell-v2-e1')).toHaveTextContent('-1');
    expect(cell('incidence-cell-v2-e2')).toHaveTextContent('+1');
    expect(cell('incidence-cell-v1-e2')).toHaveTextContent('-1');
    expect(cell('incidence-cell-v3-e1')).toHaveTextContent('0');
    expect(cell('incidence-cell-v3-e2')).toHaveTextContent('0');
  });

  it('não orientado: 1 nas duas pontas e 0 fora', async () => {
    await open(graphOf(['A', 'B', 'C'], [[1, 2]]), 'incidence-matrix');

    expect(cell('incidence-cell-v1-e1')).toHaveTextContent('1');
    expect(cell('incidence-cell-v2-e1')).toHaveTextContent('1');
    expect(cell('incidence-cell-v3-e1')).toHaveTextContent('0');
    expect(screen.queryByText('-1')).toBeNull();
  });

  it('o peso NÃO entra nos valores: a descrição da aresta traz o peso, separada, e o cabeçalho traz o id e os extremos', async () => {
    await open(digraph(), 'incidence-matrix');

    expect(cell('incidence-column-e1')).toHaveTextContent('e1A → B');
    expect(screen.getByTestId('incidence-edge-e1')).toHaveTextContent('e1: de A (v1) para B (v2), peso 0');
    expect(screen.getByTestId('incidence-edge-e2')).toHaveTextContent('e2: de B (v2) para A (v1), sem peso');
    expect(within(screen.getByTestId('incidence-edges')).getByText('Arestas')).toBeOnTheScreen();
  });

  it('a descrição falada de cada célula lê o sinal e o papel do vértice', async () => {
    await open(digraph(), 'incidence-matrix');

    expect(cell('incidence-cell-v1-e1').props.accessibilityLabel).toBe('Vértice A, vértice v1; aresta e1, de A para B: o vértice é a origem, a aresta sai dele, valor mais um.');
    expect(cell('incidence-cell-v2-e1').props.accessibilityLabel).toBe('Vértice B, vértice v2; aresta e1, de A para B: o vértice é o destino, a aresta entra nele, valor menos um.');
    expect(cell('incidence-cell-v3-e1').props.accessibilityLabel).toBe('Vértice C, vértice v3; aresta e1: o vértice não é extremo da aresta, valor zero.');
    expect(cell('incidence-column-e1').props.accessibilityLabel).toBe('Coluna aresta e1: de A (v1) para B (v2), peso 0');
  });

  it('a legenda traz +1, -1 e 0 (orientado) e avisa que outras fontes podem inverter os sinais', async () => {
    await open(digraph(), 'incidence-matrix');

    const legend = within(screen.getByTestId('representation-legend'));
    expect(legend.getByText('= a aresta sai do vértice (ele é a origem)')).toBeOnTheScreen();
    expect(legend.getByText('= a aresta entra no vértice (ele é o destino)')).toBeOnTheScreen();
    expect(legend.getByText('= o vértice não é extremo da aresta')).toBeOnTheScreen();
    expect(screen.getByLabelText('menos um: a aresta entra no vértice (ele é o destino)')).toBeOnTheScreen();
    expect(screen.getByText('É a convenção do livro-texto da disciplina; outras fontes podem inverter os sinais.')).toBeOnTheScreen();
    expect(screen.getByText('Tamanho: 3 × 2 (vértices × arestas)')).toBeOnTheScreen();
  });

  it('sem arestas: explica que a matriz não tem colunas (e não finge uma tabela)', async () => {
    await open(graphOf(['A', 'B']), 'incidence-matrix');

    expect(screen.getByTestId('representation-notice')).toHaveTextContent('O grafo ainda não tem arestas: a matriz de incidência não tem colunas. Conecte dois vértices para vê-la.');
    expect(screen.queryByTestId('representation-table')).toBeNull();
  });
});

describe('lista de incidência', () => {
  it('saída, entrada e o vértice isolado sem arestas incidentes', async () => {
    await open(digraph(), 'incidence-list');

    expect(screen.getByText('e1: saída para B (v2) | peso 0')).toBeOnTheScreen();
    expect(screen.getByText('e2: entrada de B (v2) | sem peso')).toBeOnTheScreen();
    expect(screen.getByText('e1: entrada de A (v1) | peso 0')).toBeOnTheScreen();
    expect(screen.getByText('e2: saída para A (v1) | sem peso')).toBeOnTheScreen();
    expect(screen.getByText('Nenhuma aresta incidente')).toBeOnTheScreen();
    expect(screen.getByLabelText('A, vértice v1: a aresta e1 sai de A e vai para B, vértice v2; com peso zero.')).toBeOnTheScreen();
  });

  it('não orientado: não inventa direção (`liga a`)', async () => {
    await open(graphOf(['A', 'B'], [[1, 2]]), 'incidence-list');

    expect(screen.getAllByText(/liga a/)).toHaveLength(2);
    expect(screen.queryByText(/saída/)).toBeNull();
    expect(screen.queryByText(/entrada/)).toBeNull();
  });
});

describe('grafos vazios e casos especiais', () => {
  it('sem vértices: cada aba diz que não há o que mostrar', async () => {
    const { tab, user } = await open(createGraph({ id: 'g' }));

    for (const kind of REPRESENTATION_KINDS) {
      await user.press(tab(kind));
      expect(screen.getByTestId('representation-notice')).toHaveTextContent(/O grafo não tem vértices: não há o que mostrar\./);
    }
  });

  it('vértices e nenhuma aresta: as listas e a matriz de adjacência mostram os vértices (ausência de aresta não é ausência de vértice)', async () => {
    const { tab, user } = await open(graphOf(['A', 'B']), 'adjacency-list');

    expect(screen.getAllByText('Sem vizinhos')).toHaveLength(2);
    await user.press(tab('adjacency-matrix'));
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('—');
    await user.press(tab('incidence-list'));
    expect(screen.getAllByText('Nenhuma aresta incidente')).toHaveLength(2);
  });

  it('rótulos Unicode inteiros nas células e nos cabeçalhos', async () => {
    await open(graphOf(['Ação', '🚀'], [[1, 2, 1.5]]), 'adjacency-matrix');

    expect(cell('adjacency-column-v1')).toHaveTextContent('Açãov1');
    expect(cell('adjacency-column-v2')).toHaveTextContent('🚀v2');
    expect(cell('adjacency-cell-v1-v2').props.accessibilityLabel).toBe('Linha Ação, vértice v1; coluna 🚀, vértice v2; aresta e1 com peso 1,5.');
  });
});

describe('limites de legibilidade', () => {
  const sized = (count: number) => graphOf(Array(count).fill(undefined));

  it('uma matriz com 20 × 20 = 400 células (o limite, inclusive) ainda é exibida inteira, da primeira à última célula', async () => {
    await open(sized(20), 'adjacency-matrix');

    expect(screen.getByTestId('representation-table')).toBeOnTheScreen();
    expect(screen.getByTestId('adjacency-cell-v1-v1')).toBeOnTheScreen();
    expect(screen.getByTestId('adjacency-cell-v20-v20')).toBeOnTheScreen();
    expect(screen.queryByTestId('representation-too-large')).toBeNull();
  });

  it('matriz grande demais: mensagem exata, dimensões, sugestão de lista e nenhuma célula materializada', async () => {
    await open(sized(21), 'adjacency-matrix');

    const notice = within(screen.getByTestId('representation-too-large'));
    expect(notice.getByText('Esta matriz possui muitas células para ser exibida integralmente nesta tela.')).toBeOnTheScreen();
    expect(notice.getByText('Dimensões: 21 × 21 (441 células); o limite de apresentação é 400.')).toBeOnTheScreen();
    expect(notice.getByText('Use a lista de adjacência para ver este grafo.')).toBeOnTheScreen();
    expect(screen.queryByTestId('representation-table')).toBeNull();
    expect(screen.queryByTestId('adjacency-cell-v1-v2')).toBeNull();
  });

  it('o botão da sugestão abre a lista de adjacência', async () => {
    const { user, tab } = await open(sized(21), 'adjacency-matrix');
    await user.press(screen.getByRole('button', { name: 'Abrir a lista de adjacência' }));

    expect(tab('adjacency-list').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('A (v1)')).toBeOnTheScreen();
  });

  it('matriz de incidência grande demais (V × E): sugere a lista de incidência', async () => {
    const edges: EdgeSpec[] = [];
    for (let i = 1; i <= 8; i++) for (let j = i + 1; j <= 8; j++) edges.push([i, j]);
    const graph = graphOf(Array(30).fill(undefined), [...edges, ...[...Array(12).keys()].map((k): EdgeSpec => [9 + k, 21 + (k % 9)])]);
    await open(graph, 'incidence-matrix');

    expect(screen.getByTestId('representation-too-large')).toBeOnTheScreen();
    expect(screen.getByText('Use a lista de incidência para ver este grafo.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Abrir a lista de incidência' })).toBeOnTheScreen();
  });

  it('listas longas: a primeira página, o aviso do que não aparece e o botão que mostra mais, até acabar', async () => {
    const edges: EdgeSpec[] = [];
    for (let i = 2; i <= 40; i++) edges.push([1, i]); // estrela com 40 vértices: 40 linhas de vértice + 39 + 39 entradas
    const { user } = await open(graphOf(Array(40).fill(undefined), edges), 'adjacency-list');

    expect(screen.getAllByTestId(/^list-line-/)).toHaveLength(60);
    expect(screen.getByTestId('representation-list-more')).toHaveTextContent('Mostrando 60 de 118 linhas; 58 linhas não estão sendo exibidas.');
    await user.press(screen.getByRole('button', { name: 'Mostrar mais' }));
    expect(screen.getAllByTestId(/^list-line-/)).toHaveLength(118);
    expect(screen.queryByTestId('representation-list-more')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mostrar mais' })).toBeNull();
  });

  it('listas curtas não mostram aviso nem botão', async () => {
    await open(digraph(), 'adjacency-list');

    expect(screen.queryByTestId('representation-list-more')).toBeNull();
  });
});

describe('temas claro e escuro', () => {
  it.each(['light', 'dark'] as const)('tema %s: os cabeçalhos e as células usam os tokens do tema', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await open(digraph(), 'adjacency-matrix');

    expect(StyleSheet.flatten(cell('adjacency-column-v1').props.style).backgroundColor).toBe(colors[scheme].surfaceMuted);
    expect(StyleSheet.flatten(cell('adjacency-cell-v1-v2').props.style).backgroundColor).toBe(colors[scheme].surface);
    expect(StyleSheet.flatten(cell('adjacency-cell-v1-v2').props.style).borderColor).toBe(colors[scheme].border);
    const value = within(cell('adjacency-cell-v1-v2')).getByText('0');
    expect(StyleSheet.flatten(value.props.style).color).toBe(colors[scheme].primary);
    const absent = within(cell('adjacency-cell-v1-v1')).getByText('—');
    expect(StyleSheet.flatten(absent.props.style).color).toBe(colors[scheme].textSecondary);
  });

  it('o significado não depende só de cor: o valor, o sinal e o símbolo estão no texto', async () => {
    await open(digraph(), 'incidence-matrix');

    const values = ['v1', 'v2', 'v3'].flatMap((vertex) => ['e1', 'e2'].map((edge) => cell(`incidence-cell-${vertex}-${edge}`).props.accessibilityLabel as string));
    expect(values.every((label) => /valor (mais um|menos um|zero|um)/.test(label))).toBe(true);
  });
});

describe('o painel se atualiza quando o grafo recebido muda', () => {
  it('um grafo novo troca o conteúdo na hora, na aba ativa', async () => {
    const view = await open(digraph(), 'adjacency-matrix');
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('0');

    await view.rerender(<RepresentationsPanel graph={graphOf(['A', 'B'], [[1, 2, 7]], true)} initiallyExpanded initialKind="adjacency-matrix" />);
    expect(cell('adjacency-cell-v1-v2')).toHaveTextContent('7');
    expect(screen.queryByTestId('adjacency-cell-v3-v1')).toBeNull();
  });
});

describe('recolhido não desenha nada do conteúdo', () => {
  it('mesmo com um grafo grande, o painel recolhido só tem o título', async () => {
    await mount(graphOf(Array(50).fill(undefined)));

    expect(screen.queryAllByTestId(/^list-line-/, HIDDEN)).toHaveLength(0);
    expect(screen.queryByTestId('representation-table')).toBeNull();
    expect(screen.getByTestId('representations-panel')).toBeOnTheScreen();
  });
});
