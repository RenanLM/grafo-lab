import { render, screen, userEvent } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LabScreen } from './lab-screen';

// Se o domínio recusar alguma operação ao montar o exemplo, a tela mostra o motivo em português e não carrega nada pela metade.

jest.mock('./example-graph', () => ({
  ...jest.requireActual('./example-graph'),
  buildExampleGraph: jest.fn(() => ({ ok: false, error: { code: 'SELF_LOOP', vertexId: 'v1' } })),
}));

describe('LabScreen: o exemplo não pôde ser montado', () => {
  it('avisa com o erro do domínio em português, mantém o estado vazio e não desenha nada', async () => {
    await render(
      <GestureHandlerRootView>
        <LabScreen />
      </GestureHandlerRootView>,
    );
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Carregar exemplo' }));

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(/Não foi possível montar o exemplo\./);
    expect(alerta).toHaveTextContent(/Não é possível ligar um vértice a ele mesmo: grafos simples não têm laços\./);
    expect(screen.getByText('Nenhum grafo carregado')).toBeOnTheScreen();
    expect(screen.queryByTestId('canvas-area')).toBeNull();
  });
});
