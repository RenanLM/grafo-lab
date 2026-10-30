@AGENTS.md

# GrafoLab — regras do projeto

App educacional nativo (Android/iOS) de Teoria dos Grafos, **offline-first**, em **português brasileiro**
(documentação e todo texto visível ao aluno). O prompt mestre está em `GrafoLab_Claude_Code_Prompt_Expo.md`.
Plano em `docs/ROADMAP.md`; arquitetura e decisões em `docs/ARCHITECTURE.md`; fontes em `docs/REFERENCIAS.md`.

## Como trabalhar

- Uma tarefa por vez, na ordem do roadmap. **Não avance de fase sem autorização.** Antes de cada tarefa:
  objetivo, arquivos, abordagem, riscos e critérios de aceite. Não instale dependências de fases futuras.
- Ao terminar: alterações, testes rodados e resultado, como validar no Android/iOS, limitações, próximo
  passo e mensagem de commit em inglês (Conventional Commits). **Nunca fazer commit/push sem autorização.**
- Não declare algo pronto se só existir tela ou animação. Marque "em breve" / "conteúdo teórico".
- Manter `docs/ROADMAP.md` e as decisões de `docs/ARCHITECTURE.md` atualizados.

## Arquitetura (resumo)

- `src/domain/**`: TypeScript puro (grafos, algoritmos, rastros). **Proibido** importar React, React Native,
  Expo ou Zustand. A posição dos vértices não faz parte do modelo matemático.
- Estado/orquestração (Zustand, histórico, simulação, persistência) separado da apresentação.
- Algoritmos não tocam em SVG, timers nem componentes: devolvem resultado + rastro determinístico.
- Coordenadas de mundo ≠ coordenadas de tela; converter sempre pelas funções de câmera.
- `src/app/**` só contém rotas finas; telas ficam em `src/features/<feature>/`, UI compartilhada em `src/components/`.

## Convenções

- Arquivos em kebab-case; alias `@/` aponta para `src/`; testes ao lado do código (`*.test.ts(x)`).
- `StyleSheet.create` no fim do arquivo do componente; cores só via tokens de `@/theme` (claro/escuro).
- Instalar pacotes com `npx expo install`. Conferir a doc da SDK instalada (hoje 58) antes de usar APIs.

## Comandos

```bash
npm run check       # typecheck + lint + testes (rodar antes de encerrar qualquer tarefa)
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest
npx expo start      # servidor de desenvolvimento
```
