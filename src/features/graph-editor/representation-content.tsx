import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text as RNText, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { radius, spacing, typography, useTheme } from '@/theme';

import {
  REPRESENTATION_LIMITS,
  REPRESENTATION_TITLES,
  listLines,
  nextVisibleLines,
  pageLines,
  type AdjacencyListView,
  type AdjacencyMatrixView,
  type IncidenceListView,
  type IncidenceMatrixView,
  type LegendEntry,
  type RepresentationKind,
  type RepresentationView,
} from './core';

// O conteúdo de cada uma das quatro representações (Fase 3, incremento 3.11). Só DESENHA o modelo de apresentação que o adaptador puro (`core/representation-view.ts`) já montou: não
// calcula nenhuma representação, não lê a store nem o grafo, não tem estado matemático. Os textos, as legendas e as descrições faladas vêm prontos do modelo, então aqui só há layout.
//
// Ordem nas matrizes: a legenda curta, o tamanho, a TABELA e só depois as notas explicativas (a nota longa, antes, empurrava a tabela para baixo da dobra); o canto da tabela já diz o que é linha e coluna.
// Tabelas. As matrizes são feitas de `View`s com largura fixa por coluna (células alinhadas e de mesma largura). A coluna dos cabeçalhos das linhas fica CONGELADA à esquerda e o resto rola num
// `ScrollView` HORIZONTAL aninhado na página (a página rola na vertical e a tabela na horizontal; sem a coluna congelada o aluno perdia de vista de qual vértice era cada linha, visto no Android), e como a tabela NÃO está dentro do detector de gestos do canvas, nenhum gesto do quadro a alcança. Não há rolagem vertical própria (uma dentro da outra brigaria com
// a da página); as matrizes têm no máximo 400 células. Um rótulo longo é cortado com reticências NA TELA (uma linha), mas o texto falado de cada cabeçalho e de cada célula é completo, e o id
// técnico de cada vértice aparece sempre numa linha própria, então rótulos repetidos se distinguem.
//
// Acessibilidade inicial: cada célula é UM elemento com a descrição completa (linha, coluna, aresta e peso), e cada cabeçalho diz se é linha ou coluna; o estado não depende só de cor
// (o valor, o sinal e o símbolo carregam o significado). Não foi validado com TalkBack; a avaliação mais ampla é do incremento 3.12.

const ROW_HEADER_WIDTH = 92;
const ADJACENCY_CELL_WIDTH = 56;
const INCIDENCE_CELL_WIDTH = 64;
const HEADER_HEIGHT = 56;
const CELL_HEIGHT = 48;

type ContentProps = {
  readonly view: RepresentationView;
  /** O aluno pediu outra representação (a sugestão de lista de uma matriz grande demais). */
  readonly onSelectKind?: (kind: RepresentationKind) => void;
};

export function RepresentationContent({ view, onSelectKind }: ContentProps) {
  if (view.status === 'empty') return <Notice testID="representation-notice" message={view.message} />;
  if (view.kind === 'incidence-matrix' && view.status === 'no-edges') return <Notice testID="representation-notice" message={view.message} />;
  if (view.status === 'too-large') return <TooLargeNotice view={view} onSelectKind={onSelectKind} />;
  switch (view.kind) {
    case 'adjacency-list':
    case 'incidence-list':
      // `key`: outra lista (ou outro grafo) recomeça na primeira página
      return <ListContent key={view.kind} view={view} />;
    case 'adjacency-matrix':
      return <AdjacencyMatrixContent view={view} />;
    case 'incidence-matrix':
      return <IncidenceMatrixContent view={view} />;
  }
}

function Notice({ message, testID }: { readonly message: string; readonly testID: string }) {
  return (
    <Text testID={testID} color="textSecondary">
      {message}
    </Text>
  );
}

function TooLargeNotice({ view, onSelectKind }: { readonly view: Extract<AdjacencyMatrixView | IncidenceMatrixView, { status: 'too-large' }>; readonly onSelectKind?: (kind: RepresentationKind) => void }) {
  const title = REPRESENTATION_TITLES[view.suggestedKind];
  return (
    <View testID="representation-too-large" style={styles.stack}>
      <Text accessibilityRole="alert">{view.message}</Text>
      <Text color="textSecondary">{view.detail}</Text>
      <Text color="textSecondary">{view.suggestion}</Text>
      {onSelectKind === undefined ? null : (
        <Button
          variant="secondary"
          label={`Abrir a ${title.toLowerCase()}`}
          onPress={() => {
            onSelectKind(view.suggestedKind);
          }}
        />
      )}
    </View>
  );
}

// --- Listas ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

type ReadyList = Extract<AdjacencyListView | IncidenceListView, { status: 'ready' }>;

