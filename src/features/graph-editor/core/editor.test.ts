import { addVertex, createGraph, type Graph, type Result } from '@/domain/graph';

import {
  DEFAULT_HISTORY_LIMIT,
  EDITOR_MODES,
  MAX_HISTORY_LIMIT,
  applyAction,
  circularLayout,
  createEditorState,
  emptyLayout,
  nextFreeLabel,
  placeVertex,
  positionOf,
  type EditorAction,
  type EditorMode,
  type EditorState,
  type EditorTransition,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Núcleo de edição (ver editor.ts): ações, histórico, rótulos automáticos e contadores de id. Cenários calculados à mão e uma
// propriedade com sementes fixas contra um modelo de referência independente (listas simples, sem usar o domínio nem o editor).

// ---------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------

const point = (x: number, y: number): Point => ({ x, y });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

function fresh(options: { directed?: boolean; historyLimit?: number } = {}): EditorState {
  return createEditorState({
    graph: createGraph({ id: 'g', directed: options.directed ?? false }),
    historyLimit: options.historyLimit,
  });
}

/** Aplica a ação e exige que NÃO seja recusada. */
function step(state: EditorState, action: EditorAction): EditorState {
  const transition = applyAction(state, action);
  if (transition.error !== undefined) throw new Error(`recusada: ${JSON.stringify(transition.error)}`);
  return transition.state;
}

/** Aplica uma sequência de ações aceitas. */
const run = (state: EditorState, ...actions: EditorAction[]): EditorState => actions.reduce(step, state);

const addAt = (state: EditorState, x: number, y: number, label?: string): EditorState =>
  step(state, { type: 'add-vertex', position: point(x, y), ...(label !== undefined && { label }) });

const connectVertices = (state: EditorState, source: string, target: string, weight?: number): EditorState =>
  step(state, { type: 'connect', source, target, ...(weight !== undefined && { weight }) });

const selectVertex = (state: EditorState, vertexId: string): EditorState =>
  step(state, { type: 'select', selection: { type: 'vertex', vertexId } });

const selectEdge = (state: EditorState, edgeId: string): EditorState =>
  step(state, { type: 'select', selection: { type: 'edge', edgeId } });

const undo = (state: EditorState): EditorState => step(state, { type: 'undo' });
const redo = (state: EditorState): EditorState => step(state, { type: 'redo' });

const vertexIds = (state: EditorState): string[] => state.graph.vertices.map((vertex) => vertex.id);
const vertexLabels = (state: EditorState): string[] => state.graph.vertices.map((vertex) => vertex.label);
const counters = (state: EditorState) => [state.graph.nextVertexSeq, state.graph.nextEdgeSeq];

/** Código do erro, do editor ou do domínio. */
const errorCode = (transition: EditorTransition): string | undefined =>
  transition.error === undefined
    ? undefined
    : transition.error.code === 'GRAPH_ERROR'
      ? transition.error.error.code
      : transition.error.code;

/** Grafo, layout, histórico e seleção são os MESMOS objetos (a ação foi recusada ou não teve efeito sobre eles). */
function expectSameDocument(after: EditorState, before: EditorState): void {
  expect(after.graph).toBe(before.graph);
  expect(after.layout).toBe(before.layout);
  expect(after.history).toBe(before.history);
  expect(after.selection).toBe(before.selection);
  expect(after.mode).toBe(before.mode);
}

/**
 * Invariantes que a produção mantém POR CONSTRUÇÃO e que aqui são conferidas do zero (modelo próprio, sem o domínio):
 * ids canônicos e únicos, contadores acima dos ids, arestas válidas, layout do grafo com uma posição por vértice e nenhuma
 * órfã, seleção existente, limites do histórico e contadores dos instantâneos nunca acima dos atuais.
 */
function violations(state: EditorState): string[] {
  const problems: string[] = [];
  const { graph, layout, selection, history } = state;
  const vIds = graph.vertices.map((v) => v.id);
  const eIds = graph.edges.map((e) => e.id);
  const seq = (id: string) => Number(id.slice(1));
  if (new Set(vIds).size !== vIds.length) problems.push('ids de vértice repetidos');
  if (new Set(eIds).size !== eIds.length) problems.push('ids de aresta repetidos');
  if (!vIds.every((id) => /^v[1-9]\d*$/.test(id))) problems.push('id de vértice não canônico');
  if (!eIds.every((id) => /^e[1-9]\d*$/.test(id))) problems.push('id de aresta não canônico');
  if (vIds.some((id) => seq(id) >= graph.nextVertexSeq)) problems.push('nextVertexSeq não supera os ids');
  if (eIds.some((id) => seq(id) >= graph.nextEdgeSeq)) problems.push('nextEdgeSeq não supera os ids');
  const pairs = new Set<string>();
  for (const edge of graph.edges) {
    if (!vIds.includes(edge.source) || !vIds.includes(edge.target)) problems.push('aresta com extremo inexistente');
    if (edge.source === edge.target) problems.push('laço');
    const key = graph.directed || edge.source < edge.target ? `${edge.source}>${edge.target}` : `${edge.target}>${edge.source}`;
    if (pairs.has(key)) problems.push('aresta repetida');
    pairs.add(key);
  }
  if (layout.graphId !== graph.id) problems.push('layout de outro grafo');
  const positioned = Object.keys(layout.positions);
  if (positioned.length !== vIds.length || !vIds.every((id) => positionOf(layout, id) !== undefined)) {
    problems.push('o layout não tem exatamente uma posição por vértice');
  }
  if (selection.type === 'vertex' && !vIds.includes(selection.vertexId)) problems.push('seleção de vértice inexistente');
  if (selection.type === 'edge' && !eIds.includes(selection.edgeId)) problems.push('seleção de aresta inexistente');
  if (history.past.length > history.limit || history.past.length + history.future.length > history.limit) {
    problems.push('histórico acima do limite');
  }
  for (const snapshot of [...history.past, ...history.future]) {
    if (snapshot.layout.graphId !== snapshot.graph.id) problems.push('instantâneo com layout de outro grafo');
    if (Object.keys(snapshot.layout.positions).length !== snapshot.graph.vertices.length) problems.push('instantâneo incoerente');
    if (snapshot.graph.nextVertexSeq > graph.nextVertexSeq || snapshot.graph.nextEdgeSeq > graph.nextEdgeSeq) {
      problems.push('instantâneo com contador acima do atual');
    }
  }
  return problems;
}

const expectConsistent = (state: EditorState): void => {
  expect(violations(state)).toStrictEqual([]);
};

// ---------------------------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------------------------

describe('createEditorState', () => {
  it('estado inicial: o grafo dado, layout dele, nenhuma seleção, modo select, histórico vazio e nenhum erro', () => {
    const graph = must(addVertex(must(addVertex(createGraph({ id: 'g' }))).graph)).graph;
    const state = createEditorState({ graph });

    expect(state.graph).toBe(graph);
    expect(state.layout).toStrictEqual(circularLayout(graph));
    expect(state.layout.graphId).toBe('g');
    expect(state.selection).toStrictEqual({ type: 'none' });
    expect(state.mode).toBe('select');
    expect(state.history).toStrictEqual({ past: [], future: [], limit: DEFAULT_HISTORY_LIMIT });
    expect('error' in state).toBe(false);
    expectConsistent(state);
  });

  it('um layout completo do grafo é usado como está; o de outro grafo ou incompleto é reconciliado', () => {
    const graph = must(addVertex(must(addVertex(createGraph({ id: 'g' }))).graph)).graph;
    const completo = circularLayout(graph);
    const outro = placeVertex(placeVertex(emptyLayout('outro'), 'v1', point(9, 9)), 'v2', point(8, 8));
    const parcial = placeVertex(emptyLayout('g'), 'v1', point(500, 500));

    expect(createEditorState({ graph, layout: completo }).layout).toBe(completo);
    expect(createEditorState({ graph, layout: outro }).layout).toStrictEqual(circularLayout(graph));
    const reconciliado = createEditorState({ graph, layout: parcial });

    expect(positionOf(reconciliado.layout, 'v1')).toStrictEqual(point(500, 500)); // posição existente preservada
    expect(positionOf(reconciliado.layout, 'v2')).toBeDefined();
    expectConsistent(reconciliado);
  });

  it.each([
    [undefined, DEFAULT_HISTORY_LIMIT],
    [1, 1],
    [5, 5],
    [1000, 1000],
    [5000, MAX_HISTORY_LIMIT],
    [0, DEFAULT_HISTORY_LIMIT],
    [-3, DEFAULT_HISTORY_LIMIT],
    [1.5, DEFAULT_HISTORY_LIMIT],
    [Number.NaN, DEFAULT_HISTORY_LIMIT],
    [Number.POSITIVE_INFINITY, DEFAULT_HISTORY_LIMIT],
  ])('limite do histórico %p vale %p', (pedido, valido) => {
    expect(fresh({ historyLimit: pedido }).history.limit).toBe(valido);
  });

  it('modos: o pedido, se válido; senão select', () => {
    const graph = createGraph({ id: 'g' });

    for (const mode of EDITOR_MODES) expect(createEditorState({ graph, mode }).mode).toBe(mode);
    expect(createEditorState({ graph, mode: 'voar' as EditorMode }).mode).toBe('select');
    expect(DEFAULT_HISTORY_LIMIT).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------
// Rótulos automáticos
// ---------------------------------------------------------------------------------------------

/** Rótulo `n` da sequência A, B, …, Z, AA, … escrito de outro jeito que o do editor. */
function labelOf(n: number): string {
  let text = '';
  for (let m = n; m > 0; m = Math.floor((m - 1) / 26)) text = String.fromCharCode(65 + ((m - 1) % 26)) + text;
  return text;
}

function graphWithLabels(labels: readonly string[]): Graph {
  return labels.reduce((graph, label) => must(addVertex(graph, label)).graph, createGraph({ id: 'g' }));
}

describe('nextFreeLabel e a política de rótulos', () => {
  it.each([
    [[], 'A'],
    [['A'], 'B'],
    [['A', 'B', 'C'], 'D'],
    [['A', 'C'], 'B'], // o menor livre, não o seguinte ao último
    [['B', 'C'], 'A'],
    [['Norte', 'Sul'], 'A'], // rótulos do aluno não interferem
    [['a', 'b'], 'A'], // minúsculas são outros rótulos
    [['A', 'A', 'B'], 'C'], // duplicados informados continuam permitidos
  ])('%j → %s', (labels, esperado) => {
    expect(nextFreeLabel(graphWithLabels(labels))).toBe(esperado);
  });

  it('da letra Z para AA, e de AZ para BA', () => {
    const ateZ = graphWithLabels(Array.from({ length: 26 }, (_, i) => labelOf(i + 1)));
    const ateAZ = graphWithLabels(Array.from({ length: 52 }, (_, i) => labelOf(i + 1)));

    expect(nextFreeLabel(ateZ)).toBe('AA');
    expect(nextFreeLabel(graphWithLabels([...vertexLabelsOf(ateZ), 'AA']))).toBe('AB');
    expect(nextFreeLabel(ateAZ)).toBe('BA');
    expect(nextFreeLabel(graphWithLabels(Array.from({ length: 702 }, (_, i) => labelOf(i + 1))))).toBe('AAA');
  });

  it('o editor passa de Z para AA criando 27 vértices', () => {
    const state = Array.from({ length: 27 }, (_, i) => i).reduce((s, i) => addAt(s, i * 100, 0), fresh());

    expect(vertexLabels(state).slice(23)).toStrictEqual(['X', 'Y', 'Z', 'AA']);
    expect(nextFreeLabel(state.graph)).toBe('AB');
  });

  it('A, B, C → desfazer C → novo vértice: id v4 (novo) com o rótulo C (reaproveitado)', () => {
    let state = run(fresh(), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(100, 0) }, { type: 'add-vertex', position: point(200, 0) });

    expect(state.graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v3', 'C']]);
    state = undo(state);
    expect(vertexIds(state)).toStrictEqual(['v1', 'v2']);
    state = addAt(state, 300, 0);

    expect(state.graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v2', 'B'], ['v4', 'C']]);
    expect(positionOf(state.layout, 'v4')).toStrictEqual(point(300, 0));
    expect(positionOf(state.layout, 'v3')).toBeUndefined();
    expectConsistent(state);
  });

  it('a regra padrão do DOMÍNIO não mudou: o contador daria D, e o editor passa o rótulo C explicitamente', () => {
    let state = run(fresh(), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 0) }, { type: 'add-vertex', position: point(2, 0) });
    state = undo(state);
    const pelaRegraDoDominio = must(addVertex(state.graph)).vertex.label; // contador em 4 → 'D'

    expect(pelaRegraDoDominio).toBe('D');
    expect(vertexLabels(addAt(state, 5, 5))).toStrictEqual(['A', 'B', 'C']);
  });

  it('remover o vértice do meio libera o rótulo B, mas o id v2 nunca volta', () => {
    let state = run(fresh(), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 0) }, { type: 'add-vertex', position: point(2, 0) });
    state = run(state, { type: 'select', selection: { type: 'vertex', vertexId: 'v2' } }, { type: 'remove-selection' });
    state = addAt(state, 9, 9);

    expect(state.graph.vertices.map((v) => [v.id, v.label])).toStrictEqual([['v1', 'A'], ['v3', 'C'], ['v4', 'B']]);
  });

  it('rótulos do aluno contam como usados e nunca são alterados: custom C pula o C; renomear para B pula o B', () => {
    let state = run(fresh(), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 0) }, { type: 'add-vertex', position: point(2, 0), label: 'D' });

    expect(vertexLabels(addAt(state, 3, 0))).toStrictEqual(['A', 'B', 'D', 'C']);
    state = step(state, { type: 'set-label', vertexId: 'v1', label: 'B' }); // duplicado permitido pelo domínio
    expect(vertexLabels(state)).toStrictEqual(['B', 'B', 'D']);
    expect(nextFreeLabel(state.graph)).toBe('A');
    expect(vertexLabels(addAt(state, 4, 0))).toStrictEqual(['B', 'B', 'D', 'A']); // os existentes não mudam
  });

  it('rótulo informado repetido é aceito (duplicatas permitidas) e é normalizado (trim)', () => {
    const state = run(fresh(), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(1, 0), label: '  A  ' });

    expect(vertexLabels(state)).toStrictEqual(['A', 'A']);
  });

  it('é determinística: o mesmo grafo dá sempre o mesmo rótulo', () => {
    const graph = graphWithLabels(['A', 'C', 'Z']);

    expect(nextFreeLabel(graph)).toBe(nextFreeLabel(graph));
    expect(nextFreeLabel(graph)).toBe('B');
  });
});

