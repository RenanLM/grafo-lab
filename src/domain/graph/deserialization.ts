import {
  fail,
  ok,
  type DocumentCause,
  type InvalidDocumentReason,
  type Result,
} from './errors';
import { checkLabel, isValidWeight, normalizeWeight } from './graph';
import { GRAPH_SCHEMA_VERSION, type Edge, type Graph, type Vertex } from './types';

// Leitura de um documento de grafo (esquema v1) vindo de FORA: arquivo, importação, banco, outra versão do app.
// Tudo que chega aqui é não confiável. Esta é a fronteira que garante que um `Graph` restaurado obedece às mesmas
// invariantes de um `Graph` montado pelas operações do domínio (`serialization.ts` descreve o formato).
//
// APIs
// - `parseGraph(input: unknown, options?)`: valida um valor já decodificado (objeto vindo do `JSON.parse`, de um
//   banco, de um teste…).
// - `parseGraphJson(text: string, options?)`: confere o tamanho do texto, decodifica e delega ao `parseGraph`.
// Ambas devolvem `Result<Graph>` e NUNCA lançam exceção: sintaxe inválida, objetos hostis (getters, proxies que
// lançam), texto enorme e opções erradas viram `Result` de erro.
//
// Regras do esquema v1 (qualquer violação recusa o documento INTEIRO; nada é corrigido em silêncio)
// - raiz: objeto simples com exatamente os 8 campos do esquema; `schemaVersion` é 1;
// - `id`, `name`: texto; `directed`: booleano (o domínio não impõe mais nada a eles, nem esta leitura);
// - vértices `{ id, label }`: id canônico `v<n>` (n inteiro positivo seguro, sem zeros à esquerda, sem sinal ou
//   espaços) e único; rótulo já normalizado, isto é, o que `addVertex` aceitaria SEM mexer nele (1 a 64 pontos de
//   código, sem espaço nas pontas). Rótulo que exigiria `trim()` é recusado (`NOT_NORMALIZED`), não corrigido;
// - arestas `{ id, source, target, weight? }`: id canônico `e<n>` e único; `source`/`target` são vértices do
//   documento; sem laço; sem repetição no sentido da orientação (arcos opostos valem em grafo orientado);
//   `weight` ausente = aresta sem peso, número finito = com peso (0 e negativos valem; `-0` vira `0`);
//   `weight: null`, `NaN`, `±Infinity`, texto, `undefined` explícito… são recusados. Ausente e 0 continuam diferentes;
// - `nextVertexSeq`/`nextEdgeSeq`: inteiros seguros, ≥ 1 e MAIORES que o sufixo de todos os ids presentes. São
//   guardados como vieram, nunca recalculados pela quantidade de elementos.
// A ordem dos vértices e das arestas é a do documento (nada é reordenado). Ids em ordem não crescente são aceitos:
// o domínio nunca os produz, mas nenhuma invariante do modelo depende disso.
//
// Ordem das verificações (o primeiro problema encontrado é o erro devolvido; é determinística)
//   1. opções; 2. (JSON) tamanho do texto e sintaxe; 3. raiz é objeto; 4. `schemaVersion` (ausente, tipo, versão);
//   5. campos obrigatórios ausentes (na ordem do esquema) e campos desconhecidos; 6. tipos de `id`, `name`,
//   `directed` e validade dos contadores; 7. forma e limites de `vertices` e `edges` (sem olhar os elementos);
//   8. cada vértice, na ordem; 9. cada aresta, na ordem; 10. contadores contra os ids.
// Dentro de um vértice: tipo do id → id canônico → id único → rótulo. Dentro de uma aresta: tipos de id/source/target
// → id canônico → id único → origem existe → destino existe → não é laço → peso → não repete (a mesma ordem do
// `addEdge`, de propósito: um teste compara o leitor com o domínio).
// A versão vem antes de tudo porque ela decide COMO ler o resto: um documento v2 deve ser recusado como "versão
// não suportada", e não por ter campos que a v1 desconhece.
//
// Erros (`GraphError`)
// - `UNSUPPORTED_SCHEMA_VERSION { version, supported }`.
// - `INVALID_DOCUMENT { path, reason, cause? }`: `path` é a propriedade (`vertices[2].label`, `edges[3].weight`,
//   `nextVertexSeq`; `''` = o documento inteiro); `reason` está em `InvalidDocumentReason`; quando é `DOMAIN_RULE`,
//   `cause` diz qual regra do modelo foi violada (`SELF_LOOP`, `DUPLICATE_EDGE`, `VERTEX_NOT_FOUND`,
//   `INVALID_WEIGHT`, `INVALID_VERTEX_LABEL`). Os erros só têm nomes de campos, índices, códigos e (na aresta
//   repetida) um id canônico já validado: NUNCA texto ou valores do documento, nem referências a objetos da entrada.
//   Por isso um `UNKNOWN_FIELD` aponta o objeto que contém o campo, não o nome do campo.
//
// Segurança
// - Só se leem PROPRIEDADES PRÓPRIAS DE DADOS, por descritor (`Object.getOwnPropertyDescriptor`), cada uma UMA vez, e
//   os valores lidos é que são validados e copiados. Getters/setters nunca são executados (viram `UNREADABLE`), o
//   `[[Get]]` nunca é usado (um proxy só vê `ownKeys`, `getPrototypeOf` e `getOwnPropertyDescriptor`), e uma entrada
//   que muda entre leituras não consegue fazer o resultado divergir do que foi validado. Qualquer exceção durante a
//   inspeção (proxy que lança, proxy revogado) vira `UNREADABLE`.
// - Objetos precisam ser simples: protótipo nulo ou um protótipo-raiz (o `Object.prototype` de qualquer realm).
//   Instâncias de classe, `Map`, `Date`, arrays no lugar de objetos etc. são `NOT_AN_OBJECT`. Propriedades herdadas
//   são ignoradas. Chaves desconhecidas, símbolos e propriedades ocultas fazem o documento ser recusado, o que
//   inclui `__proto__`, `constructor` e `prototype`. O texto JSON `{"__proto__": …}` cria uma propriedade PRÓPRIA
//   com esse nome (não troca o protótipo) e cai na regra acima.
// - O resultado é montado só com valores verificados, em objetos e arrays NOVOS (sem `Object.assign`, spread ou
//   cópia de protótipo): não compartilha nenhum objeto ou array com a entrada, e alterar a entrada depois não muda o
//   grafo. As strings são imutáveis e compartilhadas por referência, o que é seguro.
// - Os arrays nunca são pré-alocados pelo `length` declarado, e `length > limite` é recusado antes de ler qualquer
//   elemento. Um array esparso é recusado no primeiro buraco. `parseGraphJson` confere `maxTextLength` ANTES do
//   `JSON.parse`. O texto longo de um rótulo não vira lista de pontos de código (`checkLabel`).
// - Não há recursão própria: a profundidade de inspeção é fixa (documento → vértice/aresta → campo).
//
// Limites (`ParseGraphOptions`): `maxVertices`, `maxEdges` (contagem de elementos) e `maxTextLength` (em unidades
// UTF-16, isto é, `text.length`, não bytes; só vale para `parseGraphJson`). O domínio NÃO define valores padrão:
// quem importa arquivos (a camada de persistência) escolhe, e a escolha pode depender do aparelho. Cada um é
// `undefined` (sem limite) ou um inteiro seguro ≥ 0; outra coisa é `INVALID_DOCUMENT/INVALID_OPTION` com `path`
// `options.maxVertices` etc. (erro de quem chama, devolvido como valor para manter a regra "nunca lança").
// Único teto técnico, que não é política do app: `MAX_VERTICES` (94 906 265), explicado junto da constante.
//
// Limitações conhecidas (documentadas, não corrigíveis aqui)
// - Contadores: um documento só prova que os contadores são maiores que os ids PRESENTES. Os ids de elementos
//   removidos no passado não existem mais no arquivo, então não há como saber se `nextVertexSeq: 4` com os vértices
//   v1 e v2 é um grafo legítimo em que `v3` foi removido ou um documento adulterado que baixou o contador de 9 para
//   4 (o que faria `v3` ser reemitido). A defesa é de integridade do arquivo (assinatura, banco local), não do formato.
// - Chaves repetidas no texto (`{"id":"a","id":"b"}`): o `JSON.parse` do ECMAScript fica com a ÚLTIMA e o parser não
//   enxerga as outras. O resultado é bem definido e o `serializeGraph` nunca as produz.
// - Um BOM no início do texto não é JSON válido e é recusado (`INVALID_JSON`); retirá-lo, se for o caso, cabe a quem
//   lê o arquivo.
// - Identidade: o `id` do grafo vem do documento e NÃO é trocado. Duplicar ou renomear na importação é decisão
//   da camada de persistência.
//
// Complexidade (V vértices, E arestas, L = comprimento do texto, em caracteres)
// - `JSON.parse` (só `parseGraphJson`): Θ(L) tempo; espaço Θ(L), a árvore de objetos e strings do documento.
// - Inspeção: Θ(V + E) descritores lidos (no máximo 2 por vértice, 4 por aresta, 1 por contador/campo simples) mais
//   um `ownKeys` por objeto, todos de tamanho constante.
// - Validação do modelo: Θ(V + E) esperado, com índices de hash em vez de buscas lineares: `Map` id do vértice →
//   posição (unicidade e busca das extremidades), `Set` dos números de sequência dos ids de aresta e `Map` do par de
//   extremos → id da aresta, com a chave inteira `origem·V + destino` (posições dos vértices); sem eles seria Θ(E²)
//   para as repetidas e Θ(V·E) para as extremidades. Cada id custa O(1) (no máximo 17 caracteres, checado antes de
//   varrer), cada rótulo O(|rótulo|) com o texto longo cortado em 128 unidades. Strings de `id` e `name` do grafo
//   são copiadas por referência.
// - Total: Θ(L + V + E). Espaço extra além do `JSON.parse`: Θ(V + E) (listas de elementos lidos, `Set`, `Map` e o
//   `Graph` devolvido). A árvore do `JSON.parse` pode ser coletada assim que a função retorna.

