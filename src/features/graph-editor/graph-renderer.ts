import type { ComponentType } from 'react';

import type { VertexId } from '@/domain/graph';

import type { DragPreview, EditorSelection, GraphScene } from './core';

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
  /**
   * O que está selecionado no modo Selecionar (vértice ou aresta, por id técnico). Também é só um estado VISUAL: a cena e a geometria não mudam e o
   * grafo não sabe dele. Um id que não está na cena, ou `none`, não destaca nada.
   */
  readonly selection?: EditorSelection;
  /**
   * A prévia do arrasto de um vértice (3.9): o vértice arrastado e as arestas dele, já nas posições do dedo. Também é só VISUAL: o grafo, o
   * layout e a cena (`scene`, que continua com as posições de antes do arrasto) não mudam. O renderizador desenha a cena sem esses elementos
   * e desenha os da prévia no lugar. Uma prévia de outro grafo (`graphId` diferente da cena) é ignorada.
   */
  readonly preview?: DragPreview;
};

export type GraphRenderer = ComponentType<GraphRendererProps>;