function vertexLabelsOf(graph: Graph): string[] {
  return graph.vertices.map((vertex) => vertex.label);
}

// ---------------------------------------------------------------------------------------------
// Adicionar vértice
// ---------------------------------------------------------------------------------------------

describe('add-vertex', () => {
  it('cria o vértice com o id do domínio, o rótulo A e a posição pedida; grafo e layout mudam juntos, com um passo de histórico', () => {
    const before = fresh();
    const after = addAt(before, 10, -20);

    expect(after.graph.vertices).toStrictEqual([{ id: 'v1', label: 'A' }]);
    expect(positionOf(after.layout, 'v1')).toStrictEqual(point(10, -20));
    expect(after.layout.graphId).toBe('g');
    expect(counters(after)).toStrictEqual([2, 1]);
    expect(after.history.past).toStrictEqual([{ graph: before.graph, layout: before.layout }]);
    expect(after.history.future).toStrictEqual([]);
    expect(after.selection).toBe(before.selection);
    expect('error' in after).toBe(false);
    expectConsistent(after);
  });

  it('ids e posições em sequência: v1, v2, v3', () => {
    const state = addAt(addAt(addAt(fresh(), 0, 0), 100, 0), 200, 50);

    expect(vertexIds(state)).toStrictEqual(['v1', 'v2', 'v3']);
    expect(positionOf(state.layout, 'v3')).toStrictEqual(point(200, 50));
    expect(state.history.past).toHaveLength(3);
  });

  it('rótulo informado: normalizado e usado', () => {
    expect(vertexLabels(addAt(fresh(), 0, 0, '  Norte  '))).toStrictEqual(['Norte']);
  });

  it('a posição é copiada e -0 vira 0', () => {
    const recebido = { x: -0, y: 5 };
    const state = step(fresh(), { type: 'add-vertex', position: recebido });
    recebido.y = 999;

    expect(positionOf(state.layout, 'v1')).toStrictEqual(point(0, 5));
    expect(Object.is(positionOf(state.layout, 'v1')!.x, 0)).toBe(true);
  });

  it.each([
    [point(Number.NaN, 0)],
    [point(0, Number.NaN)],
    [point(Number.POSITIVE_INFINITY, 0)],
    [point(0, Number.NEGATIVE_INFINITY)],
  ])('posição inválida %j: recusada, nada muda e nenhum id é consumido', (position) => {
    const before = addAt(fresh(), 1, 1);
    const transition = applyAction(before, { type: 'add-vertex', position });

    expect(transition.error).toStrictEqual({ code: 'INVALID_POSITION' });
    expect(transition.state.error).toBe(transition.error);
    expectSameDocument(transition.state, before);
    expect(counters(transition.state)).toStrictEqual(counters(before));
    expect(vertexIds(addAt(transition.state, 2, 2))).toStrictEqual(['v1', 'v2']); // o próximo id continua v2
  });

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['x'.repeat(65), 'TOO_LONG'],
    [null as unknown as string, 'NOT_A_STRING'], // só `undefined` significa "omitido"
    [42 as unknown as string, 'NOT_A_STRING'],
  ])('rótulo inválido %j: recusado com o erro do domínio, sem consumir id nem mexer no layout', (label, reason) => {
    const before = addAt(fresh(), 1, 1);
    const transition = applyAction(before, { type: 'add-vertex', position: point(5, 5), label });

    expect(transition.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'INVALID_VERTEX_LABEL', label, reason } });
    expectSameDocument(transition.state, before);
    expect(counters(transition.state)).toStrictEqual(counters(before));
    expect(vertexIds(addAt(transition.state, 2, 2))).toStrictEqual(['v1', 'v2']);
  });

  it('a posição é validada antes do rótulo', () => {
    expect(errorCode(applyAction(fresh(), { type: 'add-vertex', position: point(Number.NaN, 0), label: '' }))).toBe('INVALID_POSITION');
  });

  it('não muda a seleção e limpa o erro anterior', () => {
    let state = selectVertex(addAt(fresh(), 0, 0), 'v1');
    state = applyAction(state, { type: 'connect', source: 'v1', target: 'v1' }).state; // recusada: erro transitório
    expect(state.error).toBeDefined();
    state = addAt(state, 5, 5);

    expect(state.selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect('error' in state).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Conectar
// ---------------------------------------------------------------------------------------------

describe('connect', () => {
  const dois = (directed = false): EditorState => addAt(addAt(fresh({ directed }), 0, 0), 100, 0);

  it('cria a aresta com o id do domínio, sem tocar no layout, com um passo de histórico', () => {
    const before = dois();
    const after = connectVertices(before, 'v1', 'v2');

    expect(after.graph.edges).toStrictEqual([{ id: 'e1', source: 'v1', target: 'v2' }]);
    expect(after.layout).toBe(before.layout);
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expect(counters(after)).toStrictEqual([3, 2]);
    expectConsistent(after);
  });

  it('com peso (inclusive 0 e negativo)', () => {
    let state = dois();
    state = connectVertices(state, 'v1', 'v2', 0);

    expect(state.graph.edges[0]).toStrictEqual({ id: 'e1', source: 'v1', target: 'v2', weight: 0 });
    expect(connectVertices(addAt(dois(), 0, 0), 'v1', 'v3', -2.5).graph.edges[0]!.weight).toBe(-2.5);
  });

  it('grafo orientado: os arcos opostos v1→v2 e v2→v1 convivem; repetir o mesmo sentido é recusado', () => {
    let state = connectVertices(dois(true), 'v1', 'v2');
    state = connectVertices(state, 'v2', 'v1');

    expect(state.graph.edges.map((e) => [e.id, e.source, e.target])).toStrictEqual([['e1', 'v1', 'v2'], ['e2', 'v2', 'v1']]);
    const repetido = applyAction(state, { type: 'connect', source: 'v1', target: 'v2' });

    expect(repetido.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } });
    expectSameDocument(repetido.state, state);
    expectConsistent(state);
  });

  it('grafo não orientado: a aresta repetida é recusada nos dois sentidos', () => {
    const state = connectVertices(dois(), 'v1', 'v2');

    expect(errorCode(applyAction(state, { type: 'connect', source: 'v1', target: 'v2' }))).toBe('DUPLICATE_EDGE');
    expect(errorCode(applyAction(state, { type: 'connect', source: 'v2', target: 'v1' }))).toBe('DUPLICATE_EDGE');
  });

  it('laço recusado com o erro do domínio preservado, e o estado guarda o mesmo erro', () => {
    const before = dois();
    const transition = applyAction(before, { type: 'connect', source: 'v1', target: 'v1' });

    expect(transition.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'SELF_LOOP', vertexId: 'v1' } });
    expect(transition.state.error).toBe(transition.error);
    expectSameDocument(transition.state, before);
  });

  it('vértice inexistente: a origem é conferida antes do destino', () => {
    const state = dois();

    expect(applyAction(state, { type: 'connect', source: 'v9', target: 'v1' }).error).toStrictEqual({
      code: 'GRAPH_ERROR',
      error: { code: 'VERTEX_NOT_FOUND', vertexId: 'v9' },
    });
    expect(applyAction(state, { type: 'connect', source: 'v1', target: 'v8' }).error).toStrictEqual({
      code: 'GRAPH_ERROR',
      error: { code: 'VERTEX_NOT_FOUND', vertexId: 'v8' },
    });
    expect(applyAction(state, { type: 'connect', source: 'v9', target: 'v8' }).error).toMatchObject({ error: { vertexId: 'v9' } });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('peso %p: recusado', (weight) => {
    const before = dois();
    const transition = applyAction(before, { type: 'connect', source: 'v1', target: 'v2', weight });

    expect(errorCode(transition)).toBe('INVALID_WEIGHT');
    expectSameDocument(transition.state, before);
  });

  it('uma recusa não consome id: a próxima aresta válida é e1', () => {
    const recusada = applyAction(dois(), { type: 'connect', source: 'v1', target: 'v1' }).state;
    const state = connectVertices(recusada, 'v1', 'v2');

    expect(state.graph.edges[0]!.id).toBe('e1');
    expect(counters(state)).toStrictEqual([3, 2]);
  });
});

// ---------------------------------------------------------------------------------------------
// Remover
// ---------------------------------------------------------------------------------------------

describe('remove-selection', () => {
  /** Triângulo v1–v2–v3 (não orientado) com v4 isolado. */
  function triangle(directed = false): EditorState {
    let state = [0, 1, 2, 3].reduce((s, i) => addAt(s, i * 100, i * 10), fresh({ directed }));
    state = connectVertices(connectVertices(connectVertices(state, 'v1', 'v2'), 'v2', 'v3'), 'v3', 'v1');
    return state;
  }

  it('sem seleção: recusada (NOTHING_SELECTED), nada muda', () => {
    const before = triangle();
    const transition = applyAction(before, { type: 'remove-selection' });

    expect(transition.error).toStrictEqual({ code: 'NOTHING_SELECTED' });
    expectSameDocument(transition.state, before);
  });

  it('vértice: remove-o, as arestas incidentes e a posição; os demais ficam; a seleção é limpa; um passo de histórico', () => {
    const before = selectVertex(triangle(), 'v2');
    const after = step(before, { type: 'remove-selection' });

    expect(vertexIds(after)).toStrictEqual(['v1', 'v3', 'v4']);
    expect(after.graph.edges.map((e) => e.id)).toStrictEqual(['e3']); // só v3–v1 sobrevive (e1 = v1–v2 e e2 = v2–v3 saíram)
    expect(positionOf(after.layout, 'v2')).toBeUndefined();
    expect(positionOf(after.layout, 'v1')).toBe(positionOf(before.layout, 'v1')); // mesmos objetos
    expect(after.selection).toStrictEqual({ type: 'none' });
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expect(counters(after)).toStrictEqual(counters(before)); // contadores não recuam
    expectConsistent(after);
  });

  it('vértice em grafo orientado: remove arcos que entram e que saem', () => {
    let state = [0, 1, 2].reduce((s, i) => addAt(s, i * 100, 0), fresh({ directed: true }));
    state = connectVertices(connectVertices(connectVertices(state, 'v1', 'v2'), 'v2', 'v1'), 'v3', 'v2');
    const after = run(state, { type: 'select', selection: { type: 'vertex', vertexId: 'v2' } }, { type: 'remove-selection' });

    expect(after.graph.edges).toStrictEqual([]);
    expectConsistent(after);
  });

  it('aresta: remove só a aresta; vértices e layout ficam; a seleção é limpa', () => {
    const before = selectEdge(triangle(), 'e2');
    const after = step(before, { type: 'remove-selection' });

    expect(after.graph.edges.map((e) => e.id)).toStrictEqual(['e1', 'e3']);
    expect(vertexIds(after)).toStrictEqual(vertexIds(before));
    expect(after.layout).toBe(before.layout);
    expect(after.selection).toStrictEqual({ type: 'none' });
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expectConsistent(after);
  });

  it('nenhum id removido é reemitido: depois de remover v4, o próximo vértice é v5; depois de remover e3, a próxima aresta é e4', () => {
    let state = run(selectVertex(triangle(), 'v4'), { type: 'remove-selection' });
    state = run(selectEdge(state, 'e3'), { type: 'remove-selection' });
    state = addAt(state, 1, 1);
    state = connectVertices(state, 'v1', 'v5');

    expect(vertexIds(state)).toContain('v5');
    expect(state.graph.edges.at(-1)!.id).toBe('e4');
  });
});

// ---------------------------------------------------------------------------------------------
// Editar propriedades e mover
// ---------------------------------------------------------------------------------------------

describe('set-label', () => {
  const base = (): EditorState => addAt(addAt(fresh(), 0, 0), 100, 0);

  it('troca o rótulo preservando id, posição e conexões; um passo de histórico; o layout é o mesmo', () => {
    let before = connectVertices(base(), 'v1', 'v2');
    const after = step(before, { type: 'set-label', vertexId: 'v1', label: '  Norte ' });

    expect(after.graph.vertices[0]).toStrictEqual({ id: 'v1', label: 'Norte' });
    expect(after.graph.edges).toStrictEqual(before.graph.edges);
    expect(after.layout).toBe(before.layout);
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    before = after;
    expectConsistent(before);
  });

  it('o mesmo rótulo (inclusive com espaços) não tem efeito: mesmo estado, nada no histórico', () => {
    const before = base();
    const same = applyAction(before, { type: 'set-label', vertexId: 'v1', label: ' A ' });

    expect(same.state).toBe(before);
    expect(same.error).toBeUndefined();
  });

  it('inválido: recusado com o erro do domínio; vértice inexistente tem prioridade sobre rótulo inválido', () => {
    const before = base();

    expect(applyAction(before, { type: 'set-label', vertexId: 'v1', label: '' }).error).toStrictEqual({
      code: 'GRAPH_ERROR',
      error: { code: 'INVALID_VERTEX_LABEL', label: '', reason: 'EMPTY' },
    });
    expect(errorCode(applyAction(before, { type: 'set-label', vertexId: 'v9', label: '' }))).toBe('VERTEX_NOT_FOUND');
    expectSameDocument(applyAction(before, { type: 'set-label', vertexId: 'v1', label: 'y'.repeat(65) }).state, before);
  });
});

describe('set-weight', () => {
  const comAresta = (): EditorState => connectVertices(addAt(addAt(fresh(), 0, 0), 100, 0), 'v1', 'v2');

  it('define, troca e remove o peso; 0 é diferente de sem peso', () => {
    let state = step(comAresta(), { type: 'set-weight', edgeId: 'e1', weight: 7 });
    expect(state.graph.edges[0]!.weight).toBe(7);

    state = step(state, { type: 'set-weight', edgeId: 'e1', weight: 0 });
    expect(state.graph.edges[0]!.weight).toBe(0);

    state = step(state, { type: 'set-weight', edgeId: 'e1', weight: undefined });
    expect('weight' in state.graph.edges[0]!).toBe(false);
    expect(state.history.past).toHaveLength(6); // 2 vértices + 1 aresta + 3 mudanças de peso
  });

  it('preserva id e extremos; o layout é o mesmo', () => {
    const before = comAresta();
    const after = step(before, { type: 'set-weight', edgeId: 'e1', weight: -3 });

    expect(after.graph.edges[0]).toStrictEqual({ id: 'e1', source: 'v1', target: 'v2', weight: -3 });
    expect(after.layout).toBe(before.layout);
  });

  it('o mesmo peso não tem efeito (inclusive -0 sobre 0 e remover o que não há)', () => {
    const base = comAresta();
    const comZero = step(base, { type: 'set-weight', edgeId: 'e1', weight: 0 });

    expect(applyAction(base, { type: 'set-weight', edgeId: 'e1', weight: undefined }).state).toBe(base);
    expect(applyAction(comZero, { type: 'set-weight', edgeId: 'e1', weight: 0 }).state).toBe(comZero);
    expect(applyAction(comZero, { type: 'set-weight', edgeId: 'e1', weight: -0 }).state).toBe(comZero);
  });

  it('inválido: aresta inexistente tem prioridade; peso não finito é recusado com o erro do domínio', () => {
    const before = comAresta();

    expect(errorCode(applyAction(before, { type: 'set-weight', edgeId: 'e9', weight: Number.NaN }))).toBe('EDGE_NOT_FOUND');
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const transition = applyAction(before, { type: 'set-weight', edgeId: 'e1', weight });

      expect(transition.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'INVALID_WEIGHT', weight } });
      expectSameDocument(transition.state, before);
    }
  });
});

