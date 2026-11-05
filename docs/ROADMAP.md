# Roadmap do GrafoLab

Plano em tarefas pequenas, na ordem de execução. Cada tarefa termina com verificação (`npm run check`
e, quando couber, teste manual em dispositivo) e uma mensagem de commit sugerida. **Nenhuma fase avança
sem autorização explícita.** Antes de iniciar cada fase, as tarefas dela são refinadas e revisadas.

Legenda: ✅ concluída · 🔄 em andamento · ⬜ pendente

## Perguntas em aberto

| Tema | Situação |
| --- | --- |
| Expo Go da SDK 58 nas lojas | A documentação (changelog de 15/10/2026) diz que chega "em poucas semanas". **Não confirmado em 30/10/2026.** No iOS, a doc cita instalação via TestFlight com `npx eas-cli@latest go`. Plano B: development build. |
| Identificadores de publicação (`android.package`, `ios.bundleIdentifier`) | Não definidos; só são exigidos para builds EAS/lojas (Fase 13). |
| Licença do projeto | Não definida (a LICENSE do template da Expo não foi copiada). |
| `npm audit` | 16 achados (13 baixos, 3 altos) em dependências transitivas do ferramental do Expo/Jest (`zod`, `deepmerge`); o "conserto" sugerido rebaixaria para `expo@51`, então **não foi aplicado**. Reavaliar a cada atualização de SDK. |
| Componente de bottom sheet | Decidir na tarefa 3.8 (a folha de propriedades) após ler a doc da SDK vigente (`@expo/ui` BottomSheet × alternativas). |

## Fase 0 — Diagnóstico e planejamento ✅

- ✅ Inspecionar repositório, ambiente (Node 24.12, Java 17, Android SDK, AVD `Pixel_6`) e PDFs (ver `REFERENCIAS.md`).
- ✅ Verificar SDK/versões atuais e Expo Go × development build (ver `ARCHITECTURE.md`).
- ✅ Produzir `ROADMAP.md`, `ARCHITECTURE.md`, `REFERENCIAS.md`.

## Fase 1 — Fundação mobile ✅ (aguarda revisão)

- ✅ 1.1 Expo SDK 58 + TypeScript strict + Expo Router (`src/app`), sem dependências de fases futuras.
- ✅ 1.2 Tema claro/escuro com tokens (cores, espaçamento, tipografia) e teste de contraste WCAG AA.
- ✅ 1.3 Quatro abas (Início, Aprender, Laboratório, Desafios) com `NativeTabs`, safe areas e rota `+not-found` em português.
- ✅ 1.4 Laboratório com estado vazio explicado, sem editor falso.
- ✅ 1.5 Jest (`jest-expo`) + React Native Testing Library + ESLint (`expo lint`) + script `npm run check`.
- ✅ 1.6 Identidade inicial: glifo de grafo, ícone, splash claro/escuro (`scripts/gerar-icones.py`).
- Critério: abre no Android, sem rotas quebradas, `tsc` limpo.
- **Verificado em 30/10/2026:** `tsc` limpo · `expo lint` limpo · Jest 5 suítes / 30 testes (inclui renderização
  das rotas reais e navegação por toque) · `expo-doctor` 20/20 · `expo install --check` ok · `expo export` Android
  (Hermes, 1200 módulos, bundle de 2,6 MB) · execução no emulador `Pixel_6` (Android 13, API 33) com Expo Go
  58.0.5, nas quatro abas em tema claro e (Início e Laboratório) em tema escuro.
- **Não verificado:** iOS (sem macOS), aparelho físico, TalkBack/VoiceOver, orientação paisagem (travada em retrato).
  O Jest não exercita a barra de abas nativa; ela só foi vista no emulador.

## Fase 2 — Modelo matemático ✅ (aguarda revisão)

Domínio puro em `src/domain/graph`, sem importar React, React Native, Expo ou Zustand. Regras do modelo em
`ARCHITECTURE.md` (decisão 7). Fora do recorte por falta de uso agora: `capacity` (→ Fase 12) e `GraphLayout` (→ Fase 3).

- ✅ 2.1 **Incremento 1:** fronteira do domínio (Jest em Node + regra de ESLint), tipos `Vertex`/`Edge`/`Graph`, `Result`/`GraphError`,
  `createGraph`, `addVertex`/`removeVertex`, `addEdge`/`removeEdge`, `getVertex`/`getEdge`/`findEdge`, `order`, `size`.
- ✅ 2.2 **Incremento 2:**
  - ✅ Parte A: grau (entrada, saída, total), vizinhança (sucessores, predecessores, vizinhos) e vértices isolados.
  - ✅ Parte B: `setVertexLabel` (trim, 1 a 64 pontos de código, repetidos permitidos) e `setEdgeWeight` (`undefined` remove, `0` é peso).
- ✅ 2.3 **Incremento 3 — representações** (concluído; um commit por etapa, cada etapa só começou com autorização):
  - ✅ 3.0 `addVertex` devolve `Result` e valida o rótulo pelas mesmas regras do `setVertexLabel` (`null` não conta como "omitido").
  - ✅ 3.1 **Lista de adjacência** (`adjacency.ts`): uma linha por vértice, na ordem dos vértices; entradas
    `{ vertexId, edgeId, weight? }` na ordem de `successors`. Orientado: só arcos de saída. Não orientado: cada
    aresta aparece nas duas pontas.
  - ✅ 3.2 **Matriz de adjacência** (`adjacency-matrix.ts`): `adjacencyMatrix` devolve `{ vertexIds, cells }`, com
    `cells[i][j]` = `null` (sem aresta) ou `{ edgeId, weight? }` (`weight` ausente = aresta sem peso; `0` = peso
    zero). Os três estados ficam distintos e **o peso 1 nunca é gravado no modelo**. Células simétricas são objetos
    independentes (sem aliasing). `adjacencyAsNumbers(matrix, { absent, unweighted })` é a **projeção numérica**:
    opções obrigatórias (teste de tipo), não reversível, sem distância zero automática na diagonal; a matriz
    estrutural original nunca perde informação.
  - ✅ 3.3 **Matriz de incidência** (`incidence.ts`): `incidenceMatrix` devolve `{ vertexIds, edgeIds, cells }`,
    vértices × arestas na ordem de inserção, células em `{-1, 0, 1}`. Orientado: **+1 na origem e −1 no destino**;
    não orientado: +1 nas duas pontas; as demais células valem 0; sem pesos. Fonte conferida: Boaventura &
    Jurkiewicz, §2.1, p. 20 (ver `REFERENCIAS.md`). Identidades B·Bᵀ = D + A (não orientado) e B·Bᵀ = D − (A + Aᵀ)
    (orientado) verificadas em grafos pequenos; construção Θ(V + V·E).
  - ✅ 3.4A **Lista de incidência** (`incidence-list.ts`): `incidenceList` devolve `{ vertexIds, rows }`; cada linha
    lista as arestas incidentes ao vértice como `{ edgeId, oppositeVertexId, role, weight? }`, com `role` em
    `incoming` / `outgoing` (orientado) ou `undirected`. Entradas na ordem de inserção das **arestas** (a mesma
    ordem das colunas da matriz de incidência; difere da lista de adjacência, que ordena pelos vizinhos). Cada aresta
    aparece uma vez em cada extremo (2E entradas); arcos opostos têm `edgeId` próprio; peso sem conversão (ausente,
    zero e negativo). Construção Θ(V + E), uma passada pelas arestas e sem ordenação. Consistência com
    `incidenceMatrix` testada localmente (+1 ↔ `outgoing`/`undirected`, −1 ↔ `incoming`).
  - ✅ 3.4B **Testes cruzados e consolidação das quatro representações** (concluída):
    - **Suíte cruzada** `representations.test.ts` (70 testes, ≈ 2,5 s), com sementes fixas e comparação
      **estrutural** (independente de rótulos): quatro reconstruções de arestas escritas de formas diferentes; dois
      grafos (G1 orientado, G2 não orientado) com as quatro estruturas **calculadas à mão**; pesos nos quatro
      estados (sem peso, zero, positivo, negativo) conferidos nas duas listas e na matriz de adjacência (a matriz de
      incidência não precisa de pesos); invariantes (contagens, 2E, graus, papéis × sinais, ausência ≠ peso zero,
      ordem, identidades B·Bᵀ); 200 grafos pseudoaleatórios por orientação; independência de objetos; **sequências de
      operações válidas e inválidas** (100 sementes × 80 passos por orientação) comparadas com um modelo
      independente (códigos de erro previstos, ids não consumidos, operação sem efeito devolve o mesmo grafo);
      controles negativos (15 corrupções acusadas).
    - **Mutação só na suíte cruzada:** 40 mutações nos quatro módulos, todas detectadas.
    - **Medição em processos isolados** (Node, um processo por estrutura e tamanho): tabela comparativa e ressalvas em
      `ARCHITECTURE.md`. Não define limite do aplicativo.
    - **Consolidação:** `index.ts` reagrupado por assunto (50 nomes antes e depois, sem duplicados) e `completeGraph`
      unificado em `test-helpers.ts` (havia 3 cópias).
