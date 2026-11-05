import type { Edge, EdgeId, Graph, VertexId } from '@/domain/graph';

import { isValidCamera, worldToScreen, type Camera, type Point } from './camera';
import { positionOf, type GraphLayout } from './layout';

// Geometria das arestas e identificação de elementos por toque (Fase 3, incremento 3.3). TypeScript puro: não desenha, não
// escuta gestos e não conhece SVG nem Skia. Devolve DADOS (pontos, segmentos, curvas, setas, âncoras) que o renderizador (3.5)
// converte em comandos de desenho e que o detector de gestos (3.10) consulta. Não altera `Graph` nem `GraphLayout`.
//
// Dois espaços, separados de propósito
// - A GEOMETRIA é calculada em coordenadas de MUNDO e não conhece a câmera: o mesmo grafo e o mesmo layout dão a mesma geometria
//   com qualquer zoom ou deslocamento. Raio do vértice, tamanho da seta e curvatura são em unidades de mundo (crescem com o zoom).
// - O HIT-TESTING recebe o toque em dp de TELA e a câmera, converte a geometria para a tela com `worldToScreen` e mede em dp:
//   a área mínima de toque (48 dp de diâmetro) e a tolerância das arestas (12 dp) não variam com o zoom.
//
// Entradas e identidade
// - Posições vêm do `GraphLayout`, pelo ID TÉCNICO dos vértices (nunca rótulo, índice ou posição no array). Aresta com uma
//   ponta sem posição (ou com posição não finita) NÃO tem geometria. Este módulo não reconcilia layouts: isso é do `layout.ts`.
// - Layout de OUTRO grafo (`layout.graphId !== graph.id`) não vale: nenhuma geometria (mesma política do `reconcileLayout`).
// - Cada geometria leva o `edgeId` e os ids de origem e destino como estão no grafo. Em arestas orientadas `source → target` é o
//   sentido da seta; em não orientadas a ordem só registra como a aresta foi criada.
//
// Geometria de uma aresta entre os centros A (origem) e B (destino), raio r, distância d = |B − A|, u = (B − A) / d
// - Reta (padrão): vai da BORDA de A até a BORDA de B, nunca pelos centros:
//     from = A + u·r          to = B − u·r
//   Exige d > 2r (os círculos não se tocam). Com d ≤ 2r (vértices sobrepostos, tangentes ou na mesma posição) NÃO há geometria
//   (`undefined`): não existe trecho visível para desenhar nem direção definida. Nada é movido para "consertar" a sobreposição.
// - Âncora do peso: ponto médio da reta, ou B(½) da curva. O renderizador pode afastá-la do traço.
// - Seta (só em grafo orientado): triângulo com a PONTA em `path.to`, na borda do destino, apontando na direção do traço ali
//   (a direção u na reta; a tangente final da curva). `base` fica `length` para trás da ponta, e `left`/`right` a `halfWidth` dos
//   lados da base (esquerda/direita de quem anda de A para B, vistas na tela com Y para baixo). O comprimento efetivo é
//   `min(arrowLength, corda visível)`, para que a base não passe da borda da origem. O traço PODE terminar em `base` (o
//   renderizador escolhe espessura e cor; aqui só há matemática); `path` sempre vai de borda a borda.
// - Arcos opostos (grafo orientado com A → B e B → A): ambas viram CURVAS de Bézier quadrática, e cada uma curva para a sua
//   DIREITA (na tela, com Y para baixo). Como a direita de B → A é a esquerda de A → B, as duas ficam em lados opostos da reta
//   entre os centros, sem depender da ordem de inserção das arestas. Com n = (−u.y, u.x) (a direita de u) e M = (A + B) / 2:
//     controle C = M + n · (curvatura · d)
//     from = A + unit(C − A) · r        to = B + unit(C − B) · r        (a curva sai radialmente do círculo)
//   Como a curva termina nas bordas (e não nos centros), o ponto B(½) fica a `(curvatura · d / 2) · (1 + r / |C − A|)` da reta
//   entre os centros (com A = (0,0), B = (100,0), r = 20: 20,145, não 15). A tangente final aponta de C para B. Uma aresta sem
//   arco oposto continua reta. Em grafo não orientado nunca há arco oposto (um par = uma aresta). Se os círculos estão muito
//   perto, a curva pode roçar neles: a regra não tenta evitá-lo (limitação conhecida).
//
// Entradas inválidas e estabilidade (nenhuma função lança): opções não finitas ou ≤ 0 valem o padrão; posição, aresta ou
// resultado não finito dão "sem geometria". Os resultados são objetos NOVOS (sem referências às entradas), sem `NaN`,
// `Infinity` nem `-0`.
//
// Complexidade (V vértices, E arestas)
// - `edgeGeometry` de UMA aresta: Θ(E): achar a aresta pelo id e, em grafo orientado, procurar o arco oposto.
// - `edgeGeometries` (TODAS): Θ(V + E) de tempo e espaço. O arco oposto vem de um índice temporário (`Map` de origem para
//   conjunto de destinos, montado em Θ(E)), não de uma busca por aresta, que daria Θ(E²).
//
// HIT-TESTING (3.3B): qual elemento está sob o dedo. Recebe o toque em dp de TELA, a câmera e o grafo com o layout; nada guarda.
// - Tudo que é medido em dp NÃO muda com o zoom: a área de toque de um vértice é um círculo de raio
//   `max(minTouchDiameter / 2, vertexRadius · scale)` (padrão: no mínimo 48 dp de diâmetro; com zoom alto vale o raio visual,
//   que cresce), e a aresta é acertada a até `edgeTolerance` dp (padrão 12) do TRAÇO. O raio visual do vértice, em mundo, é
//   multiplicado pela escala; a tolerância e o alvo mínimo, não. Posição do vértice: `worldToScreen(camera, posição)`.
// - Vértice: o de menor distância do toque ao centro entre os que o contêm; empate exato → o primeiro na ordem de inserção.
// - Aresta: a de menor distância ao traço dentro da tolerância; empate exato → a primeira na ordem de inserção (dois traços que
//   se cruzam empatam no cruzamento, e o primeiro vence). A distância é ao SEGMENTO (nunca à reta infinita) e, nas curvas, à
//   trajetória de Bézier, aproximada por uma poligonal de N = `curveSamples` segmentos em t uniforme (padrão 24). A corda de
//   uma curva deslocada NÃO acerta a aresta: só a curva.
// - Prioridade: um toque na área de um vértice nunca seleciona aresta (`hitTestEdge` devolve `undefined` ali). `hitTest` junta
//   as três respostas: vértice, depois aresta, depois fundo.
// - Entradas inválidas (câmera inválida, toque não finito, layout de outro grafo) → `undefined`; vértice sem posição não é
//   acertado e aresta sem geometria também não; opções inválidas valem o padrão. Distâncias e resultados são sempre finitos.
//
// Erro da poligonal: o desvio máximo entre um arco de Bézier de largura h = 1/N em t e a sua corda é
// `h² · |C − m| / 2`, com C o ponto de controle e m o ponto médio dos extremos (em dp, depois da conversão). Com N = 24 e uma
// aresta curva de 1000 dp de corda e curvatura 0,3 (|C − m| ≈ 300) isso dá ≈ 0,26 dp, bem abaixo da tolerância de 12 dp; a
// distância calculada difere da verdadeira em no máximo esse desvio (para mais, do lado de fora da curva; para menos, do de
// dentro). Se a medição pedir, aumente `curveSamples` (limite 256).
//
// Complexidade do hit-testing (V vértices, E arestas, N amostras por curva, C ≤ E arestas curvas)
// - `hitTestVertex`: Θ(V), uma varredura.
// - `hitTestEdge`: Θ(V + E + C·N) → pior caso Θ(V + E·N): confere os vértices, monta todas as geometrias (Θ(V + E)) e mede a
//   distância de cada uma (O(1) numa reta, Θ(N) numa curva). Quem repete a consulta no mesmo layout (por exemplo, durante um
//   arrasto) pode guardar o resultado de `edgeGeometries`; hoje cada chamada refaz as contas, porque um toque é raro.
// - `hitTest`: Θ(V) quando acerta um vértice; senão, o mesmo que `hitTestEdge`.

