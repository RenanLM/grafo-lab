import {
  MAX_VERTEX_LABEL_LENGTH,
  type DocumentCause,
  type GraphError,
  type InvalidDocumentReason,
  type InvalidLabelReason,
} from '@/domain/graph';

import type { EditorError } from './editor';

// Mensagens em português para os erros do domínio e do editor (Fase 3, incremento 3.4). TypeScript puro: o texto sai do CÓDIGO
// do erro e de campos limitados dele; nada do conteúdo que o aluno digitou ou do documento lido é copiado para a mensagem (um
// rótulo ou um peso inválido pode ser enorme ou hostil), e o código técnico bruto nunca é a única informação. O erro
// estruturado original continua sendo o que os testes e o diagnóstico leem; a mensagem é só para o aluno.
//
// Não cita ids técnicos (`v3`, `e7`): o aluno enxerga rótulos, e o id não lhe diz nada.

const LABEL_REASONS: Record<InvalidLabelReason, string> = {
  NOT_A_STRING: 'O rótulo precisa ser um texto.',
  EMPTY: 'O rótulo não pode ficar vazio.',
  TOO_LONG: `O rótulo pode ter no máximo ${MAX_VERTEX_LABEL_LENGTH} caracteres.`,
};

const DOCUMENT_REASONS: Record<Exclude<InvalidDocumentReason, 'DOMAIN_RULE'>, string> = {
  INVALID_JSON: 'o arquivo não contém um JSON válido',
  NOT_AN_OBJECT: 'a estrutura do documento é inesperada (esperava-se um objeto)',
  NOT_AN_ARRAY: 'esperava-se uma lista de vértices ou de arestas',
  SPARSE_ARRAY: 'uma lista tem posições vazias',
  UNREADABLE: 'há campos que não podem ser lidos',
  MISSING_FIELD: 'falta um campo obrigatório',
  UNKNOWN_FIELD: 'há um campo que o aplicativo não conhece',
  WRONG_TYPE: 'um campo tem o tipo errado',
  INVALID_ID: 'um identificador não tem o formato esperado',
  DUPLICATE_ID: 'há identificadores repetidos',
  INVALID_COUNTER: 'um contador de identificadores é inválido',
  COUNTER_TOO_LOW: 'um contador de identificadores é menor que os identificadores já usados',
  LIMIT_EXCEEDED: 'o documento passa do tamanho máximo permitido',
  INVALID_OPTION: 'uma opção de leitura é inválida',
};

function causeText(cause: DocumentCause): string {
  switch (cause.code) {
    case 'VERTEX_NOT_FOUND':
      return 'uma aresta liga um vértice que não existe';
    case 'SELF_LOOP':
      return 'há um laço (uma aresta de um vértice para ele mesmo)';
    case 'DUPLICATE_EDGE':
      return 'há arestas repetidas entre os mesmos vértices';
    case 'INVALID_WEIGHT':
      return 'um peso não é um número finito';
    case 'INVALID_VERTEX_LABEL':
      return cause.reason === 'NOT_NORMALIZED'
        ? 'um rótulo tem espaços no começo ou no fim'
        : LABEL_REASONS[cause.reason].replace(/\.$/, '').replace(/^./, (letter) => letter.toLowerCase());
  }
}

function documentReasonText(error: Extract<GraphError, { code: 'INVALID_DOCUMENT' }>): string {
  if (error.reason !== 'DOMAIN_RULE') return DOCUMENT_REASONS[error.reason];
  return error.cause === undefined ? 'uma regra do grafo foi violada' : causeText(error.cause);
}

/** Mensagem em português para um erro do domínio (`GraphError`). */
export function graphErrorMessage(error: GraphError): string {
  switch (error.code) {
    case 'VERTEX_NOT_FOUND':
      return 'Esse vértice não existe (mais) no grafo.';
    case 'EDGE_NOT_FOUND':
      return 'Essa aresta não existe (mais) no grafo.';
    case 'SELF_LOOP':
      return 'Não é possível ligar um vértice a ele mesmo: grafos simples não têm laços.';
    case 'DUPLICATE_EDGE':
      return 'Esses dois vértices já estão ligados por uma aresta (no mesmo sentido, se o grafo é orientado).';
    case 'INVALID_WEIGHT':
      return 'O peso precisa ser um número finito (0 e valores negativos são permitidos).';
    case 'INVALID_VERTEX_LABEL':
      return LABEL_REASONS[error.reason];
    case 'INVALID_DOCUMENT': {
      const where = error.path === '' ? '' : ` (em ${error.path})`;
      return `O documento é inválido: ${documentReasonText(error)}${where}.`;
    }
    case 'UNSUPPORTED_SCHEMA_VERSION':
      return `Este documento usa a versão ${error.version} do formato, que o aplicativo não lê (versões aceitas: ${error.supported.join(', ')}).`;
  }
}

/** Mensagem em português para um erro do editor (`EditorError`); os erros do domínio passam por `graphErrorMessage`. */
export function editorErrorMessage(error: EditorError): string {
  switch (error.code) {
    case 'GRAPH_ERROR':
      return graphErrorMessage(error.error);
    case 'INVALID_POSITION':
      return 'A posição indicada não é válida.';
    case 'NOTHING_SELECTED':
      return 'Selecione um vértice ou uma aresta primeiro.';
    case 'INVALID_MODE':
      return 'Esse modo de edição não existe.';
  }
}