describe('move-vertex', () => {
  const base = (): EditorState => connectVertices(addAt(addAt(fresh(), 0, 0), 100, 0), 'v1', 'v2');

  it('confirma a posição final: um passo de histórico; as demais posições e o grafo são os mesmos objetos', () => {
    const before = base();
    const after = step(before, { type: 'move-vertex', vertexId: 'v1', position: point(40, -30) });

    expect(positionOf(after.layout, 'v1')).toStrictEqual(point(40, -30));
    expect(positionOf(after.layout, 'v2')).toBe(positionOf(before.layout, 'v2'));
    expect(after.graph).toBe(before.graph);
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expectConsistent(after);
  });

  it('para a posição que já tem (inclusive -0 sobre 0): sem efeito, nada no histórico', () => {
    const before = base();

    expect(applyAction(before, { type: 'move-vertex', vertexId: 'v1', position: point(0, 0) }).state).toBe(before);
    expect(applyAction(before, { type: 'move-vertex', vertexId: 'v1', position: point(-0, -0) }).state).toBe(before);
  });

  it('inválido: vértice inexistente (prioridade) e posição não finita são recusados', () => {
    const before = base();

    expect(errorCode(applyAction(before, { type: 'move-vertex', vertexId: 'v9', position: point(Number.NaN, 0) }))).toBe('VERTEX_NOT_FOUND');
    const invalida = applyAction(before, { type: 'move-vertex', vertexId: 'v1', position: point(0, Number.POSITIVE_INFINITY) });

    expect(invalida.error).toStrictEqual({ code: 'INVALID_POSITION' });
    expectSameDocument(invalida.state, before);
  });

  it('desfazer devolve a posição anterior', () => {
    const moved = step(base(), { type: 'move-vertex', vertexId: 'v2', position: point(7, 7) });

    expect(positionOf(undo(moved).layout, 'v2')).toStrictEqual(point(100, 0));
  });
});

