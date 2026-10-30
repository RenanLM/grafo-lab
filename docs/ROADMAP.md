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
| Componente de bottom sheet | Decidir na tarefa 3.7 após ler a doc da SDK vigente (`@expo/ui` BottomSheet × alternativas). |

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

## Fase 2 — Modelo matemático 🔄

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
- ⬜ 2.4 **Incremento 4:** `serializeGraph` e `parseGraph(unknown)` validando todas as invariantes (inclusive a regra
  de rótulos); testes de propriedade (Σ graus = 2·|E| no não orientado; Σ entrada = Σ saída = |E| no orientado).
- Critério: `npm test` cobre o domínio e passa sem nenhum import de React Native.

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

## Fase 3 — Canvas touch-first ⬜

Dependências desta fase (via `npx expo install`): `react-native-svg`, `react-native-gesture-handler`,
`react-native-reanimated`, `react-native-worklets`, `zustand`. Todas listadas como incluídas no Expo Go da SDK 58.

- ⬜ 3.1 Instalar e configurar gesture-handler/reanimated; avaliar o React Compiler (ligado no template) com worklets.
- ⬜ 3.2 Câmera: `worldToScreen` / `screenToWorld` puros (zoom + pan) com testes.
- ⬜ 3.3 Store Zustand do editor (modo, seleção, câmera, layout) + histórico desfazer/refazer.
- ⬜ 3.4 Renderizador SVG atrás de uma interface (`GraphRenderer`) que permita trocar por Skia.
- ⬜ 3.5 Modo **Adicionar vértice** + hit-testing puro e testado.
- ⬜ 3.6 Modo **Conectar** com prévia e cancelamento.
- ⬜ 3.7 Modo **Selecionar**, toque longo (editar/excluir com confirmação), bottom sheet de propriedades.
- ⬜ 3.8 Arrastar vértices (sem mover a câmera).
- ⬜ 3.9 Pan e pinch no fundo; **centralizar** e **ajustar ao grafo**.
- ⬜ 3.10 Verificação manual de conflito pinch/pan/drag em Android e iOS.
- Critério: tocar depois de zoom/pan acerta o vértice esperado; os modos não se confundem.

## Fase 4 — Representações ⬜

- ⬜ 4.1 Lista de adjacência. ⬜ 4.2 Matriz de adjacência (orientação e pesos). ⬜ 4.3 Matriz de incidência com convenção de sinais declarada.
- ⬜ 4.4 Graus e propriedades. ⬜ 4.5 Painéis na UI (bottom sheet) sempre derivados do mesmo `Graph`.
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
