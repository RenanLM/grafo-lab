import type { ComponentType } from 'react';

import type { VertexId } from '@/domain/graph';

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
  /**
   * Vértice a destacar (a origem pendente do modo Conectar). É só um estado VISUAL: a cena não muda (nenhuma geometria é refeita) e
   * o grafo não sabe dele. Um id que não está na cena não destaca nada.
   */
  readonly highlightedVertexId?: VertexId;
};

export type GraphRenderer = ComponentType<GraphRendererProps>;
