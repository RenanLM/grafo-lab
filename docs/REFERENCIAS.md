# Referências bibliográficas

Estado verificado em 30/10/2026. Só há citações conferidas para os trechos listados abaixo (Boaventura,
§2.1, p. 19–20). Regra do projeto: só citar capítulo/seção depois de abrir o trecho no PDF; nada é
copiado (texto, exercícios, figuras).
Todo o material didático do app é original. Os PDFs ficam apenas na máquina local (`/*.pdf` no `.gitignore`).

## Boaventura Netto & Jurkiewicz — *Grafos: Introdução e Prática* (Blucher, 2009)

- Arquivo de 172 páginas, **digitalizado como imagem, sem camada de texto**; não há busca nem extração
  automática (nem OCR instalado). Consulta é visual, página a página.
- O sumário (numeração romana ix–x) foi conferido visualmente e cobre toda a ementa:

| Cap. | Título | Seções relevantes para a ementa |
| --- | --- | --- |
| 1 | Primeiras ideias | 1.1 histórico · 1.2 o modelo · 1.3 modelos de grafo · 1.4 matemática discreta, computação e algoritmos |
| 2 | Conceitos básicos de grafos | 2.1 rotulação e representação · 2.2 conceitos importantes · 2.3 grafos especiais · 2.4 conexidade · 2.5 conectividade |
| 3 | Problemas de caminhos | 3.1 caminho mínimo · 3.2 algoritmos para caminhos mínimos · 3.3 localização · 3.4 caminho máximo |
| 4 | Problemas de interligação | 4.1 árvores e arborescências · 4.2 árvores e interligação · 4.3 árvore parcial de custo mínimo · 4.4 algoritmos gulosos · 4.5 complexidade |
| 5 | Subconjuntos especiais | 5.4 acoplamentos · 5.5 alocação linear, algoritmo húngaro |
| 6 | Problemas de coloração | 6.1 coloração de vértices · 6.2 coloração de arestas |
| 7 | Fluxos em grafos | 7.6 fluxo máximo · 7.7 teorema de Ford e Fulkerson · 7.8 grafo de aumento de fluxo |
| 8 | Ciclos e aplicações | 8.1 eulerianos não orientados · 8.3 eulerianos orientados · 8.5 hamiltonianos |
| 9 | Grafos planares | 9.1 definições · 9.2 teorema de Kuratowski · 9.4 problema das 4 cores |

- BFS e DFS **não aparecem como títulos de seção** no sumário; não atribuir a um capítulo sem localizar o trecho.
- **Offset calibrado:** página do PDF = página impressa + 10 (conferido: impressa 20 ↔ PDF 30, 23 ↔ 33, 24 ↔ 34).
- **Trechos conferidos** (leitura visual das imagens; sem OCR; resumo em palavras próprias):
  - Cap. 2, §2.1, **p. 19** — matriz de adjacência: uma ligação sem valor pode ser marcada com 1 (ou "x") e o
    exemplo da matriz sem valores escreve 0 nas posições sem ligação; na matriz **valorada** a casa recebe o valor
    da ligação e as posições sem ligação ficam em branco (o que separa ausência de peso zero).
  - Cap. 2, §2.1, **p. 20** — o livro considera só grafos sem laços; um grafo não orientado equivale ao orientado
    em que todo arco (i,j) tem o simétrico (j,i) (base da convenção sucessores = predecessores = vizinhos).
  - Cap. 2, §2.1, **p. 20** — matriz de incidência (letra **B**), vértice × ligação: no grafo orientado, o vértice
    de saída do arco recebe **1** e o de entrada **−1**; no não orientado, as duas posições recebem 1. A ordem
    das colunas não é obrigatória (o livro usa a ordem lexicográfica; o GrafoLab usa a ordem de inserção). Aplicada em `incidenceMatrix` (etapa 3.3).
  - O livro também descreve a incidência para p-grafos (colunas repetidas para ligações paralelas); o GrafoLab
    só modela grafos simples.

## Cormen, Leiserson, Rivest, Stein — *Algoritmos: Teoria e Prática* (2ª ed., trad. Campus/Elsevier)

- Arquivo de 239 páginas com camada de texto, mas é um **extrato**: Parte I (cap. 1–5), Parte II (cap. 6–9),
  a Parte III só como página de título, e o Apêndice A–B. **Os capítulos de grafos (BFS, DFS, árvores
  geradoras, caminhos mínimos, fluxo máximo) não estão no arquivo**; Dijkstra, Kruskal e Ford-Fulkerson
  só aparecem no sumário completo e no índice.
- Útil para o app: cap. 2–3 (análise de algoritmos, notação assintótica), 6.5 (filas de prioridade, base de
  Prim/Dijkstra) e apêndice B.4 (grafos) e B.5 (árvores).

## Como as referências entram no app

1. Cada aula só exibe referência depois de conferida (capítulo/seção, sem transcrição).
2. Temas sem referência acessível usam apenas a ementa e ficam sem citação.
3. Conteúdo teórico sem simulador é marcado como **conteúdo teórico**.
