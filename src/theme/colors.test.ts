import { colors, type ColorToken } from './colors';

function luminance(hex: string): number {
  const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = canais.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (escuro! + 0.05);
}

// Pares (texto, fundo) usados nas telas. WCAG 2.1 AA exige 4,5:1 para texto normal.
const pares: [ColorToken, ColorToken][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textSecondary', 'background'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'surfaceMuted'],
  ['onPrimary', 'primary'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['primary', 'primaryMuted'],
  // Canvas do grafo: rótulo do vértice sobre o preenchimento do círculo; peso, traço e seta sobre o fundo do canvas.
  ['text', 'primaryMuted'],
];

describe.each(['light', 'dark'] as const)('contraste do tema %s', (esquema) => {
  it.each(pares)('%s sobre %s atinge 4,5:1', (texto, fundo) => {
    const paleta = colors[esquema];
    expect(contraste(paleta[texto], paleta[fundo])).toBeGreaterThanOrEqual(4.5);
  });
});