function ListContent({ view }: { readonly view: ReadyList }) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState<number>(REPRESENTATION_LIMITS.listPageLines);
  const lines = listLines(view);
  const { shown, hidden } = pageLines(lines, visible);
  return (
    <View style={styles.stack}>
      <Notes notes={view.notes} />
      <View testID="representation-list" style={styles.list}>
        {shown.map((line) => (
          <View
            key={line.key}
            testID={`list-line-${line.key}`}
            accessible
            accessibilityLabel={line.description}
            style={line.kind === 'vertex' ? [styles.vertexLine, { borderTopColor: colors.border }] : styles.entryLine}>
            <RNText
              style={[
                line.kind === 'vertex' ? typography.label : typography.body,
                { color: line.kind === 'empty' ? colors.textSecondary : colors.text },
              ]}>
              {line.text}
            </RNText>
          </View>
        ))}
      </View>
      {hidden > 0 ? (
        <View style={styles.stack}>
          <Text testID="representation-list-more" color="textSecondary" accessibilityLiveRegion="polite">
            {`Mostrando ${shown.length} de ${lines.length} linhas; ${hidden} ${hidden === 1 ? 'linha não está' : 'linhas não estão'} sendo exibidas.`}
          </Text>
          <Button
            variant="secondary"
            label="Mostrar mais"
            accessibilityHint={`Mostra mais ${Math.min(hidden, REPRESENTATION_LIMITS.listPageLines)} linhas da lista`}
            onPress={() => {
              setVisible((current) => nextVisibleLines(current, lines.length));
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

// --- Matrizes -------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function Notes({ notes }: { readonly notes: readonly string[] }) {
  return (
    <View style={styles.notes}>
      {notes.map((note) => (
        <Text key={note} variant="caption" color="textSecondary">
          {note}
        </Text>
      ))}
    </View>
  );
}

function Legend({ entries }: { readonly entries: readonly LegendEntry[] }) {
  const { colors } = useTheme();
  return (
    <View testID="representation-legend" style={styles.legend}>
      <Text variant="label">Legenda</Text>
      {entries.map((entry) => (
        <View key={entry.symbol} accessible accessibilityLabel={`${entry.spoken}: ${entry.meaning}`} style={styles.legendRow}>
          <View style={[styles.legendSymbol, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
            <RNText style={[typography.label, { color: colors.text }]}>{entry.symbol}</RNText>
          </View>
          <Text color="textSecondary" style={styles.legendMeaning}>
            {`= ${entry.meaning}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

type CellProps = {
  readonly width: number;
  readonly height: number;
  readonly header?: boolean;
  readonly label?: string;
  readonly testID?: string;
  readonly children: ReactNode;
};

/** Uma célula da tabela: largura fixa e o texto centralizado. Com `label` ela é UM elemento acessível; sem `label`, fica fora da leitura (o canto da tabela). */
function Cell({ width, height, header = false, label, testID, children }: CellProps) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'auto'}
      style={[styles.cell, { width, height, backgroundColor: header ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

/** Os dois cabeçalhos de um vértice: o rótulo (uma linha, com reticências na tela) e o id técnico, que aparece sempre. */
function VertexHeader({ label, id }: { readonly label: string; readonly id: string }) {
  const { colors } = useTheme();
  return (
    <>
      <RNText numberOfLines={1} style={[typography.label, styles.headerText, { color: colors.text }]}>
        {label}
      </RNText>
      <RNText style={[typography.caption, { color: colors.textSecondary }]}>{id}</RNText>
    </>
  );
}

type FrozenTableProps = {
  /** O canto: o que é linha e o que é coluna. */
  readonly corner: ReactNode;
  /** Os cabeçalhos das LINHAS: ficam FIXOS à esquerda enquanto as colunas rolam. */
  readonly rowHeaders: ReactNode;
  /** A linha de cabeçalhos das COLUNAS e as linhas de células: rolam na horizontal. */
  readonly columns: ReactNode;
};

/**
 * A moldura das duas matrizes: a primeira coluna (o canto e os cabeçalhos das linhas) fica FORA do `ScrollView` horizontal, então ao rolar para as colunas da direita o aluno nunca perde de vista de qual
 * vértice é cada linha. Os dois lados usam as MESMAS alturas fixas (`HEADER_HEIGHT` e `CELL_HEIGHT`), então as linhas se alinham sem medir nada.
 */
function FrozenTable({ corner, rowHeaders, columns }: FrozenTableProps) {
  return (
    <View testID="representation-table" style={styles.frozen}>
      <View>
        {corner}
        {rowHeaders}
      </View>
      <ScrollView horizontal nestedScrollEnabled testID="representation-scroll" showsHorizontalScrollIndicator style={styles.scroller}>
        <View>{columns}</View>
      </ScrollView>
    </View>
  );
}

function AdjacencyMatrixContent({ view }: { readonly view: Extract<AdjacencyMatrixView, { status: 'ready' }> }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <Legend entries={view.legend} />
      <Text variant="caption" color="textSecondary">{`Tamanho: ${view.size.text}`}</Text>
      <FrozenTable
        corner={
          <Cell width={ROW_HEADER_WIDTH} height={HEADER_HEIGHT} header>
            <RNText style={[typography.caption, { color: colors.textSecondary }]}>{view.directed ? 'origem ↓' : 'linha ↓'}</RNText>
            <RNText style={[typography.caption, { color: colors.textSecondary }]}>{view.directed ? 'destino →' : 'coluna →'}</RNText>
          </Cell>
        }
        rowHeaders={view.rows.map((row) => (
          <Cell key={row.vertex.id} width={ROW_HEADER_WIDTH} height={CELL_HEIGHT} header label={`Linha ${row.vertex.spoken}`} testID={`adjacency-row-${row.vertex.id}`}>
            <VertexHeader label={row.vertex.label} id={row.vertex.id} />
          </Cell>
        ))}
        columns={
          <>
            <View style={styles.tableRow}>
              {view.vertices.map((vertex) => (
                <Cell key={vertex.id} width={ADJACENCY_CELL_WIDTH} height={HEADER_HEIGHT} header label={`Coluna ${vertex.spoken}`} testID={`adjacency-column-${vertex.id}`}>
                  <VertexHeader label={vertex.label} id={vertex.id} />
                </Cell>
              ))}
            </View>
            {view.rows.map((row) => (
              <View key={row.vertex.id} style={styles.tableRow}>
                {row.cells.map((cell, column) => {
                  const columnId = view.vertices[column]!.id;
                  return (
                    <Cell key={columnId} width={ADJACENCY_CELL_WIDTH} height={CELL_HEIGHT} label={cell.description} testID={`adjacency-cell-${row.vertex.id}-${columnId}`}>
                      <RNText style={[typography.label, { color: cell.state === 'absent' ? colors.textSecondary : colors.primary }]}>{cell.text}</RNText>
                    </Cell>
                  );
                })}
              </View>
            ))}
          </>
        }
      />
      <Notes notes={view.notes} />
    </View>
  );
}

function IncidenceMatrixContent({ view }: { readonly view: Extract<IncidenceMatrixView, { status: 'ready' }> }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <Legend entries={view.legend} />
      <Text variant="caption" color="textSecondary">{`Tamanho: ${view.size.text} (vértices × arestas)`}</Text>
      <FrozenTable
        corner={
          <Cell width={ROW_HEADER_WIDTH} height={HEADER_HEIGHT} header>
            <RNText style={[typography.caption, { color: colors.textSecondary }]}>vértice ↓</RNText>
            <RNText style={[typography.caption, { color: colors.textSecondary }]}>aresta →</RNText>
          </Cell>
        }
        rowHeaders={view.rows.map((row) => (
          <Cell key={row.vertex.id} width={ROW_HEADER_WIDTH} height={CELL_HEIGHT} header label={`Linha ${row.vertex.spoken}`} testID={`incidence-row-${row.vertex.id}`}>
            <VertexHeader label={row.vertex.label} id={row.vertex.id} />
          </Cell>
        ))}
        columns={
          <>
            <View style={styles.tableRow}>
              {view.edges.map((edge) => (
                <Cell key={edge.id} width={INCIDENCE_CELL_WIDTH} height={HEADER_HEIGHT} header label={`Coluna aresta ${edge.description}`} testID={`incidence-column-${edge.id}`}>
                  <RNText style={[typography.label, { color: colors.text }]}>{edge.id}</RNText>
                  <RNText numberOfLines={1} style={[typography.caption, styles.headerText, { color: colors.textSecondary }]}>
                    {edge.caption}
                  </RNText>
                </Cell>
              ))}
            </View>
            {view.rows.map((row) => (
              <View key={row.vertex.id} style={styles.tableRow}>
                {row.cells.map((cell, column) => {
                  const edgeId = view.edges[column]!.id;
                  return (
                    <Cell key={edgeId} width={INCIDENCE_CELL_WIDTH} height={CELL_HEIGHT} label={cell.description} testID={`incidence-cell-${row.vertex.id}-${edgeId}`}>
                      <RNText style={[typography.label, { color: cell.value === 0 ? colors.textSecondary : colors.primary }]}>{cell.text}</RNText>
                    </Cell>
                  );
                })}
              </View>
            ))}
          </>
        }
      />
      <View testID="incidence-edges" style={styles.legend}>
        <Text variant="label">Arestas</Text>
        {view.edges.map((edge) => (
          <Text key={edge.id} testID={`incidence-edge-${edge.id}`} color="textSecondary">
            {edge.description}
          </Text>
        ))}
      </View>
      <Notes notes={view.notes} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  notes: { gap: spacing.xs },
  list: { gap: 0 },
  vertexLine: { paddingTop: spacing.sm, paddingBottom: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  entryLine: { paddingLeft: spacing.lg, paddingVertical: spacing.xs },
  legend: { gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendSymbol: { minWidth: 40, alignItems: 'center', borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  legendMeaning: { flex: 1 },
  tableRow: { flexDirection: 'row' },
  frozen: { flexDirection: 'row' },
  scroller: { flex: 1 },
  cell: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.xs },
  headerText: { maxWidth: '100%', textAlign: 'center' },
});