/** Raio visual do vértice, em unidades de mundo (provisório). */
export const DEFAULT_VERTEX_RADIUS = 20;
/** Comprimento da seta, da base à ponta, em unidades de mundo (provisório). */
export const DEFAULT_ARROW_LENGTH = 12;
/** Meia-largura da base da seta, em unidades de mundo (provisório). */
export const DEFAULT_ARROW_HALF_WIDTH = 5;
/** Curvatura dos arcos opostos: deslocamento do ponto de controle como fração da distância entre os centros (provisório). */
export const DEFAULT_CURVATURE = 0.3;

/** Segmento de reta. Em unidades de mundo. */
export type LineSegment = {
  readonly kind: 'line';
  readonly from: Point;
  readonly to: Point;
};

/** Curva de Bézier quadrática `B(t) = (1−t)²·from + 2(1−t)t·control + t²·to`, `t ∈ [0, 1]`. Em unidades de mundo. */
export type QuadraticCurve = {
  readonly kind: 'quadratic';
  readonly from: Point;
  readonly control: Point;
  readonly to: Point;
};

/** Traço da aresta, de borda a borda. */
export type EdgePath = LineSegment | QuadraticCurve;

/** Ponta de seta: triângulo `tip`, `left`, `right`, com `base` no meio do lado oposto à ponta. */
export type Arrowhead = {
  readonly tip: Point;
  readonly base: Point;
  readonly left: Point;
  readonly right: Point;
};

