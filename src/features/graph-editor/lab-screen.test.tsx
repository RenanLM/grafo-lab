import { render, screen } from '@testing-library/react-native';

import { LabScreen } from './lab-screen';

describe('LabScreen', () => {
  it('explica o estado vazio e não finge ter um editor', async () => {
    await render(<LabScreen />);

    expect(screen.getByText('Laboratório')).toBeOnTheScreen();
    expect(screen.getByText('Seu laboratório está vazio')).toBeOnTheScreen();
    expect(screen.getByText('Editor em breve')).toBeOnTheScreen();
    expect(screen.getByText('O que você vai poder fazer aqui')).toBeOnTheScreen();
  });

  it('expõe os títulos como cabeçalhos para leitores de tela', async () => {
    await render(<LabScreen />);

    expect(screen.getByRole('header', { name: 'Laboratório' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Seu laboratório está vazio' })).toBeOnTheScreen();
  });
});
