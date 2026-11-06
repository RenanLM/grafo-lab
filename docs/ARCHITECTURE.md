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
| Editor visual (Fase 3, incremento 3.0) | `react-native-svg` 15.16.0 · `react-native-gesture-handler` 3.3.0 · `react-native-reanimated` 4.7.1 · `react-native-worklets` 0.13.0 | exatamente as versões da SDK 58 (`npx expo install`); compatibilidade, divergência da doc do Gesture Handler e verificação no emulador em "Editor visual (Fase 3)" |
| Estado do editor (Fase 3, incremento 3.4) | `zustand` 5.0.16 (dependência direta, `^5.0.16`) | `npx expo install zustand`; só em `graph-editor/editor-store.ts` (`zustand/vanilla`), fora do núcleo puro; `react` ≥ 18 é peer opcional e já está atendido |

### Expo Go × development build (SDK 58, segundo a documentação oficial)

- Cada build do Expo Go suporta **uma** SDK; projeto e Expo Go precisam coincidir. O changelog da SDK 58
  (15/10/2026) diz que o Expo Go da SDK 58 chega às lojas "em poucas semanas" — **não confirmado**. O Expo CLI
  instala a versão certa em emuladores; no iOS físico a doc cita TestFlight (`npx eas-cli@latest go`).
- Não funcionam no Expo Go: bibliotecas nativas fora do pacote do Expo Go, mudança de nome/ícone/splash
  nativos, push remoto, App/Universal Links, SQLCipher.
- Bibliotecas planejadas (docs da SDK 58): `react-native-svg`, `react-native-gesture-handler`,
  `react-native-reanimated` (+ `react-native-worklets`, plugin Babel já configurado pelo `babel-preset-expo`),
  `expo-sqlite` (sem SQLCipher) e `@shopify/react-native-skia` **estão no Expo Go**. `expo-file-system`,
  `expo-document-picker` e `expo-sharing` ainda precisam ser conferidos na Fase 13. Verificado em 30/10/2026: as
  quatro bibliotecas do editor (instaladas na 3.0) rodam no **Expo Go 58.0.5 no emulador `Pixel_6` (Android 13)**.
- Development build (`expo-dev-client`, `npx expo run:android|ios` ou `eas build --profile development`)
  vira necessário se uma dependência futura sair do conjunto do Expo Go. Não é preciso nas fases 1–7 (até aqui,
  nenhuma saiu; `expo-dev-client` **não** está instalado).

## Estrutura

```text
src/
  app/                 rotas Expo Router (finas): (tabs)/{index,aprender,laboratorio,desafios}, +not-found
  components/          UI compartilhada: Screen, Text, Card, Badge, EmptyState, GraphGlyph, ActionCard
  features/            telas e conteúdo por assunto (home, lessons, graph-editor, challenges)
    graph-editor/      interface do editor (SVG, gestos, animação, controles) e `editor-store.ts` (store Zustand, 3.4)
      core/            núcleo PURO do editor (câmera, layout, geometria, hit-testing, comandos, histórico); sem React/RN
  theme/               tokens (cores claro/escuro, espaçamento, tipografia) e useTheme
  domain/graph/        modelo do grafo (Fase 2): types, errors, graph (operações), queries (grau e vizinhança), adjacency, adjacency-matrix, incidence e incidence-list (representações), serialization (JSON v1; arquivos de referência em `golden/v1/`), deserialization (leitura validada do JSON v1), index (API pública)
  domain/              algoritmos e simulação entram nas fases seguintes
  storage/             (Fase 5+) SQLite e migrações
docs/                  ROADMAP, ARCHITECTURE, REFERENCIAS
scripts/               gerar-icones.py (dev; PyMuPDF)
```

Pastas são criadas só quando necessárias.

## Contrato do domínio de grafos (resumo da Fase 2)

O que `src/domain/graph` promete à camada de estado e à interface (Fase 3 em diante). Este quadro é um mapa: o detalhe
de cada item está na seção indicada, e **este resumo não repete regras**.

| Tema | Contrato | Detalhe |
| --- | --- | --- |
| Modelo matemático | `Graph` imutável: grafo simples (sem laços nem arestas repetidas), orientação global, peso opcional por aresta (ausente ≠ 0), ids estáveis e **nunca reaproveitados** (contadores), ordem de inserção, sem posição de vértices | Decisão 7 |
| Operações | `createGraph`, `addVertex`/`removeVertex`, `addEdge`/`removeEdge`, `setVertexLabel`, `setEdgeWeight`, graus e vizinhança; devolvem `Result`, nunca lançam e devolvem o **mesmo grafo** quando nada muda | Decisão 7 |
| Quatro representações | `adjacencyList`, `adjacencyMatrix` (+ `adjacencyAsNumbers`), `incidenceMatrix`, `incidenceList`: **derivadas** do `Graph` na hora, sem estado próprio; ausência, sem peso e peso zero nunca se confundem | Representações: visão comparativa |
| Serialização | `serializeGraph(graph, { pretty? })`: JSON v1 canônico (chaves em ordem fixa, arrays na ordem de inserção, `weight` só quando existe, contadores como estão, nada de interface) e determinístico | Formato de persistência |
| Leitura | `parseGraph(unknown)` e `parseGraphJson(text)`: fronteira de dados não confiáveis; recusa o documento inteiro ao primeiro problema, sem corrigir nada; erros `INVALID_DOCUMENT { path, reason, cause? }` e `UNSUPPORTED_SCHEMA_VERSION` | Leitura e validação |
| Compatibilidade | o leitor v1 só lê v1; versão maior é `UNSUPPORTED_SCHEMA_VERSION`, sempre antes de qualquer outro defeito; arquivos de referência imutáveis; migrações futuras por leitor de versão | Compatibilidade de versões |
| API pública | `index.ts` exporta 57 nomes (32 valores e 25 tipos); helpers internos (`weightField`, `isValidWeight`, `normalizeWeight`, `checkLabel`) continuam privados; a lista é pinada por teste e as assinaturas, o vocabulário de erros e os motivos por verificação de tipos | `public-api.test.ts` |

**Separação entre domínio e apresentação.**
- As dependências só apontam para baixo (Camadas). `src/domain/**` não importa React, React Native, Expo nem Zustand
  (ESLint barra e o Jest roda o domínio em Node puro). A interface importa de `@/domain/graph` (o `index.ts`), nunca de
  um módulo interno.
- O `Graph` é a **única fonte da verdade matemática**. Posição, seleção, câmera e estado visual ficam fora dele
  (`GraphLayout`, Fase 3, indexado por `VertexId` estável) e nunca entram no documento v1. Mudar a posição de um vértice
  não muda nenhum resultado matemático.
- Estado e histórico guardam `Graph` imutáveis (as operações compartilham o que não mudou e devolvem o mesmo grafo
  quando nada muda, o que permite não registrar passos vazios). As representações **não** são guardadas: calculam-se
  a partir do `Graph`, sob demanda.
- Erros são valores com `code`; o texto em português ao aluno é da interface.

**Limitações técnicas** (todas documentadas na seção do tema):
- Só grafos simples e orientação global; `capacity` (fluxos) fica para a Fase 12.
- Rótulo: `trim()` não remove caracteres invisíveis como U+200B e não há normalização Unicode.
- Matrizes são Θ(V²) e Θ(V·E): o limite de tamanho para a interface só será fixado depois de medir em Hermes e em
  Android modesto (tarefa 4.6). Todas as medições do projeto são de Node/V8 num PC.
- Persistência: ids de elementos removidos não podem ser reconstruídos de um documento adulterado; chave repetida no
  texto JSON vale a última; BOM é recusado; teto técnico de 94 906 265 vértices na leitura (distinto dos limites de
  produto); `Proxy` não é isolado por `parseGraph` (use o texto).
- iOS não é testável no ambiente atual (Windows).

**Responsabilidades da futura camada de persistência** (Fase 5, `expo-sqlite`; Fase 13, importar e exportar), que o
domínio **deliberadamente não assume**:
1. Escolher e aplicar os **limites de produto** (`maxTextLength`, `maxVertices`, `maxEdges`) por aparelho e por
   origem do arquivo, depois de medir; o domínio não tem padrão.
2. Ler os bytes, decodificar UTF-8 (retirando o BOM, se quiser), limitar o tamanho do arquivo em bytes e só então chamar
   `parseGraphJson`.
3. Decidir o `id` do grafo na importação (manter, gerar outro ou perguntar em caso de conflito): o domínio nunca o troca.
4. Gravar com atomicidade (transação) e manter cópia antes de qualquer atualização de formato; arquivo de versão mais
   nova **nunca** é regravado pelo app antigo.
5. Se for preciso detectar adulteração de contadores, proteger a integridade do arquivo (hash ou assinatura): o formato
   não consegue.
6. Guardar o `GraphLayout`, a câmera e a seleção em documentos próprios ligados ao `graph.id`, e metadados (datas,
   miniatura, progresso) fora do documento do grafo.
7. Aplicar as migrações de documento (seção Compatibilidade de versões) e as migrações do esquema SQL (versionadas,
   independentes entre si).
8. Traduzir cada `GraphError` em mensagem em português para o aluno.

## Decisões

1. **Rotas finas, telas em `features/`** — `src/app` só importa e exporta a tela; mantém o roteamento
   independente da UI e permite reaproveitar telas.
2. **`NativeTabs`** em vez de abas JS: barra nativa em Android e iOS, estável na SDK 58. Limitações da doc:
   não é substituto direto das abas JS e, na web, cai em implementação básica (a web não é alvo do produto).
   Abas sem cabeçalho nativo: cada tela desenha o próprio título (`Screen`).
3. **Poda do template**: removidos `@expo/ui`, `expo-image`, `expo-device`, `expo-web-browser`,
   `expo-glass-effect`, `reanimated`, `worklets` e `gesture-handler`; voltam na fase que os usa (os três e o
   `react-native-svg` voltaram na Fase 3, incremento 3.0). Mantidos
   `react-dom` e `react-native-web` apenas para pré-visualizar telas no navegador durante o desenvolvimento.
4. **Estado do tema** vem do esquema do sistema (`useColorScheme`); cores só via tokens. O contraste
   (WCAG AA, 4,5:1) é verificado por teste.
5. **Orientação travada em retrato** até a fase de tablets (Fase 13).
6. **React Compiler** permanece ligado como no template. Reavaliado no incremento 3.0 junto com worklets: continua
   ligado (a transformação do Babel e uma execução no emulador não acusaram conflito; ver "Editor visual (Fase 3)").
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
8. **Renderização (Fase 3):** SVG atrás do contrato `GraphRenderer` (props: cena, largura, altura), para trocar por Skia depois;
   implementada no 3.5 (somente leitura).
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

## Formato de persistência (esquema v1)

`serializeGraph(graph, { pretty? })` (em `serialization.ts`) produz um JSON **canônico, versionado e determinístico** do
`Graph`, sem depender do Expo SQLite nem de nada de interface. É a base da persistência local (Fase 5) e da importação
e exportação (Fase 13). A leitura com validação (`parseGraph`/`parseGraphJson`, Incremento 4.2) está na seção seguinte.

```json
{
  "schemaVersion": 1,
  "id": "g3",
  "name": "",
  "directed": true,
  "vertices": [ { "id": "v1", "label": "A" }, { "id": "v2", "label": "B" } ],
  "edges": [
    { "id": "e1", "source": "v1", "target": "v2", "weight": 0 },
    { "id": "e2", "source": "v2", "target": "v1" }
  ],
  "nextVertexSeq": 4,
  "nextEdgeSeq": 3
}
```

| Campo | Conteúdo |
| --- | --- |
| `schemaVersion` | versão do **layout** do documento, copiada de `Graph.schemaVersion` (hoje 1, `GRAPH_SCHEMA_VERSION`); sempre a primeira chave |
| `id`, `name` | identificação do grafo (o `id` vem de quem persiste; o domínio não gera ids aleatórios) |
| `directed` | orientação, global ao grafo |
| `vertices` | `{ id, label }`, na ordem de inserção |
| `edges` | `{ id, source, target, weight? }`, na ordem de inserção; em grafo orientado a aresta é o arco `source → target` |
| `nextVertexSeq`, `nextEdgeSeq` | contadores de ids, gravados **como estão** |

**Regras**
- **Ordem das chaves fixa**, a mesma do tipo `Graph`, e independente da ordem das propriedades do objeto recebido
  (o documento é montado por uma lista explícita de campos). Os arrays seguem a **ordem de inserção**, nunca ordem
  alfabética: a ordem faz parte do significado (desempate estável dos algoritmos).
- **`weight` só existe quando a aresta tem peso.** Sem peso (chave ausente), peso `0` e peso negativo continuam
  distintos no texto; aresta sem peso nunca ganha peso 1 (reusa o helper `weightField`).
- **Contadores não são recalculados.** Se `v3` foi removido, `nextVertexSeq` continua em 4; depois de restaurar o
  grafo, `v3` **não** é reaproveitado. O mesmo vale para as arestas.
- **Nada de interface.** Posição dos vértices, seleção, câmera e estado visual não entram (campos extras pendurados
  no objeto são ignorados). Cada um terá o seu próprio documento nas fases do editor.
- **Unicode:** o texto é Unicode; rótulos como "Königsberg" ou "日本語" saem sem escape, e só o que o JSON exige
  (aspas, barra invertida, caracteres de controle, substitutos soltos) é escapado. A codificação em bytes (UTF-8) é
  de quem grava o arquivo. Não há normalização Unicode.
- **`pretty` muda só a formatação** (recuo de 2 espaços, uma propriedade por linha, sem quebra de linha final): os
  dados e a ordem são idênticos aos do compacto, que é o padrão.
- **`id` e `name` do grafo estão no documento** para que `parseGraph(serializeGraph(g))` devolva o mesmo `Graph`.
  Ao importar um arquivo de outra instalação, quem persiste decide se mantém o `id` ou gera outro.

**Pré-condição e fronteira de validação.** `serializeGraph` trabalha com instâncias **válidas** de `Graph` e **não
valida nem corrige nada**: um grafo adulterado fora do domínio é gravado como está (versão estranha, contador menor
que os ids, ids repetidos), e `NaN`/`Infinity` viram `null` (o JSON não os representa). A rejeição desses documentos é
da fronteira de dados externos, o `parseGraph` (seção seguinte).

**Versionamento.** `schemaVersion` identifica o layout. Qualquer mudança nas propriedades (por exemplo uma
`capacity` por aresta, na Fase 12) **exige uma versão nova** e um leitor explícito para a antiga: o leitor v1 rejeita
versões e campos desconhecidos em vez de ignorá-los; um documento v1 nunca é relido como v2 sem uma **migração** que
diga o significado do campo novo (por exemplo, "sem capacity definida", nunca 1 nem infinito). Os arquivos de
referência de cada versão ficam em `golden/v<n>/` e não são editados depois de criados; versões novas ganham
diretório novo. Migrações **não** foram implementadas (só existe a versão 1).

**Complexidade** (V vértices, E arestas, L = total de caracteres dos textos: ids, rótulos, extremos e dígitos).
- **Tempo Θ(V + E + L):** montar o documento custa O(1) por elemento (as strings são reaproveitadas por referência,
  sem cópia) e `JSON.stringify` lê e escreve cada caractere uma vez. L **não** é constante por elemento: os ids
  `v<n>`/`e<n>` têm Θ(log n) caracteres, um rótulo criado pelo domínio tem até 64 pontos de código (até 128 unidades
  UTF-16) e um peso ocupa algumas dezenas de caracteres, então L = O(128·V + (V + E)·log(V + E)).
- **Tamanho do texto compacto (fórmula exata, conferida contra o texto real):** cabeçalho de 113 + |id| + |name|
  (− 1 se orientado; + 1 por dígito além do primeiro de cada contador); 20 + |id| + |label| por vértice;
  33 + |id| + |source| + |target| por aresta (+ 10 + |dígitos| com peso); mais uma vírgula entre elementos de cada
  array. O `pretty` soma Θ(V + E) caracteres de espaço em branco.
- **Espaço Θ(V + E) transitório** (objetos e arrays do documento) **+ Θ(texto)** para a string devolvida.
- **Por que o documento intermediário:** fixa a ordem das chaves e a lista de campos independentemente do objeto
  recebido. Escrever o texto diretamente evitaria esses objetos, mas duplicaria o escape e a formatação do JSON e foi
  **mais lento** na medição.

**Medição pontual** (Node 24.12, i5-11400H, 16 GB; um processo por estratégia e tamanho, 3 rodadas alternadas; E ≈ 4V,
`--expose-gc`; tempo = mediana). "impl" = o `serializeGraph`; "direto" = escritor de texto sem documento intermediário:

| Grafo | Texto | `serializeGraph` | escritor direto |
| --- | --- | --- | --- |
| V = 10 000, E = 40 000, rótulos curtos | 2,2 MB | 9,1 ms | 17,0 ms |
| V = 40 000, E = 160 000, rótulos curtos | 9,1 MB | 34,8 ms | 63,5 ms |
| V = 160 000, E = 640 000, rótulos curtos | 37,4 MB | 133,8 ms (`pretty`: 62,1 MB, 187,1 ms) | 433,6 ms |
| V = 40 000, E = 160 000, rótulos de 64 caracteres e pesos | 13,3 MB | 52,7 ms (`pretty`: 20,7 MB, 70,3 ms) | 136,9 ms |

O tempo cresceu linearmente com V + E (≈ 3,8× para 4× o tamanho); o texto ocupou ≈ 45 a 49 caracteres por elemento
(vértice ou aresta) com rótulos curtos e sem pesos, e ≈ 70 com rótulos de 64 caracteres e pesos; o `pretty` custou
≈ 55 a 66% mais caracteres e ≈ 33 a 40% mais tempo. A alocação transitória não foi medida (o Node usado não expõe o
total alocado). **Estes números são de Node/V8 num PC: não valem para Android ou iOS (Hermes) e não definem limite do
aplicativo.**

## Leitura e validação de documentos (esquema v1)

`parseGraph(input: unknown, options?)` e `parseGraphJson(text: string, options?)` (em `deserialization.ts`) são a
**fronteira de dados não confiáveis**: arquivo importado, banco, outra versão do app. Garantem que um `Graph` restaurado
obedece às mesmas invariantes de um `Graph` montado pelas operações do domínio. Devolvem `Result<Graph>` e **nunca
lançam**: JSON inválido, objetos hostis (getters, proxies que lançam), texto enorme e opções erradas viram `Result` de
erro. O documento é recusado **por inteiro** ao primeiro problema; nada é corrigido em silêncio.

**Opções** (`ParseGraphOptions`, todas opcionais). O domínio **não define valores padrão**: quem importa arquivos
(a camada de persistência) escolhe, e a escolha pode depender do aparelho.

| Opção | Significado |
| --- | --- |
| `maxVertices`, `maxEdges` | máximo de elementos de `vertices` e `edges`; conferido pelo `length` **antes** de ler qualquer elemento |
| `maxTextLength` | máximo de `text.length` (unidades UTF-16, não bytes) aceito por `parseGraphJson`; conferido **antes** do `JSON.parse`; ignorado por `parseGraph` |

Cada uma é `undefined` (sem limite) ou um inteiro seguro ≥ 0 (`0` vale). Outro valor devolve `INVALID_DOCUMENT` com
`reason: 'INVALID_OPTION'` e `path: 'options.maxVertices'` (etc.): é erro de **quem chama**, devolvido como valor para
manter a regra "nunca lança". Propriedades desconhecidas nas opções são ignoradas.

**Limite técnico × limites de produto.** São coisas diferentes:
- `maxVertices`, `maxEdges` e `maxTextLength` são **limites de produto** (política): o domínio não os define. A camada
  de persistência os escolherá, por aparelho ou por origem do arquivo, depois de medir em Hermes e em Android modesto
  (ROADMAP, tarefa 4.6).
- Há um único **limite técnico**, da implementação: `vertices` com mais de ⌊√(2⁵³−1)⌋ = 94 906 265 elementos é
  `LIMIT_EXCEEDED`. Ele vem da codificação numérica do par de extremos (`origem·V + destino`), que detecta arestas
  repetidas em Θ(V + E) e só é exata em `number` enquanto o produto cabe em 2⁵³. Está muito além do que cabe em memória
  (cada vértice ocupa dezenas de bytes e o texto passaria de 2 GB), vale junto de `maxVertices` (vence o menor) e foi
  **mantido de propósito**: trocar a codificação por chaves de texto o removeria, mas custaria ≈ 1,6× o tempo da
  validação medido (ver Medição) sem benefício no escopo previsto. Se um dia o produto precisar de mais, troca-se a
  codificação, sem mudar o formato nem a API.

**Regras do esquema v1**

| Parte | Regra |
| --- | --- |
| raiz | objeto simples com **exatamente** os 8 campos; `schemaVersion` é `1` |
| `id`, `name`, `directed` | texto, texto, booleano. O domínio não impõe mais nada (o `id` pode ser vazio) e a leitura também não |
| vértice `{ id, label }` | `id` **canônico** `v<n>` (n inteiro positivo seguro, sem zeros à esquerda, sinal ou espaços) e único; `label` **já normalizado**: o que `addVertex` aceitaria sem alterar (1 a 64 pontos de código, sem espaço nas pontas) |
| aresta `{ id, source, target, weight? }` | `id` canônico `e<n>` e único; `source`/`target` são vértices do documento; sem laço; sem repetição no sentido da orientação (arcos opostos valem em grafo orientado); `weight` ausente = sem peso, número finito = com peso |
| `weight` | `0` e negativos valem; `-0` vira `0`; `null`, `NaN`, `±Infinity`, texto e `undefined` explícito são recusados. **Ausente e `0` continuam diferentes** |
| `nextVertexSeq`, `nextEdgeSeq` | inteiros seguros ≥ 1 e **maiores que o sufixo de todos os ids presentes**; guardados como vieram, nunca recalculados pela quantidade de elementos |
| ordem | a do documento; nada é reordenado. Ids em ordem não crescente são aceitos (o domínio nunca os produz, mas nenhuma invariante depende disso) |

As regras de peso e de rótulo **são as mesmas do domínio** (`isValidWeight`, `normalizeWeight`, `checkLabel`, exportadas
de `graph.ts` mas não de `index.ts`), e um teste compara o leitor com `addVertex` e `addEdge` em centenas de casos
aleatórios, inclusive o **código** e a **ordem** do primeiro erro.

**Ordem das verificações** (o primeiro problema encontrado é o erro; é determinística):
1. opções; 2. (JSON) tamanho do texto e sintaxe; 3. a raiz é objeto; 4. **`schemaVersion`** (ausente, tipo, versão);
5. campos obrigatórios ausentes (na ordem do esquema) e depois campos desconhecidos; 6. tipos de `id`, `name`,
`directed` e validade dos contadores; 7. forma e limite de `vertices` e `edges`, sem olhar os elementos; 8. cada
vértice, na ordem (tipo do id → id canônico → id único → rótulo); 9. cada aresta, na ordem (tipos → id canônico → id
único → origem existe → destino existe → não é laço → peso → não repete, a mesma ordem do `addEdge`); 10. contadores
contra os ids. A versão vem antes de tudo porque decide *como* ler o resto: um documento v2 é "versão não suportada",
não "campo desconhecido".

**Erros.** Dois códigos novos em `GraphError`. Os erros só têm nomes de campos do esquema, índices, códigos e (na aresta
repetida) um id canônico já validado: **nunca texto ou valores do documento, nem referências a objetos da entrada**
(por isso um campo desconhecido é apontado pelo objeto que o contém, não pelo nome). O `JSON.parse` também não tem a
sua mensagem repassada (ela cita trechos do texto e muda entre motores).

| `code` | Campos | Quando |
| --- | --- | --- |
| `UNSUPPORTED_SCHEMA_VERSION` | `version: number`, `supported: number[]` | `schemaVersion` é um número diferente de 1 |
| `INVALID_DOCUMENT` | `path`, `reason`, `cause?` | qualquer outro problema do documento |

`path` é a propriedade (`vertices[2].label`, `edges[3].weight`, `nextVertexSeq`; `''` = o documento inteiro).
`reason` (`InvalidDocumentReason`):

| `reason` | Significado |
| --- | --- |
| `INVALID_JSON` | o texto não é JSON (inclui BOM no início e aninhamento que estoura o motor) |
| `NOT_AN_OBJECT`, `NOT_AN_ARRAY` | esperava objeto simples (não `null`, array, `Map`, instância de classe…) ou array |
| `SPARSE_ARRAY` | array com buraco; o `path` aponta o primeiro (`vertices[1]`) |
| `UNREADABLE` | getter/setter, propriedade oculta ou objeto que lança ao ser inspecionado (proxy) |
| `MISSING_FIELD`, `UNKNOWN_FIELD`, `WRONG_TYPE` | campo obrigatório ausente, campo fora do esquema, tipo errado em campo sem regra própria no domínio |
| `INVALID_ID`, `DUPLICATE_ID` | id que não é canônico; id repetido |
| `INVALID_COUNTER`, `COUNTER_TOO_LOW` | contador que não é inteiro seguro ≥ 1; contador não maior que os ids presentes |
| `LIMIT_EXCEEDED` | texto, `vertices` ou `edges` acima do limite configurado |
| `INVALID_OPTION` | opção inválida (erro de quem chama) |
| `DOMAIN_RULE` | regra do modelo violada; o motivo vem em `cause` |

`cause` (só com `DOMAIN_RULE`) usa os nomes do domínio, sem o valor do documento: `{ code: 'VERTEX_NOT_FOUND' }`,
`{ code: 'SELF_LOOP' }`, `{ code: 'DUPLICATE_EDGE', existingEdgeId }`, `{ code: 'INVALID_WEIGHT' }` e
`{ code: 'INVALID_VERTEX_LABEL', reason }` com `reason` em `NOT_A_STRING | EMPTY | TOO_LONG | NOT_NORMALIZED`
(`NOT_NORMALIZED`: o rótulo tem espaço nas pontas). Quando o domínio já tem regra para o valor (rótulo, peso), o erro é
`DOMAIN_RULE`; `WRONG_TYPE` fica para os campos que só o formato define.

Exemplos de retorno:

```ts
parseGraphJson('{"schemaVersion":1,')
// { ok: false, error: { code: 'INVALID_DOCUMENT', path: '', reason: 'INVALID_JSON' } }
parseGraph({ ...doc, schemaVersion: 2 })
// { ok: false, error: { code: 'UNSUPPORTED_SCHEMA_VERSION', version: 2, supported: [1] } }
parseGraph(doc)  // edges[3] liga v2 a v2
// { ok: false, error: { code: 'INVALID_DOCUMENT', path: 'edges[3]', reason: 'DOMAIN_RULE', cause: { code: 'SELF_LOOP' } } }
parseGraph(doc)  // vertices[2].label === ' C'
// { ok: false, error: { code: 'INVALID_DOCUMENT', path: 'vertices[2].label', reason: 'DOMAIN_RULE',
//                       cause: { code: 'INVALID_VERTEX_LABEL', reason: 'NOT_NORMALIZED' } } }
parseGraph(doc)  // nextVertexSeq 3, mas existe o vértice v3
// { ok: false, error: { code: 'INVALID_DOCUMENT', path: 'nextVertexSeq', reason: 'COUNTER_TOO_LOW' } }
parseGraphJson(text, { maxTextLength: 1_000_000 })  // text.length > 1 000 000, sem chamar o JSON.parse
// { ok: false, error: { code: 'INVALID_DOCUMENT', path: '', reason: 'LIMIT_EXCEEDED' } }
```

**Segurança: o que cada tipo de entrada recebe.** As garantias dependem de **como** o dado chega:

| Entrada | O que a leitura garante | O que ela não garante |
| --- | --- | --- |
| **Texto JSON** (`parseGraphJson`) | `maxTextLength` conferido antes do `JSON.parse` (se configurado); o `JSON.parse` só produz **dados puros** (sem getters, proxies, buracos ou protótipos próprios; `__proto__` vira propriedade própria e é recusado); toda a validação; erro de sintaxe e aninhamento que estoura o motor viram `Result` | custo Θ(L) do próprio `JSON.parse` sem `maxTextLength`; chave repetida no texto (vale a última); BOM |
| **Objeto JavaScript** recebido como `unknown` (`parseGraph`) | a mesma validação; objeto que não é simples, array esparso e propriedade que não é dado são recusados; o resultado não compartilha nada com a entrada; nunca lança | confiança em código: um objeto exótico pode fazer mais do que ser dado (ver Proxy) |
| **Objeto com getters ou setters** | nunca são executados: `UNREADABLE`, com o `path` da propriedade | — |
| **Proxy** | as armadilhas **são executadas** (ver abaixo); exceção vira `UNREADABLE`; leitura única por propriedade | **não é uma sandbox** |
| **Documento inválido** | `Result` de erro com `path` e `reason`, sem texto do documento; nunca um grafo parcial | — |
| **Limites configuráveis** | `maxVertices`, `maxEdges`, `maxTextLength` são aplicados antes de ler os elementos / antes do parse | valores padrão: são política de quem importa (ver Limite técnico × limites de produto) |

Para dados realmente não confiáveis (arquivo, rede, área de transferência) passe o **texto** a `parseGraphJson`; use
`parseGraph` com objetos que o próprio app produziu ou já decodificou.

- **Leitura defensiva.** Só se leem **propriedades próprias de dados**, por descritor, **cada uma uma vez**; os valores
  lidos é que são validados e copiados. Getters/setters nunca são executados (`UNREADABLE`) e `[[Get]]` nunca é usado.
- **Proxy: as armadilhas executam.** Operações reflexivas sobre um `Proxy` **executam as armadilhas dele**. A leitura
  aciona `ownKeys`, `getPrototypeOf` e `getOwnPropertyDescriptor`; um teste registra todas as armadilhas e confere que
  são só essas três (`get`, `has`, `set`, `defineProperty`, `deleteProperty` etc. nunca são acionadas). Mas o código do
  próprio proxy roda: pode ter efeitos colaterais, lançar (vira `UNREADABLE`, com o `path` do objeto), devolver valores
  diferentes a cada chamada (a leitura única impede que isso mude o resultado validado) ou chamar `parseGraph` de volta
  (o módulo não tem estado compartilhado). A leitura **não impede** que esse código faça o que quiser, nem que demore,
  nem que finja um array sem fim quando não há `maxVertices`/`maxEdges`.
- **Objetos simples.** Protótipo nulo ou um protótipo-raiz (o `Object.prototype` de qualquer realm); instâncias de
  classe, `Map`, `Date` e arrays no lugar de objetos são `NOT_AN_OBJECT`. Propriedades herdadas são ignoradas. Chaves
  desconhecidas, símbolos e propriedades ocultas recusam o documento, o que inclui `__proto__`, `constructor` e
  `prototype`: o texto `{"__proto__": …}` cria uma propriedade **própria** com esse nome (não troca o protótipo) e cai
  nessa regra. Testes conferem que `Object.prototype` não muda.
- **Resultado reconstruído.** Montado só com valores verificados, em objetos e arrays **novos** (nada de
  `Object.assign`, spread ou cópia de protótipo): não compartilha objeto ou array com a entrada, e alterar a entrada
  depois não muda o grafo. Strings são imutáveis e compartilhadas por referência, o que é seguro.
- **Alocação.** Os arrays nunca são pré-alocados pelo `length` declarado; `length > limite` é recusado antes de ler
  qualquer elemento; um array esparso é recusado no primeiro buraco (mesmo com `length` 2³² − 1); um id gigante é
  recusado em O(1) pelo comprimento; um rótulo gigante não vira lista de pontos de código (`checkLabel` corta em 128
  unidades UTF-16). Não há recursão própria (a profundidade de inspeção é fixa).

**Limitações conhecidas** (documentadas, não corrigíveis no formato):
- **Contadores e ids históricos.** Um documento só prova que os contadores são maiores que os ids **presentes**. Os ids
  de elementos removidos não existem mais no arquivo, então `nextVertexSeq: 4` com os vértices `v1` e `v2` tanto pode
  ser um grafo legítimo em que `v3` foi removido quanto um documento adulterado que baixou o contador de 9 para 4
  (e faria `v3` ser reemitido). A defesa é de integridade do arquivo (assinatura, banco local), não do formato; um teste
  fixa esse comportamento.
- **Chaves repetidas no texto** (`{"id":"a","id":"b"}`): o `JSON.parse` do ECMAScript fica com a última e o parser não
  enxerga as outras; o resultado é bem definido e o `serializeGraph` nunca as produz.
