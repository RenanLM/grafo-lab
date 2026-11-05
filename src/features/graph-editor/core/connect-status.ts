import type { Graph, VertexId } from '@/domain/graph';

import type { ConnectState } from './connect';
import type { EditorState } from './editor';
import { editorErrorMessage } from './error-messages';

// Texto de estado do modo Conectar (Fase 3, incremento 3.7), em português. TypeScript puro: o texto sai do estado (origem pendente,
// aviso do último toque, modo e grafo). O único dado do aluno que ele cita é o RÓTULO dos vértices, que o aluno já vê no quadro;
// nunca cita ids técnicos (`v3`). A interface só o exibe; a decisão do que dizer é daqui, então é testável sem renderizar nada.

/** O que o último toque do modo Conectar fez, para o aluno ouvir ou ler. Some na próxima ação, troca de modo ou novo toque que escolha a origem. */
export type ConnectNotice =
  /** A aresta foi criada. A mensagem depende de o grafo ser orientado ou não (a orientação é do `Graph`). */
  | { readonly kind: 'created'; readonly source: VertexId; readonly target: VertexId }
  /** O domínio recusou a conexão; o motivo está em `editor.error`. */
  | { readonly kind: 'refused' }
  /** O aluno desistiu (ou a origem deixou de existir). */
  | { readonly kind: 'cancelled' };

/** Instrução sem origem pendente: o que fazer em seguida. */
export const CONNECT_IDLE_MESSAGE = 'Toque em um vértice para escolher a origem da conexão.';

const labelOf = (graph: Graph, vertexId: VertexId): string => graph.vertices.find((vertex) => vertex.id === vertexId)?.label ?? '?';

/**
 * A frase de estado do modo Conectar, ou texto vazio fora dele.
 * - origem pendente: "Origem: A. Toque no vértice de destino.";
 * - conexão criada: "Aresta criada de A para B." (orientado) ou "Aresta criada entre A e B." (não orientado);
 * - recusada: "Conexão não criada." e o motivo do domínio, em português (aresta repetida, por exemplo);
 * - cancelada: "Conexão cancelada.";
 * - nada em andamento: a instrução para escolher a origem.
 * Θ(V): procura os rótulos.
 */
export function connectStatusMessage(
  editor: Pick<EditorState, 'mode' | 'graph' | 'error'>,
  connection: ConnectState,
  notice: ConnectNotice | undefined,
): string {
  if (editor.mode !== 'connect') return '';
  const { graph } = editor;

  if (connection.sourceVertexId !== undefined) {
    return `Origem: ${labelOf(graph, connection.sourceVertexId)}. Toque no vértice de destino.`;
  }
  if (notice?.kind === 'created') {
    const from = labelOf(graph, notice.source);
    const to = labelOf(graph, notice.target);
    return graph.directed ? `Aresta criada de ${from} para ${to}.` : `Aresta criada entre ${from} e ${to}.`;
  }
  if (notice?.kind === 'refused') {
    return editor.error === undefined ? 'Conexão não criada.' : `Conexão não criada. ${editorErrorMessage(editor.error)}`;
  }
  if (notice?.kind === 'cancelled') return 'Conexão cancelada.';
  return CONNECT_IDLE_MESSAGE;
}
