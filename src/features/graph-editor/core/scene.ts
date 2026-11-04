import { isolatedVertices, type EdgeId, type Graph, type VertexId } from '@/domain/graph';

import {
  fitToBounds,
  isValidCamera,
  NEUTRAL_CAMERA,
  worldToScreen,
  type Bounds,
  type Camera,
  type Point,
  type ScaleLimits,
  type Viewport,
} from './camera';
import {
  DEFAULT_VERTEX_RADIUS,
  edgeGeometries,
  type Arrowhead,
  type EdgePath,
  type GeometryOptions,
} from './geometry';
import { positionOf, type GraphLayout } from './layout';

// Cena do grafo (Fase 3, incremento 3.5): a DESCRIÇÃO VISUAL pronta para um renderizador desenhar. TypeScript puro, sem JSX,
// sem React e sem SVG: recebe o grafo, o layout e a câmera e devolve dados. O renderizador (SVG hoje, Skia se um dia
// for preciso) só percorre a cena; nenhuma regra de grafo, geometria de aresta ou conversão de coordenadas fica nele.
//
// Coordenadas: a cena inteira está em DP DE TELA. Cada ponto do mundo passa UMA vez por `worldToScreen`. Por isso o SVG não
// recebe `viewBox` com escala nem `transform`: aplicar a câmera aqui e de novo no SVG aplicaria a escala duas vezes.
// - O que ACOMPANHA o zoom (multiplicado por `camera.scale`): posição e raio dos vértices, extremos, ápice e ponta de seta das
//   arestas, âncora do peso. É a mesma geometria do hit-testing (`geometry.ts`), então o que se vê é o que se toca.
// - O que NÃO acompanha (constante em dp, decisão do renderizador): espessura das linhas e tamanho do texto. A cena só informa
//   o tamanho da fonte (`labelFontSize`) e as caixas de texto estimadas.
// - A ÁREA DE TOQUE (48 dp) não é desenhada nem simulada aqui: pertence ao hit-testing.
//
// Entradas: as arestas vêm de `edgeGeometries` (a geometria não é refeita aqui); pesos, ids e rótulos são os do grafo. Vértice
// sem posição no layout, vértice com posição não finita e aresta sem geometria (pontas sobrepostas ou sem posição) NÃO entram na
// cena; o resumo acessível avisa que nem tudo foi desenhado. O vértice isolado entra normalmente (`isolated: true`).
//
// Visibilidade: com `viewport`, cada elemento leva `visible` (o círculo, ou a caixa que envolve os pontos do traço e da seta,
// cruza a área de desenho). É informação (resumo acessível, futura poda); o renderizador desenha tudo e o SVG recorta o que sai.
// Sem `viewport`, tudo é visível.
//
// Rótulos longos: `displayLabel` é o texto exibido DENTRO do círculo, truncado por PONTOS DE CÓDIGO (nunca separa um par
// substituto, como um emoji). A quantidade de caracteres que cabe é uma ESTIMATIVA (largura média de glifo = 0,6 do corpo
// da fonte, caixa útil = 1,6 do raio); o texto renderizado NÃO é medido, então um rótulo de letras largas pode passar um pouco, e
// sequências combinadas (acentos soltos, emojis com ZWJ) podem ser cortadas no meio, o que o ponto de código não evita. O rótulo
// completo fica em `label` e no resumo acessível; o domínio não é tocado.
//
// Resumo acessível (`summary`, português): sai dos DADOS (orientação, contagens, vértices isolados, arestas com peso, o que está
// fora da área visível ou não foi desenhado), nunca de uma frase fixa. Não é a acessibilidade detalhada (incremento 3.12).
//
// Complexidade (V vértices, E arestas): `buildGraphScene` e `fitCameraToGraph` são Θ(V + E) em tempo e espaço (`edgeGeometries` é
// Θ(V + E) por causa do índice de arcos; os pesos e os isolados saem de índices temporários, sem buscar aresta por aresta).
// Recalcular a cena depois de uma mudança é refazer tudo: Θ(V + E), sem atualização incremental.

/** Corpo da fonte dos rótulos e dos pesos, em dp (provisório). */
export const DEFAULT_LABEL_FONT_SIZE = 14;
/** Folga, em dp, entre o conteúdo e cada borda da área de desenho no enquadramento inicial (provisório). */
export const DEFAULT_SCENE_MARGIN = 24;