- ✅ 2.4 **Incremento 4 — persistência** (concluído; cada etapa só começou com autorização):
  - ✅ 4.1 **Serialização** (`serialization.ts`): `serializeGraph(graph, { pretty? })` produz o JSON canônico do esquema
    v1: chaves em ordem fixa, arrays na ordem de inserção, `weight` só quando existe (sem peso, zero e negativo ficam
    distintos), contadores `nextVertexSeq`/`nextEdgeSeq` gravados como estão (ids removidos não são reaproveitados),
    sem estado de interface. Arquivos de referência em `golden/v1/`. Não valida: exige um `Graph` válido. Formato,
    versionamento e custo em `ARCHITECTURE.md`.
  - ✅ 4.2 **Desserialização e validação** (`deserialization.ts`): `parseGraph(input: unknown, options?)` e
    `parseGraphJson(text: string, options?)` devolvem `Result<Graph>` e nunca lançam. Fronteira de dados não
    confiáveis: só o esquema v1; recusa campos ausentes e desconhecidos, versão desconhecida, ids não canônicos ou
    repetidos, extremos inexistentes, laços, arestas repetidas, pesos inválidos, rótulos que exigiriam normalização e
    contadores que não superam os ids presentes; preserva ids, contadores, ordem e a diferença entre sem peso e peso
    zero. Leitura defensiva (sem getters, `[[Get]]` nem `Object.assign`; proxies e `__proto__` tratados), resultado sem
    referências compartilhadas com a entrada, limites configuráveis `maxVertices`/`maxEdges`/`maxTextLength` sem
    valor padrão no domínio. Erros novos: `INVALID_DOCUMENT { path, reason, cause? }` e `UNSUPPORTED_SCHEMA_VERSION`.
    Ida e volta com a serialização, quatro representações e propriedades de grau conferidas; 71 mutações dirigidas
    detectadas. Regras, erros, limitações e custo em `ARCHITECTURE.md`.
  - ✅ 4.3 **Consolidação e compatibilidade**: `persistence-contract.test.ts` (contrato entre `serializeGraph` e
    `parseGraph`/`parseGraphJson` sobre 31 grafos: formato v1 conferido por verificador à parte, distinção por aspecto,
    25 histórias de 12 gerações de editar/salvar/reler idênticas às que nunca foram salvas, determinismo sem relógio,
    sorteio, ordenação nem localidade, nada corrigido em silêncio) e `public-api.test.ts` (lista exata dos 32 valores
    exportados, helpers internos privados, assinaturas e vocabulário de erros fixados pelo `tsc`). **Compatibilidade de
    versões:** documentos fictícios da v2 (aditivo e reestruturado) são `UNSUPPORTED_SCHEMA_VERSION`, a versão vence
    qualquer outro defeito, sem migração silenciosa nem grafo parcial. Arquivos de referência de `golden/v1/` tratados
    como contrato (inventário fixado; conteúdo exato conferido em três lugares, sem hashes). Documentação: resumo do
    contrato do domínio, tipos de entrada × garantias (Proxy executa armadilhas; não é sandbox), limite técnico ×
    limites de produto, responsabilidades da camada de persistência e estratégia de migrações (não implementada) em
    `ARCHITECTURE.md`. Sem mudança de API nem de comportamento; `randomOperation`/`randomHistory` foram extraídos
    para `test-helpers.ts`.
- Critério: `npm test` cobre o domínio e passa sem nenhum import de React Native. **Atendido** (ver 4.3).

**Custos das representações** (V = vértices, E = arestas, d(v) = grau; análise teórica; as medições pontuais em Node
estão em `ARCHITECTURE.md`):

| Estrutura | Construção | Espaço | Vizinhos de v | Existe a aresta (u,v)? |
| --- | --- | --- | --- | --- |
| Lista de arestas (o próprio `Graph`) | — | Θ(V + E) | O(E) | O(E) |
| Lista de adjacência | Θ(V + E) | Θ(V + E) (2E entradas no não orientado) | O(d(v)) | O(d(u)) |
| Matriz de adjacência | Θ(V²) | Θ(V²) (2E células ocupadas no não orientado) | O(V) | O(1) após o índice id → posição, Θ(V) |
| Lista de incidência | Θ(V + E) | Θ(V + E) (2E entradas) | O(d(v)) | O(d(u)) (varrer as incidências de u) |
| Matriz de incidência | Θ(V + V·E) (Θ(V·E) se E ≥ 1) | Θ(V + V·E) (só 2E células não nulas) | O(E + d(v) · V) (a linha dá as arestas; cada coluna dá a outra ponta) | O(E) (comparar as linhas de u e v) |

A etapa 3.4B registrou a tabela comparativa e as medições em `ARCHITECTURE.md`; limites de tamanho para a interface
só depois de medir em Hermes e em Android com poucos recursos (tarefa 4.6).

## Fase 3 — Editor visual de grafos (canvas touch-first) 🔄 (3.0 a 3.7 concluídos; os demais aguardam autorização)

Só os incrementos 3.0 (infraestrutura), 3.1 (câmera pura), 3.2 (`GraphLayout` puro), 3.3 (geometria das arestas e
hit-testing puros), 3.4 (núcleo de edição, histórico e store Zustand), 3.5 (renderizador SVG somente leitura e exemplo no
Laboratório), 3.6 (modo Adicionar vértice, toque no canvas e desfazer/refazer) e 3.7 (modo Conectar) foram feitos; **já é possível criar grafos completos tocando no canvas, mas ainda não selecionar, editar, excluir, arrastar, ampliar nem deslocar**. Cada incremento só começa com autorização, termina com `npm run check`, mutação dirigida
quando houver regra nova e uma mensagem de commit. Tamanhos: **S** (um módulo puro e seus testes) e **M** (lógica +
interface). Ordem como no prompt mestre: renderizar, criar, conectar, selecionar; **depois** arrastar, deslocar e
ampliar, em incrementos separados.

**Princípios**
- **`Graph` e `GraphLayout` separados.** `GraphLayout = { graphId, positions: Record<VertexId, { x, y }> }` em
  **coordenadas de mundo**, indexado pelo id estável do vértice e ligado ao `graph.id` dono; não entra no `Graph` nem no
  documento v1. Posição e câmera nunca mudam um resultado matemático.
- **Mundo ≠ tela.** Toda conversão passa por `worldToScreen`/`screenToWorld`. O tamanho de toque é em **dp de tela**
  (alvo ≥ 48 dp) e independe do zoom; o hit-testing opera em coordenadas de tela convertidas.