- **BOM** no início do texto não é JSON válido e é recusado; retirá-lo, se for o caso, cabe a quem lê o arquivo.
- **`id` do grafo** vem do documento e **não é trocado**: duplicar ou renomear na importação é decisão da camada de
  persistência.
- `maxTextLength` mede `text.length` (unidades UTF-16); o limite em bytes do arquivo cabe a quem o lê.

**Complexidade** (V vértices, E arestas, L = comprimento do texto):
- **`JSON.parse`** (só `parseGraphJson`): Θ(L) em tempo e Θ(L) em espaço (a árvore de objetos e strings do documento),
  que pode ser coletada quando a função retorna. É o piso do custo e não depende do modelo.
- **Inspeção:** Θ(V + E) descritores lidos (no máximo 2 por vértice, 4 por aresta, 1 por campo simples) e um `ownKeys`
  por objeto, todos de tamanho constante.
- **Validação do modelo:** Θ(V + E) esperado, com índices de hash: `Map` id do vértice → posição (unicidade dos ids e
  busca das extremidades), `Set` dos números de sequência dos ids de aresta (ids canônicos e números se correspondem 1
  a 1, e chaves inteiras custam bem menos que strings) e `Map` do par de extremos → id da aresta, com a chave inteira
  `origem·V + destino` (posições dos vértices; no não orientado, a menor posição primeiro). Sem esses índices seriam
  Θ(E²) para as arestas repetidas e Θ(V·E) para achar as extremidades. Cada id custa O(1) (≤ 17 caracteres, checado
  antes de varrer), cada rótulo O(|rótulo|) com o texto cortado em 128 unidades; `id` e `name` do grafo são copiados por
  referência. "Esperado" porque a tabela de hash tem custo médio O(1) por operação.
- **Total Θ(L + V + E).** Espaço além do `JSON.parse`: Θ(V + E) (listas de elementos lidos, `Set`, `Map` e o `Graph`
  devolvido). O tamanho **real** do texto escapado entra em L: ver a fórmula de tamanho na seção anterior (≈ 45 a 49
  caracteres por elemento com rótulos curtos, ≈ 70 com rótulos de 64 caracteres e pesos). Um texto em que acentos e
  emojis vêm escritos como escapes com barra invertida é maior que o canônico, mas o custo continua linear em L.

**Medição pontual** (Node 24.12, i5-11400H, 16 GB; um processo por estratégia e tamanho, 3 rodadas alternadas; E ≈ 4V,
`--expose-gc`; tempo = mediana; "curto" = rótulos A, B… sem pesos; "longo" = rótulos de 64 caracteres e peso em toda
aresta). `JSON.parse` e a validação são medidos **separadamente**: "validação" = `parseGraph` sobre o objeto já
decodificado; `parseGraphJson` = texto → grafo.

| Grafo | Texto | `JSON.parse` | validação (`parseGraph`) | `parseGraphJson` | cópia estrutural sem validar |
| --- | --- | --- | --- | --- | --- |
| V = 10 000, E = 40 000, curto | 2,2 MB | 13,1 ms | 42,6 ms | 58,3 ms | 1,9 ms |
| V = 40 000, E = 160 000, curto | 9,1 MB | 64,0 ms | 187,6 ms | 244,7 ms | 7,1 ms |
| V = 160 000, E = 640 000, curto | 37,4 MB | 384,7 ms | 980,9 ms | 1 448,5 ms | 24,7 ms |
| V = 40 000, E = 160 000, longo | 13,3 MB | 95,2 ms | 213,4 ms | 305,6 ms | 8,1 ms |

- **Crescimento:** para 4× o tamanho, a validação levou ≈ 4,4× e ≈ 5,2× (e `parseGraphJson` ≈ 4,2× e ≈ 5,9×):
  um pouco acima do linear (tabelas de hash maiores que o cache e coleta de lixo), longe do quadrático (16×).
- **Quem custa o quê:** a validação custou ≈ 2,2× a ≈ 3,3× o `JSON.parse`, ou seja, ≈ 0,9 µs a ≈ 1,2 µs por elemento
  (vértice ou aresta): o preço de inspecionar e validar cada objeto. A cópia estrutural sem validar (≈ 0,04 µs por
  elemento) é só o piso do custo de montar o resultado.
- **Preço da leitura defensiva** (descritores em vez de `obj[chave]`, que executaria getters): ≈ 1,3× a ≈ 1,8× o tempo
  de uma variante direta e **insegura** usada só nesta medição. Foi mantida: é o que impede a execução de getters e
  o uso do `[[Get]]` em proxies.
- **Memória:** o `Graph` devolvido retém ≈ o mesmo que a árvore do `JSON.parse` (43,3 MB contra 41,5 MB em V = 160 000).
  O pico (árvore + índices + resultado) **não foi medido**; deve ficar na ordem de 2× a 3× o resultado.
- A primeira versão usava `Set`/`Map` com chaves de texto (`"v1|v2"`) para os ids e pares e levou ≈ 300 ms em V = 40 000;
  trocá-las por posições e chaves numéricas (`origem·V + destino`) deixou-a em ≈ 190 ms, sem mudar o resultado.
- **Estes números são de Node/V8 num PC: não valem para Android ou iOS (Hermes) e não definem limite do aplicativo.**
  A decisão dos limites padrão (`maxVertices` etc.) fica para a camada de persistência, depois da medição em aparelho
  modesto (ROADMAP, Fase 4).

## Compatibilidade de versões e migrações futuras

**Regras em vigor** (esquema v1; verificadas por `persistence-contract.test.ts`):
1. `schemaVersion` identifica o layout do documento e é a primeira chave. O leitor v1 **só lê v1**.
2. Versão numérica diferente de 1 → `UNSUPPORTED_SCHEMA_VERSION { version, supported }`, e **a versão vence qualquer outro
   defeito** do documento (campos novos, campos ausentes, tipos errados), porque decide como ler o resto. Provado com
   dois documentos fictícios da v2 (um **aditivo**, com `capacity`, `kind` e `layout`; outro **reestruturado**, com
   campos renomeados e movidos) e com 900 corrupções aleatórias de arquivos de referência. Versão que não é número é
   tipo errado, não "versão futura". **Exceção documentada:** a raiz é inspecionada antes da versão, então um objeto
   exótico (getter em campo do esquema, proxy que lança) dá `UNREADABLE` antes; documento vindo de texto JSON nunca cai
   aí.
3. **Sem migração silenciosa e sem "melhor esforço":** nenhum campo é ignorado e nenhum grafo parcial é devolvido (o
   resultado de erro tem só `ok` e `error`). Só o número da versão separa o aceito do recusado, nos dois sentidos: um
   v1 válido com o número trocado para 2 é recusado, e um v2 com o número trocado para 1 também (campos desconhecidos).
4. **Arquivos de referência são contratos.** `golden/v1/` é escrito à mão e **nunca regenerado**; uma versão nova ganha
   `golden/v2/` e a v1 não muda. O teste de contrato lista a pasta e fixa os nomes dos arquivos: acrescentar, remover
   ou renomear um arquivo de referência exige mudar o teste, ou seja, uma decisão explícita e justificada no
   ROADMAP. A verificação de conteúdo exato (serializador e leitor conferem o texto byte a byte, e o leitor ainda o
   compara com grafos escritos à mão em outro arquivo) é **suficiente**; hashes não acrescentariam proteção, porque
   alterar o arquivo e o serializador e o grafo escrito à mão juntos já é a decisão explícita que se quer tornar visível.
5. **Quando exigir versão nova:** qualquer mudança no conjunto de campos ou no significado de um campo, inclusive
   acrescentar um campo opcional (o leitor anterior rejeita campos desconhecidos de propósito).

**Estratégia futura de migrações** (planejada, **não implementada**: só existe a v1):
- **Um leitor por versão.** `parseGraph` continua sendo `unknown → Result<Graph>`. Ele inspeciona a raiz, lê o
  `schemaVersion` (como hoje) e despacha para o leitor daquela versão (`readV1`, depois `readV2`…). **Todo leitor
  devolve o `Graph` atual**: o leitor v1 de um app v2 lê um documento v1 e produz um `Graph` em que os campos novos
  ficam como o modelo define para "não informado" (por exemplo, aresta sem `capacity`, **nunca** 1 nem infinito). Assim os
  erros de leitura sempre têm `path` relativo ao documento que foi de fato lido, e não a um documento intermediário.
- **Leitores antigos ficam congelados**, com os testes e os arquivos de referência da sua versão; só se acrescenta.
- **A escrita é sempre na versão atual** (`GRAPH_SCHEMA_VERSION`). O conjunto das versões **lidas** é o campo `supported`
  do erro (hoje `[1]`, depois `[1, 2]`), e o app antigo que abre arquivo mais novo recebe `UNSUPPORTED_SCHEMA_VERSION`,
  explica ao aluno que o arquivo vem de uma versão mais nova e **não o regrava**.
- **Ler um arquivo antigo não o reescreve.** Quem decide regravar na versão nova (e guardar cópia antes) é a camada de
  persistência.
- **Lista de verificação de uma mudança de versão:** (1) aumentar `GRAPH_SCHEMA_VERSION`; (2) criar `golden/v<n>/` à
  mão; (3) escrever o leitor `readV<n>` e seus testes; (4) manter o leitor anterior e os arquivos anteriores sem
  alteração; (5) estender o teste de contrato para que **todo** arquivo de **toda** versão seja lido pelo
  `parseGraph` atual e regravado na versão atual; (6) atualizar esta seção e o ROADMAP.
- As migrações do **esquema SQL** (`expo-sqlite`, Fase 5) são independentes das do documento.

## Editor visual (Fase 3): fundação (incremento 3.0)

O 3.0 prepara a infraestrutura; **não há editor**. Entregou dependências, a raiz de gestos, as fronteiras de
arquitetura do núcleo puro, o ambiente de testes e esta especificação. O plano dos incrementos está no ROADMAP.

### Dependências e compatibilidade

| Pacote | Instalado | SDK 58 recomenda | Faixa de React Native declarada pelo fornecedor |
| --- | --- | --- | --- |
| `react-native-svg` | 15.16.0 | 15.16.0 | peer `*` |
| `react-native-gesture-handler` | 3.3.0 | `~3.3.0` | peer `*`; tabela da doc: **3.3.x até 0.87, 3.4.x de 0.85 a 0.88** |
| `react-native-reanimated` | 4.7.1 | 4.7.1 | 0.86 a 0.88 (`compatibility.json` do pacote); exige `react-native-worklets` 0.13.x e a Nova Arquitetura |
| `react-native-worklets` | 0.13.0 | 0.13.0 | 0.86 a 0.88 (`compatibility.json` do pacote) |

- **Estado anterior.** `gesture-handler` 3.4.0, `reanimated` 4.7.1 e `worklets` 0.13.1 já estavam em `node_modules`,
  mas **só como peers opcionais do `expo-router`** (não apareciam no `package.json`; por isso `expo install --check`
  não os acusava). Instalá-los como dependências diretas fixou as versões da SDK: `gesture-handler` voltou de 3.4.0
  para 3.3.0 e `worklets` de 0.13.1 para 0.13.0. `zustand` **não** foi instalado no 3.0 (entrou no incremento 3.4, versão 5.0.16).
- **Divergência investigada (Gesture Handler × React Native 0.88).** O Expo recomenda `~3.3.0`, e a tabela da documentação do
  fornecedor marca 3.3.x como **não** listada para o RN 0.88 (3.4.x é a que lista). Resultado da investigação:
  1. os `peerDependencies` são `react: *` e `react-native: *`, então o npm não impõe nada;
  2. o texto da tabela diz que o pacote "suporta as três últimas versões menores do React Native": é **política de
     suporte**, e a página não descreve incompatibilidade que impeça compilar ou rodar;
  3. as notas da 3.4.0 trazem "Bump to React Native 0.88" como item de manutenção (não como correção de erro) e as
     da 3.3.0 não mencionam o 0.88;
  4. o Expo Go 58 já traz o código **nativo** da 3.3.0: o JavaScript precisa ser da mesma versão, então instalar a
     3.4.0 sobre esse binário seria um descompasso;
  5. na prática, no Expo Go 58.0.5 (Android 13) com RN 0.88.1, toque, arrasto, Reanimated na thread da interface e
     `scheduleOnRN` funcionaram, sem avisos no log.
  **Decisão:** manter a 3.3.0 recomendada pelo Expo, **sem alterar** dependências. Reavaliar subir para a 3.4.x quando
  a lista da SDK mudar ou quando houver development build (aí a versão nativa passa a ser escolha do projeto).
- **Development build:** **não é necessário** nesta etapa (as quatro bibliotecas estão no Expo Go da SDK 58). Se um dia
  for (comandos): `npx expo install expo-dev-client`, depois `npx expo run:android` (SDK Android e Java 17 já existem
  no ambiente) ou `npx eas-cli@latest build --profile development --platform android`.
- **Fora do escopo, não instalado:** bottom sheet, Skia, `expo-dev-client` (o `zustand` entrou no 3.4).

### Configuração

- **`GestureHandlerRootView`** envolve todo o app em `src/app/_layout.tsx` (`style={{ flex: 1 }}`), por fora do
  `ThemeProvider` e da `Stack`. A documentação do Gesture Handler pede o componente "o mais perto da raiz possível" e
  só reconhece gestos dentro dele. Rotas, telas e estilos não mudaram.
- **Babel:** nenhum `babel.config.js`. O `babel-preset-expo` acrescenta sozinho o plugin `react-native-worklets/plugin`
  quando o pacote está instalado. Conferido com o Babel real (`caller` do Metro, Android): os 4 worklets de um
  exemplo (callbacks de `useTapGesture` e `usePanGesture` e o de `useAnimatedStyle`) são transformados **com e sem**
  o React Compiler.
- **React Compiler** (ligado em `app.json`): o `babel-preset-expo` o ativa pelo `caller` e exclui `node_modules`.
  A documentação consultada do Reanimated e do Worklets **não trata** do compilador; a verificação foi empírica: o
  exemplo compila, e no emulador o pan com valor compartilhado funcionou com o compilador ligado. Regra prática:
  escrever em `sharedValue.value` só dentro de worklets e callbacks (nunca durante a renderização) e usar a diretiva
  `'use no memo'` num arquivo se o compilador atrapalhar.
- **Jest (projeto `app`, `jest.config.js`):** `resolver: 'react-native-reanimated/jest/resolver'` (no Jest, Reanimated
  e Worklets usam a implementação em JS), `setupFiles` com `react-native-gesture-handler/jestSetup` (mocks do módulo
  nativo e habilita `react-native-gesture-handler/jest-utils`) e `jest.setup.js` (o Gesture Handler 3 chama
  `getUIRuntimeHolder`, que na implementação em JS lança; o setup o substitui por uma função que devolve `{}`);
  `testTimeout` de 30 s, porque com o cache de transformação vazio o primeiro render de uma rota passou dos 5 s
  padrão. Gestos nos testes: `createGestureController(getByGestureTestId(id))` com `begin/activate/update/end` dentro
  de `await act(...)` (o RNTL 14 é assíncrono).
- **Jest (projeto `editor-core`):** Node puro, sem React Native, com `moduleNameMapper` para o alias `@/`, mesmo
  Babel do projeto `domain`. O projeto `app` ignora a pasta `core`.
- **ESLint:** `no-restricted-imports` vale em `src/domain/**` e em `src/features/graph-editor/core/**`. As duas camadas
  barram React, React Native (e todo `react-*`: SVG, gestos, Reanimated, Worklets), Expo, `@shopify/*`, `zustand` e
  qualquer `@/` fora do permitido (domínio: só `@/domain`; núcleo: `@/domain` e `@/features/graph-editor/core`). O
  núcleo ainda barra JSX. A negação por `!` do `group` não reabilita um caminho cujo diretório pai foi barrado, então
  os aliases permitidos usam `regex`. `core/boundary.test.ts` roda o ESLint de verdade sobre trechos de código e confere
  o que é barrado e o que passa; ele também confere, por varredura dos arquivos, os imports **relativos** que saem da
  pasta `core`, que o ESLint não enxerga.

### Verificação no Android (30/10/2026)

Ambiente: emulador `Pixel_6` (Android 13), Expo Go 58.0.5, Metro iniciado com `npx expo start`, `adb reverse`.
- **App real** (com a raiz de gestos): a Início carrega em tema escuro (esquema do sistema), o cartão "Abrir o
  Laboratório" leva ao Laboratório e a barra de abas nativa troca para Aprender. Sem avisos ou erros no log do
  `ReactNativeJS` e no Metro. O primeiro carregamento com o cache do Metro vazio levou ≈ 55 s (1949 módulos); abrir a
  rota antes disso mostrou "Something went wrong" do Expo Go, e abrir de novo depois do bundle resolveu.
- **Tela de teste descartada** (não está no repositório): `Svg` com `Line`, `Circle` e `Text` renderizou; `Animated.View`
  com valor compartilhado, `usePanGesture` e `scheduleOnRN` funcionaram (um arrasto de 520 px entregou o último
  deslocamento ao JavaScript e a caixa voltou com `withSpring`); `useTapGesture` no fundo contou os toques.
- **Não verificado:** iOS (sem macOS); aparelho físico; TalkBack; **pinça** (o `adb` não gera dois dedos); development
  build; o tema claro do app (o emulador estava em tema escuro); desempenho com muitos elementos.

### Gestos sobre elementos SVG: achado e decisão

O Gesture Handler 3 permite anexar um gesto a um elemento do `react-native-svg` com `InterceptingGestureDetector`
(em volta do `<Svg>`) e `VirtualGestureDetector` (em volta do `<Circle>`, por exemplo). No emulador:
- **sem** `onPress` no `Circle`, um toque no círculo foi entregue ao gesto do **fundo** (o detector virtual não disparou);
- **com** `onPress={() => {}}` no `Circle` (como no exemplo da documentação, que não explica o motivo), o detector virtual
  passou a receber os toques do círculo e o fundo deixou de receber esses toques.
Ou seja, para o hit-testing do SVG um elemento só vira alvo de toque se tiver um manipulador de toque. **Decisão de
arquitetura:** o editor **não** usa detectores por elemento. Haverá **um detector no canvas inteiro** (toque, arrasto,
pinça e toque longo compostos) e **o hit-testing é feito pelo núcleo puro**, em coordenadas de tela, independentemente
do SVG. Motivos: (1) não depende desse detalhe não documentado; (2) não cria um gesto por vértice e por aresta (centenas
de instâncias de hooks); (3) vale igual para um renderizador Skia; (4) é testável em Node; (5) o alvo de toque em
unidades de tela (≈ 48 dp) é independente do desenho.

### Camadas do editor

- **A. Domínio** (`src/domain/graph`): fonte da verdade de vértices, arestas, orientação, pesos, propriedades,
  representações, serialização e leitura. **Nada visual dentro de `Graph`; o JSON v1 não muda.**
- **B. Núcleo puro** (`src/features/graph-editor/core/`): TypeScript sem React, RN, Expo, JSX, gestos, SVG, animação nem
  Zustand. Importa só o domínio e a si mesmo. Responsabilidades futuras (um módulo por incremento): coordenadas de
  mundo e de tela e transformações da câmera (3.1: `worldToScreen`, `screenToWorld`, `zoomAt`, `fitToBounds`);
  `GraphLayout` e posicionamento (3.2: `placeVertex`, `moveVertex`, `boundsOf`, `circularLayout`, `reconcileLayout`);
  geometria das arestas e identificação por posição (3.3: `edgeGeometry`, `edgeGeometries`, `hitTestVertex`, `hitTestEdge`,
  `hitTest`); comandos do editor, histórico e mensagens de erro (3.4: `applyAction`, `createEditorState`, `nextFreeLabel`,
  `graphErrorMessage`); cena do grafo e enquadramento inicial (3.5: `buildGraphScene`, `fitCameraToGraph`,
  `graphContentBounds`); toque em ação (3.6: `tapToEditorAction`); máquina de estados do modo Conectar e texto de estado (3.7: `connectStep`, `reconcileConnection`, `tapToConnectTransition`, `connectStatusMessage`); seleção por toque, conversão do texto de peso, propriedades e exclusão com confirmação (3.8: `tapToSelectionAction`, `selectionStatusMessage`, `parseWeightInput`, `describeProperties`, `describeDeletion`, `confirmedDeletionAction`); arrasto de vértice e a prévia (3.9: `startDrag`, `dragPreviewPosition`, `finishDrag`, `planDragPreview`, `buildDragPreview`); câmera por gesto e por comando e o dono do deslize (3.10: `panFromAnchor`, `pinchFromAnchor`, `centerCamera`, `fitGraphCamera`, `cameraForResize`, `gestureOwnerAt`); modelo de apresentação das quatro representações da Fase 2 (3.11: `buildRepresentationView`, `listLines`). Hoje a pasta tem `index.ts` (contrato e exportações), `camera.ts` (3.1), `layout.ts` (3.2),
  `geometry.ts` (3.3), `editor.ts` e `error-messages.ts` (3.4), `scene.ts` (3.5), `tap.ts` (3.6), `connect.ts` e `connect-status.ts` (3.7), `selection.ts`, `weight-input.ts`, `properties.ts` e `deletion.ts` (3.8), `drag.ts` e `drag-preview.ts` (3.9), `camera-gesture.ts` e `gesture-start.ts` (3.10), `representation-view.ts` (3.11), seus testes (`*.test.ts`, mais
  `boundary.test.ts`), e `test-helpers.ts` (gerador de sementes e `deepFreeze`, só para testes).
- **C. Interface** (`src/features/graph-editor/`): desenha vértices e arestas, recebe os toques e os traduz em
  **ações** do núcleo, mostra controles, propriedades e representações, executa animações. Não decide regras do grafo
  nem faz geometria.
- **Store Zustand** (3.4, `graph-editor/editor-store.ts`): liga A, B e C. Guarda o `EditorState` do núcleo
  (`{ graph, layout, selection, mode, history, error? }`) e só **chama** `applyAction` e `createEditorState`; nenhuma
  regra mora na store nem em componentes. A **câmera** é estado de tela, fora do desfazer, e entra na store geral com a
  interface. Dependências só para baixo: C → store → B → A.

### Câmera (incremento 3.1: `core/camera.ts`)

TypeScript puro; nenhum gesto, SVG, animação nem store. A interface (3.5 em diante) e os gestos (3.10) só chamam
estas funções.

**Espaços e unidades.** *Mundo*: onde o grafo "mora", em unidades de mundo independentes do aparelho (é o espaço do
`GraphLayout`). *Tela*: o que o aluno vê, em **dp** (unidades lógicas de layout do React Native, **não** pixels
físicos), com a origem no canto superior esquerdo da **área de desenho** (`Viewport`), não da janela. Nos dois, **X
cresce para a direita e Y para baixo**; escala **uniforme**; **sem rotação**.

**Convenção.** `Camera = { x, y, scale }` e
```text
telaX = mundoX · scale + camera.x          mundoX = (telaX − camera.x) / scale
telaY = mundoY · scale + camera.y          mundoY = (telaY − camera.y) / scale
```
`(camera.x, camera.y)` é onde a **origem do mundo** aparece (em dp) e `scale` é quantos dp vale 1 unidade de mundo. A
câmera neutra `NEUTRAL_CAMERA = { x: 0, y: 0, scale: 1 }` é a identidade. Câmera **válida**: `x` e `y` finitos e `scale`
finita e `> 0` (pré-condição; `isValidCamera` confere nas fronteiras). Exemplo calculado à mão: câmera `(20, 10, 2)` leva
o ponto `(5, 8)` a `(30, 26)`.

**API** (exportada por `core/index.ts`; tipos `Point`, `Camera`, `Viewport`, `Bounds`, `ScaleLimits` e
`FitToBoundsOptions`, todos `readonly`; `NEUTRAL_CAMERA` e `DEFAULT_SCALE_LIMITS` são congelados porque são compartilhados):

| Função | O que faz |
| --- | --- |
| `worldToScreen(camera, point)`, `screenToWorld(camera, point)` | as fórmulas acima, uma a inversa da outra (a menos do arredondamento) |
| `zoomAt(camera, focus, factor, limits?)` | multiplica a escala por `factor` mantendo o ponto do mundo sob `focus` (em dp) **no mesmo lugar da tela** |
| `panBy(camera, delta)` | soma `delta` (dp) à translação; o conteúdo acompanha o dedo; a escala não muda |
| `centerOn(camera, worldPoint, viewport)` | leva um ponto do mundo ao centro da área de desenho, mantendo a escala |
| `fitToBounds(camera, bounds, viewport, options?)` | enquadra um retângulo do mundo: maior escala possível, dentro dos limites, conteúdo centrado |
| `clampScale(scale, limits?)`, `isValidCamera(camera)` | auxiliares (os gestos vão limitar a pinça com o primeiro) |

**Fórmulas.**
- *Zoom ancorado.* O ponto do mundo sob o foco é `w = (focus − camera) / escala`; exigir que ele continue em `focus`
  depois do zoom dá `camera' = focus − w · escalaNova`, isto é, com `razão = escalaNova / escalaAtual`:
  `x' = focus.x − (focus.x − camera.x) · razão` (e igual em Y). A escala efetiva é `clampScale(escala · fator, limits)`, e
  **a razão usada é a efetiva, não o fator pedido**: assim o foco continua parado mesmo quando o limite corta o zoom
  (de escala 1, o fator 8 vira escala 4, razão 4; com razão 8 o foco andaria).
- *Centralizar.* `x' = largura/2 − ponto.x · escala`, `y' = altura/2 − ponto.y · escala`.
- *Enquadrar.* Área útil = viewport − 2 · margem por eixo (margem em dp, nos quatro lados); escala desejada =
  `min(útilX / largura, útilY / altura)` sobre os eixos com tamanho > 0; escala = `clampScale(desejada, limits)`; centro
  = `(minX + largura/2, minY + altura/2)` levado ao centro do viewport. O centro usa `min + metade` (não `(min + max)/2`)
  para não estourar com valores enormes.

**Limites de escala provisórios:** `DEFAULT_SCALE_LIMITS = { min: 0.25, max: 4 }`, a ajustar depois de testes em aparelhos.

**Casos degenerados e entradas inválidas** (nenhuma função lança; nenhuma devolve `NaN`, `Infinity` nem `-0` com câmera
válida):
- As funções que devolvem câmera devolvem **a própria câmera recebida (mesma referência)** quando um argumento é
  inválido (fator não finito ou ≤ 0, foco, deslocamento ou ponto não finitos, viewport com largura ou altura ≤ 0 ou não
  finita, limites inválidos, margem negativa ou não finita) ou quando a conta estoura; nada é "consertado" em silêncio, e
  quem chama detecta a recusa com `resultado === camera`. Também devolvem a mesma referência quando nada muda (fator 1,
  escala já no limite).
- `fitToBounds`: margem que não deixa área útil (`2·margem ≥ largura ou altura`) é inválida; `bounds` com valor não
  finito, `min > max` ou largura/altura que estoura é inválido; **grafo sem vértices** (`bounds` indefinido) volta à
  **câmera neutra** (com a escala 1 limitada), pois não há o que enquadrar; **um único vértice** (largura e altura zero) usa
  escala 1 limitada e o ponto vai ao centro; **largura ou altura zero** (vértices alinhados): a escala vem do outro eixo.
  A câmera atual **não** influencia o enquadramento; é só o valor devolvido nos casos inválidos.
- **Limites de escala que impedem o enquadramento completo:** a escala válida é mantida, o conteúdo continua centrado e
  **pode exceder o viewport** (escala mínima) ou ficar pequeno (máxima); a escala nunca é forçada para fora dos limites.
- `worldToScreen` e `screenToWorld` são as fórmulas puras: com câmera ou ponto inválido o resultado pode não ser finito
  (os tipos garantem a forma dos objetos; só valores numéricos inválidos são tratados). `clampScale(NaN)` vale como a
  escala neutra (1) limitada. Resultados `-0` são normalizados para `0`, como no peso das arestas.

**Complexidade.** Todas as funções são **O(1)** em tempo e espaço (um número fixo de contas e de objetos pequenos).
`fitToBounds` também é O(1) **porque recebe os limites do conteúdo já calculados**; calcular esses limites a partir de
todas as posições (`boundsOf`, 3.2: `core/layout.ts`) é **Θ(V)**, uma varredura.

**Precisão.** Cada conversão faz uma multiplicação (ou divisão) e uma soma, então o erro relativo fica em torno de
10⁻¹⁶ vezes a magnitude dos valores intermediários; os testes usam tolerância relativa de 10⁻⁹ a essas magnitudes
(coordenadas na casa de 10¹² incluídas) em vez de uma exigência absoluta.

### `GraphLayout` (incremento 3.2: `core/layout.ts`)

TypeScript puro: não desenha, não escuta toques, não conhece a câmera nem a store. Do `Graph` lê só o `id` e a ordem dos
vértices; o domínio e o JSON v1 não mudaram.

**Estrutura.**
```ts
type GraphLayout = {
  readonly graphId: Graph['id'];                                   // grafo dono
  readonly positions: Readonly<Record<VertexId, Readonly<Point>>>; // id técnico → { x, y } em unidades de mundo
};
```
- **Chave = id técnico** (`v1`, `v2`…), **nunca o rótulo**: renomear um vértice não mexe na posição, e rótulos repetidos
  não causam ambiguidade. **Unidades:** as de **mundo** (as mesmas da câmera; eixo y para baixo, origem livre), nunca
  coordenadas de tela. Números finitos; `-0` vira `0`.
- **Não é parte do `Graph`** nem do modelo matemático. Mover um vértice **só** muda o layout (um passo de histórico); a
  referência do `Graph` se preserva, então as representações memorizadas não são recalculadas. Não carrega câmera,
  seleção nem animação.
- **Por que `graphId` (decisão, ajuste da especificação do 3.0, que previa só `positions`).** Todo grafo tem `v1`, `v2`…:
  um layout sem dono se aplicaria em silêncio a qualquer outro grafo, e uma store que trocasse o grafo sem trocar o layout
  produziria posições erradas sem aviso. A alternativa mais simples (o `graphId` só no documento gravado, com a store
  mantendo o par coerente) deixa essa invariante a cargo de quem chama. Com `graphId`, `reconcileLayout` **recusa**
  reaproveitar posições de outro grafo. O custo é uma `string` por layout, e o campo é exatamente o `graphId` do futuro
  documento de layout (3.13), ao qual falta só o `schemaVersion`.

**API** (exportada por `core/index.ts`; todas puras, nenhuma lança):

| Função | O que faz |
| --- | --- |
| `emptyLayout(graphId)` | layout sem posições |
| `positionOf(layout, id)` | posição ou `undefined`; só propriedades **próprias** |
| `placeVertex(layout, id, ponto)` | **acrescenta** a posição de um vértice que ainda não tem; se já tem, devolve o **mesmo layout** (nada é sobrescrito em silêncio) |
| `moveVertex(layout, id, ponto)` | muda a posição (absoluta) de um vértice que **já** tem; sem posição, devolve o mesmo layout (nada é criado) |
| `removePosition(layout, id)` | remove uma posição; as demais ficam como estavam |
| `boundsOf(layout)` | `Bounds` (do `camera.ts`) dos **centros**; `undefined` sem posições, que é o "sem conteúdo" do `fitToBounds` |
| `circularLayout(graph, { spacing?, minRadius? })` | posicionamento inicial determinístico (abaixo) |
| `reconcileLayout(graph, layout, { spacing? })` | faz o layout valer para o grafo (abaixo) |

Convenção de recusa, a mesma da câmera: coordenada não finita em `placeVertex`/`moveVertex`, ou operação que não muda nada,
devolve **o mesmo objeto** (`resultado === layout`). `spacing` e `minRadius` inválidos (não finitos, `spacing ≤ 0`,
`minRadius < 0`) valem o padrão, sem exceção. `DEFAULT_LAYOUT_SPACING = 96` unidades de mundo.

**Invariantes de imutabilidade e de chaves.**
- O layout, o objeto `positions` e cada `Point` são **congelados**; toda atualização devolve um layout **novo**. Os `Point`
  existentes são reaproveitados entre layouts (congelados, então compartilhá-los é seguro) e o ponto recebido de fora é
  **copiado**: alterar o objeto passado depois não muda o layout. Nenhum argumento é alterado.
