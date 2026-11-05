import type { Graph } from '@/domain/graph';

import {
  DEFAULT_SCALE_LIMITS,
  NEUTRAL_CAMERA,
  centerOn,
  isValidCamera,
  panBy,
  screenToWorld,
  zoomAt,
  type Camera,
  type Point,
  type ScaleLimits,
  type Viewport,
} from './camera';
import type { GraphLayout } from './layout';
import { DEFAULT_SCENE_MARGIN, fitCameraToGraph, graphContentBounds, type FitOptions } from './scene';

// Câmera por gesto e por comando (Fase 3, incremento 3.10). TypeScript puro: não conhece gesto, React, SVG nem store. Só COMPÕE as funções do 3.1
// (`panBy`, `zoomAt`, `centerOn`, `fitToBounds`) para as quatro situações da tela: o dedo que desloca o fundo, a pinça, os botões Centralizar e Ajustar
// e a mudança de tamanho do canvas. Não há fórmula nova de câmera aqui: cada resultado é uma composição das existentes, e os testes provam as
// equivalências. A câmera continua `{ x, y, scale }` com `tela = mundo·escala + (x, y)` e NÃO pertence ao `Graph`, ao `GraphLayout`, ao JSON nem ao histórico.
//
// Âncora, não acúmulo. Cada gesto guarda uma ÂNCORA (a câmera e o ponto do dedo no instante em que o gesto ATIVOU) e cada atualização é calculada A PARTIR
// DELA, nunca da câmera da atualização anterior. Assim um evento perdido ou atrasado não deixa resíduo, não há erro que se acumule, e o resultado de
// uma atualização só depende da âncora e do ponto atual (duas atualizações com os mesmos dados dão a mesma câmera). Isso vale para o pan (`panFromAnchor`) e
// para a pinça (`pinchFromAnchor`, com a ESCALA ACUMULADA do gesto). A estratégia incremental (`scaleChange`) NÃO é usada, para nunca multiplicar duas vezes.
//
// Pan. `panFromAnchor(âncora, deslocamento)` = `panBy(âncora, deslocamento)`, com o deslocamento em dp LOCAIS ao canvas, medido a partir de onde o dedo estava quando o
// gesto ativou (o quadro não salta no reconhecimento: a folga de 10 dp do limiar não vira deslocamento, como na rolagem nativa). O conteúdo acompanha o dedo,
// então arrastar 10 dp para a direita soma 10 a `camera.x`. A escala não muda.
//
// Pinça. Com a câmera `C0` e o foco `F0` na ativação, o ponto do mundo sob o foco é `W = screenToWorld(C0, F0)`. Com a escala acumulada `s` e o foco `F` agora, a câmera é a
// que mantém `W` sob `F` com a escala `s·C0.scale` limitada aos limites:
//     escala' = clamp(C0.scale · s)      x' = F.x − W.x · escala'      y' = F.y − W.y · escala'
// que é exatamente `panBy(zoomAt(C0, F0, s, limites), F − F0)`: o zoom ancorado em `F0` e depois o deslocamento do foco, uma vez só. O foco se mover entre as atualizações (dois
// dedos que andam juntos) desloca a câmera por esse mesmo termo, sem um pan separado. Quando o limite corta a escala, o ponto sob o foco continua sob o foco (a razão efetiva é a
// do limite). Sem mudar a escala (`s = 1`) a pinça é um pan de dois dedos; com o foco parado é o `zoomAt`.
//
// Comandos. `centerCamera` leva o centro do CONTEÚDO (os círculos com o raio visual e os extremos e ápices das arestas, `graphContentBounds`) ao centro do canvas, mantendo a escala. `fitGraphCamera`
// enquadra esse conteúdo com margem (`fitCameraToGraph`, que respeita os limites de escala) e diz se coube. `cameraForResize` mantém sob o centro do canvas novo o ponto do mundo que estava sob o
// centro do antigo. Entradas inválidas devolvem a MESMA câmera recebida (como as funções do 3.1), e nada é alterado nos argumentos.
//
// Complexidade: `panFromAnchor`, `pinchFromAnchor`, `cameraForResize`, `sameCamera` O(1); `centerCamera` e `fitGraphCamera` Θ(V + E) (os limites do conteúdo, `graphContentBounds`).

/** Resultado de Ajustar ao grafo: a câmera e se o conteúdo coube inteiro na área útil (o canvas menos a margem). */
export type FitResult = {
  readonly camera: Camera;
  /** `false` quando o limite de escala impediu o enquadramento completo (o conteúdo excede a área útil). */
  readonly fits: boolean;
};

const isFinitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const isValidViewport = (viewport: Viewport): boolean =>
  Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;

/** As duas câmeras têm os mesmos três números? */
export function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

