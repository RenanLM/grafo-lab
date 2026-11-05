import type { EdgeId, Graph, VertexId } from '@/domain/graph';

import type { EditorAction, EditorSelection, EditorState } from './editor';

// Exclusão com confirmação (Fase 3, incremento 3.8). TypeScript puro: descreve o que seria excluído, monta a pergunta de confirmação e
// decide se a confirmação ainda vale. Quem exclui é o `remove-selection` do núcleo (`removeVertex` e `removeEdge` do domínio); aqui não
// se remove nada, não se mexe no layout e não se conta o histórico.
//
// O que o `remove-selection` faz (3.4): remove o vértice selecionado COM as arestas incidentes (como origem ou como destino) e a posição dele
// no layout, ou a aresta selecionada; limpa a seleção; entra UM passo no histórico, qualquer que seja o número de arestas que somem. Desfazer
// restaura vértice, arestas e posição; refazer remove de novo; os contadores de id nunca recuam.
//
// Identidade do alvo: a confirmação guarda o `DeletionSummary` do momento em que a pergunta foi feita. Ao confirmar, `confirmedDeletionAction`
// só devolve a ação se a seleção ATUAL ainda é aquele mesmo elemento (e ele existe): se a seleção mudou, nada é excluído, porque o
// `remove-selection` age sobre a seleção atual e poderia levar um elemento diferente do que o aluno viu.
//
// Complexidade: `describeDeletion` Θ(V + E) (procura o elemento, os rótulos e conta as incidentes, cada aresta uma vez).

export type DeletionSummary =
  | {
      readonly kind: 'vertex';
      readonly vertexId: VertexId;
      readonly label: string;
      /** Arestas que somem junto: as que têm o vértice como origem OU destino, cada uma contada UMA vez. */
      readonly incidentEdgeCount: number;
    }
  | {
      readonly kind: 'edge';
      readonly edgeId: EdgeId;
      readonly sourceLabel: string;
      readonly targetLabel: string;
      readonly directed: boolean;
    };

const labelOf = (graph: Graph, vertexId: VertexId): string => graph.vertices.find((vertex) => vertex.id === vertexId)?.label ?? '?';

/** O que a exclusão do elemento selecionado levaria, ou `undefined` se não há seleção ou o elemento não existe (mais). */
export function describeDeletion(graph: Graph, selection: EditorSelection): DeletionSummary | undefined {
  if (selection.type === 'vertex') {
    const vertex = graph.vertices.find((candidate) => candidate.id === selection.vertexId);
    if (vertex === undefined) return undefined;
    let incidentEdgeCount = 0;
    for (const edge of graph.edges) if (edge.source === vertex.id || edge.target === vertex.id) incidentEdgeCount++;
    return { kind: 'vertex', vertexId: vertex.id, label: vertex.label, incidentEdgeCount };
  }
  if (selection.type === 'edge') {
    const edge = graph.edges.find((candidate) => candidate.id === selection.edgeId);
    if (edge === undefined) return undefined;
    return {
      kind: 'edge',
      edgeId: edge.id,
      sourceLabel: labelOf(graph, edge.source),
      targetLabel: labelOf(graph, edge.target),
      directed: graph.directed,
    };
  }
  return undefined;
}

/**
 * A pergunta de confirmação, em português.
 * - vértice: "Excluir o vértice A? Também serão removidas 3 arestas conectadas a ele." (singular: "Também será removida 1 aresta conectada a ele."; sem
 *   arestas: "Nenhuma aresta está conectada a ele.");
 * - aresta: "Excluir a aresta entre A e B?" ou, em grafo orientado, "Excluir a aresta de A para B?".
 */
export function deletionMessage(summary: DeletionSummary): string {
  if (summary.kind === 'edge') {
    return summary.directed
      ? `Excluir a aresta de ${summary.sourceLabel} para ${summary.targetLabel}?`
      : `Excluir a aresta entre ${summary.sourceLabel} e ${summary.targetLabel}?`;
  }
  const { label, incidentEdgeCount: count } = summary;
  if (count === 0) return `Excluir o vértice ${label}? Nenhuma aresta está conectada a ele.`;
  if (count === 1) return `Excluir o vértice ${label}? Também será removida 1 aresta conectada a ele.`;
  return `Excluir o vértice ${label}? Também serão removidas ${count} arestas conectadas a ele.`;
}

/**
 * A ação da confirmação, ou `undefined` se ela não vale mais: a seleção atual precisa ser EXATAMENTE o elemento que a pergunta descreveu,
 * e ele precisa existir. Devolve `remove-selection` (o núcleo age sobre a seleção).
 */
export function confirmedDeletionAction(editor: Pick<EditorState, 'graph' | 'selection'>, summary: DeletionSummary): EditorAction | undefined {
  const current = describeDeletion(editor.graph, editor.selection);
  if (current === undefined || current.kind !== summary.kind) return undefined;
  if (current.kind === 'vertex' && summary.kind === 'vertex') return current.vertexId === summary.vertexId ? { type: 'remove-selection' } : undefined;
  if (current.kind === 'edge' && summary.kind === 'edge') return current.edgeId === summary.edgeId ? { type: 'remove-selection' } : undefined;
  return undefined;
}
