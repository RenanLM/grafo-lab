import { createGraph, type Graph } from '@/domain/graph';

// Grafo vazio de uma sessão nova (Fase 3, incremento 3.6), criado pela API oficial do domínio. Cada grafo novo leva um id próprio
// (`novo-grafo-<n>`), então nada de uma sessão anterior (id, posições) pode ser confundido com o dele. O domínio não gera ids de
// grafo: quem abre a sessão fornece (aqui, um contador da tela).

/** Grafo sem vértices nem arestas, orientado ou não; `serial` (≥ 1) diferencia os grafos criados na mesma tela. */
export function buildNewGraph(directed: boolean, serial: number): Graph {
  return createGraph({
    id: `novo-grafo-${serial}`,
    name: directed ? 'Novo grafo orientado' : 'Novo grafo não orientado',
    directed,
  });
}
