import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  applyAction,
  confirmedDeletionAction,
  createEditorState,
  deletionMessage,
  describeDeletion,
  emptyLayout,
  placeVertex,
  positionOf,
  type EditorAction,
  type EditorSelection,
  type EditorState,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Exclusão com confirmação (ver deletion.ts): a descrição, a contagem de incidentes (cada aresta uma vez), a pergunta em português e a
// identidade do alvo. Quem exclui é o `remove-selection` do núcleo; os testes de integração conferem o histórico e o desfazer.

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = { directed?: boolean; vertices?: number; edges?: readonly (readonly [number, number])[] };

/** Vértices v1 (A), v2 (B)… em posições conhecidas, e as arestas dadas (por índice), e nenhuma seleção. */
function stateOf({ directed = false, vertices = 4, edges = [] }: Spec = {}): EditorState {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  for (let i = 0; i < vertices; i++) {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, { x: 40 + i * 60, y: 50 + i * 20 });
  }
  for (const [source, target] of edges) graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}` })).graph;
  return createEditorState({ graph, layout });
}

const vertexSel = (vertexId: string): EditorSelection => ({ type: 'vertex', vertexId });
const edgeSel = (edgeId: string): EditorSelection => ({ type: 'edge', edgeId });
const select = (state: EditorState, selection: EditorSelection): EditorState => applyAction(state, { type: 'select', selection }).state;
const step = (state: EditorState, action: EditorAction): EditorState => applyAction(state, action).state;

describe('describeDeletion: o que a exclusão levaria', () => {
  it('vértice isolado: nenhuma aresta incidente', () => {
    expect(describeDeletion(stateOf({ edges: [[1, 2]] }).graph, vertexSel('v3'))).toStrictEqual({
      kind: 'vertex', vertexId: 'v3', label: 'C', incidentEdgeCount: 0,
    });
  });

  it('vértice com uma aresta, e com várias (cada uma contada UMA vez)', () => {
    const graph = stateOf({ edges: [[1, 2], [1, 3], [1, 4], [2, 3]] }).graph;

    expect(describeDeletion(graph, vertexSel('v4'))).toMatchObject({ incidentEdgeCount: 1 });
    expect(describeDeletion(graph, vertexSel('v1'))).toMatchObject({ incidentEdgeCount: 3 });
    expect(describeDeletion(graph, vertexSel('v2'))).toMatchObject({ incidentEdgeCount: 2 });
  });

  it('grafo orientado: arestas de ENTRADA e de SAÍDA contam, e A → B com B → A são duas', () => {
    const graph = stateOf({ directed: true, edges: [[1, 2], [2, 1], [3, 1], [1, 4]] }).graph;

    expect(describeDeletion(graph, vertexSel('v1'))).toMatchObject({ incidentEdgeCount: 4 }); // 2 de saída (1→2, 1→4) e 2 de entrada (2→1, 3→1) = 4 arestas
    expect(describeDeletion(graph, vertexSel('v2'))).toMatchObject({ incidentEdgeCount: 2 }); // 1→2 e 2→1
    expect(describeDeletion(graph, vertexSel('v4'))).toMatchObject({ incidentEdgeCount: 1 }); // só 1→4, de entrada
  });

  it('grafo não orientado: a aresta A—B conta para os dois extremos, e só uma vez para cada', () => {
    const graph = stateOf({ edges: [[1, 2]] }).graph;

    expect(describeDeletion(graph, vertexSel('v1'))).toMatchObject({ incidentEdgeCount: 1 });
    expect(describeDeletion(graph, vertexSel('v2'))).toMatchObject({ incidentEdgeCount: 1 });
  });

  it('aresta: id, rótulos dos extremos e a orientação', () => {
    expect(describeDeletion(stateOf({ edges: [[1, 2]] }).graph, edgeSel('e1'))).toStrictEqual({
      kind: 'edge', edgeId: 'e1', sourceLabel: 'A', targetLabel: 'B', directed: false,
    });
    expect(describeDeletion(stateOf({ directed: true, edges: [[2, 1]] }).graph, edgeSel('e1'))).toStrictEqual({
      kind: 'edge', edgeId: 'e1', sourceLabel: 'B', targetLabel: 'A', directed: true,
    });
  });

  it('sem seleção ou com elemento que não existe (mais): undefined', () => {
    const { graph } = stateOf({ edges: [[1, 2]] });

    expect(describeDeletion(graph, { type: 'none' })).toBeUndefined();
    expect(describeDeletion(graph, vertexSel('v9'))).toBeUndefined();
    expect(describeDeletion(graph, edgeSel('e9'))).toBeUndefined();
  });

  it('a contagem confere com o que o núcleo realmente remove (200 grafos aleatórios, sementes fixas)', () => {
    const random = seededRandom(4242);
    for (let run = 0; run < 200; run++) {
      const vertices = 2 + Math.floor(random() * 5);
      const edges: [number, number][] = [];
      const directed = random() < 0.5;
      for (let a = 1; a <= vertices; a++) {
        for (let b = 1; b <= vertices; b++) {
          if (a === b || (!directed && b < a)) continue;
          if (random() < 0.4) edges.push([a, b]);
        }
      }
      const base = stateOf({ directed, vertices, edges });
      const alvo = `v${1 + Math.floor(random() * vertices)}`;
      const summary = describeDeletion(base.graph, vertexSel(alvo));
      const after = step(select(base, vertexSel(alvo)), { type: 'remove-selection' });

      expect(summary).toBeDefined();
      expect(base.graph.edges.length - after.graph.edges.length).toBe(summary!.kind === 'vertex' ? summary!.incidentEdgeCount : -1);
    }
  });

  it('não altera o grafo (congelado)', () => {
    const { graph } = stateOf({ edges: [[1, 2]] });

    expect(() => describeDeletion(deepFreeze(graph), vertexSel('v1'))).not.toThrow();
  });
});

describe('deletionMessage: a pergunta de confirmação em português', () => {
  const message = (state: EditorState, selection: EditorSelection) => deletionMessage(describeDeletion(state.graph, selection)!);

  it('vértice com várias arestas: "Excluir o vértice A? Também serão removidas 3 arestas conectadas a ele."', () => {
    const state = stateOf({ edges: [[1, 2], [1, 3], [1, 4]] });

    expect(message(state, vertexSel('v1'))).toBe('Excluir o vértice A? Também serão removidas 3 arestas conectadas a ele.');
  });

  it('vértice com uma aresta (singular) e sem aresta', () => {
    const state = stateOf({ edges: [[1, 2]] });

    expect(message(state, vertexSel('v2'))).toBe('Excluir o vértice B? Também será removida 1 aresta conectada a ele.');
    expect(message(state, vertexSel('v3'))).toBe('Excluir o vértice C? Nenhuma aresta está conectada a ele.');
  });

  it('aresta: "entre A e B" no não orientado e "de A para B" no orientado', () => {
    expect(message(stateOf({ edges: [[1, 2]] }), edgeSel('e1'))).toBe('Excluir a aresta entre A e B?');
    expect(message(stateOf({ directed: true, edges: [[2, 1]] }), edgeSel('e1'))).toBe('Excluir a aresta de B para A?');
  });

  it('cita o rótulo, nunca o id técnico', () => {
    const state = stateOf({ edges: [[1, 2]] });

    expect(message(state, vertexSel('v1'))).not.toMatch(/\bv\d+\b/);
    expect(message(state, edgeSel('e1'))).not.toMatch(/\be\d+\b/);
  });
});

describe('confirmedDeletionAction: a confirmação só vale para o MESMO elemento', () => {
  it('seleção igual ao que a pergunta descreveu: remove-selection', () => {
    const state = select(stateOf({ edges: [[1, 2]] }), vertexSel('v1'));
    const summary = describeDeletion(state.graph, state.selection)!;

    expect(confirmedDeletionAction(state, summary)).toStrictEqual({ type: 'remove-selection' });
  });

  it('a seleção mudou para outro vértice, para uma aresta ou foi limpa: nenhuma ação (nada de excluir o elemento errado)', () => {
    const state = select(stateOf({ edges: [[1, 2]] }), vertexSel('v1'));
    const summary = describeDeletion(state.graph, state.selection)!;

    expect(confirmedDeletionAction(select(state, vertexSel('v2')), summary)).toBeUndefined();
    expect(confirmedDeletionAction(select(state, edgeSel('e1')), summary)).toBeUndefined();
    expect(confirmedDeletionAction(step(state, { type: 'clear-selection' }), summary)).toBeUndefined();
  });

  it('a seleção passou para OUTRA aresta (ou outro vértice) do mesmo tipo: nenhuma ação, a confirmação é só do elemento que foi perguntado', () => {
    const state = select(stateOf({ edges: [[1, 2], [2, 3]] }), edgeSel('e1'));
    const summary = describeDeletion(state.graph, state.selection)!;

    expect(confirmedDeletionAction(state, summary)).toStrictEqual({ type: 'remove-selection' });
    expect(confirmedDeletionAction(select(state, edgeSel('e2')), summary)).toBeUndefined();

    const vertex = select(stateOf({ edges: [[1, 2]] }), vertexSel('v1'));
    const vertexSummary = describeDeletion(vertex.graph, vertex.selection)!;
    expect(confirmedDeletionAction(select(vertex, vertexSel('v3')), vertexSummary)).toBeUndefined();
  });

  it('o elemento deixou de existir: nenhuma ação', () => {
    const state = select(stateOf({ edges: [[1, 2]] }), edgeSel('e1'));
    const summary = describeDeletion(state.graph, state.selection)!;
    const gone = step(state, { type: 'remove-selection' });

    expect(confirmedDeletionAction(gone, summary)).toBeUndefined();
  });

  it('vértice e aresta nunca se confundem, mesmo com ids parecidos', () => {
    const state = select(stateOf({ edges: [[1, 2]] }), edgeSel('e1'));
    const vertexSummary = describeDeletion(state.graph, vertexSel('v1'))!;

    expect(confirmedDeletionAction(state, vertexSummary)).toBeUndefined(); // a seleção é uma aresta
  });
});

describe('integração com applyAction: UM passo, desfazer restaura e refazer remove de novo', () => {
  /** Grafo orientado A, B, C, D com A→B, B→A, C→A, A→D e B→C; A selecionado. */
  const scenario = () => select(stateOf({ directed: true, edges: [[1, 2], [2, 1], [3, 1], [1, 4], [2, 3]] }), vertexSel('v1'));

  it('excluir um vértice com várias arestas é UM passo; a seleção, as arestas e a posição saem', () => {
    const base = scenario();
    const summary = describeDeletion(base.graph, base.selection)!;
    const action = confirmedDeletionAction(base, summary)!;
    const after = step(base, action);

    expect(after.history.past).toHaveLength(base.history.past.length + 1);
    expect(after.graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3', 'v4']);
    expect(after.graph.edges.map((edge) => edge.id)).toStrictEqual(['e5']); // só B→C sobrevive
    expect(positionOf(after.layout, 'v1')).toBeUndefined();
    expect(after.selection).toStrictEqual({ type: 'none' });
    expect(summary).toMatchObject({ incidentEdgeCount: 4 });
  });

  it('desfazer restaura vértice, arestas e posição; refazer remove de novo; os contadores de id nunca recuam', () => {
    const base = scenario();
    const after = step(base, { type: 'remove-selection' });
    const undone = step(after, { type: 'undo' });
    const redone = step(undone, { type: 'redo' });

    expect(undone.graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
    expect(undone.graph.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(positionOf(undone.layout, 'v1')).toStrictEqual(positionOf(base.layout, 'v1'));
    expect(redone.graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3', 'v4']);
    expect(redone.graph.edges.map((edge) => edge.id)).toStrictEqual(['e5']);
    for (const state of [after, undone, redone]) {
      expect(state.graph.nextVertexSeq).toBeGreaterThanOrEqual(base.graph.nextVertexSeq);
      expect(state.graph.nextEdgeSeq).toBeGreaterThanOrEqual(base.graph.nextEdgeSeq);
    }
  });

  it('depois de excluir, um vértice novo NÃO reaproveita o id do excluído', () => {
    const after = step(scenario(), { type: 'remove-selection' });
    const added = step(after, { type: 'add-vertex', position: { x: 10, y: 10 } });

    expect(added.graph.vertices.map((vertex) => vertex.id)).toStrictEqual(['v2', 'v3', 'v4', 'v5']);
  });

  it('excluir uma aresta é UM passo; desfazer a devolve com o mesmo id, e a seleção some', () => {
    const base = select(stateOf({ edges: [[1, 2], [2, 3]] }), edgeSel('e2'));
    const after = step(base, { type: 'remove-selection' });

    expect(after.history.past).toHaveLength(base.history.past.length + 1);
    expect(after.graph.edges.map((edge) => edge.id)).toStrictEqual(['e1']);
    expect(after.selection).toStrictEqual({ type: 'none' });
    expect(step(after, { type: 'undo' }).graph.edges.map((edge) => edge.id)).toStrictEqual(['e1', 'e2']);
  });

  it('uma edição nova depois de desfazer a exclusão descarta o ramo de refazer', () => {
    const after = step(scenario(), { type: 'remove-selection' });
    const undone = step(after, { type: 'undo' });
    const edited = step(undone, { type: 'set-label', vertexId: 'v2', label: 'Novo' });

    expect(undone.history.future).toHaveLength(1);
    expect(edited.history.future).toHaveLength(0);
  });
});
