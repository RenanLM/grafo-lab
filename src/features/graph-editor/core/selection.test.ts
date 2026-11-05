import { addEdge, addVertex, createGraph, setEdgeWeight, type Result } from '@/domain/graph';

import {
  NEUTRAL_CAMERA,
  SELECT_IDLE_MESSAGE,
  applyAction,
  createEditorState,
  edgeGeometries,
  emptyLayout,
  hitTest,
  placeVertex,
  selectionStatusMessage,
  tapToSelectionAction,
  worldToScreen,
  type Camera,
  type EditorAction,
  type EditorMode,
  type EditorState,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Seleção por toque (ver selection.ts). O hit-testing não é refeito aqui: os testes usam o `hitTest` do 3.3 como oráculo, e conferem os
// casos com contas feitas à mão. Quem aplica a ação é o `applyAction`; a seleção é por id técnico e fica fora do histórico.

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = {
  mode?: EditorMode;
  directed?: boolean;
  /** Vértices v1, v2… nas posições do MUNDO dadas. */
  vertices?: readonly (readonly [number, number])[];
  /** Arestas por índice de vértice (1-based), com peso opcional. */
  edges?: readonly (readonly [number, number] | readonly [number, number, number])[];
};

function stateOf({ mode = 'select', directed = false, vertices = [[60, 60], [200, 60], [130, 200]], edges = [] }: Spec = {}): EditorState {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  for (const edge of edges) {
    const [source, target, weight] = edge as readonly [number, number, number | undefined];
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, weight })).graph;
  }
  return createEditorState({ graph, layout, mode });
}

const tap = (state: EditorState, screenPoint: Point, camera: Camera = NEUTRAL_CAMERA) =>
  tapToSelectionAction(state, camera, screenPoint, VIEWPORT);

const selectVertex = (vertexId: string): EditorAction => ({ type: 'select', selection: { type: 'vertex', vertexId } });
const selectEdge = (edgeId: string): EditorAction => ({ type: 'select', selection: { type: 'edge', edgeId } });
const CLEAR: EditorAction = { type: 'clear-selection' };

