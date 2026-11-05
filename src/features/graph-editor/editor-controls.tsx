import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { ToolButton } from '@/components/tool-button';
import { spacing, typography } from '@/theme';

import {
  connectStatusMessage,
  describeProperties,
  propertiesGenitive,
  propertiesNoun,
  selectionStatusMessage,
  type EditorMode,
  type EditorSelection,
} from './core';
import {
  selectCanRedo,
  selectCanUndo,
  selectConnectNotice,
  selectConnectSource,
  selectError,
  selectGraph,
  selectMode,
  selectSelection,
  selectVertexCount,
} from './editor-store';
import { useEditorStore } from './editor-store-provider';

// Controles do editor (Fase 3, incrementos 3.6 a 3.8): a barra de modos, as linhas de estado dos modos Conectar e Selecionar e a de desfazer e
// refazer. SÓ despacham ações do núcleo (`set-mode`, `undo`, `redo`) ou chamam a store (`cancelConnection`): nenhuma regra, nenhum
// histórico próprio. Trocar de modo e desfazer/refazer não mexem na câmera (que nem está na store). Assinam só a fatia de que precisam.
//
// Estados: o modo ativo leva "✓" e `selected`; o desabilitado leva contorno tracejado, a legenda do motivo e `disabled`, e NÃO responde
// ao toque. Conectar só pode ser ESCOLHIDO com pelo menos dois vértices (com menos, não há o que ligar: fica desabilitado, com a legenda
// "2+ vértices" e a dica completa, "Adicione pelo menos dois vértices", para quem usa leitor de tela); se o modo já está ativo (por exemplo, depois de desfazer vértices), o
// botão continua habilitado e ativo, e nada deixa de funcionar. Desfazer e Refazer ficam desabilitados quando não há o que desfazer
// ou refazer.
//
// A linha de estado (`ConnectStatus`) existe só no modo Conectar, logo ABAIXO do canvas e com altura mínima de 51 dp (a do botão Cancelar): o que
// aparece ou some ali nunca desloca o canvas (que vem antes dela), e o botão Cancelar, que cabe nessa altura, não muda a linha. O texto é uma
// região viva (`polite`) para os leitores de tela anunciarem a origem, a criação e a recusa; isso NÃO foi validado com TalkBack.

type ModeItem = {
  readonly mode: EditorMode;
  readonly label: string;
  /** Vértices necessários para ESCOLHER o modo (o modo já ativo nunca é bloqueado). */
  readonly minVertices: number;
  readonly hint: string;
  readonly blockedHint?: string;
  readonly blockedCaption?: string;
};

const MODES: readonly ModeItem[] = [
  {
    mode: 'select',
    label: 'Selecionar',
    minVertices: 0,
    hint: 'Toque em um vértice ou em uma aresta para selecioná-lo e em um espaço vazio para limpar a seleção',
  },
  { mode: 'add-vertex', label: 'Adicionar vértice', minVertices: 0, hint: 'Toque no espaço vazio do quadro para criar um vértice' },
  {
    mode: 'connect',
    label: 'Conectar',
    minVertices: 2,
    hint: 'Toque em um vértice para escolher a origem e em outro para escolher o destino',
    blockedHint: 'Adicione pelo menos dois vértices para poder conectar',
    blockedCaption: '2+ vértices', // curta: precisa caber em UMA linha no botão (ver MODE_BAR_MIN_HEIGHT)
  },
];