export type ParseGraphOptions = {
  /** Máximo de elementos em `vertices`. Ausente = sem limite. Inteiro seguro ≥ 0. */
  readonly maxVertices?: number;
  /** Máximo de elementos em `edges`. Ausente = sem limite. Inteiro seguro ≥ 0. */
  readonly maxEdges?: number;
  /** Máximo de `text.length` (unidades UTF-16) aceito por `parseGraphJson`. Ausente = sem limite. Ignorado por `parseGraph`. */
  readonly maxTextLength?: number;
};

type Limits = {
  readonly maxVertices: number | undefined;
  readonly maxEdges: number | undefined;
  readonly maxTextLength: number | undefined;
};

const ROOT_KEYS: readonly string[] = [
  'schemaVersion',
  'id',
  'name',
  'directed',
  'vertices',
  'edges',
  'nextVertexSeq',
  'nextEdgeSeq',
];
const VERTEX_KEYS: readonly string[] = ['id', 'label'];
const EDGE_KEYS: readonly string[] = ['id', 'source', 'target', 'weight'];
const REQUIRED_VERTEX_KEYS = 2;
const REQUIRED_EDGE_KEYS = 3; // `weight` é o único opcional

/** Marca "propriedade ausente" (diferente de presente com valor `undefined`). Não existe fora deste módulo. */
const ABSENT = Symbol('absent');

