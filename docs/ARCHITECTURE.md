# Arquitetura do GrafoLab

## Camadas

```text
┌──────────────────────────────────────────────────────────────┐
│ Apresentação nativa   src/app, src/features/**, src/components│  telas, SVG, gestos, animação
├──────────────────────────────────────────────────────────────┤
│ Estado / orquestração  stores Zustand, histórico, simulação,  │  ações do editor, persistência
│                        storage (SQLite)                       │
├──────────────────────────────────────────────────────────────┤
│ Domínio puro           src/domain/**                          │  grafos, algoritmos, rastros
└──────────────────────────────────────────────────────────────┘
        dependências só apontam para baixo
```

- **Domínio** (`src/domain`, desde a Fase 2): TypeScript puro e imutável. Não importa React, React Native,
  Expo nem Zustand. A fronteira é imposta por ferramenta: o ESLint barra esses imports em `src/domain/**` e o
  Jest roda o domínio em Node puro (projeto `domain` em `jest.config.js`). A posição dos vértices na tela
  (`GraphLayout`, Fase 3) fica fora do `Graph`.
- **Algoritmos** recebem um `Graph` imutável e parâmetros e devolvem **resultado + rastro determinístico**
  de passos. Não tocam em SVG, timers nem componentes. A animação nunca é a fonte da verdade.
- **Apresentação** reproduz o rastro e renderiza. Coordenadas de mundo e de tela ficam separadas, com
  conversões puras e testadas.

## Stack (verificada em 30/10/2026)

| Item | Versão | Observação |
| --- | --- | --- |
| Expo SDK | 58 (`expo` 58.0.21) | `latest` do npm; template `expo-template-default@sdk-58` |
| React Native / React | 0.88.1 / 19.3.0 | |
| TypeScript | ~6.0.3 | `strict` + `noUncheckedIndexedAccess` |
| Navegação | `expo-router` 58 (`src/app`, rotas tipadas) | abas com `NativeTabs` (estável na SDK 58) |
| Testes | `jest-expo` + Jest 30 + `@testing-library/react-native` 14 | Jest 30 é exigido pela SDK 58 |
| Node | 24.12 no ambiente | SDK 58 exige ≥ 22.13 (linha 22), ≥ 24.3 (linha 24) ou ≥ 26 |

### Expo Go × development build (SDK 58, segundo a documentação oficial)

- Cada build do Expo Go suporta **uma** SDK; projeto e Expo Go precisam coincidir. O changelog da SDK 58
  (15/10/2026) diz que o Expo Go da SDK 58 chega às lojas "em poucas semanas" — **não confirmado**. O Expo CLI
  instala a versão certa em emuladores; no iOS físico a doc cita TestFlight (`npx eas-cli@latest go`).
- Não funcionam no Expo Go: bibliotecas nativas fora do pacote do Expo Go, mudança de nome/ícone/splash
  nativos, push remoto, App/Universal Links, SQLCipher.
- Bibliotecas planejadas (docs da SDK 58): `react-native-svg`, `react-native-gesture-handler`,
  `react-native-reanimated` (+ `react-native-worklets`, plugin Babel já configurado pelo `babel-preset-expo`),
  `expo-sqlite` (sem SQLCipher) e `@shopify/react-native-skia` **estão no Expo Go**. `expo-file-system`,
  `expo-document-picker` e `expo-sharing` ainda precisam ser conferidos na Fase 13.
- Development build (`expo-dev-client`, `npx expo run:android|ios` ou `eas build --profile development`)
  vira necessário se uma dependência futura sair do conjunto do Expo Go. Não é preciso nas fases 1–7.

## Estrutura

```text
src/
  app/                 rotas Expo Router (finas): (tabs)/{index,aprender,laboratorio,desafios}, +not-found
  components/          UI compartilhada: Screen, Text, Card, Badge, EmptyState, GraphGlyph, ActionCard
  features/            telas e conteúdo por assunto (home, lessons, graph-editor, challenges)
  theme/               tokens (cores claro/escuro, espaçamento, tipografia) e useTheme
  domain/graph/        modelo do grafo (Fase 2): types, errors, graph (operações), queries (grau e vizinhança), adjacency, adjacency-matrix, incidence e incidence-list (representações), index (API pública)
  domain/              algoritmos e simulação entram nas fases seguintes
  storage/             (Fase 5+) SQLite e migrações
docs/                  ROADMAP, ARCHITECTURE, REFERENCIAS
scripts/               gerar-icones.py (dev; PyMuPDF)
```

