import type { Graph, VertexId } from '@/domain/graph';

import type { Bounds, Point } from './camera';

// GraphLayout: onde cada vértice está no MUNDO (Fase 3, incremento 3.2). TypeScript puro: não desenha, não escuta toques e
// não conhece a câmera. O `Graph` continua sem nenhuma posição; este módulo só lê dele `id` e a ordem dos vértices.
//
// Modelo: `GraphLayout = { graphId, positions }`
// - `positions` mapeia o ID TÉCNICO do vértice (`v1`, `v2`…, nunca o rótulo) para um `Point` em unidades de mundo, o
//   mesmo espaço da câmera (X para a direita, Y para baixo, independente do aparelho). Nada de câmera, seleção ou
//   animação aqui.
// - `graphId` é o `Graph.id` do grafo dono do layout. Os ids dos vértices se repetem em TODO grafo (todos têm `v1`), então
//   um layout sem dono se aplicaria em silêncio a qualquer outro grafo. Com `graphId`, `reconcileLayout` recusa reaproveitar
//   posições de outro grafo. A alternativa mais simples (o `graphId` só no documento gravado, com a store mantendo o par
//   coerente) deixaria essa invariante a cargo de quem chama; foi descartada. O campo também é exatamente o `graphId` do
//   futuro documento de layout (3.13), ao qual falta só o `schemaVersion`.
//
// Chaves seguras e imutabilidade
// - `positions` é um objeto SEM protótipo (`Object.create(null)`) e CONGELADO, assim como cada `Point` e o próprio layout:
//   um id como `__proto__`, `constructor` ou `toString` é uma chave comum, `positions[id]` nunca devolve algo herdado e
//   nada pode ser alterado depois (o Jest compila fora do modo estrito, então escrever num congelado é ignorado em vez de
//   lançar; nos dois casos o valor não muda). Consulte por `positionOf`, que só olha propriedades PRÓPRIAS.
// - Cada atualização devolve um layout NOVO. Os `Point` já existentes são reaproveitados entre layouts (são congelados, então
//   compartilhá-los é seguro) e os pontos recebidos de fora são COPIADOS: alterar o objeto que você passou depois não muda o
//   layout. `-0` vira `0`.
// - As funções não dependem da ordem das propriedades dos objetos recebidos: `reconcileLayout` e `circularLayout` percorrem
//   `graph.vertices` (ordem de inserção). `Object.keys(positions)` de um resultado segue a ordem de inserção dos ids.
//
// Entradas inválidas (nenhuma função lança): `placeVertex`/`moveVertex` recusam coordenadas não finitas devolvendo o MESMO
// layout (mesma referência), como as funções da câmera; também devolvem o mesmo layout quando nada muda.
//
// Complexidade (V = posições do layout ou vértices do grafo; K = vértices sem posição)
// - `positionOf`: O(1) esperado (acesso a propriedade própria).
// - `placeVertex`, `moveVertex`, `removePosition`: Θ(V) em tempo e em espaço, porque o layout é imutável e o objeto de posições é
//   COPIADO a cada atualização (os pontos não são copiados). Uma estrutura persistente baixaria isso para O(log V); não vale
//   a complexidade para os tamanhos de um grafo editado a toque.
// - `boundsOf`: Θ(V), uma varredura.
// - `circularLayout`: Θ(V).
// - `reconcileLayout`: remover órfãs e preservar posições é Θ(V). Cada vértice SEM posição busca um ponto livre candidato a
//   candidato, e cada candidato é comparado com TODAS as posições já ocupadas: Θ(m) por candidato (m = ocupadas na hora).
//   O número de candidatos por vértice novo é, no caso típico, uma constante pequena e, no pior caso, O(m), pois cada posição
//   ocupada bloqueia um número limitado de candidatos. Logo: caso típico Θ(V + K·V); PIOR caso O(K·V²) (K ≤ V, então O(V³) se
//   quase todos os vértices forem novos e quase nenhum tiver posição). Não há índice espacial: só se justificaria se a medição
//   mostrasse esse caso na prática.
//   Sem vértices novos (e sem órfãs ou posição inválida), devolve o próprio layout em Θ(V).

/** Distância mínima padrão entre vértices vizinhos no círculo e entre vértices novos e os já posicionados, em unidades de mundo. */
export const DEFAULT_LAYOUT_SPACING = 96;