- **Lógica pura fora de componentes e de stores.** Câmera, layout, geometria, hit-testing, transições do editor e
  histórico vivem em `src/features/graph-editor/core/**`: TypeScript puro, sem React, React Native, Expo nem Zustand
  (mesma regra de ESLint do domínio) e testado em Node. A store Zustand só **chama** essas funções e guarda o estado;
  os componentes só desenham e traduzem gestos em ações.
- **Fonte da verdade = `{ graph, layout }` imutáveis.** As quatro representações **não** são guardadas: derivam do
  `graph` sob demanda (já são puras, Fase 2).
- **Erros do domínio viram mensagens em português** em um único módulo (`GraphError` → texto), testado.
- **Renderizador atrás de interface** (`GraphRenderer`), para trocar `react-native-svg` por Skia sem tocar nas camadas
  de baixo.
- **Gestos por modo explícito** (Selecionar / Adicionar vértice / Conectar), para reduzir conflito; a decisão do que
  um toque significa é uma função pura `(modo, ponto, camada) → ação`.
- **Histórico por instantâneos** `{ graph, layout }` (imutáveis, compartilham o que não mudou), **com contadores de
  ids monotônicos e independentes dos instantâneos** (decisão corrigida no 3.0; detalhes em `ARCHITECTURE.md`, "IDs e
  histórico"): desfazer uma criação **não** libera o id, refazer restaura o **mesmo** id, operação nova depois de
  desfazer descarta o ramo de refazer, e ao desfazer/refazer o estado de destino herda os contadores do estado atual
  (sem alterar o domínio). *A versão anterior deste texto dizia que desfazer restaurava os contadores; isso reabriria um
  id já emitido e foi **revogado**.* O rótulo padrão sai do contador (A, B, D depois de desfazer C); reaproveitar rótulo
  livre é decisão separada (3.4/3.6). Passo que não muda nada (`set*` devolve o mesmo grafo) não é registrado; um
  arrasto inteiro é **um** passo; limite de 100 passos; o histórico não é persistido nesta fase. A câmera e a seleção
  ficam fora do histórico.
- **Um detector no canvas e hit-testing no núcleo puro** (achado do 3.0): gestos por elemento SVG exigem `onPress` no
  elemento e um hook por vértice; o editor não os usa (ver `ARCHITECTURE.md`, "Gestos sobre elementos SVG").

**Pontos a decidir antes de começar** (recomendação em negrito)
1. ✅ **Expo Go × development build** (decidido no 3.0): as quatro bibliotecas rodam no Expo Go 58.0.5 (emulador
   `Pixel_6`, Android 13); **sem development build por ora**. Continua não confirmado se o Expo Go da SDK 58 já está nas
   lojas (o emulador recebe a versão certa do Expo CLI); no iOS ficaria o TestFlight da doc.
2. ✅ **Onde mora o código puro do editor** (decidido no 3.0): **`src/features/graph-editor/core/` com regra de ESLint e
   projeto Jest `editor-core` em Node próprios**. `src/domain/layout/` foi descartado (mistura posição visual com o
   domínio matemático).
3. **Orientação do grafo no editor:** **escolher ao criar o grafo ("Novo grafo": orientado ou não) e não oferecer troca
   depois** (a decisão 7 já adiou `setDirected`: orientado → não orientado pode gerar arestas repetidas) × implementar
   `setDirected` no domínio com tratamento de conflitos.
4. **Bottom sheet:** `@expo/ui` BottomSheet × componente próprio com `Modal`/`Animated`; decidir na 3.8 depois de ler a
   doc da SDK vigente (pergunta em aberto desta página).
5. **Rótulos no SVG:** `Text` do `react-native-svg` × `Text` do React Native sobreposto. O primeiro não acompanha o
   tamanho de fonte do sistema; **decidir na 3.5 com um teste no emulador a 200 % de fonte**.
6. ✅ **React Compiler × worklets** (avaliado no 3.0): sem conflito na transformação do Babel nem no emulador; fica
   ligado. A documentação do Reanimated/Worklets consultada não trata do compilador; reavaliar na 3.9 (arrasto com
   valores compartilhados) e usar `'use no memo'` por arquivo se necessário.
7. **Limite de legibilidade das matrizes no painel** (provisório, ≈ 40 vértices): é de legibilidade, **não** de
   desempenho; o limite de produto continua dependendo da medição em dispositivo (tarefa 4.6).

**Incrementos**

- ✅ **3.0 Dependências e infraestrutura** (S). Instalados com `npx expo install` (versões da SDK 58, sem alterar
  nada além disso): `react-native-svg` 15.16.0, `react-native-gesture-handler` 3.3.0, `react-native-reanimated` 4.7.1 e
  `react-native-worklets` 0.13.0. **`zustand` não foi instalado no 3.0** (entrou no 3.4, versão 5.0.16). `GestureHandlerRootView` no
  layout raiz; ESLint e projeto Jest `editor-core` para `src/features/graph-editor/core`; ambiente de testes de SVG,
  gestos e Reanimated (resolver, `jestSetup`, mock de `getUIRuntimeHolder`, `testTimeout` de 30 s por causa do cache
  frio); especificação do `GraphLayout`; **correção da decisão de IDs e histórico**; achado sobre gestos em SVG. Versões
  e a divergência da doc do Gesture Handler (3.3.x × RN 0.88) investigadas e **documentadas sem mexer nas
  dependências**: `ARCHITECTURE.md`, "Editor visual (Fase 3): fundação".
  - *Verificado:* `expo install --check` e `expo-doctor` (20/20) limpos; `npm run check` verde; no emulador `Pixel_6`
    (Expo Go 58.0.5) o app real navega com a raiz de gestos e uma tela de teste **descartada** (fora do commit) provou
    `Svg`, toque, arrasto com Reanimated e `scheduleOnRN`. **Não verificado:** iOS, aparelho físico, TalkBack, pinça,
    development build.
  - *Testes:* `core/boundary.test.ts` (fronteira do núcleo e do domínio por ESLint real, imports relativos, alias) e
    `native-stack.test.tsx` (SVG, gestos e Reanimated no Jest); mutação dirigida de `eslint.config.js` e `jest.config.js`.
  - *Commit:* `chore(editor): add svg, gesture handler, reanimated and worklets, and the pure editor core boundary`

- ✅ **3.1 Sistema de coordenadas e câmera** (S, `core/camera.ts`). `Camera = { x, y, scale }` com
  `tela = mundo · scale + (x, y)`: `(x, y)` é onde a origem do mundo aparece, **em dp** (unidades lógicas do React
  Native, não pixels físicos); X para a direita e Y para baixo nos dois espaços; escala uniforme, sem rotação; câmera
  neutra `{ 0, 0, 1 }`. Funções puras e **O(1)**: `worldToScreen`, `screenToWorld`, `zoomAt(camera, focus, factor,
  limits?)` (o ponto sob o foco não sai do lugar; a translação usa a **razão efetiva** depois da limitação, não o fator
  pedido), `panBy`, `centerOn`, `fitToBounds(camera, bounds | undefined, viewport, { margin?, limits? })`,
  `clampScale` e `isValidCamera`; limites padrão provisórios 0,25 a 4. Casos degenerados: argumentos inválidos ou
  estouro devolvem **a própria câmera (mesma referência)**; grafo sem vértices → câmera neutra; um vértice → escala 1
  limitada, no centro; linhas (largura ou altura zero) → escala do outro eixo; limites que impedem o enquadramento
  completo → escala válida e conteúdo centrado, que pode exceder o viewport; nunca `NaN`, `Infinity` nem `-0`.
  Convenções, fórmulas, tabela de casos e complexidade em `ARCHITECTURE.md`, "Câmera". **Não há gestos nem
  interface ligados a ela.**
  - *Testes:* 145 novos em `core/camera.test.ts` (conversões à mão, zoom/pan/centralização/enquadramento, degenerados,
    entradas inválidas, imutabilidade e propriedades com sementes fixas); total do projeto 1416. Mutação dirigida: 46
    mutações de `camera.ts`, 44 detectadas e 2 equivalentes (defesas redundantes de propósito).
  - *Commit:* `feat(editor): add pure camera transforms`

- ✅ **3.2 `GraphLayout` e posicionamento automático** (S, `core/layout.ts`; importa `Point` e `Bounds` de `camera.ts` e
  `Graph`/`VertexId` de `@/domain/graph`). `GraphLayout = { graphId, positions }`, em coordenadas de mundo, chaves = ids
  técnicos (nunca rótulos), independente da câmera. **Ajuste da especificação do 3.0:** o layout carrega o `graphId` do
  grafo dono (todo grafo tem `v1`, `v2`…; sem dono, o layout se aplicaria em silêncio a qualquer outro grafo). `positions`
  é um objeto **sem protótipo e congelado**, assim como o layout e cada ponto (ids como `__proto__` ou `toString` são
  chaves comuns). Funções puras, nenhuma lança: `emptyLayout`, `positionOf`, `placeVertex` (acrescenta; se o vértice já
  tem posição, devolve o **mesmo layout** em vez de sobrescrever), `moveVertex` (só move quem já tem posição),
  `removePosition`, `boundsOf(layout): Bounds | undefined` (centros; Θ(V); `undefined` se vazio, para o `fitToBounds`),
  `circularLayout(graph, { spacing?, minRadius? })` e `reconcileLayout(graph, layout, { spacing? })`. Recusa = **mesma
  referência** (coordenada não finita, nada a mudar), como na câmera.
  - *Posicionamento automático:* `circularLayout` põe os vértices **na ordem de inserção** numa circunferência centrada
    na origem do mundo, o primeiro no topo, no sentido horário **da tela** (Y para baixo), com
    **`R = max(Rmín, espaçamento / (2·sin(π/n)))`** (a corda entre vizinhos vale `espaçamento`; a fórmula do arco,
    `espaçamento·n/2π`, deixaria vizinhos mais perto que o espaçamento). Padrão provisório 96 unidades de mundo; `n = 1`
    → origem; `n = 2` → `(0, ±48)`. Coordenadas **arredondadas a 3 casas**, com tolerância explícita de 0,003 na distância
    entre vizinhos; **sem promessa de resultado idêntico bit a bit entre V8 e Hermes**.
  - *Reconciliação:* `reconcileLayout` descarta órfãs; **preserva exatamente** as posições dos vértices que existem (mesmo
    que se sobreponham); layout de **outro grafo** não é reaproveitado (vira o `circularLayout` do grafo recebido);
    layout vazio ou sem posição aproveitável → `circularLayout`; parcial → cada vértice novo, na ordem de inserção, vai
    à primeira posição livre em **anéis concêntricos** ao redor do centroide dos preservados, a ≥ `espaçamento` de todas as
    ocupadas, com busca limitada e fallback; idempotente (sem nada a fazer, devolve o próprio layout). Sem forças.
  - *Complexidade real:* `positionOf` O(1); `placeVertex`/`moveVertex`/`removePosition` **Θ(V)** (cópia do objeto de
    posições, layout imutável); `boundsOf` e `circularLayout` Θ(V); `reconcileLayout` Θ(V) sem vértices novos, típico
    Θ(V + K·V) e **pior caso O(K·V²)** (cada candidato é comparado com todas as ocupadas; sem índice espacial).
  - *Integração com a câmera:* `fitToBounds(camera, boundsOf(layout), …)` enquadra o círculo com margem; como `boundsOf`
    cobre **centros** e a margem é em dp, a interface (3.5) deve **expandir os limites pelo raio visual, em unidades de
    mundo**, antes de enquadrar; com muitos vértices a escala mínima da câmera deixa o conteúdo exceder o viewport.
  - *Limitações:* sem persistência (3.13), sem layouts por força ou por camadas, sem desfazer sobreposição de posições
    existentes; cópia Θ(V) por atualização (o arrasto deve confirmar **uma** vez no fim do gesto, não a cada quadro);
    coordenadas ≈ 10³⁰⁸ garantem finitude, não espaçamento. Detalhes em `ARCHITECTURE.md`, "`GraphLayout`".
  - *Testes:* 102 novos em `core/layout.test.ts` (1, 2, 3 e 4 vértices calculados à mão, raio por corda, ordem de
    inserção com ids em lacunas, rótulos repetidos, grafos orientados/desconexos/com isolados, órfãs, parcial, outro grafo
    com ids coincidentes, coordenadas negativas e inválidas, posições sobrepostas, ordem dos anéis conferida por
    reimplementação independente, ids `__proto__`/`constructor`/`toString`, imutabilidade, determinismo sem
    `Math.random`/`Date.now`, 600 casos com sementes fixas e integração com a câmera); total do projeto **1518**. Mutação
    dirigida: 68 mutações de `layout.ts`, 67 detectadas e 1 **equivalente** (consultar `positionOf` sem `hasOwnProperty`
    é indiferente porque o objeto de posições não tem protótipo; a consulta própria fica como defesa em profundidade).
  - *Commit:* `feat(editor): add GraphLayout and deterministic placement`
- ✅ **3.3 Geometria das arestas e hit-testing** (M, `core/geometry.ts`; só TypeScript puro, sem SVG, gestos, store,
  histórico nem telas). Entradas: o `GraphLayout` do 3.2 (posições por id técnico, em mundo) e a câmera do 3.1.
  - *3.3A, geometria (mundo):* `edgeGeometry(graph, layout, edgeId, opções?)` e `edgeGeometries(graph, layout, opções?)`
    devolvem **dados** (`LineSegment`, `QuadraticCurve`, `Arrowhead`, `labelAnchor`, `edgeId`, `sourceId`, `targetId`), nunca
    elementos de biblioteca visual. Reta **de borda a borda** (raio visual 20, configurável), nunca pelos centros; peso
    ancorado no ponto médio. Grafo orientado: ponta de seta (comprimento 12, meia-largura 5, configuráveis) **na borda do
    destino**, base recuada, comprimento limitado ao traço visível. **Arcos opostos** (A → B e B → A) viram **curvas de
    Bézier quadráticas**, cada uma para a **sua direita** na tela (lados opostos, independente da ordem de inserção),
    com controle `C = M + n·(0,3·d)` e extremos radiais nos círculos; aresta sem oposto continua reta. Vértices a ≤ 2r,
    ponta sem posição, layout de outro grafo ou aresta inexistente → **sem geometria** (`undefined`/fora da lista); nada
    é movido nem reconciliado. Fórmulas e exemplos em `ARCHITECTURE.md`, "Geometria das arestas e hit-testing".
  - *3.3B, hit-testing (tela, dp):* `hitTestVertex`, `hitTestEdge` e `hitTest` (`'vertex' | 'edge' | 'background'`).
    Vértice: raio de toque `max(24 dp, raio visual · escala)` (alvo ≥ 48 dp em qualquer zoom), menor distância ao centro,
    empate → ordem de inserção. Aresta: distância ao **segmento** (reta) ou à **curva de Bézier** (poligonal de 24 segmentos,
    erro ≤ `|C−m|/(2N²)`), tolerância de **12 dp** (provisória), empate → ordem de inserção; **toque na área de vértice nunca
    seleciona aresta**. `undefined` só para entrada inválida (câmera, toque, layout de outro grafo).
  - *Aceite (critério da fase):* **depois de zoom e pan, tocar acerta o elemento esperado** (propriedade com sementes fixas
    sobre câmeras de escala 0,25, 1 e 4 e translações positivas e negativas); a tolerância é em dp, não em unidades de mundo;
    vértices sobrepostos desempatam por distância e depois por ordem de inserção; toque no vazio é fundo; aresta só é
    acertada fora dos vértices.
  - *Complexidade:* uma aresta Θ(E); todas Θ(V + E) (índice temporário de arcos, sem busca por aresta); `hitTestVertex`
    Θ(V); `hitTestEdge` Θ(V + E + C·N) (pior caso Θ(V + E·N)); `hitTest` Θ(V) se acerta vértice. Sem índice espacial.
  - *Limitações:* constantes provisórias (raio 20, seta 12/5, curvatura 0,3, alvo 48 dp, tolerância 12 dp, 24 amostras); a
    curva pode roçar círculos muito próximos; o alvo mínimo engole arestas curtas com zoom afastado; peso e rótulo não são
    alvos de toque; cada consulta de aresta refaz as geometrias (guardar o resultado se for chamada a cada quadro).
  - *Testes:* 120 novos em `core/geometry.test.ts` (reta horizontal, vertical e diagonal 3-4-5 à mão; seta; arcos opostos
    com valores de uma reimplementação independente; distância a segmento e a curva; matriz de câmeras; prioridade, empates e
    cruzamentos; integração com `circularLayout` e `reconcileLayout`; 500 casos de geometria e propriedades de zoom e pan com
    oráculo denso); total do projeto **1638**. Mutação dirigida: 77 mutações de `geometry.ts`, 70 detectadas e 7
    **equivalentes** (defesas redundantes de propósito; lista em `ARCHITECTURE.md`).
  - *Preparação para o 3.5:* o renderizador consome `edgeGeometries` com as **mesmas** opções do hit-testing e
    converte com `worldToScreen`; para enquadrar, expande os limites de `boundsOf` pelo raio visual.
  - *Commit:* `feat(editor): add edge geometry and hit testing`

- ✅ **3.4 Núcleo do editor, histórico e store** (M; só TypeScript puro e Zustand; sem telas, SVG, gestos nem animação).
  Dois blocos internos, cada um terminado com `npm run check`.
  - *3.4A, núcleo puro* (`core/editor.ts`, `core/error-messages.ts`): `applyAction(estado, ação) → { state, error? }` sobre
    `{ graph, layout, selection, mode, history, error? }`. Ações: `add-vertex`, `connect`, `remove-selection`, `set-label`,
    `set-weight` (`undefined` remove), `move-vertex` (posição **final**, um passo), `select`, `clear-selection`, `set-mode`
    (`select | add-vertex | connect`), `undo`, `redo`, `clear-error`. Três resultados sem campo extra: **aplicada**, **sem
    efeito** (o mesmo objeto de estado, nada no histórico) e **recusada** (só o `error` muda; o erro do domínio vem intacto
    em `error.error`; grafo, layout, histórico e contadores são os mesmos objetos). Adicionar vértice é **atômico**
    (`addVertex` + `placeVertex`) e uma recusa não consome id. `graphErrorMessage` e `editorErrorMessage` dão texto em
    português para cada código, sem copiar o que o aluno digitou nem mostrar ids.
  - *Política de rótulos:* sem rótulo informado, o **menor** de A, B, …, Z, AA, AB, … que nenhum vértice usa é passado
    explicitamente a `addVertex`: A, B, C → desfazer C → novo vértice **`v4` com o rótulo `C`** (o contador do domínio
    daria `D`; o domínio não mudou). Rótulo se reaproveita, id nunca; rótulos do aluno contam como usados e duplicados
    informados continuam permitidos.
  - *Histórico e contadores:* instantâneos `{ graph, layout }` só; entra um por operação que **muda** grafo ou layout
    (recusadas, sem efeito, seleção, modo e limpar erro não entram); nova operação **descarta** o refazer; limite padrão
    **100** (configurável de 1 a 1000, inválido vale o padrão). Ao desfazer ou refazer, o grafo restaurado recebe **o
    maior de cada contador** (`nextVertexSeq`, `nextEdgeSeq`, independentes) entre o do instantâneo e o do estado atual:
    refazer devolve a mesma entidade com o mesmo id, e uma operação nova depois de desfazer emite um id novo, acima de todos
    os já emitidos. Uma cópia rasa de objeto comum; o domínio não mudou. A seleção é por id e é limpa se o elemento sumiu; o
    erro transitório não é restaurado.
  - *3.4B, Zustand* (`graph-editor/editor-store.ts`, **`zustand` 5.0.16**, `npx expo install zustand`):
    `createEditorStore(options)` (`zustand/vanilla`, uma store por sessão) com `{ editor, dispatch, reset }` e seletores;
    `dispatch` delega a `applyAction` e só grava se o estado mudou (o Zustand notifica a cada `setState`, então a guarda é da
    store). Sem regra duplicada, sem React, SVG, Gesture Handler nem Reanimated; o hook (`useStore`) vem com o 3.5.
  - *Complexidade:* adicionar vértice Θ(V), conectar Θ(E), remover Θ(V + E), rótulo e mover Θ(V), registrar Θ(L),
    desfazer e refazer Θ(L + V + E) (L = limite). Os instantâneos compartilham objetos imutáveis, mas o histórico ocupa
    Θ(L · (V + E)) referências no pior caso, não um valor constante; 100 passos é política inicial, não garantia de memória.
  - *Limitações:* o desfazer não restaura seleção, modo nem câmera; sem agrupar edições seguidas; histórico não persistido;
    o modo `connect` ainda não guarda a origem pendente (3.7); o arrasto contínuo não passa por `move-vertex`.
  - *Testes:* 141 novos (103 do núcleo, 17 das mensagens e 21 da store); total do projeto **1779**. Núcleo conferido contra um
    modelo de referência independente (250 passos × 30 sementes, com recusas intercaladas e as invariantes a cada passo).
    Mutação dirigida: 84 mutações, 83 detectadas e 1 **equivalente** (refazer sem o piso dos contadores, que o `future` já
    carrega). Detalhes em `ARCHITECTURE.md`, "Núcleo de edição e store".
  - *Commits sugeridos:* `feat(editor): add editor core, undo history and error messages` e
    `feat(editor): add zustand editor store`

- ✅ **3.5 Renderizador SVG somente leitura** (M). Três partes, cada uma fechada com `npm run check`. **Somente leitura:** sem
  gestos, seleção por toque, conexão manual, arrasto, zoom, pan nem SQLite; nenhum controle de edição foi criado.
  - *A. Cena pura* (`core/scene.ts`): `buildGraphScene(graph, layout, camera, options?) → GraphScene | undefined` devolve vértices
    (id, rótulo completo e exibido, centro, raio, `isolated`, `visible`), arestas (id, origem e destino, traço reta ou curva, seta, peso
    com âncora e caixa) e um **resumo acessível em português montado dos dados**, tudo em **dp de tela, com `worldToScreen` aplicado
    uma vez** (sem `viewBox` escalado nem `transform`). Reaproveita `edgeGeometries` (a geometria não é refeita no SVG).
    `fitCameraToGraph` enquadra os **círculos e os ápices das curvas**, com margem de 24 dp, só com área de desenho válida.
  - *B. Renderizador* (`graph-renderer.ts`, `svg-graph-renderer.tsx`; nomes em kebab-case, como o `CLAUDE.md` manda): só percorre
    a cena. Ordem: traços, setas, pesos, círculos, rótulos. **Só tokens do tema** (claro e escuro); direção na seta, peso no texto
    (peso `0` aparece, aresta sem peso não mostra número); a imagem leva o resumo e os elementos internos ficam escondidos dos
    leitores de tela. Rótulos longos truncados por pontos de código (estimativa; o texto **não é medido**).
  - *C. Integração:* `EditorStoreProvider` e `useEditorStore(selector)` (uma store por montagem, sem singleton); `example-graph.ts`
    (orientado: A → B sem peso, B → A peso 0, B → C −2, C → A 5, D isolado; **cada `Result` conferido**, só operações do domínio);
    tela Laboratório com estado vazio honesto, botão "Carregar exemplo" (usa o `reset` do 3.4: carrega grafo e layout novos, zera
    histórico, seleção e erro, modo `select`, sem posições de outro grafo), canvas medido por `onLayout` e câmera derivada. Novo
    `components/button.tsx`. A tela e `routes.test.tsx` trocam o texto antigo "Seu laboratório está vazio" por "Nenhum grafo carregado".
  - *Complexidade:* cena e enquadramento Θ(V + E); SVG com Θ(V + E) elementos; a cena é **refeita inteira** depois de uma alteração
    (sem atualização incremental) e não a cada quadro; carregar o exemplo Θ(1) mais o `reset`. Sem virtualização nem Skia.
  - *Android (emulador Pixel_6, Expo Go, temas escuro e claro; conferido por captura de tela):* o Laboratório abre; o botão funciona;
    os quatro vértices aparecem e D é visível; as setas apontam para o destino certo; os arcos opostos são curvas distintas; o peso `0`
    aparece e a aresta sem peso não mostra número; o conteúdo cabe no quadro; a navegação entre abas funciona e o grafo permanece; nenhum
    elemento importante some em nenhum tema. **Não verificado:** TalkBack, iOS, aparelho físico, outras larguras (só Jest), rotação,
    escala de fonte e desempenho com muitos vértices.
  - *Limitações:* texto não medido (estimativas de largura e centro vertical), peso e rótulo não selecionáveis, escala mínima deixa grafos
    enormes fora da área, câmera estática, sem estados de seleção ou de algoritmo.
  - *Testes:* 124 novos; total do projeto **1903**. Mutação dirigida: 70 mutações, 67 detectadas e 3 **equivalentes**. Detalhes em
    `ARCHITECTURE.md`, "Cena e renderização SVG".
  - *Commit:* `feat(editor): render graphs with react-native-svg`

- ✅ **3.6 Modo Adicionar vértice e toque** (M). Três partes, cada uma fechada com `npm run check`. **Só criar vértices:** sem conectar,
  selecionar por toque, arrastar, zoom, pan, editar pesos, SQLite nem algoritmos.
  - *A. Tradução pura do toque* (`core/tap.ts`): `tapToEditorAction(estado, câmera, ponto, viewport) → EditorAction | undefined`. Só cria
    com o modo `add-vertex`, dentro do quadro e quando o `hitTest` do 3.3 (o mesmo; nenhum hit-testing novo) responde `background`:
    toque em vértice, em aresta, fora do quadro, inválido ou cancelado não cria nada. A posição vem de `screenToWorld` (escala e
    translação uma vez cada). Pura e determinística; nada é alterado.
  - *B. Controles* (`components/tool-button.tsx`, `editor-controls.tsx`, `new-graph.ts`, `button.tsx` com variante): **Novo grafo não
    orientado / orientado** (API do domínio + `reset` da store: vazio, histórico, seleção e erro zerados, modo `add-vertex`, câmera
    neutra, sem herdar nada da sessão anterior; substitui o grafo atual sem confirmação), **Selecionar** (escolhível; o toque no
    quadro não faz nada até o 3.8), **Adicionar vértice**, **Conectar** (**desabilitado**, tracejado, "em breve", até o 3.7), **Desfazer** e
    **Refazer** (pelas ações do núcleo e por `selectCanUndo/selectCanRedo`; nenhum histórico na tela). Modo ativo identificado por
    "✓", fundo e `selected`, não só por cor. "Executar" não foi criado (não há algoritmos).
  - *C. Gesto e integração* (`canvas-tap-detector.tsx`, `lab-screen.tsx`): `useTapGesture` + `GestureDetector` do Gesture Handler 3.3.0,
    `runOnJS: true`, conclusão em `onDeactivate` (cancelado nunca edita), **um** detector no quadro e nenhum nos elementos do SVG,
    coordenadas **locais** (`x`, `y`; nunca `absoluteX/Y`) e `maxDistance` de 10 dp. A mensagem do quadro vazio fica dentro do quadro,
    com `pointerEvents: none`. **Câmera:** neutra no grafo novo, enquadrada uma vez no exemplo, e **nunca recalculada por edição**,
    desfazer, refazer ou troca de modo.
  - *Aceite:* o toque cria o vértice **sob o dedo** (escalas 0,25, 1 e 4 e translações conferidas em testes; no emulador, com a câmera
    neutra e com a enquadrada do exemplo, por capturas); rótulos A, B, C (menor rótulo livre, regra do 3.4); desfazer e refazer conforme o histórico; um novo vértice depois de
    desfazer **nunca** reaproveita o id (A, B, C → desfazer → `v4` com o rótulo C); mensagem instrutiva no estado vazio.
  - *Android (emulador Pixel_6, Expo Go, `adb input tap` reais, temas escuro e claro):* itens 1 a 14 do roteiro conferidos (abre, novo
    grafo nos dois tipos, A, B, vértice sob o toque, quadro parado, toque em vértice e em aresta não cria, desfazer, refazer, ramo novo,
    exemplo, legibilidade nos dois temas, navegação). **Três defeitos achados só no aparelho e corrigidos:** o quadro subia quando a
    mensagem do quadro vazio sumia; a marca "✓" era cortada; um deslize rápido sobre o quadro criava um vértice (padrão do Gesture
    Handler no Android sem limite de distância). **Não verificado:** TalkBack, iOS, aparelho físico, pinça, arrasto e multitoque (fora do
    incremento), outras larguras (só Jest), rotação, escala de fonte, toque longo, cancelamento por sair do quadro e desempenho.
  - *Complexidade:* tradução Θ(V + E·N) (hit-testing; N = 24); atualizar grafo e layout Θ(V); cena Θ(V + E); SVG Θ(V + E) elementos; tudo
    uma vez por toque (sem arrasto não há recálculo por quadro). Sem índice espacial.
  - *Limitações:* Selecionar não seleciona; Conectar desabilitado; câmera estática; novo grafo sem confirmação; texto do SVG não medido.
  - *Testes:* 117 novos; total do projeto **2020**. Mutação dirigida: 70 mutações, 68 detectadas (5 só depois de reforçar os testes) e 2 **equivalentes**. Detalhes em `ARCHITECTURE.md`, "Modo Adicionar vértice e toque".
  - *Commit:* `feat(editor): add vertex creation mode with undo and redo`

- ✅ **3.7 Modo Conectar** (M). Três partes, cada uma fechada com `npm run check`. **Só conectar:** sem arrasto, zoom, pan, edição de peso ou rótulo, seleção por toque, exclusão, SQLite
  nem algoritmos. Dois toques criam a aresta: A → B em grafo orientado, A—B em não orientado (a orientação é do `Graph`; a interface não tem regra de orientação).
  - *A. Máquina de estados pura* (`core/connect.ts`, `core/connect-status.ts`): `connectStep(origem pendente, alvo do hitTest, grafo) → { connection, action?, outcome }`. Sem origem, tocar em um
    vértice o escolhe (nenhuma ação, nenhum id, nenhum histórico); com origem, tocar em outro vértice pede `connect(origem, destino)` UMA vez e limpa a origem; tocar na própria origem, em aresta
    ou no fundo cancela (na própria origem, sem erro de laço); toque inválido não muda nada. `reconcileConnection` descarta a origem fora do modo ou sem o vértice. O `hitTapTarget`
    (validação e `hitTest` do 3.3) foi extraído de `tapToEditorAction` e é compartilhado. Não altera grafo nem layout, não cria aresta nem valida aresta (`addEdge` do domínio, pelo `applyAction`).
  - *B. Estado pendente e interface:* a store guarda `connection` (um id) e `connectNotice` ao lado do `EditorState` (fora do histórico, do `Graph`, do layout e do JSON v1), com `connectTap` e
    `cancelConnection`; `dispatch` e `reset` mantêm a origem coerente (trocar de modo, `reset`, origem removida por desfazer ou refazer). Conectar passou de "em breve" a ativo (desabilitado com
    menos de 2 vértices: legenda "2+ vértices" e dica acessível). Destaque da origem no SVG: anel tracejado e contorno de 4 dp (forma, não só cor). Linha de estado ABAIXO do canvas
    ("Origem: A. Toque no vértice de destino.", "Aresta criada de A para B." / "entre A e B.", recusa com o motivo do domínio, "Conexão cancelada."), com o botão Cancelar e região viva.
  - *C. Canvas:* o MESMO detector do 3.6 (`useTapGesture`, coordenadas locais, `maxDistance` 10 dp, cancelado não age); o modo escolhe o caminho do toque (Conectar → `connectTap`; os outros →
    `tapToEditorAction`), nunca os dois. A câmera não muda.
  - *Aceite:* uma conexão concluída é UM passo de histórico; recusa (duplicata, vértice inexistente) não cria passo nem gasta id, limpa a origem e mostra a mensagem em português; desfazer remove a
    aresta e refazer a devolve com o mesmo id; arco oposto em grafo orientado é aceito (duas curvas, uma seta cada) e B—A em não orientado é recusado; cancelar (próprio vértice, fundo, aresta,
    Cancelar, troca de modo, novo grafo, exemplo, origem removida) não muda grafo nem histórico; o canvas não se desloca quando a origem é escolhida.
  - *Prévia:* destaque da origem, instrução textual e cancelar. **Sem linha que acompanhe o dedo** (o detector reconhece toques, não o movimento do ponteiro).
  - *Android (emulador Pixel_6, Expo Go 58.0.5, `adb input tap` reais, temas escuro e claro):* os 18 itens do roteiro (A—B, desfazer e refazer, duplicata, os três cancelamentos, troca de modo,
    deslizes rápidos que não escolhem origem, A → B e B → A com as duas curvas, Adicionar vértice, exemplo com origem pendente, tema claro, abas). **Defeito real achado só no aparelho e corrigido:**
    a legenda "precisa de 2 vértices" do Conectar bloqueado quebrava em duas linhas, e ao sumir (no segundo vértice) a barra de modos encolhia ≈ 13 dp e o canvas subia no mesmo toque (A e B nasceram
    13 dp acima do dedo); agora a legenda tem uma linha ("2+ vértices") e a barra tem altura mínima fixa. **Não verificado:** TalkBack, iOS, aparelho físico, pinça, arrasto e multitoque (fora do
    incremento), outras larguras (só Jest), rotação, escala de fonte, toque longo e desempenho.
  - *Expo Go:* o aviso "Project is incompatible with this version of Expo Go" foi investigado: projeto SDK 58.0.21 e Expo Go 58.0.5 (mesma SDK); `expo install --check` e `expo-doctor` só apontam 7 divergências de
    patch e minor dentro da SDK 58 (19 de 20 verificações); o aviso não reapareceu em 3 aberturas. **Aviso transitório, causa não identificada**, sem incompatibilidade real; nada foi atualizado.
  - *Complexidade:* hit-testing Θ(V + E·N); escolher a origem O(1) mais Θ(V) para conferir o vértice; criar a aresta Θ(E) mais o passo de histórico Θ(L); a cena só é refeita (Θ(V + E)) quando o grafo muda,
    não ao escolher a origem; SVG Θ(V + E) elementos mais um anel. Sem índice espacial.
  - *Limitações:* sem linha dinâmica; aresta criada sem peso (3.8); Selecionar não seleciona; sem arrasto, zoom nem pan; "Novo grafo" sem confirmação; aviso do último toque some na próxima ação; instrução sem leitor de tela.
  - *Testes:* 121 novos; total do projeto **2141**. Mutação dirigida: 64 mutações, 63 detectadas (2 só depois de reforçar os testes) e 1 **equivalente**. Detalhes em `ARCHITECTURE.md`, "Modo Conectar".
  - *Commit:* `feat(editor): add vertex connection mode with source highlight`

- ⬜ **3.8 Modo Selecionar, propriedades e exclusão** (M). Toque seleciona vértice/aresta; toque longo abre a folha de
  propriedades (rótulo do vértice; peso da aresta, com vírgula decimal, "sem peso" ≠ 0); excluir **com confirmação**
  (diz quantas arestas somem junto). Decisão 4.
  - *Aceite:* rótulo vazio ou com mais de 64 pontos de código é recusado com mensagem; remover o peso deixa a aresta sem
    peso; `NaN` e `Infinity` são recusados; excluir vértice some com suas arestas e é desfeito de uma vez.
  - *Testes:* ações puras, conversão do texto numérico ("2,5", "-0", "abc", vazio), RNTL da folha e da confirmação.
  - *Commit:* `feat(editor): add selection, properties sheet and deletion`

- ⬜ **3.9 Arrastar vértices** (M). Arrasto no modo Selecionar move o vértice, **sem mover a câmera**; posição ao vivo em
  valor compartilhado do Reanimated (thread da interface) e gravada na store **ao soltar** (um passo de histórico).
  - *Aceite:* o vértice acompanha o dedo com zoom e deslocamento quaisquer; soltar fora da tela é tratado; cancelar o
    gesto restaura a posição; desfazer devolve a posição anterior.
  - *Testes:* conversão do deslocamento de tela em deslocamento de mundo (puro, com várias câmeras); histórico; manual.
  - *Commit:* `feat(editor): add vertex dragging`

- ⬜ **3.10 Deslocar e ampliar a câmera** (M). Arrasto no fundo desloca; pinça amplia em torno do ponto focal; botões
  **Centralizar** e **Ajustar ao grafo**; limites de escala; animação respeita "reduzir movimento".
  - *Aceite:* pan, pinça e arrasto de vértice **não se confundem** (um gesto, um dono); o ponto sob os dedos fica sob os
    dedos; depois de ampliar, os toques das tarefas 3.6 a 3.9 continuam acertando (testes de regressão com câmeras).
  - *Testes:* composição pura de gestos em câmera, regressão do hit-testing, manual (ver 3.14).
  - *Commit:* `feat(editor): add pan and pinch with fit and center`

- ⬜ **3.11 Painel das quatro representações** (M). Folha inferior com abas (lista de adjacência, matriz de adjacência,
  matriz de incidência, lista de incidência), **calculadas só enquanto o painel está aberto**, a partir do mesmo
  `graph`; três estados distintos nas células (sem aresta, aresta sem peso — marcada com "x", como em Boaventura &
  Jurkiewicz, §2.1, p. 19, e **nunca 1** — e peso, inclusive 0); decisão 7.
  - *Aceite:* editar o grafo com o painel aberto atualiza as quatro; sem peso, 0 e negativo ficam visíveis e
    distintos; a incidência mostra +1/−1 (orientado) e 1/1 (não orientado); grafos acima do limite de legibilidade
    mostram aviso em vez da matriz.
  - *Testes:* formatação pura (célula → texto), RNTL por aba, "o painel não calcula quando fechado".
  - *Commit:* `feat(editor): show the four graph representations on demand`

- ⬜ **3.12 Acessibilidade e telas pequenas** (M). Resumo do canvas e **camada acessível** (quando um leitor de tela está
  ativo): cada vértice e aresta vira elemento focável com rótulo ("Vértice A, grau 3") e ações (selecionar, conectar a…,
  editar, excluir); alvos ≥ 48 dp; fonte a 200 %; largura de 320 dp; "reduzir movimento"; foco devolvido à ação
  anterior depois de fechar a folha.
  - *Aceite:* é possível criar, conectar, editar e excluir **sem enxergar o canvas**, pelas ações do leitor de tela;
    nenhuma informação só por cor; a barra de modos e a folha cabem em 320 × 640 dp.
  - *Testes:* RNTL por papéis e rótulos, textos acessíveis gerados por função pura, contraste; manual com TalkBack
    (VoiceOver **não** testável neste ambiente).
  - *Commit:* `feat(editor): add accessibility layer and small-screen layout`

- ⬜ **3.13 Preparação para a persistência local** (S/M). `LayoutDocument` v1 (`schemaVersion`, `graphId`, posições por id)
  com `serializeLayout`/`parseLayout` (mesma disciplina de validação: nada corrigido, campos desconhecidos recusados,
  posições finitas, arquivos de referência escritos à mão); interface `GraphRepository` com **implementação em
  memória** e gravação automática com atraso; o editor só conhece a interface. **Sem SQLite** (Fase 5).
  - *Aceite:* sair do Laboratório e voltar restaura grafo e layout da sessão; documento do grafo (v1) e do layout
    são separados e ligados por `graphId`; o aviso de que **fechar o app perde tudo** continua visível até a Fase 5.
  - *Testes:* ida e volta e entradas inválidas do layout, contrato com o documento do grafo, autosave com relógio falso.
  - *Commit:* `feat(editor): add layout document and in-memory graph repository`

- ⬜ **3.14 Verificação manual e consolidação** (S). Roteiro em Android (emulador `Pixel_6` e, se possível, aparelho
  físico) e iOS (**pendente: sem macOS**); conflito pinça/arrasto/deslocamento, toque após zoom, TalkBack, tema escuro,
  fonte grande, rotação travada, grafo de 100 vértices e 300 arestas (fluidez medida no monitor de desempenho);
  `ARCHITECTURE.md` e este roadmap atualizados; Fase 3 marcada como concluída **somente** com os critérios atendidos.
  - *Commit:* `docs(editor): record phase 3 verification and decisions`

**Dependências entre incrementos:** o 3.0 (concluído) antecede todos. 3.1, 3.2 e 3.3 são independentes entre si
(módulos puros do `core`); 3.3 usa a câmera (3.1) e o layout (3.2) como entrada, então na prática vem depois deles; 3.4
depende de 3.2; 3.5 de 3.1 a 3.4; 3.6 a 3.8 dependem de 3.5 e de 3.3; 3.9 de 3.8; 3.10 de 3.9; 3.11 de 3.4; 3.12 de 3.8
e 3.10; 3.13 de 3.4. **Procedimento de teste em Android** (emulador, Metro, `adb`, limites do que se consegue
testar sem aparelho): `ARCHITECTURE.md`, "Procedimento de teste em Android".

**Riscos e o que fazer**

| Risco | Mitigação |
| --- | --- |
| Conflito entre pinça, deslocamento e arrasto | modo explícito; um dono por gesto (`Gesture.Exclusive`/`Race`, a confirmar na versão instalada); decisão pura testada; verificação manual na 3.14 |
| Toque errado depois de zoom/pan | hit-testing puro em coordenadas de tela, testado com matriz de câmeras (3.3) e regressão na 3.10 |
| Desempenho do SVG com muitos elementos | medir na 3.14; memoizar elementos; se não bastar, trocar pelo Skia atrás de `GraphRenderer` |
| Canvas inacessível a leitor de tela | camada acessível paralela (3.12) em vez de depender do SVG |
| Texto do SVG não acompanha a fonte do sistema | decisão 5 na 3.5 |
| Nomes e comportamento do Reanimated/worklets mudam entre versões | conferir na instalação (3.0) e não usar API de memória |
| Expo Go da SDK 58 não disponível | development build (decisão 1) |
| iOS não testável | registrado como pendente em cada entrega |

- Critério da fase: tocar depois de zoom/pan acerta o vértice esperado; os modos não se confundem; editar atualiza as
  quatro representações; desfazer/refazer é exato.

## Fase 4 — Representações na interface e limites ⬜

- ✅ 4.1 a 4.4 (lista e matriz de adjacência, matriz e lista de incidência com a convenção de sinais declarada, graus e
  propriedades) **já foram entregues no domínio na Fase 2** (incrementos 3.1 a 3.4B e 2.2); o painel básico entra na
  tarefa 3.11 da Fase 3.
- ⬜ 4.5 Refinar os painéis na interface (destaque do vértice selecionado nas estruturas, comparação entre estruturas),
  sempre derivados do mesmo `Graph`.
- ⬜ 4.6 **Matriz sob demanda e limite de tamanho:** calcular a matriz só quando o painel abrir, nunca a cada edição.
  O limite de vértices só será fixado **depois de medir em Hermes, em dispositivos Android com poucos recursos** (as
  medições em Node da etapa 3.2 — ≈ 8 bytes por posição, ≈ 70 MB em V = 3000 — não bastam). Evitar manter a
  matriz estrutural e a projeção numérica na memória ao mesmo tempo. Para a **incidência** o critério é o produto
  **V·E** (≈ 8 bytes por posição em Node: K250 = 7,8 milhões de posições ≈ 60 MB), não só o número de vértices.
- Critério: editar o grafo atualiza todas as representações; testes passam.

## Fase 5 — Tutorial básico e persistência ⬜

- ⬜ 5.1 `expo-sqlite` com migrações versionadas. ⬜ 5.2 Repositório de grafos (salvar/carregar). ⬜ 5.3 Rota "Meus grafos".
- ⬜ 5.4 Grafos de exemplo. ⬜ 5.5 Aula interativa "O que é um grafo?" (seis passos do prompt). ⬜ 5.6 Mini desafio com feedback. ⬜ 5.7 Progresso local.
- Critério: concluir a primeira aula sem instruções externas e recuperar o grafo ao reabrir.

## Fase 6 — Primeiro simulador (BFS) ⬜

- ⬜ 6.1 Contrato do rastro (`Trace`/`Step`) e controlador de simulação (iniciar, pausar, avançar, voltar, reiniciar, velocidade).
- ⬜ 6.2 BFS puro com desempate documentado e testes (orientado e não orientado).
- ⬜ 6.3 Modo **Executar**: fila, visitados, pseudocódigo, explicação por passo. ⬜ 6.4 Painel de complexidade (abstrata × da representação, tempo e espaço).
- Critério: resultado e cada quadro da animação verificáveis; avançar/voltar determinístico.

## Fase 7 — DFS e conexidade ⬜ → **MVP acadêmico**

- ⬜ 7.1 DFS (pilha/recursão visual). ⬜ 7.2 Componentes conexos; forte e fracamente conexos. ⬜ 7.3 Revisão de UX, bugs, acessibilidade e uso offline.

## Fases 8 a 13 (a refinar antes de iniciar)

| Fase | Escopo | Observação científica |
| --- | --- | --- |
| 8 | Kruskal, Prim, Dijkstra | Rejeitar pesos negativos (Dijkstra); floresta quando desconexo |
| 9 | Euler e Fleury | Variante não orientada primeiro; pontes do subgrafo remanescente |
| 10 | Planaridade e colorações | Sem alegar teste geral de planaridade; limites de tamanho |
| 11 | Bipartição, Hall, Método Húngaro | Húngaro = atribuição de custo mínimo |
| 12 | Ford-Fulkerson (Edmonds-Karp) | Rede residual, gargalo e corte mínimo |
| 13 | Desafios avançados, importar/exportar, E2E, tablet, builds | `expo-file-system`, `expo-document-picker`, `expo-sharing` (verificar suporte no Expo Go antes) |