- `positions` é um objeto **sem protótipo** (`Object.create(null)`) e `positionOf` consulta com `hasOwnProperty`: um id como
  `__proto__`, `constructor` ou `toString` é uma chave comum, e nada herdado vira "posição". O objeto sem protótipo já basta
  (consultar sem `hasOwnProperty` seria equivalente); a consulta própria é defesa em profundidade.
- Nenhuma função depende da ordem das propriedades dos objetos recebidos: `circularLayout` e `reconcileLayout` percorrem
  `graph.vertices` (ordem de inserção), e `Object.keys` de um resultado segue essa ordem.
- O Jest compila o código **fora do modo estrito** (preset do React Native), então escrever num objeto congelado é ignorado
  em vez de lançar; por isso os testes comparam **valores** com entradas não congeladas, além de rodar com entradas
  congeladas.

**`circularLayout`: regras.** Ordem de **inserção** dos vértices (rótulos e arestas não contam), centro na origem do mundo,
o **primeiro no topo**, sentido **horário na tela** (Y cresce para baixo, então o ângulo cresce):
```text
ângulo(i) = −π/2 + 2π·i/n          posição(i) = ( R·cos ângulo(i) , R·sin ângulo(i) )
R = max(minRadius, spacing / (2·sin(π/n)))        (n ≥ 2)
```
`R` é a condição para a **corda** entre vizinhos (`2·R·sin(π/n)`), não o arco, valer `spacing`; a fórmula "arco" antiga
(`spacing·n/2π`) deixaria os vizinhos mais perto que o espaçamento (com n = 6, ≈ 91,7 em vez de 96). Casos: 0 vértices →
layout vazio; 1 → `(0, 0)` (mesmo com `minRadius`); 2 → `(0, −spacing/2)` e `(0, spacing/2)`; 3 ou mais → polígono regular
inscrito. Com o espaçamento padrão:

| n | posições (v1, v2, …) |
| --- | --- |
| 1 | (0, 0) |
| 2 | (0, −48), (0, 48) |
| 3 | (0, −55,426), (48, 27,713), (−48, 27,713) |
| 4 | (0, −67,882), (67,882, 0), (0, 67,882), (−67,882, 0) |

Arredondamento: cada coordenada vai a **3 casas** (0,001 unidade de mundo). Isso move a coordenada em até 0,0005 e pode
deixar a distância entre vizinhos até ≈ 0,0015 **abaixo** de `spacing`; os testes usam a tolerância explícita de 0,003. O
arredondamento limpa valores como `3,7e-15` e reduz a sensibilidade ao último bit de `sin`/`cos`, mas **não promete
resultado idêntico bit a bit entre V8 e Hermes**. O layout leva o `graph.id`.

**`reconcileLayout`: estratégia** (determinística, sem sorteio nem relógio, sem força nem iteração):
1. **Layout de outro grafo** (`layout.graphId !== graph.id`): nenhuma posição é reaproveitada, mesmo com ids coincidentes;
   devolve o `circularLayout` do grafo recebido (preferência por um layout inicial novo em vez de misturar).
2. **Órfãs** (ids que não são vértices do grafo) são descartadas. **Posição inválida** guardada (não finita, de um layout
   corrompido) conta como ausente.
3. **Posições existentes são preservadas exatamente** (mesmos valores e mesmos objetos), mesmo que se sobreponham:
   reconciliar não mexe em vértice já posicionado nem tenta "consertar" o desenho do aluno.
4. **Nenhuma posição aproveitável** (layout vazio, só órfãs ou só inválidas) e há vértices → `circularLayout`.
5. **Layout parcial:** cada vértice sem posição, na ordem de inserção, vai para a **primeira posição livre ao redor do
   centroide** das posições preservadas (média na ordem dos vértices, calculada termo a termo para não estourar), a pelo
   menos `spacing` de **todas** as ocupadas, inclusive as dos vértices novos já colocados. A busca é por **anéis
   concêntricos** de raio `anel·spacing` (anel 0 = o próprio centroide; anel k com `max(6, ⌈2πk⌉)` candidatos, a partir do
   topo, no sentido horário), com candidatos **já arredondados**, e é **limitada** a `ocupadas + 2` anéis; se nada servir,
   o ponto à direita de todas (a mais de `spacing` de cada uma por construção). Sempre termina, sem laço aberto.
6. **Idempotente:** sem nada a fazer (nenhuma órfã, nenhum vértice sem posição, mesmo grafo) devolve o **próprio layout**
   recebido, com a ordem das chaves dele; reconciliar o resultado de novo devolve o mesmo objeto.

Só os vértices **novos** respeitam a distância; entre os preservados vale a que vieram. Um candidato exatamente a `spacing`
é aceito (a comparação é `< spacing²`), e como o arredondamento a 3 casas pode empurrá-lo para dentro, o 3º candidato do
anel 1 em torno de um ocupado isolado (por exemplo) é rejeitado por 0,0001; isso é determinístico e inofensivo.

**Complexidade real** (V = posições do layout ou vértices; K = vértices sem posição; m = posições ocupadas na hora):

| Operação | Tempo | Observação |
| --- | --- | --- |
| `positionOf` | O(1) esperado | acesso a propriedade própria |
| `placeVertex`, `moveVertex`, `removePosition` | **Θ(V)** | layout imutável: o objeto de posições é **copiado** a cada atualização (os pontos não); uma estrutura persistente baixaria para O(log V), sem compensar nesta escala |
| `boundsOf`, `circularLayout` | Θ(V) | uma varredura |
| `reconcileLayout` sem vértices novos | Θ(V) | devolve o próprio layout se nada muda |
| `reconcileLayout` com K novos | típico Θ(V + K·V); **pior caso O(K·V²)** | cada candidato é comparado com todas as m ocupadas (Θ(m)); o número de candidatos por vértice novo é, no caso típico, uma constante pequena e, no pior caso, O(m) |

**Não há índice espacial** (nenhuma biblioteca): só se justificaria se a medição mostrasse o pior caso na prática. Espaço:
Θ(V) por layout novo.

**Integração com a câmera** (sem alterar `camera.ts`): `fitToBounds(camera, boundsOf(layout), viewport, { margin })`, depois
`worldToScreen`/`screenToWorld` com a câmera resultante. O círculo cabe no viewport com margem quando os limites de escala
permitem (testado de 2 a 12 vértices). `boundsOf` cobre **centros**: a margem de `fitToBounds` é em **dp**, e o raio visual de
um vértice cresce com a escala, então com a margem sozinha o círculo desenhado pode ultrapassar a borda (testado:
raio de 20 unidades, margem de 24 dp, escala ≈ 2,3). A interface (3.5) deve **expandir os limites pelo raio visual, em
unidades de mundo**, antes de enquadrar. Com muitos vértices (testado com 2000) a escala para no mínimo (0,25) e o conteúdo
excede o viewport, como a câmera já documenta.

**Limitações conhecidas.**
- `boundsOf` não inclui raio dos vértices, rótulos nem arestas (veja acima).
- O arredondamento a 3 casas e a tolerância de 0,003 no espaçamento circular; sem promessa de igualdade bit a bit entre
  motores (V8 × Hermes): `sin`/`cos` podem diferir no último bit, e o arredondamento esconde isso salvo quando o valor cai a
  ~10⁻¹³ de uma fronteira de arredondamento.
- Pior caso O(K·V²) sem índice espacial; com 3000 vértices e quase todos novos seria lento (o caso real é "alguns novos").
- Cópia a cada atualização, Θ(V): **não** chamar `moveVertex` a cada quadro durante o arrasto de um grafo grande. O
  arrasto deve manter a posição transitória fora do layout (valor compartilhado da Reanimated) e confirmar **uma** vez
  no fim do gesto (3.4/3.10).
- Magnitudes ≈ 10³⁰⁸: a finitude é garantida (não há `NaN`/`Infinity`), mas, quando `direita + spacing` estoura, o novo vértice
  cai no centroide e o espaçamento não é garantido. Fora do uso real (o mundo do editor tem ordem de 10²–10⁴).
- Não é um algoritmo de desenho: **sem forças, sem minimizar cruzamentos, sem desfazer sobreposição** de posições já
  existentes. Os layouts por força e por camadas ficam para depois, se forem desejados.
- Sem persistência ainda: o `LayoutDocument` v1 `{ schemaVersion, graphId, positions }` (3.13) é separado do JSON do
  `Graph`, com a mesma disciplina de validação da leitura de grafos e arquivos de referência próprios; o documento do
  `Graph` v1 não ganha nenhum campo.

### Geometria das arestas e hit-testing (incremento 3.3: `core/geometry.ts`)

TypeScript puro: devolve **dados** (pontos, segmentos, curvas, setas, âncoras), nunca componentes, elementos SVG nem objetos de
biblioteca visual; o renderizador (3.5, SVG hoje, Skia se um dia for preciso) os converte em comandos de desenho. Não altera
`Graph` nem `GraphLayout` e não reconcilia layouts (isso é do `layout.ts`).

**Mundo × tela, separados de propósito.**
- A **geometria** é calculada em **coordenadas de mundo** e não conhece a câmera: o mesmo grafo e o mesmo layout dão a
  mesma geometria com qualquer zoom e deslocamento. Raio do vértice, tamanho da seta e curvatura são em **unidades de
  mundo** (crescem com o zoom).
- O **hit-testing** recebe o toque em **dp de tela** e a câmera, converte a geometria com `worldToScreen` e mede em dp. A
  área mínima de toque (48 dp de diâmetro) e a tolerância das arestas (12 dp) **não variam com o zoom**. Nada aqui usa pixels
  físicos.

**Tipos** (todos `readonly`; exportados por `core/index.ts`): `LineSegment { kind: 'line', from, to }`,
`QuadraticCurve { kind: 'quadratic', from, control, to }`, `EdgePath` (união dos dois), `Arrowhead { tip, base, left, right }`,
`EdgeGeometry { edgeId, sourceId, targetId, path, arrow?, labelAnchor }`, `GeometryOptions`, `HitTestOptions`, `VertexHit`,
`EdgeHit` e `HitTarget` (união discriminada por `type`: `'vertex'`, `'edge'` ou `'background'`).

**Identidade.** As posições vêm do `GraphLayout` pelo **id técnico** (nunca rótulo, índice ou posição no array). Cada
geometria leva o `edgeId` e os ids de origem e destino como estão no grafo. Aresta com uma ponta sem posição (ou não finita),
layout de **outro grafo** (`graphId` diferente) ou aresta inexistente: **sem geometria** (`undefined`, ou fora da lista).

**Aresta reta** entre os centros A (origem) e B (destino), raio r, `d = |B − A|`, `u = (B − A) / d`:
```text
from = A + u·r          to = B − u·r          âncora do peso = ponto médio de from e to
```
O traço vai de **borda a borda**, nunca pelos centros. Exige `d > 2r`; com `d ≤ 2r` (sobrepostos, tangentes ou na mesma
posição) **não há geometria**: não existe trecho visível nem direção definida, e nenhuma posição é movida para consertar isso.

**Seta** (só em grafo orientado, `source → target`): a **ponta** (`tip`) é o fim do traço, na borda do destino, apontando na
direção do traço ali (`u` na reta; a tangente final da curva). `base` fica `length` atrás da ponta e `left`/`right` a
`halfWidth` dos lados da base (esquerda e direita de quem anda de A para B, na tela com Y para baixo). `length = min(arrowLength,
traço visível)`, para a base não passar da borda da origem. Padrões provisórios: comprimento 12 e meia-largura 5. O traço
`path` sempre vai até a ponta; um renderizador que queira o corpo sem sobrepor o triângulo pode terminá-lo em `arrow.base`.
Cores e espessuras são do renderizador. Exemplo à mão (A = (0,0), B = (100,0), r = 20): traço de (20,0) a (80,0), ponta
(80,0), base (68,0), asas (68,±5); invertida, a ponta passa para (20,0).

**Arcos opostos** (grafo orientado com A → B **e** B → A): ambos viram **curvas de Bézier quadrática**
`B(t) = (1−t)²·from + 2(1−t)t·control + t²·to`. Regra de curvatura: cada arco curva para a **sua direita** (na tela, com Y
para baixo). Como a direita de B → A é a esquerda de A → B, as duas ficam em lados opostos da reta entre os centros, **sem
depender da ordem de inserção**. Com `n = (−u.y, u.x)` (a direita de u), `M = (A + B) / 2` e `k` a curvatura (padrão 0,3):
```text
controle C = M + n · (k · d)
from = A + unit(C − A) · r        to = B + unit(C − B) · r        (a curva sai radialmente do círculo)
```
A tangente final aponta de C para B (é a direção da seta); a âncora do peso é `B(½) = ¼·from + ½·C + ¼·to`, **na própria
curva**. Exemplo (A = (0,0), B = (100,0)): `A → B` tem C = (50, 30), `from` = (17,15; 10,29), `to` = (82,85; 10,29) e
âncora (50; 20,145); `B → A` é a mesma curva girada 180° em torno de (50, 0): C = (50, −30), âncora (50; −20,145). As duas
âncoras ficam a ≈ 40 uma da outra. Aresta **sem** arco oposto continua **reta**, e em grafo não orientado nunca há curva (um
par, uma aresta). `k` precisa ser > 0 (com 0 as duas coincidiriam; valor inválido vale o padrão).

**Hit-testing** (`hitTestVertex`, `hitTestEdge`, `hitTest`; `(graph, layout, camera, screenPoint, options?)`):
- *Vértice:* o toque acerta se está a no máximo `max(minTouchDiameter / 2, vertexRadius · scale)` dp do centro na tela
  (`worldToScreen`). Padrão: no mínimo **48 dp de diâmetro** em qualquer zoom; com zoom alto vale o raio visual, que cresce
  (escala 4: 80 dp). Vários vértices na área: vence o de **menor distância ao centro**; empate exato, o **primeiro na ordem de
  inserção** do grafo. Vértice sem posição não é acertado. Devolve `{ vertexId, distance }` (dp).
- *Aresta:* a de **menor distância ao traço** a até `edgeTolerance` dp (padrão **12**, provisório); empate exato, a primeira
  inserida (dois traços que se cruzam empatam no cruzamento, e vence o primeiro). A distância é ao **segmento**, nunca à reta
  infinita; numa curva é à **trajetória de Bézier**, aproximada por uma poligonal de N = `curveSamples` segmentos (padrão 24,
  teto 256), **não** à corda: o meio da corda de um arco oposto não acerta nada. Arcos opostos se distinguem porque cada um
  tem a sua curva. Um toque na **área de um vértice nunca seleciona aresta** (`hitTestEdge` devolve `undefined` ali).
- *Combinado* (`hitTest`): vértice, depois aresta, depois fundo, como `HitTarget`. `undefined` significa **entrada inválida**
  (câmera inválida, toque não finito ou layout de outro grafo) e nunca "fundo". É o que o detector de gestos único do
  canvas (3.10) vai chamar; ele não existe ainda.
- Opções inválidas valem o padrão; nenhuma função lança nem devolve `NaN`/`Infinity`.

**Erro da poligonal.** O desvio máximo entre um arco de Bézier de largura `h = 1/N` em `t` e a sua corda é
`h² · |C − m| / 2` (C = controle, m = ponto médio dos extremos, em dp depois da conversão); a distância calculada difere da
verdadeira em no máximo isso (a mais fora da curva, a menos dentro). Com N = 24: ≈ 0,26 dp para uma aresta curva de 1000 dp
de corda e curvatura 0,3, contra uma tolerância de 12 dp; o teste confere a cota com um oráculo denso. Aumentar `curveSamples`
reduz o erro.

**Casos degenerados.**

| Caso | Geometria | Hit-testing |
| --- | --- | --- |
| Grafo ou layout vazio, vértice isolado | nenhuma aresta | fundo (vértice isolado é acertado) |
| Aresta com posição ausente | sem geometria; as demais saem | a aresta nunca é acertada |
| Vértices na mesma posição ou a ≤ 2r | sem geometria (sem mover nada) | os vértices continuam acertáveis; empate pela ordem |
| Vértices a 0,001 um do outro | duas áreas quase iguais | vence o de centro mais próximo do toque |
| Coordenadas negativas ou muito grandes | finita ou ausente (se `dx` estoura) | centro não finito na tela → não acertado |
| Câmera inválida, toque não finito | — | `undefined` |
| Zoom 0,25 e 4, qualquer translação | igual (independe da câmera) | alvo mínimo de 48 dp; raio visual em zoom alto |
| Arestas que se cruzam | cada uma com a sua geometria | menor distância; no cruzamento, a primeira inserida |

**Complexidade** (V vértices, E arestas, N amostras por curva, C ≤ E arestas curvas):

| Operação | Tempo | Observação |
| --- | --- | --- |
| `edgeGeometry` (uma aresta) | **Θ(E)** | acha a aresta pelo id e, em grafo orientado, procura o arco oposto |
| `edgeGeometries` (todas) | **Θ(V + E)** (tempo e espaço) | índice temporário `Map` origem → destinos (Θ(E)); sem busca por aresta, que daria Θ(E²); o teste confere que `find`/`some`/`filter` nem são chamados |
| `hitTestVertex` | **Θ(V)** | uma varredura; não lê as arestas |
| `hitTestEdge` | **Θ(V + E + C·N)** (pior caso Θ(V + E·N)) | confere os vértices, monta as geometrias e mede cada uma (O(1) na reta, Θ(N) na curva) |
| `hitTest` | Θ(V) se acerta um vértice; senão, como `hitTestEdge` | |

Não há índice espacial. Cada chamada de aresta refaz `edgeGeometries`: um toque é raro; quem consultar a cada quadro
(por exemplo, durante um arrasto) deve guardar as geometrias.

**Limitações conhecidas.**
- Raio (20), seta (12/5), curvatura (0,3), alvo (48 dp), tolerância (12 dp) e amostras (24) são **provisórios**, a ajustar
  em aparelho.
- A curva sai radialmente do círculo, mas **pode roçar nos círculos** de vértices muito próximos (`d` pouco acima de `2r`);
  não há desvio nem desempate visual.
- Só **uma** curvatura, para o par oposto; sem laços nem arestas paralelas (o domínio não os permite). O peso e o rótulo
  são ancorados, mas **não** são alvos de toque.
- O alvo mínimo de 48 dp pode **engolir arestas curtas** com zoom afastado (por exemplo, o círculo de 6 vértices com
  espaçamento 96 a 0,25 vira um bloco de áreas de vértice). A interface decide o que fazer (limites de zoom, botão de
  enquadrar); o núcleo mantém a regra "vértice vence".
- Dois traços que se cruzam: dentro do erro da poligonal, a ordem entre traços quase coincidentes não é determinável; o
  resultado é determinístico, não "o mais correto".
- Coordenadas ≈ 10³⁰⁸: finitude garantida; sem geometria quando `dx` estoura.

**Preparação para o renderizador SVG (3.5).** A cena é `edgeGeometries(graph, layout, opções)` mais as posições do layout;
os pontos de mundo viram dp com `worldToScreen`. Linha: `M from L to`. Curva: `M from Q control to`. Seta: polígono
`tip, left, right`. Peso: texto em `labelAnchor`. Espessuras e cores (por tokens) são do renderizador, que deve usar as
**mesmas** opções de geometria que o hit-testing, para que o que se vê seja o que se toca. Os limites para enquadrar
(`fitToBounds`) devem ser os de `boundsOf` **expandidos pelo raio visual**, em unidades de mundo.

### IDs e histórico: estratégia (corrige o ROADMAP; implementada no 3.4, `core/editor.ts`)

A decisão anterior do ROADMAP ("desfazer restaura também os contadores de ids") **está errada**: ela reabriria um id
já emitido. Princípio do domínio: um id removido **nunca** é reaproveitado, e a identidade técnica **não** depende do
rótulo. Regras do histórico:

1. **Desfazer uma criação não libera o id.** Depois de desfazer, uma operação **independente** nova **não** pode
   reutilizar o id da criação desfeita.
2. **Refazer restaura o mesmo id** da operação original (o instantâneo guarda o vértice com o seu id).
3. **Operação nova depois de desfazer descarta o ramo de refazer** (a pilha `future`). Os ids do ramo descartado
   continuam queimados (regra 1).
4. **Os contadores são monotônicos e independentes dos instantâneos.** O histórico guarda instantâneos
   `{ graph, layout }`, mas os contadores `nextVertexSeq` e `nextEdgeSeq` do estado **atual** são sempre o máximo já
   alcançado na sessão. Ao desfazer ou refazer, o instantâneo de destino recebe, **de cada contador, o maior valor entre
   o dele e o do estado que está sendo deixado** (o do estado atual já é o piso, pois só os comandos os aumentam e um
   comando descarta o `future`):
   `destino.graph = { ...destino.graph, nextVertexSeq: max(destino, atual), nextEdgeSeq: max(destino, atual) }`.
   Isso é uma cópia de objeto comum, **sem alterar o domínio** nem o instantâneo (se o destino já não está atrás, o próprio
   objeto é usado): um `Graph` com contador à frente dos ids é um estado válido (acontece depois de qualquer remoção).
   Como o contador atual **é** o piso de ids da sessão, não é preciso outra variável; `redo(undo(s))` devolve o mesmo
   grafo (conteúdo e contadores) e o mesmo layout. Vértices e arestas têm contadores independentes, cada um tratado em
   separado. No refazer o `max` é redundante (o `future` já carrega o piso), mas barato.
5. **O domínio não mudou.** Decidido no 3.4: o `max` por contador é feito no núcleo (`restoredGraph`), sem acrescentar
   `reserveIds` ao domínio, que continua exatamente como estava.
6. **Rótulos são outra coisa** (decisão do 3.4: **menor rótulo livre**). O rótulo padrão de `addVertex` continua saindo do
   contador (A, B, C… por `nextVertexSeq`), e como o contador não recua daria **D** depois de desfazer a criação de C. O
   editor, porém, calcula o **menor rótulo livre** da sequência A, B, …, Z, AA, AB, … entre os que nenhum vértice usa
   (`nextFreeLabel`, Θ(V)) e o passa explicitamente a `addVertex`: criar A, B, C, desfazer C e criar outro dá o vértice `v4`
   com o rótulo `C`. O **rótulo** se reaproveita; o **id** nunca. Rótulos dados pelo aluno contam como usados e nunca são
   alterados; duplicados informados continuam permitidos (o domínio os permite); a comparação diferencia maiúsculas de
   minúsculas.
7. **Documentos e histórico sem colisão.** (i) Ao abrir um documento, os contadores vêm do arquivo (a leitura garante
   que superam todos os ids presentes) e o histórico começa **vazio**; (ii) o documento gravado leva sempre os
   contadores atuais, que são o piso da sessão; (iii) o histórico **não é persistido**; (iv) o layout é por id e só vale
   para o grafo de mesmo `graph.id`, então um layout salvo nunca passa a apontar para outro vértice. Continua valendo a
   limitação já documentada: ids de elementos removidos **antes** da gravação não podem ser reconstruídos de um
   documento adulterado.
8. **Testes do 3.4:** propriedade com sementes fixas sobre sequências de comandos, desfazer e refazer: **nenhuma
   criação distinta compartilha id** e `redo(undo(s))` devolve o mesmo grafo e layout; modelo de referência independente;
   os contadores só crescem a cada passo. Abrir um documento e continuar a editar sem reemitir ids vale por construção
   (a leitura garante os contadores) e entra com a persistência.

### Núcleo de edição e store (incremento 3.4: `core/editor.ts`, `core/error-messages.ts`, `graph-editor/editor-store.ts`)

`applyAction(state, action) → { state, error? }` é **pura**: sem exceção, sem relógio, sem sorteio; a store Zustand só guarda
o resultado. Toda regra vem do domínio (`addVertex`, `addEdge`, `removeVertex`, `removeEdge`, `setVertexLabel`,
`setEdgeWeight`) e de `layout.ts`; o domínio, o JSON v1 e as quatro representações não mudaram (e não são recalculadas aqui:
a interface as pede sob demanda).

**Estado** (`EditorState`, tudo `readonly`): `graph`, `layout` (do `graph.id`, uma posição por vértice, nenhuma órfã: mantido
**por construção**; as invariantes completas são conferidas nos testes, não revalidadas em produção), `selection` (união
discriminada `none | vertex { vertexId } | edge { edgeId }`, por id estável), `mode` (`select | add-vertex | connect`; só
guarda o modo, o que cada um faz com um toque é do detector de gestos), `history` (`{ past, future, limit }` de
`EditorSnapshot = { graph, layout }`) e `error?`. A câmera, a seleção, o modo e o erro **não** entram nos instantâneos.
`createEditorState({ graph, layout?, historyLimit?, mode? })` monta o estado inicial e reconcilia o layout (ausente, de
outro grafo ou incompleto).

**Resultado da transição** (sem campo extra): *aplicada* (estado novo, sem `error`); *sem efeito* (o **mesmo** objeto
`state`, nada no histórico); *recusada* (estado novo só com `error`: grafo, layout, `history` e contadores são os mesmos
objetos; o erro do domínio vem intacto em `error.error`). `EditorError`: `GRAPH_ERROR { error: GraphError }`,
`INVALID_POSITION`, `NOTHING_SELECTED`, `INVALID_MODE`. Qualquer ação **aplicada** limpa o erro anterior; ação sem efeito
não; desfazer e refazer nunca o restauram.

| Ação | Payload | Efeito | Histórico | Recusas |
| --- | --- | --- | --- | --- |
| `add-vertex` | `position` (mundo), `label?` | `addVertex` (rótulo automático se omitido) + `placeVertex`, atômico | sim | `INVALID_POSITION`, rótulo inválido |
| `connect` | `source`, `target`, `weight?` | `addEdge`; layout intacto; arcos opostos valem em grafo orientado | sim | vértice inexistente, laço, peso inválido, aresta repetida |
| `remove-selection` | — | `removeVertex` (leva as arestas incidentes) + `removePosition`, ou `removeEdge`; seleção limpa | sim | `NOTHING_SELECTED` |
| `set-label` | `vertexId`, `label` | `setVertexLabel` | só se mudou | vértice inexistente, rótulo inválido |
| `set-weight` | `edgeId`, `weight \| undefined` | `setEdgeWeight` (`undefined` remove; `0` é peso) | só se mudou | aresta inexistente, peso inválido |
| `move-vertex` | `vertexId`, `position` | `moveVertex`: a posição **final** (um passo) | só se mudou | vértice inexistente, `INVALID_POSITION` |
| `select` / `clear-selection` | `selection` | só a seleção; confere que o elemento existe | não | vértice ou aresta inexistente |
| `set-mode` | `mode` | só o modo | não | `INVALID_MODE` |
| `undo` / `redo` | — | restaura o instantâneo; seleção por id, limpa se o elemento sumiu | (move entre `past` e `future`) | — (sem efeito se vazio) |
| `clear-error` | — | remove o erro | não | — |

Validação em ordem, como no domínio: o elemento existe → o valor é válido; ao adicionar, a posição vem antes do rótulo. Só
`undefined` significa "rótulo omitido" (`null` e texto vazio são recusados pelo domínio). O arrasto contínuo **não** passa
por `move-vertex`: a posição transitória vive fora do layout e só a final é confirmada (etapa 3.9).

**Histórico.** Entra um instantâneo (o estado de antes) por operação que **muda** o grafo ou o layout. Recusadas, sem efeito,
seleção, modo e limpar erro não entram. Desfazer move o estado atual para `future` e restaura o último de `past`; refazer é o
inverso; uma operação nova **descarta** `future`; com `past` vazio, desfazer não faz nada (idem refazer). O limite é
`historyLimit` (padrão **100**, `1 ≤ limite ≤ 1000`, inválido vale o padrão; passando dele, o mais antigo é esquecido) e é uma
**política inicial**, não uma garantia de consumo em aparelhos modestos. Instantâneos não são alterados por operações
posteriores.

**Papel do Zustand** (`editor-store.ts`, `zustand/vanilla`): `createEditorStore(options)` devolve **uma store por sessão**
(sem singleton escondido) com `{ editor, dispatch, reset }`. `dispatch(action)` chama `applyAction` e só grava (`set`) se a
transição trouxe um estado diferente: o Zustand notifica os assinantes a **cada** `setState`, mesmo com o mesmo conteúdo, por
isso a guarda é da store. Ação aplicada e ação recusada (o erro mudou) notificam; ação sem efeito não notifica ninguém.
`reset(options)` começa uma sessão nova (outro grafo, histórico vazio). Os seletores (`selectGraph`, `selectLayout`,
`selectSelection`, `selectMode`, `selectError`, `selectCanUndo`, `selectCanRedo`) devolvem referências estáveis ou
primitivos. A ligação ao React vem com o primeiro componente (3.5): `useStore(store, seletor)`, sem mudar a store nem o
núcleo. A store **não duplica regra**: um teste confere que ela só importa `zustand/vanilla` e o núcleo e que não nomeia
nenhuma operação do domínio, do layout ou do histórico.

**Mensagens.** `graphErrorMessage(error): string` e `editorErrorMessage(error): string` (`core/error-messages.ts`) dão um
texto em português para **cada** código de erro do domínio (o compilador exige a cobertura) e do editor. O texto sai do código
e de campos limitados; **nada do que o aluno digitou nem do documento lido é copiado** para a mensagem, e ids técnicos não
aparecem. O erro estruturado continua sendo o que os testes e o diagnóstico leem.

**Complexidade** (V vértices, E arestas, L = limite do histórico, ≤ 1000):

| Operação | Tempo | Observação |
| --- | --- | --- |
| adicionar vértice | Θ(V) | conjunto de rótulos usados (`nextFreeLabel`), vetor de vértices copiado pelo domínio, cópia do layout |
| conectar / peso | Θ(E) | `addEdge` confere a repetição e copia o vetor de arestas |
| remover vértice | Θ(V + E) | |
| rótulo / mover | Θ(V) | mover copia o layout; os pontos e o `Graph` são reaproveitados |
| selecionar, modo, limpar erro | O(1) | selecionar confere que o elemento existe: O(V) ou O(E) |
| registrar no histórico | Θ(L) | cópia do vetor `past` |
| desfazer / refazer | Θ(L + V + E) | cópia dos vetores e conferência da seleção |

**Memória.** Os instantâneos compartilham os vértices, arestas e posições (objetos imutáveis), mas cada atualização do grafo
cria vetores novos, então o histórico ocupa Θ(L · (V + E)) **referências** no pior caso: não é um valor constante ao longo do
histórico. Nada é copiado em profundidade, e não há compressão de histórico.

**Limitações conhecidas.** O desfazer não restaura seleção, modo nem câmera (de propósito). Sem agrupamento de edições
seguidas (cada rótulo ou peso é um passo). O limite de 100 passos é provisório. O histórico não é persistido (começa vazio ao
abrir um documento). A origem pendente do modo `connect` mora na store, ao lado do `EditorState` (3.7). A sequência de rótulos A, B, …, AA repete a
lógica privada `defaultLabel` do domínio (que não é exportada e não foi alterada). Um `Graph` restaurado pode ser uma cópia
rasa nova (só quando o contador sobe), então comparar por referência não vale; compare por conteúdo.

### Interação por toque (arquitetura; implementados: hit-testing no 3.3, toque que cria vértice no 3.6, dois toques que conectam no 3.7, toque que seleciona no 3.8, arrasto de vértice no 3.9 e pan e pinça da câmera no 3.10)

- **Um detector para o canvas**, com gestos compostos (API de hooks do Gesture Handler 3: `useTapGesture`,
  `usePanGesture`, `usePinchGesture`, `useLongPressGesture` e as composições `useSimultaneousGestures`,
  `useExclusiveGestures`, `useCompetingGestures`; não misturar com a API antiga de `Gesture.*`). Os nomes exatos e o
  comportamento de cada composição foram conferidos na versão instalada: `useTapGesture` e `GestureDetector` no 3.6 e, no 3.9, `usePanGesture` (ativação manual) e `useCompetingGestures` (o toque e o arrasto de vértice competem) e, no 3.10, `usePinchGesture` (o pan da câmera usa o mesmo `usePanGesture`, e os três gestos competem).
