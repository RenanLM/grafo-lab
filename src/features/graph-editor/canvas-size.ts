// Tamanho do canvas do Laboratório a partir da largura MEDIDA (`onLayout`), em dp. Pura, para a tela não recalcular a câmera em
// laço: a largura é arredondada, e a altura é uma função só dela (proporção 0,9, entre 240 e 420 dp), então medir de novo a mesma
// largura não muda nada e não há realimentação entre o tamanho do canvas e a medida.

/** Altura em relação à largura. */
export const CANVAS_ASPECT = 0.9;
export const CANVAS_MIN_HEIGHT = 240;
export const CANVAS_MAX_HEIGHT = 420;

export type CanvasSize = { readonly width: number; readonly height: number };

/** Tamanho do canvas para a largura medida, ou `undefined` se ela ainda não foi medida ou não é válida. */
export function canvasSize(measuredWidth: number): CanvasSize | undefined {
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) return undefined;
  const width = Math.round(measuredWidth);
  if (width <= 0) return undefined;
  const height = Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, Math.round(width * CANVAS_ASPECT)));
  return { width, height };
}
