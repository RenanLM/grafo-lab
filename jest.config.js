/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Telas, componentes e rotas: ambiente React Native (jest-expo).
      displayName: 'app',
      preset: 'jest-expo',
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/domain/'],
    },
    {
      // Domínio puro: Node sem React Native. Importar RN/Expo aqui quebra o teste de propósito.
      displayName: 'domain',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/domain'],
      transform: {
        '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
      },
    },
  ],
};