export function ModeBar() {
  const mode = useEditorStore(selectMode);
  const vertexCount = useEditorStore(selectVertexCount);
  const dispatch = useEditorStore((state) => state.dispatch);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Modo de edição" style={[styles.row, styles.modeRow]}>
      {MODES.map((item) => {
        const blocked = vertexCount < item.minVertices && mode !== item.mode;
        return (
          <ToolButton
            key={item.mode}
            testID={`mode-${item.mode}`}
            accessibilityRole="radio"
            label={item.label}
            accessibilityHint={blocked ? item.blockedHint : item.hint}
            selected={mode === item.mode}
            disabled={blocked}
            caption={blocked ? item.blockedCaption : undefined}
            onPress={() => {
              dispatch({ type: 'set-mode', mode: item.mode });
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Estado do modo Conectar: a instrução ("Origem: A. Toque no vértice de destino."), o aviso do último toque (aresta criada, recusada
 * ou cancelada) e o botão Cancelar enquanto há origem pendente. Não aparece fora do modo Conectar.
 */
export function ConnectStatus() {
  const mode = useEditorStore(selectMode);
  const graph = useEditorStore(selectGraph);
  const error = useEditorStore(selectError);
  const source = useEditorStore(selectConnectSource);
  const notice = useEditorStore(selectConnectNotice);
  const cancelConnection = useEditorStore((state) => state.cancelConnection);
  if (mode !== 'connect') return null;
  const message = connectStatusMessage({ mode, graph, error }, source === undefined ? {} : { sourceVertexId: source }, notice);
  return (
    <View testID="connect-status-row" style={styles.statusRow}>
      <Text testID="connect-status" accessibilityLiveRegion="polite" style={styles.statusText}>
        {message}
      </Text>
      {source === undefined ? null : (
        <Button
          label="Cancelar"
          accessibilityHint="Cancela a conexão em andamento, sem criar nenhuma aresta"
          variant="secondary"
          onPress={cancelConnection}
        />
      )}
    </View>
  );
}

/**
 * Estado do modo Selecionar: a frase da seleção ("Vértice A selecionado.", "Aresta entre A e B selecionada. Peso 2,5.") e, havendo seleção, os botões Editar e
 * Excluir, que abrem a folha de propriedades (o pedido é do Laboratório, que é dono da folha). Não aparece fora do modo Selecionar. Fica ABAIXO do canvas e com a
 * altura mínima do botão, como a linha do Conectar: o que aparece ou some ali não desloca o canvas.
 */
export function SelectionStatus({ onEdit, onDelete }: { onEdit: (selection: EditorSelection) => void; onDelete: (selection: EditorSelection) => void }) {
  const mode = useEditorStore(selectMode);
  const graph = useEditorStore(selectGraph);
  const selection = useEditorStore(selectSelection);
  if (mode !== 'select') return null;
  const target = describeProperties(graph, selection);
  return (
    <View testID="selection-status-row" style={styles.statusRow}>
      <Text testID="selection-status" accessibilityLiveRegion="polite" style={styles.statusText}>
        {selectionStatusMessage({ mode, graph, selection })}
      </Text>
      {target === undefined ? null : (
        <>
          <Button
            label="Editar"
            variant="secondary"
            accessibilityLabel={`Editar propriedades ${propertiesGenitive(target)}`}
            accessibilityHint="Abre a folha de propriedades"
            onPress={() => {
              onEdit(selection);
            }}
          />
          <Button
            label="Excluir"
            variant="secondary"
            accessibilityLabel={`Excluir ${propertiesNoun(target)}`}
            accessibilityHint="Pede uma confirmação antes de excluir"
            onPress={() => {
              onDelete(selection);
            }}
          />
        </>
      )}
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

// Altura da barra de modos: a de um botão de DUAS linhas (rótulo e rótulo, ou rótulo e legenda): 2 × 24 de linha, 2 × 8 de enchimento e
// 2 × 1,5 de borda. É piso FIXO: a legenda do Conectar aparece e some quando o segundo vértice é criado, e a barra, que fica ACIMA do
// canvas, não pode mudar de altura nesse toque (deslocaria o canvas e o vértice criado ficaria longe do dedo).
const MODE_BAR_MIN_HEIGHT = typography.label.lineHeight * 2 + spacing.sm * 2 + 3;

// Altura da linha de estado: a do botão Cancelar (variante `secondary`: linha de 24, enchimento de 12 em cima e embaixo e borda de 1,5).
// Com esse piso a linha NÃO cresce quando o Cancelar aparece, e o que vem depois do canvas (selo, resumo, Desfazer) não se mexe.
const STATUS_ROW_MIN_HEIGHT = typography.label.lineHeight + spacing.md * 2 + 3;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  modeRow: { minHeight: MODE_BAR_MIN_HEIGHT },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: STATUS_ROW_MIN_HEIGHT },
  statusText: { flex: 1 },
});
