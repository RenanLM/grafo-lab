# GrafoLab — Prompt mestre para Claude Code

## Papel e missão

Você é um engenheiro de software sênior especializado em React Native, Expo, TypeScript, visualização interativa, algoritmos e aprendizagem de Teoria dos Grafos.

Desenvolva **GrafoLab**, um aplicativo educacional **nativo para Android e iOS**, em **português brasileiro**, pensado para universitários iniciantes em Teoria dos Grafos. A missão é permitir que um estudante **construa seus próprios grafos, entenda a matemática, execute algoritmos passo a passo, explore pseudocódigo e estruturas de dados, analise complexidade temporal/espacial e pratique exercícios com feedback**.

**Não construa o produto inteiro de uma vez.** Trabalhe em incrementos pequenos ou médios, testáveis e revisáveis. Não use mock visual para declarar um algoritmo funcional.

## Contexto acadêmico

A disciplina tem três unidades:

1. **Fundamentos (10 h):** conceitos, notação e terminologia; vértices, arestas, graus, vizinhança, caminhos, trilhas e ciclos; grafos orientados/não orientados; representações por lista de adjacência, matriz de adjacência e matriz de incidência.
2. **Problemas circulatórios (24 h):** percursos BFS e DFS, conexidade e componentes, árvores geradoras de custo mínimo, Kruskal, Prim, caminhos de custo mínimo, Dijkstra, trilhas eulerianas, Teorema de Euler e Fleury.
3. **Tópicos avançados (36 h):** planaridade, Kuratowski, coloração de arestas, Vizing, coloração de vértices, Quatro Cores, emparelhamentos bipartidos, Hall, Método Húngaro, fluxos em redes, Teorema e Algoritmo de Ford-Fulkerson.

Objetivos: conhecer a terminologia, implementar representações de grafos, simular algoritmos e analisar complexidade de tempo e espaço.

Referências, se efetivamente fornecidas ao repositório:
- *Grafos: Introdução e Prática*, Paulo Oswaldo Boaventura Netto e Samuel Jurkiewicz.
- *Algoritmos: Teoria e Prática* (2ª edição), Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest e Clifford Stein.

Inspecione os PDFs **somente se estiverem acessíveis**, use-os como referência conceitual, confira a seção antes de atribuir citações e **não copie páginas, exercícios completos ou imagens protegidas** para dentro do produto. Crie material didático original. Se as referências não estiverem presentes, registre essa limitação e use a ementa acima. Não invente páginas ou citações.

## Stack e restrições

- **React Native + Expo (managed/CNG quando necessário), TypeScript strict**.
- **Expo Router** para abas e rotas de detalhe, usando padrões de navegação suportados pela versão instalada.
- **react-native-svg** como renderizador inicial do grafo, com interfaces que permitam substituição futura por **@shopify/react-native-skia** sem reescrever domínio ou algoritmos.
- **react-native-gesture-handler** para toque, pan, pinch e arrasto; **react-native-reanimated** e react-native-worklets quando exigidos pela versão instalada.
- **Zustand** para estado de interação/editor; não coloque a matemática dentro de stores ou componentes React.
- **expo-sqlite** para grafos, sessões e progresso local; aplicar migrações versionadas quando o armazenamento for introduzido.
- **Jest com jest-expo + React Native Testing Library** para testes de domínio e componentes; considerar Maestro para E2E depois.
- **expo-file-system, expo-document-picker e expo-sharing** apenas quando implementar importação/exportação.
- Dependências e estilos: escolher abordagem enxuta, com componentes reutilizáveis, acessibilidade e suporte a temas claro/escuro; não instalar um design system pesado apenas por aparência.
- **Offline-first**, sem login, backend, serviços pagos, chave de IA ou internet obrigatória no MVP.
- Usar `npx expo install` para bibliotecas gerenciadas pelo Expo e verificar as versões, plugins e limitações de **Expo Go versus development builds** na documentação atual antes de instalar. Nunca fixar versões por suposição.

## Navegação e UX

Abas inferiores:
1. **Início** — continuar estudos, grafos recentes, progresso, atalhos.
2. **Aprender** — trilhas por unidade, aulas, exemplos e conceitos.
3. **Laboratório** — editor interativo, algoritmos, explicações e representações.
4. **Desafios** — exercícios e feedback.

Rotas secundárias: detalhe da aula, catálogo/detalhe do algoritmo, meus grafos, configurações e resultado de exercício. Em tablets, oferecer layout expandido; em celulares, priorizar o grafo e usar painéis inferiores deslizantes para propriedades, pseudocódigo, matrizes e execução.