- **Alvo de toque em unidades de tela, independente do zoom:** ≈ 48 dp de diâmetro (raio ≈ 24 dp) em volta do centro do
  vértice, calculado depois de converter o centro do mundo para a tela. O desenho pode ser menor (ou maior com zoom),
  mas **o alvo nunca encolhe** abaixo disso. Sobreposição: o vértice mais perto do toque vence, e o empate vai para a
  ordem de inserção. Arestas têm tolerância própria em dp de tela e só são acertadas fora dos vértices. **Implementado**
  em `hitTestVertex`, `hitTestEdge` e `hitTest` (`core/geometry.ts`, 3.3); o toque os chama desde o 3.6 (`tapToEditorAction`) , o 3.7 (`tapToConnectTransition`) e o 3.8 (`tapToSelectionAction`) e o arrasto do 3.9 (`startDrag`); desde o 3.10 a decisão de quem é o dono de um deslize (vértice, câmera ou ninguém) é UMA consulta (`gestureOwnerAt`, `core/gesture-start.ts`); o toque longo composto continua sem existir.
- **Modo explícito** (Selecionar, Adicionar vértice, Conectar) e uma função pura `(modo, toque, o que há sob ele) → ação`.

  | Modo | Toque | Arrasto que começa em vértice | Arrasto no fundo | Pinça | Toque longo |
  | --- | --- | --- | --- | --- | --- |
  | Selecionar | seleciona vértice/aresta ou limpa | move o vértice | desloca a câmera | zoom | propriedades |
  | Adicionar vértice | cria vértice no vazio | desloca a câmera | desloca a câmera | zoom | — |
  | Conectar | escolhe origem e depois destino | desloca a câmera | desloca a câmera | zoom | cancela |
- **Um gesto, um dono.** Uma segunda ponta de dedo durante um arrasto de vértice o cancela (a posição volta, sem gravar) e,
  **medido no Android no 3.10**, a pinça NÃO assume na mesma sequência de toques (o Gesture Handler já tinha dado a vitória ao
  arrasto): o aluno levanta os dedos e recomeça; o mesmo vale para o pan da câmera já ativo (a câmera é preservada). Com os dois
  dedos descendo quase juntos, antes de qualquer pan ativar, a pinça assume. `onFinalize` com `canceled` desfaz qualquer prévia
  (conexão pendente, posição provisória).
- **Durante o arrasto** (3.9) a posição vive na PRÉVIA, no JavaScript (controlador + `useSyncExternalStore`), e só vai para a store
  ao soltar (um passo de histórico). A decisão original (valor compartilhado do Reanimated, na thread de interface) **não foi adotada** por falta de evidência de benefício:
  veja "Arrastar vértices", em "Alternativas avaliadas" e na medição no Android. A câmera e a seleção ficam fora do histórico.

### Cena e renderização SVG (incremento 3.5: `core/scene.ts`, `graph-renderer.ts`, `svg-graph-renderer.tsx`)

**SOMENTE LEITURA no 3.5** (o 3.6 acrescentou o toque que cria vértices: ver "Modo Adicionar vértice e toque"). O 3.5 desenha um grafo e o carrega na tela Laboratório; não há gestos, seleção por toque, conexão manual,
arrasto, zoom nem pan, e nenhum controle de edição foi criado. O caminho dos dados é:
`store (graph, layout)` → `fitCameraToGraph` → `buildGraphScene` → `SvgGraphRenderer`. A **cena** é pura (núcleo, sem JSX);
o **renderizador** só a percorre.

**`GraphScene`** (tudo `readonly`, em **dp de tela**): `graphId`, `directed`, `labelFontSize`, `summary`, `vertices` e `edges`.
- `SceneVertex`: `id`, `label` (completo), `displayLabel` (exibido dentro do círculo), `center`, `radius`, `isolated`, `visible`.
- `SceneEdge`: `id`, `sourceId`, `targetId`, `path` (`LineSegment` ou `QuadraticCurve`, já em dp), `arrow?` (só em grafo
  orientado), `weight?` (`{ text, anchor, width, height }`, só se a aresta tem peso) e `visible`.
- Assinatura: `buildGraphScene(graph, layout, camera, options?) → GraphScene | undefined`. A câmera entra como argumento próprio
  (como em `hitTest`), e as opções são as de geometria mais `viewport` e `labelFontSize`. `undefined` = entrada inválida
  (câmera inválida ou layout de **outro** grafo); grafo vazio dá cena vazia. Vértice sem posição, com posição não finita e aresta
  sem geometria **não entram** na cena, e o resumo avisa.
- A geometria das arestas **não é refeita**: vem de `edgeGeometries` e só é convertida; o SVG não reimplementa nada.

**Convenção de coordenadas (a escala vale UMA vez).** Cada ponto do mundo passa por `worldToScreen` na cena; por isso o SVG não
leva `transform` nem `viewBox` com escala (o `viewBox` é exatamente a área de desenho). Acompanham o zoom: posição e raio dos
vértices, extremos, ápice e seta das arestas, âncora do peso (a mesma geometria do hit-testing: o que se vê é o que se toca). Ficam
**constantes em dp**: espessura dos traços (2) e corpo do texto (14). A área de toque (48 dp) **não é desenhada nem simulada**.

**Pesos.** Sem peso: nenhum texto nem caixa (a chave `weight` nem existe). Peso `0`: aparece `0`. Negativo: `-2`. Decimais com vírgula
(`1,5`, pt-BR). A caixa do texto (fundo `surface`, borda `border`) é uma **estimativa** (0,6 do corpo por glifo + 4 dp de folga);
a posição matemática da aresta não muda.

**Rótulos.** `displayLabel` é o texto truncado por **pontos de código** (nunca separa um par substituto, como um emoji), com
reticências. Quantos cabem é uma **estimativa** (glifo médio = 0,6 do corpo; caixa útil = 1,6 do raio; no mínimo 1): o texto
renderizado **não é medido**, então letras largas podem passar um pouco, e sequências combinadas (acentos soltos, emojis com ZWJ)
podem ser cortadas no meio. O rótulo completo fica em `label` e no resumo; o domínio não é tocado.

**Visibilidade.** Com `viewport`, `visible` diz se o círculo (ou a caixa que envolve os pontos do traço e da seta) cruza a área de
desenho; sem ele, tudo é visível. É informação (resumo, futura poda): o renderizador desenha tudo e o SVG recorta.

**Resumo acessível** (`summary`, português), montado dos **dados**: orientação, contagens com singular e plural, vértices isolados
pelo **rótulo** (nomeia até 5), "Todas as arestas têm peso" / "N arestas têm peso", "Parte do grafo está fora da área visível" e
"Nem todos os elementos puderam ser desenhados". Exemplo: *"Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado.
3 arestas têm peso."* Não é a acessibilidade detalhada (incremento 3.12).

**Câmera inicial** (`fitCameraToGraph(graph, layout, viewport, { margin?, limits? })`). Enquadra os **limites do conteúdo**
(`graphContentBounds`): os **círculos** (centro ± raio visual, não só os centros do `boundsOf`) e os extremos e o **ápice**
(`labelAnchor`) de cada aresta, com margem de **24 dp**, via `fitToBounds`. Só devolve câmera se a área tem dimensões válidas
(finitas, > 0 e maiores que 2 × margem) e o layout é do grafo; senão `undefined` (a tela ainda não mediu o canvas). Se a escala
mínima (0,25) impede o enquadramento (grafo enorme), a escala é respeitada, o conteúdo **excede** a área e o resumo avisa. A
câmera é **estática** e **derivada** (memoizada no tamanho medido), não um estado: nada recalcula a cada quadro.

**Renderizador** (`SvgGraphRenderer`, `react-native-svg`): ordem de baixo para cima: traços das arestas (`Line`/`Path`), pontas
de seta (`Polygon`), caixas e textos dos pesos (`Rect`/`Text`), círculos (`Circle`) e rótulos (`Text`), de modo que nenhum traço
atravessa um círculo. Cores **só dos tokens do tema** (sem paleta própria): vértice `primaryMuted` com contorno `primary`, rótulo
e peso `text`, traço e seta `textSecondary`, fundo do canvas e da caixa do peso `surface`, borda `border`. **Direção aparece na
seta, peso no texto e isolado pela ausência de arestas: nada depende só de cor.** Não altera o grafo, não despacha ação, não guarda
estado nem trata gesto. Acessibilidade: o conjunto é **uma imagem** com o resumo como descrição; os elementos internos ficam
escondidos dos leitores de tela. `graph-renderer.ts` só declara o contrato de props (`scene`, `width`, `height`), sem hierarquia
genérica nem Skia (que **não** foi instalado).

**Exemplo** (`example-graph.ts`): orientado, A, B, C e D (isolado); A → B (sem peso), B → A (peso 0, arco oposto), B → C (−2),
C → A (5), montado **só com as operações do domínio** e com cada `Result` conferido (o primeiro erro volta no `Result`, nada fica
pela metade). O layout vem de `circularLayout`.

**Tela e store.** `EditorStoreProvider` (no escopo da tela Laboratório) cria a store **uma vez por montagem** (`useState` com
inicializador preguiçoso), sem singleton; `useEditorStore(selector)` usa `useStore` do Zustand e re-renderiza só quando a fatia
muda. "Carregar exemplo" chama o `reset` do 3.4, que **carrega o grafo e o layout novos, zera histórico, seleção e erro, define o
modo `select` e não preserva posições de outro grafo**. Se a aba for desmontada a sessão acaba (nada é persistido). O canvas é medido
por `onLayout` (largura arredondada; altura = 0,9 × largura, entre 240 e 420 dp), então repetir a mesma medida não recalcula nada.

**Complexidade** (V vértices, E arestas): `buildGraphScene` e `fitCameraToGraph` Θ(V + E) em tempo e espaço (índices temporários
de arcos, de pesos e de isolados; nenhuma busca O(E) por aresta); a conversão de coordenadas é O(1) por ponto; o SVG tem
Θ(V + E) elementos (um círculo e um texto por vértice; um traço por aresta, mais seta e peso quando há). Depois de uma alteração a
cena é **refeita inteira**, Θ(V + E), sem atualização incremental (no 3.6, uma vez por toque; sem arrasto, nada é recalculado a cada quadro).
Carregar o exemplo é Θ(1) (tamanho fixo) mais o `reset` (Θ(V) para reconciliar o layout). Sem virtualização, índice espacial nem Skia.

**Limitações conhecidas.** Texto não medido (rótulos e caixas dos pesos são estimativas); centro vertical do texto aproximado (linha
de base a 0,35 do corpo); peso e rótulo ancorados, mas não selecionáveis; a curva pode roçar círculos muito próximos (3.3); com
muitos vértices a escala mínima deixa o conteúdo fora da área; sem seleção, sem estados (origem da conexão, prévia, rastros de
algoritmos), que entram com os incrementos seguintes.

**Validação no Android (emulador Pixel_6, 1080 × 2400 a 420 dpi, ≈ 411 dp de largura, Expo Go, SDK 58).** Conferido por captura
de tela, nos temas escuro e claro: (1) o Laboratório abre sem erro; (2) "Carregar exemplo" funciona; (3) os quatro vértices
aparecem; (4) o isolado D é visível; (5) as setas apontam para o destino certo (A → B em B, B → A em A, B → C em C, C → A em A); (6)
os arcos opostos são duas curvas distintas; (7) o peso `0` aparece; (8) a aresta sem peso não mostra número; (9) o conteúdo fica
dentro do quadro; (10) a navegação entre abas funciona e o grafo carregado continua ao voltar ao Laboratório; (11) nenhum elemento
importante some em um dos temas, e o desenho troca de tema ao vivo. **Não verificado:** TalkBack e qualquer leitor de tela, iOS,
aparelho físico, outras larguras (cobertas só por Jest: 320, 360, 411 e 600 dp), rotação, escala de fonte do sistema, desempenho
com muitos vértices e toque. Os testes Jest **não** substituem essa verificação.

### Modo Adicionar vértice e toque (incremento 3.6: `core/tap.ts`, `canvas-tap-detector.tsx` (renomeado `canvas-gesture-detector.tsx` no 3.9), `editor-controls.tsx`, `new-graph.ts`)

O aluno começa um grafo vazio (orientado ou não), escolhe **Adicionar vértice** e toca no quadro: cada toque em área vazia cria um
vértice **sob o dedo**; Desfazer e Refazer ficam na tela. **Não existiam no 3.6** (e não foram simulados) a conexão de vértices (feita no 3.7), seleção por
toque (3.8), arrasto (3.9), zoom e pan por gesto (3.10) nem edição de peso. O modo Selecionar pode ser escolhido, mas tocar no quadro
nesse modo **não faz nada** (a dica do botão diz isso).

**Caminho de um toque** (cada seta é uma chamada de função; nada percorre o caminho duas vezes):
`GestureDetector` (um só, em volta da view do quadro) → `useTapGesture` → `onDeactivate` (só se não `canceled`) → `onCanvasTap(ponto)`
na tela → `tapToEditorAction(estado, câmera, ponto, viewport)` (núcleo puro, `core/tap.ts`) → `dispatch(ação)` da store → `applyAction`
(3.4: id, rótulo, posição no layout, histórico) → a tela refaz a cena (`buildGraphScene`) → `SvgGraphRenderer`. O estado do editor é lido
**na hora do toque** (`store.getState()`), não de uma cópia de renderização.

**`tapToEditorAction(estado, câmera, pontoDeTela, viewport, opções?) → EditorAction | undefined`.** Pura: não altera nada (só descreve a
ação) e é determinística. Regras, em ordem (a primeira que falha devolve `undefined`, isto é, nenhuma ação): (1) câmera válida, `viewport`
finito e > 0 e toque finito; (2) o toque está **dentro** do quadro, `0 ≤ x ≤ largura` e `0 ≤ y ≤ altura` (os limites contam); (3) o modo é
`add-vertex`; (4) o `hitTest` do 3.3 (**a mesma função** do resto do editor; não há outro hit-testing, nem nos testes) responde
`background`: toque sobre um vértice (alvo mínimo de 48 dp incluído) ou sobre uma aresta (tolerância de 12 dp) nunca cria nada, e a
prioridade segue vértice > aresta > fundo; (5) `screenToWorld` (escala e translação, **uma vez** cada) e o resultado precisa ser finito.
Devolve `{ type: 'add-vertex', position }` com um ponto **novo**. Ids e rótulos são do `applyAction` (3.4); a interface **não** tem um
segundo algoritmo de rótulo.

**Origem das coordenadas (o que precisa coincidir).** O ponto é **local ao quadro, em dp**, com a origem no canto superior esquerdo. É a
**mesma** origem da câmera, do `viewport` e da cena. Para isso: (a) o detector envolve a **própria view do quadro** (`canvas-area`), então
`event.x` e `event.y` do Gesture Handler já são locais a ela; `absoluteX` e `absoluteY` (da tela) **nunca** são usados; (b) o `viewport` da
tradução é a mesma largura e altura (em dp) que alimentam a cena e o `<Svg>`, vindas do mesmo `onLayout`; (c) o SVG não tem `viewBox`
escalado nem `transform` (a escala vale uma vez, na cena); (d) a borda de 1 dp é uma camada **sobre** o quadro (`pointerEvents: none`), não
ocupa espaço dentro dele; (e) dp, não pixels físicos (a conversão por densidade é do próprio React Native).

**Demonstração da conversão.** Câmera `{ x: 40, y: −30, scale: 2 }` (`tela = mundo · escala + (x, y)`) e toque em `(120, 90)` dp: `mundo = ((120 − 40) / 2,
(90 − (−30)) / 2) = (40, 60)`; a volta, `(40·2 + 40, 60·2 − 30) = (120, 90)`, devolve o toque, então o círculo desenhado fica sob o dedo. Com a
câmera neutra (grafo novo) o mundo é o próprio ponto de tela. Conferido por teste com escalas 0,25, 1 e 4 e translações positivas e negativas.

**Detector (`canvas-tap-detector.tsx`)** (Gesture Handler 3.3.0, API de hooks; Reanimated 4.7.1 e Worklets 0.13.0 instalados):
`useTapGesture` + `GestureDetector`. `runOnJS: true`: o callback roda no JavaScript, onde vivem a store e o React; nada é despachado de um
worklet na thread de interface (o toque simples não precisa de resposta a cada quadro). O toque conclui em **`onDeactivate`**, uma vez; se
`event.canceled`, nada acontece. `onActivate` e `onFinalize` **não** são usados (o `onFinalize` também dispara depois do `onDeactivate`:
tratá-lo duplicaria a ação). Um único detector, na view nativa do quadro; **nenhum** nos elementos do SVG (decisão do 3.0). Um
`InterceptingGestureDetector` **não** foi necessário: no emulador o toque no fundo do quadro chega ao detector mesmo com o SVG por cima,
e o que está sob o dedo (vértice, aresta, fundo) é decidido pelo núcleo.
- **`maxDistance` = 10 dp (achado no emulador).** No Android o padrão do Gesture Handler **não limita a distância** do toque (só a
  duração, 500 ms). Um deslize rápido (300 ms, ~240 dp) começado sobre o quadro, ao rolar a página, era aceito como toque e criava um
  vértice. Com `maxDistance: 10` (a folga de toque do Android é 8 dp), o deslize falha o gesto, a página rola e nada é criado. O
  simulador de gestos do Jest não mede distância; os testes garantem a **configuração** entregue (`maxDist` 10 no gesto), e o efeito foi
  conferido no emulador.
- `shouldCancelWhenOutside` fica no padrão (o dedo que sai do quadro cancela o toque). Não é observável no Jest nem foi testado no emulador.

