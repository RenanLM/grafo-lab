import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import type { EdgeId, VertexId } from '@/domain/graph';
import { useTheme } from '@/theme';

import type { SceneEdge, SceneVertex } from './core';
import type { GraphRendererProps } from './graph-renderer';

// Renderizador SVG (Fase 3, incremento 3.5): percorre a cena e desenha. Nada de regra aqui: não altera o grafo, não despacha
// ações, não guarda histórico nem estado, não trata gestos e não refaz geometria. As coordenadas da cena já estão em dp de tela;
// por isso o `viewBox` é exatamente a área de desenho (sem escala) e não há `transform`: a câmera já foi aplicada, uma vez.
//
// Ordem de desenho, de baixo para cima: traços das arestas, pontas de seta, caixas e textos dos pesos, círculos dos vértices e
// rótulos dos vértices. Assim nenhum traço atravessa um círculo e o peso fica legível sobre a aresta.
//
// Cores: só tokens do tema (claro/escuro), sem paleta própria. Direção aparece na SETA, peso no TEXTO, vértice isolado pela
// ausência de arestas: o significado não depende da cor. Espessuras e corpo do texto são constantes em dp (não crescem com o zoom).
//
// Acessibilidade: o conjunto é UMA imagem com o resumo da cena como rótulo; os elementos internos ficam escondidos dos leitores
// de tela. A acessibilidade detalhada (navegar vértice a vértice) é do incremento 3.12 e a experiência com TalkBack ainda não
// foi validada em aparelho.
//
// Destaque (3.7): `highlightedVertexId` marca a origem pendente do modo Conectar com um anel tracejado em volta do vértice e um
// contorno mais grosso. É só desenho: a cena não é refeita (nenhuma geometria muda) e este arquivo só procura o vértice na cena,
// O(V). O destaque não depende só de cor: o que o distingue é a FORMA (anel tracejado, contorno de 4 dp contra 2 dp).
//
// Seleção (3.8): `selection` destaca o vértice ou a aresta selecionados. Vértice: anel SÓLIDO em volta (o anel da origem do Conectar é tracejado) e contorno de
// 4 dp. Aresta: traço de 4 dp (contra 2 dp) no token `primary`, um halo largo e translúcido por baixo e a ponta da seta com contorno (maior). A diferença é de FORMA
// (sólido x tracejado, espessura, halo), não só de cor. O halo (10 dp) é mais estreito que a tolerância de toque da aresta (12 dp de cada lado): o que se vê
// nunca promete uma área de toque maior que a do hit-testing. É só desenho: nenhuma geometria muda e este arquivo só procura o elemento na cena, O(V + E).
//
// Prévia do arrasto (3.9): `preview` traz o vértice arrastado e as arestas dele já posicionados (calculados pelo núcleo, com as mesmas fórmulas
// da cena; este arquivo não calcula nada). Os elementos são desenhados em DUAS camadas por tipo, na mesma ordem de empilhamento de antes:
// - a camada ESTÁTICA (`React.memo`) desenha a cena de sempre MENOS o vértice arrastado e as arestas incidentes (`preview.hiddenEdgeIds`,
//   que é o mesmo objeto durante todo o arrasto). As propriedades dela não mudam entre as atualizações do dedo, então o React não a percorre
//   de novo: só no começo e no fim do arrasto (Θ(V + E) elementos);
// - a camada da PRÉVIA desenha o vértice (círculo, rótulo, anel de seleção) e as arestas incidentes (traço, seta, peso) nas posições novas, Θ(grau)
//   elementos por atualização. As arestas da prévia ficam por cima das demais arestas (e abaixo de TODOS os vértices); a ordem entre arestas que
//   se cruzam pode, por isso, diferir da cena definitiva durante o gesto. O vértice arrastado fica por cima dos outros vértices.
// O destaque de seleção acompanha o vértice (ou a aresta) arrastado: o anel e o halo são procurados primeiro na prévia. Uma prévia de OUTRO grafo
// (`graphId` diferente do da cena, que reaproveita os mesmos ids técnicos) é ignorada: nunca se desenha por cima do grafo errado.
//
// Custo: Θ(V + E) elementos SVG (um círculo e um texto por vértice; um traço por aresta, mais seta e peso quando há; um anel quando
// há destaque). Sem arrasto, a cena não muda a cada quadro. A parte nativa (react-native-svg) redesenha o quadro inteiro a cada alteração de
// qualquer elemento, e isso o arrasto não evita: reduz-se o trabalho do React e do Fabric (Θ(grau) elementos atualizados), não o desenho nativo.
//
// Limitação: o texto não é medido. O centro vertical do texto é aproximado (linha de base a 0,35 do corpo abaixo do centro) e
// a largura da caixa do peso vem da estimativa da cena; o resultado foi conferido a olho no emulador, não calculado.

