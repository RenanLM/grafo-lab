import { act, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

// Ambiente de testes da Fase 3: prova que o Jest (jest-expo) renderiza SVG, gestos e Reanimated e mostra o jeito de
// simular gestos que os incrementos 3.6 a 3.10 vão usar. Não testa o editor (ele ainda não existe). Se a pilha mudar
// (versões, resolver, mocks de jest.config.js e jest.setup.js), estes testes quebram primeiro.

describe('react-native-svg', () => {
  it('renderiza os elementos que o renderizador do editor vai usar, com suas propriedades', async () => {
    await render(
      <Svg width={100} height={100} testID="svg">
        <G testID="grupo">
          <Line x1={10} y1={10} x2={90} y2={90} testID="aresta" />
          <Circle cx={10} cy={10} r={8} testID="vertice" />
          <SvgText x={10} y={10} testID="rotulo">
            A
          </SvgText>
        </G>
      </Svg>,
    );

    expect(screen.getByTestId('vertice').props).toMatchObject({ cx: 10, cy: 10, r: 8 });
    expect(screen.getByTestId('aresta').props).toMatchObject({ x1: 10, y2: 90 });
    expect(screen.getByTestId('rotulo')).toBeOnTheScreen();
    expect(screen.getByTestId('grupo')).toBeOnTheScreen();
  });
});

function Gestos() {
  const [toques, setToques] = useState(0);
  const [deslocamento, setDeslocamento] = useState(0);
  const toque = useTapGesture({ testID: 'toque', runOnJS: true, onDeactivate: () => setToques((n) => n + 1) });
  const arrasto = usePanGesture({ testID: 'arrasto', runOnJS: true, onUpdate: (e) => setDeslocamento(e.translationX) });
  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={toque}>
        <Text>{`toques: ${toques}`}</Text>
      </GestureDetector>
      <GestureDetector gesture={arrasto}>
        <Text>{`deslocamento: ${deslocamento}`}</Text>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

describe('react-native-gesture-handler 3', () => {
  it('simula toque e arrasto com os utilitários de teste e os callbacks atualizam a tela', async () => {
    await render(<Gestos />);
    expect(screen.getByText('toques: 0')).toBeOnTheScreen();

    const toque = createGestureController(getByGestureTestId('toque'));
    await act(async () => {
      toque.begin();
      toque.activate();
      toque.end();
    });
    expect(screen.getByText('toques: 1')).toBeOnTheScreen();

    const arrasto = createGestureController(getByGestureTestId('arrasto'));
    await act(async () => {
      arrasto.begin();
      arrasto.activate();
      arrasto.update({ translationX: 12 });
      arrasto.update({ translationX: 30 });
    });
    expect(screen.getByText('deslocamento: 30')).toBeOnTheScreen();
  });
});

function CaixaAnimada() {
  const x = useSharedValue(7);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View testID="caixa" style={style} />;
}

describe('react-native-reanimated e worklets', () => {
  it('monta um componente com valor compartilhado e estilo animado', async () => {
    await render(<CaixaAnimada />);

    expect(screen.getByTestId('caixa')).toBeOnTheScreen();
  });
});
