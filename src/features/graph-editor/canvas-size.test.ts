import { CANVAS_MAX_HEIGHT, CANVAS_MIN_HEIGHT, canvasSize } from './canvas-size';

describe('canvasSize', () => {
  it.each([
    [320, 320, 288], // 320 · 0,9
    [360, 360, 324],
    [411, 411, 370], // 369,9 arredondado
    [600, 600, 420], // 540 passa do teto
    [200, 200, 240], // 180 fica abaixo do piso
  ])('largura %i → %i × %i dp', (medida, largura, altura) => {
    expect(canvasSize(medida)).toStrictEqual({ width: largura, height: altura });
  });

  it('arredonda a largura (medidas fracionárias do aparelho) e a mesma largura dá sempre o mesmo tamanho', () => {
    expect(canvasSize(359.6)).toStrictEqual(canvasSize(360));
    expect(canvasSize(360.4)).toStrictEqual(canvasSize(360));
    expect(canvasSize(360)).toStrictEqual(canvasSize(360));
  });

  it('a altura fica sempre entre o piso e o teto', () => {
    for (let largura = 1; largura <= 2000; largura += 7) {
      const { height } = canvasSize(largura)!;

      expect(height).toBeGreaterThanOrEqual(CANVAS_MIN_HEIGHT);
      expect(height).toBeLessThanOrEqual(CANVAS_MAX_HEIGHT);
    }
  });

  it.each([0, -5, 0.2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('largura %p (não medida ou inválida): sem tamanho', (largura) => {
    expect(canvasSize(largura)).toBeUndefined();
  });
});