const EDGE_STROKE_WIDTH = 2;
const VERTEX_STROKE_WIDTH = 2;
const SOURCE_VERTEX_STROKE_WIDTH = 4;
const SOURCE_RING_GAP = 7;
const SOURCE_RING_STROKE_WIDTH = 3;
const SOURCE_RING_DASH = '6 4';
const SELECTION_RING_GAP = 6;
const SELECTION_RING_STROKE_WIDTH = 3;
const SELECTED_EDGE_STROKE_WIDTH = 4;
const SELECTED_EDGE_HALO_WIDTH = 10;
const SELECTED_EDGE_HALO_OPACITY = 0.3;
const SELECTED_ARROW_OUTLINE_WIDTH = 3;
const WEIGHT_BOX_RADIUS = 4;
const BASELINE_OFFSET = 0.35;

const NO_EDGES: readonly SceneEdge[] = [];
const NO_VERTICES: readonly SceneVertex[] = [];

const pointsOf = (...points: readonly { x: number; y: number }[]): string => points.map((point) => `${point.x},${point.y}`).join(' ');

const curvePath = (edge: SceneEdge): string =>
  edge.path.kind === 'line'
    ? ''
    : `M ${edge.path.from.x} ${edge.path.from.y} Q ${edge.path.control.x} ${edge.path.control.y} ${edge.path.to.x} ${edge.path.to.y}`;

type EdgeLayerProps = {
  readonly edges: readonly SceneEdge[];
  /** Arestas que esta camada não desenha (as da prévia do arrasto). */
  readonly skip: ReadonlySet<EdgeId> | undefined;
  readonly selectedId: EdgeId | undefined;
  readonly color: string;
  readonly selectedColor: string;
};

const EdgeStrokes = memo(function EdgeStrokes({ edges, skip, selectedId, color, selectedColor }: EdgeLayerProps) {
  return (
    <G>
      {edges.map((edge) => {
        if (skip?.has(edge.id)) return null;
        const selected = edge.id === selectedId;
        return edge.path.kind === 'line' ? (
          <Line
            key={edge.id}
            testID={`edge-stroke-${edge.id}`}
            x1={edge.path.from.x}
            y1={edge.path.from.y}
            x2={edge.path.to.x}
            y2={edge.path.to.y}
            stroke={selected ? selectedColor : color}
            strokeWidth={selected ? SELECTED_EDGE_STROKE_WIDTH : EDGE_STROKE_WIDTH}
          />
        ) : (
          <Path
            key={edge.id}
            testID={`edge-stroke-${edge.id}`}
            d={curvePath(edge)}
            fill="none"
            stroke={selected ? selectedColor : color}
            strokeWidth={selected ? SELECTED_EDGE_STROKE_WIDTH : EDGE_STROKE_WIDTH}
          />
        );
      })}
    </G>
  );
});

const EdgeArrows = memo(function EdgeArrows({ edges, skip, selectedId, color, selectedColor }: EdgeLayerProps) {
  return (
    <G>
      {edges.map((edge) => {
        if (edge.arrow === undefined || skip?.has(edge.id)) return null;
        const selected = edge.id === selectedId;
        return (
          <Polygon
            key={edge.id}
            testID={`edge-arrow-${edge.id}`}
            points={pointsOf(edge.arrow.tip, edge.arrow.left, edge.arrow.right)}
            fill={selected ? selectedColor : color}
            stroke={selected ? selectedColor : undefined}
            strokeWidth={selected ? SELECTED_ARROW_OUTLINE_WIDTH : undefined}
            strokeLinejoin="round"
          />
        );
      })}
    </G>
  );
});