Pastas são criadas só quando necessárias.

## Decisões

1. **Rotas finas, telas em `features/`** — `src/app` só importa e exporta a tela; mantém o roteamento
   independente da UI e permite reaproveitar telas.
2. **`NativeTabs`** em vez de abas JS: barra nativa em Android e iOS, estável na SDK 58. Limitações da doc:
   não é substituto direto das abas JS e, na web, cai em implementação básica (a web não é alvo do produto).
   Abas sem cabeçalho nativo: cada tela desenha o próprio título (`Screen`).
3. **Poda do template**: removidos `@expo/ui`, `expo-image`, `expo-device`, `expo-web-browser`,
   `expo-glass-effect`, `reanimated`, `worklets` e `gesture-handler`; voltam na fase que os usa. Mantidos
   `react-dom` e `react-native-web` apenas para pré-visualizar telas no navegador durante o desenvolvimento.
4. **Estado do tema** vem do esquema do sistema (`useColorScheme`); cores só via tokens. O contraste
   (WCAG AA, 4,5:1) é verificado por teste.
5. **Orientação travada em retrato** até a fase de tablets (Fase 13).
6. **React Compiler** permanece ligado como no template; reavaliar na Fase 3 junto com worklets.
7. **Modelo de domínio** (`src/domain/graph`, implementado no incremento 1 da Fase 2):
   - **Grafo simples**: laço → `SELF_LOOP`; aresta repetida → `DUPLICATE_EDGE`. Não orientado: `{u,v}` é par
     não ordenado. Orientado: `u→v` e `v→u` são arcos distintos e ambos permitidos. Não se misturam arcos e arestas.
   - **Orientação global** ao grafo (`directed`). Trocar a orientação de um grafo existente fica para quando o
     editor precisar (orientado → não orientado pode gerar arestas paralelas).
   - **Peso opcional por aresta**: ausente = não ponderada. Aceita qualquer número finito (inclusive 0 e
     negativos; rejeitar negativos é decisão de cada algoritmo, ex.: Dijkstra). `NaN`, `±Infinity` e não-números →
     `INVALID_WEIGHT`. `-0` é normalizado para `0`. `capacity` (fluxos) foi adiado para a Fase 12.
   - **IDs estáveis e determinísticos**: o `Graph` guarda contadores (`nextVertexSeq`/`nextEdgeSeq`) e emite
     `v1, v2…` / `e1, e2…`. Um ID removido nunca é reaproveitado, então seleção, layout e histórico não apontam
     para o vértice errado. O `id` do grafo vem de quem persiste (o domínio não gera aleatoriedade).
   - **Rótulos**: sem rótulo informado, `addVertex` usa A, B, …, Z, AA, AB… a partir do contador. Todo rótulo
     informado — em `addVertex` e em `setVertexLabel`, pelo mesmo `normalizeLabel` — passa por `trim()` e depois
     precisa ter 1 a 64 pontos de código Unicode (`MAX_VERTEX_LABEL_LENGTH`; um emoji vale 1 e "e" + acento
     combinante valem 2), sem normalização Unicode e **sem exigir unicidade**. Erro `INVALID_VERTEX_LABEL` com
     `reason` (`NOT_A_STRING`, `EMPTY`, `TOO_LONG`). No `addVertex` só `undefined` significa "omitido" (`null` é
     inválido) e o retorno é `Result<{ graph, vertex }>`; em caso de erro nada é criado e o contador de ids não
     avança. Limitação: `trim()` não remove caracteres invisíveis como U+200B.
   - **Edição de propriedades** (`setVertexLabel`, `setEdgeWeight`): validam nesta ordem — alvo existe → valor
     válido. `setEdgeWeight(g, id, undefined)` **remove** o peso; `0` é um peso; `null` é inválido. Se o valor
     final é igual ao atual, devolvem o **mesmo grafo** (o editor pode ignorar o passo no histórico de
     desfazer). Preservam ids, ordem, conexões e contadores; itens não alterados mantêm a identidade do objeto.
   - **Erros como valores** (`Result<T>` com `GraphError.code`), não exceções; o texto ao aluno é da interface.
     Ordem de validação do `addEdge`: origem existe → destino existe → laço → peso → duplicata.
   - **Grau e vizinhança** (`queries.ts`): vértice inexistente → `VERTEX_NOT_FOUND` (nunca "grau 0"); listas na
     ordem de inserção dos **vértices**, não das arestas. Em grafo não orientado a aresta vale nos dois sentidos:
     `successors` = `predecessors` = `neighbors` e `inDegree` = `outDegree` = `degree` (assim BFS/DFS usam
     `successors` para os dois tipos). Em grafo orientado, `neighbors` = sucessores ∪ predecessores sem repetir,
     então `degree` pode superar `neighbors.length` (os arcos u→v e v→u contam 2 no grau e 1 na vizinhança).
   - **Lista de adjacência** (`adjacencyList`, em `adjacency.ts`): derivada do `Graph`, sem estado próprio (regerar
     depois de editar). Uma linha por vértice, inclusive isolados, na ordem dos vértices; entradas
     `{ vertexId, edgeId, weight? }` em que `vertexId` é o **outro extremo**, também na ordem dos vértices (a mesma de
     `successors`). Orientado: só arcos de saída. Não orientado: a aresta aparece nas duas linhas, com o mesmo
     `edgeId` e peso. O peso é copiado sem conversão: ausente, `0` e negativo permanecem distintos e **sem peso nunca
     vira 1**.
     - *Algoritmo:* `Map` id → posição; um balde por vértice recebe os arcos que chegam a ele; ler os baldes em
       ordem crescente e distribuir para as linhas entrega cada linha já ordenada (*counting sort*), sem ordenação
       por comparação.
     - *Tempo:* Θ(V + E) (a busca no `Map` é O(1) esperada, não de pior caso). *Espaço:* Θ(V + E) na saída (V linhas
       e A entradas, com A = E se orientado e 2E se não orientado) mais Θ(V + A) auxiliar e temporário.
     - *Uso:* vizinhos de uma linha em O(grau); achar a linha de um id exige um índice do consumidor.
     - *Medição pontual* (30/10/2026, Node 24.12, i5-11400H, dentro do Jest, E ≈ 4V, até 320 mil vértices): dobrar V
       e E multiplicou o tempo por 2,0 a 2,6, o que é coerente com crescimento quase linear e longe do quadrático.
       Não é garantia nem limite de produto.
   - **Matriz de adjacência** (`adjacencyMatrix`, em `adjacency-matrix.ts`): `{ vertexIds, cells }`, com
     `cells[i][j]` = `null` (sem aresta) ou `{ edgeId, weight? }`, linhas e colunas na ordem dos vértices. Três
     estados que nunca se confundem: sem aresta (`null`), aresta sem peso (sem o campo `weight`; **nunca vira 1**) e
     aresta com peso (`0` e negativos incluídos). Diagonal sempre `null` (só há grafos simples). Não orientado:
     simétrica, com o mesmo `edgeId` e peso nas duas posições. Orientado: `cells[i][j]` é o arco i→j, independente
     de `cells[j][i]`; a matriz pode ser simétrica ou assimétrica, e arcos opostos têm `edgeId` e peso próprios.
     - *Imutabilidade:* `readonly` só vale na compilação e o domínio não congela objetos em execução; um objeto
       compartilhado entre `cells[i][j]` e `cells[j][i]` não seria efetivamente imutável (aliasing por cast). Por
       isso cada posição recebe um **objeto próprio** (2E objetos no não orientado) e cada linha é um array
       próprio; um teste dedicado impede o compartilhamento.
     - *Tempo:* Θ(V²): alocar a grade custa V² mesmo em grafo esparso; o índice custa Θ(V) e preencher as células
       Θ(E); como num grafo simples E ≤ V², O(V² + E) = Θ(V²). *Espaço:* Θ(V²) mais Θ(E) objetos de célula.
       *Uma célula:* O(1) depois de obter os índices dos vértices. *Vizinhos de uma linha:* O(V) (a lista dá
       O(grau)).
     - *Medição pontual* (30/10/2026; Node 24.12 puro com `--expose-gc`, i5-11400H, 16 GB; E ≈ 4V; V de 250 a
       3000): ≈ 8,1 bytes por posição (V = 3000 → ≈ 70 MB de heap); ao dobrar V o tempo foi multiplicado por 2,6 a
       5,0 (esperado ≈ 4 para Θ(V²)); a projeção numérica custa ≈ 69 MB e ≈ 118 a 121 ms em V = 3000. Para o mesmo
       grafo esparso, a lista de adjacência ocupou ≈ 1,8 MB e levou 2,7 a 4,9 ms. **Esses números NÃO definem o
       limite do aplicativo**: foram obtidos em Node/V8 num PC, não em Hermes nem em Android modesto. A interface
       deve calcular a matriz sob demanda, e o limite de vértices só será fixado depois de medir em dispositivos
       Android com poucos recursos (ver ROADMAP, Fase 4).
   - **Projeção numérica** (`adjacencyAsNumbers(matrix, { absent, unweighted })`): lê a matriz estrutural como
     números. As duas opções são **obrigatórias** (um teste de tipo com `@ts-expect-error` impede omiti-las):
     `null` → `absent`, aresta sem peso → `unweighted`, aresta com peso → o próprio peso. **Não é reversível** e
     pode perder informação: descarta o `edgeId` e junta estados quando as opções coincidem com pesos reais
     (`absent: 0` com peso zero; `unweighted: 1` com peso 1). Não é uma "matriz binária" em geral: só contém 0 e 1
     em grafo sem pesos com `{ absent: 0, unweighted: 1 }` (a leitura do livro-texto, p. 19). Não assume distância
     zero na diagonal: a diagonal vale `absent`. Θ(V²) em tempo e em espaço.
   - **Matriz de incidência** (`incidenceMatrix`, em `incidence.ts`): `{ vertexIds, edgeIds, cells }`, vértices ×
     arestas, com `cells[i][j]` em `{-1, 0, 1}`; linhas na ordem dos vértices e colunas na ordem de inserção das
     arestas. Convenção do livro-texto (Boaventura & Jurkiewicz, §2.1, p. 20; ver `REFERENCIAS.md`): orientado →
     **+1 na origem e −1 no destino**; não orientado → **+1 nas duas pontas**; 0 = sem incidência. Arcos opostos
     ocupam colunas diferentes, com os sinais trocados. Pesos **não** fazem parte da matriz (editar peso ou rótulo
     não a altera). Sem arestas → uma linha vazia por vértice; grafo vazio → arrays vazios. Células são números e
     cada linha é um array próprio, então não há aliasing. A interface deve mostrar uma legenda de sinais, pois
     outras fontes podem inverter a convenção.
     - *Identidades verificadas nos testes* (grafos pequenos; A é a adjacência **binária por existência** das
       arestas, nunca a projeção numérica com pesos): não orientado B·Bᵀ = D + A; orientado B·Bᵀ = D − (A + Aᵀ),
       com D a diagonal dos graus (grau comum no não orientado, total no orientado).
     - *Construção:* Θ(V + V·E) em tempo e em espaço, que é Θ(V·E) para E ≥ 1; só 2E posições são não nulas. Como
       E pode chegar a V(V−1)/2 (não orientado) ou V(V−1) (orientado), o pior caso é Θ(V³): **o que importa é o
       produto V·E**, não só V.
     - *Consultas depois de pronta* (custo à parte da construção): uma célula O(1) dados os índices; grau de um
       vértice pela linha O(E); extremos de uma aresta pela coluna O(V); vizinhos por varredura O(E + d(v)·V) (a
       lista de adjacência dá O(d(v))).
     - *Medição pontual* (30/10/2026; Node 24.12 puro com `--expose-gc`, i5-11400H, 16 GB; grafos esparsos com
       E ≈ 4V e grafos completos; até ≈ 8 milhões de posições): **≈ 8,0 a 8,2 bytes por posição V·E**, de 61 mil a
       8 milhões de posições; ≈ 60 MB com 7,8 milhões de posições (K250 não orientado: 31 125 arestas × 250
       vértices, ou o esparso V = 1400). Tempo de construção: ≈ 1 a 3 ms para 1 milhão de posições, ≈ 10 a 15 ms
       para 4 milhões e ≈ 25 a 43 ms para 8 milhões. Comparando com a matriz de adjacência do mesmo grafo (≈ 8
       bytes × V², medidos na etapa 3.2; derivado, não medido de novo), a incidência custa **E/V vezes mais**: 4×
       no esparso (E ≈ 4V) e ≈ 124× no K250 (E/V = (V−1)/2). Esses números **NÃO definem o limite do aplicativo**
       (Node/V8 num PC, não Hermes nem Android modesto): a interface deve decidir se exibe a matriz completa pelo
       produto V·E e calculá-la sob demanda (ver ROADMAP, Fase 4).
   - **Lista de incidência** (`incidenceList`, em `incidence-list.ts`): `{ vertexIds, rows }`, em que `rows[i]` lista as
     **arestas** incidentes a `vertexIds[i]` como `{ edgeId, oppositeVertexId, role, weight? }`. Não é a lista de
     adjacência: lá cada entrada é o vizinho e a ordem segue os vértices; aqui o objeto é a aresta, o vizinho é só
     um atributo (`oppositeVertexId`, o **outro** extremo) e a ordem segue a **inserção das arestas**, a mesma das
     colunas da matriz de incidência. Linhas na ordem dos vértices, inclusive os isolados (linha vazia).
     - *Papéis:* orientado → `outgoing` na origem e `incoming` no destino (+1 e −1 na matriz de incidência, segundo
       a convenção do livro-texto, §2.1, p. 20); não orientado → `undirected` nos dois extremos (+1 nos dois).
     - Cada aresta aparece **exatamente uma vez em cada extremo** (2E entradas; o modelo não tem laços). Arcos
       opostos têm `edgeId` próprio e aparecem nas duas linhas com papéis complementares. O peso é copiado sem
       conversão (ausente, zero e negativo ficam distintos; **sem peso nunca vira 1**) e é o mesmo nos dois
       extremos. As duas entradas de uma aresta são objetos independentes e cada linha é um array próprio.
     - *Construção:* Θ(V + E) em tempo (`Map` de posições Θ(V), **uma única passada** pelas arestas com duas
       inserções O(1) cada; a busca no `Map` é O(1) esperada) e Θ(V + E) em espaço (V linhas, 2E entradas e o `Map`
       auxiliar Θ(V)). Não há ordenação: ler as arestas em ordem de inserção já deixa cada linha ordenada.
     - *Consulta:* as incidências de um vértice em O(d(v)) depois de localizar a linha (`indexOf` é O(V); um `Map`
       do consumidor dá O(1)); existência de (u,v) em O(d(u)).
     - *Consistência:* a lista e a matriz de incidência descrevem exatamente as mesmas incidências, na mesma ordem
       (testado localmente, inclusive com arcos opostos); a suíte cruzada completa das quatro representações é a
       etapa 3.4B.
   - **Helper interno de pesos** (`weight.ts`, não exportado): `weightField(edge)` devolve `undefined` se a aresta não
     tem peso e `{ weight }` caso contrário (inclusive `0` e negativos), para ser espalhado (`...weightField(edge)`) na
     lista de adjacência, na matriz de adjacência e na lista de incidência. Centraliza a regra "sem peso ≠ zero ≠
     negativo; sem peso nunca vira 1", que estava repetida em 3 módulos e que um `if (edge.weight)` quebraria (descarta
     o zero). A primeira versão devolvia `{}` sem peso e custou ≈ +10% de tempo de construção (A/B alternado em
     processos isolados: mediana 1,10; até 1,16 nos tamanhos grandes), porque o `{}` era alocado por entrada. A versão
     final devolve `undefined` (espalhar `undefined` não aloca): mediana 1,03 contra 1,02 do controle (código idêntico)
     e memória idêntica. `addEdge` e `withWeight` (em `graph.ts`) não usam o helper: recebem o peso como número, não de
     uma aresta. A construção das representações **não** foi abstraída (o mapa id → posição, com 2 linhas, continua em
     cada módulo).
   - **Imutável**, com ordem de inserção preservada (desempate estável para os algoritmos). Buscas por ID são
     lineares, adequadas ao tamanho dos grafos didáticos; algoritmos montam suas próprias estruturas (O(V+E)).