**Padrões de interação no laboratório**:
- Barra contextual com os modos **Selecionar / Adicionar vértice / Conectar / Executar**; modo explícito reduz conflito entre gestos.
- No modo vértice: toque na área vazia cria um vértice.
- No modo conectar: toque no vértice de origem e depois no destino cria a aresta; exibir prévia da conexão e opção de cancelar.
- No modo selecionar: toque seleciona; arrastar move vértices, respeitando o pan do canvas; toque longo abre ações de editar/excluir.
- Pinça faz zoom; gesto no fundo desloca a câmera; oferecer **centralizar** e **ajustar ao grafo**.
- Editor de propriedades por bottom sheet: rótulo do vértice; peso/capacidade e sentido da aresta quando permitido.
- Desfazer/refazer ações; confirmar ações destrutivas; mensagens curtas e instrutivas.
- Feedback visual, sem depender só de cores; áreas de toque confortáveis e suporte a leitor de tela quando possível.
- Durante a simulação, bloquear edições estruturais ou solicitar reinício explícito. Mudar posição visual não deve mudar o resultado matemático.

**Atenção técnica crítica:** manter coordenadas do mundo (world coordinates) separadas de coordenadas de tela. Implementar conversão tela→mundo e mundo→tela para que a criação, seleção, arrasto e hit-testing funcionem corretamente após zoom/pan. Testar transformações, toques próximos e conflito pinch/pan/drag em Android e iOS. Dimensionar rótulos, setas, laços e arestas paralelas quando futuramente suportados. Usar IDs de aresta estáveis.

## Modelo de domínio e arquitetura

Separar estritamente três camadas:
1. **Domínio puro TypeScript**: grafos, validações, representação, algoritmos, rastros, complexidades e correção.
2. **Estado/orquestração**: ações do editor, histórico, execução da simulação, persistência e seleção.
3. **Apresentação nativa**: SVG/canvas, gestos, animações, telas, tutoriais e componentes.

Modelagem inicial sugerida (pode refiná-la justificadamente):

```ts
type Vertex = { id: string; label: string };
type Edge = {
  id: string;
  source: string;
  target: string;
  weight?: number;
  capacity?: number;
};
type Graph = {
  schemaVersion: number;
  id: string;
  name: string;
  directed: boolean;
  vertices: Vertex[];
  edges: Edge[];
};
type GraphLayout = {
  positions: Record<string, { x: number; y: number }>;
};
```

**O domínio não guarda a posição dos vértices como parte das relações matemáticas.** Suporte inicial a grafos simples; laços e arestas paralelas exigem suporte específico e testes, sobretudo nas matrizes e nos algoritmos. Definir claramente se a orientação é global ao grafo no MVP; não misturar arcos e arestas sem modelagem explícita. Peso e capacidade não são sinônimos.

Estrutura de referência, **criada gradualmente, somente quando necessária**:

```text
GrafoLab/
  app/                         # rotas Expo Router (ou src/app, conforme template)
    (tabs)/                    # início, aprender, laboratório, desafios
    lessons/
    algorithms/
    graphs/
  src/
    components/                # componentes de interface compartilhados
    domain/
      graph/                   # tipos, validações, representações
      algorithms/              # implementações puras
      simulation/              # tipos de rastros e motor de execução
    features/
      graph-editor/            # canvas, gestos, seleção, histórico
      graph-representations/   # matrizes e lista
      lessons/                 # conteúdo e tutoriais
      challenges/              # exercícios e validação
      progress/                # progresso local
    storage/                   # repositórios locais e migrações
    theme/
    test/
  assets/
  docs/
    ROADMAP.md
    ARCHITECTURE.md
  AGENTS.md ou CLAUDE.md
```

Respeitar a estrutura que já existir no template, sem forçar duplicação de pastas `app`.

## Motor de simulação passo a passo

Um algoritmo **não manipula SVG, estilos, timers nem componentes React**. Ele recebe uma instância imutável do grafo e parâmetros (por exemplo, origem), retorna resultado matemático e um **rastro determinístico de passos**. O controlador de simulação reproduz esse rastro, e a UI o renderiza.

Cada passo pode conter: identificador, linha de pseudocódigo, mensagem didática, vértices/arestas destacados, estruturas auxiliares e estado lógico necessário para reproduzir o quadro. Projete tipos extensíveis e evite snapshots gigantes em grafos grandes. Use desempates estáveis e documentados. A animação nunca é a fonte da verdade.

