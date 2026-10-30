import { layoutGlyph } from './graph-glyph-layout';

describe('layoutGlyph', () => {
  const size = 200;
  const layout = layoutGlyph(size);

  it('mantém todos os vértices (com o raio) dentro do quadrado', () => {
    for (const { x, y } of layout.nodes) {
      expect(x - layout.nodeRadius).toBeGreaterThanOrEqual(-1e-9);
      expect(y - layout.nodeRadius).toBeGreaterThanOrEqual(-1e-9);
      expect(x + layout.nodeRadius).toBeLessThanOrEqual(size + 1e-9);
      expect(y + layout.nodeRadius).toBeLessThanOrEqual(size + 1e-9);
    }
  });

  it('descreve cada aresta como um segmento que liga os centros de dois vértices', () => {
    expect(layout.edges).toHaveLength(4);
    for (const { cx, cy, length, angle } of layout.edges) {
      const p1 = { x: cx - (Math.cos(angle) * length) / 2, y: cy - (Math.sin(angle) * length) / 2 };
      const p2 = { x: cx + (Math.cos(angle) * length) / 2, y: cy + (Math.sin(angle) * length) / 2 };
      const encosta = (p: { x: number; y: number }) =>
        layout.nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-6);
      expect(encosta(p1)).toBe(true);
      expect(encosta(p2)).toBe(true);
    }
  });
});