export type EdgeGeometry = {
  readonly edgeId: EdgeId;
  readonly sourceId: VertexId;
  readonly targetId: VertexId;
  readonly path: EdgePath;
  /** Só em grafo orientado. */
  readonly arrow?: Arrowhead;
  /** Onde ancorar o peso (ou um rótulo): ponto médio da reta, ou o ponto da curva em t = ½. */
  readonly labelAnchor: Point;
};

export type GeometryOptions = {
  /** Raio visual do vértice, em unidades de mundo. Finito e > 0; inválido vale o padrão (20). */
  readonly vertexRadius?: number;
  /** Comprimento da seta, em unidades de mundo. Finito e > 0; inválido vale o padrão (12). */
  readonly arrowLength?: number;
  /** Meia-largura da base da seta, em unidades de mundo. Finita e > 0; inválida vale o padrão (5). */
  readonly arrowHalfWidth?: number;
  /** Curvatura dos arcos opostos. Finita e > 0 (com 0 os dois arcos coincidiriam); inválida vale o padrão (0,3). */
  readonly curvature?: number;
};

type ResolvedGeometryOptions = {
  readonly vertexRadius: number;
  readonly arrowLength: number;
  readonly arrowHalfWidth: number;
  readonly curvature: number;
};

/** `-0` vira `0` (mesma regra da câmera e do layout). */
const noNegativeZero = (n: number): number => (n === 0 ? 0 : n);

const isValidPoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const point = (x: number, y: number): Point => ({ x: noNegativeZero(x), y: noNegativeZero(y) });

const finitePositiveOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

function resolveGeometryOptions(options: GeometryOptions): ResolvedGeometryOptions {
  return {
    vertexRadius: finitePositiveOr(options.vertexRadius, DEFAULT_VERTEX_RADIUS),
    arrowLength: finitePositiveOr(options.arrowLength, DEFAULT_ARROW_LENGTH),
    arrowHalfWidth: finitePositiveOr(options.arrowHalfWidth, DEFAULT_ARROW_HALF_WIDTH),
    curvature: finitePositiveOr(options.curvature, DEFAULT_CURVATURE),
  };
}

