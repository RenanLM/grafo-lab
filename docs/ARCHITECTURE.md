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
    graph-editor/      interface do editor (SVG, gestos, animação, controles); a store Zustand entra no incremento 3.4
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
  para 3.3.0 e `worklets` de 0.13.1 para 0.13.0. `zustand` **não** foi instalado (só entra no incremento 3.4).
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
- **Fora do escopo, não instalado:** bottom sheet, Skia, `expo-dev-client`, `zustand`.

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
  `GraphLayout` e posicionamento (3.2); geometria dos elementos e identificação por posição (3.3); comandos do editor e
  histórico (3.4). Hoje a pasta só tem `index.ts` (contrato) e `boundary.test.ts`.
- **C. Interface** (`src/features/graph-editor/`): desenha vértices e arestas, recebe os toques e os traduz em
  **ações** do núcleo, mostra controles, propriedades e representações, executa animações. Não decide regras do grafo
  nem faz geometria.
- **Store Zustand** (3.4, **não criada**): liga A, B e C. Guarda o estado do editor `{ graph, layout, seleção, modo,
  câmera, histórico }` e só **chama** funções puras do núcleo e do domínio; nenhuma regra mora na store nem em
  componentes. Dependências só para baixo: C → store → B → A.

### Contrato do `GraphLayout` (especificação; implementação no 3.2)

- **O que é.** Posição de cada vértice em **coordenadas de mundo**: `GraphLayout = { positions: Record<VertexId, { x, y }> }`.
  Números finitos (`-0` vira `0`), eixo y para baixo, origem livre.
- **Chave = id técnico** (`v1`, `v2`…), **nunca o rótulo**: renomear um vértice não mexe na posição, e rótulos repetidos
  não causam ambiguidade.
- **Não é parte do `Graph`** e não altera o modelo matemático. Mover um vértice **só** muda o layout (um passo de
  histórico); a referência do `Graph` se preserva, então as representações memorizadas não são recalculadas.
- **Independe da câmera** (`{ x, y, scale }`) e do tamanho da tela: nunca guarda coordenadas de tela.
- **Reconciliação** `reconcileLayout(graph, layout)`: descarta posições de vértices que não existem mais (órfãs) e
  posiciona os que ainda não têm posição; idempotente. Vértice sem posição é um estado válido até a reconciliação.
- **Posicionamento inicial automático:** `circularLayout(graph)` determinístico (para exemplos e documentos sem layout);
  criação por toque usa o ponto tocado, já convertido para mundo.
- **Imutável, puro e determinístico** (`placeVertex`, `moveVertex`, `removePosition`, `boundsOf`).
- **Serialização própria no futuro** (3.13): `LayoutDocument` v1 `{ schemaVersion, graphId, positions }`, separado do
  JSON do `Graph`, com a mesma disciplina de validação da leitura de grafos e arquivos de referência próprios. O
  documento do `Graph` v1 não ganha nenhum campo.

### IDs e histórico: estratégia (corrige o ROADMAP; implementação no 3.4)

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
   alcançado na sessão. Ao desfazer ou refazer, o instantâneo de destino **herda os contadores do estado que está
   sendo deixado** (que são os maiores, pois só os comandos os aumentam e um comando descarta o `future`):
   `destino.graph = { ...destino.graph, nextVertexSeq: atual.nextVertexSeq, nextEdgeSeq: atual.nextEdgeSeq }`.
   Isso é uma cópia de objeto comum, **sem alterar o domínio**: um `Graph` com contador à frente dos ids é um estado
   válido (acontece depois de qualquer remoção). Como o contador atual **é** o piso de ids da sessão, não é preciso
   outra variável; `redo(undo(s))` devolve `s` exatamente.
5. **O domínio não muda agora.** No 3.4 pode valer acrescentar ao domínio uma função pura pequena (por exemplo
   `reserveIds(graph, { vertex, edge })`, que só faz os contadores crescerem) em vez de repetir o spread; é decisão
   daquele incremento, com testes próprios.
6. **Rótulos são outra coisa.** O rótulo padrão sai do contador (`addVertex` sem rótulo usa A, B, C… por
   `nextVertexSeq`); como o contador não recua, depois de desfazer a criação de C e criar outro vértice o rótulo
   padrão será **D** (A, B, D). **Reaproveitar rótulos livres é uma decisão separada** do editor, a tomar no 3.4 ou no
   3.6 e registrar aqui: (a) manter o rótulo vindo do contador (simples, coerente com o domínio, deixa lacunas); (b) o
   editor calcular o menor rótulo livre (`nextFreeLabel`, função pura no núcleo) e passá-lo a `addVertex(graph, rótulo)`,
   sem reaproveitar **id** algum. Recomendação provisória: **(b)**, por ser o que o aluno espera ver (A, B, C…).
