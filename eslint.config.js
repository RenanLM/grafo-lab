// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Fronteiras da arquitetura (ver docs/ARCHITECTURE.md): o domínio e o núcleo puro do editor são TypeScript puro.
// `react-*` casa com o nome final do pacote em qualquer escopo: react-native, react-native-svg,
// react-native-gesture-handler, react-native-reanimated, react-native-worklets e também @shopify/react-native-skia.
// `@shopify/*` acrescenta os pacotes da Shopify cujo nome não começa com "react" (como @shopify/flash-list).
const NOT_PURE = [
  'react',
  'react/*',
  'react-*',
  'react-native/*',
  'expo',
  'expo-*',
  'expo/*',
  '@expo/*',
  '@react-native/*',
  '@react-navigation/*',
  '@shopify/*',
  'zustand',
  'zustand/*',
];

// `allowedAliases`: caminhos de `@/` que a camada pode importar (a si mesma e as de baixo). É uma expressão regular
// com antecipação negativa porque a negação por `!` do `group` não reabilita um caminho mais fundo cujo diretório
// pai foi barrado (`@/features/*`).
const restrictImports = (message, allowedAliases) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: NOT_PURE, message },
        { regex: `^@/(?!(${allowedAliases.join('|')})(/|$))`, message },
      ],
    },
  ],
});

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: restrictImports(
      'src/domain deve ser TypeScript puro: não importe React, React Native, Expo, Zustand nem camadas de UI.',
      ['domain'],
    ),
  },
  {
    // Núcleo do editor: pode usar o domínio e a si mesmo (a regra não enxerga imports relativos que saiam da pasta;
    // isso é conferido por `core/boundary.test.ts`).
    files: ['src/features/graph-editor/core/**/*.{ts,tsx}'],
    rules: {
      ...restrictImports(
        'O núcleo do editor deve ser TypeScript puro: só importa o domínio (@/domain) e a si mesmo; nada de React, React Native, Expo, gestos, SVG, animação, Zustand nem componentes.',
        ['domain', 'features/graph-editor/core'],
      ),
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXElement', message: 'O núcleo do editor não usa JSX.' },
        { selector: 'JSXFragment', message: 'O núcleo do editor não usa JSX.' },
      ],
    },
  },
]);
