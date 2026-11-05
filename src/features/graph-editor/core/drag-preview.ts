import type { Edge, EdgeId, Graph, VertexId } from '@/domain/graph';

import { worldToScreen, type Camera, type Point, type Viewport } from './camera';
import { edgeGeometryBetween, type GeometryOptions } from './geometry';
import { positionOf, type GraphLayout } from './layout';
import { sceneEdgeFrom, sceneVertexAt, type GraphScene, type SceneEdge, type SceneOptions, type SceneVertex } from './scene';

// Prévia do arrasto (Fase 3, incremento 3.9). TypeScript puro. Enquanto o dedo arrasta um vértice, o grafo, o layout e o histórico NÃO
// mudam; só o desenho do vértice arrastado e o das arestas dele (como origem ou destino) se movem. Aqui está a descrição desse desenho: a
// parte da cena que muda, calculada sem refazer a cena inteira.
//
// Duas etapas
// - `planDragPreview` (uma vez, quando o arrasto ativa): acha o vértice na cena e as arestas incidentes no grafo, e guarda para cada uma o que
//   NÃO muda durante o gesto: a outra ponta (posição fixa), se a aresta tem o arco oposto (`curved`, decidido só entre as incidentes: o arco
//   oposto de uma aresta do vértice também é do vértice), o peso, a câmera, o corpo da fonte e a área de desenho. Θ(V + E).
// - `buildDragPreview` (a cada atualização do gesto): recebe a posição do vértice no MUNDO e devolve o vértice e as arestas incidentes
//   prontos para desenhar, em dp de tela. Θ(grau(v)): uma geometria e uma aresta de cena por aresta incidente.
//
// Sem fórmula própria. A geometria de cada aresta é a de `edgeGeometryBetween` (a mesma `buildGeometry` de `edgeGeometries`), com a posição
// nova de um dos extremos; a conversão para a tela é a de `sceneEdgeFrom`, a mesma de `buildGraphScene`. Por isso o traço, a seta, a âncora do
// peso e os arcos opostos seguem exatamente as mesmas regras da cena definitiva (a seta continua apontando para o destino na borda dele, os
// dois arcos de A → B e B → A continuam em lados opostos, o peso fica na âncora). Os testes comparam a prévia com a cena reconstruída
// (`buildGraphScene` sobre o layout com o vértice movido), arestas e vértice, em muitos grafos e câmeras.
//
// O que a camada estática não deve desenhar: `hiddenEdgeIds` (as incidentes) e `vertex.id`; a camada da prévia desenha esses. O conjunto é o
// MESMO objeto em todas as atualizações de um arrasto (vem do plano), então quem o compara por referência vê uma mudança só no início e no fim.
//
// Aresta sem geometria (círculos que se tocam ou outra ponta sem posição) não entra na prévia, como não entra na cena: ao afastar os
// vértices ela aparece, ao aproximá-los some, como na cena definitiva depois de soltar.
//
// Complexidade (V vértices, E arestas, d = arestas incidentes ao vértice): plano Θ(V + E) (achar o vértice na cena, varrer as arestas), uma
// vez por arrasto; cada atualização Θ(d) em tempo e em espaço. Refazer a cena inteira seria Θ(V + E) por atualização.

type PlannedEdge = {
  readonly edge: Edge;
  /** O vértice arrastado é a origem (senão, o destino). */
  readonly vertexIsSource: boolean;
  /** Posição fixa da outra ponta no mundo, ou `undefined` se ela não tem posição (a aresta fica sem geometria). */
  readonly otherPosition: Readonly<Point> | undefined;
  /** Existe o arco oposto (só em grafo orientado): a aresta é uma curva. */
  readonly curved: boolean;
};

