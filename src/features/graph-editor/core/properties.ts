import type { EdgeId, Graph, VertexId } from '@/domain/graph';

import type { EditorAction, EditorSelection } from './editor';
import { formatWeightForInput, parseWeightInput, weightInputMessage } from './weight-input';

// Propriedades do elemento selecionado (Fase 3, incremento 3.8). TypeScript puro: descreve o que a folha de propriedades mostra e monta a
// ação que o botão Salvar entrega ao núcleo. Não altera nada e NÃO tem validação matemática própria: o rótulo e o peso passam pelo
// `set-label` e pelo `set-weight` do núcleo (`setVertexLabel` e `setEdgeWeight` do domínio), que continuam sendo a validação DEFINITIVA
// (rótulo de 1 a `MAX_VERTEX_LABEL_LENGTH` pontos de código, depois de `trim`; Unicode; rótulos repetidos permitidos; peso finito).
// A única verificação que acontece antes é a do TEXTO do peso (`parseWeightInput`), porque o campo é um texto e o `set-weight` recebe número.
//
// Rascunho: a folha começa com `propertiesDraft(alvo)` e o aluno edita só o texto; nada vai ao grafo enquanto digita. O Salvar vira UMA ação.
// Salvar o mesmo valor não muda o grafo (o núcleo devolve o mesmo estado) e não entra no histórico; salvar um valor novo é UM passo.
//
// Complexidade: `describeProperties` Θ(V + E) (procura o elemento e os rótulos); o resto é O(n) no tamanho do texto. Sem estado nem cache.

export type PropertiesTarget =
  | { readonly kind: 'vertex'; readonly vertexId: VertexId; readonly label: string }
  | {
      readonly kind: 'edge';
      readonly edgeId: EdgeId;
      readonly sourceId: VertexId;
      readonly targetId: VertexId;
      readonly sourceLabel: string;
      readonly targetLabel: string;
      readonly directed: boolean;
      /** Ausente = aresta SEM peso (diferente de `0`, que é um peso). */
      readonly weight?: number;
    };

const labelOf = (graph: Graph, vertexId: VertexId): string => graph.vertices.find((vertex) => vertex.id === vertexId)?.label ?? '?';

/** O elemento selecionado, descrito para a folha; `undefined` se não há seleção ou se o elemento não existe (mais) no grafo. */
export function describeProperties(graph: Graph, selection: EditorSelection): PropertiesTarget | undefined {
  if (selection.type === 'vertex') {
    const vertex = graph.vertices.find((candidate) => candidate.id === selection.vertexId);
    return vertex === undefined ? undefined : { kind: 'vertex', vertexId: vertex.id, label: vertex.label };
  }
  if (selection.type === 'edge') {
    const edge = graph.edges.find((candidate) => candidate.id === selection.edgeId);
    if (edge === undefined) return undefined;
    return {
      kind: 'edge',
      edgeId: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      sourceLabel: labelOf(graph, edge.source),
      targetLabel: labelOf(graph, edge.target),
      directed: graph.directed,
      ...(edge.weight !== undefined && { weight: edge.weight }),
    };
  }
  return undefined;
}

/** Título da folha: "Vértice A", "Aresta de A para B" (orientado) ou "Aresta entre A e B". */
export function propertiesTitle(target: PropertiesTarget): string {
  if (target.kind === 'vertex') return `Vértice ${target.label}`;
  return target.directed ? `Aresta de ${target.sourceLabel} para ${target.targetLabel}` : `Aresta entre ${target.sourceLabel} e ${target.targetLabel}`;
}

/** O elemento por extenso, em minúsculas, para rótulos acessíveis: "vértice A", "aresta entre A e B" ou "aresta de A para B". */
export function propertiesNoun(target: PropertiesTarget): string {
  if (target.kind === 'vertex') return `vértice ${target.label}`;
  return target.directed ? `aresta de ${target.sourceLabel} para ${target.targetLabel}` : `aresta entre ${target.sourceLabel} e ${target.targetLabel}`;
}

/** O mesmo, com a preposição contraída: "do vértice A" ou "da aresta entre A e B" ("Editar propriedades do vértice A"). */
export function propertiesGenitive(target: PropertiesTarget): string {
  return `${target.kind === 'vertex' ? 'do' : 'da'} ${propertiesNoun(target)}`;
}

/** O texto com que o campo começa: o rótulo atual, ou o peso atual (vírgula decimal; vazio se a aresta não tem peso). */
export function propertiesDraft(target: PropertiesTarget): string {
  return target.kind === 'vertex' ? target.label : formatWeightForInput(target.weight);
}

/** A ação do Salvar de um vértice: `set-label` com o texto como está (quem valida e normaliza é o domínio). */
export function labelSaveAction(vertexId: VertexId, draft: string): EditorAction {
  return { type: 'set-label', vertexId, label: draft };
}

export type WeightSave = { readonly ok: true; readonly action: EditorAction } | { readonly ok: false; readonly message: string };

/**
 * A ação do Salvar de uma aresta: `set-weight` com o número do texto (`undefined` se o campo está vazio: remove o peso), ou a mensagem em
 * português se o texto não é um número válido (e então nenhuma ação é enviada).
 */
export function weightSaveAction(edgeId: EdgeId, draft: string): WeightSave {
  const parsed = parseWeightInput(draft);
  if (!parsed.ok) return { ok: false, message: weightInputMessage(parsed.reason) };
  return { ok: true, action: { type: 'set-weight', edgeId, weight: parsed.weight } };
}
