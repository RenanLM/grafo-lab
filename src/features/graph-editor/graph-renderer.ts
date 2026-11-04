import type { ComponentType } from 'react';

import type { GraphScene } from './core';

// Contrato de um renderizador de grafos: recebe uma CENA pronta (em dp de tela, calculada pelo núcleo puro) e a área de desenho,
// e só desenha. Não trata gestos, não faz hit-testing, não conhece a store nem altera o grafo. Hoje há uma implementação
// (`svg-graph-renderer.tsx`); o tipo existe para a tela depender do contrato e não do SVG, sem uma hierarquia genérica.

export type GraphRendererProps = {
  readonly scene: GraphScene;
  /** Largura da área de desenho, em dp. A cena já foi montada para essa área. */
  readonly width: number;
  /** Altura da área de desenho, em dp. */
  readonly height: number;
};

export type GraphRenderer = ComponentType<GraphRendererProps>;