**Mensagem do quadro vazio.** Fica **dentro** do quadro, sobreposta, centralizada e com `pointerEvents: none` (o toque a atravessa), e
some quando o grafo deixa de ser vazio. Não pode ficar acima do quadro, **no fluxo**: no emulador, ao criar o primeiro vértice ela
sumia, o quadro subia ≈ 36 dp e o vértice criado ficava longe do dedo. Dentro do quadro, nada muda de lugar. O texto muda com o modo
("Toque no espaço para adicionar o primeiro vértice." em Adicionar vértice; "Selecione Adicionar vértice e toque no espaço para
começar." nos demais). Não há camada invisível: a mensagem é visível e transparente ao toque.

**Controles (`editor-controls.tsx`, `components/tool-button.tsx`).** `ModeBar` (grupo de rádio "Modo de edição") e `HistoryBar`. Só
despacham ações do núcleo (`set-mode`, `undo`, `redo`) pela store da sessão, assinando só a fatia de que precisam; **nenhuma regra nem
histórico próprio**. Trocar de modo não cria histórico (o objeto `history` é o mesmo) e Desfazer não desfaz o modo.

| Controle | Estado | Aparência (não depende só de cor) | Acessibilidade |
| --- | --- | --- | --- |
| Selecionar | habilitado; ativo quando é o modo | ativo: fundo `primary`, "✓" e texto `onPrimary` | `radio`, `selected`, dica "Por enquanto, tocar no quadro não seleciona nada" |
| Adicionar vértice | habilitado; ativo quando é o modo | idem | `radio`, `selected`, dica "Toque no espaço vazio do quadro para criar um vértice" |
| Conectar | **desabilitado no 3.6** (o 3.7 o habilitou: ver "Modo Conectar") | contorno **tracejado**, legenda "em breve" (3.6) | `radio`, `disabled`, dica "Ainda não está disponível" (3.6) |
| Desfazer / Refazer | habilitados só se `selectCanUndo` / `selectCanRedo` | desabilitado: contorno tracejado | `button`, `disabled` |

Alvos de toque de pelo menos 48 dp (`minTouchTarget`); o rótulo quebra em duas linhas em telas estreitas, e o rótulo tem `flexShrink` para
não empurrar a marca "✓" para fora do botão (defeito visto no emulador). Os botões de início ("Novo grafo não orientado", "Novo grafo
orientado", "Carregar exemplo") continuam na tela; nenhum modal nem biblioteca de bottom sheet foi usado.

**Novo grafo.** `buildNewGraph(orientado, serial)` usa `createGraph` do domínio com id próprio (`novo-grafo-<n>`) e o nome
"Novo grafo (não) orientado". A tela chama o `reset` da store (3.4) com `{ graph, mode: 'add-vertex' }`: **sem vértices nem arestas,
layout vazio do grafo novo, histórico, seleção e erro vazios, modo `add-vertex`, câmera neutra** e nada herdado da sessão anterior
(nem ids, nem posições, nem histórico). O exemplo continua igual (modo `select`, câmera enquadrada). **Começar outro grafo substitui o
atual na hora, sem confirmação**, e Desfazer não o traz de volta.

**Política da câmera durante a edição.** A câmera **não** está na store e **não** depende do grafo atual. Grafo novo: câmera **neutra**
(`NEUTRAL_CAMERA`: a origem do mundo no canto do quadro, então cada vértice nasce no ponto tocado, em dp). Exemplo: **enquadrada uma vez**,
a partir do grafo **carregado**. Adicionar vértice, desfazer, refazer e trocar de modo **não mudam a câmera** (o exemplo não é
reenquadrado ao receber um vértice; um vértice criado depois fica no ponto tocado, mesmo fora do enquadramento original).
Redimensionar ou girar: com a câmera neutra nada muda (os vértices ficam à mesma distância do canto, em dp; se o quadro encolher, o que
ficar fora é recortado pelo SVG); com a enquadrada, o enquadramento é refeito a partir do grafo **carregado** (não do editado) quando o
quadro é medido de novo. Não há gesto de zoom nem de pan.

**Integração com o histórico (3.4, sem reimplementação na tela).** Cada toque que cria é **uma** ação `add-vertex` e **um** passo de
histórico; desfazer remove o último vértice, refazer o devolve com o **mesmo** id, rótulo e posição, e um toque novo depois de desfazer
**descarta** o refazer. Os ids **nunca** são reaproveitados: em um grafo novo, três toques dão `v1` A, `v2` B e `v3` C; Desfazer remove `v3`;
um novo toque cria `v4` com o rótulo **C** (o menor rótulo livre), e o `v3` não volta. Os botões não mudam a câmera nem criam histórico.

**Complexidade** (V vértices, E arestas, N = 24 amostras por curva no hit-testing): a tradução do toque é Θ(V + E·N) no pior caso (o do
`hitTest`: Θ(V) se o toque acerta um vértice, senão confere as arestas) mais O(1) para a conversão; atualizar o grafo (`add-vertex`) e o
layout é Θ(V) (cópias imutáveis; o passo de histórico guarda as referências, Θ(1)); a cena é refeita inteira, Θ(V + E); o SVG tem Θ(V + E)
elementos. Tudo isso roda **uma vez por toque**: sem arrasto, nada é recalculado a cada quadro. Sem índice espacial nem dependência de
desempenho (para dezenas ou centenas de vértices basta; limites só depois de medir, tarefa 4.6).

**Validação no Android** (emulador Pixel_6, 1080 × 2400 a 420 dpi, 2,625 px por dp, Expo Go, SDK 58, `adb shell input tap` com toques reais
sobre as capturas convertidas para pixels físicos; temas escuro e claro): (1) o Laboratório abre; (2) "Novo grafo não orientado" funciona;
(3) "Novo grafo orientado" funciona (resumo "Grafo orientado…") e não herda o grafo anterior; (4) um toque cria A; (5) outro cria B; (6) o
vértice aparece **exatamente sob o toque** (capturas: toque e centro do círculo no mesmo ponto); (7) o quadro **não se desloca** depois da
criação; (8) tocar em A (e na aresta C → A do exemplo) não cria nada; (9) Desfazer remove o último vértice; (10) Refazer o devolve no mesmo
ponto; (11) um toque novo depois de desfazer cria o rótulo livre (B) e desabilita o Refazer; (12) "Carregar exemplo" substitui o grafo,
mantém o enquadramento ao receber um vértice (E) e zera o histórico; (13) os controles e o quadro são legíveis nos dois temas; (14) a
navegação entre abas funciona e o Laboratório volta com o mesmo grafo. **Três defeitos reais achados e corrigidos nessa verificação**
(nenhum aparece no Jest): o quadro subia quando a mensagem do quadro vazio sumia; a marca "✓" do modo ativo era cortada pelo botão;
um deslize rápido sobre o quadro criava um vértice (o `maxDistance` acima). **Não verificado:** TalkBack e qualquer leitor de tela, iOS,
aparelho físico, **pinça, arrasto e multitoque** (não pertencem a este incremento), outras larguras (só Jest), rotação, escala de fonte
do sistema, toque longo, o cancelamento por sair do quadro, desempenho com muitos vértices, e a distinção entre a unidade `dp` do
Jest e a do aparelho em outras densidades. O Metro registrou uma vez a linha "Project is incompatible with this version of Expo Go"
na primeira abertura; o app abriu e funcionou em todas as seguintes (o menu do Expo Go mostrou SDK 58.0.0) e a linha não foi
investigada a fundo.

**Testes do 3.6** (117 novos; total do projeto **2020**, 37 suítes). `core/tap.test.ts` (projeto `editor-core`, 50): conversões **calculadas à mão**
(câmera `{40, −30, 2}`, escalas 0,25 e 4, translações), os três modos, toque em vértice e em aresta nas bordas exatas (24 dp e 12 dp, em escalas
0,25 e 4), arcos opostos, entradas inválidas (câmera, área, coordenadas, layout de outro grafo), toque fora do quadro (as bordas contam), área
degenerada com o toque na borda, 500 casos aleatórios com o **próprio `hitTest` como oráculo** (sem segunda implementação), imutabilidade,
determinismo e a integração com `applyAction` (A, B, C → desfazer → `v4` com o rótulo C). `new-graph.test.ts` (3); `editor-controls.test.tsx`
(18: modos, estado ativo por marca **e** estado acessível, Conectar desabilitado, alvos de 48 dp, `set-mode` sem histórico, desfazer e refazer
pelos botões, novo ramo, rótulo que encolhe); `canvas-tap-detector.test.tsx` (11: um `onTap` por toque, cancelado e falho não editam, local ×
absoluto, consecutivos, callback mais recente, e a configuração `maxDist` 10, `runOnJS` e `shouldCancelWhenOutside`); `lab-screen-tap.test.tsx`
(23: o toque de ponta a ponta com o gesto simulado: A sob o toque, B, toque em vértice e em aresta, modos Selecionar e Conectar, cancelado,
fora do quadro, antes da medida (grafo novo e exemplo), desfazer e refazer, câmera não reenquadrada, redimensionamento, temas) e
`lab-screen.test.tsx` (34, 12 a mais: novo grafo orientado e não orientado, nada herdado da sessão anterior, câmera estável, mensagem do quadro
vazio dentro do quadro e sem capturar toques). **Mutação dirigida:** 70 mutações (21 de `tap.ts`, 11 do detector, 16 da tela, 19 dos controles,
do botão e de `new-graph.ts`, e 3 do histórico vistas pela interface). Foram detectadas **68** (5 só depois de reforçar os testes: área de largura
0 e de altura 0 com o toque na borda, `runOnJS` e `shouldCancelWhenOutside` na configuração do gesto, e o toque no exemplo antes de o canvas ser
medido, que quebraria por não haver câmera enquadrada). As **2 equivalentes**: câmera inválida e toque não finito aceitos em `tap.ts`, porque o
`hitTest` já recusa as duas entradas (a guarda explícita fica por clareza e custa O(1)). Cobrem: Y deslocado por offset de tela, coordenadas
absolutas no lugar das locais, câmera ignorada, escala aplicada duas vezes, toque cancelado criando vértice, toque sobre elemento criando
vértice, um toque gerando duas operações (`onFinalize`, `onActivate`, despacho duplo), histórico não atualizado, refazer não descartado, ids
reaproveitados depois de desfazer, câmera reenquadrada a cada edição, reset que preserva dados (a tela e, desde o 3.5, a store) e botões
habilitados indevidamente. As mutações do núcleo de edição (3.4) e da geometria (3.3) não foram repetidas; as 3 do histórico foram rodadas só
contra os testes da interface, para provar que a tela também as detecta.

**Limitações conhecidas.** (Do 3.6; Selecionar passou a selecionar no 3.8 e Conectar existe desde o 3.7.) Sem arrasto, zoom nem pan (o toque só cria
vértices); "Novo grafo" substitui o grafo atual sem confirmação e sem desfazer; a câmera é estática (um vértice tocado perto da borda
pode ficar parcialmente cortado, e fora do enquadramento original do exemplo ele pode ficar fora da área visível ao girar o aparelho); o
texto do SVG não é medido (3.5); a mensagem do quadro vazio e os rótulos não acompanham a escala de fonte do sistema com garantia (não
testado); o `shouldCancelWhenOutside` e o toque longo (> 500 ms, que não vira toque) não foram testados no aparelho; não há persistência
do grafo criado (a sessão acaba ao desmontar a aba).


### Modo Conectar (incremento 3.7: `core/connect.ts`, `core/connect-status.ts`, `editor-store.ts`, `editor-controls.tsx`, destaque no SVG)

O aluno escolhe **Conectar**, toca em um vértice (a **origem**, que ganha destaque) e em outro (o **destino**): o núcleo cria a aresta. Em um grafo
orientado o resultado é A → B; em um não orientado, A—B. **A orientação é do `Graph`**: nem a máquina de estados nem a interface têm uma regra
de orientação (ver "Orientação" abaixo). Continuam **fora**: arrastar, zoom e pan por gesto, editar rótulo ou peso, selecionar por toque e excluir
(3.8 a 3.10). Não há linha acompanhando o dedo: o detector reconhece toques, não o movimento contínuo do ponteiro (a prévia é o destaque da
origem, a instrução e o botão Cancelar).

**Máquina de estados pura (`core/connect.ts`).** TypeScript puro, sem gesto, React, SVG nem store. Só DECIDE; não altera o grafo nem o layout, não cria
aresta e não valida aresta (laço, duplicata, vértice inexistente e orientação são do `addEdge` do domínio, pelo `applyAction`).
- `ConnectState = { sourceVertexId? }`: um id, nunca uma cópia do grafo. Fora do `Graph`, do `GraphLayout`, do JSON v1 e dos instantâneos do histórico.
- `connectStep(connection, alvo, graph) → { connection, action?, outcome }`; `outcome` é `source-set`, `cancelled`, `connect` ou `ignored`.
- `reconcileConnection(connection, editor)`: a origem só vale no modo `connect` e enquanto o vértice existe.
- `tapToConnectTransition(editor, connection, câmera, ponto, viewport, opções?)`: identifica o alvo com `hitTapTarget` (o MESMO trecho de validação e
  `hitTest` do 3.3 que o modo Adicionar vértice usa; foi extraído de `tapToEditorAction` sem mudar o comportamento) e passa por `connectStep`.

| Estado | Alvo do toque (do `hitTest`) | Resultado | Ação |
| --- | --- | --- | --- |
| sem origem | vértice | **origem escolhida** (`source-set`) | nenhuma |
| sem origem | aresta ou fundo | nada (`ignored`) | nenhuma |
| com origem | a própria origem | **cancela** (`cancelled`), sem erro de laço | nenhuma |
| com origem | outro vértice | **conecta** (`connect`) e LIMPA a origem | `connect(origem, destino)`, uma vez |
| com origem | aresta ou fundo | **cancela** | nenhuma |
| qualquer | toque inválido ou fora do canvas | `ignored`: nada muda | nenhuma |

Tocar duas vezes no mesmo vértice cancela (decisão de produto): nunca cria laço e não mostra erro, porque o aluno está desistindo. `SELF_LOOP` segue
obrigatório no domínio e no `connect` usado por outros consumidores. Escolher a origem não cria aresta, não gasta id e não entra no histórico.

**Origem pendente na store (`editor-store.ts`).** Ao lado do `EditorState` matemático a store guarda dois estados TRANSITÓRIOS da sessão, fora do histórico:
`connection` (a origem pendente) e `connectNotice` (o que o último toque do modo Conectar fez: aresta criada, recusada ou cancelada, para o aluno ler).
A API é pequena e não repete a máquina: `connectTap(câmera, ponto, viewport)` pede a transição ao núcleo, aplica a ação `connect` pelo `applyAction` e
guarda tudo num único `set` (nenhum assinante vê a origem limpa com o grafo ainda sem a aresta); `cancelConnection()` é o botão Cancelar. O `EditorState`
não ganhou nenhum campo. A origem é mantida coerente pelo `dispatch` (`reconcileConnection` depois de toda ação efetiva) e pelo `reset`.

**Quando a conexão é cancelada** (nenhum cancelamento altera o grafo nem cria histórico):
1. tocar de novo na própria origem; 2. tocar no fundo; 3. tocar em uma aresta; 4. o botão Cancelar; 5. trocar de modo (`set-mode`, que entra pelo `dispatch`);
6. "Novo grafo" ou "Carregar exemplo" (`reset`); 7. a origem deixar de existir (desfazer, refazer ou qualquer ação que remova o vértice; refazer não a traz de volta).
Desfazer que NÃO remove a origem a mantém. Toque inválido, fora do canvas ou cancelado/falho do gesto (um deslize) não muda nada.

**Orientação.** A máquina entrega origem e destino na ordem dos toques e mais nada. Orientado: A → B e B → A são arestas distintas (as duas curvas opostas do 3.3,
cada uma com a seta no destino), e repetir A → B é `DUPLICATE_EDGE`. Não orientado: B—A repete A—B, o domínio recusa e só há uma aresta, sem seta. Os testes
conferem as duas orientações contra o `applyAction`, sem copiar a regra.

**Histórico e erros.** Uma conexão concluída é UM passo de histórico (o mesmo `commit` do 3.4); desfazer remove a aresta, refazer a devolve com o MESMO id, e uma conexão
nova depois de desfazer usa id novo e descarta o ramo de refazer. Uma recusa (duplicata, vértice inexistente) não cria passo, não consome o contador de arestas e deixa o erro
em `editor.error`; a origem é LIMPA depois da tentativa, e a mensagem é a do domínio em português (`editorErrorMessage`, por exemplo "Esses dois vértices já estão
ligados por uma aresta (no mesmo sentido, se o grafo é orientado)."). O erro antigo some quando o aluno começa outra conexão ou cancela; a recusa nunca vira sucesso silencioso.

**Destaque da origem (`svg-graph-renderer.tsx`).** O renderizador recebe `highlightedVertexId` e desenha um **anel tracejado** concêntrico (raio + 7 dp, 3 dp de traço, token `primary`)
e engrossa o contorno do vértice (4 dp contra 2 dp). Não depende só de cor: a diferença é de FORMA. É só desenho: a cena (`buildGraphScene`) não é refeita ao escolher a origem
e a geometria do vértice não muda. Funciona nos temas claro e escuro.

**Instrução, aviso e acessibilidade inicial (`ConnectStatus`).** Só no modo Conectar, logo ABAIXO do canvas: "Toque em um vértice para escolher a origem da conexão." →
"Origem: A. Toque no vértice de destino." (com o botão **Cancelar**) → "Aresta criada de A para B." (orientado) ou "Aresta criada entre A e B." (não orientado), "Conexão não
criada. <motivo>" ou "Conexão cancelada." O texto cita o RÓTULO dos vértices, nunca o id. É uma região viva (`accessibilityLiveRegion="polite"`) e o modo ativo, a origem e o estado
saem por texto, não só por cor. **TalkBack não foi testado**: a acessibilidade detalhada dos elementos gráficos continua sendo o incremento 3.12.

**Barra de modos.** Conectar passou de "em breve" a **ativo**: escolhê-lo usa `set-mode` (sem histórico). Fica desabilitado com menos de dois vértices (contorno tracejado, legenda
"2+ vértices" e a dica acessível "Adicione pelo menos dois vértices para poder conectar"); se o modo já está ativo (depois de desfazer vértices), o botão continua habilitado e ativo.

**O canvas não se desloca (defeito achado no emulador).** A barra de modos e o que vier ANTES do canvas não podem mudar de altura num toque. Na primeira versão, a legenda do Conectar bloqueado
("precisa de 2 vértices") quebrava em duas linhas no botão estreito e, quando o segundo vértice a fazia sumir, a barra encolhia ≈ 13 dp e o canvas subia no mesmo toque: A e B
nasceram 13 dp acima do dedo (C, depois, no lugar certo). Correção: a legenda cabe em UMA linha ("2+ vértices", `numberOfLines={1}`) e a barra tem altura mínima fixa de duas linhas
(67 dp). A instrução do Conectar fica DEPOIS do canvas, numa linha de altura mínima igual à do botão Cancelar (51 dp), então nem a instrução nem o Cancelar mexem em nada acima delas;
o que está abaixo (selo, resumo, Desfazer) também não pula quando o Cancelar aparece (conferido por capturas). Os testes de Jest garantem o piso, a legenda de uma linha e a posição do
canvas no bloco; só o emulador mostra a quebra de linha real.

**Aviso "Project is incompatible with this version of Expo Go".** Investigado: o projeto instala o Expo **58.0.21** (SDK 58) e o Expo Go do emulador é o **58.0.5** (SDK 58): a mesma SDK.
`npx expo install --check` e `npx expo-doctor` apontam só divergências de **patch e minor dentro da SDK 58** (7 pacotes: `expo` 58.0.21 → ~58.0.23, `expo-constants`, `expo-linking`,
`expo-router`, `expo-splash-screen`, `jest-expo` e `react-native-safe-area-context` 5.10.1 → ~5.11.1); o doctor passou 19 de 20 verificações. Nada foi atualizado (a regra é não atualizar às cegas:
isso é uma tarefa à parte, com `npx expo install --fix` e teste em aparelho). Em 3 aberturas do app nesta etapa (uma delas com `--clear`) o aviso **não reapareceu**, e o Metro não registrou
erro. **Conclusão: aviso transitório de causa não identificada**; não houve incompatibilidade real de SDK. Observação útil: o Metro com `CI=1` roda em "modo CI, recargas desabilitadas" (não observa
arquivos), o que já causou telas desatualizadas durante os testes; reinicie o Metro para ver código novo.

**Complexidade** (V vértices, E arestas, N = 24 amostras por curva, L = limite do histórico): o hit-testing do toque é Θ(V + E·N) no pior caso; escolher ou limpar a origem é O(1) (um id)
mais Θ(V) para conferir que o vértice existe; criar a aresta é Θ(E) (a busca de duplicata do domínio) mais o passo de histórico, Θ(L); a cena só é refeita, Θ(V + E), quando o GRAFO muda (conexão,
desfazer, refazer), e **não** ao escolher a origem (o destaque é só uma propriedade do renderizador); o SVG tem Θ(V + E) elementos mais um anel. Tudo uma vez por toque, sem arrasto. Sem índice espacial.

**Validação no Android** (emulador Pixel_6, 1080 × 2400 a 420 dpi, Expo Go 58.0.5, `adb shell input tap` com toques reais; temas escuro e claro): (1) grafo novo não orientado com A, B e C; (2) Conectar
ativo; (3) toque em A: anel tracejado, contorno grosso, "Origem: A. Toque no vértice de destino." e Cancelar, sem o canvas mexer; (4) toque em B: aresta A—B sem seta e "Aresta criada entre A e B.";
(5) Desfazer remove a aresta e Refazer a devolve; (6) B e depois A (não orientado) é recusado com a mensagem do domínio, ainda uma aresta; (7) cancelar tocando no fundo, na própria origem e em uma aresta;
(8) trocar de modo com a origem pendente apaga o destaque e a instrução, e voltar a Conectar não a traz de volta; (9) um deslize rápido (200 ms) começando em A até B e outro vertical começando em C
(que rola a página) não escolhem origem nem criam aresta; (10) grafo orientado: A → B (seta em B), B → A (duas curvas separadas, cada seta no destino certo) e A → B de novo recusado; (11) o modo Adicionar
vértice continua criando o vértice sob o toque; (12) "Carregar exemplo" com a origem pendente a descarta (modo Selecionar, sem anel); (13) tema claro com anel e controles legíveis; (14) a navegação entre
abas funciona e o Laboratório volta com o mesmo grafo e a mesma origem. **Defeito real achado e corrigido nessa verificação** (nenhum teste de Jest o via): o deslocamento do canvas por causa da
legenda do Conectar (acima). **Não verificado:** TalkBack e qualquer leitor de tela, iOS, aparelho físico, pinça, arrasto e multitoque (não pertencem ao incremento), outras larguras (só Jest), rotação,
escala de fonte do sistema, toque longo e desempenho com muitos vértices.

**Testes do 3.7** (121 novos; total do projeto **2141**, 40 suítes). `core/connect.test.ts` (projeto `editor-core`, 46): a máquina com exemplos calculados à mão (primeiro e
segundo toque, a ordem v1 → v2 e v2 → v1, cancelar na origem, no fundo e em aresta, destino inexistente, origem velha, toque inválido), `reconcileConnection` (modo, origem removida por
desfazer e refazer), o toque com o `hitTest` real (alvo de 48 dp, prioridade vértice > aresta, câmera `{40, −30, 2}`, bordas do canvas, opções do hit-testing), a integração com `applyAction`
nas duas orientações (A—B e B—A recusado; A → B, B → A e A → B recusado; desfazer, refazer e id novo), 500 sequências de 12 toques e 200 toques com sementes fixas, imutabilidade,
determinismo e o texto de estado. `editor-store-connect.test.ts` (30: origem, destino, um passo de histórico, cancelamentos, sincronização com troca de modo, `reset` e desfazer, recusas
sem histórico nem id gasto, notificações únicas), `lab-screen-connect.test.tsx` (27: o fluxo de ponta a ponta com o gesto simulado, destaque, histórico, duplicatas, cancelamentos, exemplo,
câmera, ordem dos elementos na tela e temas), `editor-controls.test.tsx` (9 a mais: Conectar habilitado só com 2 vértices, altura da barra, `ConnectStatus`) e `svg-graph-renderer.test.tsx`
(9 a mais: o anel). **Mutação dirigida:** 64 mutações (25 do núcleo: `connect.ts`, `connect-status.ts` e o `hitTapTarget` compartilhado; 9 da store; 3 do `connect` em `editor.ts`, vistas pela
store e pela tela; 7 da tela; 11 dos controles e do botão; 6 do renderizador; 2 do detector; e 1 extra, a posição da mensagem do quadro vazio do 3.6). Foram detectadas **63**, 2 só depois de
reforçar os testes (a asserção "nada vem antes do canvas" era vazia, porque `parent.children` só tem o próprio canvas e a instrução do Conectar, posta ANTES dele, passava; e as opções do
hit-testing nunca eram passadas ao modo Conectar), e 1 é **equivalente**: tirar o `return` depois do `connectTap` na tela, porque o caminho de criar vértice já recusa qualquer modo que não seja
Adicionar vértice. Cobrem: origem e destino invertidos, primeiro toque pedindo a aresta, segundo toque sem aresta, fundo ou aresta criando conexão, cancelamento ignorado, origem mantida depois
de trocar de modo, `reset` que preserva a origem, duplicata no histórico, dois passos de histórico por conexão, contador consumido por recusa, ordem da aresta normalizada (A—B e B—A), destaque
no vértice errado, instrução com o rótulo incorreto, deslize virando toque e o canvas deslocado. As baterias de mutação do domínio (Fase 2) e do núcleo (3.3 e 3.4) não foram repetidas.

**Limitações conhecidas.** Sem linha que acompanhe o dedo (a prévia é o destaque, a instrução e o Cancelar); a aresta criada pelo toque não tem peso (editar peso é do 3.8); Selecionar ainda não
seleciona; sem arrasto, zoom nem pan; "Novo grafo" substitui o grafo atual sem confirmação; o aviso do último toque some na próxima ação (não há histórico de mensagens); a instrução e o aviso não
foram validados com leitor de tela; um grafo com rótulos muito longos faz a instrução quebrar em mais linhas (só o que está abaixo do canvas se mexe); com escala de fonte maior a barra de modos
pode crescer (não testado).


### Seleção, propriedades e exclusão (incremento 3.8: `core/selection.ts`, `core/weight-input.ts`, `core/properties.ts`, `core/deletion.ts`, `properties-sheet.tsx`, destaque no SVG)

No modo **Selecionar** o toque seleciona um vértice ou uma aresta; os botões **Editar** e **Excluir** abrem a folha de propriedades (rótulo do vértice, peso da
aresta) ou a confirmação de exclusão. Tudo passa pelo núcleo: `select`, `clear-selection`, `set-label`, `set-weight` e `remove-selection` (3.4). **Não existem** (e não foram
simulados) arrasto, zoom e pan por gesto, toque longo, SQLite nem algoritmos. O domínio e o JSON v1 não mudaram.

**Seleção por toque (`tapToSelectionAction(estado, câmera, ponto, viewport, opções?) → EditorAction | undefined`).** Pura, nos moldes de `tapToEditorAction` (3.6) e de
`connect.ts` (3.7). O que está sob o dedo vem de `hitTapTarget` (o MESMO trecho de validação e `hitTest` do 3.3; **nenhuma** conta de proximidade nova):

| Modo | Alvo do toque (do `hitTest`) | Ação |
| --- | --- | --- |
| `select` | vértice | `select` do vértice (por id técnico) |
| `select` | aresta (fora de qualquer vértice) | `select` da aresta |
| `select` | fundo | `clear-selection` |
| `select` | toque fora do canvas, inválido ou câmera/área inválidas | nada |
| `add-vertex`, `connect` | qualquer | nada (cada modo tem o seu caminho) |

A prioridade vértice > aresta > fundo é a do `hitTest` (vértice sobre aresta vence; arcos opostos são duas curvas, cada uma selecionável por si). Tocar de novo no que já está
selecionado **mantém** a seleção: o `applyAction` devolve o mesmo estado e ninguém é avisado. **Um toque, um caminho:** a tela escolhe pelo modo (`connect` → `connectTap`; `select` →
`tapToSelectionAction`; `add-vertex` → `tapToEditorAction`), nunca dois. O mesmo detector do 3.6 entrega o toque (coordenadas locais, `maxDistance` de 10 dp, cancelado não age), então um deslize
ou a rolagem da página não seleciona nada.

**A seleção é por id e fica fora do histórico** (3.4): selecionar, limpar, abrir a folha e cancelar não criam passo. Como a seleção é do `EditorState` e o `set-mode` do núcleo não mexe nela, a política
"**sair do modo Selecionar limpa a seleção**" é do `dispatch` da store (a mesma ideia da origem pendente do Conectar), para o destaque não ficar em outro modo; entrar em Selecionar não limpa nada. Uma seleção cujo
elemento deixa de existir (desfazer, refazer, exclusão) é limpa pelo próprio núcleo.

**Contrato de destaque visual.** `GraphRendererProps.selection?: EditorSelection` (ao lado de `highlightedVertexId`, da origem do Conectar). É só um estado VISUAL: a cena (`GraphScene`) e a geometria não mudam, o grafo não
sabe dele, a câmera não é tocada. Vértice: **anel SÓLIDO** concêntrico (token `text`, 3 dp, raio + 6 dp) e contorno de 4 dp (contra 2 dp); aresta: **traço de 4 dp** no token `primary`, um **halo translúcido de 10 dp** por baixo e a
ponta da seta com contorno. O anel da origem do Conectar é **tracejado**; a diferença é de FORMA (sólido × tracejado, espessura, halo), não só de cor, e vale nos dois temas. O halo (10 dp, 5 dp de cada lado) é mais estreito que a tolerância de
toque da aresta (12 dp): o que se vê nunca promete uma área de toque maior que a do hit-testing.

**Linha de estado e botões (`SelectionStatus`).** Só no modo Selecionar, logo ABAIXO do canvas, com altura mínima de 51 dp (a do botão): "Toque em um vértice ou em uma aresta para selecioná-lo." → "Vértice A selecionado." →
"Aresta entre A e B selecionada. Peso 2,5." (ou "Sem peso."; "de A para B" no orientado) e, havendo seleção, os botões **Editar** e **Excluir** (rótulos acessíveis: "Editar propriedades do vértice A", "Excluir aresta entre A e B"). O texto cita o
RÓTULO, nunca o id; é uma região viva (`polite`). Peso `0` aparece como "Peso 0." e aresta sem peso como "Sem peso.", nunca confundidos. Se o texto quebrar em várias linhas (rótulos longos), só o que está ABAIXO do canvas se mexe, nunca o canvas.

**Folha de propriedades (`properties-sheet.tsx`).** Um `Modal` nativo do React Native (transparente, `animationType="slide"`) apresentado como folha inferior; **nenhuma biblioteca** de modal ou de bottom sheet foi instalada. Por ser uma janela própria, ela é SOBREPOSTA: abrir,
fechar, o teclado e as mensagens de dentro dela não mudam o layout nem a câmera do canvas, e a tela ignora toques no canvas enquanto ela está aberta. Duas visões no mesmo `Modal` (dois empilhados são frágeis no Android): **editar** e **excluir**
(a confirmação, separada da edição). Ela só desenha e chama o núcleo: não valida rótulo nem peso (a validação definitiva é a do domínio, por `set-label` e `set-weight`), não conta arestas e não exclui por conta própria.
- **Rascunho:** o campo começa com o valor do elemento (rótulo; peso com vírgula, vazio se não há peso) e o aluno edita só o TEXTO; nada vai ao grafo enquanto digita. **Salvar** monta UMA ação; se o núcleo a aceita (ou ela não tem efeito, como salvar o mesmo valor) a
  folha fecha, e se recusa fica aberta com a mensagem em português. **Cancelar** e o botão **Voltar** do Android (`onRequestClose`) descartam o rascunho sem tocar no grafo nem no histórico. A folha é recriada a cada elemento (`key`), então um rascunho nunca é reaplicado a outro.
- **Vértice:** título "Vértice A", identificador técnico (só leitura), campo Rótulo, Salvar, Cancelar e Excluir. O domínio decide: de 1 a 64 pontos de código (depois de `trim`), Unicode, rótulos repetidos permitidos; erros em português ("O rótulo não pode ficar vazio."). Salvar o mesmo rótulo não cria passo.
- **Aresta:** título "Aresta entre A e B" (ou "de A para B"), identificador, origem, destino, orientação, "Peso atual: sem peso." / "Peso atual: 2,5.", campo Peso com a dica ("Campo vazio: a aresta fica sem peso. O peso 0 é um peso, diferente de nenhum."), botão **Remover peso** (esvazia o campo; só vale ao salvar), Salvar, Cancelar e Excluir.
- **Acessibilidade inicial:** todos os controles têm rótulo em português ("Salvar alterações", "Cancelar edição", "Excluir vértice A", "Confirmar a exclusão do vértice A", "Rótulo do vértice A"), a mensagem de erro é um alerta e `accessibilityViewIsModal` marca a visão. **TalkBack e VoiceOver NÃO foram testados**; a acessibilidade detalhada continua sendo o 3.12.
- **Teclado:** `KeyboardAvoidingView` só no iOS e restrito ao conteúdo do modal; no Android a janela do `Modal` redimensiona sozinha (a folha sobe sem esconder nenhum botão, conferido no emulador). O teclado não recalcula a câmera.

**Onde a folha é montada importa (defeito achado no emulador).** O responder de toques do React Native segue a ÁRVORE DO REACT, não a das janelas: um `Modal` dentro de um `ScrollView` ainda é filho dele. O `ScrollView` da `Screen` tem `keyboardShouldPersistTaps` no padrão (`never`) e,
com um campo focado, **captura** todo toque fora do campo: o botão nunca recebia o toque (nem `pressIn`) e o campo perdia o foco ao soltar. Resultado: com o teclado aberto, o primeiro toque em Salvar ou Cancelar só fechava o teclado, e o botão ainda saltava ~800 px para baixo. A correção é estrutural:
a folha é montada **ao lado** da `Screen`, não dentro dela (um teste confere que nenhum `ScrollView` é ancestral da folha). Foi achada com logs de `pressIn`, `touchStart` e `blur` no aparelho; trocar `keyboardShouldPersistTaps` na rolagem da própria folha, ou tirá-la, não mudou nada.
Um segundo defeito, só do aparelho: `maxHeight: '90%'` na folha (porcentagem contra um pai de altura automática) fazia o Yoga cortar a folha em 90% do próprio conteúdo e o último botão (Excluir) ficava pela metade; agora a altura máxima é um NÚMERO (90% da altura da janela).

**Conversão do texto do peso (`parseWeightInput`, TypeScript puro, sem React Native).** O **campo vazio REMOVE o peso** (`weight: undefined`); `0` é um peso: `Number('') === 0` seria um erro de produto. Gramática explícita, depois de tirar os espaços das pontas:
`sinal? ( dígitos ( separador dígitos )? | separador dígitos ) expoente?`, com `sinal` = `+` ou `-`, `separador` = `,` ou `.` e `expoente` = `e` ou `E` com sinal opcional. **Nada de `parseFloat`** (aceitaria prefixos de textos inválidos).

| Entrada | Resultado |
| --- | --- |
| `2`, `2,5`, `2.5`, `-3,75`, `+4`, `,5`, `1e3`, `2,5E-2` | 2, 2,5, 2,5, −3,75, 4, 0,5, 1000, 0,025 |
| `0`, `-0`, `0,0` | peso `0` (nunca `-0`) |
| vazio, só espaços (inclusive o espaço sem quebra) | **remover o peso** (`undefined`) |
| `abc`, `NaN`, `Infinity`, `12abc`, `1,2,3`, `1.234,56`, `2,`, `0x10`, `1 2`, `--1`, algarismos não latinos | erro de formato |
| `1e400`, `-1e400`, `1e-400` | erro "fora da faixa" (nunca `Infinity` nem um `0` enganoso) |

O ponto é SEMPRE decimal (`1.234` vale 1,234): não há separador de milhar, então não se adivinha. A notação científica é aceita porque o texto que o formulário mostra para um peso existente (`formatWeightForInput`: vírgula decimal, `1e+21` para os extremos) volta a ser lido como o MESMO número (testado em ida e volta com 2000 pesos).

**Exclusão com confirmação (`describeDeletion`, `deletionMessage`, `confirmedDeletionAction`).** A pergunta é montada dos dados: "Excluir o vértice A? Também serão removidas 3 arestas conectadas a ele." (singular: "Também será removida 1 aresta conectada a ele."; sem arestas: "Nenhuma aresta está conectada a ele."), "Excluir a aresta entre A e B?" ou "…de A para B?" no orientado. A contagem é por
aresta, UMA vez cada (entradas e saídas do orientado, e a aresta de um grafo não orientado conta para os dois extremos); como laços são proibidos, uma aresta nunca é incidente duas vezes ao mesmo vértice. **Identidade do alvo:** a confirmação guarda o resumo do momento da pergunta, e `confirmedDeletionAction` só devolve a ação se a seleção ATUAL ainda é aquele mesmo elemento: se mudou,
nada é excluído e a folha avisa ("A seleção mudou: nada foi excluído."), porque o `remove-selection` age sobre a seleção atual e poderia levar um elemento diferente do que o aluno viu. Confirmar usa `remove-selection` do núcleo (3.4): remove o vértice COM as arestas incidentes e a posição dele no layout, limpa a seleção e entra **UM** passo no histórico, qualquer que seja o número de arestas;
desfazer restaura vértice, arestas e posição; refazer remove de novo; os contadores de id nunca recuam (um vértice novo depois de excluir C é `v4`, nunca `v3`). Cancelar não altera nada.

**Histórico (resumo).** Selecionar, limpar, abrir a folha, cancelar, salvar o mesmo valor e salvar um valor inválido: **nenhum passo**. Editar rótulo, definir, trocar ou remover peso, excluir aresta e excluir vértice (com várias arestas): **um passo cada**. Uma edição nova depois de desfazer descarta o ramo de refazer.

**Câmera e canvas.** A câmera continua fora da store e nunca é recalculada por seleção, folha, teclado, edição ou exclusão. O que aparece ou some FORA do canvas (a folha, sobreposta) não o desloca; o que fica abaixo dele (a linha de estado) tem altura mínima fixa e só empurra o que está abaixo, nunca o canvas (conferido por capturas em todas as etapas).

**Complexidade** (V vértices, E arestas, N = 24 amostras por curva, L = limite do histórico, n = tamanho do texto): o hit-testing da seleção é Θ(V + E·N) no pior caso (o do `hitTest`), uma vez por toque; atualizar a seleção é O(V) ou O(E) (o núcleo confere que o elemento existe) e não toca no histórico; `parseWeightInput` é Θ(n); alterar um
rótulo é Θ(V) e um peso Θ(E) (o `setVertexLabel` e o `setEdgeWeight` do domínio) mais o passo de histórico Θ(L); excluir um vértice é Θ(V + E) mais Θ(L) e contar as incidentes para a pergunta é Θ(V + E); desfazer e refazer são Θ(L + V + E) (3.4). A cena é refeita inteira, Θ(V + E), só quando o GRAFO muda (editar, excluir, desfazer, refazer), e **não** ao selecionar (o destaque é uma propriedade do renderizador, que
procura o elemento na cena em O(V + E)). As quatro representações matemáticas não são recalculadas em nenhuma dessas interações. Sem índice espacial nem cache.

**Validação no Android** (emulador Pixel_6, 1080 × 2400 a 420 dpi, Expo Go 58.0.5, `adb shell input tap`, `input swipe` e `input motionevent` com toques reais; tema escuro e claro): (1) o Laboratório abre; (2) grafo novo não orientado; (3) A, B e C; (4) A—B e A—C no modo Conectar; (5) Selecionar: tocar em A mostra o anel sólido, o contorno grosso, "Vértice A selecionado." e os botões Editar e Excluir;
(6) a folha abre por cima, com o título, o identificador, o campo Rótulo e os botões inteiros; (7) com o teclado aberto a folha sobe sem esconder nada e o canvas não se mexe; (8) renomear A para "Início" (com o "í" do próprio teclado, pressão longa na tecla "i") salva em UM toque e o SVG mostra "In…" (o círculo trunca; o texto de estado e a folha mostram "Início");
(9) tocar na aresta mostra o halo, o traço grosso e "Aresta entre Início e B selecionada. Sem peso."; (10) peso 2,5: aparece "2,5" na aresta e "Peso 2,5." no estado; (11) peso 0: aparece "0" (diferente de sem peso); (12) Remover peso: o campo esvazia e a aresta fica sem número; (13) excluir a aresta pede confirmação ("Excluir a aresta entre Início e B?"), remove, e Desfazer devolve;
(14) excluir o vértice com duas arestas pergunta "Também serão removidas 2 arestas conectadas a ele." e, confirmado, some com as duas (os outros dois ficam isolados); Desfazer restaura o vértice, as arestas e a posição; (15) o botão Voltar do Android fecha a folha e a de exclusão sem alterar nada; (16) um deslize rápido (200 ms) de A até B e outro vertical sobre C (que rola a página) NÃO selecionam nada;
(17) o canvas não se desloca em nenhuma etapa (a folha é sobreposta); (18) tema claro: folha, anel, controles legíveis; (19) Adicionar vértice cria sob o toque (o novo vértice recebe o rótulo livre "A", pois "A" foi renomeado) e Conectar cria B—C; (20) a navegação entre abas funciona e o Laboratório volta com o mesmo grafo. **Defeitos reais achados e corrigidos no aparelho** (o Jest não os via):
a folha cortada pelo `maxHeight` percentual e o toque capturado pelo `ScrollView` da tela com o teclado aberto (acima). A primeira abertura do Expo Go depois do boot do emulador mostrou uma vez uma tela vermelha ("runtime not ready: Cannot read property 'EventEmitter' of undefined", antes de qualquer tela do app); reabrir resolveu e não reapareceu nas aberturas seguintes (mais de cinco) (**transitório, não investigado a fundo**).
**Não verificado:** TalkBack e qualquer leitor de tela, iOS, aparelho físico, pinça, arrasto e multitoque (fora do incremento), outras larguras (só Jest), rotação, escala de fonte, o comportamento do `Modal` em outras versões do Android, e desempenho com muitos vértices.

**Testes do 3.8** (249 novos; total do projeto **2390**, 46 suítes). Núcleo (projeto `editor-core`, 143): `core/selection.test.ts` (31: vértice, aresta, fundo, bordas de 24 dp e 12 dp, vértices a 30 dp com desempate estável pela ordem de inserção, arestas que se cruzam, arcos opostos, câmera `{40, −30, 2}` e escalas 0,25, 1 e 4,
opções do hit-testing, entradas inválidas, imutabilidade, 500 toques com o `hitTest` como oráculo e o texto de estado), `core/weight-input.test.ts` (66: a gramática inteira, os valores do contrato, `-0`, vazio × `0`, textos recusados, fora da faixa, extremos finitos, 5000 textos aleatórios que nunca lançam e a ida e volta de 2000 pesos),
`core/properties.test.ts` (24: descrição, título, rascunho, Salvar rótulo e peso contra o `applyAction`, Unicode e limite de 64 pontos de código, salvar o mesmo valor, nomes acessíveis) e `core/deletion.test.ts` (22: vértice isolado, com uma e com várias arestas, entradas e saídas do orientado, a contagem conferida contra o que o núcleo realmente remove em 200 grafos aleatórios,
as mensagens, a identidade do alvo, um passo de histórico, desfazer e refazer, ids). Interface (projeto `app`): `properties-sheet.test.tsx` (53: rascunho, Salvar, erros em português, `0` × sem peso, Remover peso, confirmação, identidade, Voltar, temas e a altura máxima numérica), `lab-screen-select.test.tsx` (33: o fluxo de ponta a ponta com o gesto simulado, destaque,
histórico, câmera, canvas, modos, sessão, temas e a posição da folha fora do `ScrollView`), e mais `editor-controls.test.tsx` (+7), `svg-graph-renderer.test.tsx` (+11) e `editor-store.test.ts` (+2). Três testes que diziam "Selecionar não faz nada" foram atualizados para o novo comportamento. **Mutação dirigida:** 90 mutações (46 do núcleo, 12 da tela, 3 da store, 13 da folha, 7 dos controles e 9 do renderizador), com os 10 arquivos de produção restaurados
byte a byte. Foram detectadas **90**, 5 só depois de reforçar os testes: as opções de hit-testing nunca chegavam à seleção; o "do/da" de `propertiesGenitive` só era conferido na tela, não no núcleo; a identidade da ARESTA na confirmação de exclusão; e o meu teste de sessão trocava os dois reinícios da folha (Novo grafo e Exemplo), então um cobria o outro (e o pedido velho reabriria a folha sobre o
vértice `v1` do exemplo). Nenhuma equivalente. Cobrem: id de seleção incorreto, toque no fundo mantendo a seleção, seleção entrando no histórico, peso zero confundido com ausência, vírgula decimal, `parseFloat` permissivo, `-0`, `1e-400` como zero enganoso, cancelar salvando, salvar inválido, exclusão sem confirmação, contagem sem entradas ou sem saídas, exclusão em dois passos, desfazer sem restaurar a posição,
seleção permanecendo após a remoção, folha dentro da `Screen`, linha de estado antes do canvas, modos Adicionar e Conectar afetados e halo maior que a tolerância de toque. As baterias de mutação do domínio e do núcleo anteriores (3.3, 3.4, 3.7) não foram repetidas.

**Limitações conhecidas.** A folha só abre pelos botões Editar e Excluir (não há toque longo); o rótulo do vértice no círculo é truncado (3.5) e o completo só aparece no texto de estado e na folha; salvar o mesmo valor fecha a folha sem avisar que nada mudou; a aresta criada no Conectar continua sem peso até o aluno defini-lo aqui; o texto de estado pode ocupar várias linhas com rótulos longos (empurra só o que está abaixo do canvas);
a excluir pergunta sempre, mesmo para um vértice isolado; não há exclusão em lote nem seleção múltipla; a mensagem de erro de dentro da folha e a instrução não foram validadas com leitor de tela; "Novo grafo" ainda substitui o grafo atual sem confirmação (3.6); a folha não foi testada com a escala de fonte do sistema maior.


### Arrastar vértices (incremento 3.9: `core/drag.ts`, `core/drag-preview.ts`, `canvas-gesture-detector.tsx`, `vertex-drag-controller.ts`, `vertex-drag.tsx`, prévia no SVG)

No modo **Selecionar**, um dedo que desce sobre um vértice e anda o arrasta: o vértice, o rótulo, o destaque de seleção e **as arestas incidentes** (com setas, pesos e arcos opostos) acompanham o dedo, e ao soltar a posição vira **um** passo de
histórico (`move-vertex`, 3.4). **Não existem** (e não foram simulados) pan e zoom da câmera, SQLite nem algoritmos; não há modo novo, nem criação de arestas por arrasto. O domínio e o JSON v1 não mudaram; a câmera fica **fixa** durante o gesto e
não há rolagem automática.

**Contrato puro (`core/drag.ts`, TypeScript sem React).** `startDrag(estado, câmera, ponto, viewport, opções?) → DragSession | undefined` só começa se: o modo é `select`; o ponto vale (câmera e `viewport` válidos, ponto finito e DENTRO do canvas, a mesma validação do toque,
`hitTapTarget`); o `hitTest` do 3.3 (a MESMA função do toque, nenhuma conta de proximidade nova; prioridade vértice > aresta > fundo; alvo mínimo de 48 dp) responde um **vértice**; e esse vértice tem posição finita. Começar sobre uma aresta ou o fundo não devolve sessão,
então nada é movido e a página rola. O vértice é identificado **uma vez**, aqui; a sessão guarda o id técnico, e passar sobre outro círculo não o troca. A sessão é imutável (congelada, sem alias): `graphId`, `vertexId`, `startWorldPosition`, `startScreenPoint`,
`grabOffset`, a `camera` copiada e os objetos `Graph` e `GraphLayout` do início, **por referência**, para saber por identidade se ainda valem (`isDragSessionValid`: modo `select` e os MESMOS objetos; ids iguais não bastam, porque dois grafos usam `v1`, `v2`…).

| Função | O que faz |
| --- | --- |
| `startDrag` | regras acima; devolve a sessão ou nada |
| `dragActivated(sessão, ponto, limiar?)` | o dedo andou `≥ 10 dp` (`DRAG_START_DISTANCE_DP`, igual ao `maxDistance` do toque)? |
| `dragPreviewPosition(sessão, deslocamento)` | posição do vértice no mundo durante o gesto |
| `dragFinalPosition(sessão, deslocamento)` | a MESMA fórmula, para a posição que se confirma (o que se viu é o que fica) |
| `isDragSessionValid(sessão, estado)` | a sessão ainda é do editor atual |
| `finishDrag(sessão, estado, fim)` | `release` → `{ kind: 'move', action }` ou `discard` (`stale`, `invalid`, `unchanged`); `cancel` → **sempre** `discard` (`cancelled`), nunca uma ação |
| `dragCommitAction(sessão, estado, deslocamento)` | atalho: a ação `move-vertex` de um fim válido, ou nada |

**Matemática do grab offset.** Com `tela = mundo·escala + (x, y)`: o centro inicial é `C0 = worldToScreen(câmera, posiçãoInicial)`, o grab offset é `g = P0 − C0` (`P0` = onde o dedo desceu, em dp), e o dedo, depois de andar `t` dp, está em `P = P0 + t`. Para o
vértice não saltar para o dedo, o centro vai para `C = P − g = C0 + t`, e a posição no mundo é `screenToWorld(câmera, C) = (C0 + t − câmera.x) / escala = posiçãoInicial + t / escala`: a translação da câmera some e só a escala converte o deslocamento. O código calcula
`posiçãoInicial + t / escala` com `screenToWorld({ x: 0, y: 0, scale }, t)` (que divide o deslocamento pela escala) e soma à posição inicial: é **exato** para `t = 0` (devolve a posição inicial sem erro de arredondamento, e por isso "soltar no mesmo lugar" não cria passo) e
equivale a `screenToWorld(câmera, P0 + t − g)` a menos do arredondamento (os testes conferem a equivalência em sete câmeras, incluindo escalas 0,25, 1 e 4 e translações positivas e negativas). `t` é o deslocamento do dedo em dp **locais** ao canvas, nunca `absoluteX/Y`.

**O defeito achado só no aparelho: `translationX/Y` não serve.** A `translationX/Y` do `usePanGesture` com ativação manual **começa em 0 no ponto da ativação**, não onde o dedo desceu (no emulador o dedo já tinha andado ~28 dp antes de o gesto ativar; o vértice ficava 28 dp atrás do dedo e o grab offset
se perdia). O detector não a usa: entrega ao controlador o **deslocamento calculado a partir das coordenadas locais** (`x`, `y` do evento menos as de `onBegin`), que não depende desse detalhe e ainda acompanha o canvas se a página se mexer. O simulador de gestos dos testes imita esse comportamento do aparelho
(a translação nasce na ativação), então um teste falha se o código voltar a usá-la.

**O gesto (`canvas-gesture-detector.tsx`, Gesture Handler 3.3.0, API de hooks).** Um detector para o canvas inteiro, com `useCompetingGestures(pan, tap)`:
- **Tap** como no 3.6 (`useTapGesture`, `maxDistance` 10 dp, conclui em `onDeactivate` e ignora `canceled`).
- **Pan** (`usePanGesture`) com **`manualActivation: true`**, `maxPointers: 1`, `runOnJS: true` e **nenhum** limiar nativo (`minDistance`, `activeOffset`, `failOffset`). Um pan comum ativaria sozinho depois de poucos dp em QUALQUER ponto do canvas, e ao ativar o Gesture Handler cancela os filhos nativos do toque,
  o `ScrollView` da página incluído: um deslize sobre o fundo deixaria de rolar. Com ativação manual o pan **nunca ativa por conta própria**: em `onBegin` (o dedo desceu, `x` e `y` locais) o controlador faz o hit-testing UMA vez e arma a sessão se acertou um vértice; em `onTouchesMove`, se há sessão armada e o dedo já andou 10 dp, o detector pede a
  ativação (`GestureStateManager.activate`, uma vez por gesto). Sem sessão ele nunca pede: o pan fica em `BEGAN` sem fazer nada, o `ScrollView` rola como sempre e o pan termina quando o dedo sobe.
- **Toque × arrasto (corrida).** Os dois recebem o mesmo toque e o primeiro que ATIVA cancela o outro. O toque ativa ao levantar o dedo se ele andou no máximo 10 dp e falha se andou mais; o pan só ativa (pelo JS) com 10 dp ou mais. Os dois limites são o mesmo valor (`TAP_MAX_DISTANCE_DP` e `DRAG_START_DISTANCE_DP`, um teste os iguala): até 10 dp é toque, de 10 dp em diante é arrasto (se começou em um vértice) ou deslize
  (rolagem, no fundo). Quando o pan ativa, o `onDeactivate` do toque nunca chama `onTap`; quando o toque ativa, o pan (que nunca ativou) é cancelado e `drag.finalize` descarta a sessão sem confirmar. **Um gesto, uma operação**: arrastar não seleciona (nem desfaz a seleção que havia) e tocar não move.
- **Relações avaliadas e não usadas:** `requireToFail` (o toque esperaria o pan falhar, atrasando cada toque até o dedo subir), `block` e `simultaneousWith` (deixariam toque e arrasto agirem juntos). A ativação manual resolve a rolagem e a corrida resolve o toque; só o necessário foi usado.
- **Rolagem da página:** `scrollEnabled` **não** é alterado em momento algum. No aparelho, deslizes de 100, 80, 60 e 40 ms começados num vértice ativaram o arrasto (pedido → ativação em ~14 ms) sem que a página rolasse, e deslizes no fundo ou sobre uma aresta rolaram a página sem pedir ativação nenhuma (ver "Validação no Android"). Um teste confere que o `ScrollView` da tela nunca fica com `scrollEnabled: false`.

**Onde cada coisa roda (thread de interface × JavaScript).** **Todos** os callbacks dos dois gestos rodam no runtime **JavaScript** (`runOnJS: true`); nenhum worklet executa código do domínio, do núcleo ou da store, e nada é despachado de um worklet. Nenhum `scheduleOnRN` é necessário. A única chamada que cruza para a thread nativa é `GestureStateManager.activate`
(no runtime JS ele usa `_setGestureStateAsync`; dentro de um worklet usaria `_setGestureStateSync`); medido: pedido → `onActivate` em ~14 ms. Funciona com o **React Compiler** ligado: o `babel-preset-expo` com o `caller` do Metro (`supportsReactCompiler`) compila `CanvasGestureDetector`, `useVertexDragController`, `LiveGraphRenderer`, `SvgGraphRenderer` e `LabContent` com `CompileSuccess` e nenhuma desistência, e o emulador já rodava com o compilador ligado.
O que muda com o gesto vive em `ref`s e no controlador (nenhum `ref` é lido na renderização).

**Prévia transitória (`core/drag-preview.ts`).** Durante o gesto o grafo, o layout e o histórico NÃO mudam, e nada vai à store. `planDragPreview(grafo, layout, cena, câmera, vértice, opções)` roda **uma vez** ao ativar (Θ(V + E)): acha o vértice na cena e as arestas incidentes e guarda, para cada uma, o que não muda no gesto (a outra ponta, se existe o arco
oposto, o peso, a câmera). `buildDragPreview(plano, posição)` roda a **cada atualização** (Θ(grau)): devolve o vértice e as arestas incidentes prontos, em dp. **Sem fórmula própria:** a geometria de cada aresta é a de `edgeGeometryBetween` (a mesma `buildGeometry` de `edgeGeometries`) e a conversão para a tela é a de `sceneEdgeFrom` (a mesma de `buildGraphScene`), então a seta continua apontando para o destino, os dois arcos de A → B e B → A continuam em lados opostos e o peso fica na âncora. Os testes
comparam a prévia com a cena reconstruída (`buildGraphScene` sobre o layout com o vértice movido), em 300 grafos aleatórios (orientados ou não, com arcos opostos e pesos) e sete câmeras, e contam as chamadas: uma geometria por aresta incidente e **nenhuma** da cena inteira.

**Renderização.** `GraphRendererProps.preview?: DragPreview`. O `SvgGraphRenderer` desenha cada tipo de elemento em duas camadas na ordem de empilhamento de sempre: a **estática** (`React.memo`) desenha a cena **menos** o vértice arrastado e as arestas incidentes (`preview.hiddenEdgeIds`, o MESMO objeto do plano durante todo o arrasto), e a camada da **prévia** desenha esses elementos nas posições novas. Só a segunda muda a cada atualização (Θ(grau) elementos); a estática é percorrida de novo só no começo e no fim do arrasto. As arestas da prévia ficam por cima das outras arestas e abaixo de TODOS os vértices, e o vértice arrastado por cima dos outros, então a ordem entre arestas que se cruzam
pode diferir da cena definitiva durante o gesto. O anel de seleção, o halo da aresta selecionada e o anel da origem do Conectar procuram o elemento primeiro na prévia, e uma prévia de OUTRO grafo (`graphId` diferente, ids técnicos iguais) é ignorada. A cada atualização do dedo só o `LiveGraphRenderer` re-renderiza: ele assina a prévia do controlador por `useSyncExternalStore`, então a tela, o detector (cuja configuração é reenviada ao módulo nativo a cada renderização) e as camadas estáticas não são percorridos de novo.

**Alternativas avaliadas.** (1) **Estado React na tela** com a prévia: re-renderizaria a tela e o detector a cada atualização. (2) **Refazer a cena inteira** a cada atualização (`buildGraphScene`, Θ(V + E)): medido no aparelho, 0,5 a 1,1 ms com 30 vértices e 29 arestas e 5,7 ms com 30 vértices e 56 arestas, contra 0,1 a 0,25 ms e 0,2 a 1,1 ms da prévia; funcionaria para grafos pequenos, mas custa por atualização o que a prévia
evita e continua refazendo o desenho nativo inteiro. (3) **Valores compartilhados do Reanimated** e propriedades animadas do SVG, com a geometria das arestas em worklets: tiraria o JavaScript do caminho, mas exigiria marcar como worklets (ou copiar) as funções de `geometry.ts` e `scene.ts` (o que a regra "sem segunda fórmula" proíbe), um componente animado por aresta incidente (os hooks não podem ser dinâmicos), valores compartilhados com a topologia e testes que o Jest não reproduz. **Não adotada, por falta de evidência de benefício:** no aparelho a prévia custa de 0,1 a 1,1 ms
no JavaScript e o que domina o quadro é o redesenho nativo do `Svg` (veja a medição abaixo: arrastar o hub de grau 29 e um vértice de grau 2 no mesmo grafo deu o mesmo tempo de quadro), que a alternativa 3 também não evita. Reavaliar se um aparelho real mostrar o JavaScript no gargalo.

**Conclusão.** Ao soltar, o controlador chama `finishDrag` com o deslocamento do **evento de fim** (onde o dedo subiu; só se ele não for finito vale a última prévia): se o editor ainda é o da sessão, o vértice mudou de lugar e a posição é finita, despacha **UMA** ação `move-vertex` (o `applyAction` troca o layout e registra UM passo de histórico, sem tocar no grafo: mesmas arestas, origens, destinos, pesos, ids e contadores);
**só depois** remove a prévia, para o desenho passar da prévia à cena definitiva sem um quadro na posição antiga. A posição final pode estar até um quadro à frente da última prévia (medido: 4 dp num deslize de 100 ms, porque o último movimento chega junto com o fim); a diferença é só o último quadro, e o vértice fica onde o dedo parou (medido: centro em 1000,5 px para o dedo em 1000 px). Soltar no mesmo lugar, com posição inválida ou com a sessão inválida não despacha nada. Soltar fora da área
visível é válido (a câmera não se move); desfazer traz o vértice de volta.

**Cancelamentos (`finishDrag(..., { kind: 'cancel' })`: nunca uma ação).** Gesto cancelado pelo sistema (`onDeactivate` com `canceled`, testado no aparelho com `motionevent CANCEL`: o vértice volta à posição original, sem passo), gesto que falha ou termina antes de ativar (`onFinalize` descarta a sessão), e tudo o que muda o editor
**durante** o arrasto: o controlador assina a store desde a ativação e descarta na hora quando a sessão deixa de valer (troca de modo, novo grafo ou exemplo, mesmo com os mesmos ids técnicos, desfazer, refazer, remoção do vértice), sem esperar o dedo; a tela também cancela ao começar outro grafo ou carregar o exemplo e o hook cancela ao desmontar; abrir a folha de propriedades desabilita o
arrasto e descarta o ativo. Eventos tardios do gesto depois do descarte são ignorados (nenhum `move-vertex`). Interromper por **sair da área**: o pan não cancela quando o dedo sai do canvas (`shouldCancelWhenOutside` do pan é falso); o vértice segue o dedo e pode terminar fora da área visível (a câmera não se move e não há rolagem automática). A confirmação da própria conclusão não se descarta no meio (`committing`).

**Seleção e histórico.** Arrastar não muda a seleção (se o vértice arrastado está selecionado, o anel acompanha) e não cria passo por si: um arrasto concluído é UM passo; desfazer devolve o vértice à posição anterior (o mesmo objeto de layout), refazer restaura a nova, um movimento novo depois de desfazer descarta o ramo de refazer, arrasto cancelado, sem movimento ou inválido não cria passo, e os ids de vértices e arestas não andam. O histórico guarda só a mudança consolidada, nunca os quadros intermediários.

**Complexidade (V vértices, E arestas, `d` = arestas incidentes ao vértice arrastado, N = amostras por curva, L = limite do histórico).**

| Etapa | Custo | Quando |
| --- | --- | --- |
| hit-testing inicial (`startDrag`) | Θ(V) se o dedo cai num vértice; senão Θ(V + E·N) (o `hitTest`) | uma vez por gesto, ao descer |
| plano da prévia | Θ(V + E) | uma vez, ao ativar |
| atualização da prévia | **Θ(d)**: uma geometria e uma aresta de cena por aresta incidente, mais O(1) para o vértice | a cada atualização do dedo |
| atualizar as geometrias incidentes | Θ(d) (cada `edgeGeometryBetween` é O(1)) | idem |
| desenho no React | Θ(d) elementos SVG re-renderizados; as camadas estáticas (Θ(V + E)) não | idem |
| desenho nativo | o `Svg` redesenha o quadro inteiro (Θ(V + E) comandos) a cada alteração | idem |
| confirmar (`finishDrag` + `applyAction`) | O(1) + Θ(V) (cópia do layout, `moveVertex`) | uma vez, ao soltar |
| registrar no histórico | Θ(L) (cópia do vetor `past`) | idem |
| reconstruir a cena definitiva | Θ(V + E) (`buildGraphScene`) | uma vez, depois de soltar |

A atualização **não** é O(1): recalcula as `d` arestas incidentes. Θ(d) vale no máximo Θ(V) num grafo simples. Comparada com refazer a cena inteira por atualização (Θ(V + E)), a prévia ganha quando `d` é pequeno em relação ao grafo.

**Medição no Android (como foi feito; sem inventar FPS).** Emulador Pixel_6 (Android 13, **GPU por software** SwiftShader), Expo Go 58.0.5, build de desenvolvimento (Metro), `performance.now()` no Hermes e logs do `ReactNativeJS` (instrumentação temporária, removida); deslizes de 1,5 s por `adb shell input swipe` (≈ 25 a 33 atualizações) e
`dumpsys gfxinfo host.exp.exponent` (`reset` antes e depois de cada gesto). Tempos do JavaScript:

| Cenário | plano | atualização da prévia | confirmar (`dispatch`) | cena inteira (`buildGraphScene`) |
| --- | --- | --- | --- | --- |
| 4 vértices e 4 arestas (poucos), vértice de grau 2 | — | 0,3 ms (uma amostra) | — | — |
| 30 vértices e 29 arestas, vértice de grau 2 | 0,08 a 1,58 ms | 0,10 a 0,25 ms | 0,13 a 1,70 ms | 0,54 a 1,15 ms |
| 30 vértices e 56 arestas, vértice **de grau 29** | 0,26 ms | 0,24 a 1,09 ms (≈ 0,6) | 3,06 ms | 5,68 ms |

Estrutura do quadro (`gfxinfo`, mesma máquina): arrastar o hub de grau 29 → 21 quadros em 2 s, mediana 150 ms; arrastar um vértice de grau 2 no mesmo grafo → 26 quadros, mediana 150 ms; **rolar a página sem arrasto** → mediana 77 ms (a GPU por software já limita o emulador a ≈ 13 quadros/s). Conclusões que a medição sustenta: o custo do JavaScript por atualização é de ordem de 1 ms e cresce com o grau (a prévia do hub custa ≈ 3 a 4 vezes a de grau 2), mas o tempo
de quadro não mudou com o grau, então o gargalo é o redesenho nativo, que a prévia não elimina. Conclusões que ela **não** sustenta: o desempenho em um aparelho real, com GPU, e o intervalo de 44 a 57 ms entre atualizações vem do `adb input swipe`, não do JavaScript (fica abaixo de 60 ms mesmo com o hub).

**Escala no núcleo (Node/V8, teste temporário descartado; microssegundos por chamada; grafos de grade, `E` ≈ 2·`V`, vértice arrastado com o grau indicado).** Só mostram a escala com V, E e o grau, não o Hermes (no aparelho a atualização do hub de grau 29 levou 0,24 a 1,09 ms, contra 0,16 ms aqui: de 2 a 7 vezes mais).

| V | E | grau | hit (vértice) | hit (fundo) | plano | atualização da prévia | cena inteira | confirmar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 10 | 3 | 11,8 | 51,9 | 1,9 | 22,2 | 84,9 | 6,4 |
| 30 | 30 | 3 | 23,2 | 123,4 | 4,3 | 17,7 | 220,5 | 7,3 |
| 30 | 56 | 29 | 21,3 | 178,4 | 7,3 | 158,0 | 335,9 | 6,9 |
| 200 | 200 | 3 | 119,2 | 634,4 | 2,5 | 15,9 | 1196,2 | 17,3 |
| 200 | 396 | 199 | 113,8 | 1192,8 | 18,2 | 1108,3 | 2265,7 | 18,2 |
| 1000 | 1000 | 3 | 550,1 | 3464,2 | 11,5 | 18,4 | 6392,5 | 96,8 |
| 1000 | 1498 | 501 | 552,7 | 4655,1 | 49,1 | 2768,7 | 8942,9 | 89,8 |

Leitura: com grau 3 a atualização custa 16 a 22 µs para qualquer V de 10 a 1000 (Θ(grau), não Θ(V + E)); cresce linearmente com o grau (≈ 5,5 µs por aresta incidente) e a cena inteira cresce com V + E (de 85 µs a 8,9 ms). O ganho é grande com grau pequeno e encolhe quando o grau se aproxima de E (hub de 501 arestas: 2,8 ms contra 8,9 ms). Um vértice com **centenas** de arestas incidentes pode passar de um quadro por atualização no Hermes
(limitação conhecida). O hit-testing sobre o fundo (Θ(V + E·N)) é o passo mais caro por gesto, mas roda uma vez, ao descer o dedo. `confirmar` inclui `finishDrag` e o `applyAction` (cópia do layout, Θ(V), e o passo de histórico).

**Testes do 3.9** (171 novos; total **2561**, 50 suítes). Núcleo (projeto `editor-core`): `core/drag.test.ts` (50: o começo, em vértice, fundo, aresta, modos, bordas do canvas, câmeras e entradas inválidas e empates; o limiar de 10 dp; a posição calculada à mão com câmera neutra, `{40, −30, 2}`, escalas 0,25 e 4, coordenadas negativas, zero exato e estouro; a equivalência com `screenToWorld` e com o grab offset em 500 sorteios e sete câmeras; a validade por identidade; soltar e cancelar; desfazer, refazer e ids; imutabilidade) e `core/drag-preview.test.ts` (20: a prévia é igual à cena reconstruída em 300 sorteios, mais arestas, setas, pesos, arcos opostos, aresta sem geometria e o custo por espiões).
Interface (projeto `app`): `canvas-gesture-detector.test.tsx` (26, +15: o protocolo da ativação manual, o deslocamento por coordenadas locais, cancelar, toque × arrasto e as relações enviadas ao módulo nativo), `vertex-drag-controller.test.ts` (37, com a store real e sem React), `lab-screen-drag.test.tsx` (36, de ponta a ponta com o gesto simulado) e `svg-graph-renderer.test.tsx` (+13, a prévia). **Mutação dirigida: 83 mutações, 80 detectadas** (3 só depois de reforçar os testes: o vértice da ação com um vértice que não é o primeiro, a ativação depois de o editor mudar entre descer e ativar e a relação entre toque e arrasto; a primeira versão desta última era inválida, por um import que faltava, e foi refeita) e **3 equivalentes**: `noNegativeZero` na posição (o layout e o `screenToWorld` já normalizam o zero, então `-0` nunca chega ali), o `drag.cancel()` da tela ao começar outro grafo ou carregar o exemplo (a assinatura da store já descarta o arrasto: defesa em profundidade, mantida) e o `started &&` do contexto (sem grafo começado o canvas nem existe; removido). Cobrem: grab offset ignorado, divisão pela escala omitida, coordenadas absolutas tomadas como locais, vértice errado, hit-testing refeito durante o movimento, modo Selecionar ignorado, arrasto sobre o fundo ou a aresta, cancelamento que cria histórico, ação a cada quadro, duas operações ao soltar, layout alterado antes da conclusão, arestas paradas, arcos com direção errada, ativação pedida sem sessão (rolagem presa), prévia de outro grafo, reset ou desmontagem que preservam a prévia e desfazer que não restaura a posição. Os dez arquivos de produção foram restaurados byte a byte (hash). O que o Jest não vê (a negociação com o `ScrollView`, o atraso do JavaScript, a origem da `translationX/Y`, o último movimento chegando com o evento de fim) só apareceu no emulador.

**Validação no Android (emulador, toques reais por `adb`: `input motionevent DOWN/MOVE/UP/CANCEL` e `input swipe`; temas claro e escuro).**
Ambiente: emulador `Pixel_6` (Android 13, GPU por software), Expo Go 58.0.5, Metro com `adb reverse`; tema claro (padrão) e escuro (`adb shell cmd uimode night yes`); coordenadas em pixels (1 dp = 2,625 px); a posição do círculo foi medida **nos pixels das capturas** (contorno azul do vértice) e comparada com a do dedo, e o quadro com `uiautomator dump`.
- **Arrasto de B em A—B—C (Conectar A–B e B–C, depois Selecionar).** Com `input motionevent DOWN/MOVE/UP` em passos, B, o rótulo e as **duas arestas acompanham o dedo durante o gesto** (captura no meio dele); A e C não se mexem; soltar confirma. Com o vértice **fora do centro** (dedo a +15 px e +10 px do centro), o dedo em (555, 1011) deixou o centro de B em (540, 1001): o grab offset é mantido.
- **Rolagem da página.** Deslize iniciado no **fundo** do quadro: a página rolou (o quadro foi de y = 751 para 128 px) e **nenhum pedido de ativação** foi feito; deslize iniciado sobre uma **aresta**: idem, e nenhum vértice se moveu. Deslizes **rápidos** de 600 px sobre um vértice, de **100, 80, 60 e 40 ms** (`input swipe`): o arrasto ativou (pedido → `onActivate` em ≈ 14 ms), a posição foi confirmada e a página **não** rolou. Por isso `scrollEnabled` nunca é alterado.
- **Toque curto** em A: seleciona (o toque conclui, o pan é cancelado pela corrida), sem arrasto.
- **Cancelamento nativo** (`input motionevent CANCEL` com B a 300 px da origem): a prévia some, B volta à posição de antes (medido por pixel: 1000,5 px) e o gesto chega como `canceled = true`; nenhum passo de histórico.
- **Desfazer e Refazer** (botões): desfazer devolve B à posição anterior e refazer o leva de novo para a nova (1000,5 px e fora do quadro, medidos nas capturas); um refazer depois de desfazer repete.
- **Fora da área visível.** Arrastar B até além da borda de cima do quadro e soltar: as arestas ficam recortadas na borda, o resumo avisa "Parte do grafo está fora da área visível", a câmera e os outros blocos não se mexem; desfazer o traz de volta.
- **Grafo orientado** com A → B, B → A e B → C (também em tema escuro): os dois arcos opostos continuam curvos, em lados opostos, as pontas das setas continuam no destino e a de B → C acompanha, durante o gesto e depois de soltar; o centro de B ficou no dedo (540, 1039 para o dedo em 540, 1040).
- **Outros modos.** Em Adicionar vértice, um toque cria D e um deslize começado sobre um vértice rola a página sem mover nem criar nada; em Conectar, D → C cria a aresta (4 arestas).
- **Canvas estável e abas.** O quadro permaneceu em [42,751][1037,1646] antes e depois de cada arrasto; Início → Laboratório preserva o grafo; as propriedades abrem depois de mover um vértice (título "Vértice B", com o anel de seleção seguindo).
- **Desempenho** (medição do JavaScript e do quadro, acima): grafos de 30 vértices com 29 e com 56 arestas, vértice de grau 2 e hub de grau 29.
- **Defeitos reais achados só no aparelho (os testes passavam) e corrigidos:** (1) a `translationX/Y` do Gesture Handler nasce na **ativação**, não onde o dedo desceu: o vértice ficava ~28 dp atrás do dedo (a captura mostrou o centro de B a 1224 px com o dedo em 1300 px); agora o deslocamento vem das coordenadas locais e o simulador de gestos imita o comportamento real. (2) O último movimento chega **junto com o evento de fim**:
  confirmar a última prévia deixava o vértice 4 dp aquém de onde o dedo subiu (1238 px contra 1250 px); agora vale a posição do evento de fim.
- **Conferência final com o código sem a instrumentação:** novo grafo A, B, C; arrastar B até (600, 1250): centro em 1249,5 px, igual depois de soltar; um arrasto cancelado devolve o vértice à última posição confirmada.

**Limitações.** (1) ~~Sem teste de dois dedos~~: resolvido no 3.10 (`sendevent`): com o arrasto ativo o segundo dedo o cancela e a posição volta, sem gravar (veja "Câmera: pan, pinça e enquadramento"). (2) Sem TalkBack, iOS, aparelho físico, rotação, escala de fonte e desempenho em aparelho real (a medição acima é de um emulador com GPU por software). (3) Um deslize **tão rápido que o dedo sobe antes do pedido de ativação chegar** (o pedido leva ~14 ms) não vira arrasto; nada é movido. (4) Soltar fora da área visível deixa o vértice fora do
quadro (desfazer o traz de volta; enquadrar vem com a câmera, 3.10). (5) Não há rolagem automática nem câmera móvel. (6) O arrasto não seleciona o vértice (e não há realce de "levantado"): a única pista é o próprio movimento e, se ele estava selecionado, o anel. (7) A ordem de empilhamento entre arestas que se cruzam pode diferir da cena definitiva durante o gesto. (8) A primeira abertura do Expo Go depois do boot do emulador mostrou duas vezes a tela vermelha "runtime not ready" (já vista no 3.8); reabrir resolveu, e não foi investigada.

### Câmera: pan, pinça e enquadramento (incremento 3.10: `core/camera-gesture.ts`, `core/gesture-start.ts`, `camera-store.ts`, `camera-gesture-controller.ts`, `canvas-gesture-controller.ts`, `canvas-gesture-detector.tsx`, `vertex-drag.tsx`, botões Centralizar e Ajustar)

**O que mudou para o aluno.** Um dedo no **fundo** do quadro desloca a câmera (em qualquer modo); dois dedos ampliam e reduzem em torno do ponto entre eles; **Centralizar** leva o grafo ao centro do quadro mantendo o zoom e **Ajustar ao grafo** o enquadra com margem. **Mudança de comportamento (documentada, não acidental):** antes do 3.10 um deslize no fundo rolava a página; agora ele move a câmera, e a página rola por deslizes **fora** do quadro (cabeçalho, botões, texto). Dois dedos sobre o quadro são do quadro desde que o segundo desce. O `ScrollView` da página **nunca** é desabilitado: quando nenhum gesto do canvas ativa, nada interfere. **Não mudaram:** o domínio, o JSON v1, as quatro representações, o histórico (a câmera **não** entra nele, nem no `Graph`, nem no `GraphLayout`), os limites de zoom (0,25 a 4), os modos Adicionar vértice, Conectar e Selecionar, o arrasto de vértice.

**Como a câmera é guardada.** A câmera continua `{ x, y, scale }` com `tela = mundo·escala + (x, y)` (3.1). Ela vive em **uma única fonte**, o `CameraStore` (`camera-store.ts`, TypeScript puro, fora do Zustand do editor), com três coisas: a câmera **viva** (a que está desenhada; muda a cada atualização de um gesto), a **assentada** (começo de sessão, comando ou fim de gesto) e uma **época** que avança a cada `reset` (novo grafo, exemplo) e a cada `command` (Centralizar, Ajustar, redimensionar). O renderizador assina a viva (`LiveGraphRenderer`, uma folha que re-renderiza sozinha a cada quadro do gesto); a tela assina só a assentada (resumo acessível, cena, avisos) e **não** re-renderiza durante o gesto. O hit-testing de toques e de começo de gesto lê a **mesma** câmera viva do armazém: não existe uma segunda câmera "do gesto" ao lado da "do SVG".

**Política dos gestos (um dono por gesto, decidido UMA vez no começo).** `gestureOwnerAt` faz um único `hitTapTarget` (a mesma função do toque; vértice > aresta > fundo, alvo mínimo de 48 dp):

| Sob o dedo ao descer | Dono do deslize |
| --- | --- |
| fundo (qualquer modo) | a **câmera** |
| vértice, modo Selecionar | o **vértice** (arrasto do 3.9, sem mover a câmera) |
| vértice em Adicionar vértice ou Conectar | ninguém (não inicia pan) |
| aresta (qualquer modo) | ninguém |
| dois dedos (qualquer lugar do quadro) | a **pinça** |

Quando o dono é "ninguém", o pan nunca pede ativação, e a rolagem da página (um `ScrollView` nativo) fica livre para esse toque.

**Contas (todas compõem as funções do 3.1; não há fórmula nova).** Cada gesto guarda uma **âncora** (a câmera e o ponto do dedo no instante em que ele ATIVOU) e cada atualização sai dela, nunca da atualização anterior: um evento perdido não deixa resíduo.
- **Pan.** `câmera' = panBy(âncora, deslocamento)`, com o deslocamento em dp LOCAIS ao canvas desde onde o dedo estava **na ativação** (a folga de 10 dp do limiar não vira deslocamento, como na rolagem nativa). Exemplo: âncora `{0, 0, 1}`, o dedo anda de (100, 100) a (130, 90): deslocamento (30, −10), câmera `{30, −10, 1}`; o ponto do mundo (50, 50) vai de (50, 50) a (80, 40).
- **Pinça.** Com a âncora `C0`, o foco `F0` na ativação, a escala **acumulada** `s` e o foco agora `F`: `câmera' = panBy(zoomAt(C0, F0, s, limites), F − F0)`, isto é, `escala' = clamp(C0.scale · s)`, `x' = F.x − W.x · escala'`, `y' = F.y − W.y · escala'`, com `W = screenToWorld(C0, F0)` o ponto do mundo sob o foco. Exemplo: `C0 = {0, 0, 1}`, `F0 = (180, 160)`, `s = 2`, foco parado: `W = (180, 160)` e a câmera é `{−180, −160, 2}` (o ponto continua em (180, 160)); com o foco indo para (200, 150): `{−160, −170, 2}`. Com `s = 100` a escala é cortada em 4 (`x' = 180 − 180·4 = −540`) e o ponto sob o foco continua sob o foco. Foco parado: é o `zoomAt`; sem mudar a escala: é um pan de dois dedos. Só a escala acumulada vale: `scaleChange` do Gesture Handler **nunca** é usado, para jamais multiplicar duas vezes.
- **Centralizar** leva o centro do CONTEÚDO (os círculos com o raio visual e os ápices das curvas) ao centro do quadro, **mantendo a escala**; grafo vazio devolve a câmera neutra. **Ajustar** usa `fitCameraToGraph` (margem de 24 dp, limites inalterados) e diz se coube (`fits`): quando o limite mínimo de zoom não basta, um aviso discreto e educado ("O grafo é maior que o quadro no zoom mínimo: parte dele fica fora da área visível.") aparece e some quando a câmera muda.

**Política da câmera depois de cada operação.**

| Operação | Câmera |
| --- | --- |
| Novo grafo (orientado ou não) | neutra, época nova; gesto em andamento cancelado |
| Carregar exemplo | enquadrado UMA vez (na primeira medida do quadro, se ainda não medido) |
| Adicionar, conectar, editar, excluir, desfazer, refazer, arrastar vértice | **preservada** (nenhum enquadramento automático) |
| Redimensionar ou girar | o ponto do mundo sob o centro do quadro antigo fica sob o centro do novo (`cameraForResize`); não reenquadra |
| Pan ou pinça cancelados pelo sistema | **preservada** (não restaura a câmera de antes do gesto) |
| Trocar de modo no meio de um gesto | o gesto de câmera termina; a câmera fica como está |
| Segundo dedo durante um arrasto de vértice | o arrasto é **cancelado sem gravar** (a posição volta); a pinça não assume na mesma sequência |

**Sessões de gesto e segurança.** Cada sessão de pan ou pinça guarda a época em que nasceu; o armazém **recusa** uma atualização de outra época. Assim um evento atrasado nunca move a câmera de outra sessão (novo grafo, exemplo, Centralizar, Ajustar ou redimensionamento no meio do gesto), e `abort` encerra tudo (desmontagem, canvas desabilitado, mudança de modo). Soltar assenta a câmera; cancelar também (preserva).

**Renderização (decisão medida).** Durante um **pan** a cena assentada é reaproveitada e só um grupo do SVG é deslocado (`offset` do renderizador, `<G testID="scene-offset">`): `cena(câmera + d)` é exatamente `cena(câmera)` deslocada por `d` (a câmera só soma uma translação; raios, espessuras, setas, curvaturas, textos e caixas de peso são constantes em dp), e um teste de 24 combinações compara a cena inteira (retas, curvas, setas, pesos) campo a campo. Durante uma **pinça** a escala muda e a cena é refeita (Θ(V + E) por quadro). Premissa registrada no código: o renderizador desenha **todos** os elementos, inclusive os que o campo `visible` marca como fora da área; se um dia passar a pular os de fora, o pan por deslocamento tem de voltar a refazer a cena. Sem Skia, sem worklets com código do domínio, sem geometria duplicada. Traços e textos continuam constantes em dp (no zoom mínimo o rótulo fica maior que o círculo: decisão do 3.5, não mudou).

**Desempenho.** Partes puras, Node (média, em ms; `buildGraphScene` é a cena inteira e `hit-test` é a consulta do começo do gesto): 3 vértices e 2 arestas, 0,010 e 0,014; 30 vértices e 29 arestas (hub de grau 29), 0,248 e 0,271; 30 e 76, 0,203 e 0,144; 200 e 199, 1,12 e 0,64; 200 e 568, 1,57 e 1,01; 1000 e 2934, 7,9 e 4,9. As contas de câmera custam **microssegundos** (`panFromAnchor` ≈ 1 µs, `pinchFromAnchor` ≈ 3,5 µs) e não dependem do tamanho do grafo. No Hermes (emulador), refazer a cena de 30 vértices e 29 arestas leva mediana de 0,72 a 0,91 ms (máximo 8,7 ms no primeiro quadro; com 3 vértices, 0,11 a 0,24 ms). **Pan de 30 vértices com hub de grau 29, dois deslizes de 2 s no emulador (GPU por software, `gfxinfo`):** refazendo a cena a cada quadro, 28 quadros renderizados, mediana 350 ms, p90 400 a 450 ms, p99 450 a 500 ms; deslocando o grupo, 70 a 71 quadros, mediana 117 a 125 ms, p90 e p99 150 ms (≈ 3 vezes melhor; **todos** os quadros do emulador contam como lentos nos dois casos). **O emulador com GPU por software não representa um aparelho real**: os números valem para comparar as duas estratégias, não para prometer fluidez. A imagem é a mesma: no mesmo gesto, a captura com o dedo ainda no vidro (grupo deslocado) e a captura depois de soltar (cena refeita) têm **0 pixels** com diferença acima de 24/255, em grafo não orientado e no exemplo orientado com pesos e setas.

**Testes do 3.10** (240 novos; total **2801**, 57 suítes). Núcleo (`editor-core`): `core/camera-gesture.test.ts` (41: pan e pinça calculados à mão, equivalências com `panBy` e `zoomAt`, limites, foco que se move, entradas inválidas, Centralizar, Ajustar e `fits`, redimensionar), `core/gesture-start.test.ts` (16: o dono em cada situação e modo, contra o `hitTest` do 3.3 como oráculo) e `core/scene-pan-equivalence.test.ts` (3, 26 casos: `cena(câmera + d)` = `cena(câmera)` deslocada, em quatro câmeras, três deslocamentos e grafos orientado e não orientado; com controles negativos). Interface (`app`): `camera-store.test.ts` (12), `camera-gesture-controller.test.ts` (31), `canvas-gesture-controller.test.ts` (31), `canvas-gesture-detector.test.tsx` (39, +13: pinça, o toque de dois dedos que falha, a ativação imediata da pinça e a atualização com um ponteiro ignorada), `lab-screen-camera.test.tsx` (60, de ponta a ponta com o protocolo de gestos do aparelho: botões, pan, dono por modo, toques depois de pan e zoom, pinça com limites e foco que anda, segundo dedo, reset, modo e desmontagem durante o gesto, o que o renderizador faz durante o gesto), `editor-controls.test.tsx` (+3), `svg-graph-renderer.test.tsx` (+5, o `offset`) e `vertex-drag-controller.test.ts` (adaptado: o controlador não faz mais hit-testing, recebe a sessão pronta). **Mutação dirigida: 54 mutações, 50 detectadas de primeira, 3 só depois de reforçar os testes e 1 equivalente.** Núcleo (16 de 16): pan com a direção invertida, o movimento do foco ignorado, a pinça em torno da origem e não do foco, os limites de escala ignorados, a escala aplicada duas vezes, Centralizar que muda a escala, Ajustar sem margem e Ajustar que diz que sempre coube, redimensionar pelo centro novo, Centralizar de grafo vazio que devolve a mesma câmera, o fundo que deixa de mover a câmera, o vértice que arrasta em qualquer modo ou que move a câmera, a aresta que passa a mover a câmera, a referência trocada com deslocamento nulo e o foco inválido aceito. Controladores e armazém (20, mais uma variante): a folga da ativação virando deslocamento (a câmera salta), a escala acumulada usada como incremental, a âncora trocada a cada passo, a época ignorada no pan, na pinça e no armazém (atualizar e assentar), reset e comando que não avançam a época, a pinça que confirma o arrasto, o arrasto que também move a câmera, o hit-testing do começo do gesto com a câmera neutra, a troca de modo, a pinça cancelada, o abort, a pinça nova e o novo grafo no meio do gesto que não encerram a sessão, e um deslize de "ninguém" que ativa (a página deixaria de rolar). Detector (8 de 8): a atualização com um ponteiro, `scaleChange`, a ativação imediata, o deslocamento sem origem, o toque de dois dedos que não falha, o foco da pinça, a pinça cancelada tratada como fim e o pan que ativa sozinho. Tela e renderizador (9): o grupo que não se desloca, deslocado com o sinal invertido ou também na pinça, novo grafo que preserva a câmera, redimensionar sem manter o centro, o toque com a câmera neutra, Centralizar com a câmera neutra e o renderizador que ignora o `offset` ou troca x por y. **Sobreviventes e o que foi feito:** (1) a pinça que "confirma" o arrasto soltando com deslocamento ZERO é equivalente (soltar sem movimento é descartar); a variante com deslocamento (40, 40) foi detectada; (2) desabilitar o canvas (a folha abre) no meio de um pan não tinha teste que visse a câmera ser assentada: reforçado; (3) a ativação em uma época nova já era barrada pelo armazém na primeira atualização, e o teste olhava tarde demais: agora confere `isPanning()` logo depois da ativação; (4) Centralizar com a câmera neutra passava porque o único teste partia da câmera neutra: criado o teste com zoom 2 antes. Uma mutação (novo grafo que preserva a câmera) não se aplicou na primeira rodada, porque o padrão com quebra de linha não casava com o fim de linha CRLF do arquivo, e foi refeita sem a quebra. Não há mutação "o pan cria histórico": nenhum caminho de código do pan despacha ação, e o teste confere que o editor continua o MESMO objeto. Os nove arquivos de produção foram restaurados byte a byte (hash).

**Validação no Android (emulador `Pixel_6`, Android 13, GPU por software, Expo Go 58.0.5, 1080 × 2400, 1 dp = 2,625 px; temas claro e escuro).** Toques de **um dedo** por `adb shell input swipe` e `input motionevent`; toques de **dois dedos reais** por `adb root` + `sendevent` no dispositivo de toque da tela principal (ver o procedimento abaixo). As posições foram medidas **nos pixels das capturas** e comparadas com a fórmula.
- **Pan, um dedo, fundo.** Dedo de 300 × 150 px (114,3 × 57,1 dp) com a folga de ativação de (15,2; 3,9) dp: a câmera andou (98,9; 53,2) dp medidos, (99,1; 53,2) previstos. O grafo acompanha, a página **não** rola. Deslize rápido de 60 ms e 400 px: (140,6 contra 141,0 dp previstos); diagonal de 100 ms: idem. Deslize pelo **cabeçalho** (fora do quadro): a página rola e nenhum evento de pan chega ao quadro.
- **Pinça de dois dedos (reduzir, foco fora do centro).** Foco em (540, 1300) px, distância entre os dedos 600 → 200 px: razão medida entre A e C 0,4164; B foi de (539, 1087) a (540, 1211) px (previsto 1211,3) e A de (162, 1309) a (382, 1303) (previsto 382,6).
- **Pinça com o foco andando** de (540, 1300) a (690, 1100) px e escala acumulada 1,2: B em (689, 845) (previsto (688,8; 844,4)). O foco local chegou ao fim em (246,8; 132,9) dp, exatamente onde os dedos foram posicionados: a página **não** rolou.
- **Limites.** Pinça enorme duas vezes sobre B: o diâmetro do preenchimento é 412 px nas duas (escala 4, a segunda pinça não muda nada) e B continua sob o foco; pinça de redução enorme duas vezes: A, B e C em (455, 1137), (540, 1087) e (625, 1137) px, os pontos previstos para a escala 0,25.
- **Centralizar e Ajustar.** Centralizar deixou o centro do grafo em (539, 1200) px (centro do quadro: (539,5; 1198,5)) mantendo a escala; Ajustar preencheu a largura com a margem de 24 dp, centrado. Desfazer e refazer (botões) depois de mover a câmera preservam a câmera (mesmos centros) e a aresta B–C some e volta.
- **Segundo dedo.** Durante o **pan ativo**: o pan é cancelado, a câmera fica como estava em (588, 1103) px e o dedo novo não vira pinça nem pan (nada é criado). Durante o **arrasto de vértice** (B arrastado de (540, 1087) a (600, 980) px com o dedo parado; o pedido de ativação foi registrado; depois o segundo dedo desce no fundo): o arrasto é cancelado, B volta a (539, 1087), A e C não se mexem. **Dois toques rápidos** de 60 ms em Adicionar vértice (inclusive com 8 px de abertura entre os dedos): continuam 3 vértices.
- **Tema escuro e exemplo orientado** (pesos 5 e −2, arcos e setas): botões e aviso com os tokens do tema; a pinça leva pesos e setas junto.
- **Grafo de 30 vértices com hub de grau 29** criado por toques (88 toques): pan, equivalência e medições acima.

**Defeitos reais achados só no aparelho (os testes passavam) e corrigidos.** (1) **Salto ao levantar o primeiro dedo.** O Gesture Handler manda ainda UMA atualização com `numberOfPointers = 1` e o foco no dedo que restou, e a câmera saltava o quanto o foco se afastava (o vértice B ficou 300 px à direita do previsto; 114 dp no log). Agora essa atualização é ignorada. (2) **A página rolava durante a pinça.** A pinça só ativava depois de o vão entre os dedos mudar a folga de toque; enquanto os dedos andavam juntos, o `ScrollView` rolou 118 px e o foco local se deslocou com o quadro. Agora a pinça é ativada na hora em que o segundo dedo desce (`GestureStateManager.activate` no `onTouchesDown`), e o Gesture Handler cancela o `ScrollView`.
**Achados de semântica (não eram defeitos, mas só o aparelho mostra).** A `scale` do Android nasce em 1 **na ativação** e o `ScaleGestureDetector` só começa a contá-la depois de o vão passar a folga dele (≈ 19 dp): por isso uma pinça de 200 → 600 px acusou 1,875 e não 3, e a câmera acompanha esse valor sem salto (a folga nunca vira zoom, como a do pan). `focalX/focalY` são locais ao canvas, em dp. O segundo dedo, quando já há um pan ou arrasto ativo, só cancela (descrito acima).

**Limitações.** (1) Só emulador com GPU por software: sem aparelho físico, iOS, TalkBack/VoiceOver, rotação (a política de redimensionamento só tem teste automatizado) e desempenho real. (2) Os testes de dois dedos usam `sendevent`, que é lento (≈ 250 ms por passo no emulador): vale para a semântica, não para a fluidez. (3) Depois de um pan ativo, ou de um arrasto, o segundo dedo cancela e não vira pinça; o aluno levanta e recomeça. (4) Dois dedos que andam juntos movem a câmera (a pinça com escala 1 é um pan de dois dedos): a página só rola por gestos fora do quadro. (5) No zoom máximo ou mínimo o grafo pode sair inteiro do quadro; **Centralizar** e **Ajustar** trazem de volta. (6) A escala das setas acompanha o zoom (decisão do 3.5), então no zoom 4 elas ficam grandes. (7) Sem inércia, sem minimapa, sem botões de + e −, sem animação da câmera (os comandos são instantâneos, então não há o que reduzir para quem prefere menos movimento). (8) No tamanho mínimo de zoom o texto dos rótulos fica maior que os círculos (traços e textos constantes em dp).

### Painel das quatro representações (incremento 3.11: `core/representation-view.ts`, `representation-content.tsx`, `representations-panel.tsx`, integração em `lab-screen.tsx`)

**O que mudou para o aluno.** Abaixo do canvas e dos botões de desfazer e refazer há um painel recolhível, "Representações do grafo", que mostra o MESMO grafo do canvas de quatro maneiras: lista de adjacência, matriz de adjacência, matriz de incidência e lista de incidência. Ele **não é modal** (um `Modal` impediria editar enquanto se consulta): fica na página, começa **recolhido**, mostra **uma** representação de cada vez e lembra a aba escolhida (também depois de recolher e expandir). Abrir, trocar de aba e recolher não deslocam o canvas, a câmera nem os botões acima dele. **Não mudaram:** o domínio (`src/domain/graph`), o JSON v1, as regras de orientação, o histórico e a política da câmera. Não há editor de matriz, nem edição pelas tabelas, nem dependência nova.

**Como os quatro contratos do domínio são reutilizados.** O adaptador puro (`core/representation-view.ts`, TypeScript sem React) **não constrói nenhuma representação**: chama `adjacencyList`, `adjacencyMatrix`, `incidenceMatrix` e `incidenceList` da Fase 2 e transforma o que elas devolvem em um modelo de apresentação (textos, legendas e descrições faladas prontos). As células, as linhas e as colunas, e a ordem, vêm do domínio (vértices na ordem de inserção; vizinhos na ordem dos vértices; arestas na ordem de criação). O `Graph` só é lido para o que o domínio não carrega por desenho: o **rótulo** de cada vértice e os **extremos** e o **peso** de cada aresta, para os textos. O modelo é discriminado por `kind` (listas e matrizes têm formas diferentes, sem uma estrutura artificial comum) e cada um tem `status`: `ready`, `empty` (grafo sem vértices) e, nas matrizes, `too-large`; a matriz de incidência ainda tem `no-edges`. A identidade é sempre o **id técnico**: cada vértice é um `VertexRef { id, label, text: 'rótulo (id)', spoken: 'rótulo, vértice id' }`, então rótulos repetidos se distinguem e nenhuma posição de array é identidade. O modelo é novo a cada chamada, o grafo não é alterado (congelado, funciona) e o mesmo grafo dá o mesmo resultado.

**Notação visual e contratos de cada representação.**

| Representação | O que mostra | Estados e símbolos |
| --- | --- | --- |
| Lista de adjacência | cada vértice, inclusive os isolados (`Sem vizinhos`), e as arestas que SAEM dele (orientado) ou que o tocam (não orientado, com a mesma aresta nas duas pontas) | `→ B (v2) | e1 | peso 0`, `— B (v2) | e1 | sem peso` |
| Matriz de adjacência | V × V; no orientado a LINHA é a origem e a COLUNA o destino; no não orientado é simétrica | `—` não existe aresta, `×` aresta sem peso, `0` peso zero, `2,5` ou `-2` o próprio peso (vírgula decimal) |
| Matriz de incidência | V × E, vértices nas linhas e arestas nas colunas (na ordem do domínio); o peso NÃO entra nos valores | orientado: `+1` origem, `-1` destino, `0` fora; não orientado: `1` e `0` |
| Lista de incidência | cada vértice e as arestas incidentes (ordem de criação), com o papel | `e1: saída para B (v2) | peso 0`, `e2: entrada de B (v2) | sem peso`, `e1: liga a B (v2) | sem peso` (sem direção inventada) |

**Matriz binária tradicional × a matriz exibida.** A matriz de adjacência binária tradicional usa 0 e 1 para ausência e presença de aresta. A notação do painel **preserva também o peso**, por isso o `0` é um PESO (aresta de peso zero) e a ausência é `—`; a legenda e uma nota na tela dizem isso. As três situações (sem aresta, aresta sem peso, aresta com peso, inclusive zero e negativo) têm símbolo, estado e texto falado distintos. O peso 1 nunca é inventado para uma aresta sem peso.

**Sinais de incidência.** A convenção é a do livro-texto da disciplina (Boaventura Netto e Jurkiewicz, §2.1): no orientado a origem recebe `+1` e o destino `-1`; no não orientado as duas pontas recebem `1`. A legenda avisa que outras fontes podem inverter os sinais. Os pesos aparecem só na descrição de cada aresta, abaixo da tabela (`e1: de A (v1) para B (v2), peso 0`), separados dos valores estruturais, e o cabeçalho da coluna mostra o id e os extremos (`e1`, `A → B`). Arcos opostos são duas colunas, com os sinais trocados.

**Exemplo obrigatório (dígrafo A → B de peso 0, B → A sem peso, C isolado).** Lista de adjacência: A tem `→ B (v2) | e1 | peso 0`, B tem `→ A (v1) | e2 | sem peso`, C `Sem vizinhos`. Matriz de adjacência: `[A][B] = 0` ("Origem A, vértice v1; destino B, vértice v2; aresta e1 com peso zero."), `[B][A] = ×`, o resto `—`. Matriz de incidência: e1: A `+1`, B `-1`, C `0`; e2: A `-1`, B `+1`, C `0`. Lista de incidência: A tem e1 saída e e2 entrada, B tem e1 entrada e e2 saída, C nenhuma. A direção dos arcos opostos nunca se inverte.

**Integração com o Zustand e regras de recálculo.** O painel NÃO tem estado matemático nem cópia do grafo: `ConnectedRepresentationsPanel` assina só `selectGraph` (nunca o `EditorState` inteiro) e passa o `graph` ao painel, que calcula com `useMemo`, **só a representação da aba ativa e só com o painel expandido**; as dependências do cálculo são a identidade do `graph`, a aba e o expandido, e nada mais. Por isso: recolhido, não calcula; aberto na lista de adjacência, não calcula as duas matrizes nem a lista de incidência; pan, pinça, Centralizar, Ajustar, seleção, troca de modo, abrir e cancelar a folha de propriedades e **arrastar um vértice** (muda o layout, não o grafo: `commit(state, state.graph, layout)` preserva a identidade) NÃO recalculam, e desfazer ou refazer um movimento de vértice também não (o instantâneo guarda o mesmo objeto `graph`). Qualquer alteração do grafo (vértice, aresta, peso, rótulo, exclusão, desfazer, refazer, exemplo, outro grafo) troca a identidade e recalcula a aba ativa uma vez. Expandir de novo depois de recolher recalcula uma vez. `memo` impede ainda que a tela percorra o painel a cada gesto.

**Limites de legibilidade (só visuais).** Uma matriz de adjacência tem V × V células e a de incidência V × E; o limite fica num só lugar, `REPRESENTATION_LIMITS.maxMatrixCells = 400` (configurável por `options.maxMatrixCells`, com valores inválidos voltando ao padrão), e é conferido ANTES de o domínio montar a grade: acima dele a matriz **não é materializada** e o painel mostra "Esta matriz possui muitas células para ser exibida integralmente nesta tela.", as dimensões (`Dimensões: 21 × 21 (441 células); o limite de apresentação é 400.`), a sugestão de lista e um botão que abre a lista. Nada é truncado em silêncio. 20 × 20 = 400 ainda é exibida. O limite não altera o tamanho permitido do grafo nem as funções do domínio. As listas não têm limite no modelo: o painel as mostra em páginas de `REPRESENTATION_LIMITS.listPageLines = 60` linhas (cada vértice e cada entrada contam uma) e, quando há linhas de fora, diz quantas ("Mostrando 60 de 118 linhas; 58 linhas não estão sendo exibidas.") e oferece "Mostrar mais". A matriz de incidência de um grafo sem arestas explica que não tem colunas em vez de desenhar uma tabela vazia, e o grafo sem vértices diz que não há o que mostrar (ausência de aresta não é ausência de vértice).

**Layout das tabelas.** As matrizes são `View`s de largura fixa por coluna (56 dp na adjacência e 64 dp na incidência; linhas de 48 dp, cabeçalho de 56 dp), com cabeçalhos de rótulo e id técnico, valores centralizados e contraste pelos tokens do tema. A coluna dos cabeçalhos das linhas fica **congelada** à esquerda e o resto rola num `ScrollView` horizontal aninhado na página (achado no Android: sem isso os cabeçalhos das linhas sumiam ao rolar para a direita); não há rolagem vertical própria (a da página basta, e as matrizes têm no máximo 400 células). A tabela NÃO está dentro do detector de gestos do canvas. Um rótulo longo é cortado com reticências na tela (uma linha), mas o texto falado é completo e o id aparece em linha própria. A legenda vem antes da tabela e as notas explicativas depois (a nota longa, antes, empurrava a tabela para baixo da dobra).

**Acessibilidade inicial (sem TalkBack real).** O título é o nome acessível do painel e informa `expanded`; as abas são `tab` dentro de um `tablist` rotulado, com `selected`; cada célula é UM elemento acessível com a descrição completa ("Origem A, vértice v1; destino B, vértice v2; aresta e1 com peso zero."; na incidência, "Vértice A, vértice v1; aresta e1, de A para B: o vértice é a origem, a aresta sai dele, valor mais um."); cada cabeçalho diz se é linha ou coluna; o zero é dito "peso zero" e a ausência "sem peso" ou "não existe aresta"; os símbolos da legenda têm leitura própria (`—` = "traço", `×` = "sinal de vezes", `+1` = "mais um"). O significado nunca depende só de cor (valor, sinal e símbolo estão no texto). As descrições chegam à árvore de acessibilidade nativa (conferido pelo `uiautomator`), mas **não foi testado com TalkBack**; a avaliação mais ampla é do 3.12.

**Complexidades (confirmadas nas implementações do domínio e medidas).** Lista de adjacência Θ(V + E); matriz de adjacência Θ(V²); matriz de incidência Θ(V·E) (Θ(V + V·E) com E ≥ 1); lista de incidência Θ(V + E). O adaptador soma o mesmo formato por cima (o texto de cada célula ou entrada) e a conferência do limite é O(1). Node, média em ms (adaptador, com o domínio entre parênteses): V = 20 e E = 48: lista de adjacência 0,047 (0,018), lista de incidência 0,120 (0,061), matriz de adjacência 0,057 (0,021), matriz de incidência 0,080 (0,008); V = 100 e E = 278: 0,199 (0,074), 0,320 (0,132), 0,600 (0,125), 1,747 (0,081); V = 200 e E = 568: 0,416 (0,157), 0,644 (0,267), 2,813 (0,270) (matriz de adjacência); estrela com V = 1000: lista de adjacência 0,828 (0,321) e lista de incidência 1,357 (0,475). Acima do limite a matriz custa ≈ 0,001 ms (nem é montada). As quatro NÃO têm o mesmo custo: as listas crescem com V + E, a matriz de adjacência com V² e a de incidência com V·E, e o fator constante do adaptador sobre o domínio fica entre 2 e 10 (um texto por célula). Medido no Hermes (emulador): montar o modelo leva 0,07 a 0,09 ms para 6 vértices e 8 arestas e 0,30 a 0,33 ms para a matriz de 20 × 20 (400 células); trocar para essa aba gerou 17 a 19 quadros, com mediana de 17 a 18 ms e p90 de 48 a 77 ms (GPU por software: serve de ordem de grandeza, não promete fluidez em aparelho real). O custo de montar o modelo e o de desenhar as células (os `View`s e `Text`s) são distintos, e o segundo domina: um modelo de 400 células leva 0,3 ms, e a interface, dezenas de ms.

**Testes do 3.11** (131 novos; total 2932, 61 suítes). Núcleo (`editor-core`): `core/representation-view.test.ts` (53: o exemplo obrigatório nas quatro, os três estados de peso, orientação, simetria, incidência +1/-1 e 1/1, isolados, rótulos repetidos e Unicode, ids com lacunas, a ordem do domínio, grafos sorteados com o domínio como oráculo célula a célula, vazios, legendas, limites, listas em páginas, determinismo e imutabilidade) e `core/representation-view-calls.test.ts` (8: só a função do domínio da aba pedida é chamada e uma matriz acima do limite não chama o domínio). Interface (`app`): `representations-panel.test.tsx` (42: recolhido e expandido, as quatro abas, conteúdo, símbolos, descrições faladas, legendas, simetria, peso zero, isolados, limites, coluna congelada, vazios, tema claro e escuro, atualização com o grafo) e `lab-screen-representations.test.tsx` (28, de ponta a ponta com a tela inteira: posição e estabilidade do layout, edição com o painel aberto, atualização a cada alteração do grafo, inclusive pelo canvas e pela folha de propriedades, e um espião passante em `buildRepresentationView` que prova quando o painel recalcula e quando não). **Mutação dirigida: 44 mutações, 43 detectadas de primeira, 1 só depois de reforçar o teste e nenhuma equivalente.** Adaptador (27 de 27): peso zero apresentado como ausência (no texto visível, no texto falado e na matriz), aresta sem peso apresentada como zero (no texto e na matriz), origem e destino invertidos (na descrição da matriz, nos papéis da lista de incidência e na legenda da aresta), matriz não orientada assimétrica, sinal de incidência invertido, incidência não orientada com sinais de orientado, peso substituindo o valor de incidência, vértice isolado omitido (nas duas listas e na linha de aviso), rótulo usado como identidade no lugar do id, aba errada (a matriz de adjacência monta a de incidência), limite de células ignorado (nas duas matrizes) e limite exclusivo em vez de inclusivo, lista fora da ordem do domínio, seta de direção ausente, peso zero e negativo falados errado, página que passa do total e que esconde linhas sem contar, grafo vazio sem aviso. Painel e tela (17: 16 de primeira e 1 reforçada): painel que começa expandido, aba errada exibida, **painel fechado recalculando**, **atualização que não ocorre depois de editar o grafo**, painel que depende do `EditorState` inteiro (seleção, arrasto e troca de modo passam a recalcular), **câmera que remonta o painel (a mesma classe de "recalcular depois de pan e pinça")**, aba esquecida ao recolher, truncamento da lista sem aviso, cabeçalhos de linha e de coluna trocados, aviso de matriz grande demais ou de grafo vazio ausente, tabela sem rolagem horizontal, estado `expanded` do título sempre falso, legenda das matrizes ausente e botão da sugestão que não abre a lista. **O sobrevivente e o que foi feito:** a célula deixar de ser um elemento acessível (`accessible = false`) passava, porque os testes conferiam só o texto do rótulo; agora um teste exige `accessible` em cada célula, cabeçalho e linha das quatro representações, e a mutação é detectada. Não há mutação literal de "recalcular depois de pan": nenhum caminho de código liga a câmera ao painel, e a câmera que remonta o painel e o `EditorState` inteiro modelam as duas formas realistas de quebrar essa regra. Os quatro arquivos de produção foram restaurados byte a byte (hash).

**Validação no Android (emulador `Pixel_6`, Android 13, GPU por software, Expo Go 58.0.5; temas claro e escuro).** Toques por `adb shell input`, dois dedos reais por `adb root` + `sendevent`, leitura das descrições pela árvore de acessibilidade (`uiautomator dump`) e medidas nos pixels das capturas. Percorrido o roteiro do enunciado:
- **Painel.** Recolhido por padrão, abaixo do histórico; os limites de Selecionar, Centralizar e Ajustar ao grafo são os **mesmos** com o painel expandido e recolhido (`[42,533][360,709]`, `[42,1678][530,1804]`): o canvas não se desloca.
- **Quatro abas sem arestas** (A, B e C): três `Sem vizinhos`; matriz 3 × 3 de `—`; a incidência avisa que não há colunas; a lista de incidência diz "nenhuma aresta incidente".
- **A—B (não orientado):** a lista mostra a aresta e1 nas duas pontas, a matriz é simétrica (`×` em A-B e B-A), a incidência vale 1 e 1 (C = 0) e a lista de incidência diz `liga a`.
- **Peso 0 pela folha de propriedades:** a matriz passa de "aresta e1 sem peso" a "aresta e1 com peso zero" e a lista de `sem peso` a `peso 0`: 0 e ausência de peso são distintos.
- **Orientado, A → B e B → A:** as duas arestas (e1, e2) ocupam células e colunas diferentes, e as descrições da incidência dizem origem com "valor mais um" e destino com "valor menos um" nos dois arcos.
- **Alterações com o painel aberto:** excluir o vértice F (3 arestas) levou o painel de 6 vértices e 8 arestas a 5 e 5, com **1** recálculo; desfazer e refazer o rótulo (`Zeta`) o reverteram e reaplicaram, 1 recálculo cada; conectar B → F, 1; salvar o rótulo, 1; digitar na folha sem salvar, **0**.
- **Sem recálculo (medido por um `console.log` temporário no `useMemo`, removido depois):** expandir, 1; pan de 172 px, selecionar um vértice, arrastar um vértice (foi parar onde o dedo soltou), Centralizar e Ajustar, e uma **pinça de dois dedos reais** (o vértice foi de 108 a 232 px de largura), **0**.
- **Rolagem horizontal:** na matriz de incidência 6 × 7 as colunas e1 a e3 saem à esquerda e e4 a e7 aparecem, com os cabeçalhos das linhas (A a F) fixos e alinhados e a rolagem vertical da página inalterada.
- **Limite:** 21 vértices (441 células) mostram a mensagem, `Dimensões: 21 × 21 (441 células); o limite de apresentação é 400.`, a sugestão e o botão, sem tabela; 20 vértices (400) mostram a matriz inteira. O botão "Abrir a lista de adjacência" existe e foi conferido nos testes automáticos.
- **Temas e abas:** tema escuro com contraste legível (cabeçalhos, legenda, valores); Início, Aprender, Desafios e Laboratório continuam funcionando e o Laboratório preserva o grafo.
- **Defeitos de uso achados só no aparelho e corrigidos:** (1) ao rolar a matriz para a direita os cabeçalhos das linhas sumiam (agora a coluna é congelada); (2) a nota longa da matriz empurrava a tabela para baixo da dobra (agora as notas vêm depois da tabela).

**Limitações.** (1) Só emulador com GPU por software: sem aparelho físico, iOS, TalkBack/VoiceOver, rotação, escala de fonte a 200 % nem largura de 320 dp (3.12). (2) O painel está na página, abaixo dos botões: em telas pequenas o aluno rola entre o canvas e o painel, e não vê os dois ao mesmo tempo (decisão do enunciado: não modal; o ajuste fino é do 3.12). (3) As matrizes com mais de 400 células não são exibidas (limite só visual, configurável no código, sem tela de configuração). (4) As listas são mostradas em páginas de 60 linhas, com "Mostrar mais". (5) Rótulos longos são cortados com reticências na tela (o texto falado é completo). (6) Sem edição pelas tabelas, sem exportar nem copiar, sem destaque do elemento do canvas ao tocar numa célula. (7) A aba escolhida é lembrada enquanto a tela existir, não depois de fechar o app (nada é persistido). (8) A medição de desempenho é de emulador, e o desenho das células domina o custo.

### Procedimento de teste em Android

1. Subir o emulador: `& "$env:ANDROID_HOME\emulator\emulator.exe" -avd Pixel_6` (ou pelo Android Studio) e esperar o boot.
2. No projeto: `npx expo start` (use `--clear` se o cache do Metro estiver suspeito) e aguardar "Waiting on http://localhost:8081".
3. Conectar o emulador ao Metro e abrir o app no Expo Go:
   `adb reverse tcp:8081 tcp:8081` e `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent`.
   Com o cache do Metro vazio o primeiro bundle leva cerca de 1 minuto; se o Expo Go mostrar "Something went wrong"
   antes disso, abra de novo depois que o Metro registrar `Android Bundled`.
4. Conferir: as quatro abas, a navegação por toque (cartão da Início → Laboratório), tema claro e escuro (Configurações
   do Android), e que o log (`adb logcat -s ReactNativeJS`) e o Metro não mostram erros.
5. Toques e arrastos por `adb`: `adb shell input tap X Y` e `adb shell input swipe X1 Y1 X2 Y2 DURAÇÃO_MS`
   (coordenadas em pixels da tela; capturar com `adb exec-out screencap -p`). **Pinça e qualquer gesto de dois dedos NÃO saem de
   `input`/`motionevent` (um ponteiro só)**: no emulador (imagem `userdebug`) eles saem por `adb root` e `sendevent`, veja o passo 10.
6. Toques sobre capturas: o visualizador mostra a imagem a 900 px de largura para 1080 px físicos, então multiplique as coordenadas por
   1,2 (e 1 dp = 2,625 px a 420 dpi). Para provar que rolar a página não cria vértice, use `adb shell input swipe` começando **dentro**
   do quadro (300 ms, centenas de pixels). O Expo Go mostra o menu do desenvolvedor na primeira abertura (feche pelo X), e o Metro com
   `CI=1` **não observa arquivos**: reinicie-o para ver o código novo.
7. Para o modo Conectar, compare a posição de cada vértice criado com o ponto tocado (o deslocamento do canvas só aparece assim), faça os toques A e B e confira a aresta, e use `adb shell input swipe`
   (200 ms) começando em um vértice: um deslize não pode escolher a origem nem criar aresta.
8. Para a folha de propriedades: abra-a, toque no campo (o teclado aparece) e toque em **Salvar uma única vez** com ele aberto: tem de salvar e fechar (o toque capturado por um `ScrollView` ancestral só se manifesta assim). Confira os limites dos botões com `adb shell uiautomator dump`
   (o último botão precisa terminar acima da barra do sistema) e digite acentos com a pressão longa do teclado e `adb shell input motionevent DOWN/MOVE/UP` (o `adb shell input text` não digita "í"). O Metro com `CI=1` não observa arquivos; para ver mudanças de código sem reiniciar, rode `npx expo start` sem `CI`.
9. Para o arrasto (3.9): `adb shell input motionevent DOWN X Y`, `MOVE X Y` (em passos, com uma pausa de ~150 ms) e `UP X Y` (ou `CANCEL X Y` para o cancelamento nativo) deixam o dedo parado no meio do gesto, para fotografar a prévia; `adb shell input swipe X1 Y1 X2 Y2 40` a `300` mede a corrida com o `ScrollView`. Meça o centro do círculo nos pixels da captura (contorno azul) e o quadro com `uiautomator dump`. `adb shell dumpsys gfxinfo host.exp.exponent reset` antes do gesto e sem `reset` depois dão a estrutura do quadro (o emulador usa GPU por software). No Git Bash do Windows, defina `MSYS_NO_PATHCONV=1` (ou use o PowerShell), senão `/sdcard/...` vira `C:/Program Files/Git/sdcard/...`.
10. Dois dedos reais no emulador (3.10): `adb root` (**reinicia o `adbd` e apaga o `adb reverse`**: repita `adb reverse tcp:8081 tcp:8081` e reabra o app; sem isso o Expo Go mostra "Something went wrong"). O dispositivo de toque da TELA PRINCIPAL é o `virtio_input_multi_touch_1` (`/dev/input/event2`, confira com `adb shell getevent -lp`); o `event12`, ou qualquer outro `virtio_input_multi_touch_N`, aceita os eventos e **o app não vê nada**. O protocolo é o multitoque tipo B por `sendevent /dev/input/event2 TIPO CÓDIGO VALOR`: `3 47 SLOT` (ABS_MT_SLOT), `3 57 ID` (ABS_MT_TRACKING_ID; `-1` levanta o dedo), `3 53 X` e `3 54 Y` (posições de 0 a 32767: `x_px·32767/1080`, `y_px·32767/2400`), `3 58 100` (pressão), e `0 0 0` (SYN_REPORT) fecha cada quadro. Não há `BTN_TOUCH` nesse dispositivo. Gere um script `sh` com os passos e rode-o NO aparelho (`adb push` e `adb shell sh`): cada `sendevent` é um processo, então um passo leva ≈ 250 ms e o gesto fica lento (serve para a semântica, não para a fluidez). Para registrar o que o Gesture Handler vê, ligue temporariamente `console.log` em `onTouchesMove`, `onActivate` e `onUpdate` do detector e leia `adb logcat -s ReactNativeJS`; remova antes de encerrar. Para medir a escala da câmera pelas capturas, use o diâmetro do círculo ou a razão entre as distâncias de dois vértices.
11. Painel das representações (3.11): o `uiautomator dump` mostra, em `content-desc`, as descrições faladas de cada célula, cabeçalho e linha (é a árvore de acessibilidade nativa; não substitui o TalkBack). Para saber QUANTAS vezes o painel recalculou, ligue temporariamente um `console.log` dentro do `useMemo` de `representations-panel.tsx` e leia `adb logcat -d -s ReactNativeJS:V`; `adb logcat -c` antes de cada ação zera a contagem; remova o log antes de encerrar (um Fast Refresh reinicia o estado do painel: recolhido, na lista de adjacência). Role a página com `adb shell input swipe 540 1800 540 700 350` e ache as abas pelos limites do `dump`; role uma tabela com um `input swipe` horizontal dentro do `HorizontalScrollView` (confira os limites dele no `dump`). `adb shell cmd uimode night yes|no` troca o tema. Um grafo de 21 vértices se cria com um script `sh` de 21 `input tap` rodado no aparelho (`adb push` e `adb shell sh`).
12. Encerrar: `adb emu kill` e parar o Metro.

### Limitações desta etapa

Só TypeScript, Jest e o emulador Android com Expo Go foram executados. **iOS, aparelho físico, TalkBack/VoiceOver, rotação do aparelho, escala de fonte a 200 %, largura de 320 dp, development build e desempenho em aparelho real com muitos elementos não foram verificados.** O arrasto de um dedo foi verificado no emulador (veja "Arrastar vértices"), e o pan, a pinça de dois dedos e o segundo dedo durante pan e arrasto também (veja "Câmera: pan, pinça e enquadramento"). A tela de teste do emulador foi
descartada: o repositório não tem nenhum editor nem tela falsa.

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
- **Formato de persistência:** arquivos de referência (*golden*) em `src/domain/graph/golden/v1/`, **escritos à mão**
  a partir da especificação (não gerados pelo código) e pequenos (< 600 caracteres), comparados byte a byte com a
  saída; uma segunda implementação do texto compacto, escrita por concatenação, é comparada com o serializador em 400
  grafos pseudoaleatórios; um teste fixa `GRAPH_SCHEMA_VERSION = 1` (mudar a versão exige novos arquivos de referência
  e uma migração). A leitura dos arquivos normaliza fim de linha (o Git no Windows pode converter LF em CRLF).
- **Leitura de documentos** (`deserialization.test.ts`): (1) os **quatro arquivos de referência** são lidos e comparados
  com grafos escritos à mão, e `serializeGraph(parseGraphJson(texto))` devolve o texto exato; (2) **ida e volta**
  (`parseGraphJson(serializeGraph(g))` igual a `g`, compacto e legível) sobre grafos fixos, 200 grafos pseudoaleatórios
  por orientação com remoções, pesos especiais, textos especiais e **60 sequências determinísticas de operações por
  orientação** (cada grafo intermediário volta idêntico); (3) as **quatro representações** e os graus do grafo
  restaurado coincidem com os do original (Σ graus = 2·|E| e Σ entrada = Σ saída = |E|); (4) um **corpus de ≈ 180
  entradas inválidas**, cada uma conferida por `parseGraph` e por `parseGraphJson` com o mesmo erro exato, mais as que só
  existem em memória (esparsas, getters, símbolos, proxies, `NaN`, `bigint`…); (5) **segurança**: `Object.prototype`
  intacto após `__proto__`/`constructor`, getters nunca chamados, proxy sem `[[Get]]`, cada propriedade lida uma vez,
  nenhum objeto compartilhado com a entrada, erros sem texto do documento; (6) **concordância com o domínio**:
  rótulos e arestas aleatórios comparados com `addVertex`/`addEdge`; (7) **corrupção aleatória** (3 000 objetos e
  2 500 textos): nunca lança e, se aceita, o grafo passa por um verificador de invariantes independente; (8) escala
  (30 mil vértices e 120 mil arestas) que estouraria o tempo do teste se a validação fosse quadrática.
  Em **mutação dirigida** (71 mutações em `deserialization.ts` e nas regras compartilhadas de `graph.ts`: ids repetidos,
  contadores, laços, pesos e rótulos inválidos, campos e versões desconhecidos, objetos compartilhados, limites, extremos
  trocados etc.) todas foram detectadas; duas sobreviveram na primeira rodada (array no lugar de objeto, protegido
  também pela checagem de protótipo, e a checagem barata do comprimento do id, que só muda o custo) e ganharam testes
  próprios.
- **Contrato de persistência** (`persistence-contract.test.ts`, Incremento 4.3): protege o que uma versão futura do
  formato não pode quebrar e **não repete** os testes de formato (4.1) nem de validação (4.2). Trabalha só com a API
  pública e uma coleção de 31 grafos (vazios, isolados, os de referência, textos e pesos nos limites, aleatórios e
  resultados de histórias de edição). Contratos: (1) serializador e leitor são inversos, com ponto fixo; (2) o texto
  cumpre a especificação do v1 segundo um verificador escrito à parte e a pasta `golden/` tem só os arquivos
  esperados; (3 a 8) **distinção por aspecto**: para cada aspecto (id e nome do grafo, orientação, ordem dos vértices e
  das arestas, rótulo, peso ausente × zero × valor, extremos, cada contador) um grafo que difere só nele gera texto
  diferente e é lido de volta exatamente; (6 e 9) **25 histórias de 12 gerações** de editar, salvar e reler comparadas
  com uma cópia que nunca passou pelo texto: grafo, texto e as quatro representações iguais, contadores sem recuar e
  todo id novo vindo do contador anterior em diante; (10) determinismo, inclusive sem `Math.random`, `Date.now`,
  `sort`, `localeCompare` e `toLocaleString`; versões futuras (v2 fictícias); nada é corrigido em silêncio; e o
  inventário das armadilhas que um `Proxy` executa.
- **API pública** (`public-api.test.ts`): a lista exata dos 32 valores exportados (nada a mais, nada a menos),
  helpers internos fora, assinaturas de `serializeGraph`, `parseGraph` e `parseGraphJson` e o vocabulário de erros
  (8 códigos, 15 motivos de documento, 3 de rótulo, 5 causas) fixados por `satisfies` (conferido pelo `tsc`).
  Em **mutação dirigida** (32 mutações no serializador, no leitor e no `index.ts`, escolhidas porque as verificações
  são novas) todas foram detectadas só por estas duas suítes; uma sobreviveu na primeira rodada (rótulo normalizado em
  silêncio, regra de validação da 4.2) e ganhou um teste de contrato.
- **Fronteira do núcleo do editor** (`core/boundary.test.ts`, projeto Jest `editor-core`, Node): roda o ESLint de
  verdade sobre trechos de código e confere que o núcleo e o domínio barram React, React Native, SVG, gestos,
  Reanimated, Worklets, Zustand, Expo, pacotes da Shopify e componentes/tema/telas, que deixam passar o domínio e o
  próprio núcleo, que o núcleo barra JSX, que a interface continua livre para usar essas bibliotecas, que os imports
  relativos não saem da pasta e que o alias `@/domain/graph` funciona em Node. Em **mutação dirigida** (10 mutações
  de `eslint.config.js` e `jest.config.js`) todas foram detectadas; uma só sobrevivia (o Skia, que o padrão `react-*`
  já cobre pelo nome do pacote) e ganhou um caso com um pacote da Shopify sem "react" no nome.
- **Câmera** (`core/camera.test.ts`, projeto `editor-core`, Node): conversões **calculadas à mão** nos dois sentidos
  (translação, escala, coordenadas negativas e fracionárias, o exemplo do enunciado), zoom em vários focos e com os
  limites (a razão efetiva, não a pedida), pan, centralização, enquadramento de conteúdo pequeno, grande, retangular, com
  margem e degenerado (vazio, um vértice, linha vertical e horizontal, limites que excluem a escala 1), entradas
  inválidas (a própria câmera), imutabilidade e determinismo, e **propriedades com sementes fixas** (gerador próprio de
  `core/test-helpers.ts`, sem biblioteca): ida e volta nos dois sentidos, o foco do zoom parado com e sem limitação,
  composição de zooms, pan, centralização e invariantes do enquadramento (centro no centro; conteúdo dentro da área
  útil ou escala parada no mínimo; enquadramento justo), com contagem de que cada regime foi exercitado. Em **mutação
  dirigida** (46 mutações de `camera.ts`: sinais, ordem escala/translação, fórmula inversa, foco, razão, limites,
  margem, centro, pan, divisão por zero, guardas e alteração de argumentos) 44 foram detectadas; as 2 que sobraram são
  **equivalentes** (defesas redundantes de propósito): a guarda `largura > 0` do enquadramento (dividir por zero dá
  `+Infinity`, que o `min` e o limite já absorvem) e a checagem antecipada de largura/altura não finitas (a guarda final
  de resultado finito cobre). **Nota:** o Jest compila os módulos **fora do modo estrito** (preset do React Native), então
  escrever num objeto congelado é ignorado em vez de lançar; a imutabilidade é conferida por comparação com uma cópia
  tirada antes, com argumentos não congelados (o comentário "módulos são strict" em `src/domain/graph/test-helpers.ts`
  vale só para código estrito).
- **GraphLayout** (`core/layout.test.ts`, projeto `editor-core`, Node; 102 testes): modelo e operações (posicionar não
  sobrescreve, mover não cria, recusas devolvem o mesmo layout, `-0`, cópia do ponto recebido), **ids perigosos**
  (`__proto__`, `constructor`, `toString`…), `boundsOf`, `circularLayout` com 1, 2, 3 e 4 vértices **calculados à mão**,
  raio pela corda (a fórmula do arco é reprovada), vizinhança com tolerância explícita de 0,003, ordem de inserção com ids
  em lacunas, rótulos repetidos, arestas/orientação irrelevantes; `reconcileLayout` (órfãs, parcial com centroide nos dois
  eixos, ordem dos anéis conferida por uma **reimplementação independente** da regra, outro grafo com ids coincidentes,
  posição inválida, posições sobrepostas e coordenadas negativas, extremos de espaçamento e de magnitude); **600 casos com
  sementes fixas** (uma posição por vértice, nenhuma órfã, preservadas exatamente, idempotência por identidade, distância
  dos novos, determinismo), um modelo de referência (`Map`) para 50 operações aleatórias com cada versão antiga
  intacta, e a integração com a câmera (`fitToBounds`, ida e volta, escala mínima, limite da margem em dp). Em **mutação
  dirigida** (68 mutações de `layout.ts`: índice × id, rótulo × id, sentido, topo, raio por arco, `minRadius`,
  `spacing`, arredondamento, `-0`, validação de coordenadas, sobrescrita, aliasing, protótipo, limites mínimos e máximos,
  comparação `<` × `<=`, busca de anéis, fallback, outro grafo, órfãs, posições movidas, vértice novo sem posição,
  idempotência, centroide) 67 foram detectadas; a que sobrou é **equivalente** (`positionOf` sem `hasOwnProperty`).
  Duas mutações (`({}) as Positions`) só valem com parênteses: sem eles o Babel lê um bloco de função e a suíte não
  compila, o que o relatório mostra como "0 total" e **não** conta como detecção.
- **Geometria e hit-testing** (`core/geometry.test.ts`, projeto `editor-core`, Node; 120 testes): reta horizontal, vertical e
  diagonal 3-4-5 **calculadas à mão** (borda a borda, âncora no meio), `d ≤ 2r` sem geometria (tangente, sobreposto, mesma
  posição, vizinhos a 0,001), seta nos dois sentidos e nas três orientações, seta cortada pelo traço visível, **arcos opostos**
  com valores de uma reimplementação independente (controle `C = M + n·k·d` com d = 100, 200 e 300 na vertical, curvas em lados
  opostos, imagem uma da outra pelo ponto médio, âncoras sobre as curvas, resultado independente da ordem de inserção),
  distância a segmento (além das pontas e degenerado) e a curva (cota do erro da poligonal contra um oráculo denso),
  hit-testing de vértices e arestas em **câmeras de escala 0,25, 1 e 4 com translações positivas e negativas** (fronteiras
  exatas e 1 dp além, tolerância em dp, não em mundo), prioridade vértice > aresta > fundo, empates (vértices na mesma
  posição, ordem de inserção diferente da do id, arestas paralelas, cruzamento), entradas inválidas (câmera, toque, layout
  de outro grafo), integração com `circularLayout` e `reconcileLayout`, `edgeGeometries` sem chamar `find/some/filter` nas
  arestas e `hitTestVertex`/`hitTest` sem ler `graph.edges`, mais **propriedades com sementes fixas** (500 casos de geometria:
  ids, extremos na borda, seta apontando para o destino, finitude e ausência de `-0`; inverter a aresta inverte a seta;
  um toque que acompanha a transformação do elemento acerta o mesmo id em qualquer zoom e deslocamento; a distância em dp
  é a do mundo vezes a escala, com oráculo denso). Em **mutação dirigida** (77 mutações de `geometry.ts`: origem e destino
  trocados, linha pelos centros, ponta ausente ou no lado errado, asas, curvatura do lado errado ou zerada, arcos opostos
  coincidentes, índice de arcos, distância à reta infinita, tolerância em mundo, alvo mínimo, fronteiras `<` × `<=`, empates,
  prioridade, câmera ignorada após zoom ou pan, entradas inválidas, aliasing e alteração de argumentos) 70 foram detectadas
  (3 só depois de reforçar os testes: o deslocamento do controle com `d ≠ 100`, a normalização de `-0` e a tolerância 0).
  As 7 que sobraram são **equivalentes**: o índice de arcos em grafo não orientado e a checagem `graph.directed` de
  `edgeGeometry` (um grafo simples não orientado nunca tem aresta oposta); o filtro de resultado não finito e o de posição
  não finita (a checagem `distance` finita as torna inalcançáveis); o último ponto da poligonal tomado de `quadraticPoint(…, 1)`
  (devolve exatamente `to`); o melhor inicial infinito da poligonal (o primeiro segmento já cobre o ponto inicial); e o filtro
  de posição não finita nos vértices (um centro `NaN` dá distância `NaN`, que `!(d <= alcance)` descarta). Os testes de
  mutação também mostraram que `-0` só nasce de entrada com `-0` (`quadraticPoint`), pois somas de opostos dão `+0`.
- **Núcleo de edição** (`core/editor.test.ts`, projeto `editor-core`, Node; 103 testes, mais 17 em `core/error-messages.test.ts`):
  estado inicial (layout reconciliado, limite do histórico 1 a 1000 e inválidos, modos); **política de rótulos** (lacunas,
  rótulos do aluno e minúsculas, de Z para AA e de AZ para BA, até `AAA`; **A, B, C → desfazer C → novo vértice `v4` com o
  rótulo `C`**, e o contador do domínio daria `D`); cada ação com suas recusas e a prioridade das validações; atomicidade (posição
  inválida ou rótulo inválido não mudam grafo nem layout e **não consomem id**); remoção de vértice com arestas incidentes
  (orientado e não orientado) e da posição; **arcos opostos** só em grafo orientado; histórico (desfazer e refazer uma e várias
  operações, vazio, limite de 100, 3 e 1, ramo futuro descartado por qualquer edição, **contadores de vértice e de aresta
  separados e monotônicos**, refazer com o **mesmo id**, instantâneos intactos, erro e modo fora do histórico, seleção limpa
  quando o elemento some); e **250 passos × 30 sementes contra um modelo de referência independente** (listas simples, outro
  gerador de rótulos, sem usar o domínio nem o editor) com recusas intercaladas: cada transição bate com o modelo (mesmo
  veredito, mesmo motivo da recusa, mesmo conteúdo, contadores, seleção e tamanhos do histórico), as invariantes são conferidas do
  zero a cada passo (ids canônicos e únicos, contadores acima dos ids, arestas válidas, **layout com exatamente uma posição por
  vértice e nenhuma órfã**, seleção existente, instantâneos com contadores nunca acima dos atuais) e `redo(undo(s))` devolve o mesmo grafo e
  layout. **Store** (`graph-editor/editor-store.test.ts`, projeto `app`; 21 testes, sem renderizar componente): estado inicial,
  `dispatch` igual a `applyAction`, recusa com erro estruturado, **nenhuma notificação em ação sem efeito**, seletores estáveis,
  `reset` com outro grafo, e um teste de arquitetura (a store só importa `zustand/vanilla` e o núcleo e não nomeia nenhuma operação
  do domínio). Em **mutação dirigida** (84 mutações: 60 de `editor.ts`, 13 de `editor-store.ts` e 11 de `error-messages.ts`: ids
  reutilizados, contadores que regridem (vértice e aresta, `min` no lugar de `max`), refazer sem restaurar o id, histórico criado por
  ação recusada ou sem efeito, movimentação não registrada, seleção que aponta para elemento removido, layout e grafo divergentes,
  rótulo automático errado, ramo futuro não descartado, limite ignorado ou com erro de um, store que notifica a mais ou a menos,
  que altera regra ou que devolve a transição errada) 83 foram detectadas (a `selectCanUndo` só depois de reforçar o teste, que
  nunca a via falsa). A que sobrou é **equivalente**: refazer sem o piso dos contadores, porque o ramo `future` já carrega o
  piso (a guarda fica por simetria e custa O(1)).
- **Cena, renderizador e tela do 3.5** (124 testes novos). `core/scene.test.ts` (projeto `editor-core`, 54): valores **calculados
  à mão** (câmera `{10, 20, 2}`: centro, raio de 40 dp, traço, seta e âncora do peso), grafo vazio, vértice isolado, orientado e não
  orientado, **arcos opostos** (curvas distintas, setas nos destinos certos), pesos ausente, `0`, negativo e decimal, ids e rótulos
  repetidos preservados, vértice sem posição, câmera inválida e layout de outro grafo, truncamento por pontos de código (emojis
  intactos), visibilidade, resumo acessível (singular, plural, isolados, pesos; 500 grafos aleatórios conferem contagens e
  orientação), enquadramento (círculos e ápices, margem, escala 4 e 0,25, área não medida), consistência com a geometria e o
  hit-testing (tocar no centro de cada vértice da cena o acerta; a escala vale uma vez), determinismo e imutabilidade.
  `svg-graph-renderer.test.tsx` (projeto `app`, 19): quantidade de círculos, rótulos, traços (curva `Q` × reta), setas (só nas
  orientadas) e pesos (o texto `0` presente, a aresta sem peso sem texto nem caixa), atualização quando a cena muda, tema claro e
  escuro com os tokens do tema, imagem com o resumo, elementos escondidos dos leitores de tela, `viewBox` igual à área, corpo da
  fonte da cena e nenhum tratador de toque. `example-graph*.test.ts` (9), `editor-store-provider.test.tsx` (6: uma store por
  montagem, sem singleton, assinatura por fatia), `canvas-size.test.ts` (13), `lab-screen.test.tsx` (22: estado vazio, carregar o
  exemplo, larguras de 320 a 600 dp, repetir a medida sem recalcular a cena, **reset** que limpa histórico, seleção, erro e posições
  do grafo antigo e define o modo `select`, store estável) e `lab-screen-error.test.tsx` (1: erro do domínio ao montar o exemplo). Em
  **mutação dirigida** (70 mutações: 28 de `scene.ts`, 15 de `svg-graph-renderer.tsx`, 7 de `example-graph.ts`, 18 do provider, da
  tela e de `canvas-size.ts` e 2 do `reset` da store: peso zero omitido, peso ausente como 1, direção e origem/destino invertidos,
  curvas opostas coincidentes, câmera sem translação, **escala aplicada duas vezes**, vértice isolado omitido, rótulo trocado pelo
  id, limites sem o raio, resumo sem avisos, `reset` que preserva o histórico, store recriada ou global) 67 foram detectadas (2 só
  depois de reforçar os testes: o `viewBox` e o corpo da fonte). As **3 equivalentes**: entregar ao `reset` o layout do grafo antigo
  (o núcleo descarta o layout de outro grafo e reconcilia), não arredondar a largura medida (`canvasSize` arredonda de novo, só
  haveria uma renderização a mais) e `<= 0` × `< 0` em `canvasSize` (o teste seguinte da função já recusa a largura 0).
  Nota: o SVG fica escondido dos leitores de tela, então as consultas do RNTL pedem `includeHiddenElements`.
- **Modo Adicionar vértice e toque do 3.6** (117 testes novos; total **2020**). `core/tap.test.ts` (projeto `editor-core`, 50: conversão
  calculada à mão, modos, vértice e aresta nas bordas de 24 e 12 dp, entradas inválidas, bordas do quadro, `hitTest` como oráculo em 500 casos),
  `canvas-tap-detector.test.tsx` (11), `editor-controls.test.tsx` (18), `new-graph.test.ts` (3), `lab-screen-tap.test.tsx` (23, o toque de ponta
  a ponta com `createGestureController`) e `lab-screen.test.tsx` (34). **70 mutações dirigidas, 68 detectadas** (5 só depois de reforçar os
  testes) e 2 equivalentes (a guarda de câmera e de ponto inválidos de `tap.ts`, que o `hitTest` repete). O simulador de gestos não mede
  distância nem sair do quadro: isso se garante pela configuração do gesto e foi conferido no emulador. Detalhes em "Modo Adicionar vértice e
  toque".
- **Modo Conectar do 3.7** (121 testes novos; total **2141**). `core/connect.test.ts` (projeto `editor-core`, 46: a máquina com exemplos calculados à mão, `hitTest` real, as duas orientações contra o
  `applyAction`, 500 sequências aleatórias com sementes fixas, texto de estado), `editor-store-connect.test.ts` (30), `lab-screen-connect.test.tsx` (27, o fluxo de ponta a ponta com o gesto simulado),
  `editor-controls.test.tsx` (+9) e `svg-graph-renderer.test.tsx` (+9). **64 mutações dirigidas, 63 detectadas** (2 só depois de reforçar os testes: uma asserção de ordem no layout que era vazia e as
  opções de hit-testing) e 1 equivalente. A quebra de linha real da legenda do Conectar, que deslocava o canvas, só apareceu no emulador. Detalhes em "Modo Conectar".
- **Seleção, propriedades e exclusão do 3.8** (249 testes novos; total **2390**). `core/selection.test.ts` (31), `core/weight-input.test.ts` (66), `core/properties.test.ts` (24) e `core/deletion.test.ts` (22) no projeto `editor-core`; `properties-sheet.test.tsx` (53) e
  `lab-screen-select.test.tsx` (33, o fluxo de ponta a ponta com o gesto simulado) no projeto `app`; mais `editor-controls`, `svg-graph-renderer` e `editor-store`. **90 mutações dirigidas, 90 detectadas** (5 só depois de reforçar os testes), nenhuma equivalente. O que o Jest não vê (a folha cortada no Android e o
  toque capturado pelo `ScrollView` com o teclado aberto) só apareceu no emulador, e um teste estrutural agora o guarda. Detalhes em "Seleção, propriedades e exclusão".
- **Arrasto de vértices do 3.9** (171 testes novos; total **2561**). `core/drag.test.ts` (50) e `core/drag-preview.test.ts` (20) no projeto `editor-core`; `canvas-gesture-detector.test.tsx` (26, +15), `vertex-drag-controller.test.ts` (37), `lab-screen-drag.test.tsx` (36, de ponta a ponta com o gesto simulado e a translação imitando o aparelho) e `svg-graph-renderer.test.tsx` (+13) no projeto `app`. **83 mutações dirigidas, 80 detectadas** (3 só depois de reforçar os testes) e 3 equivalentes. Dois defeitos só apareceram no emulador (a `translationX/Y` que nasce na ativação e o último movimento que chega com o evento de fim), e os testes agora os guardam. Detalhes em "Arrastar vértices".
- **Pan, pinça e enquadramento do 3.10** (240 testes novos; total **2801**, 57 suítes). `core/camera-gesture.test.ts` (41), `core/gesture-start.test.ts` (16) e `core/scene-pan-equivalence.test.ts` (3, 26 casos) no projeto `editor-core`; `camera-store.test.ts` (12), `camera-gesture-controller.test.ts` (31), `canvas-gesture-controller.test.ts` (31), `canvas-gesture-detector.test.tsx` (39, +13), `lab-screen-camera.test.tsx` (60, de ponta a ponta com o gesto simulado), `editor-controls.test.tsx` (+3) e `svg-graph-renderer.test.tsx` (+5) no projeto `app`. **54 mutações dirigidas, 50 detectadas de primeira, 3 só depois de reforçar os testes** e 1 equivalente. Dois defeitos só apareceram com dois dedos reais no emulador (o salto da câmera ao levantar o primeiro dedo e a página que rolava até a pinça ativar), e os testes agora os guardam. Detalhes em "Câmera: pan, pinça e enquadramento".
- **Painel das quatro representações do 3.11** (131 testes novos; total **2932**, 61 suítes). `core/representation-view.test.ts` (53) e `core/representation-view-calls.test.ts` (8) no projeto `editor-core`; `representations-panel.test.tsx` (42) e `lab-screen-representations.test.tsx` (28) no projeto `app`. **44 mutações dirigidas, 43 detectadas de primeira, 1 só depois de reforçar os testes (a célula como elemento acessível) e nenhuma equivalente.** Dois defeitos de uso só apareceram no emulador (os cabeçalhos das linhas sumiam ao rolar a matriz e a nota longa empurrava a tabela para baixo da dobra), e os testes agora guardam a coluna congelada. Detalhes em "Painel das quatro representações".
- **Ambiente de testes das bibliotecas do editor** (`graph-editor/native-stack.test.tsx`, projeto `app`): SVG
  (`Svg`, `G`, `Line`, `Circle`, `Text`) renderiza com suas propriedades; toque e arrasto simulados por
  `createGestureController` atualizam a tela; um componente com valor compartilhado e estilo animado monta. Não testa o
  editor (não existe): se a pilha mudar (versões, resolver, mocks), estes testes quebram primeiro, e remover o
  resolver, o `jestSetup` ou o mock de `getUIRuntimeHolder` de `jest.config.js` e `jest.setup.js` foi detectado.
- **Componentes/rotas:** Jest + React Native Testing Library (`jest-expo`); rotas via `renderRouter`.
- **Tema:** contraste calculado a partir dos tokens.
- **Em dispositivo (manual):** gestos pinch/pan/drag, safe areas, comportamento da barra de abas nativa,
  acessibilidade com TalkBack/VoiceOver. O iOS não pode ser testado em Windows; fica registrado como
  pendente nas entregas.
