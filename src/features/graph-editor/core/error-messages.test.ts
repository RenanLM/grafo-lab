import type { GraphError, InvalidDocumentReason, InvalidLabelReason } from '@/domain/graph';

import { editorErrorMessage, graphErrorMessage, type EditorError } from './index';
import { deepFreeze } from './test-helpers';

// Mensagens em português (ver error-messages.ts). O compilador exige uma amostra para CADA código de erro do domínio.

const SAMPLES: Record<GraphError['code'], GraphError> = {
  VERTEX_NOT_FOUND: { code: 'VERTEX_NOT_FOUND', vertexId: 'v3' },
  EDGE_NOT_FOUND: { code: 'EDGE_NOT_FOUND', edgeId: 'e7' },
  SELF_LOOP: { code: 'SELF_LOOP', vertexId: 'v1' },
  DUPLICATE_EDGE: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e2' },
  INVALID_WEIGHT: { code: 'INVALID_WEIGHT', weight: Number.NaN },
  INVALID_VERTEX_LABEL: { code: 'INVALID_VERTEX_LABEL', label: '', reason: 'EMPTY' },
  INVALID_DOCUMENT: { code: 'INVALID_DOCUMENT', path: 'vertices[2].label', reason: 'WRONG_TYPE' },
  UNSUPPORTED_SCHEMA_VERSION: { code: 'UNSUPPORTED_SCHEMA_VERSION', version: 2, supported: [1] },
};

const LABEL_REASONS: readonly InvalidLabelReason[] = ['NOT_A_STRING', 'EMPTY', 'TOO_LONG'];

const DOCUMENT_REASONS: Record<InvalidDocumentReason, true> = {
  INVALID_JSON: true,
  NOT_AN_OBJECT: true,
  NOT_AN_ARRAY: true,
  SPARSE_ARRAY: true,
  UNREADABLE: true,
  MISSING_FIELD: true,
  UNKNOWN_FIELD: true,
  WRONG_TYPE: true,
  INVALID_ID: true,
  DUPLICATE_ID: true,
  INVALID_COUNTER: true,
  COUNTER_TOO_LOW: true,
  LIMIT_EXCEEDED: true,
  INVALID_OPTION: true,
  DOMAIN_RULE: true,
};

/** Código técnico em MAIÚSCULAS_COM_SUBLINHADO ou id técnico (`v3`, `e7`): não pode aparecer numa mensagem para o aluno. */
const RAW_TECHNICAL = /[A-Z]{2,}_[A-Z_]+|\b[ve]\d+\b/;