/** Ponto da curva em `t` (esperado em [0, 1]): `(1−t)²·P0 + 2(1−t)t·C + t²·P2`. */
export function quadraticPoint(curve: QuadraticCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return point(
    a * curve.from.x + b * curve.control.x + c * curve.to.x,
    a * curve.from.y + b * curve.control.y + c * curve.to.y,
  );
}

/** Ponto a `radius` do `center`, na direção de `toward` (que precisa estar a mais de `radius` de `center`). */
function borderToward(center: Point, toward: Point, radius: number): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const scale = radius / Math.hypot(dx, dy);
  return point(center.x + dx * scale, center.y + dy * scale);
}

/** Geometria entre as posições `from` (origem) e `to` (destino), ou `undefined` se não há trecho visível ou algo não é finito. */
function buildGeometry(
  edge: Edge,
  from: Point,
  to: Point,
  directed: boolean,
  curved: boolean,
  options: ResolvedGeometryOptions,
): EdgeGeometry | undefined {
  const radius = options.vertexRadius;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 2 * radius) return undefined;
  const ux = dx / distance;
  const uy = dy / distance;

  let path: EdgePath;
  let endX = ux; // direção do traço na ponta (para onde a seta aponta)
  let endY = uy;
  if (curved) {
    const offset = options.curvature * distance;
    const control = point(from.x + dx / 2 - uy * offset, from.y + dy / 2 + ux * offset);
    path = {
      kind: 'quadratic',
      from: borderToward(from, control, radius),
      control,
      to: borderToward(to, control, radius),
    };
    const tangentX = to.x - control.x;
    const tangentY = to.y - control.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    endX = tangentX / tangentLength;
    endY = tangentY / tangentLength;
  } else {
    path = {
      kind: 'line',
      from: point(from.x + ux * radius, from.y + uy * radius),
      to: point(to.x - ux * radius, to.y - uy * radius),
    };
  }

  let arrow: Arrowhead | undefined;
  if (directed) {
    const tip = path.to;
    const length = Math.min(options.arrowLength, Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y));
    const baseX = tip.x - endX * length;
    const baseY = tip.y - endY * length;
    const sideX = -endY * options.arrowHalfWidth; // a direita de quem anda no sentido da seta (Y para baixo)
    const sideY = endX * options.arrowHalfWidth;
    arrow = {
      tip: point(tip.x, tip.y),
      base: point(baseX, baseY),
      left: point(baseX - sideX, baseY - sideY),
      right: point(baseX + sideX, baseY + sideY),
    };
  }

  const labelAnchor =
    path.kind === 'line'
      ? point(path.from.x + (path.to.x - path.from.x) / 2, path.from.y + (path.to.y - path.from.y) / 2)
      : quadraticPoint(path, 0.5);

  const points = [path.from, path.to, labelAnchor];
  if (path.kind === 'quadratic') points.push(path.control);
  if (arrow !== undefined) points.push(arrow.tip, arrow.base, arrow.left, arrow.right);
  if (!points.every(isValidPoint)) return undefined;

  return {
    edgeId: edge.id,
    sourceId: edge.source,
    targetId: edge.target,
    path,
    ...(arrow !== undefined && { arrow }),
    labelAnchor,
  };
}

/** Geometria de `edge` neste layout, ou `undefined`. `curved`: existe o arco oposto. */
function geometryOf(
  graph: Graph,
  layout: GraphLayout,
  edge: Edge,
  curved: boolean,
  options: ResolvedGeometryOptions,
): EdgeGeometry | undefined {
  const from = positionOf(layout, edge.source);
  const to = positionOf(layout, edge.target);
  if (from === undefined || to === undefined || !isValidPoint(from) || !isValidPoint(to)) return undefined;
  return buildGeometry(edge, from, to, graph.directed, curved, options);
}

