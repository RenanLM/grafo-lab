// Sistema de coordenadas e câmera do editor (Fase 3, incremento 3.1). TypeScript puro: não sabe o que é toque, SVG,
// animação nem tela; só faz conta. A interface (3.5 em diante) e os gestos (3.10) vão chamar estas funções.
//
// Dois espaços
// - MUNDO: onde o grafo "mora". Unidades de mundo, independentes do aparelho; é o espaço do `GraphLayout` (3.2).
// - TELA: o que o aluno vê. Unidades LÓGICAS de layout do React Native (dp), não pixels físicos; a origem é o canto
//   superior esquerdo da área de desenho (o `Viewport`), e não da janela do aparelho.
// Nos dois, X cresce para a direita e Y cresce para BAIXO. A escala é uniforme (`scale` vale para X e para Y) e não
// há rotação.
//
// Convenção da câmera: `Camera = { x, y, scale }`
//   telaX = mundoX · scale + camera.x          mundoX = (telaX − camera.x) / scale
//   telaY = mundoY · scale + camera.y          mundoY = (telaY − camera.y) / scale
// Logo `(camera.x, camera.y)` é onde a ORIGEM do mundo aparece na tela (em dp), e `scale` é quantos dp vale 1 unidade
// de mundo. A câmera neutra `{ x: 0, y: 0, scale: 1 }` é a identidade: mundo e tela coincidem.
//
// Câmera válida: `x` e `y` finitos e `scale` finita e MAIOR que zero (isso é pré-condição, `isValidCamera` confere nas
// fronteiras). Pontos e deslocamentos válidos têm coordenadas finitas.
//
// Comportamento estável para entradas inválidas (nenhuma função lança, e nenhuma devolve `NaN`, `Infinity` nem `-0`
// quando a câmera recebida é válida)
// - As funções que DEVOLVEM uma câmera (`zoomAt`, `panBy`, `centerOn`, `fitToBounds`) devolvem a PRÓPRIA câmera
//   recebida (mesma referência) quando algum argumento é inválido (fator, foco, deslocamento, ponto, viewport, margem,
//   limites, limites do conteúdo) ou quando o resultado deixaria de ser finito (estouro numérico). Nada é "consertado"
//   em silêncio. Quem chama pode detectar a recusa com `resultado === camera`.
// - Também devolvem a mesma referência quando nada muda (fator 1, escala já no limite).
// - `worldToScreen`/`screenToWorld` são as fórmulas acima: com câmera ou ponto inválido o resultado pode não ser finito.
//   Os tipos garantem a forma dos objetos; só valores numéricos inválidos são tratados aqui.
// - Nada é alterado nos argumentos, e os resultados são objetos novos (ou a câmera recebida, nos casos acima).
//
// Complexidade: todas as funções são O(1) em tempo e em espaço (um número fixo de contas e de objetos pequenos).
// `fitToBounds` também é O(1) PORQUE recebe os limites do conteúdo já calculados. Calcular esses limites a partir de
// todas as posições (`boundsOf`, 3.2) é O(V), uma varredura, e fica fora desta etapa.

/** Ponto, ou deslocamento, em duas dimensões. Em unidades de mundo ou em dp de tela, conforme quem o recebe. */
export type Point = {
  readonly x: number;
  readonly y: number;
};

/** Onde o mundo está em relação à tela: `(x, y)` em dp é onde a origem do mundo aparece; `scale` em dp por unidade de mundo. */
export type Camera = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

/** Tamanho da área de desenho, em dp. Válido quando `width` e `height` são finitos e maiores que zero. */
export type Viewport = {
  readonly width: number;
  readonly height: number;
};

/** Retângulo do MUNDO que contém o conteúdo (por exemplo, as posições de todos os vértices). `min ≤ max` nos dois eixos. */
export type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Menor e maior escala permitidas. Válido quando `0 < min ≤ max` e os dois são finitos. */
export type ScaleLimits = {
  readonly min: number;
  readonly max: number;
};

export type FitToBoundsOptions = {
  /** Folga, em dp, entre o conteúdo e cada borda do viewport. Finita e ≥ 0; padrão 0. Precisa deixar área útil (2·margem < largura e altura). */
  readonly margin?: number;
  /** Limites de escala; padrão `DEFAULT_SCALE_LIMITS`. */
  readonly limits?: ScaleLimits;
};