O aluno deve poder **iniciar, pausar, avançar, voltar, reiniciar e ajustar velocidade**. Exibir a fila/pilha/heap quando aplicável; distâncias, predecessores, componentes, conjunto de arestas escolhidas, capacidade residual ou cores conforme o algoritmo. Mostrar explicação do motivo de cada passo e o resultado final. A análise deve distinguir complexidade abstrata da complexidade derivada da representação/estrutura concreta utilizada, e incluir espaço auxiliar.

## Regras de correção científica

- BFS/DFS: respeitar orientação, componentes, ordem de vizinhos documentada, estado dos vértices e eventual origem selecionada.
- Conexidade: distinguir conexidade em não orientados de forte/fraca conexidade em orientados.
- Kruskal/Prim: exigir grafo não orientado e pesos válidos; quando desconexo, informar floresta geradora mínima ou rejeitar explicitamente; empates podem produzir árvores diferentes com mesmo custo.
- Dijkstra: rejeitar pesos negativos e explicar por quê; tratar vértices inalcançáveis e empates sem falsos resultados.
- Euler/Fleury: diferenciar caminho e circuito euleriano, conferir conectividade relevante e condições de grau; implementar inicialmente a variante **não orientada**, informando a limitação; Fleury considera pontes do subgrafo remanescente.
- Planaridade: cruzamentos do desenho não provam não-planaridade. Kuratowski trata subdivisões de K5/K3,3; não alegar um teste geral se apenas exemplos forem suportados.
- Vizing e Quatro Cores: apresentar como teoremas com suas condições; não dizer que coloração ótima de grafo arbitrário está trivialmente resolvida. Distinguir coloração própria de arestas/vértices.
- Hall: enunciar a condição para cobrir todos os vértices do lado escolhido da bipartição; não confundir com emparelhamento máximo genérico.
- Método Húngaro: modelar problema de atribuição de custo mínimo (com seus pressupostos), não apenas emparelhamento não ponderado.
- Ford-Fulkerson: distinguir capacidade e fluxo, conservar fluxo nos vértices intermediários, visualizar rede residual com arcos reversos, gargalo e atualização; optar por caminhos aumentantes via BFS (Edmonds-Karp) para implementação determinística, explicando a estratégia.
- Toda representação deve refletir a mesma instância de grafo, incluindo orientação e pesos quando pertinentes; a matriz de incidência precisa declarar convenções de sinais.
- Se determinado tema estiver disponível apenas como tutorial, marcar explicitamente **conteúdo teórico** em vez de **simulador implementado**.
- Para algoritmos avançados, estabelecer limites de tamanho da entrada quando exato for computacionalmente caro; não rotular heurística como resultado ótimo.

## Aprender e Desafios

Organizar aulas segundo as três unidades. Para cada aula: (1) objetivo, (2) definição informal, (3) definição matemática, (4) exemplo visual original, (5) interação guiada, (6) exemplo de aplicação, (7) pergunta curta e feedback, (8) resumo, (9) referência bibliográfica efetivamente conferida.

**Primeiro tutorial obrigatório: 'O que é um grafo?'**
1. Exibir um vértice e explicar seu papel.
2. Pedir que o aluno adicione dois vértices.
3. Pedir que conecte um par.
4. Identificar graus e vizinhos.
5. Mostrar a lista e a matriz de adjacência geradas pelo mesmo grafo.
6. Propor um mini desafio com feedback.

Desafios com validação por critérios: múltipla escolha, identificação de propriedades, construção de grafo sob restrições, escolha do próximo passo do algoritmo e interpretação de complexidade. Nunca depender apenas de comparação de strings para validar soluções matemáticas. Não dar respostas antecipadamente: mostrar dicas graduais.

Progresso local: estado da aula, exercícios concluídos e tentativas; dispensar contas e sincronização nesta primeira etapa. Manter todo o conteúdo essencial offline.

## Roadmap e critérios de aceite

**Fase 0 — Diagnóstico e planejamento (sem grandes alterações):** inspecionar repositório, arquivos e bibliografia acessíveis, verificar ambiente e versões, produzir `docs/ROADMAP.md`, decisões de tecnologia e recorte do MVP.

**Fase 1 — Fundação mobile:** inicializar Expo + TypeScript + Expo Router; tema, navegação com quatro abas, safe areas, identidade inicial e tela de laboratório com estado vazio bem explicado. Critério: abre no Android, não apresenta rotas quebradas e passa no typecheck.

