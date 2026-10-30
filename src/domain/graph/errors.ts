import type { EdgeId, VertexId } from './types';

/** Por que um rótulo de vértice foi recusado (a interface escolhe a mensagem a partir daqui). */
export type InvalidLabelReason = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG';

/**
 * Erros de uso do modelo (entrada do aluno ou do editor). São valores, não exceções:
 * a interface decide o texto exibido a partir do `code`.
 */
export type GraphError =
  | { readonly code: 'VERTEX_NOT_FOUND'; readonly vertexId: VertexId }
  | { readonly code: 'EDGE_NOT_FOUND'; readonly edgeId: EdgeId }
  | { readonly code: 'SELF_LOOP'; readonly vertexId: VertexId }
  | { readonly code: 'DUPLICATE_EDGE'; readonly existingEdgeId: EdgeId }
  | { readonly code: 'INVALID_WEIGHT'; readonly weight: unknown }
  | {
      readonly code: 'INVALID_VERTEX_LABEL';
      readonly label: unknown;
      readonly reason: InvalidLabelReason;
    };

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GraphError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(error: GraphError): Result<never> {
  return { ok: false, error };
}