8. **Renderização (Fase 3):** SVG atrás de interface `GraphRenderer`, para trocar por Skia depois.
9. **Bibliografia fora do Git:** PDFs com direitos autorais ficam locais (`/*.pdf` ignorado).
10. **Ícones gerados por script** a partir de um glifo vetorial único, para manter o app e a ilustração
    do estado vazio (`GraphGlyph`) coerentes.
11. **Navegação por cartão com `useRouter().navigate`**, não `Link asChild`: no emulador o `Link asChild`
    descartou o `style` em forma de função do `Pressable` (cartão sem borda nem fundo).
12. **`labelVisibilityMode="labeled"`** nas abas: por padrão o Android só mostrava o rótulo da aba ativa;
    rótulos sempre visíveis ajudam a leitura e a acessibilidade.

## Representações do grafo: visão comparativa

As quatro são **derivadas** do `Graph`, sem estado próprio (regerar depois de editar), usam só IDs (rótulo não as
altera), são imutáveis por construção (objetos e arrays próprios, sem aliasing) e não incluem laços (o modelo é simples).
V = vértices, E = arestas, d(v) = grau. Custos teóricos; os números medidos estão abaixo.

| | Lista de adjacência | Matriz de adjacência | Matriz de incidência | Lista de incidência |
| --- | --- | --- | --- | --- |
| **Função** | `adjacencyList` | `adjacencyMatrix` | `incidenceMatrix` | `incidenceList` |
| **Estrutura** | `AdjacencyRow[]`: `{ vertexId, entries }` | `{ vertexIds, cells }`, V × V | `{ vertexIds, edgeIds, cells }`, V × E | `{ vertexIds, rows }` |
| **Entrada ou célula** | o **vizinho**: `{ vertexId, edgeId, weight? }` | `null` (sem aresta) ou `{ edgeId, weight? }` em `[i][j]` | `-1`, `0` ou `1` (vértice i × aresta j) | a **aresta**: `{ edgeId, oppositeVertexId, role, weight? }` |
| **Orientado** | só arcos de **saída** | `[i][j]` é o arco i→j, independente de `[j][i]` | **+1 na origem, −1 no destino** | `outgoing` (origem) e `incoming` (destino) |
| **Não orientado** | a aresta nas duas linhas | simétrica | +1 nas duas pontas | `undirected` nas duas linhas |
| **Arcos opostos** | `edgeId` próprio, em linhas diferentes | duas células, `edgeId` próprio | duas colunas, sinais trocados | duas arestas, papéis complementares |
| **Pesos** | copiados: ausente, `0` e negativo distintos | idem; `null` = sem aresta (≠ peso zero) | **não contém** pesos | copiados, iguais nas duas pontas |
| **Ordem** | linhas: vértices; entradas: vértices vizinhos | linhas e colunas: vértices | linhas: vértices; colunas: arestas (inserção) | linhas: vértices; entradas: arestas (inserção) |
| **Construção (tempo)** | Θ(V + E) | Θ(V²) | Θ(V + V·E) | Θ(V + E) |
| **Espaço** | Θ(V + E) | Θ(V²) + Θ(E) objetos | Θ(V + V·E) | Θ(V + E) |
| **Consultas** | vizinhos O(d(v)); (u,v) O(d(u)) | célula O(1)\*; vizinhos O(V) | célula O(1)\*; grau O(E); extremos O(V); vizinhos O(E + d(v)·V) | incidências O(d(v)); (u,v) O(d(u)) |
| **Limitações** | sem arcos de entrada; achar a linha por id exige índice | Θ(V²) mesmo em grafo esparso | Θ(V·E): cresce com E (até Θ(V³)); sem pesos | a ordem difere da lista de adjacência (por aresta, não por vértice) |

