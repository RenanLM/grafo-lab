import { StyleSheet, View } from 'react-native';

import { layoutGlyph } from '@/components/graph-glyph-layout';
import { useTheme } from '@/theme';

type Props = { size?: number };

/** Ilustração decorativa (o mesmo grafo do ícone do app), desenhada só com Views. */
export function GraphGlyph({ size = 120 }: Props) {
  const { colors } = useTheme();
  const { nodes, edges, nodeRadius, edgeThickness } = layoutGlyph(size);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}>
      {edges.map((edge, i) => (
        <View
          key={`e${i}`}
          style={[
            styles.absolute,
            {
              left: edge.cx - edge.length / 2,
              top: edge.cy - edgeThickness / 2,
              width: edge.length,
              height: edgeThickness,
              borderRadius: edgeThickness / 2,
              backgroundColor: colors.primary,
              transform: [{ rotate: `${edge.angle}rad` }],
            },
          ]}
        />
      ))}
      {nodes.map((node, i) => (
        <View
          key={`n${i}`}
          style={[
            styles.absolute,
            {
              left: node.x - nodeRadius,
              top: node.y - nodeRadius,
              width: nodeRadius * 2,
              height: nodeRadius * 2,
              borderRadius: nodeRadius,
              backgroundColor: colors.primary,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
});
