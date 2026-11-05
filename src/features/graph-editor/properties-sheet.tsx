import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { minTouchTarget, radius, spacing, typography, useTheme } from '@/theme';

import {
  confirmedDeletionAction,
  deletionMessage,
  describeDeletion,
  describeProperties,
  editorErrorMessage,
  formatWeightForInput,
  labelSaveAction,
  propertiesDraft,
  propertiesGenitive,
  propertiesNoun,
  propertiesTitle,
  weightSaveAction,
  type EditorSelection,
  type EditorTransition,
  type PropertiesTarget,
} from './core';
import { selectGraph } from './editor-store';
import { useEditorStore, useEditorStoreApi } from './editor-store-provider';

// Folha de propriedades e confirmação de exclusão (Fase 3, incremento 3.8). É um `Modal` nativo do React Native apresentado como folha
// inferior; nenhuma biblioteca de modal ou de bottom sheet foi instalada. Como o `Modal` é uma janela própria, ela fica POR CIMA do
// Laboratório: abrir, fechar, o teclado e as mensagens de erro de dentro dela nunca mudam o layout nem a câmera do canvas, e nenhum toque
// chega ao canvas enquanto ela está aberta. O botão Voltar do Android fecha a folha (`onRequestClose`), descartando o rascunho.
//
// Duas visões no mesmo `Modal` (dois `Modal` empilhados são frágeis no Android): EDITAR (rótulo do vértice ou peso da aresta) e EXCLUIR (a
// pergunta de confirmação, separada da edição). A folha só desenha e chama o núcleo: não valida rótulo nem peso (o `set-label` e o
// `set-weight` do domínio são a validação definitiva), não conta arestas e não exclui por conta própria.
//
// Rascunho: o campo começa com o valor do elemento e o aluno edita só o TEXTO; nada vai ao grafo enquanto digita. Salvar monta UMA ação:
// se o núcleo a aceita (ou se ela não tem efeito, como salvar o mesmo valor), a folha fecha; se recusa, fica aberta com a mensagem em português.
// Cancelar e Voltar descartam o rascunho sem tocar no grafo nem no histórico. A folha é montada de novo a cada abertura, então um
// rascunho nunca é reaproveitado por outro elemento. O campo de peso vazio REMOVE o peso; o `0` é um peso.
//
// Acessibilidade: cada controle tem rótulo em português ("Salvar alterações", "Cancelar edição", "Excluir vértice A"); a mensagem de erro é um
// alerta; `accessibilityViewIsModal` evita que o foco de leitor de tela vá para o que está atrás (no iOS; no Android a janela do `Modal` já
// isola). A experiência com TalkBack e VoiceOver NÃO foi validada.
//
// ONDE a folha é montada importa (defeito achado no emulador): ela NÃO pode ser descendente do `ScrollView` da tela. O responder de toques do
// React Native segue a ÁRVORE DO REACT, não a das janelas: um `Modal` dentro de um `ScrollView` ainda é filho dele. O `ScrollView` da tela tem
// `keyboardShouldPersistTaps` no padrão (`never`), e com um campo focado ele CAPTURA todo toque fora do campo: o botão nunca recebia o toque
// (nem `pressIn`), e o campo perdia o foco ao soltar. Resultado: o primeiro toque em Salvar só fechava o teclado, e o botão ainda saltava ~800 px
// para baixo. O Laboratório monta a folha ao lado da `Screen`, não dentro dela.

// Altura máxima da folha: 90% da JANELA, em número. NÃO usar `maxHeight: '90%'`: o pai da folha tem altura automática (é a própria folha), e o Yoga
// resolve a porcentagem contra o conteúdo, então a folha ficava em 90% do seu próprio tamanho e o ScrollView cortava o último botão (medido no
// emulador: 743 px de 826). Com a altura da janela a folha cresce até o conteúdo caber e só então passa a rolar.
const MAX_SHEET_HEIGHT_RATIO = 0.9;

export type SheetRequest = {
  /** `edit`: propriedades; `delete`: já abre na pergunta de confirmação. */
  readonly view: 'edit' | 'delete';
  /** O elemento (vértice ou aresta), por id técnico. */
  readonly selection: EditorSelection;
};

type Props = {
  /** `undefined` = fechada. */
  readonly request: SheetRequest | undefined;
  readonly onClose: () => void;
};

/** A folha aberta para `request`; sem pedido, ou se o elemento não existe (mais), não desenha nada. */
export function PropertiesSheet({ request, onClose }: Props) {
  const graph = useEditorStore(selectGraph);
  const target = request === undefined ? undefined : describeProperties(graph, request.selection);
  if (request === undefined || target === undefined) return null;
  return (
    <Modal testID="properties-sheet" visible transparent animationType="slide" onRequestClose={onClose}>
      {/* `key` pelo elemento: se o pedido passar a outro elemento, o rascunho recomeça (nunca se reaplica o de outro) */}
      <SheetBody
        key={target.kind === 'vertex' ? `vertex:${target.vertexId}:${request.view}` : `edge:${target.edgeId}:${request.view}`}
        target={target}
        initialView={request.view}
        onClose={onClose}
      />
    </Modal>
  );
}