\* depois de obter os índices dos vértices (`indexOf` é O(V); um `Map` do consumidor dá O(1) após Θ(V)). A busca no
`Map` usado nas construções é O(1) **esperada**, não de pior caso. Convenção da matriz de incidência: Boaventura &
Jurkiewicz, §2.1, p. 20 (ver `REFERENCIAS.md`); a interface deve mostrar uma legenda de sinais.

**Medições pontuais** (30/10/2026; Node 24.12, i5-11400H, 16 GB; **um processo Node por estrutura e tamanho**, com
`--expose-gc`; tempo = mediana de 5 construções; memória = heap retido após coleta de lixo; E ≈ 4V no esparso):

| Grafo | Lista de adjacência | Matriz de adjacência | Matriz de incidência | Lista de incidência |
| --- | --- | --- | --- | --- |
| Esparso, V = 1 400 (E = 5 600) | 1,6 ms · 0,8 MB | 7,4 ms · 15,5 MB | 45,2 ms · 60,0 MB | 1,1 ms · 0,9 MB |
| Completo não orientado, V = 250 (E = 31 125) | 8,0 ms · 3,6 MB | 3,0 ms · 2,9 MB | 24,4 ms · 59,6 MB | 4,1 ms · 4,0 MB |
| Completo orientado, V = 200 (E = 39 800) | 8,9 ms · 2,2 MB | 2,1 ms · 1,8 MB | 24,9 ms · 61,1 MB | 4,2 ms · 5,1 MB |
| Esparso, V = 160 000 (E = 640 000) | 645,6 ms · 94,0 MB | inviável (V² ≈ 2,6·10¹⁰) | inviável | 208,3 ms · 98,9 MB |

