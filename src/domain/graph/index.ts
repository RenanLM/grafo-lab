// API pública do domínio de grafos, agrupada por assunto. Cada nome sai de um único módulo.
// Helpers internos do domínio não são exportados por aqui.

// Modelo
export {
  GRAPH_SCHEMA_VERSION,
  type Edge,
  type EdgeId,
  type Graph,
  type Vertex,
  type VertexId,
} from './types';

// Erros e Result. `ok`/`fail` ficam públicos porque os algoritmos das próximas fases devolverão `Result`.
export { fail, ok, type GraphError, type InvalidLabelReason, type Result } from './errors';

// Operações de criação, edição e busca
export {
  addEdge,
  addVertex,
  createGraph,
  findEdge,
  getEdge,
  getVertex,
  MAX_VERTEX_LABEL_LENGTH,
  order,
  removeEdge,
  removeVertex,
  setEdgeWeight,
  setVertexLabel,
  size,
  type CreateGraphOptions,
  type NewEdge,
} from './graph';

// Consultas de grau e vizinhança
export {
  degree,
  inDegree,
  isIsolated,
  isolatedVertices,
  neighbors,
  outDegree,
  predecessors,
  successors,
} from './queries';

// Representações: lista e matriz de adjacência, matriz e lista de incidência
export {
  adjacencyList,
  type AdjacencyEntry,
  type AdjacencyList,
  type AdjacencyRow,
} from './adjacency';
export {
  adjacencyAsNumbers,
  adjacencyMatrix,
  type AdjacencyCell,
  type AdjacencyMatrix,
  type AdjacencyNumericOptions,
} from './adjacency-matrix';
export { incidenceMatrix, type IncidenceMatrix, type IncidenceValue } from './incidence';
export {
  incidenceList,
  type IncidenceList,
  type IncidenceListEntry,
  type IncidenceRole,
} from './incidence-list';
