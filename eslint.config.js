// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    // Fronteira da arquitetura: o domínio é TypeScript puro (ver docs/ARCHITECTURE.md).
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
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
                'zustand',
                'zustand/*',
                '@/*',
                '!@/domain',
                '!@/domain/**',
              ],
              message:
                'src/domain deve ser TypeScript puro: não importe React, React Native, Expo, Zustand nem camadas de UI.',
            },
          ],
        },
      ],
    },
  },
]);