describe('graphErrorMessage', () => {
  it.each(Object.values(SAMPLES))('$code: texto em português, uma frase, sem código técnico nem id', (error) => {
    const message = graphErrorMessage(error);

    expect(message.length).toBeGreaterThan(15);
    expect(message).toMatch(/\.$/);
    expect(message).not.toMatch(RAW_TECHNICAL);
    expect(message).not.toContain(error.code);
    expect(message).not.toMatch(/undefined|null|\[object/);
  });

  it('as situações do enunciado têm o texto esperado', () => {
    expect(graphErrorMessage(SAMPLES.VERTEX_NOT_FOUND)).toBe('Esse vértice não existe (mais) no grafo.');
    expect(graphErrorMessage(SAMPLES.EDGE_NOT_FOUND)).toBe('Essa aresta não existe (mais) no grafo.');
    expect(graphErrorMessage(SAMPLES.SELF_LOOP)).toBe('Não é possível ligar um vértice a ele mesmo: grafos simples não têm laços.');
    expect(graphErrorMessage(SAMPLES.DUPLICATE_EDGE)).toBe(
      'Esses dois vértices já estão ligados por uma aresta (no mesmo sentido, se o grafo é orientado).',
    );
    expect(graphErrorMessage(SAMPLES.INVALID_WEIGHT)).toBe('O peso precisa ser um número finito (0 e valores negativos são permitidos).');
  });

  it('cada motivo de rótulo inválido tem a sua mensagem, e o limite de 64 caracteres aparece na do rótulo longo', () => {
    const messages = LABEL_REASONS.map((reason) => graphErrorMessage({ code: 'INVALID_VERTEX_LABEL', label: 'x', reason }));

    expect(new Set(messages).size).toBe(3);
    expect(messages).toStrictEqual([
      'O rótulo precisa ser um texto.',
      'O rótulo não pode ficar vazio.',
      'O rótulo pode ter no máximo 64 caracteres.',
    ]);
  });

  it('não copia para a mensagem o que o aluno digitou nem o valor recusado (rótulo gigante, peso)', () => {
    const gigante = graphErrorMessage({ code: 'INVALID_VERTEX_LABEL', label: 'Ω'.repeat(100000), reason: 'TOO_LONG' });
    const peso = graphErrorMessage({ code: 'INVALID_WEIGHT', weight: 'abc-secreto' });

    expect(gigante.length).toBeLessThan(100);
    expect(gigante).not.toContain('Ω');
    expect(peso).not.toContain('abc-secreto');
    expect(graphErrorMessage({ code: 'INVALID_WEIGHT', weight: Number.NaN })).not.toContain('NaN');
  });

  it('documento inválido: um texto para cada motivo, com o caminho do campo (e sem ele para o documento inteiro)', () => {
    const reasons = Object.keys(DOCUMENT_REASONS) as InvalidDocumentReason[];
    const messages = reasons.map((reason) => graphErrorMessage({ code: 'INVALID_DOCUMENT', path: 'edges[3].weight', reason }));

    for (const message of messages) {
      expect(message).toMatch(/^O documento é inválido: .+ \(em edges\[3\]\.weight\)\.$/);
      expect(message).not.toMatch(RAW_TECHNICAL);
    }
    expect(new Set(messages).size).toBe(reasons.length); // um texto próprio para cada um dos 15 motivos
    expect(graphErrorMessage({ code: 'INVALID_DOCUMENT', path: '', reason: 'INVALID_JSON' })).toBe(
      'O documento é inválido: o arquivo não contém um JSON válido.',
    );
  });

  it('documento inválido por regra do modelo: o texto vem da causa', () => {
    const cause = (c: Extract<GraphError, { code: 'INVALID_DOCUMENT' }>['cause']) =>
      graphErrorMessage({ code: 'INVALID_DOCUMENT', path: 'edges[0]', reason: 'DOMAIN_RULE', cause: c });

    expect(cause({ code: 'SELF_LOOP' })).toContain('laço');
    expect(cause({ code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' })).toContain('repetidas');
    expect(cause({ code: 'VERTEX_NOT_FOUND' })).toContain('não existe');
    expect(cause({ code: 'INVALID_WEIGHT' })).toContain('peso');
    expect(cause({ code: 'INVALID_VERTEX_LABEL', reason: 'NOT_NORMALIZED' })).toContain('espaços');
    expect(cause({ code: 'INVALID_VERTEX_LABEL', reason: 'EMPTY' })).toBe('O documento é inválido: o rótulo não pode ficar vazio (em edges[0]).');
    expect(cause(undefined)).toContain('regra do grafo');
    for (const motivo of [...LABEL_REASONS, 'NOT_NORMALIZED'] as const) {
      expect(cause({ code: 'INVALID_VERTEX_LABEL', reason: motivo })).not.toMatch(RAW_TECHNICAL);
    }
  });

  it('versão de formato não suportada: cita a versão do documento e as aceitas', () => {
    expect(graphErrorMessage({ code: 'UNSUPPORTED_SCHEMA_VERSION', version: 2, supported: [1] })).toBe(
      'Este documento usa a versão 2 do formato, que o aplicativo não lê (versões aceitas: 1).',
    );
    expect(graphErrorMessage({ code: 'UNSUPPORTED_SCHEMA_VERSION', version: 7, supported: [1, 2] })).toContain('1, 2');
  });

  it('não altera o erro recebido (congelado) e é determinística', () => {
    for (const error of Object.values(SAMPLES)) {
      const congelado = deepFreeze(structuredClone(error));

      expect(graphErrorMessage(congelado)).toBe(graphErrorMessage(error));
    }
  });
});

describe('editorErrorMessage', () => {
  it('erro do domínio: a mesma mensagem de graphErrorMessage', () => {
    for (const error of Object.values(SAMPLES)) {
      expect(editorErrorMessage({ code: 'GRAPH_ERROR', error })).toBe(graphErrorMessage(error));
    }
  });

  it('erros do editor: texto em português, sem código técnico', () => {
    const errors: EditorError[] = [{ code: 'INVALID_POSITION' }, { code: 'NOTHING_SELECTED' }, { code: 'INVALID_MODE' }];
    const messages = errors.map(editorErrorMessage);

    expect(messages).toStrictEqual([
      'A posição indicada não é válida.',
      'Selecione um vértice ou uma aresta primeiro.',
      'Esse modo de edição não existe.',
    ]);
    for (const message of messages) expect(message).not.toMatch(RAW_TECHNICAL);
  });
});
