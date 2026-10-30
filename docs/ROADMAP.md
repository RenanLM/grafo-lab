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
| Repositório Git | A pasta não é um repositório. Rode `git init` antes do primeiro commit. |
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
- ⬜ 2.2 **Incremento 2:** grau (entrada, saída, total) e vizinhança (sucessores, predecessores, vizinhos); `setVertexLabel` e `setEdgeWeight`.
- ⬜ 2.3 **Incremento 3:** lista de adjacência e matriz de adjacência (ausência de aresta ≠ peso zero).
- ⬜ 2.4 **Incremento 4:** matriz de incidência com a convenção de sinais declarada para orientados e não orientados.
- ⬜ 2.5 **Incremento 5:** `serializeGraph` e `parseGraph(unknown)` validando todas as invariantes; testes de propriedade
  (Σ graus = 2·|E| no não orientado; Σ entrada = Σ saída = |E| no orientado).
- Critério: `npm test` cobre o domínio e passa sem nenhum import de React Native.

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