/**
 * Geometria de uma aresta entre as posições `from` (origem) e `to` (destino) que o chamador já conhece, sem consultar o grafo nem o layout:
 * é a MESMA conta de `edgeGeometry` e `edgeGeometries` (`buildGeometry`), exposta para quem sabe as posições e se existe o arco oposto
 * (`curved`). A prévia do arrasto (3.9) move UM vértice e refaz só as arestas dele, sem montar o índice de arcos de todas as arestas; assim
 * não existe uma segunda fórmula para os traços, as setas e as âncoras. `undefined` nas mesmas condições (posição não finita, círculos
 * que se tocam, resultado não finito). O(1).
 */
export function edgeGeometryBetween(
  edge: Edge,
  from: Point,
  to: Point,
  directed: boolean,
  curved: boolean,
  options: GeometryOptions = {},
): EdgeGeometry | undefined {
  if (!isValidPoint(from) || !isValidPoint(to)) return undefined;
  return buildGeometry(edge, from, to, directed, curved, resolveGeometryOptions(options));
}

/**
 * Geometria da aresta `edgeId`, ou `undefined` se a aresta não existe, se o layout é de outro grafo, se falta posição a uma das
 * pontas, se os círculos se tocam ou se algo não é finito. Θ(E): acha a aresta e, em grafo orientado, procura o arco oposto
 * (para várias arestas use `edgeGeometries`, que monta um índice e custa Θ(V + E) no total).
 */
export function edgeGeometry(
  graph: Graph,
  layout: GraphLayout,
  edgeId: EdgeId,
  options: GeometryOptions = {},
): EdgeGeometry | undefined {
  if (layout.graphId !== graph.id) return undefined;
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined) return undefined;
  const curved =
    graph.directed &&
    graph.edges.some((candidate) => candidate.source === edge.target && candidate.target === edge.source);
  return geometryOf(graph, layout, edge, curved, resolveGeometryOptions(options));
}

/**
 * Geometria de TODAS as arestas que a têm, na ordem de inserção. As sem geometria (veja `edgeGeometry`) ficam de fora, e o
 * `edgeId` de cada item é o da aresta. Θ(V + E) de tempo e espaço: o índice temporário de arcos (`Map` de origem para
 * destinos) evita procurar o arco oposto aresta por aresta.
 */
export function edgeGeometries(
  graph: Graph,
  layout: GraphLayout,
  options: GeometryOptions = {},
): readonly EdgeGeometry[] {
  if (layout.graphId !== graph.id) return [];
  const resolved = resolveGeometryOptions(options);
  const arcs = new Map<VertexId, Set<VertexId>>();
  if (graph.directed) {
    for (const edge of graph.edges) {
      const targets = arcs.get(edge.source);
      if (targets === undefined) arcs.set(edge.source, new Set([edge.target]));
      else targets.add(edge.target);
    }
  }
  const geometries: EdgeGeometry[] = [];
  for (const edge of graph.edges) {
    const curved = arcs.get(edge.target)?.has(edge.source) ?? false;
    const geometry = geometryOf(graph, layout, edge, curved, resolved);
    if (geometry !== undefined) geometries.push(geometry);
  }
  return geometries;
}

// ---------------------------------------------------------------------------------------------
// 3.3B: hit-testing (coordenadas de tela, em dp)
// ---------------------------------------------------------------------------------------------

/** Diâmetro mínimo da área de toque de um vértice, em dp (provisório; independe do zoom). */
export const DEFAULT_MIN_TOUCH_DIAMETER = 48;
/** Distância máxima do toque ao traço de uma aresta para acertá-la, em dp (provisório; independe do zoom). */
export const DEFAULT_EDGE_TOLERANCE = 12;
/** Segmentos da poligonal que aproxima uma curva no cálculo de distância. */
export const DEFAULT_CURVE_SAMPLES = 24;
const MAX_CURVE_SAMPLES = 256;

export type HitTestOptions = GeometryOptions & {
  /** Diâmetro mínimo da área de toque do vértice, em dp. Finito e > 0; inválido vale o padrão (48). */
  readonly minTouchDiameter?: number;
  /** Tolerância do toque até o traço da aresta, em dp. Finita e ≥ 0; inválida vale o padrão (12). */
  readonly edgeTolerance?: number;
  /** Segmentos da poligonal de uma curva. Inteiro em [1, 256]; inválido vale o padrão (24), e acima de 256 vale 256. */
  readonly curveSamples?: number;
};

