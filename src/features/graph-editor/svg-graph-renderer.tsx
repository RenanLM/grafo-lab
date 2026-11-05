import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

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
// Custo: Θ(V + E) elementos SVG (um círculo e um texto por vértice; um traço por aresta, mais seta e peso quando há; um anel quando
// há destaque). Renderizar de novo percorre a cena inteira; sem arrasto, a cena não muda a cada quadro.
//
// Limitação: o texto não é medido. O centro vertical do texto é aproximado (linha de base a 0,35 do corpo abaixo do centro) e
// a largura da caixa do peso vem da estimativa da cena; o resultado foi conferido a olho no emulador, não calculado.

const EDGE_STROKE_WIDTH = 2;
const VERTEX_STROKE_WIDTH = 2;
const SOURCE_VERTEX_STROKE_WIDTH = 4;
const SOURCE_RING_GAP = 7;
const SOURCE_RING_STROKE_WIDTH = 3;
const SOURCE_RING_DASH = '6 4';
const WEIGHT_BOX_RADIUS = 4;
const BASELINE_OFFSET = 0.35;

const pointsOf = (...points: readonly { x: number; y: number }[]): string => points.map((point) => `${point.x},${point.y}`).join(' ');

export function SvgGraphRenderer({ scene, width, height, highlightedVertexId }: GraphRendererProps) {
  const { colors } = useTheme();
  const { labelFontSize } = scene;
  const edgeColor = colors.textSecondary;
  const highlighted =
    highlightedVertexId === undefined ? undefined : scene.vertices.find((vertex) => vertex.id === highlightedVertexId);

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
        <G>
          {scene.edges.map((edge) =>
            edge.path.kind === 'line' ? (
              <Line
                key={edge.id}
                testID={`edge-stroke-${edge.id}`}
                x1={edge.path.from.x}
                y1={edge.path.from.y}
                x2={edge.path.to.x}
                y2={edge.path.to.y}
                stroke={edgeColor}
                strokeWidth={EDGE_STROKE_WIDTH}
              />
            ) : (
              <Path
                key={edge.id}
                testID={`edge-stroke-${edge.id}`}
                d={`M ${edge.path.from.x} ${edge.path.from.y} Q ${edge.path.control.x} ${edge.path.control.y} ${edge.path.to.x} ${edge.path.to.y}`}
                fill="none"
                stroke={edgeColor}
                strokeWidth={EDGE_STROKE_WIDTH}
              />
            ),
          )}
        </G>
        <G>
          {scene.edges.map((edge) =>
            edge.arrow === undefined ? null : (
              <Polygon
                key={edge.id}
                testID={`edge-arrow-${edge.id}`}
                points={pointsOf(edge.arrow.tip, edge.arrow.left, edge.arrow.right)}
                fill={edgeColor}
              />
            ),
          )}
        </G>
        <G>
          {scene.edges.map((edge) =>
            edge.weight === undefined ? null : (
              <G key={edge.id}>
                <Rect
                  testID={`weight-box-${edge.id}`}
                  x={edge.weight.anchor.x - edge.weight.width / 2}
                  y={edge.weight.anchor.y - edge.weight.height / 2}
                  width={edge.weight.width}
                  height={edge.weight.height}
                  rx={WEIGHT_BOX_RADIUS}
                  fill={colors.surface}
                  stroke={colors.border}
                  strokeWidth={1}
                />
                <SvgText
                  testID={`weight-text-${edge.id}`}
                  x={edge.weight.anchor.x}
                  y={edge.weight.anchor.y + labelFontSize * BASELINE_OFFSET}
                  fontSize={labelFontSize}
                  textAnchor="middle"
                  fill={colors.text}>
                  {edge.weight.text}
                </SvgText>
              </G>
            ),
          )}
        </G>
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
        <G>
          {scene.vertices.map((vertex) => (
            <Circle
              key={vertex.id}
              testID={`vertex-circle-${vertex.id}`}
              cx={vertex.center.x}
              cy={vertex.center.y}
              r={vertex.radius}
              fill={colors.primaryMuted}
              stroke={colors.primary}
              strokeWidth={vertex.id === highlighted?.id ? SOURCE_VERTEX_STROKE_WIDTH : VERTEX_STROKE_WIDTH}
            />
          ))}
        </G>
        <G>
          {scene.vertices.map((vertex) => (
            <SvgText
              key={vertex.id}
              testID={`vertex-label-${vertex.id}`}
              x={vertex.center.x}
              y={vertex.center.y + labelFontSize * BASELINE_OFFSET}
              fontSize={labelFontSize}
              fontWeight="600"
              textAnchor="middle"
              fill={colors.text}>
              {vertex.displayLabel}
            </SvgText>
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { overflow: 'hidden' },
});
