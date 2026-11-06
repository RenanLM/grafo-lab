import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { ToolButton } from '@/components/tool-button';
import type { Graph } from '@/domain/graph';
import { minTouchTarget, spacing, typography, useTheme } from '@/theme';

import { REPRESENTATION_TITLES, buildRepresentationView, type RepresentationKind } from './core';
import { selectGraph } from './editor-store';
import { useEditorStore } from './editor-store-provider';
import { RepresentationContent } from './representation-content';

// Painel "Representações do grafo" (Fase 3, incremento 3.11): o MESMO grafo do canvas como lista de adjacência, matriz de adjacência, matriz de incidência e lista de incidência. NÃO é modal:
// fica na própria página, abaixo do canvas e dos botões de editar e de desfazer, e o aluno continua editando enquanto consulta (um `Modal` impediria isso). Começa RECOLHIDO; um toque no título
// expande e recolhe. Só UMA representação aparece de cada vez, e a aba escolhida é lembrada (também depois de recolher e expandir de novo, enquanto a tela existir).
//
// O que NÃO há aqui: um segundo estado matemático, cópia do grafo ou cache. O painel recebe o `graph` da sessão do editor e calcula, com `useMemo`, SÓ a representação da aba ativa e SÓ com o painel
// expandido: as dependências do cálculo são a identidade do `graph`, a aba e o expandido, e nada mais. Mover a câmera, ampliar, arrastar um vértice (muda o layout, não o grafo), selecionar e
// trocar de modo não trocam o `graph`, então não recalculam nada; qualquer alteração do grafo (vértice, aresta, peso, rótulo, desfazer, refazer, outro grafo) troca a identidade e o conteúdo
// é refeito na hora. Fechado, o painel não calcula nada. `memo` impede ainda que a tela o percorra de novo a cada gesto.
//
// Layout: o painel vem DEPOIS do que é fixo do editor, então abrir e fechar não desloca o canvas, nem os botões acima dele, nem a câmera (que nem está aqui).

type PanelProps = {
  readonly graph: Graph;
  /** Começa expandido (os testes e a documentação; o padrão da tela é recolhido). */
  readonly initiallyExpanded?: boolean;
  readonly initialKind?: RepresentationKind;
};

export const RepresentationsPanel = memo(function RepresentationsPanel({ graph, initiallyExpanded = false, initialKind = 'adjacency-list' }: PanelProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [kind, setKind] = useState<RepresentationKind>(initialKind);
  // Recolhido, não calcula. Aberto, só a aba ativa. Depende só da identidade do grafo, da aba e do expandido.
  const view = useMemo(() => (expanded ? buildRepresentationView(graph, kind) : undefined), [expanded, graph, kind]);

  return (
    <Card testID="representations-panel">
      <Pressable
        testID="representations-toggle"
        accessibilityRole="button"
        accessibilityLabel="Representações do grafo"
        accessibilityHint={expanded ? 'Toque para recolher o painel' : 'Toque para expandir e ver as quatro representações deste grafo'}
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded((current) => !current);
        }}
        style={styles.header}>
        <Text variant="label" accessibilityElementsHidden importantForAccessibility="no" style={styles.title}>
          Representações do grafo
        </Text>
        <RNText accessibilityElementsHidden importantForAccessibility="no" style={[typography.label, { color: colors.primary }]}>
          {expanded ? '▾' : '▸'}
        </RNText>
      </Pressable>
      {expanded ? (
        <View testID="representations-body" style={styles.body}>
          {/* o grupo NÃO é `accessible` de propósito (isso esconderia as quatro abas dos leitores de tela): o papel é lido pelo rótulo, como na barra de modos */}
          <View accessibilityRole="tablist" accessibilityLabel="Representação mostrada" style={styles.tabs}>
            <View style={styles.tabRow}>
              <Tab kind="adjacency-list" active={kind} onSelect={setKind} />
              <Tab kind="adjacency-matrix" active={kind} onSelect={setKind} />
            </View>
            <View style={styles.tabRow}>
              <Tab kind="incidence-matrix" active={kind} onSelect={setKind} />
              <Tab kind="incidence-list" active={kind} onSelect={setKind} />
            </View>
          </View>
          <View testID="representation-content" style={styles.content}>
            <Text variant="label">{REPRESENTATION_TITLES[kind]}</Text>
            {view === undefined ? null : <RepresentationContent view={view} onSelectKind={setKind} />}
          </View>
        </View>
      ) : null}
    </Card>
  );
});

function Tab({ kind, active, onSelect }: { readonly kind: RepresentationKind; readonly active: RepresentationKind; readonly onSelect: (kind: RepresentationKind) => void }) {
  return (
    <ToolButton
      testID={`representation-tab-${kind}`}
      accessibilityRole="tab"
      label={REPRESENTATION_TITLES[kind]}
      accessibilityHint={`Mostra a ${REPRESENTATION_TITLES[kind].toLowerCase()} deste grafo`}
      selected={kind === active}
      onPress={() => {
        onSelect(kind);
      }}
    />
  );
}

/** O painel ligado à sessão do editor: assina SÓ `graph` (o mesmo da tela e do canvas), nunca o `EditorState` inteiro, a seleção, o layout nem o histórico. */
export function ConnectedRepresentationsPanel() {
  const graph = useEditorStore(selectGraph);
  return <RepresentationsPanel graph={graph} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: minTouchTarget, gap: spacing.sm },
  title: { flex: 1 },
  body: { gap: spacing.md },
  tabs: { gap: spacing.sm },
  tabRow: { flexDirection: 'row', gap: spacing.sm },
  content: { gap: spacing.sm },
});