- **Matrizes:** ≈ 8 bytes por posição da grade (V² na de adjacência, V·E na de incidência), constantes entre 61 mil e
  8 milhões de posições. A incidência custa E/V vezes a memória da matriz de adjacência: 4× no esparso (E ≈ 4V) e
  ≈ 20× em V = 250 completo (59,6 MB contra 2,9 MB, pois as células da matriz de adjacência ocupada são objetos).
- **Listas:** de V = 10 000 a V = 160 000 (16×) o tempo cresceu ≈ 29× na lista de adjacência e ≈ 29× na de incidência:
  um pouco acima do linear (efeitos de cache e de coleta de lixo), longe do quadrático. A lista de adjacência levou ≈ 3×
  o tempo da de incidência no mesmo grafo: duas passadas e baldes temporários contra uma passada.
- **Grafo denso:** a matriz de adjacência é a mais barata em tempo e em memória; a de incidência é a mais cara. No
  esparso (V = 1 400), as listas usaram ≈ 17× a ≈ 75× menos memória e levaram ≈ 5× a ≈ 40× menos tempo que as matrizes.
- **Estas medições NÃO são desempenho garantido em Android ou iOS** e **não definem limites do aplicativo**: foram feitas
  em Node/V8 num PC, não em Hermes nem em aparelhos modestos. A interface calculará as matrizes sob demanda e decidirá
  pelo produto **V·E** (incidência) e por V² (adjacência) só depois de medir em Android com poucos recursos (ROADMAP,
  Fase 4). A memória e o tempo de cada representação foram aferidos em processos separados para evitar o artefato de
  coleta de lixo que apareceu numa medição anterior (valores negativos de heap).

