# GrafoLab

Aplicativo educacional nativo (Android e iOS) para estudar **Teoria dos Grafos**: construir grafos,
entender a matemática, executar algoritmos passo a passo e praticar com exercícios. Funciona offline.

> **Estado atual (Fase 1 — fundação):** navegação com as quatro abas, tema claro/escuro e identidade
> inicial. O editor de grafos, os algoritmos e os exercícios ainda **não existem**; as telas indicam isso.
> Veja `docs/ROADMAP.md`.

## Rodando

Requisitos: Node 22.13+ (ou 24.3+), npm e, para Android, o Android SDK.

```bash
npm install
npx expo start          # abre o menu; pressione "a" para o emulador Android
```

O Expo Go de cada versão só abre projetos da mesma SDK (aqui, SDK 58). Se o Expo Go da sua loja ainda
não for da SDK 58, use o emulador (o Expo CLI instala a versão certa) ou uma *development build*
(`npx expo install expo-dev-client` e `npx expo run:android`).

## Verificações

```bash
npm run check   # tsc + eslint + jest
```

## Documentação

- `docs/ROADMAP.md` — fases e tarefas
- `docs/ARCHITECTURE.md` — camadas, stack, decisões
- `docs/REFERENCIAS.md` — bibliografia e o que foi (ou não) conferido
- `CLAUDE.md` / `AGENTS.md` — instruções para o Claude Code