/** Vértice acertado e distância, em dp, do toque ao centro dele na tela. */
export type VertexHit = {
  readonly vertexId: VertexId;
  readonly distance: number;
};

/** Aresta acertada e distância, em dp, do toque ao traço dela na tela. */
export type EdgeHit = {
  readonly edgeId: EdgeId;
  readonly distance: number;
};

/** O que está sob o toque: um vértice, uma aresta ou o fundo do canvas. Discriminado por `type`. */
export type HitTarget =
  | ({ readonly type: 'vertex' } & VertexHit)
  | ({ readonly type: 'edge' } & EdgeHit)
  | { readonly type: 'background' };

type ResolvedHitOptions = ResolvedGeometryOptions & {
  readonly minTouchDiameter: number;
  readonly edgeTolerance: number;
  readonly curveSamples: number;
};

function resolveHitOptions(options: HitTestOptions): ResolvedHitOptions {
  const { edgeTolerance, curveSamples } = options;
  return {
    ...resolveGeometryOptions(options),
    minTouchDiameter: finitePositiveOr(options.minTouchDiameter, DEFAULT_MIN_TOUCH_DIAMETER),
    edgeTolerance:
      edgeTolerance !== undefined && Number.isFinite(edgeTolerance) && edgeTolerance >= 0
        ? edgeTolerance
        : DEFAULT_EDGE_TOLERANCE,
    curveSamples:
      curveSamples !== undefined && Number.isInteger(curveSamples) && curveSamples >= 1
        ? Math.min(curveSamples, MAX_CURVE_SAMPLES)
        : DEFAULT_CURVE_SAMPLES,
  };
}

/** Distância de `p` ao SEGMENTO `a`–`b` (não à reta infinita): projeta `p` em `a`–`b` e limita a projeção a [0, 1]. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * Distância aproximada de `p` à curva: a menor distância a uma poligonal de `samples` segmentos, em t uniforme. O erro máximo
 * é `(1 / samples)² · |C − m| / 2` (veja o cabeçalho). Θ(samples).
 */
export function distanceToCurve(p: Point, curve: QuadraticCurve, samples: number): number {
  let previous = curve.from;
  let best = Math.hypot(p.x - previous.x, p.y - previous.y);
  for (let index = 1; index <= samples; index++) {
    const next = index === samples ? curve.to : quadraticPoint(curve, index / samples);
    best = Math.min(best, distanceToSegment(p, previous, next));
    previous = next;
  }
  return best;
}

/** Distância, em dp, de `p` (tela) ao traço `path` (mundo), convertido para a tela pela câmera. */
function distanceToScreenPath(camera: Camera, path: EdgePath, p: Point, samples: number): number {
  const from = worldToScreen(camera, path.from);
  const to = worldToScreen(camera, path.to);
  if (path.kind === 'line') return distanceToSegment(p, from, to);
  return distanceToCurve(p, { kind: 'quadratic', from, control: worldToScreen(camera, path.control), to }, samples);
}

/** O vértice mais próximo do toque entre os que o contêm; empate exato → o primeiro da ordem de inserção. Θ(V). */
function nearestVertex(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  touch: Point,
  options: ResolvedHitOptions,
): VertexHit | undefined {
  const reach = Math.max(options.minTouchDiameter / 2, options.vertexRadius * camera.scale);
  if (!Number.isFinite(reach)) return undefined;
  let best: VertexHit | undefined;
  for (const vertex of graph.vertices) {
    const position = positionOf(layout, vertex.id);
    if (position === undefined || !isValidPoint(position)) continue;
    const center = worldToScreen(camera, position);
    const distance = Math.hypot(center.x - touch.x, center.y - touch.y);
    if (!(distance <= reach)) continue; // também descarta NaN e Infinity
    if (best === undefined || distance < best.distance) best = { vertexId: vertex.id, distance };
  }
  return best;
}