const ZERO_CODE = 48; // '0'
const MAX_SEQUENCE_DIGITS = 16; // Number.MAX_SAFE_INTEGER = 9007199254740991

/**
 * Teto técnico de vértices (94 906 265 = ⌊√(2⁵³−1)⌋), acima do qual o produto `origem·V + destino` deixaria de ser
 * exato. Está muito além do que cabe em memória (cada vértice ocupa dezenas de bytes e o texto passaria de 2 GB); vale
 * junto de `maxVertices` (vence o menor) e é recusado como `LIMIT_EXCEEDED` em `vertices`.
 */
const MAX_VERTICES = Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER));

const hasOwn = Object.prototype.hasOwnProperty;

export function parseGraph(input: unknown, options: ParseGraphOptions = {}): Result<Graph> {
  try {
    const limits = readLimits(options);
    return limits.ok ? readDocument(input, limits.value) : limits;
  } catch {
    // Rede de segurança: nada deste módulo deveria lançar, mas "nunca lança" é parte do contrato.
    return invalid('', 'UNREADABLE');
  }
}

export function parseGraphJson(text: string, options: ParseGraphOptions = {}): Result<Graph> {
  try {
    const limits = readLimits(options);
    if (!limits.ok) return limits;
    if (typeof text !== 'string') return invalid('', 'WRONG_TYPE');
    const { maxTextLength } = limits.value;
    if (maxTextLength !== undefined && text.length > maxTextLength) {
      return invalid('', 'LIMIT_EXCEEDED');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      // A mensagem do `JSON.parse` cita trechos do texto e muda entre motores: não é repassada.
      return invalid('', 'INVALID_JSON');
    }
    return readDocument(decoded, limits.value);
  } catch {
    return invalid('', 'UNREADABLE');
  }
}

