import { StyleSheet, View } from 'react-native';

import { ToolButton } from '@/components/tool-button';
import { spacing } from '@/theme';

import type { EditorMode } from './core';
import { selectCanRedo, selectCanUndo, selectMode } from './editor-store';
import { useEditorStore } from './editor-store-provider';

// Controles do editor (Fase 3, incremento 3.6): a barra de modos e a de desfazer e refazer. SÓ despacham ações do núcleo
// (`set-mode`, `undo`, `redo`) pela store da sessão: nenhuma regra, nenhum histórico próprio. Trocar de modo e desfazer/refazer não
// mexem na câmera (que nem está na store). Assinam só a fatia de que precisam.
//
// Estados: o modo ativo leva "✓" e `selected`; o desabilitado (Conectar, até o incremento 3.7) leva contorno tracejado, a legenda
// "em breve" e `disabled`, e NÃO responde ao toque; Desfazer e Refazer ficam desabilitados quando não há o que desfazer ou refazer.

const MODES: readonly { mode: EditorMode; label: string; enabled: boolean; hint: string }[] = [
  { mode: 'select', label: 'Selecionar', enabled: true, hint: 'Por enquanto, tocar no quadro não seleciona nada' },
  { mode: 'add-vertex', label: 'Adicionar vértice', enabled: true, hint: 'Toque no espaço vazio do quadro para criar um vértice' },
  { mode: 'connect', label: 'Conectar', enabled: false, hint: 'Ainda não está disponível' },
];

export function ModeBar() {
  const mode = useEditorStore(selectMode);
  const dispatch = useEditorStore((state) => state.dispatch);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Modo de edição" style={styles.row}>
      {MODES.map((item) => (
        <ToolButton
          key={item.mode}
          testID={`mode-${item.mode}`}
          accessibilityRole="radio"
          label={item.label}
          accessibilityHint={item.hint}
          selected={item.enabled && mode === item.mode}
          disabled={!item.enabled}
          caption={item.enabled ? undefined : 'em breve'}
          onPress={() => {
            dispatch({ type: 'set-mode', mode: item.mode });
          }}
        />
      ))}
    </View>
  );
}

export function HistoryBar() {
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const dispatch = useEditorStore((state) => state.dispatch);
  return (
    <View style={styles.row}>
      <ToolButton
        testID="history-undo"
        label="Desfazer"
        accessibilityHint="Desfaz a última alteração do grafo"
        disabled={!canUndo}
        onPress={() => {
          dispatch({ type: 'undo' });
        }}
      />
      <ToolButton
        testID="history-redo"
        label="Refazer"
        accessibilityHint="Refaz a alteração desfeita"
        disabled={!canRedo}
        onPress={() => {
          dispatch({ type: 'redo' });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
});