// ---------------------------------------------------------------------------------------------
// Seleção, modo e erro transitório (fora do histórico)
// ---------------------------------------------------------------------------------------------

describe('seleção, modo e erro', () => {
  const base = (): EditorState => connectVertices(addAt(addAt(fresh(), 0, 0), 100, 0), 'v1', 'v2');

  it('selecionar vértice, aresta e limpar: fora do histórico (o objeto `history` é o mesmo)', () => {
    const before = base();
    const v = selectVertex(before, 'v1');
    const e = selectEdge(v, 'e1');
    const limpo = step(e, { type: 'clear-selection' });

    expect(v.selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    expect(e.selection).toStrictEqual({ type: 'edge', edgeId: 'e1' });
    expect(limpo.selection).toStrictEqual({ type: 'none' });
    for (const state of [v, e, limpo]) {
      expect(state.history).toBe(before.history);
      expect(state.graph).toBe(before.graph);
      expect(state.layout).toBe(before.layout);
    }
  });

  it('selecionar o que já está selecionado, ou limpar sem seleção: sem efeito (mesmo estado)', () => {
    const before = base();
    const v = selectVertex(before, 'v1');

    expect(applyAction(v, { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } }).state).toBe(v);
    expect(applyAction(before, { type: 'clear-selection' }).state).toBe(before);
    expect(applyAction(before, { type: 'select', selection: { type: 'none' } }).state).toBe(before);
    expect(step(v, { type: 'select', selection: { type: 'none' } }).selection).toStrictEqual({ type: 'none' });
  });

  it('selecionar o que não existe: recusado com o erro do domínio, a seleção anterior fica', () => {
    const v = selectVertex(base(), 'v1');

    expect(applyAction(v, { type: 'select', selection: { type: 'vertex', vertexId: 'v9' } }).error).toStrictEqual({
      code: 'GRAPH_ERROR',
      error: { code: 'VERTEX_NOT_FOUND', vertexId: 'v9' },
    });
    const aresta = applyAction(v, { type: 'select', selection: { type: 'edge', edgeId: 'e9' } });

    expect(aresta.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'EDGE_NOT_FOUND', edgeId: 'e9' } });
    expect(aresta.state.selection).toBe(v.selection);
  });

  it('modos: troca cada um, o mesmo modo não tem efeito, o inválido é recusado; não mexe na seleção nem no histórico', () => {
    const v = selectVertex(base(), 'v1');

    for (const mode of EDITOR_MODES) {
      const state = step(v, { type: 'set-mode', mode });

      expect(state.mode).toBe(mode);
      expect(state.selection).toBe(v.selection);
      expect(state.history).toBe(v.history);
    }
    expect(applyAction(v, { type: 'set-mode', mode: 'select' }).state).toBe(v);
    const invalido = applyAction(v, { type: 'set-mode', mode: 'voar' as EditorMode });

    expect(invalido.error).toStrictEqual({ code: 'INVALID_MODE' });
    expect(invalido.state.mode).toBe('select');
  });

  it('o erro transitório: fica no estado, some na próxima ação aplicada (selecionar, modo ou edição) e em clear-error', () => {
    const recusado = applyAction(base(), { type: 'connect', source: 'v1', target: 'v1' }).state;

    expect(recusado.error).toBeDefined();
    for (const action of [
      { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } },
      { type: 'set-mode', mode: 'connect' },
      { type: 'add-vertex', position: point(5, 5) },
      { type: 'clear-error' },
    ] as EditorAction[]) {
      expect('error' in step(recusado, action)).toBe(false);
    }
  });

  it('ações sem efeito não limpam o erro (o estado é o mesmo objeto)', () => {
    const recusado = applyAction(base(), { type: 'connect', source: 'v1', target: 'v1' }).state;

    expect(applyAction(recusado, { type: 'clear-selection' }).state).toBe(recusado);
    expect(applyAction(recusado, { type: 'set-mode', mode: 'select' }).state).toBe(recusado);
    expect(applyAction(recusado, { type: 'redo' }).state).toBe(recusado); // nada a refazer
  });

  it('clear-error sem erro não tem efeito', () => {
    const state = base();

    expect(applyAction(state, { type: 'clear-error' }).state).toBe(state);
  });

  it('uma recusa muda só o `error`: grafo, layout, histórico, seleção e modo são os mesmos objetos', () => {
    const v = selectVertex(base(), 'v1');
    const transition = applyAction(v, { type: 'connect', source: 'v1', target: 'v1' });

    expect(transition.state).not.toBe(v);
    expectSameDocument(transition.state, v);
  });
});