// ---------------------------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------------------------

function invalid(path: string, reason: InvalidDocumentReason): Result<never> {
  return fail({ code: 'INVALID_DOCUMENT', path, reason });
}

function violates(path: string, cause: DocumentCause): Result<never> {
  return fail({ code: 'INVALID_DOCUMENT', path, reason: 'DOMAIN_RULE', cause });
}

/** `('vertices', 2, 'label')` → `vertices[2].label`; índice < 0 = a própria lista; lista `''` = a raiz. */
function pathOf(list: string, index: number, field?: string): string {
  const base = index < 0 ? list : `${list}[${index}]`;
  if (field === undefined) return base;
  return base === '' ? field : `${base}.${field}`;
}

// ---------------------------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------------------------

function readLimits(options: unknown): Result<Limits> {
  if (typeof options !== 'object' || options === null) return invalid('options', 'INVALID_OPTION');
  try {
    const { maxVertices, maxEdges, maxTextLength } = options as ParseGraphOptions;
    const entries: [string, unknown][] = [
      ['maxVertices', maxVertices],
      ['maxEdges', maxEdges],
      ['maxTextLength', maxTextLength],
    ];
    for (const [name, value] of entries) {
      if (value !== undefined && !(Number.isSafeInteger(value) && (value as number) >= 0)) {
        return invalid(`options.${name}`, 'INVALID_OPTION');
      }
    }
    return ok({ maxVertices, maxEdges, maxTextLength });
  } catch {
    return invalid('options', 'INVALID_OPTION');
  }
}

// ---------------------------------------------------------------------------------------------
// Inspeção de objetos e arrays não confiáveis (sem getters, sem [[Get]], cada propriedade lida uma vez)
// ---------------------------------------------------------------------------------------------

type Inspected = {
  /** Valor de cada chave de `keys`, na mesma ordem; `ABSENT` se a chave não existe no objeto. */
  readonly slots: readonly unknown[];
  /** Há propriedade própria fora de `keys` (chave desconhecida, símbolo, `__proto__`…). */
  readonly hasUnknown: boolean;
};

function isEnumerableData(descriptor: PropertyDescriptor): boolean {
  return hasOwn.call(descriptor, 'value') && descriptor.enumerable === true;
}

