import type { Edge } from './types';

// Cópia do peso de uma aresta para dentro de uma representação (lista de adjacência, matriz de adjacência e lista
// de incidência). Centraliza a regra que não pode ser quebrada: "sem peso", "peso zero" e "peso negativo" são
// coisas diferentes, e a aresta sem peso NUNCA ganha um peso 1.
// Uso interno do domínio: não faz parte da API pública (`index.ts`).

/**
 * Para ser ESPALHADO em um objeto (`{ edgeId, ...weightField(edge) }`): devolve `undefined` se a aresta não tem
 * peso (espalhar `undefined` não acrescenta a chave `weight` e não aloca nada) e `{ weight }` caso contrário,
 * com o valor exatamente como está, inclusive `0` e negativos. O `{ weight }` é um objeto novo a cada chamada.
 * Um teste do tipo `if (edge.weight)` descartaria o peso zero: use este helper.
 */
export function weightField(edge: Edge): { weight: number } | undefined {
  return edge.weight === undefined ? undefined : { weight: edge.weight };
}