**Fase 2 — Modelo matemático:** tipos, funções de adicionar/remover vértices/arestas, validações e testes. Critério: funciona sem importar React Native.

**Fase 3 — Canvas touch-first:** SVG, criação de vértices, conexão entre vértices e seleção; depois drag, pan e pinch em incrementos separados. Critério: tocar depois de zoom/pan acerta o vértice esperado; modos não se confundem.

**Fase 4 — Representações:** lista e matriz de adjacência, matriz de incidência, graus, propriedades e bottom sheet. Critério: mudanças no grafo atualizam representações automaticamente; testes passam.

**Fase 5 — Tutorial básico e persistência:** aula 'O que é um grafo?', grafos de exemplo, salvar/carregar localmente. Critério: estudante conclui a primeira aula sem instruções externas e recupera o grafo ao reabrir.

**Fase 6 — Primeiro simulador (BFS):** contrato de trace, tela de execução, fila, visitados, controles e explicações. Critério: resultados e cada estado da animação são verificáveis; avançar/voltar é determinístico.

**Fase 7 — DFS e conexidade:** pilha/recursão visual, componentes, testes. **MVP acadêmico concluído** depois de rever UX, bugs, acessibilidade e uso offline.

**Fase 8 — Árvores e caminhos:** Kruskal, Prim e Dijkstra, validações e comparações.

**Fase 9 — Trilhas eulerianas:** condições de Euler, caminhos/circuitos e Fleury.

**Fase 10 — Planaridade e colorações:** exemplos de Kuratowski, verificações e demonstrações de teoremas, suporte a coloração válida, com limites explicitados.

**Fase 11 — Bipartidos:** bipartição, Hall, emparelhamentos e atribuição pelo Método Húngaro.

**Fase 12 — Fluxos:** Ford-Fulkerson com estratégia Edmonds-Karp, redes residuais e corte mínimo.

**Fase 13 — Consolidação:** desafios avançados, importação/exportação de grafos, compartilhamento, testes E2E, experiência tablet, acessibilidade e builds de distribuição.

Uma fase não precisa equivaler a um único commit. Divida em tarefas pequenas e médias, cada uma com critério de aceite e teste.

## Regras obrigatórias de colaboração com o Claude Code

1. Na primeira interação, **inspecione o repositório** antes de alterar qualquer arquivo. Se já existir um app, preserve a estrutura e não o reinicialize.
2. Confira a documentação e compatibilidade das versões do Expo, bibliotecas gráficas e gestos; diferencie explicitamente Expo Go de development build, sobretudo para a SDK escolhida.
3. Mostre antes de cada tarefa: objetivo, arquivos previstos, abordagem, riscos e critérios de aceite. Não instale dependências das fases futuras antecipadamente.
4. Faça uma **tarefa por vez**. Não implemente a fase seguinte automaticamente.
5. Teste o domínio com Jest; teste componentes com React Native Testing Library; use `npx tsc --noEmit` e `npx expo install --check` quando apropriado. Documente verificações que dependam de dispositivo físico e não puderam ser executadas no ambiente.
6. Evite acoplamento entre motores matemáticos, estado e UI. Prefira funções puras e composição de componentes, sem abstrações prematuras.
7. Não declare funcionalidades concluídas quando houver apenas telas ou animações falsas. Não crie métricas de desempenho sem medir.
8. Ao terminar, informe: alterações, arquivos, testes executados, resultado, como validar manualmente no Android/iOS, limitações e próximo passo.
9. Sugira uma mensagem de commit **em inglês** no padrão Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`). **Não execute commit ou push sem autorização.**
10. Mantenha `docs/ROADMAP.md` atualizado e registro curto das decisões arquiteturais relevantes. Toda documentação e texto visível ao aluno devem estar em português brasileiro.
11. Se surgir algo ambíguo e não bloqueante, escolha a opção simples e justifique. Se for bloqueante, faça uma pergunta objetiva.

## Primeira execução — faça agora

1. Inspecione o repositório, os PDFs realmente disponíveis e o ambiente de desenvolvimento.
2. Resuma a arquitetura proposta e eventuais adaptações necessárias.
3. Crie um roadmap com tarefas pequenas e ordem de execução.
4. Confirme a estratégia de testes e a diferença entre Expo Go e development build para as dependências escolhidas.
5. **Implemente somente a Fase 1**, caso o ambiente permita, sem criar o editor completo antes da hora.
6. Rode as verificações cabíveis e informe resultados reais.
7. Sugira o primeiro commit e a implementação seguinte, e **pare para revisão**.
