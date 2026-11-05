import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

// Relativo à raiz do projeto (cwd do Jest); aponta para a árvore de rotas real.
const APP_DIR = './src/app';

// O primeiro `renderRouter` do arquivo carrega o roteador e todas as telas (o Laboratório puxa gesto, SVG e Zustand). Com a suíte
// inteira rodando em paralelo, isso passou uma vez dos 5 s padrão do Jest (o teste passa sozinho): folga contra essa corrida.
jest.setTimeout(20_000);

describe('rotas do aplicativo', () => {
  it.each([
    ['/', 'Abrir o Laboratório'],
    ['/aprender', 'Unidade 1 · 10 h'],
    ['/laboratorio', 'Nenhum grafo carregado'],
    ['/desafios', 'Ainda não há desafios'],
  ])('abre %s sem erro', async (url, textoEsperado) => {
    await renderRouter(APP_DIR, { initialUrl: url });

    expect(await screen.findByText(textoEsperado)).toBeOnTheScreen();
  });

  it('leva do Início aos destinos tocando nos cartões', async () => {
    const { getPathname } = await renderRouter(APP_DIR, { initialUrl: '/' });
    const user = userEvent.setup();

    await user.press(screen.getByRole('link', { name: /Abrir o Laboratório/ }));
    expect(await screen.findByText('Nenhum grafo carregado')).toBeOnTheScreen();
    expect(getPathname()).toBe('/laboratorio');
  });

  it('mostra a página em português para uma rota inexistente', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/nao-existe' });

    expect(await screen.findByText('Página não encontrada')).toBeOnTheScreen();
    expect(screen.getByText('Voltar ao início')).toBeOnTheScreen();
  });
});
