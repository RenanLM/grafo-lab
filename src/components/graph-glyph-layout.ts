export type GlyphLayout = {
  nodeRadius: number;
  edgeThickness: number;
  nodes: { x: number; y: number }[];
  /** Cada aresta como segmento: centro, comprimento e ângulo (rad) entre os centros dos vértices. */
  edges: { cx: number; cy: number; length: number; angle: number }[];
};

// Mesmo desenho do ícone do app (scripts/gerar-icones.py): triângulo com uma haste.
const VERTICES: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0.3],
  [1, 1.8],
  [-0.9, 2.1],
];
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 3],
];

/** Calcula, em pixels, onde desenhar o glifo dentro de um quadrado `size` x `size`. */
export function layoutGlyph(size: number): GlyphLayout {
  const nodeRadius = size * 0.07;
  const edgeThickness = size * 0.035;
  const xs = VERTICES.map(([x]) => x);
  const ys = VERTICES.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  const unit = (size - 2 * nodeRadius) / span;
  const offsetX = (size - (Math.max(...xs) - minX) * unit) / 2;
  const offsetY = (size - (Math.max(...ys) - minY) * unit) / 2;

  const nodes = VERTICES.map(([x, y]) => ({
    x: offsetX + (x - minX) * unit,
    y: offsetY + (y - minY) * unit,
  }));

  const edges = EDGES.map(([from, to]) => {
    const a = nodes[from]!;
    const b = nodes[to]!;
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  });

  return { nodeRadius, edgeThickness, nodes, edges };
}