7. **Documentos e histórico sem colisão.** (i) Ao abrir um documento, os contadores vêm do arquivo (a leitura garante
   que superam todos os ids presentes) e o histórico começa **vazio**; (ii) o documento gravado leva sempre os
   contadores atuais, que são o piso da sessão; (iii) o histórico **não é persistido**; (iv) o layout é por id e só vale
   para o grafo de mesmo `graph.id`, então um layout salvo nunca passa a apontar para outro vértice. Continua valendo a
   limitação já documentada: ids de elementos removidos **antes** da gravação não podem ser reconstruídos de um
   documento adulterado.
8. **Testes do 3.4:** propriedade com sementes fixas sobre sequências de comandos, desfazer e refazer: **nenhuma
   criação distinta compartilha id** e `redo(undo(s))` é exatamente `s`; modelo de referência independente; abrir
   documento e continuar a editar não reemite ids.

### Interação por toque (arquitetura; nada implementado)

- **Um detector para o canvas**, com gestos compostos (API de hooks do Gesture Handler 3: `useTapGesture`,
  `usePanGesture`, `usePinchGesture`, `useLongPressGesture` e as composições `useSimultaneousGestures`,
  `useExclusiveGestures`, `useCompetingGestures`; não misturar com a API antiga de `Gesture.*`). Os nomes exatos e o
  comportamento de cada composição serão conferidos no 3.6 e no 3.10, na versão instalada.
- **Alvo de toque em unidades de tela, independente do zoom:** ≈ 48 dp de diâmetro (raio ≈ 24 dp) em volta do centro do
  vértice, calculado depois de converter o centro do mundo para a tela. O desenho pode ser menor (ou maior com zoom),
  mas **o alvo nunca encolhe** abaixo disso. Sobreposição: o vértice mais perto do toque vence, e o empate vai para a
  ordem de inserção. Arestas têm tolerância própria em pixels de tela e só são acertadas fora dos vértices.
- **Modo explícito** (Selecionar, Adicionar vértice, Conectar) e uma função pura `(modo, toque, o que há sob ele) → ação`.

  | Modo | Toque | Arrasto que começa em vértice | Arrasto no fundo | Pinça | Toque longo |
  | --- | --- | --- | --- | --- | --- |
  | Selecionar | seleciona vértice/aresta ou limpa | move o vértice | desloca a câmera | zoom | propriedades |
  | Adicionar vértice | cria vértice no vazio | desloca a câmera | desloca a câmera | zoom | — |
  | Conectar | escolhe origem e depois destino | desloca a câmera | desloca a câmera | zoom | cancela |
- **Um gesto, um dono.** Uma segunda ponta de dedo durante um arrasto de vértice o cancela (a posição volta) e passa a
  pinça; `onFinalize` com `canceled` desfaz qualquer prévia (conexão pendente, posição provisória).
- **Durante o arrasto** a posição vive em valor compartilhado do Reanimated (thread da interface) e só vai para a store
  ao soltar (um passo de histórico). A câmera e a seleção ficam fora do histórico.

### Renderização (intenção)

- **Inicial:** `react-native-svg`. A interface do editor fala com uma **interface `GraphRenderer`**: recebe uma cena já
  calculada pelo núcleo (posições na tela, geometria das arestas, estados) e **só desenha**; não trata gestos nem
  faz hit-testing. Trocar por Skia depois não toca no núcleo, na store nem no domínio. Skia **não** foi instalado.
- **A desenhar:** vértices circulares com rótulo; arestas retas; **arcos direcionados** com ponta de seta no destino;
  **arcos opostos** (u→v e v→u) como curvas deslocadas, para não se sobreporem; pesos (ausente ≠ 0); destaque de seleção.
- **Estados** (por vértice e por aresta, vindos de fora, nunca guardados no `Graph`): normal, selecionado, origem da
  conexão, prévia; e, para os algoritmos das fases 6 em diante, estados de execução (por exemplo, visitado, na fila,
  atual) a partir de um mapa `id → estado` produzido pelo rastro. Nada depende só de cor.
- **Fora de escopo agora:** sistema genérico de renderização, Skia, animações de algoritmos. A primeira implementação
  visual é o incremento 3.5.

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
   (coordenadas em pixels da tela; capturar com `adb exec-out screencap -p`). **Pinça não é possível por `adb`**: testar
   em aparelho físico ou com o gesto de dois dedos do próprio emulador (a confirmar no emulador usado).
6. Encerrar: `adb emu kill` e parar o Metro.

### Limitações desta etapa

Só TypeScript, Jest e o emulador Android com Expo Go foram executados. **iOS, aparelho físico, TalkBack/VoiceOver,
pinça, development build e desempenho com muitos elementos não foram verificados.** A tela de teste do emulador foi
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
