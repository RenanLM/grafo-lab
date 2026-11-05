import { MAX_VERTEX_LABEL_LENGTH, addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  applyAction,
  createEditorState,
  describeProperties,
  emptyLayout,
  labelSaveAction,
  placeVertex,
  propertiesDraft,
  propertiesGenitive,
  propertiesNoun,
  propertiesTitle,
  weightSaveAction,
  type EditorAction,
  type EditorSelection,
  type EditorState,
} from './index';
import { deepFreeze } from './test-helpers';

// Propriedades do elemento selecionado (ver properties.ts): a descrição para a folha, o rascunho e a ação do Salvar. A validação do
// rótulo e do peso é a do domínio (pelo `applyAction`); os testes de integração conferem isso sem copiar as regras.

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = { directed?: boolean; edges?: readonly (readonly [number, number] | readonly [number, number, number])[]; labels?: readonly string[] };

/** Vértices v1 (A), v2 (B), v3 (C) em posições conhecidas, e as arestas dadas (por índice, com peso opcional). */
function stateOf({ directed = false, edges = [], labels = ['A', 'B', 'C'] }: Spec = {}): EditorState {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  labels.forEach((label, i) => {
    const added = must(addVertex(graph, label));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, { x: 60 + i * 70, y: 60 });
  });
  for (const edge of edges) {
    const [source, target, weight] = edge as readonly [number, number, number | undefined];
    graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}`, weight })).graph;
  }
  return createEditorState({ graph, layout });
}

const vertexSel = (vertexId: string): EditorSelection => ({ type: 'vertex', vertexId });
const edgeSel = (edgeId: string): EditorSelection => ({ type: 'edge', edgeId });
const apply = (state: EditorState, action: EditorAction) => applyAction(state, action);

describe('describeProperties', () => {
  it('vértice: id técnico e rótulo atual', () => {
    expect(describeProperties(stateOf().graph, vertexSel('v2'))).toStrictEqual({ kind: 'vertex', vertexId: 'v2', label: 'B' });
  });

  it('aresta: id, extremos (id e rótulo), orientação e o peso, que só existe se a aresta TEM peso', () => {
    const state = stateOf({ directed: true, edges: [[1, 2], [2, 3, 0], [3, 1, -2.5]] });

    expect(describeProperties(state.graph, edgeSel('e1'))).toStrictEqual({
      kind: 'edge', edgeId: 'e1', sourceId: 'v1', targetId: 'v2', sourceLabel: 'A', targetLabel: 'B', directed: true,
    });
    const zero = describeProperties(state.graph, edgeSel('e2'));
    expect(zero).toMatchObject({ weight: 0 }); // peso zero TEM peso
    expect(describeProperties(state.graph, edgeSel('e1'))).not.toHaveProperty('weight'); // sem peso: nem a chave
    expect(describeProperties(state.graph, edgeSel('e3'))).toMatchObject({ weight: -2.5 });
  });

  it('sem seleção, ou com elemento que não existe (mais): undefined', () => {
    const { graph } = stateOf({ edges: [[1, 2]] });

    expect(describeProperties(graph, { type: 'none' })).toBeUndefined();
    expect(describeProperties(graph, vertexSel('v9'))).toBeUndefined();
    expect(describeProperties(graph, edgeSel('e9'))).toBeUndefined();
  });

  it('não altera o grafo (congelado) e devolve um objeto novo', () => {
    const { graph } = stateOf({ edges: [[1, 2, 1]] });
    const frozen = deepFreeze(graph);

    expect(() => describeProperties(frozen, edgeSel('e1'))).not.toThrow();
    expect(describeProperties(frozen, edgeSel('e1'))).not.toBe(describeProperties(frozen, edgeSel('e1')));
  });
});

describe('propertiesNoun e propertiesGenitive (nomes para rótulos acessíveis)', () => {
  const target = (state: EditorState, selection: EditorSelection) => describeProperties(state.graph, selection)!;

  it('o elemento por extenso: "vértice A", "aresta entre A e B" e "aresta de A para B" (orientado)', () => {
    expect(propertiesNoun(target(stateOf(), vertexSel('v1')))).toBe('vértice A');
    expect(propertiesNoun(target(stateOf({ edges: [[1, 2]] }), edgeSel('e1')))).toBe('aresta entre A e B');
    expect(propertiesNoun(target(stateOf({ directed: true, edges: [[2, 1]] }), edgeSel('e1')))).toBe('aresta de B para A');
  });

  it('com a preposição contraída: "do vértice A" e "da aresta …" (concordância de gênero)', () => {
    expect(propertiesGenitive(target(stateOf(), vertexSel('v2')))).toBe('do vértice B');
    expect(propertiesGenitive(target(stateOf({ edges: [[1, 2]] }), edgeSel('e1')))).toBe('da aresta entre A e B');
    expect(propertiesGenitive(target(stateOf({ directed: true, edges: [[1, 2]] }), edgeSel('e1')))).toBe('da aresta de A para B');
  });

  it('cita o rótulo, nunca o id técnico', () => {
    expect(propertiesNoun(target(stateOf({ edges: [[1, 2]] }), edgeSel('e1')))).not.toMatch(/[ve]d+/);
  });
});

describe('título e rascunho', () => {
  it('título: "Vértice A", "Aresta entre A e B" (não orientado) e "Aresta de A para B" (orientado)', () => {
    expect(propertiesTitle(describeProperties(stateOf().graph, vertexSel('v1'))!)).toBe('Vértice A');
    expect(propertiesTitle(describeProperties(stateOf({ edges: [[1, 2]] }).graph, edgeSel('e1'))!)).toBe('Aresta entre A e B');
    expect(propertiesTitle(describeProperties(stateOf({ directed: true, edges: [[2, 1]] }).graph, edgeSel('e1'))!)).toBe('Aresta de B para A');
  });

  it('o título cita o rótulo, nunca o id técnico', () => {
    const title = propertiesTitle(describeProperties(stateOf({ edges: [[1, 2]] }).graph, edgeSel('e1'))!);

    expect(title).not.toMatch(/\b[ve]\d+\b/);
  });

  it('rascunho inicial: o rótulo atual; ou o peso com vírgula; vazio se a aresta não tem peso; "0" se o peso é zero', () => {
    const state = stateOf({ directed: true, edges: [[1, 2], [2, 3, 2.5], [1, 3, 0], [3, 2, -4]] });
    const draft = (selection: EditorSelection) => propertiesDraft(describeProperties(state.graph, selection)!);

    expect(draft(vertexSel('v1'))).toBe('A');
    expect(draft(edgeSel('e1'))).toBe(''); // sem peso
    expect(draft(edgeSel('e2'))).toBe('2,5');
    expect(draft(edgeSel('e3'))).toBe('0'); // zero NÃO é "sem peso"
    expect(draft(edgeSel('e4'))).toBe('-4');
  });
});

describe('Salvar um rótulo: a ação é `set-label` e o domínio decide', () => {
  it('a ação leva o texto como está (sem normalizar: quem normaliza é o domínio)', () => {
    expect(labelSaveAction('v1', '  Início  ')).toStrictEqual({ type: 'set-label', vertexId: 'v1', label: '  Início  ' });
  });

  it('um rótulo novo é UM passo de histórico, o id não muda e o layout é o mesmo', () => {
    const base = stateOf();
    const { state, error } = apply(base, labelSaveAction('v1', 'Início'));

    expect(error).toBeUndefined();
    expect(state.graph.vertices[0]).toStrictEqual({ id: 'v1', label: 'Início' });
    expect(state.history.past).toHaveLength(base.history.past.length + 1);
    expect(state.layout).toBe(base.layout);
  });

  it('o espaço das pontas sai (trim) e Unicode vale: acentos, emoji e escrita não latina', () => {
    for (const [digitado, esperado] of [['  Início ', 'Início'], ['😀', '😀'], ['東京', '東京'], ['Ação', 'Ação']] as const) {
      const { state, error } = apply(stateOf(), labelSaveAction('v1', digitado));
      expect(error).toBeUndefined();
      expect(state.graph.vertices[0]!.label).toBe(esperado);
    }
  });

  it('salvar o MESMO rótulo (ou o mesmo depois do trim) não faz nada: o mesmo estado, nenhum passo', () => {
    const base = stateOf();

    expect(apply(base, labelSaveAction('v1', 'A')).state).toBe(base);
    expect(apply(base, labelSaveAction('v1', '  A  ')).state).toBe(base);
  });

  it('rótulo vazio ou só espaços é recusado pelo domínio, sem histórico', () => {
    const base = stateOf();
    for (const draft of ['', '   ', '\t']) {
      const result = apply(base, labelSaveAction('v1', draft));
      expect(result.error).toMatchObject({ code: 'GRAPH_ERROR', error: { code: 'INVALID_VERTEX_LABEL', reason: 'EMPTY' } });
      expect(result.state.history).toBe(base.history);
      expect(result.state.graph).toBe(base.graph);
    }
  });

  it('rótulo longo demais é recusado; no limite (em pontos de código, não em unidades UTF-16) é aceito', () => {
    const base = stateOf();
    const noLimite = '😀'.repeat(MAX_VERTEX_LABEL_LENGTH); // 2 unidades UTF-16 por ponto de código
    const acima = '😀'.repeat(MAX_VERTEX_LABEL_LENGTH + 1);

    expect(apply(base, labelSaveAction('v1', noLimite)).error).toBeUndefined();
    expect(apply(base, labelSaveAction('v1', acima)).error).toMatchObject({ error: { code: 'INVALID_VERTEX_LABEL', reason: 'TOO_LONG' } });
  });

  it('rótulos repetidos são permitidos (dois vértices podem se chamar B)', () => {
    const { state, error } = apply(stateOf(), labelSaveAction('v1', 'B'));

    expect(error).toBeUndefined();
    expect(state.graph.vertices.map((vertex) => vertex.label)).toStrictEqual(['B', 'B', 'C']);
  });

  it('um vértice que não existe mais é recusado com VERTEX_NOT_FOUND', () => {
    expect(apply(stateOf(), labelSaveAction('v9', 'X')).error).toMatchObject({ error: { code: 'VERTEX_NOT_FOUND', vertexId: 'v9' } });
  });
});

describe('Salvar um peso: o texto vira número, e o campo vazio REMOVE o peso', () => {
  const save = (draft: string) => weightSaveAction('e1', draft);

  it('texto válido vira a ação set-weight com o número', () => {
    expect(save('2,5')).toStrictEqual({ ok: true, action: { type: 'set-weight', edgeId: 'e1', weight: 2.5 } });
    expect(save('-3.75')).toStrictEqual({ ok: true, action: { type: 'set-weight', edgeId: 'e1', weight: -3.75 } });
    expect(save('0')).toStrictEqual({ ok: true, action: { type: 'set-weight', edgeId: 'e1', weight: 0 } });
    expect(save('-0')).toStrictEqual({ ok: true, action: { type: 'set-weight', edgeId: 'e1', weight: 0 } });
  });

  it('campo vazio ou só espaços: a ação REMOVE o peso (weight: undefined), não grava zero', () => {
    for (const draft of ['', '  ']) {
      const result = save(draft);
      expect(result).toStrictEqual({ ok: true, action: { type: 'set-weight', edgeId: 'e1', weight: undefined } });
    }
  });

  it('texto inválido: nenhuma ação, só a mensagem em português', () => {
    expect(save('abc')).toStrictEqual({ ok: false, message: 'Digite um número, como 2, -3,5 ou 0. Deixe o campo vazio para uma aresta sem peso.' });
    expect(save('1.234,56')).toMatchObject({ ok: false });
    expect(save('Infinity')).toMatchObject({ ok: false });
    expect(save('1e400')).toStrictEqual({ ok: false, message: 'Esse número é grande ou pequeno demais para ser guardado.' });
  });

  it('um peso novo, remover o peso e trocar por zero são UM passo cada; os três valores não se confundem', () => {
    let state = stateOf({ edges: [[1, 2]] });
    const steps: number[] = [];
    const run = (draft: string) => {
      const saved = save(draft);
      if (!saved.ok) throw new Error(saved.message);
      state = apply(state, saved.action).state;
      steps.push(state.history.past.length);
    };

    expect(state.graph.edges[0]).not.toHaveProperty('weight');
    run('2,5');
    expect(state.graph.edges[0]!.weight).toBe(2.5);
    run('0');
    expect(state.graph.edges[0]!.weight).toBe(0); // peso zero
    expect('weight' in state.graph.edges[0]!).toBe(true);
    run('');
    expect(state.graph.edges[0]).not.toHaveProperty('weight'); // sem peso
    expect(steps).toStrictEqual([steps[0], steps[0]! + 1, steps[0]! + 2]);
  });

  it('salvar o MESMO peso, ou o campo vazio em uma aresta que já não tem peso, não faz nada (nenhum passo)', () => {
    const semPeso = stateOf({ edges: [[1, 2]] });
    const comPeso = stateOf({ edges: [[1, 2, 2.5]] });
    const comZero = stateOf({ edges: [[1, 2, 0]] });
    const ação = (draft: string) => {
      const saved = save(draft);
      if (!saved.ok) throw new Error(saved.message);
      return saved.action;
    };

    expect(apply(semPeso, ação('')).state).toBe(semPeso);
    expect(apply(comPeso, ação('2,5')).state).toBe(comPeso);
    expect(apply(comZero, ação('0')).state).toBe(comZero);
    expect(apply(comZero, ação('-0')).state).toBe(comZero);
  });

  it('uma aresta que não existe mais é recusada com EDGE_NOT_FOUND', () => {
    const saved = weightSaveAction('e9', '3');
    if (!saved.ok) throw new Error('esperava ação');

    expect(apply(stateOf({ edges: [[1, 2]] }), saved.action).error).toMatchObject({ error: { code: 'EDGE_NOT_FOUND', edgeId: 'e9' } });
  });
});