/** Posições dos vértices no mundo, associadas ao `graphId` do grafo dono. Congelado em profundidade (veja o cabeçalho). */
export type GraphLayout = {
  readonly graphId: Graph['id'];
  readonly positions: Readonly<Record<VertexId, Readonly<Point>>>;
};

export type CircularLayoutOptions = {
  /** Distância mínima entre vértices vizinhos, em unidades de mundo. Finita e > 0; inválida vale o padrão (96). */
  readonly spacing?: number;
  /** Raio mínimo do círculo, em unidades de mundo. Finito e ≥ 0; inválido vale 0. */
  readonly minRadius?: number;
};

export type ReconcileOptions = {
  /** Distância mínima entre um vértice NOVO e as posições já ocupadas, e entre vértices vizinhos se o layout for refeito em círculo. Finita e > 0; inválida vale o padrão (96). */
  readonly spacing?: number;
};

const hasOwn = Object.prototype.hasOwnProperty;

/** `-0` vira `0` (mesma regra da câmera e do peso das arestas). */
const noNegativeZero = (n: number): number => (n === 0 ? 0 : n);

const isValidPoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** Arredonda a 3 casas (0,001 unidade de mundo): valores limpos (0 em vez de 3,7e-15) e menos sensíveis ao último bit de `sin`/`cos`. Não garante resultados idênticos bit a bit entre motores. */
function round3(n: number): number {
  const scaled = n * 1000;
  return Number.isFinite(scaled) ? noNegativeZero(Math.round(scaled) / 1000) : n;
}

const finitePositiveOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const finiteNonNegativeOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;

type Positions = Record<VertexId, Readonly<Point>>;

const newPositions = (): Positions => Object.create(null) as Positions;

const freezePoint = (x: number, y: number): Readonly<Point> => Object.freeze({ x: noNegativeZero(x), y: noNegativeZero(y) });

function freezeLayout(graphId: string, positions: Positions): GraphLayout {
  return Object.freeze({ graphId, positions: Object.freeze(positions) });
}

/** Cópia rasa do objeto de posições (os pontos, congelados, são reaproveitados). Θ(V). */
function copyPositions(source: GraphLayout['positions']): Positions {
  const copy = newPositions();
  for (const id of Object.keys(source)) copy[id] = source[id]!;
  return copy;
}

/** Layout sem posições para o grafo `graphId`. */
export function emptyLayout(graphId: Graph['id']): GraphLayout {
  return freezeLayout(graphId, newPositions());
}

/** Posição do vértice pelo id técnico, ou `undefined` se ele não tem posição neste layout. O(1) esperado; só propriedades próprias. */
export function positionOf(layout: GraphLayout, vertexId: VertexId): Readonly<Point> | undefined {
  return hasOwn.call(layout.positions, vertexId) ? layout.positions[vertexId] : undefined;
}

/**
 * ACRESCENTA a posição de um vértice que ainda não tem uma. Se o vértice JÁ tem posição, devolve o mesmo layout e NÃO a
 * altera (para mudar uma posição existente use `moveVertex`: nenhuma alteração acontece por engano). Coordenadas não
 * finitas também devolvem o mesmo layout. O ponto é copiado. Θ(V).
 */
export function placeVertex(layout: GraphLayout, vertexId: VertexId, position: Point): GraphLayout {
  if (!isValidPoint(position) || positionOf(layout, vertexId) !== undefined) return layout;
  const positions = copyPositions(layout.positions);
  positions[vertexId] = freezePoint(position.x, position.y);
  return freezeLayout(layout.graphId, positions);
}

/**
 * Muda a posição de um vértice que JÁ tem uma, para `position` (absoluta, em unidades de mundo). Devolve o mesmo layout se o
 * vértice não tem posição (nada é criado: use `placeVertex`), se a coordenada não é finita ou se a posição já é essa. As demais
 * posições ficam exatamente como estavam (mesmos objetos). Θ(V).
 */
export function moveVertex(layout: GraphLayout, vertexId: VertexId, position: Point): GraphLayout {
  const current = positionOf(layout, vertexId);
  if (current === undefined || !isValidPoint(position)) return layout;
  const x = noNegativeZero(position.x);
  const y = noNegativeZero(position.y);
  if (current.x === x && current.y === y) return layout;
  const positions = copyPositions(layout.positions);
  positions[vertexId] = freezePoint(x, y);
  return freezeLayout(layout.graphId, positions);
}