type WeightLayerProps = {
  readonly edges: readonly SceneEdge[];
  readonly skip: ReadonlySet<EdgeId> | undefined;
  readonly fontSize: number;
  readonly surfaceColor: string;
  readonly borderColor: string;
  readonly textColor: string;
};

const EdgeWeights = memo(function EdgeWeights({ edges, skip, fontSize, surfaceColor, borderColor, textColor }: WeightLayerProps) {
  return (
    <G>
      {edges.map((edge) =>
        edge.weight === undefined || skip?.has(edge.id) ? null : (
          <G key={edge.id}>
            <Rect
              testID={`weight-box-${edge.id}`}
              x={edge.weight.anchor.x - edge.weight.width / 2}
              y={edge.weight.anchor.y - edge.weight.height / 2}
              width={edge.weight.width}
              height={edge.weight.height}
              rx={WEIGHT_BOX_RADIUS}
              fill={surfaceColor}
              stroke={borderColor}
              strokeWidth={1}
            />
            <SvgText
              testID={`weight-text-${edge.id}`}
              x={edge.weight.anchor.x}
              y={edge.weight.anchor.y + fontSize * BASELINE_OFFSET}
              fontSize={fontSize}
              textAnchor="middle"
              fill={textColor}>
              {edge.weight.text}
            </SvgText>
          </G>
        ),
      )}
    </G>
  );
});

type VertexLayerProps = {
  readonly vertices: readonly SceneVertex[];
  /** O vértice que esta camada não desenha (o da prévia do arrasto). */
  readonly skipId: VertexId | undefined;
  /** Vértices com contorno grosso: a origem do Conectar e o selecionado (primitivos, para a camada memoizada não acordar à toa). */
  readonly highlightedId: VertexId | undefined;
  readonly selectedId: VertexId | undefined;
  readonly fillColor: string;
  readonly strokeColor: string;
};

const VertexCircles = memo(function VertexCircles({ vertices, skipId, highlightedId, selectedId, fillColor, strokeColor }: VertexLayerProps) {
  return (
    <G>
      {vertices.map((vertex) =>
        vertex.id === skipId ? null : (
          <Circle
            key={vertex.id}
            testID={`vertex-circle-${vertex.id}`}
            cx={vertex.center.x}
            cy={vertex.center.y}
            r={vertex.radius}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={vertex.id === highlightedId || vertex.id === selectedId ? SOURCE_VERTEX_STROKE_WIDTH : VERTEX_STROKE_WIDTH}
          />
        ),
      )}
    </G>
  );
});

type LabelLayerProps = {
  readonly vertices: readonly SceneVertex[];
  readonly skipId: VertexId | undefined;
  readonly fontSize: number;
  readonly textColor: string;
};

const VertexLabels = memo(function VertexLabels({ vertices, skipId, fontSize, textColor }: LabelLayerProps) {
  return (
    <G>
      {vertices.map((vertex) =>
        vertex.id === skipId ? null : (
          <SvgText
            key={vertex.id}
            testID={`vertex-label-${vertex.id}`}
            x={vertex.center.x}
            y={vertex.center.y + fontSize * BASELINE_OFFSET}
            fontSize={fontSize}
            fontWeight="600"
            textAnchor="middle"
            fill={textColor}>
            {vertex.displayLabel}
          </SvgText>
        ),
      )}
    </G>
  );
});

