import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { CanvasGestureDetector, TAP_MAX_DISTANCE_DP, type CanvasDragHandlers } from './canvas-gesture-detector';
import { DRAG_START_DISTANCE_DP, type Point } from './core';
import { ACTIVE_STATE, recordGestureStateRequests, sendTouches } from './gesture-test-helpers';

// Detector de gestos do canvas (ver canvas-gesture-detector.tsx), com os utilitários de teste do Gesture Handler 3: o toque é simulado
// pelo ciclo begin → activate → end, e o cancelamento por cancel/fail. O que verificamos no TOQUE: UM `onTap` por toque concluído, nenhum
// por toque cancelado ou falho, e o ponto entregue é o LOCAL (x, y), nunca o absoluto da tela. O ARRASTO tem o seu bloco no fim do arquivo.

function tree(onTap: (point: Point) => void, drag?: CanvasDragHandlers) {
  return (
    <GestureHandlerRootView>
      <CanvasGestureDetector onTap={onTap} drag={drag}>
        <View testID="canvas" />
      </CanvasGestureDetector>
    </GestureHandlerRootView>
  );
}

async function mountDetector(onTap: (point: Point) => void, drag?: CanvasDragHandlers) {
  const view = await render(tree(onTap, drag));
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

describe('CanvasGestureDetector: toque', () => {
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

// ARRASTO. O detector não decide nada: traduz o Gesture Handler em chamadas de `CanvasDragHandlers`. A ativação é MANUAL (`manualActivation`): o pan só
// ativa se o controlador responder `true` a `touchMove`, e o pedido é feito ao módulo nativo (`GestureStateManager.activate`, aqui registrado). O
// que o Jest NÃO mostra (o ScrollView cancelado pelo Gesture Handler quando o pan ativa) está no roteiro do emulador, em docs/ARCHITECTURE.md.

type FakeDrag = { [K in keyof CanvasDragHandlers]: jest.MockedFunction<CanvasDragHandlers[K]> };

/** Um `touchMove` que sempre responde `value`. */
const answer = (value: boolean) => jest.fn<boolean, [Point]>(() => value);

function fakeDrag(overrides: Partial<FakeDrag> = {}): FakeDrag {
  return {
    begin: jest.fn(),
    touchMove: answer(false),
    activated: jest.fn(),
    update: jest.fn(),
    release: jest.fn(),
    cancel: jest.fn(),
    finalize: jest.fn(),
    ...overrides,
  };
}

describe('CanvasGestureDetector: arrasto', () => {
  const recorder = { requests: jest.fn(), restore: () => {} };
  beforeEach(() => {
    Object.assign(recorder, recordGestureStateRequests());
  });
  afterEach(() => {
    recorder.restore();
  });

  async function mountWithDrag(drag: FakeDrag = fakeDrag()) {
    const onTap = jest.fn();
    await render(tree(onTap, drag));
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    const tapController = createGestureController(getByGestureTestId('canvas-tap'));
    const handlerTag = (getByGestureTestId('canvas-pan') as unknown as { handlerTag: number }).handlerTag;
    return { onTap, pan, tapController, drag, handlerTag };
  }

  it('o toque e o arrasto são dois gestos do MESMO detector, e os dois limites são o mesmo valor (até 10 dp é toque, de 10 dp em diante é arrasto)', async () => {
    await mountWithDrag();

    expect(getByGestureTestId('canvas-tap')).toBeDefined();
    expect(getByGestureTestId('canvas-pan')).toBeDefined();
    expect(DRAG_START_DISTANCE_DP).toBe(TAP_MAX_DISTANCE_DP);
  });

  it('o pan usa ativação MANUAL, roda no JavaScript, aceita um dedo e não tem limiar nativo (nem minDistance nem activeOffset)', async () => {
    await mountWithDrag();
    const { config } = getByGestureTestId('canvas-pan') as unknown as { config: Record<string, unknown> };

    expect(config.manualActivation).toBe(true);
    expect(config.runOnJS).toBe(true);
    expect(config.maxPointers).toBe(1);
    for (const key of ['minDist', 'activeOffsetXStart', 'activeOffsetXEnd', 'activeOffsetYStart', 'activeOffsetYEnd', 'failOffsetXStart', 'failOffsetYStart']) {
      expect(config[key]).toBeUndefined();
    }
  });

  it('ao descer, entrega o ponto LOCAL (x, y) ao controlador; as coordenadas absolutas da tela são ignoradas', async () => {
    const { pan, drag } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 70.5, y: 55.25, absoluteX: 400, absoluteY: 910 });
    });

    expect(drag.begin).toHaveBeenCalledTimes(1);
    expect(drag.begin).toHaveBeenCalledWith({ x: 70.5, y: 55.25 });
  });

  it('movimento sem sessão (touchMove devolve false): o controlador é consultado a cada movimento e o pan NUNCA é ativado — a página rola', async () => {
    const { pan, drag } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
    });
    await sendTouches('canvas-pan', 'move', { x: 61, y: 66 });
    await sendTouches('canvas-pan', 'move', { x: 62, y: 130 });

    expect(drag.touchMove.mock.calls).toStrictEqual([[{ x: 61, y: 66 }], [{ x: 62, y: 130 }]]);
    expect(recorder.requests).not.toHaveBeenCalled();
  });

  it('quando o controlador responde true, pede ao módulo nativo para ativar este pan, UMA vez por gesto, ainda que o dedo continue andando', async () => {
    const drag = fakeDrag({ touchMove: answer(true) });
    const { pan, handlerTag } = await mountWithDrag(drag);
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
    });
    await sendTouches('canvas-pan', 'move', { x: 75, y: 60 });
    await sendTouches('canvas-pan', 'move', { x: 90, y: 60 });
    await sendTouches('canvas-pan', 'move', { x: 120, y: 60 });

    expect(recorder.requests).toHaveBeenCalledTimes(1);
    expect(recorder.requests).toHaveBeenCalledWith(handlerTag, ACTIVE_STATE);
    expect(drag.touchMove).toHaveBeenCalledTimes(1); // depois do pedido, não pergunta mais
  });

  it('o pedido é feito de novo no gesto seguinte (o estado do gesto anterior não vaza)', async () => {
    const drag = fakeDrag({ touchMove: answer(true) });
    const { pan } = await mountWithDrag(drag);
    for (let round = 0; round < 2; round++) {
      await act(async () => {
        pan.begin({ x: 60, y: 60 });
      });
      await sendTouches('canvas-pan', 'move', { x: 80, y: 60 });
      await act(async () => {
        pan.fail({ x: 80, y: 60 });
      });
    }

    expect(recorder.requests).toHaveBeenCalledTimes(2);
  });

  it('sem controlador de arrasto (propriedade ausente), o pan nunca pede ativação', async () => {
    await render(tree(jest.fn()));
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
    });
    await sendTouches('canvas-pan', 'move', { x: 200, y: 60 });

    expect(recorder.requests).not.toHaveBeenCalled();
  });

  it('um movimento sem dedo registrado (allTouches vazio) é ignorado', async () => {
    const drag = fakeDrag({ touchMove: answer(true) });
    const { pan } = await mountWithDrag(drag);
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
    });
    await sendTouches('canvas-pan', 'move');

    expect(drag.touchMove).not.toHaveBeenCalled();
    expect(recorder.requests).not.toHaveBeenCalled();
  });

  // Visto no emulador: com a ativação manual a `translationX/Y` do Gesture Handler começa em 0 no ponto da ATIVAÇÃO, não onde o dedo desceu (o dedo já tinha
  // andado ~28 dp). Os eventos abaixo imitam isso: a translação é medida desde a ativação em (75, 60), enquanto o dedo desceu em (60, 60).
  it('arrasto ativo: o controlador recebe o DESLOCAMENTO desde onde o dedo desceu (posição local atual − a do begin), não a translationX/Y do gesto, que nasce na ativação', async () => {
    const { pan, drag } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
      pan.activate({ x: 75, y: 60, translationX: 0, translationY: 0 });
      pan.update({ x: 95, y: 80, translationX: 20, translationY: 20 });
      pan.update({ x: 110, y: 90, translationX: 35, translationY: 30 });
      pan.end({ x: 110, y: 90, translationX: 35, translationY: 30 });
    });

    expect(drag.activated).toHaveBeenCalledTimes(1);
    expect(drag.update.mock.calls).toStrictEqual([[{ x: 35, y: 20 }], [{ x: 50, y: 30 }]]); // 95 − 60, 80 − 60 …, e não 20, 20 …
    expect(drag.release).toHaveBeenCalledTimes(1);
    expect(drag.release).toHaveBeenCalledWith({ x: 50, y: 30 });
    expect(drag.cancel).not.toHaveBeenCalled();
    expect(drag.finalize).toHaveBeenCalledTimes(1);
  });

  it('arrasto cancelado (pelo sistema ou por outro gesto): cancel UMA vez, nenhum release, e finalize', async () => {
    const { pan, drag } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
      pan.activate({ x: 75, y: 60, translationX: 15, translationY: 0 });
      pan.update({ x: 95, y: 80, translationX: 35, translationY: 20 });
      pan.cancel({ x: 95, y: 80, translationX: 35, translationY: 20 });
    });

    expect(drag.cancel).toHaveBeenCalledTimes(1);
    expect(drag.release).not.toHaveBeenCalled();
    expect(drag.finalize).toHaveBeenCalledTimes(1);
  });

  it('gesto que falha antes de ativar: só finalize (nem activated, nem release, nem cancel)', async () => {
    const { pan, drag } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
      pan.fail({ x: 60, y: 60 });
    });

    expect(drag.finalize).toHaveBeenCalledTimes(1);
    expect(drag.activated).not.toHaveBeenCalled();
    expect(drag.release).not.toHaveBeenCalled();
    expect(drag.cancel).not.toHaveBeenCalled();
  });

  it('um toque curto chama onTap e NÃO confirma arrasto algum', async () => {
    const { tapController, drag, onTap } = await mountWithDrag();
    await act(async () => {
      tapController.begin({ x: 60, y: 60 });
      tapController.activate({ x: 60, y: 60 });
      tapController.end({ x: 60, y: 60 });
    });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(drag.release).not.toHaveBeenCalled();
    expect(drag.cancel).not.toHaveBeenCalled();
    expect(drag.activated).not.toHaveBeenCalled();
  });

  it('um arrasto concluído NÃO chama onTap (um gesto, uma operação)', async () => {
    const { pan, drag, onTap } = await mountWithDrag();
    await act(async () => {
      pan.begin({ x: 60, y: 60 });
      pan.activate({ x: 75, y: 60, translationX: 15, translationY: 0 });
      pan.end({ x: 75, y: 60, translationX: 15, translationY: 0 });
    });

    expect(drag.release).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('o controlador usado é sempre o mais recente: trocar a propriedade entre renderizações vale já para o próximo gesto', async () => {
    const first = fakeDrag();
    const second = fakeDrag();
    const onTap = jest.fn();
    const { rerender } = await render(tree(onTap, first));
    const pan = createGestureController(getByGestureTestId('canvas-pan'));
    await act(async () => {
      pan.begin({ x: 1, y: 2 });
      pan.fail({ x: 1, y: 2 });
    });
    await rerender(tree(onTap, second));
    await act(async () => {
      pan.begin({ x: 3, y: 4 });
      pan.fail({ x: 3, y: 4 });
    });

    expect(first.begin.mock.calls).toStrictEqual([[{ x: 1, y: 2 }]]);
    expect(second.begin.mock.calls).toStrictEqual([[{ x: 3, y: 4 }]]);
  });
});