/** Remove a posição de um vértice e preserva as demais. Devolve o mesmo layout se ele não tinha posição. Θ(V). */
export function removePosition(layout: GraphLayout, vertexId: VertexId): GraphLayout {
  if (positionOf(layout, vertexId) === undefined) return layout;
  const positions = copyPositions(layout.positions);
  delete positions[vertexId];
  return freezeLayout(layout.graphId, positions);
}

/**
 * Retângulo do mundo que contém as posições (os CENTROS dos vértices; o raio visual e os rótulos exigem margem extra no
 * `fitToBounds`), ou `undefined` se o layout não tem posições (é o que o `fitToBounds` entende como "sem conteúdo"). Θ(V).
 */
export function boundsOf(layout: GraphLayout): Bounds | undefined {
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  for (const id of Object.keys(layout.positions)) {
    const { x, y } = layout.positions[id]!;
    if (bounds === undefined) bounds = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      if (x < bounds.minX) bounds.minX = x;
      if (x > bounds.maxX) bounds.maxX = x;
      if (y < bounds.minY) bounds.minY = y;
      if (y > bounds.maxY) bounds.maxY = y;
    }
  }
  return bounds;
}

/**
 * Posiciona os vértices numa circunferência centrada na origem do mundo, na ORDEM DE INSERÇÃO (rótulos não contam), começando
 * pelo TOPO e avançando no sentido HORÁRIO da tela (o eixo Y cresce para baixo, então o ângulo cresce):
 *   ângulo(i) = −π/2 + 2π·i/n      posição(i) = (R·cos ângulo, R·sin ângulo)
 * Raio: para n ≥ 2, `R = max(minRadius, spacing / (2·sin(π/n)))`. Essa é a condição para que a CORDA entre vizinhos (a distância
 * euclidiana, não o arco) seja `spacing`: corda = 2·R·sin(π/n). Casos: 0 vértices → layout vazio; 1 → (0, 0); 2 → pontos
 * simétricos (0, −R) e (0, R) com R = spacing/2; 3 ou mais → polígono regular inscrito.
 * Arredondamento: as coordenadas são arredondadas a 3 casas, o que move cada uma em até 0,0005 e pode reduzir a distância entre
 * vizinhos em até ≈ 0,0015 abaixo de `spacing` (os testes usam essa tolerância explícita). O arredondamento melhora a
 * reprodutibilidade entre motores, mas NÃO a garante bit a bit. O layout leva o `graph.id`. Θ(V).
 */
export function circularLayout(graph: Graph, options: CircularLayoutOptions = {}): GraphLayout {
  const spacing = finitePositiveOr(options.spacing, DEFAULT_LAYOUT_SPACING);
  const minRadius = finiteNonNegativeOr(options.minRadius, 0);
  const { vertices } = graph;
  const count = vertices.length;
  const positions = newPositions();
  if (count === 1) {
    positions[vertices[0]!.id] = freezePoint(0, 0);
  } else if (count >= 2) {
    const radius = Math.max(minRadius, spacing / (2 * Math.sin(Math.PI / count)));
    vertices.forEach((vertex, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
      positions[vertex.id] = freezePoint(round3(radius * Math.cos(angle)), round3(radius * Math.sin(angle)));
    });
  }
  return freezeLayout(graph.id, positions);
}

/** Algum ponto de `occupied` está a menos de `spacing` de (x, y)? Θ(m). */
function isTooClose(x: number, y: number, occupied: readonly Readonly<Point>[], spacing: number): boolean {
  const limit = spacing * spacing;
  for (const point of occupied) {
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy < limit) return true;
  }
  return false;
}

/**
 * Primeira posição livre ao redor de (centerX, centerY), a pelo menos `spacing` de todas as de `occupied`. Procura em anéis
 * concêntricos de raio `anel·spacing` (o anel 0 é o próprio centro; o anel k tem max(6, ⌈2πk⌉) candidatos, a partir do topo, no
 * sentido horário), sempre na mesma ordem, e confere cada candidato JÁ arredondado. A busca é LIMITADA: no máximo
 * `occupied.length + 2` anéis (cada posição ocupada bloqueia só um número limitado de candidatos, então sobra um livre muito
 * antes); se mesmo assim nada servir, usa o ponto imediatamente à DIREITA de todas as posições, que fica a mais de `spacing` de
 * cada uma por construção. Sempre termina.
 */