describe('tapToSelectionAction: o que o toque seleciona', () => {
  it('toque no centro de um vértice seleciona o vértice (pelo id técnico)', () => {
    const state = stateOf();

    expect(tap(state, point(60, 60))).toStrictEqual(selectVertex('v1'));
    expect(tap(state, point(200, 60))).toStrictEqual(selectVertex('v2'));
    expect(tap(state, point(130, 200))).toStrictEqual(selectVertex('v3'));
  });

  it('o alvo de toque do vértice é de 48 dp: a 23 dp do centro acerta; a 25 dp é o fundo', () => {
    const state = stateOf();

    expect(tap(state, point(60 + 23, 60))).toStrictEqual(selectVertex('v1'));
    expect(tap(state, point(60 + 25, 60))).toStrictEqual(CLEAR);
  });

  it('toque sobre uma aresta seleciona a aresta (o ponto médio de v1—v2 fica longe dos dois vértices)', () => {
    const state = stateOf({ edges: [[1, 2]] });

    expect(tap(state, point(130, 60))).toStrictEqual(selectEdge('e1'));
    expect(tap(state, point(130, 60 + 11))).toStrictEqual(selectEdge('e1')); // dentro da tolerância de 12 dp
    expect(tap(state, point(130, 60 + 13))).toStrictEqual(CLEAR);
  });

  it('toque no fundo limpa a seleção', () => {
    expect(tap(stateOf(), point(320, 280))).toStrictEqual(CLEAR);
    expect(tap(stateOf({ vertices: [] }), point(100, 100))).toStrictEqual(CLEAR); // até em um grafo vazio
  });

  it('vértice sobre aresta: o vértice vence (prioridade vértice > aresta > fundo)', () => {
    const state = stateOf({ vertices: [[60, 60], [200, 60], [130, 60]], edges: [[1, 2]] }); // v3 em cima da aresta v1—v2

    expect(tap(state, point(130, 60))).toStrictEqual(selectVertex('v3'));
  });

  it('a mesma ação para o mesmo toque (determinismo) e um objeto novo a cada vez', () => {
    const state = stateOf();
    const a = tap(state, point(60, 60));
    const b = tap(state, point(60, 60));

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('tapToSelectionAction: vértices próximos, arestas cruzadas e arcos opostos', () => {
  it('dois vértices a 30 dp: o toque escolhe o mais perto; no meio exato, empata pela ordem de inserção (v1), sempre igual', () => {
    const state = stateOf({ vertices: [[60, 60], [90, 60]] });

    expect(tap(state, point(70, 60))).toStrictEqual(selectVertex('v1')); // 10 dp de v1 e 20 de v2
    expect(tap(state, point(80, 60))).toStrictEqual(selectVertex('v2')); // 20 dp de v1 e 10 de v2
    for (let i = 0; i < 5; i++) expect(tap(state, point(75, 60))).toStrictEqual(selectVertex('v1')); // empate exato: a ordem de inserção
  });

  it('arestas que se cruzam: no cruzamento vence a primeira inserida; fora dele, cada uma é selecionada por si', () => {
    // v1 (60,60)—v2 (200,200) cruza v3 (200,60)—v4 (60,200) em (130,130)
    const state = stateOf({ vertices: [[60, 60], [200, 200], [200, 60], [60, 200]], edges: [[1, 2], [3, 4]] });

    expect(tap(state, point(130, 130))).toStrictEqual(selectEdge('e1')); // distância 0 às duas: ordem de inserção
    expect(tap(state, point(100, 100))).toStrictEqual(selectEdge('e1')); // só na diagonal de e1
    expect(tap(state, point(160, 100))).toStrictEqual(selectEdge('e2')); // só na diagonal de e2
  });

  it('arcos opostos em grafo orientado são duas curvas: tocar em cada uma seleciona a SUA aresta', () => {
    const state = stateOf({ directed: true, vertices: [[60, 160], [260, 160]], edges: [[1, 2], [2, 1]] });
    const [first, second] = edgeGeometries(state.graph, state.layout);
    expect(first && second).toBeTruthy();

    const onFirst = first!.labelAnchor;
    const onSecond = second!.labelAnchor;
    expect(Math.hypot(onFirst.x - onSecond.x, onFirst.y - onSecond.y)).toBeGreaterThan(12); // curvas separadas além da tolerância
    expect(tap(state, onFirst)).toStrictEqual(selectEdge('e1'));
    expect(tap(state, onSecond)).toStrictEqual(selectEdge('e2'));
  });
});

describe('tapToSelectionAction: câmera, bordas e entradas inválidas', () => {
  it('com zoom e deslocamento (câmera {40, −30, 2}) o toque vale onde o vértice APARECE na tela', () => {
    const camera: Camera = { x: 40, y: -30, scale: 2 };
    const state = stateOf({ vertices: [[40, 60], [100, 90]] });

    expect(worldToScreen(camera, point(40, 60))).toStrictEqual(point(120, 90));
    expect(tap(state, point(120, 90), camera)).toStrictEqual(selectVertex('v1'));
    expect(tap(state, point(240, 150), camera)).toStrictEqual(selectVertex('v2'));
    expect(tap(state, point(40, 60), camera)).toStrictEqual(CLEAR); // o ponto do MUNDO tocado como se fosse de tela: é o fundo
  });

  it.each([0.25, 1, 4])('em escala %d, o centro de cada vértice ainda acerta o vértice', (scale) => {
    const camera: Camera = { x: 10, y: 20, scale };
    const state = stateOf({ vertices: [[10, 10], [40, 10]] });
    const [a, b] = ['v1', 'v2'].map((id) => worldToScreen(camera, state.layout.positions[id]!));

    expect(tap(state, a!, camera)).toStrictEqual(selectVertex('v1'));
    expect(tap(state, b!, camera)).toStrictEqual(selectVertex('v2'));
  });

  it('as opções do hit-testing chegam ao hitTest: a 23 dp do centro (raio visual 20) seleciona com o alvo padrão de 48 dp e NÃO com um de 10 dp', () => {
    const state = stateOf();
    const perto = point(60 + 23, 60);

    expect(tapToSelectionAction(state, NEUTRAL_CAMERA, perto, VIEWPORT)).toStrictEqual(selectVertex('v1'));
    expect(tapToSelectionAction(state, NEUTRAL_CAMERA, perto, VIEWPORT, { minTouchDiameter: 10 })).toStrictEqual(CLEAR);
  });

  it('toque fora do canvas, inválido, câmera ou área inválidas: nenhuma ação', () => {
    const state = stateOf();

    expect(tap(state, point(361, 100))).toBeUndefined();
    expect(tap(state, point(100, 321))).toBeUndefined();
    expect(tap(state, point(-1, 100))).toBeUndefined();
    expect(tap(state, point(Number.NaN, 100))).toBeUndefined();
    expect(tap(state, point(60, 60), { x: 0, y: 0, scale: 0 })).toBeUndefined();
    expect(tapToSelectionAction(state, NEUTRAL_CAMERA, point(60, 60), { width: 0, height: 320 })).toBeUndefined();
  });

  it('as bordas do canvas contam como dentro', () => {
    expect(tap(stateOf(), point(0, 0))).toStrictEqual(CLEAR);
    expect(tap(stateOf(), point(360, 320))).toStrictEqual(CLEAR);
  });

  it.each(['add-vertex', 'connect'] as const)('no modo %s este caminho não faz nada', (mode) => {
    expect(tap(stateOf({ mode }), point(60, 60))).toBeUndefined();
    expect(tap(stateOf({ mode }), point(320, 280))).toBeUndefined();
  });

  it('layout de outro grafo (estado incoerente): nenhuma ação', () => {
    const incoerente = { ...stateOf(), layout: emptyLayout('outro') } as EditorState;

    expect(tap(incoerente, point(60, 60))).toBeUndefined();
  });

  it('não altera as entradas (estado, câmera e toque congelados)', () => {
    const state = deepFreeze(stateOf({ edges: [[1, 2]] }));
    const camera = deepFreeze({ ...NEUTRAL_CAMERA });
    const toque = deepFreeze(point(130, 60));

    expect(() => tapToSelectionAction(state, camera, toque, VIEWPORT)).not.toThrow();
  });
});

describe('integração com applyAction: seleção fora do histórico', () => {
  it('selecionar, tocar de novo no mesmo elemento (a seleção fica, o MESMO estado) e limpar pelo fundo', () => {
    const base = stateOf({ edges: [[1, 2]] });
    const first = applyAction(base, tap(base, point(60, 60))!).state;
    expect(first.selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });

    const again = applyAction(first, tap(first, point(60, 60))!);
    expect(again.state).toBe(first); // tocar de novo mantém: nada muda, ninguém é avisado

    const other = applyAction(first, tap(first, point(130, 60))!).state;
    expect(other.selection).toStrictEqual({ type: 'edge', edgeId: 'e1' }); // trocar o elemento

    const cleared = applyAction(other, tap(other, point(320, 280))!).state;
    expect(cleared.selection).toStrictEqual({ type: 'none' });
    expect(applyAction(cleared, tap(cleared, point(320, 280))!).state).toBe(cleared); // limpar o que já está limpo não faz nada
  });

  it('selecionar e limpar não criam histórico (o vetor past é o mesmo objeto)', () => {
    const base = stateOf({ edges: [[1, 2]] });
    let state = base;
    for (const at of [point(60, 60), point(130, 60), point(320, 280), point(200, 60)]) state = applyAction(state, tap(state, at)!).state;

    expect(state.history).toBe(base.history);
    expect(state.graph).toBe(base.graph);
  });

  it('a seleção inválida depois de excluir é limpa: excluir o vértice selecionado leva suas arestas e a seleção', () => {
    const base = stateOf({ edges: [[1, 2]] });
    const selected = applyAction(base, tap(base, point(60, 60))!).state;
    const removed = applyAction(selected, { type: 'remove-selection' }).state;

    expect(removed.selection).toStrictEqual({ type: 'none' });
    expect(removed.graph.edges).toHaveLength(0);
  });

  it('desfazer a criação do elemento selecionado limpa a seleção (o núcleo confere ao restaurar)', () => {
    const base = stateOf({ mode: 'add-vertex' });
    const added = applyAction(base, { type: 'add-vertex', position: point(300, 250) }).state; // v4
    const selected = applyAction(applyAction(added, { type: 'set-mode', mode: 'select' }).state, selectVertex('v4')).state;
    const undone = applyAction(selected, { type: 'undo' }).state;

    expect(undone.graph.vertices.some((vertex) => vertex.id === 'v4')).toBe(false);
    expect(undone.selection).toStrictEqual({ type: 'none' });
  });
});

describe('propriedade: a ação é a do hitTest (500 toques aleatórios, sementes fixas)', () => {
  it('vértice → select do vértice, aresta → select da aresta, fundo → clear-selection, fora → nada', () => {
    const random = seededRandom(3808);
    for (let run = 0; run < 500; run++) {
      const count = 2 + Math.floor(random() * 4);
      const vertices = Array.from({ length: count }, (_, i) => [40 + i * 55, 50 + ((i * 97) % 200)] as const);
      const edges: [number, number][] = [];
      for (let a = 1; a <= count; a++) for (let b = a + 1; b <= count; b++) if (random() < 0.5) edges.push([a, b]);
      const state = stateOf({ directed: random() < 0.5, vertices, edges });
      const toque = point(Math.round(random() * 440 - 40), Math.round(random() * 400 - 40));

      const action = tap(state, toque);
      const inside = toque.x >= 0 && toque.y >= 0 && toque.x <= VIEWPORT.width && toque.y <= VIEWPORT.height;
      if (!inside) {
        expect(action).toBeUndefined();
        continue;
      }
      const target = hitTest(state.graph, state.layout, NEUTRAL_CAMERA, toque);
      if (target?.type === 'vertex') expect(action).toStrictEqual(selectVertex(target.vertexId));
      else if (target?.type === 'edge') expect(action).toStrictEqual(selectEdge(target.edgeId));
      else expect(action).toStrictEqual(CLEAR);
    }
  });
});

describe('selectionStatusMessage: o texto de estado em português', () => {
  const select = (state: EditorState, action: EditorAction) => applyAction(state, action).state;

  it('nada selecionado: a instrução', () => {
    expect(selectionStatusMessage(stateOf())).toBe(SELECT_IDLE_MESSAGE);
    expect(SELECT_IDLE_MESSAGE).toBe('Toque em um vértice ou em uma aresta para selecioná-lo.');
  });

  it('vértice: "Vértice A selecionado." (o rótulo, não o id)', () => {
    expect(selectionStatusMessage(select(stateOf(), selectVertex('v1')))).toBe('Vértice A selecionado.');
    expect(selectionStatusMessage(select(stateOf(), selectVertex('v3')))).toBe('Vértice C selecionado.');
  });

  it('aresta: "entre A e B" no não orientado e "de A para B" no orientado, com o peso ou "Sem peso."', () => {
    const undirected = select(stateOf({ edges: [[1, 2]] }), selectEdge('e1'));
    const directed = select(stateOf({ directed: true, edges: [[2, 1]] }), selectEdge('e1'));

    expect(selectionStatusMessage(undirected)).toBe('Aresta entre A e B selecionada. Sem peso.');
    expect(selectionStatusMessage(directed)).toBe('Aresta de B para A selecionada. Sem peso.');
  });

  it('peso 0 é "Peso 0." e aresta sem peso é "Sem peso." (nunca confundidos); decimais com vírgula e negativos', () => {
    const base = stateOf({ edges: [[1, 2]] });
    const withWeight = (weight: number | undefined) => {
      const graph = must(setEdgeWeight(base.graph, 'e1', weight));
      return select({ ...base, graph }, selectEdge('e1'));
    };

    expect(selectionStatusMessage(withWeight(0))).toBe('Aresta entre A e B selecionada. Peso 0.');
    expect(selectionStatusMessage(withWeight(undefined))).toBe('Aresta entre A e B selecionada. Sem peso.');
    expect(selectionStatusMessage(withWeight(2.5))).toBe('Aresta entre A e B selecionada. Peso 2,5.');
    expect(selectionStatusMessage(withWeight(-3))).toBe('Aresta entre A e B selecionada. Peso -3.');
  });

  it('fora do modo Selecionar não há texto; uma seleção que não existe mais vira a instrução', () => {
    expect(selectionStatusMessage({ ...select(stateOf(), selectVertex('v1')), mode: 'connect' })).toBe('');
    expect(selectionStatusMessage({ ...stateOf(), selection: { type: 'vertex', vertexId: 'v9' } })).toBe(SELECT_IDLE_MESSAGE);
    expect(selectionStatusMessage({ ...stateOf(), selection: { type: 'edge', edgeId: 'e9' } })).toBe(SELECT_IDLE_MESSAGE);
  });

  it('não cita ids técnicos', () => {
    const message = selectionStatusMessage(select(stateOf({ edges: [[1, 2]] }), selectEdge('e1')));

    expect(message).not.toMatch(/\b[ve]\d+\b/);
  });
});
