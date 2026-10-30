// Raiz do núcleo puro do editor (Fase 3): TypeScript sem React Native, como o domínio.
const CORE_ROOT = '<rootDir>/src/features/graph-editor/core/';

// Convenções do TypeScript puro (domínio e núcleo do editor): Node sem React Native, e o Babel do Expo só para
// tirar os tipos. Importar RN/Expo/Zustand nessas camadas quebra o teste de propósito.
const pureTypeScript = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Telas, componentes e rotas: ambiente React Native (jest-expo).
      displayName: 'app',
      preset: 'jest-expo',
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/domain/', CORE_ROOT],
      // Com o cache de transformação vazio (clone novo, CI), o primeiro render de uma rota carrega e transforma o
      // Gesture Handler e passou dos 5 s padrão. Com o cache quente cada teste leva centenas de milissegundos.
      testTimeout: 30000,
      // Reanimated e Worklets: no Jest usam a implementação em JS (sem módulo nativo), como a documentação deles prevê.
      resolver: 'react-native-reanimated/jest/resolver',
      // Gesture Handler: troca o módulo nativo por mocks e habilita `react-native-gesture-handler/jest-utils`.
      setupFiles: ['react-native-gesture-handler/jestSetup', '<rootDir>/jest.setup.js'],
    },
    {
      // Domínio puro: Node sem React Native.
      displayName: 'domain',
      ...pureTypeScript,
      roots: ['<rootDir>/src/domain'],
    },
    {
      // Núcleo puro do editor: Node sem React Native. Pode importar o domínio pelo alias `@/domain/graph`.
      displayName: 'editor-core',
      ...pureTypeScript,
      roots: [CORE_ROOT],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
  ],
};