function freePositionNear(
  centerX: number,
  centerY: number,
  occupied: readonly Readonly<Point>[],
  spacing: number,
): Readonly<Point> {
  const lastRing = occupied.length + 2;
  for (let ring = 0; ring <= lastRing; ring++) {
    const candidates = ring === 0 ? 1 : Math.max(6, Math.ceil(2 * Math.PI * ring));
    for (let index = 0; index < candidates; index++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / candidates;
      const x = round3(centerX + ring * spacing * Math.cos(angle));
      const y = round3(centerY + ring * spacing * Math.sin(angle));
      if (Number.isFinite(x) && Number.isFinite(y) && !isTooClose(x, y, occupied, spacing)) return freezePoint(x, y);
    }
  }
  let rightmost = -Infinity;
  for (const point of occupied) if (point.x > rightmost) rightmost = point.x;
  // +0,001 de folga: o arredondamento para cima a 3 casas nunca fica abaixo de `rightmost + spacing`.
  const x = Math.ceil((rightmost + spacing) * 1000 + 1) / 1000;
  return Number.isFinite(x) ? freezePoint(x, round3(centerY)) : freezePoint(centerX, centerY);
}

/**
 * Faz o layout valer para o grafo: uma posição para cada vértice e NENHUMA órfã. Política:
 * - Layout de OUTRO grafo (`layout.graphId !== graph.id`): nenhuma posição é reaproveitada, mesmo com ids coincidentes; devolve
 *   um layout inicial novo (`circularLayout`) do grafo recebido.
 * - Posições de ids que não são vértices do grafo (órfãs) são descartadas.
 * - As posições dos vértices que existem e têm ponto finito são PRESERVADAS exatamente (mesmos valores e objetos), mesmo que se
 *   sobreponham: reconciliar não mexe em vértice já posicionado. Posição inválida (não finita) conta como ausente.
 * - Nenhuma posição aproveitável (layout vazio, só órfãs ou só inválidas) e há vértices: `circularLayout`.
 * - Layout PARCIAL: cada vértice sem posição, na ordem de inserção, vai para a primeira posição livre ao redor do CENTROIDE das
 *   posições preservadas (média na ordem dos vértices), a pelo menos `spacing` (padrão 96) de todas as posições já ocupadas,
 *   incluindo as dos vértices novos já colocados. A busca é determinística e limitada (veja `freePositionNear`). Só os novos
 *   respeitam a distância: a distância entre posições preservadas é a que vieram.
 * - Idempotente: o resultado reconciliado de novo é igual a si mesmo; sem nada a fazer (nenhuma órfã, nenhum vértice sem
 *   posição, mesmo grafo) devolve o PRÓPRIO layout recebido, e a ordem das chaves dele é mantida.
 * Não altera `graph` nem `layout`; não depende da ordem das propriedades; não usa relógio nem sorteio. A complexidade está no
 * cabeçalho do arquivo: Θ(V) sem vértices novos; pior caso O(K·V²) com K vértices novos.
 */
export function reconcileLayout(graph: Graph, layout: GraphLayout, options: ReconcileOptions = {}): GraphLayout {
  const spacing = finitePositiveOr(options.spacing, DEFAULT_LAYOUT_SPACING);
  if (layout.graphId !== graph.id) return circularLayout(graph, { spacing });

  const { vertices } = graph;
  const preserved: (Readonly<Point> | undefined)[] = vertices.map((vertex) => {
    const position = positionOf(layout, vertex.id);
    return position !== undefined && isValidPoint(position) ? position : undefined;
  });
  const keptCount = preserved.reduce((total, position) => total + (position === undefined ? 0 : 1), 0);

  if (keptCount === vertices.length && Object.keys(layout.positions).length === vertices.length) return layout;
  if (keptCount === 0) return circularLayout(graph, { spacing });

  const occupied: Readonly<Point>[] = [];
  let centerX = 0;
  let centerY = 0;
  for (const position of preserved) {
    if (position === undefined) continue;
    occupied.push(position);
    // Média acumulada termo a termo (x / k): somar antes de dividir estouraria para Infinity com coordenadas muito grandes.
    centerX += position.x / keptCount;
    centerY += position.y / keptCount;
  }

  const positions = newPositions();
  vertices.forEach((vertex, index) => {
    const kept = preserved[index];
    if (kept !== undefined) {
      positions[vertex.id] = kept;
      return;
    }
    const placed = freePositionNear(centerX, centerY, occupied, spacing);
    occupied.push(placed);
    positions[vertex.id] = placed;
  });
  return freezeLayout(graph.id, positions);
}