/**
 * A câmera depois de o dedo andar `displacement` (dp locais) desde a ÂNCORA: `panBy(âncora, deslocamento)`. Devolve a própria âncora (mesma referência) se o deslocamento
 * é nulo ou inválido, ou se a conta estoura. A escala não muda.
 */
export function panFromAnchor(anchor: Camera, displacement: Point): Camera {
  if (!isFinitePoint(displacement) || (displacement.x === 0 && displacement.y === 0)) return anchor;
  return panBy(anchor, displacement);
}

/**
 * A câmera de uma pinça. `anchor` e `anchorFocal` são a câmera e o foco (dp locais ao canvas) quando a pinça ATIVOU; `scale` é a escala ACUMULADA do gesto desde a ativação (1 =
 * sem mudança) e `focal` o foco agora. O ponto do mundo que estava sob `anchorFocal` fica sob `focal`, com a escala `anchor.scale · scale` limitada a `limits` (padrão 0,25 a 4).
 * É `panBy(zoomAt(âncora, focoDaÂncora, escala, limites), foco − focoDaÂncora)`. Devolve a própria âncora (mesma referência) se `scale` não é finita e positiva, se algum foco não é
 * finito, se nada mudou ou se a conta estoura.
 */
export function pinchFromAnchor(
  anchor: Camera,
  anchorFocal: Point,
  scale: number,
  focal: Point,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Camera {
  if (!Number.isFinite(scale) || scale <= 0 || !isFinitePoint(anchorFocal) || !isFinitePoint(focal)) return anchor;
  const zoomed = zoomAt(anchor, anchorFocal, scale, limits);
  const moved = panFromAnchor(zoomed, { x: focal.x - anchorFocal.x, y: focal.y - anchorFocal.y });
  return sameCamera(moved, anchor) ? anchor : moved;
}

/**
 * Centralizar: leva o centro do CONTEÚDO do grafo (`graphContentBounds`) ao centro do `viewport`, mantendo a escala de `camera`. Sem nada posicionado (grafo vazio) devolve a câmera NEUTRAL
 * (nova, escala 1): é a regra previsível para o caso sem conteúdo. Devolve `camera` se ela, o `viewport` ou o layout (de outro grafo) são inválidos.
 */
export function centerCamera(
  graph: Graph,
  layout: GraphLayout,
  camera: Camera,
  viewport: Viewport,
  options: FitOptions = {},
): Camera {
  if (!isValidCamera(camera) || !isValidViewport(viewport) || layout.graphId !== graph.id) return camera;
  const bounds = graphContentBounds(graph, layout, options);
  if (bounds === undefined) return { ...NEUTRAL_CAMERA };
  const centered = centerOn(camera, { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, viewport);
  return sameCamera(centered, camera) ? camera : centered;
}

/**
 * Ajustar ao grafo: `fitCameraToGraph` (conteúdo com o raio dos vértices e os ápices das curvas, margem de `options.margin` dp, padrão 24, e limites de escala `options.limits`, padrão 0,25 a 4)
 * mais o aviso de se coube: `fits` é falso quando a escala foi cortada pelo limite mínimo e o conteúdo ainda excede a área útil (o canvas menos duas margens). Grafo sem nada
 * posicionado: câmera neutra e `fits: true`. `undefined` se o canvas não tem tamanho válido (ou é menor que as margens) ou se o layout é de outro grafo.
 */
export function fitGraphCamera(graph: Graph, layout: GraphLayout, viewport: Viewport, options: FitOptions = {}): FitResult | undefined {
  const camera = fitCameraToGraph(graph, layout, viewport, options);
  if (camera === undefined) return undefined;
  const bounds = graphContentBounds(graph, layout, options);
  if (bounds === undefined) return { camera, fits: true };
  const margin = options.margin !== undefined && Number.isFinite(options.margin) && options.margin >= 0 ? options.margin : DEFAULT_SCENE_MARGIN;
  const epsilon = 1e-9;
  const fits =
    (bounds.maxX - bounds.minX) * camera.scale <= viewport.width - 2 * margin + epsilon &&
    (bounds.maxY - bounds.minY) * camera.scale <= viewport.height - 2 * margin + epsilon;
  return { camera, fits };
}

/**
 * A câmera para um canvas de outro tamanho: o ponto do mundo que estava sob o CENTRO do canvas antigo (`from`) passa a ficar sob o centro do novo (`to`), com a mesma escala. Não
 * reenquadra o grafo. Devolve `camera` (mesma referência) se os tamanhos são iguais ou algum é inválido.
 */
export function cameraForResize(camera: Camera, from: Viewport, to: Viewport): Camera {
  if (!isValidCamera(camera) || !isValidViewport(from) || !isValidViewport(to)) return camera;
  if (from.width === to.width && from.height === to.height) return camera;
  const world = screenToWorld(camera, { x: from.width / 2, y: from.height / 2 });
  const resized = centerOn(camera, world, to);
  return sameCamera(resized, camera) ? camera : resized;
}