export function SvgGraphRenderer({ scene, width, height, highlightedVertexId, selection, preview }: GraphRendererProps) {
  const { colors } = useTheme();
  const { labelFontSize } = scene;
  const edgeColor = colors.textSecondary;
  // Só vale a prévia do MESMO grafo da cena (ids técnicos se repetem entre grafos).
  const live = preview !== undefined && preview.graphId === scene.graphId ? preview : undefined;
  const hiddenEdges = live?.hiddenEdgeIds;
  const hiddenVertexId = live?.vertex.id;
  const liveEdges = live?.edges ?? NO_EDGES;
  const liveVertices = live === undefined ? NO_VERTICES : [live.vertex];

  const vertexNamed = (id: VertexId | undefined): SceneVertex | undefined =>
    id === undefined ? undefined : id === hiddenVertexId ? live?.vertex : scene.vertices.find((vertex) => vertex.id === id);
  const highlighted = vertexNamed(highlightedVertexId);
  const selectedVertex = selection?.type === 'vertex' ? vertexNamed(selection.vertexId) : undefined;
  const selectedEdge: SceneEdge | undefined =
    selection?.type === 'edge'
      ? hiddenEdges?.has(selection.edgeId)
        ? liveEdges.find((edge) => edge.id === selection.edgeId)
        : scene.edges.find((edge) => edge.id === selection.edgeId)
      : undefined;
  const edgeProps = { selectedId: selectedEdge?.id, color: edgeColor, selectedColor: colors.primary };
  const weightProps = {
    fontSize: labelFontSize,
    surfaceColor: colors.surface,
    borderColor: colors.border,
    textColor: colors.text,
  };
  const vertexProps = {
    highlightedId: highlighted?.id,
    selectedId: selectedVertex?.id,
    fillColor: colors.primaryMuted,
    strokeColor: colors.primary,
  };

  return (
    <View
      testID="graph-canvas"
      accessible
      accessibilityRole="image"
      accessibilityLabel={scene.summary}
      style={[styles.canvas, { width, height, backgroundColor: colors.surface }]}>
      <Svg
        testID="graph-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        importantForAccessibility="no-hide-descendants">
        {selectedEdge === undefined ? null : (
          <G>
            {selectedEdge.path.kind === 'line' ? (
              <Line
                testID={`edge-selection-${selectedEdge.id}`}
                x1={selectedEdge.path.from.x}
                y1={selectedEdge.path.from.y}
                x2={selectedEdge.path.to.x}
                y2={selectedEdge.path.to.y}
                stroke={colors.primary}
                strokeOpacity={SELECTED_EDGE_HALO_OPACITY}
                strokeWidth={SELECTED_EDGE_HALO_WIDTH}
                strokeLinecap="round"
              />
            ) : (
              <Path
                testID={`edge-selection-${selectedEdge.id}`}
                d={curvePath(selectedEdge)}
                fill="none"
                stroke={colors.primary}
                strokeOpacity={SELECTED_EDGE_HALO_OPACITY}
                strokeWidth={SELECTED_EDGE_HALO_WIDTH}
                strokeLinecap="round"
              />
            )}
          </G>
        )}
        <EdgeStrokes edges={scene.edges} skip={hiddenEdges} {...edgeProps} />
        <EdgeStrokes edges={liveEdges} skip={undefined} {...edgeProps} />
        <EdgeArrows edges={scene.edges} skip={hiddenEdges} {...edgeProps} />
        <EdgeArrows edges={liveEdges} skip={undefined} {...edgeProps} />
        <EdgeWeights edges={scene.edges} skip={hiddenEdges} {...weightProps} />
        <EdgeWeights edges={liveEdges} skip={undefined} {...weightProps} />
        {selectedVertex === undefined ? null : (
          <G>
            <Circle
              testID={`vertex-selection-ring-${selectedVertex.id}`}
              cx={selectedVertex.center.x}
              cy={selectedVertex.center.y}
              r={selectedVertex.radius + SELECTION_RING_GAP}
              fill="none"
              stroke={colors.text}
              strokeWidth={SELECTION_RING_STROKE_WIDTH}
            />
          </G>
        )}
        {highlighted === undefined ? null : (
          <G>
            <Circle
              testID={`vertex-source-ring-${highlighted.id}`}
              cx={highlighted.center.x}
              cy={highlighted.center.y}
              r={highlighted.radius + SOURCE_RING_GAP}
              fill="none"
              stroke={colors.primary}
              strokeWidth={SOURCE_RING_STROKE_WIDTH}
              strokeDasharray={SOURCE_RING_DASH}
            />
          </G>
        )}
        <VertexCircles vertices={scene.vertices} skipId={hiddenVertexId} {...vertexProps} />
        <VertexCircles vertices={liveVertices} skipId={undefined} {...vertexProps} />
        <VertexLabels vertices={scene.vertices} skipId={hiddenVertexId} fontSize={labelFontSize} textColor={colors.text} />
        <VertexLabels vertices={liveVertices} skipId={undefined} fontSize={labelFontSize} textColor={colors.text} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { overflow: 'hidden' },
});