// ---------------------------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------------------------

describe('histórico: desfazer e refazer', () => {
  const ABC = (limit?: number): EditorState =>
    run(fresh({ historyLimit: limit }), { type: 'add-vertex', position: point(0, 0) }, { type: 'add-vertex', position: point(100, 0) }, { type: 'add-vertex', position: point(200, 0) });

  it('desfazer e refazer uma operação devolvem o grafo e o layout anteriores e posteriores', () => {
    const depois = ABC();
    const antes = undo(depois);

    expect(vertexIds(antes)).toStrictEqual(['v1', 'v2']);
    expect(antes.history.past).toHaveLength(2);
    expect(antes.history.future).toHaveLength(1);
    const refeito = redo(antes);

    expect(refeito.graph).toStrictEqual(depois.graph);
    expect(refeito.layout).toStrictEqual(depois.layout);
    expect(refeito.history.future).toHaveLength(0);
    expectConsistent(antes);
    expectConsistent(refeito);
  });

  it('várias operações: desfazer todas leva ao grafo vazio; refazer todas devolve exatamente o final', () => {
    let state = ABC();
    state = connectVertices(connectVertices(state, 'v1', 'v2'), 'v2', 'v3');
    state = step(state, { type: 'move-vertex', vertexId: 'v1', position: point(9, 9) });
    state = step(state, { type: 'set-label', vertexId: 'v2', label: 'Meio' });
    state = step(state, { type: 'set-weight', edgeId: 'e1', weight: 4 });
    const final = state;

    for (let i = 0; i < 8; i++) state = undo(state);
    expect(state.graph.vertices).toStrictEqual([]);
    expect(state.graph.edges).toStrictEqual([]);
    expect(applyAction(state, { type: 'undo' }).state).toBe(state); // nada mais a desfazer
    for (let i = 0; i < 8; i++) state = redo(state);

    expect(state.graph.vertices).toStrictEqual(final.graph.vertices);
    expect(state.graph.edges).toStrictEqual(final.graph.edges);
    expect(state.layout).toStrictEqual(final.layout);
    expect(counters(state)).toStrictEqual(counters(final));
    expect(applyAction(state, { type: 'redo' }).state).toBe(state);
    expectConsistent(state);
  });

  it('histórico vazio: desfazer e refazer não fazem nada, sem erro', () => {
    const state = fresh();
    const u = applyAction(state, { type: 'undo' });
    const r = applyAction(state, { type: 'redo' });

    expect(u.state).toBe(state);
    expect(r.state).toBe(state);
    expect(u.error).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it('refazer restaura a MESMA entidade com o MESMO id, rótulo e posição', () => {
    const antes = ABC();
    const v3 = antes.graph.vertices[2];
    const refeito = redo(undo(antes));

    expect(refeito.graph.vertices[2]).toStrictEqual(v3);
    expect(refeito.graph.vertices[2]!.id).toBe('v3');
    expect(positionOf(refeito.layout, 'v3')).toStrictEqual(point(200, 0));
    expect(counters(refeito)).toStrictEqual(counters(antes));
  });

  it('IDs de vértice nunca recuam: depois de desfazer v3, a operação nova emite v4, e os contadores só crescem', () => {
    let state = ABC();
    const trajetoria: number[] = [state.graph.nextVertexSeq];
    state = undo(undo(undo(state)));
    trajetoria.push(state.graph.nextVertexSeq);
    state = addAt(state, 5, 5);
    trajetoria.push(state.graph.nextVertexSeq);
    state = undo(state);
    trajetoria.push(state.graph.nextVertexSeq);
    state = addAt(state, 6, 6);

    expect(vertexIds(state)).toStrictEqual(['v5']);
    expect(trajetoria).toStrictEqual([4, 4, 5, 5]); // nunca abaixo do máximo já alcançado
    expect(state.graph.nextVertexSeq).toBe(6);
    expectConsistent(state);
  });

  it('IDs de aresta têm contador próprio e também nunca recuam', () => {
    let state = connectVertices(ABC(), 'v1', 'v2'); // e1
    state = connectVertices(state, 'v2', 'v3'); // e2
    state = undo(undo(state));
    expect(state.graph.nextEdgeSeq).toBe(3);
    expect(state.graph.edges).toStrictEqual([]);
    state = connectVertices(state, 'v1', 'v3');

    expect(state.graph.edges.map((e) => e.id)).toStrictEqual(['e3']);
    expect(state.graph.nextVertexSeq).toBe(4); // o contador de vértices não foi afetado
    expectConsistent(state);
  });

  it('refazer depois de uma sequência de desfazer volta a ter os ids originais, e depois uma operação nova avança', () => {
    let state = connectVertices(ABC(), 'v1', 'v2');
    const original = state;
    state = redo(undo(undo(state)).history.future.length > 0 ? redo(undo(undo(state))) : state); // desfaz 2, refaz 1
    state = redo(state);

    expect(state.graph.vertices).toStrictEqual(original.graph.vertices);
    expect(state.graph.edges).toStrictEqual(original.graph.edges);
    expect(counters(addAt(state, 1, 1))[0]).toBe(5);
  });

  it('uma operação nova descarta o ramo de refazer', () => {
    let state = undo(undo(ABC()));
    expect(state.history.future).toHaveLength(2);
    state = addAt(state, 7, 7);

    expect(state.history.future).toStrictEqual([]);
    expect(applyAction(state, { type: 'redo' }).state).toBe(state);
    expect(vertexIds(state)).toStrictEqual(['v1', 'v4']);
  });

  it('mover e editar (rótulo, peso) também descartam o ramo de refazer', () => {
    const desfeito = undo(addAt(connectVertices(ABC(), 'v1', 'v2'), 9, 9)); // a aresta e1 existe e há um passo a refazer

    expect(desfeito.history.future).toHaveLength(1);
    for (const action of [
      { type: 'move-vertex', vertexId: 'v1', position: point(3, 3) },
      { type: 'set-label', vertexId: 'v1', label: 'Z1' },
      { type: 'set-weight', edgeId: 'e1', weight: 2 },
    ] as EditorAction[]) {
      expect(step(desfeito, action).history.future).toStrictEqual([]);
    }
  });

  it('o layout acompanha: desfazer a remoção de um vértice devolve a posição dele (o mesmo objeto) e as arestas incidentes', () => {
    let state = connectVertices(ABC(), 'v1', 'v2');
    state = selectVertex(state, 'v2');
    const posicaoAntes = positionOf(state.layout, 'v2');
    const removido = step(state, { type: 'remove-selection' });

    expect(positionOf(removido.layout, 'v2')).toBeUndefined();
    const restaurado = undo(removido);

    expect(positionOf(restaurado.layout, 'v2')).toBe(posicaoAntes);
    expect(restaurado.graph.edges.map((e) => e.id)).toStrictEqual(['e1']);
    expectConsistent(restaurado);
  });

  it('a seleção é por id e é limpa quando o elemento deixa de existir (desfazer a criação do selecionado)', () => {
    const state = selectVertex(ABC(), 'v3');
    const desfeito = undo(state);

    expect(desfeito.selection).toStrictEqual({ type: 'none' });
    expect(redo(desfeito).selection).toStrictEqual({ type: 'none' }); // a seleção não faz parte do histórico: não volta sozinha
  });

  it('a seleção que continua válida é mantida; aresta selecionada some se a criação dela é desfeita', () => {
    const comV1 = selectVertex(ABC(), 'v1');

    expect(undo(comV1).selection).toStrictEqual({ type: 'vertex', vertexId: 'v1' });
    const comAresta = selectEdge(connectVertices(ABC(), 'v1', 'v2'), 'e1');

    expect(undo(comAresta).selection).toStrictEqual({ type: 'none' });
  });

  it('refazer limpa a seleção que deixou de existir (remoção refeita)', () => {
    let state = selectVertex(ABC(), 'v3');
    state = step(state, { type: 'remove-selection' });
    state = undo(state);
    state = selectVertex(state, 'v3');

    expect(redo(state).selection).toStrictEqual({ type: 'none' });
  });

  it('operações inválidas, sem efeito, seleção, modo e limpar erro NÃO entram no histórico', () => {
    const base = connectVertices(ABC(), 'v1', 'v2');
    const passos = base.history.past.length;
    let state = base;
    for (const action of [
      { type: 'connect', source: 'v1', target: 'v1' },
      { type: 'add-vertex', position: point(Number.NaN, 0) },
      { type: 'set-label', vertexId: 'v1', label: 'A' },
      { type: 'set-weight', edgeId: 'e1', weight: undefined },
      { type: 'move-vertex', vertexId: 'v1', position: point(0, 0) },
      { type: 'select', selection: { type: 'vertex', vertexId: 'v1' } },
      { type: 'set-mode', mode: 'connect' },
      { type: 'clear-selection' },
      { type: 'clear-error' },
      { type: 'remove-selection' },
    ] as EditorAction[]) {
      state = applyAction(state, action).state;
    }

    expect(state.history.past).toHaveLength(passos);
    expect(state.history.future).toHaveLength(0);
    expect(state.history.past).toBe(base.history.past); // o vetor nem foi recriado
  });

  it('o modo e a seleção ficam fora do histórico: desfazer não volta o modo', () => {
    const state = step(ABC(), { type: 'set-mode', mode: 'connect' });

    expect(undo(state).mode).toBe('connect');
    expect(state.history.past.every((snapshot) => Object.keys(snapshot).sort().join() === 'graph,layout')).toBe(true);
  });

  it('o erro transitório não é restaurado por desfazer nem por refazer', () => {
    const comErro = applyAction(ABC(), { type: 'connect', source: 'v1', target: 'v1' }).state;

    expect(comErro.error).toBeDefined();
    const desfeito = undo(comErro);

    expect('error' in desfeito).toBe(false);
    expect('error' in redo(desfeito)).toBe(false);
    expect(comErro.history.past.some((s) => 'error' in s)).toBe(false);
  });

  it('os instantâneos não são alterados por operações posteriores', () => {
    let state = connectVertices(ABC(), 'v1', 'v2');
    const primeiro = state.history.past[0]!;
    const foto = JSON.stringify(primeiro);
    const penultimo = state.history.past.at(-1)!;
    const fotoPenultimo = JSON.stringify(penultimo);
    state = step(state, { type: 'move-vertex', vertexId: 'v1', position: point(50, 50) });
    state = step(state, { type: 'set-label', vertexId: 'v1', label: 'Outro' });
    state = undo(undo(state));
    state = addAt(state, 1, 1);

    expect(JSON.stringify(primeiro)).toBe(foto);
    expect(JSON.stringify(penultimo)).toBe(fotoPenultimo);
  });

  it('não altera o estado nem a ação recebidos', () => {
    const state = ABC();
    const action = deepFreeze({ type: 'add-vertex', position: { x: 1, y: 2 }, label: 'Q' } as const);
    const antes = JSON.stringify(state);
    const novo = applyAction(state, action);

    expect(JSON.stringify(state)).toBe(antes);
    expect(novo.state).not.toBe(state);
    const desfeito = undo(novo.state);

    expect(desfeito.graph.vertices).toStrictEqual(state.graph.vertices);
    expect(desfeito.layout).toStrictEqual(state.layout);
    expect(counters(desfeito)).toStrictEqual([state.graph.nextVertexSeq + 1, state.graph.nextEdgeSeq]); // o piso: o id v4 foi emitido
  });
});

describe('histórico: limite', () => {
  /** Alterna o mesmo vértice entre duas posições: cada ação é uma operação com efeito. */
  const mover = (state: EditorState, n: number): EditorState =>
    step(state, { type: 'move-vertex', vertexId: 'v1', position: point(n, 0) });

  it('o padrão é 100 passos: o mais antigo é esquecido e o 101º desfazer não faz nada', () => {
    const states: EditorState[] = [addAt(fresh(), 0, 0)];
    for (let n = 1; n <= 150; n++) states.push(mover(states.at(-1)!, n));
    let state = states.at(-1)!;

    expect(state.history.past).toHaveLength(100);
    expect(state.history.limit).toBe(100);
    for (let i = 0; i < 100; i++) state = undo(state);

    expect(applyAction(state, { type: 'undo' }).state).toBe(state);
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(100);
    // o instantâneo mais antigo que sobrou é o de 51 operações atrás: a posição x = 50 (151 operações no total, a primeira some)
    expect(positionOf(state.layout, 'v1')).toStrictEqual(point(50, 0));
  });

  it('limite configurado: 3 passos', () => {
    let state = fresh({ historyLimit: 3 });
    for (let n = 0; n < 7; n++) state = addAt(state, n, 0);

    expect(state.history.past).toHaveLength(3);
    const noFundo = undo(undo(undo(state)));

    expect(vertexIds(noFundo)).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
    expect(applyAction(noFundo, { type: 'undo' }).state).toBe(noFundo);
  });

  it('limite 1: só a última operação pode ser desfeita', () => {
    let state = fresh({ historyLimit: 1 });
    state = addAt(addAt(state, 0, 0), 1, 0);

    expect(state.history.past).toHaveLength(1);
    expect(vertexIds(undo(state))).toStrictEqual(['v1']);
  });

  it('os ids não recuam mesmo quando o histórico esquece o passado: depois de 150 criações o próximo é v151', () => {
    let state = fresh();
    for (let n = 0; n < 150; n++) state = addAt(state, n, 0);
    for (let n = 0; n < 100; n++) state = undo(state);

    expect(vertexIds(state)).toHaveLength(50);
    expect(addAt(state, 0, 0).graph.vertices.at(-1)!.id).toBe('v151');
    expectConsistent(state);
  });

  it('refazer não ultrapassa o limite (passos + refazer ≤ limite)', () => {
    let state = fresh({ historyLimit: 5 });
    for (let n = 0; n < 12; n++) state = addAt(state, n, 0);
    state = undo(undo(undo(state)));

    expect(state.history.past.length + state.history.future.length).toBeLessThanOrEqual(5);
    expectConsistent(redo(redo(state)));
  });
});

// ---------------------------------------------------------------------------------------------
// Propriedade: modelo de referência independente
// ---------------------------------------------------------------------------------------------

type ModelVertex = { id: string; label: string; x: number; y: number };
type ModelEdge = { id: string; source: string; target: string; weight: number | undefined };
type ModelSnapshot = { vertices: ModelVertex[]; edges: ModelEdge[]; nextV: number; nextE: number };
type ModelSelection = { type: 'none' } | { type: 'vertex' | 'edge'; id: string };
type Verdict = { outcome: 'applied' | 'unchanged' | 'rejected'; reason?: string };

const zero = (n: number): number => (n === 0 ? 0 : n);
const finite = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Normaliza um rótulo como o domínio descreve: sem espaços nas pontas e de 1 a 64 pontos de código. */
function normalizedLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined;
  const text = label.trim();
  return text !== '' && [...text].length <= 64 ? text : undefined;
}

/** Próximo texto da sequência A…Z, AA…: incrementa a string como um odômetro (outro método que o do editor). */
function increment(label: string): string {
  const chars = [...label];
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i]!.charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
  }
  return `A${chars.join('')}`;
}