/** Largura média de um glifo como fração do corpo da fonte (estimativa; o texto não é medido). */
const GLYPH_WIDTH_RATIO = 0.6;
/** Fração do diâmetro do círculo que o texto pode ocupar (a corda útil de um círculo). */
const LABEL_BOX_RATIO = 0.8;
/** Folga horizontal e vertical da caixa do peso, em dp. */
const WEIGHT_PADDING = 4;
/** Vértices isolados que o resumo nomeia; acima disso só informa a quantidade. */
const MAX_NAMED_ISOLATED = 5;

export type SceneOptions = GeometryOptions & {
  /** Área de desenho, em dp. Sem ela, todos os elementos são `visible`. */
  readonly viewport?: Viewport;
  /** Corpo da fonte dos rótulos e dos pesos, em dp. Finito e > 0; inválido vale o padrão (14). */
  readonly labelFontSize?: number;
};

export type SceneVertex = {
  readonly id: VertexId;
  /** Rótulo completo, como no grafo. */
  readonly label: string;
  /** Rótulo exibido dentro do círculo (truncado por pontos de código, se preciso). */
  readonly displayLabel: string;
  /** Centro, em dp de tela. */
  readonly center: Point;
  /** Raio visual, em dp: `vertexRadius · camera.scale`. */
  readonly radius: number;
  /** Sem nenhuma aresta incidente. */
  readonly isolated: boolean;
  readonly visible: boolean;
};

/** Peso a exibir: o texto, a âncora (na própria aresta) e a caixa estimada do texto, em dp. */
export type SceneWeight = {
  /** `0` aparece como `0`; separador decimal em vírgula (pt-BR). */
  readonly text: string;
  readonly anchor: Point;
  readonly width: number;
  readonly height: number;
};

export type SceneEdge = {
  readonly id: EdgeId;
  readonly sourceId: VertexId;
  readonly targetId: VertexId;
  /** Traço de borda a borda, em dp de tela. */
  readonly path: EdgePath;
  /** Só em grafo orientado, em dp de tela. */
  readonly arrow?: Arrowhead;
  /** Só se a aresta tem peso (peso `0` TEM peso; aresta sem peso não leva este campo). */
  readonly weight?: SceneWeight;
  readonly visible: boolean;
};

export type GraphScene = {
  readonly graphId: string;
  readonly directed: boolean;
  readonly vertices: readonly SceneVertex[];
  readonly edges: readonly SceneEdge[];
  /** Corpo da fonte, em dp, para rótulos e pesos. */
  readonly labelFontSize: number;
  /** Descrição do grafo em português, montada a partir dos dados. */
  readonly summary: string;
};

export type FitOptions = GeometryOptions & {
  /** Folga, em dp, entre o conteúdo e as bordas. Finita e ≥ 0; inválida vale o padrão (24). */
  readonly margin?: number;
  /** Limites de escala; padrão os da câmera. */
  readonly limits?: ScaleLimits;
};

const finitePositiveOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const isValidPoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** Peso em texto: o número como está, com vírgula decimal (`-2` → `-2`, `0` → `0`, `1.5` → `1,5`). */
export function formatWeight(weight: number): string {
  return String(weight).replace('.', ',');
}

/**
 * Corta `label` para no máximo `maxChars` PONTOS DE CÓDIGO, com reticências quando houver corte. Nunca separa um par substituto.
 * Com `maxChars ≤ 1` não há espaço para as reticências: fica só o primeiro ponto de código (ou nada, se `maxChars ≤ 0`).
 */
export function truncateLabel(label: string, maxChars: number): string {
  const points = Array.from(label);
  if (points.length <= maxChars) return label;
  if (maxChars <= 1) return points.slice(0, Math.max(0, maxChars)).join('');
  return `${points.slice(0, maxChars - 1).join('')}…`;
}

function pathToScreen(camera: Camera, path: EdgePath): EdgePath {
  if (path.kind === 'line') {
    return { kind: 'line', from: worldToScreen(camera, path.from), to: worldToScreen(camera, path.to) };
  }
  return {
    kind: 'quadratic',
    from: worldToScreen(camera, path.from),
    control: worldToScreen(camera, path.control),
    to: worldToScreen(camera, path.to),
  };
}

