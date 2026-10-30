export type StudyUnit = {
  id: string;
  number: number;
  title: string;
  hours: number;
  summary: string;
};

/** As três unidades da disciplina (ementa). Conteúdo das aulas entra nas fases seguintes. */
export const STUDY_UNITS: readonly StudyUnit[] = [
  {
    id: 'fundamentos',
    number: 1,
    title: 'Fundamentos',
    hours: 10,
    summary:
      'Conceitos, notação e terminologia; vértices, arestas, graus e vizinhança; caminhos, trilhas e ciclos; grafos orientados e não orientados; lista de adjacência, matriz de adjacência e matriz de incidência.',
  },
  {
    id: 'problemas-circulatorios',
    number: 2,
    title: 'Problemas circulatórios',
    hours: 24,
    summary:
      'Percursos em largura e em profundidade (BFS e DFS); conexidade e componentes; árvores geradoras de custo mínimo (Kruskal e Prim); caminhos de custo mínimo (Dijkstra); trilhas eulerianas, Teorema de Euler e Fleury.',
  },
  {
    id: 'topicos-avancados',
    number: 3,
    title: 'Tópicos avançados',
    hours: 36,
    summary:
      'Planaridade e Kuratowski; coloração de arestas e Vizing; coloração de vértices e Quatro Cores; emparelhamentos bipartidos, Hall e Método Húngaro; fluxos em redes e Ford-Fulkerson.',
  },
];