/** Câmera neutra (identidade): o mundo coincide com a tela. Congelada: é compartilhada. */
export const NEUTRAL_CAMERA: Camera = Object.freeze({ x: 0, y: 0, scale: 1 });

/** Limites de escala PROVISÓRIOS (0,25 a 4); serão ajustados depois de testes em aparelhos. Congelados: são compartilhados. */
export const DEFAULT_SCALE_LIMITS: ScaleLimits = Object.freeze({ min: 0.25, max: 4 });

/** `-0` vira `0`: assim a igualdade estrutural não distingue os dois zeros (mesma regra do peso das arestas). */
const noNegativeZero = (n: number): number => (n === 0 ? 0 : n);

const isValidPoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const isValidViewport = (viewport: Viewport): boolean =>
  Number.isFinite(viewport.width) &&
  Number.isFinite(viewport.height) &&
  viewport.width > 0 &&
  viewport.height > 0;

const isValidLimits = (limits: ScaleLimits): boolean =>
  Number.isFinite(limits.min) && Number.isFinite(limits.max) && limits.min > 0 && limits.min <= limits.max;

/** `x`, `y` e `scale` formam uma câmera utilizável? Se não, `undefined` (o chamador devolve a câmera recebida). */
function cameraOrUndefined(x: number, y: number, scale: number): Camera | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) || scale <= 0) return undefined;
  return { x: noNegativeZero(x), y: noNegativeZero(y), scale };
}

/** A câmera é válida (veja o cabeçalho)? Útil nas fronteiras: depois de ler um valor de fora ou antes de gravar um estado. */
export function isValidCamera(camera: Camera): boolean {
  return Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.scale) && camera.scale > 0;
}

/**
 * Limita `scale` a `[limits.min, limits.max]`. `±Infinity` caem no limite do lado; `NaN` vale como a escala neutra (1),
 * também limitada. Pré-condição: `limits` válidos (as funções que recebem limites os conferem antes de chamar).
 */
export function clampScale(scale: number, limits: ScaleLimits = DEFAULT_SCALE_LIMITS): number {
  const wanted = Number.isNaN(scale) ? 1 : scale;
  return Math.min(Math.max(wanted, limits.min), limits.max);
}

/** Mundo → tela: `tela = mundo · scale + (camera.x, camera.y)`. `point` em unidades de mundo; o resultado, em dp. */
export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: noNegativeZero(point.x * camera.scale + camera.x),
    y: noNegativeZero(point.y * camera.scale + camera.y),
  };
}

/** Tela → mundo, a inversa de `worldToScreen`: `mundo = (tela − (camera.x, camera.y)) / scale`. `point` em dp; o resultado, em unidades de mundo. */
export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: noNegativeZero((point.x - camera.x) / camera.scale),
    y: noNegativeZero((point.y - camera.y) / camera.scale),
  };
}

/**
 * Zoom ancorado: multiplica a escala por `factor` (> 1 aproxima, < 1 afasta) mantendo o ponto do mundo que está sob
 * `focus` (em dp) no MESMO lugar da tela. A escala efetiva é `clampScale(scale · factor, limits)`, e a translação usa a
 * razão EFETIVA `escalaNova / escalaAtual` (não o fator pedido), então o foco continua parado mesmo quando o limite
 * corta o zoom:
 *   x' = focus.x − (focus.x − camera.x) · razão        y' = focus.y − (focus.y − camera.y) · razão
 * Dedução: o ponto do mundo sob o foco é w = (focus − camera) / escala; exigir que continue em `focus` depois dá
 * camera' = focus − w · escalaNova, que é a fórmula acima.
 * Devolve a própria câmera (mesma referência) se `factor` não é finito ou é ≤ 0, se `focus` ou `limits` são inválidos,
 * se a escala efetiva não muda (fator 1 ou já no limite) ou se a conta estoura. Uma câmera que já esteja fora dos
 * limites é trazida para dentro deles.
 */