// O módulo nativo que o Gesture Handler usa nos testes é um simulado (jestSetup); aqui só se espiona o envio das relações.
type RelationsModule = { configureRelations: (handlerTag: number, relations: unknown) => void };
const nativeModule = (jest.requireMock('react-native-gesture-handler/lib/module/RNGestureHandlerModule') as { default: RelationsModule }).default;

describe('CanvasGestureDetector: toque e arrasto competem', () => {
  // O simulador de gestos não negocia entre gestos, mas a composição escolhida chega ao módulo nativo como RELAÇÕES entre os gestos. Numa corrida (`useCompetingGestures`)
  // nenhum dos dois é simultâneo com o outro nem espera o outro: o primeiro que ativa cancela o outro. `useSimultaneousGestures` listaria um no outro.
  it('nenhuma relação entre o toque e o arrasto: sem simultâneo, sem espera e sem bloqueio (corrida)', async () => {
    const configure = jest.spyOn(nativeModule, 'configureRelations');
    await render(tree(jest.fn(), fakeDrag()));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60)); // as relações são enviadas no quadro seguinte
    });
    const tags = ['canvas-tap', 'canvas-pan'].map((id) => (getByGestureTestId(id) as unknown as { handlerTag: number }).handlerTag);

    for (const tag of tags) {
      const sent = configure.mock.calls.filter(([handlerTag]) => handlerTag === tag);
      expect(sent.length).toBeGreaterThan(0);
      for (const [, relations] of sent) {
        expect(relations).toStrictEqual({ simultaneousHandlers: [], waitFor: [], blocksHandlers: [] });
      }
    }
    configure.mockRestore();
  });
});