/** O que não muda durante um arrasto. Guarde-o e passe-o a `buildDragPreview` a cada atualização. */
export type DragPreviewPlan = {
  readonly graphId: string;
  readonly vertexId: VertexId;
  readonly directed: boolean;
  /** O vértice como estava na cena (rótulo, raio, `isolated`); só o centro e a visibilidade mudam na prévia. */
  readonly vertex: SceneVertex;
  readonly incident: readonly PlannedEdge[];
  /** Ids das arestas incidentes, para a camada estática não desenhá-las. O mesmo objeto durante todo o arrasto. */
  readonly hiddenEdgeIds: ReadonlySet<EdgeId>;
  readonly camera: Camera;
  readonly viewport: Viewport | undefined;
  readonly fontSize: number;
  readonly geometry: GeometryOptions;
};

/** O desenho provisório do vértice arrastado e das arestas dele, em dp de tela. */
export type DragPreview = {
  readonly graphId: string;
  readonly vertex: SceneVertex;
  readonly edges: readonly SceneEdge[];
  /** Quais arestas a camada estática deve deixar de desenhar (o mesmo objeto do plano). */
  readonly hiddenEdgeIds: ReadonlySet<EdgeId>;
};

const pairKey = (source: VertexId, target: VertexId): string => `${source}\u0000${target}`;

/**
 * Prepara a prévia do arrasto do vértice `vertexId`. `scene` é a cena que está na tela (de onde sai o vértice com seu rótulo e raio),
 * `camera` e `options` os mesmos de `buildGraphScene`. Devolve `undefined` se o layout ou a cena são de outro grafo ou se o vértice não
 * está na cena (sem posição). Θ(V + E).
 */
export function planDragPreview(
  graph: Graph,
  layout: GraphLayout,
  scene: GraphScene,
  camera: Camera,
  vertexId: VertexId,
  options: SceneOptions = {},
): DragPreviewPlan | undefined {
  if (layout.graphId !== graph.id || scene.graphId !== graph.id) return undefined;
  const vertex = scene.vertices.find((candidate) => candidate.id === vertexId);
  if (vertex === undefined) return undefined;

  const touching = graph.edges.filter((edge) => edge.source === vertexId || edge.target === vertexId);
  const arcs = new Set<string>();
  if (graph.directed) for (const edge of touching) arcs.add(pairKey(edge.source, edge.target));

  const incident: PlannedEdge[] = touching.map((edge) => {
    const vertexIsSource = edge.source === vertexId;
    return {
      edge,
      vertexIsSource,
      otherPosition: positionOf(layout, vertexIsSource ? edge.target : edge.source),
      curved: graph.directed && arcs.has(pairKey(edge.target, edge.source)),
    };
  });

  return {
    graphId: graph.id,
    vertexId,
    directed: graph.directed,
    vertex,
    incident,
    hiddenEdgeIds: new Set(touching.map((edge) => edge.id)),
    camera: { x: camera.x, y: camera.y, scale: camera.scale },
    viewport: options.viewport,
    fontSize: scene.labelFontSize,
    geometry: options,
  };
}

/**
 * O desenho do vértice na posição `position` (mundo) e das arestas incidentes a ele, ou `undefined` se a posição não dá um centro finito na
 * tela. Θ(grau): não toca no grafo, no layout nem nas demais arestas. As arestas saem na ordem do grafo; as sem geometria ficam de fora.
 */
export function buildDragPreview(plan: DragPreviewPlan, position: Point): DragPreview | undefined {
  const vertex = sceneVertexAt(plan.vertex, worldToScreen(plan.camera, position), plan.viewport);
  if (vertex === undefined) return undefined;

  const edges: SceneEdge[] = [];
  for (const planned of plan.incident) {
    const { edge, otherPosition } = planned;
    if (otherPosition === undefined) continue;
    const from = planned.vertexIsSource ? position : otherPosition;
    const to = planned.vertexIsSource ? otherPosition : position;
    const geometry = edgeGeometryBetween(edge, from, to, plan.directed, planned.curved, plan.geometry);
    if (geometry === undefined) continue;
    const sceneEdge = sceneEdgeFrom(geometry, edge.weight, plan.camera, plan.fontSize, plan.viewport);
    if (sceneEdge !== undefined) edges.push(sceneEdge);
  }
  return { graphId: plan.graphId, vertex, edges, hiddenEdgeIds: plan.hiddenEdgeIds };
}