class Model {
  vertices: ModelVertex[] = [];
  edges: ModelEdge[] = [];
  nextV = 1;
  nextE = 1;
  selection: ModelSelection = { type: 'none' };
  mode: EditorMode = 'select';
  past: ModelSnapshot[] = [];
  future: ModelSnapshot[] = [];
  errored = false;

  constructor(
    readonly directed: boolean,
    readonly limit: number,
  ) {}

  private snapshot(): ModelSnapshot {
    return structuredClone({ vertices: this.vertices, edges: this.edges, nextV: this.nextV, nextE: this.nextE });
  }

  private push(before: ModelSnapshot): Verdict {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.errored = false;
    return { outcome: 'applied' };
  }

  private reject(reason: string): Verdict {
    this.errored = true;
    return { outcome: 'rejected', reason };
  }

  private applied(): Verdict {
    this.errored = false;
    return { outcome: 'applied' };
  }

  private hasVertex = (id: string): boolean => this.vertices.some((v) => v.id === id);
  private hasEdge = (id: string): boolean => this.edges.some((e) => e.id === id);

  private autoLabel(): string {
    const used = new Set(this.vertices.map((v) => v.label));
    let label = 'A';
    while (used.has(label)) label = increment(label);
    return label;
  }

  private sanitizeSelection(): void {
    const s = this.selection;
    if ((s.type === 'vertex' && !this.hasVertex(s.id)) || (s.type === 'edge' && !this.hasEdge(s.id))) this.selection = { type: 'none' };
  }