function inspectObject(
  value: unknown,
  keys: readonly string[],
  list: string,
  index: number,
): Result<Inspected> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalid(pathOf(list, index), 'NOT_AN_OBJECT');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
      return invalid(pathOf(list, index), 'NOT_AN_OBJECT');
    }
    const slots: unknown[] = [];
    let found = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) {
        slots.push(ABSENT);
      } else if (isEnumerableData(descriptor)) {
        slots.push(descriptor.value);
        found++;
      } else {
        return invalid(pathOf(list, index, key), 'UNREADABLE');
      }
    }
    return ok({ slots, hasUnknown: Reflect.ownKeys(value).length !== found });
  } catch {
    return invalid(pathOf(list, index), 'UNREADABLE');
  }
}

/** Inspeciona um vértice ou aresta e exige os campos obrigatórios (os `required` primeiros de `keys`). */
function readObject(
  value: unknown,
  keys: readonly string[],
  required: number,
  list: string,
  index: number,
): Result<readonly unknown[]> {
  const inspected = inspectObject(value, keys, list, index);
  if (!inspected.ok) return inspected;
  const { slots, hasUnknown } = inspected.value;
  for (let i = 0; i < required; i++) {
    if (slots[i] === ABSENT) return invalid(pathOf(list, index, keys[i]!), 'MISSING_FIELD');
  }
  if (hasUnknown) return invalid(pathOf(list, index), 'UNKNOWN_FIELD');
  return ok(slots);
}

type ArrayHeader = { readonly array: readonly unknown[]; readonly length: number };

/** É um array? Qual o `length` (lido uma vez) e ele respeita o limite? Não lê nenhum elemento. */
function readArrayHeader(
  value: unknown,
  list: string,
  limit: number | undefined,
): Result<ArrayHeader> {
  try {
    if (!Array.isArray(value)) return invalid(list, 'NOT_AN_ARRAY');
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length: unknown =
      descriptor !== undefined && hasOwn.call(descriptor, 'value') ? descriptor.value : undefined;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      return invalid(list, 'UNREADABLE');
    }
    if (limit !== undefined && length > limit) return invalid(list, 'LIMIT_EXCEEDED');
    return ok({ array: value as readonly unknown[], length });
  } catch {
    return invalid(list, 'UNREADABLE');
  }
}

/** Copia os `length` elementos (por descritor) para uma lista NOVA. Buraco → `SPARSE_ARRAY`, no primeiro que achar. */
function readArrayItems(header: ArrayHeader, list: string): Result<readonly unknown[]> {
  const items: unknown[] = [];
  try {
    for (let i = 0; i < header.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(header.array, i);
      if (descriptor === undefined) return invalid(pathOf(list, i), 'SPARSE_ARRAY');
      if (!isEnumerableData(descriptor)) return invalid(pathOf(list, i), 'UNREADABLE');
      items.push(descriptor.value);
    }
  } catch {
    return invalid(list, 'UNREADABLE');
  }
  return ok(items);
}

// ---------------------------------------------------------------------------------------------
// Regras do esquema
// ---------------------------------------------------------------------------------------------

/**
 * `('v12', 'v')` → 12. `undefined` se não é id canônico: prefixo, 1 a 16 dígitos ASCII, sem zero à esquerda (`v0` e
 * `v01` também são recusados) e inteiro seguro. O comprimento é checado ANTES de varrer: um id gigante custa O(1).
 */