function arrowToScreen(camera: Camera, arrow: Arrowhead): Arrowhead {
  return {
    tip: worldToScreen(camera, arrow.tip),
    base: worldToScreen(camera, arrow.base),
    left: worldToScreen(camera, arrow.left),
    right: worldToScreen(camera, arrow.right),
  };
}

function pathPoints(path: EdgePath): Point[] {
  return path.kind === 'line' ? [path.from, path.to] : [path.from, path.control, path.to];
}

/** A caixa que envolve `points` cruza a área de desenho `[0, largura] × [0, altura]`? */
function boxIntersects(points: readonly Point[], viewport: Viewport): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return maxX >= 0 && maxY >= 0 && minX <= viewport.width && minY <= viewport.height;
}

function circleIntersects(center: Point, radius: number, viewport: Viewport): boolean {
  return (
    center.x + radius >= 0 &&
    center.y + radius >= 0 &&
    center.x - radius <= viewport.width &&
    center.y - radius <= viewport.height
  );
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** "A", "A e B", "A, B e C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

type SummaryInput = {
  readonly graph: Graph;
  readonly isolatedIds: readonly VertexId[];
  readonly weighted: number;
  readonly outOfView: boolean;
  readonly incomplete: boolean;
};

function describeGraph({ graph, isolatedIds, weighted, outOfView, incomplete }: SummaryInput): string {
  const kind = graph.directed ? 'orientado' : 'não orientado';
  const order = graph.vertices.length;
  const size = graph.edges.length;
  if (order === 0) return `Grafo ${kind} vazio: nenhum vértice e nenhuma aresta.`;

  const sentences = [`Grafo ${kind} com ${plural(order, 'vértice', 'vértices')} e ${plural(size, 'aresta', 'arestas')}.`];
  if (isolatedIds.length === 1) {
    sentences.push(`O vértice ${labelOf(graph, isolatedIds[0])} está isolado.`);
  } else if (isolatedIds.length > MAX_NAMED_ISOLATED) {
    sentences.push(`${isolatedIds.length} vértices estão isolados.`);
  } else if (isolatedIds.length > 1) {
    sentences.push(`Os vértices ${joinNames(isolatedIds.map((id) => labelOf(graph, id)))} estão isolados.`);
  }
  if (weighted > 0) {
    if (size === 1) sentences.push('A aresta tem peso.');
    else if (weighted === size) sentences.push('Todas as arestas têm peso.');
    else sentences.push(weighted === 1 ? '1 aresta tem peso.' : `${weighted} arestas têm peso.`);
  }
  if (outOfView) sentences.push('Parte do grafo está fora da área visível.');
  if (incomplete) sentences.push('Nem todos os elementos puderam ser desenhados.');
  return sentences.join(' ');
}

function labelOf(graph: Graph, id: VertexId | undefined): string {
  return graph.vertices.find((vertex) => vertex.id === id)?.label ?? '';
}

/**
 * Monta a cena do grafo em dp de tela para a `camera`. Devolve `undefined` se a câmera é inválida ou se o layout é de OUTRO
 * grafo (nada a desenhar com segurança). Um grafo vazio dá uma cena vazia com o resumo "vazio". Não altera as entradas, é
 * determinística e devolve objetos novos. Θ(V + E).
 */
export function buildGraphScene(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  options: SceneOptions = {},
): GraphScene | undefined {
  if (!isValidCamera(camera) || layout.graphId !== graph.id) return undefined;
  const radius = finitePositiveOr(options.vertexRadius, DEFAULT_VERTEX_RADIUS) * camera.scale;
  if (!Number.isFinite(radius)) return undefined;
  const fontSize = finitePositiveOr(options.labelFontSize, DEFAULT_LABEL_FONT_SIZE);
  const { viewport } = options;
  const maxChars = Math.max(1, Math.floor((2 * radius * LABEL_BOX_RATIO) / (fontSize * GLYPH_WIDTH_RATIO)));

  const isolatedIds = isolatedVertices(graph);
  const isolated = new Set<VertexId>(isolatedIds);
  const vertices: SceneVertex[] = [];
  for (const vertex of graph.vertices) {
    const position = positionOf(layout, vertex.id);
    if (position === undefined) continue;
    const center = worldToScreen(camera, position);
    if (!isValidPoint(center)) continue;
    vertices.push({
      id: vertex.id,
      label: vertex.label,
      displayLabel: truncateLabel(vertex.label, maxChars),
      center,
      radius,
      isolated: isolated.has(vertex.id),
      visible: viewport === undefined || circleIntersects(center, radius, viewport),
    });
  }

  const weights = new Map<EdgeId, number>();
  for (const edge of graph.edges) if (edge.weight !== undefined) weights.set(edge.id, edge.weight);

  const edges: SceneEdge[] = [];
  for (const geometry of edgeGeometries(graph, layout, options)) {
    const path = pathToScreen(camera, geometry.path);
    const arrow = geometry.arrow === undefined ? undefined : arrowToScreen(camera, geometry.arrow);
    const anchor = worldToScreen(camera, geometry.labelAnchor);
    const points = [...pathPoints(path), ...(arrow === undefined ? [] : [arrow.tip, arrow.left, arrow.right])];
    if (!points.every(isValidPoint) || !isValidPoint(anchor)) continue;

    const weight = weights.get(geometry.edgeId);
    const text = weight === undefined ? undefined : formatWeight(weight);
    edges.push({
      id: geometry.edgeId,
      sourceId: geometry.sourceId,
      targetId: geometry.targetId,
      path,
      ...(arrow !== undefined && { arrow }),
      ...(text !== undefined && {
        weight: {
          text,
          anchor,
          width: Array.from(text).length * fontSize * GLYPH_WIDTH_RATIO + 2 * WEIGHT_PADDING,
          height: fontSize + 2 * WEIGHT_PADDING,
        },
      }),
      visible: viewport === undefined || boxIntersects(points, viewport),
    });
  }

  return {
    graphId: graph.id,
    directed: graph.directed,
    vertices,
    edges,
    labelFontSize: fontSize,
    summary: describeGraph({
      graph,
      isolatedIds,
      weighted: weights.size,
      outOfView: vertices.some((vertex) => !vertex.visible) || edges.some((edge) => !edge.visible),
      incomplete: vertices.length < graph.vertices.length || edges.length < graph.edges.length,
    }),
  };
}

/**
 * Limites, em unidades de MUNDO, do que será desenhado: os círculos dos vértices (centro ± raio visual) e os extremos e o ápice
 * (`labelAnchor`, o ponto mais afastado numa curva) das arestas. `boundsOf` sozinho cobre só os centros. `undefined` se não há
 * nada posicionado. Θ(V + E).
 */
export function graphContentBounds(graph: Graph, layout: GraphLayout, options: GeometryOptions = {}): Bounds | undefined {
  if (layout.graphId !== graph.id) return undefined;
  const radius = finitePositiveOr(options.vertexRadius, DEFAULT_VERTEX_RADIUS);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const vertex of graph.vertices) {
    const position = positionOf(layout, vertex.id);
    if (position === undefined || !isValidPoint(position)) continue;
    include(position.x - radius, position.y - radius);
    include(position.x + radius, position.y + radius);
  }
  for (const geometry of edgeGeometries(graph, layout, options)) {
    for (const point of [geometry.path.from, geometry.path.to, geometry.labelAnchor]) include(point.x, point.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Câmera inicial: enquadra o conteúdo (veja `graphContentBounds`) na área de desenho, com margem em dp, usando `fitToBounds`. Só
 * devolve câmera quando a área de desenho tem dimensões válidas (finitas, > 0 e maiores que 2 × margem) e o layout é do grafo;
 * senão `undefined` (a tela ainda não mediu o canvas). Se os limites de escala impedem o enquadramento completo (grafo enorme), a
 * escala mínima é respeitada e o conteúdo excede a área, como o `fitToBounds` já documenta. Grafo sem nada posicionado dá a câmera
 * neutra. Θ(V + E).
 */
export function fitCameraToGraph(
  graph: Graph,
  layout: GraphLayout,
  viewport: Viewport,
  options: FitOptions = {},
): Camera | undefined {
  if (layout.graphId !== graph.id) return undefined;
  const margin =
    options.margin !== undefined && Number.isFinite(options.margin) && options.margin >= 0
      ? options.margin
      : DEFAULT_SCENE_MARGIN;
  const camera = fitToBounds(NEUTRAL_CAMERA, graphContentBounds(graph, layout, options), viewport, {
    margin,
    limits: options.limits,
  });
  return camera === NEUTRAL_CAMERA ? undefined : camera;
}
