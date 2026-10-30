// Preparação do ambiente de testes de interface (projeto `app` de jest.config.js).

// O Gesture Handler 3 liga a thread de interface do Worklets ao ser carregado. No Jest o Worklets usa a implementação
// em JS (resolver do Reanimated), na qual `getUIRuntimeHolder` lança "não suportado". Aqui ele devolve um objeto
// qualquer: o módulo nativo do Gesture Handler já é substituído por mocks (`jestSetup`) e ignora o valor.
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  getUIRuntimeHolder: () => ({}),
}));