  private restore(target: ModelSnapshot, leaving: ModelSnapshot): void {
    this.vertices = target.vertices;
    this.edges = target.edges;
    this.nextV = Math.max(target.nextV, leaving.nextV);
    this.nextE = Math.max(target.nextE, leaving.nextE);
    this.sanitizeSelection();
    this.errored = false;
  }

  apply(action: EditorAction): Verdict {
    switch (action.type) {
      case 'add-vertex': {
        if (!finite(action.position)) return this.reject('INVALID_POSITION');
        const label = action.label === undefined ? this.autoLabel() : normalizedLabel(action.label);
        if (label === undefined) return this.reject('INVALID_VERTEX_LABEL');
        const before = this.snapshot();
        this.vertices.push({ id: `v${this.nextV}`, label, x: zero(action.position.x), y: zero(action.position.y) });
        this.nextV++;
        return this.push(before);
      }
      case 'connect': {
        if (!this.hasVertex(action.source)) return this.reject('VERTEX_NOT_FOUND');
        if (!this.hasVertex(action.target)) return this.reject('VERTEX_NOT_FOUND');
        if (action.source === action.target) return this.reject('SELF_LOOP');
        if (action.weight !== undefined && !Number.isFinite(action.weight)) return this.reject('INVALID_WEIGHT');
        const repeated = this.edges.some(
          (e) =>
            (e.source === action.source && e.target === action.target) ||
            (!this.directed && e.source === action.target && e.target === action.source),
        );
        if (repeated) return this.reject('DUPLICATE_EDGE');
        const before = this.snapshot();
        this.edges.push({
          id: `e${this.nextE}`,
          source: action.source,
          target: action.target,
          weight: action.weight === undefined ? undefined : zero(action.weight),
        });
        this.nextE++;
        return this.push(before);
      }
      case 'remove-selection': {
        const s = this.selection;
        if (s.type === 'none') return this.reject('NOTHING_SELECTED');
        const before = this.snapshot();
        if (s.type === 'vertex') {
          this.vertices = this.vertices.filter((v) => v.id !== s.id);
          this.edges = this.edges.filter((e) => e.source !== s.id && e.target !== s.id);
        } else {
          this.edges = this.edges.filter((e) => e.id !== s.id);
        }
        this.selection = { type: 'none' };
        return this.push(before);
      }
      case 'set-label': {
        const vertex = this.vertices.find((v) => v.id === action.vertexId);
        if (vertex === undefined) return this.reject('VERTEX_NOT_FOUND');
        const label = normalizedLabel(action.label);
        if (label === undefined) return this.reject('INVALID_VERTEX_LABEL');
        if (label === vertex.label) return { outcome: 'unchanged' };
        const before = this.snapshot();
        vertex.label = label;
        return this.push(before);
      }
      case 'set-weight': {
        const edge = this.edges.find((e) => e.id === action.edgeId);
        if (edge === undefined) return this.reject('EDGE_NOT_FOUND');
        if (action.weight !== undefined && !Number.isFinite(action.weight)) return this.reject('INVALID_WEIGHT');
        const next = action.weight === undefined ? undefined : zero(action.weight);
        if (next === edge.weight) return { outcome: 'unchanged' };
        const before = this.snapshot();
        edge.weight = next;
        return this.push(before);
      }
      case 'move-vertex': {
        const vertex = this.vertices.find((v) => v.id === action.vertexId);
        if (vertex === undefined) return this.reject('VERTEX_NOT_FOUND');
        if (!finite(action.position)) return this.reject('INVALID_POSITION');
        if (vertex.x === zero(action.position.x) && vertex.y === zero(action.position.y)) return { outcome: 'unchanged' };
        const before = this.snapshot();
        vertex.x = zero(action.position.x);
        vertex.y = zero(action.position.y);
        return this.push(before);
      }
      case 'select': {
        const s = action.selection;
        if (s.type === 'vertex' && !this.hasVertex(s.vertexId)) return this.reject('VERTEX_NOT_FOUND');
        if (s.type === 'edge' && !this.hasEdge(s.edgeId)) return this.reject('EDGE_NOT_FOUND');
        const next: ModelSelection = s.type === 'none' ? s : { type: s.type, id: s.type === 'vertex' ? s.vertexId : s.edgeId };
        return this.setSelection(next);
      }
      case 'clear-selection':
        return this.setSelection({ type: 'none' });
      case 'set-mode':
        if (action.mode === this.mode) return { outcome: 'unchanged' };
        this.mode = action.mode;
        return this.applied();
      case 'undo': {
        const target = this.past.pop();
        if (target === undefined) return { outcome: 'unchanged' };
        const leaving = this.snapshot();
        this.future.push(leaving);
        this.restore(target, leaving);
        return { outcome: 'applied' };
      }
      case 'redo': {
        const target = this.future.pop();
        if (target === undefined) return { outcome: 'unchanged' };
        const leaving = this.snapshot();
        this.past.push(leaving);
        this.restore(target, leaving);
        return { outcome: 'applied' };
      }
      case 'clear-error':
        if (!this.errored) return { outcome: 'unchanged' };
        this.errored = false;
        return { outcome: 'applied' };
    }
  }