function SheetBody({ target, initialView, onClose }: { target: PropertiesTarget; initialView: 'edit' | 'delete'; onClose: () => void }) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const store = useEditorStoreApi();
  const graph = useEditorStore(selectGraph);
  const [view, setView] = useState(initialView);
  const [draft, setDraft] = useState(() => propertiesDraft(target));
  const [error, setError] = useState<string | undefined>(undefined);

  const isVertex = target.kind === 'vertex';
  const title = propertiesTitle(target);
  const selection: EditorSelection = isVertex ? { type: 'vertex', vertexId: target.vertexId } : { type: 'edge', edgeId: target.edgeId };
  const summary = describeDeletion(graph, selection);
  const noun = propertiesNoun(target);
  const genitive = propertiesGenitive(target);

  const finish = (transition: EditorTransition): void => {
    if (transition.error !== undefined) setError(editorErrorMessage(transition.error));
    else onClose();
  };

  const save = (): void => {
    const { dispatch } = store.getState();
    if (target.kind === 'vertex') {
      finish(dispatch(labelSaveAction(target.vertexId, draft)));
      return;
    }
    const saved = weightSaveAction(target.edgeId, draft);
    if (!saved.ok) {
      setError(saved.message);
      return;
    }
    finish(dispatch(saved.action));
  };

  const confirmDelete = (): void => {
    if (summary === undefined) return;
    const { editor, dispatch } = store.getState();
    const action = confirmedDeletionAction(editor, summary);
    if (action === undefined) {
      setError('A seleção mudou: nada foi excluído.');
      return;
    }
    finish(dispatch(action));
  };

  return (
    <View testID="properties-sheet-root" style={styles.root} accessibilityViewIsModal>
      <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: colors.background }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoiding}>
        <SafeAreaView
          testID="properties-sheet-body"
          edges={['bottom', 'left', 'right']}
          style={[styles.sheet, { maxHeight: windowHeight * MAX_SHEET_HEIGHT_RATIO, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text variant="heading">{view === 'delete' ? `Excluir: ${title}` : title}</Text>
            <Facts target={target} />

            {view === 'edit' ? (
              <>
                <View style={styles.field}>
                  <Text variant="label">{isVertex ? 'Rótulo' : 'Peso'}</Text>
                  <TextInput
                    testID="sheet-input"
                    value={draft}
                    onChangeText={(text) => {
                      setDraft(text);
                      setError(undefined);
                    }}
                    onSubmitEditing={save}
                    accessibilityLabel={isVertex ? `Rótulo ${genitive}` : `Peso ${genitive}`}
                    accessibilityHint={isVertex ? 'Digite o novo rótulo e toque em Salvar' : 'Digite um número, ou deixe vazio para remover o peso'}
                    placeholder={isVertex ? 'Rótulo do vértice' : 'Vazio = sem peso'}
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    selectTextOnFocus
                    style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: error === undefined ? colors.border : colors.primary }]}
                  />
                  {isVertex ? null : (
                    <Text color="textSecondary">
                      {draft.trim() === ''
                        ? 'Campo vazio: a aresta fica sem peso. O peso 0 é um peso, diferente de nenhum.'
                        : 'Use vírgula ou ponto para decimais. Pesos negativos e o 0 são permitidos.'}
                    </Text>
                  )}
                  {isVertex || draft.trim() === '' ? null : (
                    <Button
                      variant="secondary"
                      label="Remover peso"
                      accessibilityHint="Esvazia o campo: ao salvar, a aresta fica sem peso"
                      onPress={() => {
                        setDraft('');
                        setError(undefined);
                      }}
                    />
                  )}
                </View>
                {error === undefined ? null : (
                  <Text accessibilityRole="alert" testID="sheet-error">
                    {error}
                  </Text>
                )}
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button variant="secondary" label="Cancelar" accessibilityLabel="Cancelar edição" onPress={onClose} />
                  </View>
                  <View style={styles.action}>
                    <Button label="Salvar" accessibilityLabel="Salvar alterações" onPress={save} />
                  </View>
                </View>
                <Button
                  variant="secondary"
                  label="Excluir"
                  accessibilityLabel={`Excluir ${noun}`}
                  accessibilityHint="Pede uma confirmação antes de excluir"
                  onPress={() => {
                    setError(undefined);
                    setView('delete');
                  }}
                />
              </>
            ) : (
              <>
                <Text testID="sheet-delete-message">{summary === undefined ? 'Esse elemento não existe mais.' : deletionMessage(summary)}</Text>
                {error === undefined ? null : (
                  <Text accessibilityRole="alert" testID="sheet-error">
                    {error}
                  </Text>
                )}
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button variant="secondary" label="Cancelar" accessibilityLabel="Cancelar exclusão" onPress={onClose} />
                  </View>
                  <View style={styles.action}>
                    <Button label="Excluir" accessibilityLabel={`Confirmar a exclusão ${genitive}`} onPress={confirmDelete} />
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** O que o aluno não edita: o identificador técnico e, na aresta, a origem, o destino, a orientação e o peso atual. */
function Facts({ target }: { target: PropertiesTarget }) {
  if (target.kind === 'vertex') {
    return <Text color="textSecondary">{`Identificador: ${target.vertexId}`}</Text>;
  }
  const weight = target.weight === undefined ? 'sem peso' : formatWeightForInput(target.weight);
  return (
    <View style={styles.facts}>
      <Text color="textSecondary">{`Identificador: ${target.edgeId}`}</Text>
      <Text color="textSecondary">{`Origem: ${target.sourceLabel}. Destino: ${target.targetLabel}.`}</Text>
      <Text color="textSecondary">{target.directed ? 'Aresta orientada (o sentido importa).' : 'Aresta não orientada.'}</Text>
      <Text color="textSecondary">{`Peso atual: ${weight}.`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Véu sobre o Laboratório. Cor só de token do tema (o fundo), esmaecida: escurece no tema escuro e clareia no claro.
  scrim: { opacity: 0.8 },
  avoiding: { width: '100%' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  facts: { gap: spacing.xs },
  field: { gap: spacing.sm },
  input: {
    minHeight: minTouchTarget,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body.fontSize,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
