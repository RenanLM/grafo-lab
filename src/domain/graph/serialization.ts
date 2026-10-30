import type { Graph } from './types';
import { weightField } from './weight';

// Serialização canônica de um `Graph` em JSON (formato de persistência, esquema v1).
//
// Documento v1 — a ordem das chaves é FIXA e é a mesma do tipo `Graph`:
//   {
//     "schemaVersion": 1,            versão do formato (primeiro: quem lê decide antes de ler o resto)
//     "id": "…", "name": "…",        identificação do grafo (quem persiste fornece o id)
//     "directed": false,             orientação, global ao grafo
//     "vertices": [ { "id", "label" }, … ],                       ordem de inserção
//     "edges": [ { "id", "source", "target", "weight"? }, … ],    ordem de inserção
//     "nextVertexSeq": 4, "nextEdgeSeq": 2                        contadores de ids
//   }
//
// Regras do formato:
// - Arrays na ORDEM DE INSERÇÃO do domínio; nada é ordenado alfabeticamente (a ordem é parte do significado: ela
//   desempata os algoritmos).
// - `weight` só aparece se a aresta tem peso. Ausente (sem peso), `0` e negativos são três coisas diferentes e
//   continuam diferentes no texto. Nunca se grava peso 1 para aresta sem peso.
// - Os contadores são gravados COMO ESTÃO no grafo, nunca recalculados pela quantidade de elementos: se `v3` foi
//   removido, `nextVertexSeq` continua em 4, e depois de restaurar o grafo `v3` não é reaproveitado. Vale também
//   para as arestas.
// - Só entra o que pertence ao modelo matemático: posição dos vértices, seleção, câmera e qualquer estado de
//   interface ficam de fora (cada uma dessas coisas terá seu próprio documento, nas fases do editor). Os campos
//   são copiados por uma lista explícita, então propriedades extras que alguém pendure no objeto são ignoradas.
// - O texto é Unicode (UTF-16 do JavaScript): rótulos como "Königsberg" ou "日本語" saem sem escape; só o que o JSON
//   exige (aspas, barra invertida, caracteres de controle e substitutos soltos) é escapado. A codificação em bytes
//   (UTF-8) é responsabilidade de quem grava o arquivo.
//
// Pré-condição: `graph` é uma instância VÁLIDA de `Graph`. Esta função NÃO valida nem corrige: um `Graph`
// adulterado fora do domínio é serializado como está (inclusive `schemaVersion` estranha, contadores menores que
// os ids ou ids repetidos), e `NaN`/`Infinity` viram `null` (o JSON não os representa). Documentos assim são
// rejeitados na fronteira de validação de dados externos (`parseGraph`, Incremento 4.2); a serialização nunca
// "conserta" dados em silêncio.
//
// Versionamento: `schemaVersion` identifica o LAYOUT do documento. Qualquer mudança de propriedades (por exemplo
// uma `capacity` por aresta, na Fase 12) exige uma versão nova e um leitor explícito para a versão antiga; um
// leitor v1 rejeita versões e campos desconhecidos em vez de ignorá-los, e um documento v1 nunca é relido como v2
// sem uma migração que diga qual é o significado do campo novo (por exemplo, "sem capacity definida"; nunca 1 nem
// infinito). Os arquivos de referência de cada versão ficam em `golden/v<n>/` e não são editados depois de criados.
//
// Complexidade (V vértices, E arestas, L = total de caracteres dos textos: ids, rótulos, extremos e dígitos):
// - Tempo: Θ(V + E + L). Montar o documento custa O(1) por vértice e por aresta (as strings são reaproveitadas por
//   referência, sem cópia); o `JSON.stringify` lê cada caractere uma vez (escape) e escreve cada um uma vez.
// - L não é constante por elemento: os ids `v<n>`/`e<n>` têm Θ(log n) caracteres, um rótulo criado pelo domínio
//   tem até 64 pontos de código (até 128 unidades UTF-16) e um peso ocupa algumas dezenas de caracteres. Para grafos
//   criados pelo domínio, L = O(128·V + (V + E)·log(V + E)).
// - Tamanho do texto compacto (fórmula exata, conferida contra o texto real em medição): cabeçalho de
//   113 + |id| + |name| caracteres (menos 1 se orientado; mais 1 por dígito além do primeiro de cada contador);
//   20 + |id| + |label| por vértice; 33 + |id| + |source| + |target| por aresta (mais 10 + |dígitos| se houver peso);
//   mais uma vírgula entre elementos do mesmo array. |label| conta os caracteres já escapados. O modo `pretty`
//   soma Θ(V + E) caracteres de espaço em branco.
// - Espaço: Θ(V + E) transitório (objetos e arrays do documento) mais Θ(tamanho do texto) para a string devolvida.
//   O documento intermediário é necessário para fixar a ordem das chaves e a lista de campos independentemente do
//   objeto recebido. Um escritor de texto direto evitaria esses objetos, mas duplicaria o escape e a formatação do
//   JSON e, medido em Node, foi 2× a 3× mais lento que `JSON.stringify` sobre o documento (ver ARCHITECTURE.md).

export type SerializeOptions = {
  /**
   * `true` → recuo de 2 espaços e uma propriedade por linha. Muda SOMENTE a formatação: os dados, a ordem das
   * chaves e a ordem dos arrays são idênticos aos do modo compacto (o padrão).
   */
  readonly pretty?: boolean;
};

const PRETTY_INDENT = 2;

export function serializeGraph(graph: Graph, options: SerializeOptions = {}): string {
  const document = {
    schemaVersion: graph.schemaVersion,
    id: graph.id,
    name: graph.name,
    directed: graph.directed,
    vertices: graph.vertices.map((vertex) => ({ id: vertex.id, label: vertex.label })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...weightField(edge),
    })),
    nextVertexSeq: graph.nextVertexSeq,
    nextEdgeSeq: graph.nextEdgeSeq,
  };
  return JSON.stringify(document, null, options.pretty ? PRETTY_INDENT : undefined);
}
