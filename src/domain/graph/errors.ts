import type { EdgeId, VertexId } from './types';

/** Por que um rótulo de vértice foi recusado (a interface escolhe a mensagem a partir daqui). */
export type InvalidLabelReason = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG';

/**
 * Por que um documento (JSON) foi recusado por `parseGraph`/`parseGraphJson`. O texto exibido ao aluno sai
 * daqui e do `path`; nada do conteúdo do documento é copiado para o erro.
 */
export type InvalidDocumentReason =
  | 'INVALID_JSON' // o texto não é JSON (só `parseGraphJson`)
  | 'NOT_AN_OBJECT' // esperava objeto simples: veio null, array, número, função, instância de classe…
  | 'NOT_AN_ARRAY' // `vertices` ou `edges` não é array
  | 'SPARSE_ARRAY' // array com buraco (índice sem elemento)
  | 'UNREADABLE' // propriedade com getter/setter ou oculta, ou objeto que lança ao ser inspecionado (proxy)
  | 'MISSING_FIELD' // campo obrigatório ausente
  | 'UNKNOWN_FIELD' // campo que o esquema não define (o `path` aponta o objeto que o contém)
  | 'WRONG_TYPE' // tipo errado em campo sem regra própria no domínio
  | 'INVALID_ID' // id que não é canônico (`v<n>`/`e<n>`, n inteiro positivo seguro, sem zeros à esquerda)
  | 'DUPLICATE_ID' // id repetido entre vértices ou entre arestas
  | 'INVALID_COUNTER' // contador que não é inteiro seguro maior ou igual a 1
  | 'COUNTER_TOO_LOW' // contador não é maior que o sufixo de todos os ids presentes
  | 'LIMIT_EXCEEDED' // texto, `vertices` ou `edges` acima do limite configurado
  | 'INVALID_OPTION' // opção de `parseGraph` inválida (erro de quem chama, não do documento; `path` = `options…`)
  | 'DOMAIN_RULE'; // violação de regra do modelo; o motivo está em `cause`

/**
 * Regra do modelo que o documento viola. Só o código e motivos limitados: o valor que veio no documento
 * (um peso, um rótulo, um id) nunca é copiado para o erro.
 */
export type DocumentCause =
  | { readonly code: 'VERTEX_NOT_FOUND' } // `source`/`target` não existe entre os vértices do documento
  | { readonly code: 'SELF_LOOP' }
  | { readonly code: 'DUPLICATE_EDGE'; readonly existingEdgeId: EdgeId }
  | { readonly code: 'INVALID_WEIGHT' }
  | {
      readonly code: 'INVALID_VERTEX_LABEL';
      /** `NOT_NORMALIZED`: o rótulo tem espaço nas pontas; o documento deveria ter vindo do `serializeGraph`. */
      readonly reason: InvalidLabelReason | 'NOT_NORMALIZED';
    };

/**
 * Erros de uso do modelo (entrada do aluno ou do editor) e de leitura de documentos. São valores, não
 * exceções: a interface decide o texto exibido a partir do `code`.
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
    }
  | {
      readonly code: 'INVALID_DOCUMENT';
      /**
       * Propriedade do documento onde está o problema: `vertices[2].label`, `edges[3].weight`, `nextVertexSeq`.
       * `''` = o documento inteiro. Montado só com nomes de campos do esquema e índices: nunca contém texto do
       * documento (o `UNKNOWN_FIELD` aponta o objeto que contém o campo, não o campo).
       */
      readonly path: string;
      readonly reason: InvalidDocumentReason;
      /** Presente quando `reason` é `DOMAIN_RULE`. */
      readonly cause?: DocumentCause;
    }
  | {
      readonly code: 'UNSUPPORTED_SCHEMA_VERSION';
      /** A versão que o documento declara (um número; versão que não é número é `INVALID_DOCUMENT`/`WRONG_TYPE`). */
      readonly version: number;
      /** As versões que este leitor entende. */
      readonly supported: readonly number[];
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