## Estratégia de testes

- **Domínio:** Jest em ambiente Node (projeto `domain`), ao lado do código; entradas congeladas com
  `Object.freeze` para provar imutabilidade; propriedades (handshake lemma etc.) a partir do incremento 5.
  Na Fase 2 foi conferido por mutação que os testes detectam mutação de entrada e reaproveitamento de IDs.
- **Suíte cruzada das representações** (`representations.test.ts`): confere que as quatro descrevem o **mesmo grafo**,
  independentemente dos testes unitários de cada uma. Para não repetir um erro comum às quatro: (1) **quatro
  reconstruções de arestas escritas de formas diferentes** (a matriz de incidência só reconstrói extremos e sentido;
  a lista de adjacência orientada só tem arcos de saída); (2) **dois grafos com as quatro estruturas calculadas à
  mão**; (3) um **modelo de referência independente** (objetos simples, regras próprias) nas sequências
  pseudoaleatórias de operações válidas e inválidas, que prevê o resultado e o código de erro de cada operação e
  confere ids não consumidos; (4) **controles negativos**: o verificador precisa acusar representações corrompidas.
  Todas as verificações usam sementes fixas. Em mutação aplicada **só a essa suíte**, 40 inconsistências sutis nos
  quatro módulos foram detectadas.
- **Componentes/rotas:** Jest + React Native Testing Library (`jest-expo`); rotas via `renderRouter`.
- **Tema:** contraste calculado a partir dos tokens.
- **Em dispositivo (manual):** gestos pinch/pan/drag, safe areas, comportamento da barra de abas nativa,
  acessibilidade com TalkBack/VoiceOver. O iOS não pode ser testado em Windows; fica registrado como
  pendente nas entregas.