  private setSelection(next: ModelSelection): Verdict {
    const same = this.selection.type === next.type && (next.type === 'none' || (this.selection as { id: string }).id === next.id);
    if (same) return { outcome: 'unchanged' };
    this.selection = next;
    return this.applied();
  }
}

const LABEL_POOL = ['A', 'B', 'C', 'Z', 'AA', 'Norte', ' B ', 'x'.repeat(64), '', '   ', 'y'.repeat(65)];

function randomAction(random: () => number, model: Model): EditorAction {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const vertexId = (): string => (model.vertices.length > 0 && random() > 0.06 ? pick(model.vertices).id : 'v999');
  const edgeId = (): string => (model.edges.length > 0 && random() > 0.06 ? pick(model.edges).id : 'e999');
  const randomPoint = (): Point => point(Math.round((random() * 2 - 1) * 400), Math.round((random() * 2 - 1) * 400));
  if (model.future.length > 0 && random() < 0.25) return { type: 'redo' }; // dá chance de refazer antes que uma edição descarte o ramo
  const roll = random();
  if (roll < 0.22) {
    const position = random() < 0.04 ? point(Number.NaN, 0) : randomPoint();
    return random() < 0.7 ? { type: 'add-vertex', position } : { type: 'add-vertex', position, label: pick(LABEL_POOL) };
  }
  if (roll < 0.4) {
    const weight = pick([undefined, undefined, 0, -0, 3, -2.5, Number.NaN, Number.POSITIVE_INFINITY]);
    return { type: 'connect', source: vertexId(), target: vertexId(), weight };
  }
  if (roll < 0.5) {
    if (random() < 0.5 && model.edges.length > 0) return { type: 'select', selection: { type: 'edge', edgeId: edgeId() } };
    return { type: 'select', selection: { type: 'vertex', vertexId: vertexId() } };
  }
  if (roll < 0.58) return { type: 'remove-selection' };
  if (roll < 0.64) return { type: 'set-label', vertexId: vertexId(), label: pick(LABEL_POOL) };
  if (roll < 0.7) return { type: 'set-weight', edgeId: edgeId(), weight: pick([undefined, 0, -0, 1, 2, Number.NaN]) };
  if (roll < 0.79) {
    const current = model.vertices.find((v) => v.id === vertexId());
    const position = current !== undefined && random() < 0.25 ? point(current.x, current.y) : random() < 0.04 ? point(0, Number.POSITIVE_INFINITY) : randomPoint();
    return { type: 'move-vertex', vertexId: current?.id ?? vertexId(), position };
  }
  if (roll < 0.88) return { type: 'undo' };
  if (roll < 0.94) return { type: 'redo' };
  if (roll < 0.96) return { type: 'set-mode', mode: pick(EDITOR_MODES) };
  if (roll < 0.98) return { type: 'clear-selection' };
  return { type: 'clear-error' };
}

/** O estado real tem o mesmo conteúdo que o modelo. */
function expectMatchesModel(state: EditorState, model: Model): void {
  // uma só comparação por passo (milhares de passos: o custo de cada `expect` pesa)
  const selection = state.selection;
  const project = {
    vertices: state.graph.vertices.map((v) => {
      const position = positionOf(state.layout, v.id);
      return [v.id, v.label, position?.x, position?.y];
    }),
    edges: state.graph.edges.map((e) => [e.id, e.source, e.target, e.weight]),
    positioned: Object.keys(state.layout.positions).length,
    counters: counters(state),
    mode: state.mode,
    selection: selection.type === 'none' ? [selection.type] : [selection.type, selection.type === 'vertex' ? selection.vertexId : selection.edgeId],
    history: [state.history.past.length, state.history.future.length],
    errored: state.error !== undefined,
  };
  const expected = {
    vertices: model.vertices.map((v) => [v.id, v.label, v.x, v.y]),
    edges: model.edges.map((e) => [e.id, e.source, e.target, e.weight]),
    positioned: model.vertices.length,
    counters: [model.nextV, model.nextE],
    mode: model.mode,
    selection: model.selection.type === 'none' ? ['none'] : [model.selection.type, model.selection.id],
    history: [model.past.length, model.future.length],
    errored: model.errored,
  };

  expect(project).toStrictEqual(expected);
}

describe('propriedades: sequências aleatórias contra um modelo de referência (sementes fixas)', () => {
  it('250 passos × 30 sementes: cada transição bate com o modelo, as invariantes valem a cada passo e os contadores só crescem', () => {
    const tally = { applied: 0, unchanged: 0, rejected: 0, undos: 0, redos: 0, trimmed: 0, removed: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      const random = seededRandom(seed);
      const directed = seed % 2 === 0;
      const limit = [3, 8, 100][seed % 3]!;
      let state = fresh({ directed, historyLimit: limit });
      const model = new Model(directed, limit);
      let maxV = 1;
      let maxE = 1;

      for (let i = 0; i < 250; i++) {
        const action = randomAction(random, model);
        const verdict = model.apply(action);
        const previous = state;
        const photo = i % 25 === 0 ? JSON.stringify(previous) : '';
        const transition = applyAction(state, action);
        state = transition.state;
        tally[verdict.outcome]++;
        if (action.type === 'undo' && verdict.outcome === 'applied') tally.undos++;
        if (action.type === 'redo' && verdict.outcome === 'applied') tally.redos++;
        if (action.type === 'remove-selection' && verdict.outcome === 'applied') tally.removed++;
        if (model.past.length === limit && verdict.outcome === 'applied' && action.type !== 'undo' && action.type !== 'redo') tally.trimmed++;

        // o veredito do modelo: aplicada, sem efeito (mesmo objeto) ou recusada (com o mesmo motivo)
        if (verdict.outcome === 'unchanged') expect(state).toBe(previous);
        else expect(state).not.toBe(previous);
        expect(transition.error !== undefined).toBe(verdict.outcome === 'rejected');
        if (verdict.outcome === 'rejected') expect(errorCode(transition)).toBe(verdict.reason);
        if (verdict.outcome === 'rejected') expectSameDocument(state, previous);
        if (photo !== '') expect(JSON.stringify(previous)).toBe(photo); // o estado de antes não foi alterado

        expectMatchesModel(state, model);
        expect(violations(state)).toStrictEqual([]);
        expect(state.graph.nextVertexSeq).toBeGreaterThanOrEqual(maxV);
        expect(state.graph.nextEdgeSeq).toBeGreaterThanOrEqual(maxE);
        maxV = state.graph.nextVertexSeq;
        maxE = state.graph.nextEdgeSeq;

        // refazer(desfazer(s)) devolve o mesmo conteúdo, o mesmo layout e os mesmos contadores
        if (i % 10 === 0 && state.history.past.length > 0) {
          const roundTrip = redo(undo(state));

          expect(roundTrip.graph).toStrictEqual(state.graph);
          expect(roundTrip.layout).toStrictEqual(state.layout);
        }
      }
    }

    // todos os regimes foram exercitados
    expect(tally.applied).toBeGreaterThan(3000);
    expect(tally.unchanged).toBeGreaterThan(300);
    expect(tally.rejected).toBeGreaterThan(1000);
    expect(tally.undos).toBeGreaterThan(300);
    expect(tally.redos).toBeGreaterThan(150);
    expect(tally.removed).toBeGreaterThan(100);
    expect(tally.trimmed).toBeGreaterThan(300);
  });

  it('o mesmo estado e a mesma ação dão sempre a mesma transição (determinismo)', () => {
    const random = seededRandom(99);
    const model = new Model(true, 100);
    let state = fresh({ directed: true });
    for (let i = 0; i < 150; i++) {
      const action = randomAction(random, model);
      model.apply(action);

      expect(applyAction(state, action)).toStrictEqual(applyAction(state, action));
      state = applyAction(state, action).state;
    }
  });
});
