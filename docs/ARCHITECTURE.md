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

- **Domínio** (`src/domain`, a partir da Fase 2): TypeScript puro e imutável. Não importa React, React Native,
  Expo nem Zustand (será imposto por regra de ESLint). A posição dos vértices (`GraphLayout`) é separada do `Graph`.
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
  domain/              (Fase 2+) grafo, algoritmos, simulação
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
7. **Modelo de domínio (decisão para a Fase 2, ainda não implementado):** grafo **simples** no MVP (sem
   laços nem arestas paralelas, rejeitados com erro tipado); orientação **global** ao grafo (`directed`);
   `weight` e `capacity` distintos; IDs de vértice/aresta estáveis; arestas orientadas guardam `source → target`.
8. **Renderização (Fase 3):** SVG atrás de interface `GraphRenderer`, para trocar por Skia depois.
9. **Bibliografia fora do Git:** PDFs com direitos autorais ficam locais (`/*.pdf` ignorado).
10. **Ícones gerados por script** a partir de um glifo vetorial único, para manter o app e a ilustração
    do estado vazio (`GraphGlyph`) coerentes.
11. **Navegação por cartão com `useRouter().navigate`**, não `Link asChild`: no emulador o `Link asChild`
    descartou o `style` em forma de função do `Pressable` (cartão sem borda nem fundo).
12. **`labelVisibilityMode="labeled"`** nas abas: por padrão o Android só mostrava o rótulo da aba ativa;
    rótulos sempre visíveis ajudam a leitura e a acessibilidade.

## Estratégia de testes

- **Domínio:** Jest puro, em ambiente Node, ao lado do código; inclui propriedades (handshake lemma etc.).
- **Componentes/rotas:** Jest + React Native Testing Library (`jest-expo`); rotas via `renderRouter`.
- **Tema:** contraste calculado a partir dos tokens.
- **Em dispositivo (manual):** gestos pinch/pan/drag, safe areas, comportamento da barra de abas nativa,
  acessibilidade com TalkBack/VoiceOver. O iOS não pode ser testado em Windows; fica registrado como
  pendente nas entregas.