function canonicalSequence(id: string, prefix: 'v' | 'e'): number | undefined {
  const length = id.length;
  if (length < 2 || length > 1 + MAX_SEQUENCE_DIGITS) return undefined;
  if (id.charCodeAt(0) !== prefix.charCodeAt(0)) return undefined;
  if (id.charCodeAt(1) === ZERO_CODE) return undefined;
  let sequence = 0;
  for (let i = 1; i < length; i++) {
    const digit = id.charCodeAt(i) - ZERO_CODE;
    if (digit < 0 || digit > 9) return undefined;
    sequence = sequence * 10 + digit;
  }
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function checkCounter(value: unknown, path: string): Result<number> {
  if (typeof value !== 'number') return invalid(path, 'WRONG_TYPE');
  if (!Number.isSafeInteger(value) || value < 1) return invalid(path, 'INVALID_COUNTER');
  return ok(value);
}

type ReadVertices = {
  readonly vertices: Vertex[];
  /** id do vértice → posição em `vertices`. */
  readonly indexOf: ReadonlyMap<string, number>;
  readonly maxSequence: number;
};

function readVertices(items: readonly unknown[]): Result<ReadVertices> {
  const vertices: Vertex[] = [];
  const indexOf = new Map<string, number>();
  let maxSequence = 0;
  for (let i = 0; i < items.length; i++) {
    const fields = readObject(items[i], VERTEX_KEYS, REQUIRED_VERTEX_KEYS, 'vertices', i);
    if (!fields.ok) return fields;
    const [id, rawLabel] = fields.value;
    if (typeof id !== 'string') return invalid(pathOf('vertices', i, 'id'), 'WRONG_TYPE');
    const sequence = canonicalSequence(id, 'v');
    if (sequence === undefined) return invalid(pathOf('vertices', i, 'id'), 'INVALID_ID');
    if (indexOf.has(id)) return invalid(pathOf('vertices', i, 'id'), 'DUPLICATE_ID');
    const checked = checkLabel(rawLabel);
    if (!checked.ok) {
      return violates(pathOf('vertices', i, 'label'), {
        code: 'INVALID_VERTEX_LABEL',
        reason: checked.reason,
      });
    }
    if (checked.label !== rawLabel) {
      return violates(pathOf('vertices', i, 'label'), {
        code: 'INVALID_VERTEX_LABEL',
        reason: 'NOT_NORMALIZED',
      });
    }
    indexOf.set(id, vertices.length);
    if (sequence > maxSequence) maxSequence = sequence;
    vertices.push({ id, label: checked.label });
  }
  return ok({ vertices, indexOf, maxSequence });
}

type ReadEdges = { readonly edges: Edge[]; readonly maxSequence: number };

function readEdges(
  items: readonly unknown[],
  directed: boolean,
  vertexIndex: ReadonlyMap<string, number>,
): Result<ReadEdges> {
  const edges: Edge[] = [];
  // Ids canônicos e números de sequência se correspondem 1 a 1: a unicidade se confere nos números (chaves
  // inteiras, bem mais baratas de indexar que as strings).
  const sequences = new Set<number>();
  // Par de extremos (no sentido da orientação) → id da aresta. A chave é `origem·V + destino` com as posições dos
  // vértices (0 ≤ posição < V): exata enquanto V² ≤ 2⁵³, o que `MAX_VERTICES` garante.
  const pairs = new Map<number, string>();
  const width = vertexIndex.size;
  let maxSequence = 0;
  for (let i = 0; i < items.length; i++) {
    const fields = readObject(items[i], EDGE_KEYS, REQUIRED_EDGE_KEYS, 'edges', i);
    if (!fields.ok) return fields;
    const [id, source, target, rawWeight] = fields.value;
    if (typeof id !== 'string') return invalid(pathOf('edges', i, 'id'), 'WRONG_TYPE');
    if (typeof source !== 'string') return invalid(pathOf('edges', i, 'source'), 'WRONG_TYPE');
    if (typeof target !== 'string') return invalid(pathOf('edges', i, 'target'), 'WRONG_TYPE');
    const sequence = canonicalSequence(id, 'e');
    if (sequence === undefined) return invalid(pathOf('edges', i, 'id'), 'INVALID_ID');
    if (sequences.has(sequence)) return invalid(pathOf('edges', i, 'id'), 'DUPLICATE_ID');
    const sourceIndex = vertexIndex.get(source);
    if (sourceIndex === undefined) {
      return violates(pathOf('edges', i, 'source'), { code: 'VERTEX_NOT_FOUND' });
    }
    const targetIndex = vertexIndex.get(target);
    if (targetIndex === undefined) {
      return violates(pathOf('edges', i, 'target'), { code: 'VERTEX_NOT_FOUND' });
    }
    if (sourceIndex === targetIndex) return violates(pathOf('edges', i), { code: 'SELF_LOOP' });
    let weight: number | undefined;
    if (rawWeight !== ABSENT) {
      if (!isValidWeight(rawWeight)) {
        return violates(pathOf('edges', i, 'weight'), { code: 'INVALID_WEIGHT' });
      }
      weight = normalizeWeight(rawWeight);
    }
    // Em grafo não orientado {a, b} = {b, a}: a chave usa sempre a mesma ordem.
    const key =
      directed || sourceIndex < targetIndex
        ? sourceIndex * width + targetIndex
        : targetIndex * width + sourceIndex;
    const existingEdgeId = pairs.get(key);
    if (existingEdgeId !== undefined) {
      return violates(pathOf('edges', i), { code: 'DUPLICATE_EDGE', existingEdgeId });
    }
    pairs.set(key, id);
    sequences.add(sequence);
    if (sequence > maxSequence) maxSequence = sequence;
    edges.push(weight === undefined ? { id, source, target } : { id, source, target, weight });
  }
  return ok({ edges, maxSequence });
}

function readDocument(input: unknown, limits: Limits): Result<Graph> {
  const inspected = inspectObject(input, ROOT_KEYS, '', -1);
  if (!inspected.ok) return inspected;
  const { slots, hasUnknown } = inspected.value;
  const [version, id, name, directed, rawVertices, rawEdges, rawVertexSeq, rawEdgeSeq] = slots;

  if (version === ABSENT) return invalid('schemaVersion', 'MISSING_FIELD');
  if (typeof version !== 'number') return invalid('schemaVersion', 'WRONG_TYPE');
  if (version !== GRAPH_SCHEMA_VERSION) {
    return fail({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      version,
      supported: [GRAPH_SCHEMA_VERSION],
    });
  }

  const missing = ROOT_KEYS.find((_key, i) => slots[i] === ABSENT);
  if (missing !== undefined) return invalid(missing, 'MISSING_FIELD');
  if (hasUnknown) return invalid('', 'UNKNOWN_FIELD');

  if (typeof id !== 'string') return invalid('id', 'WRONG_TYPE');
  if (typeof name !== 'string') return invalid('name', 'WRONG_TYPE');
  if (typeof directed !== 'boolean') return invalid('directed', 'WRONG_TYPE');
  const nextVertexSeq = checkCounter(rawVertexSeq, 'nextVertexSeq');
  if (!nextVertexSeq.ok) return nextVertexSeq;
  const nextEdgeSeq = checkCounter(rawEdgeSeq, 'nextEdgeSeq');
  if (!nextEdgeSeq.ok) return nextEdgeSeq;

  const vertexHeader = readArrayHeader(
    rawVertices,
    'vertices',
    limits.maxVertices === undefined ? MAX_VERTICES : Math.min(limits.maxVertices, MAX_VERTICES),
  );
  if (!vertexHeader.ok) return vertexHeader;
  const edgeHeader = readArrayHeader(rawEdges, 'edges', limits.maxEdges);
  if (!edgeHeader.ok) return edgeHeader;

  const vertexItems = readArrayItems(vertexHeader.value, 'vertices');
  if (!vertexItems.ok) return vertexItems;
  const edgeItems = readArrayItems(edgeHeader.value, 'edges');
  if (!edgeItems.ok) return edgeItems;

  const vertices = readVertices(vertexItems.value);
  if (!vertices.ok) return vertices;
  const edges = readEdges(edgeItems.value, directed, vertices.value.indexOf);
  if (!edges.ok) return edges;

  if (nextVertexSeq.value <= vertices.value.maxSequence) {
    return invalid('nextVertexSeq', 'COUNTER_TOO_LOW');
  }
  if (nextEdgeSeq.value <= edges.value.maxSequence) {
    return invalid('nextEdgeSeq', 'COUNTER_TOO_LOW');
  }

  return ok({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    id,
    name,
    directed,
    vertices: vertices.value.vertices,
    edges: edges.value.edges,
    nextVertexSeq: nextVertexSeq.value,
    nextEdgeSeq: nextEdgeSeq.value,
  });
}