export function zoomAt(
  camera: Camera,
  focus: Point,
  factor: number,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Camera {
  if (!isValidPoint(focus) || !Number.isFinite(factor) || factor <= 0 || !isValidLimits(limits)) return camera;
  const scale = clampScale(camera.scale * factor, limits);
  if (scale === camera.scale) return camera;
  const ratio = scale / camera.scale;
  return (
    cameraOrUndefined(
      focus.x - (focus.x - camera.x) * ratio,
      focus.y - (focus.y - camera.y) * ratio,
      scale,
    ) ?? camera
  );
}

/**
 * Desloca a câmera por `delta` (em dp): o conteúdo acompanha o dedo, então arrastar 10 dp para a direita soma 10 a
 * `camera.x`. A escala não muda. Devolve a própria câmera se `delta` não é finito ou se a soma estoura.
 */
export function panBy(camera: Camera, delta: Point): Camera {
  if (!isValidPoint(delta)) return camera;
  return cameraOrUndefined(camera.x + delta.x, camera.y + delta.y, camera.scale) ?? camera;
}

/**
 * Leva o ponto do mundo `worldPoint` para o centro do `viewport` (em dp), mantendo a escala:
 *   x' = viewport.width / 2 − worldPoint.x · scale        y' = viewport.height / 2 − worldPoint.y · scale
 * Devolve a própria câmera se o ponto ou o viewport são inválidos (largura ou altura ≤ 0 ou não finitas).
 */
export function centerOn(camera: Camera, worldPoint: Point, viewport: Viewport): Camera {
  if (!isValidPoint(worldPoint) || !isValidViewport(viewport)) return camera;
  return (
    cameraOrUndefined(
      viewport.width / 2 - worldPoint.x * camera.scale,
      viewport.height / 2 - worldPoint.y * camera.scale,
      camera.scale,
    ) ?? camera
  );
}

/**
 * Enquadra o retângulo `bounds` (do mundo) no `viewport` (em dp): escala o maior possível, dentro dos limites, para que
 * o conteúdo caiba na área útil e o centra. Passos:
 *   1. área útil = viewport − 2·margem em cada eixo (a margem é em dp e vale nos quatro lados);
 *   2. escala desejada = min(áreaÚtilX / largura, áreaÚtilY / altura), considerando só os eixos com tamanho > 0;
 *   3. escala = `clampScale(desejada, limits)`;
 *   4. centro do conteúdo = (minX + largura/2, minY + altura/2), levado ao centro do viewport:
 *      x' = viewport.width / 2 − centroX · escala, y' = viewport.height / 2 − centroY · escala.
 * `camera` é só o valor devolvido quando não há o que fazer: a câmera atual NÃO influencia o enquadramento.
 * Casos:
 * - viewport, margem ou limites inválidos (margem negativa, não finita, ou que não deixa área útil): devolve `camera`;
 * - `bounds` inválidos (algum valor não finito, `min > max`, ou largura/altura que estoura): devolve `camera`;
 * - `bounds` indefinido (grafo SEM vértices; não há o que enquadrar): câmera neutra, com a escala 1 limitada;
 * - largura e altura zero (um vértice só, ou vários na mesma posição): escala 1 limitada, ponto no centro;
 * - só a largura ou só a altura é zero (alinhados): a escala vem do outro eixo;
 * - os limites impedem o enquadramento completo (conteúdo grande demais para a escala mínima, ou pequeno demais para a
 *   máxima): a escala válida é mantida, o conteúdo continua centrado e PODE EXCEDER o viewport (no mínimo); nunca se
 *   força a escala para fora dos limites.
 * O(1): recebe os limites do conteúdo já prontos.
 */
export function fitToBounds(
  camera: Camera,
  bounds: Bounds | undefined,
  viewport: Viewport,
  options: FitToBoundsOptions = {},
): Camera {
  const margin = options.margin ?? 0;
  const limits = options.limits ?? DEFAULT_SCALE_LIMITS;
  if (!isValidViewport(viewport) || !isValidLimits(limits) || !Number.isFinite(margin) || margin < 0) return camera;
  const usableWidth = viewport.width - 2 * margin;
  const usableHeight = viewport.height - 2 * margin;
  if (!(usableWidth > 0) || !(usableHeight > 0)) return camera;

  if (bounds === undefined) return { x: 0, y: 0, scale: clampScale(1, limits) };

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return camera;

  const wanted =
    width === 0 && height === 0
      ? 1
      : Math.min(width > 0 ? usableWidth / width : Infinity, height > 0 ? usableHeight / height : Infinity);
  const scale = clampScale(wanted, limits);
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  return (
    cameraOrUndefined(
      viewport.width / 2 - centerX * scale,
      viewport.height / 2 - centerY * scale,
      scale,
    ) ?? camera
  );
}
