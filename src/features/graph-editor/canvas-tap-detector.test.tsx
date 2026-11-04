import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import type { Point } from './core';
import { CanvasTapDetector, TAP_MAX_DISTANCE_DP } from './canvas-tap-detector';

// Detector de toque do canvas (ver canvas-tap-detector.tsx), com os utilitários de teste do Gesture Handler 3: o toque é simulado
// pelo ciclo begin → activate → end, e o cancelamento por cancel/fail. O que verificamos: UM `onTap` por toque concluído, nenhum
// por toque cancelado ou falho, e o ponto entregue é o LOCAL (x, y), nunca o absoluto da tela.

function tree(onTap: (point: Point) => void) {
  return (
    <GestureHandlerRootView>
      <CanvasTapDetector onTap={onTap}>
        <View testID="canvas" />
      </CanvasTapDetector>
    </GestureHandlerRootView>
  );
}

async function mountDetector(onTap: (point: Point) => void) {
  const view = await render(tree(onTap));
  const controller = createGestureController(getByGestureTestId('canvas-tap'));
  return { ...view, controller };
}

type Controller = Awaited<ReturnType<typeof mountDetector>>['controller'];
type Event = { x: number; y: number; absoluteX?: number; absoluteY?: number };

/** Um toque completo: o dedo desce, o toque é reconhecido e termina. */
async function tap(controller: Controller, event: Event): Promise<void> {
  await act(async () => {
    controller.begin(event);
    controller.activate(event);
    controller.end(event);
  });
}

describe('CanvasTapDetector', () => {
  it('um toque reconhecido chama onTap UMA vez, com o ponto local em dp', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await tap(controller, { x: 120, y: 90 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 120, y: 90 });
  });

  it('entrega as coordenadas LOCAIS: as absolutas da tela (absoluteX, absoluteY) são ignoradas', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await tap(controller, { x: 12.5, y: 40.25, absoluteX: 380, absoluteY: 910 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 12.5, y: 40.25 });
  });

  it('toque cancelado depois de reconhecido: nenhum onTap', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await act(async () => {
      controller.begin({ x: 10, y: 10 });
      controller.activate({ x: 10, y: 10 });
      controller.cancel({ x: 10, y: 10 });
    });

    expect(onTap).not.toHaveBeenCalled();
  });

  it('toque cancelado antes de reconhecido (begin → cancel): nenhum onTap', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await act(async () => {
      controller.begin({ x: 10, y: 10 });
      controller.cancel({ x: 10, y: 10 });
    });

    expect(onTap).not.toHaveBeenCalled();
  });

  it('toque que falha (o dedo andou demais, por exemplo): nenhum onTap', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await act(async () => {
      controller.begin({ x: 10, y: 10 });
      controller.fail({ x: 10, y: 10 });
    });

    expect(onTap).not.toHaveBeenCalled();
  });

  it('um toque cancelado não impede o seguinte: cancelar e depois tocar chama onTap uma vez', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await act(async () => {
      controller.begin({ x: 1, y: 1 });
      controller.cancel({ x: 1, y: 1 });
    });
    await tap(controller, { x: 77, y: 33 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 77, y: 33 });
  });

  it('toques consecutivos: um onTap para cada, na ordem e com o ponto de cada um', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await tap(controller, { x: 60, y: 60 });
    await tap(controller, { x: 180, y: 60 });
    await tap(controller, { x: 300, y: 60 });

    expect(onTap.mock.calls).toStrictEqual([[{ x: 60, y: 60 }], [{ x: 180, y: 60 }], [{ x: 300, y: 60 }]]);
  });

  it('o ponto entregue é um objeto novo a cada toque (sem aliasing entre toques)', async () => {
    const onTap = jest.fn();
    const { controller } = await mountDetector(onTap);
    await tap(controller, { x: 5, y: 6 });
    await tap(controller, { x: 5, y: 6 });

    expect(onTap.mock.calls[0]![0]).not.toBe(onTap.mock.calls[1]![0]);
  });

  // Visto no Android: sem limite de distância (o padrão da plataforma), um deslize rápido sobre o quadro, ao rolar a página, era
  // aceito como toque e criava um vértice. O simulador de gestos não mede distância, então o que se garante aqui é a CONFIGURAÇÃO
  // entregue ao Gesture Handler; o efeito foi conferido no emulador (ver docs/ARCHITECTURE.md).
  it('o gesto limita a distância que o dedo pode andar (maxDistance, em dp): um deslize não é um toque', async () => {
    await mountDetector(jest.fn());
    // o hook traduz `maxDistance` para o nome nativo `maxDist` (em dp), que é o que o módulo nativo recebe
    const { config } = getByGestureTestId('canvas-tap') as unknown as { config: { maxDist?: number } };

    expect(config.maxDist).toBe(TAP_MAX_DISTANCE_DP);
    // entre a folga de toque do Android (8 dp) e um valor que ainda deixe passar um deslize de rolagem (dezenas de dp)
    expect(TAP_MAX_DISTANCE_DP).toBeGreaterThanOrEqual(8);
    expect(TAP_MAX_DISTANCE_DP).toBeLessThanOrEqual(16);
  });

  // O simulador de gestos chama os callbacks de qualquer jeito, então a escolha de onde eles rodam e o cancelamento ao sair do quadro
  // só se garantem pela configuração entregue ao Gesture Handler.
  it('o callback roda no JavaScript (runOnJS) e o dedo que sai do quadro cancela o toque (padrão mantido)', async () => {
    await mountDetector(jest.fn());
    const { config } = getByGestureTestId('canvas-tap') as unknown as {
      config: { runOnJS?: boolean; shouldCancelWhenOutside?: boolean };
    };

    expect(config.runOnJS).toBe(true);
    expect(config.shouldCancelWhenOutside).toBe(true);
  });

  it('o callback é sempre o mais recente: trocar o onTap entre renderizações vale já para o próximo toque', async () => {
    const primeiro = jest.fn();
    const segundo = jest.fn();
    const { rerender, controller } = await mountDetector(primeiro);
    await tap(controller, { x: 1, y: 2 });
    await rerender(tree(segundo));
    await tap(controller, { x: 3, y: 4 });

    expect(primeiro.mock.calls).toStrictEqual([[{ x: 1, y: 2 }]]);
    expect(segundo.mock.calls).toStrictEqual([[{ x: 3, y: 4 }]]);
  });
});