/** A aresta de traço mais próximo do toque, dentro da tolerância; empate exato → a primeira da ordem de inserção. */
function nearestEdge(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  touch: Point,
  options: ResolvedHitOptions,
): EdgeHit | undefined {
  let best: EdgeHit | undefined;
  for (const geometry of edgeGeometries(graph, layout, options)) {
    const distance = distanceToScreenPath(camera, geometry.path, touch, options.curveSamples);
    if (!(distance <= options.edgeTolerance)) continue;
    if (best === undefined || distance < best.distance) best = { edgeId: geometry.edgeId, distance };
  }
  return best;
}

/** Câmera válida, toque finito e layout do próprio grafo: sem isso nenhum hit-test faz sentido. */
const isHitTestable = (graph: Graph, layout: GraphLayout, camera: Camera, touch: Point): boolean =>
  isValidCamera(camera) && isValidPoint(touch) && layout.graphId === graph.id;

/**
 * Vértice sob o toque `screenPoint` (dp de tela) com a `camera` atual, ou `undefined`. A área de toque de cada vértice é um
 * círculo, na tela, de raio `max(minTouchDiameter / 2, vertexRadius · scale)` ao redor do centro (alvo mínimo de 48 dp de
 * diâmetro em qualquer zoom). Vários vértices na área: vence o de menor distância ao centro, e o empate exato fica com o
 * primeiro da ordem de inserção. Vértice sem posição não é acertado. `undefined` também para câmera inválida, toque não
 * finito ou layout de outro grafo. Θ(V).
 */
export function hitTestVertex(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  screenPoint: Point,
  options: HitTestOptions = {},
): VertexHit | undefined {
  if (!isHitTestable(graph, layout, camera, screenPoint)) return undefined;
  return nearestVertex(graph, layout, camera, screenPoint, resolveHitOptions(options));
}

/**
 * Aresta sob o toque, ou `undefined`: a de traço mais próximo a até `edgeTolerance` dp (distância ao segmento, ou à curva de
 * Bézier; nunca à reta infinita nem à corda de uma curva). Desempate: menor distância e depois ordem de inserção. Um toque
 * na área de um vértice NUNCA seleciona aresta (devolve `undefined`). O `edgeId` é o da aresta, e arcos opostos se distinguem
 * porque cada um tem a sua curva. `undefined` também para entradas inválidas. Θ(V + E·N): veja o cabeçalho.
 */
export function hitTestEdge(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  screenPoint: Point,
  options: HitTestOptions = {},
): EdgeHit | undefined {
  if (!isHitTestable(graph, layout, camera, screenPoint)) return undefined;
  const resolved = resolveHitOptions(options);
  if (nearestVertex(graph, layout, camera, screenPoint, resolved) !== undefined) return undefined;
  return nearestEdge(graph, layout, camera, screenPoint, resolved);
}

/**
 * O que está sob o toque, por prioridade: (1) um vértice cuja área de toque o contém, (2) uma aresta dentro da tolerância,
 * (3) o fundo do canvas. O resultado é discriminado por `type` (`'vertex'`, `'edge'`, `'background'`) e traz o id e a
 * distância em dp quando há elemento. `undefined` só para entrada inválida (câmera, toque ou layout de outro grafo), e
 * nunca significa fundo. Θ(V) se acerta um vértice; senão, Θ(V + E·N).
 */
export function hitTest(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  screenPoint: Point,
  options: HitTestOptions = {},
): HitTarget | undefined {
  if (!isHitTestable(graph, layout, camera, screenPoint)) return undefined;
  const resolved = resolveHitOptions(options);
  const vertex = nearestVertex(graph, layout, camera, screenPoint, resolved);
  if (vertex !== undefined) return { type: 'vertex', ...vertex };
  const edge = nearestEdge(graph, layout, camera, screenPoint, resolved);
  if (edge !== undefined) return { type: 'edge', ...edge };
  return { type: 'background' };
}
