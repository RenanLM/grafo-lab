import { createCameraGestureController } from './camera-gesture-controller';
import { createCameraStore } from './camera-store';
import { NEUTRAL_CAMERA, panFromAnchor, pinchFromAnchor, screenToWorld, worldToScreen, type Camera, type Point } from './core';

// Gestos da câmera (ver camera-gesture-controller.ts): o pan de um dedo e a pinça, a partir de uma âncora e com a época do armazém. Sem React, sem a store do editor e sem o Gesture Handler:
// os eventos são os números que o detector entregaria.

const point = (x: number, y: number): Point => ({ x, y });
const ANCHOR: Camera = { x: 40, y: -30, scale: 2 };

function mount(initial: Camera = ANCHOR) {
  const store = createCameraStore(initial);
  const controller = createCameraGestureController(store);
  const liveCalls = jest.fn();
  const settledCalls = jest.fn();
  store.subscribe(liveCalls);
  store.subscribeSettled(settledCalls);
  return { store, controller, liveCalls, settledCalls };
}

/** O dedo desce em `start`, anda até o limiar e o pan ativa com o deslocamento `at` (desde que desceu). */
function activatePan(setup: ReturnType<typeof mount>, start: Point = point(100, 100), at: Point = point(14, 0)): void {
  setup.controller.armPan(start);
  setup.controller.panActivated(at);
}

describe('pan de um dedo: a câmera acompanha o dedo a partir da ativação', () => {
  it('o limiar é o do toque: 9,99 dp não pede a ativação, 10 dp pede (desde onde o dedo desceu)', () => {
    const { controller } = mount();
    controller.armPan(point(100, 100));

    expect(controller.panMoved(point(109.99, 100))).toBe(false);
    expect(controller.panMoved(point(110, 100))).toBe(true);
    expect(controller.panMoved(point(100 + 6, 100 - 8))).toBe(true);
  });

  it('sem sessão armada (o dedo não desceu no fundo), nunca pede a ativação', () => {
    const { controller } = mount();

    expect(controller.panMoved(point(500, 500))).toBe(false);
  });

  it('depois de ativado não pede de novo', () => {
    const setup = mount();
    activatePan(setup);

    expect(setup.controller.panMoved(point(500, 500))).toBe(false);
  });

  it('o quadro NÃO salta ao reconhecer o gesto: com o deslocamento da ativação, a câmera continua exatamente a mesma', () => {
    const setup = mount();
    activatePan(setup, point(100, 100), point(14, 3));
    setup.controller.panUpdate(point(14, 3)); // a primeira atualização, no mesmo ponto da ativação

    expect(setup.store.get()).toBe(ANCHOR);
    expect(setup.liveCalls).not.toHaveBeenCalled();
  });

  it('depois, a câmera é a da ativação deslocada pelo que o dedo andou DEPOIS dela: ativou em (14, 3), agora (44, −7): {40 + 30, −30 − 10, 2}', () => {
    const setup = mount();
    activatePan(setup, point(100, 100), point(14, 3));
    setup.controller.panUpdate(point(44, -7));

    expect(setup.store.get()).toStrictEqual({ x: 70, y: -40, scale: 2 });
    expect(setup.store.get()).toStrictEqual(panFromAnchor(ANCHOR, point(30, -10)));
  });

  it('o conteúdo acompanha o dedo 1 para 1: o ponto do mundo que estava sob o dedo na ativação anda o mesmo deslocamento na tela', () => {
    const setup = mount();
    activatePan(setup, point(100, 100), point(12, 0));
    const world = screenToWorld(ANCHOR, point(112, 100));
    setup.controller.panUpdate(point(12 + 35, 0 - 20));
    const shown = worldToScreen(setup.store.get(), world);

    expect(shown.x).toBeCloseTo(112 + 35, 9);
    expect(shown.y).toBeCloseTo(100 - 20, 9);
  });

  it('é calculada a partir da âncora, não da atualização anterior: a mesma posição final dá a mesma câmera por qualquer caminho', () => {
    const direct = mount();
    activatePan(direct);
    direct.controller.panUpdate(point(14 + 60, 20));

    const roundabout = mount();
    activatePan(roundabout);
    for (const d of [point(30, -50), point(-80, 90), point(14 + 60, 20)]) roundabout.controller.panUpdate(d);

    expect(roundabout.store.get()).toStrictEqual(direct.store.get());
  });

  it('a câmera viva muda a cada atualização e a assentada só no fim: soltar aplica o deslocamento final e assenta', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(24, 5));

    expect(setup.store.getSettled()).toBe(ANCHOR);
    expect(setup.settledCalls).not.toHaveBeenCalled();

    setup.controller.panRelease(point(64, 25));

    expect(setup.store.get()).toStrictEqual({ x: 90, y: -5, scale: 2 }); // 40 + 50, −30 + 25
    expect(setup.store.getSettled()).toBe(setup.store.get());
    expect(setup.settledCalls).toHaveBeenCalledTimes(1);
    expect(setup.controller.isPanning()).toBe(false);
  });

  it('o gesto cancelado PRESERVA a última câmera válida (não restaura) e a assenta', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(44, 10));
    const moved = setup.store.get();
    setup.controller.panCancel();

    expect(setup.store.get()).toBe(moved);
    expect(setup.store.getSettled()).toBe(moved);
    expect(moved).not.toBe(ANCHOR);
    expect(setup.controller.isPanning()).toBe(false);
  });

  it('um pan que não chegou a ativar (toque, rolagem ou falha) não mexe na câmera nem assenta nada', () => {
    const setup = mount();
    setup.controller.armPan(point(100, 100));
    setup.controller.panUpdate(point(50, 50)); // ainda não ativou
    setup.controller.finalizePan();

    expect(setup.store.get()).toBe(ANCHOR);
    expect(setup.liveCalls).not.toHaveBeenCalled();
    expect(setup.settledCalls).not.toHaveBeenCalled();
  });

  it('eventos depois do fim são ignorados (nenhum deslocamento tardio)', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panRelease(point(30, 10));
    const after = setup.store.get();
    setup.controller.panUpdate(point(500, 500));
    setup.controller.panRelease(point(900, 900));
    setup.controller.panCancel();

    expect(setup.store.get()).toBe(after);
  });

  it('deslocamento inválido (NaN) não move a câmera', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(NaN, 0));

    expect(setup.store.get()).toBe(ANCHOR);
  });

  it('nunca toca na escala', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(300, -200));

    expect(setup.store.get().scale).toBe(2);
  });
});

describe('pan de um dedo: sessões de outra época morrem', () => {
  it('um reset (outro grafo) entre descer e ativar: o gesto é de outra sessão e nunca move a câmera nova', () => {
    const setup = mount();
    setup.controller.armPan(point(100, 100));
    setup.store.reset(NEUTRAL_CAMERA);
    setup.controller.panActivated(point(14, 0));
    expect(setup.controller.isPanning()).toBe(false); // morreu na ativação (não só na primeira atualização recusada pelo armazém)
    setup.controller.panUpdate(point(80, 80));

    expect(setup.store.get()).toBe(NEUTRAL_CAMERA);
    expect(setup.controller.isPanning()).toBe(false);
  });

  it('um reset DURANTE o pan: as atualizações atrasadas são recusadas e não movem a câmera do grafo novo', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(40, 10));
    setup.store.reset(NEUTRAL_CAMERA);
    setup.controller.panUpdate(point(200, 200));
    setup.controller.panRelease(point(300, 300));

    expect(setup.store.get()).toBe(NEUTRAL_CAMERA);
    expect(setup.store.getSettled()).toBe(NEUTRAL_CAMERA);
  });

  it('um comando (Centralizar, Ajustar, redimensionamento) durante o pan vence: o gesto antigo não o desfaz', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(40, 10));
    const commanded: Camera = { x: 5, y: 6, scale: 1 };
    setup.store.command(commanded);
    setup.controller.panUpdate(point(90, 90));
    setup.controller.panRelease(point(120, 120));

    expect(setup.store.get()).toBe(commanded);
    expect(setup.store.getSettled()).toBe(commanded);
  });

  it('um gesto novo depois do comando vale (lê a época nova ao começar)', () => {
    const setup = mount();
    activatePan(setup);
    setup.store.command({ x: 0, y: 0, scale: 1 });
    setup.controller.finalizePan();
    activatePan(setup, point(50, 50), point(11, 0));
    setup.controller.panUpdate(point(31, 20));

    expect(setup.store.get()).toStrictEqual({ x: 20, y: 20, scale: 1 });
  });
});

describe('pinça de dois dedos: a câmera vem da âncora e da escala acumulada', () => {
  const FOCAL = point(180, 160);

  it('o ponto do mundo sob o foco fica sob o foco: neutra, foco (100, 50), escala acumulada 2 → {−100, −50, 2}', () => {
    const setup = mount(NEUTRAL_CAMERA);
    setup.controller.pinchActivated(point(100, 50), 1);
    setup.controller.pinchUpdate(point(100, 50), 2);

    expect(setup.store.get()).toStrictEqual({ x: -100, y: -50, scale: 2 });
    expect(setup.controller.isPinching()).toBe(true);
  });

  it('é `pinchFromAnchor` da câmera e do foco da ativação (o foco que se move desloca a câmera uma vez só)', () => {
    const setup = mount();
    setup.controller.pinchActivated(FOCAL, 1);
    setup.controller.pinchUpdate(point(200, 150), 1.5);

    expect(setup.store.get()).toStrictEqual(pinchFromAnchor(ANCHOR, FOCAL, 1.5, point(200, 150)));
  });

  it('a escala acumulada é relativa à da ativação: ativou com 1,25 e agora 2,5 → razão 2', () => {
    const setup = mount(NEUTRAL_CAMERA);
    setup.controller.pinchActivated(point(100, 50), 1.25);
    setup.controller.pinchUpdate(point(100, 50), 2.5);

    expect(setup.store.get()).toStrictEqual(pinchFromAnchor(NEUTRAL_CAMERA, point(100, 50), 2, point(100, 50)));
  });

  it('a pinça é calculada da âncora, não da atualização anterior: as atualizações intermediárias não deixam resíduo', () => {
    const direct = mount();
    direct.controller.pinchActivated(FOCAL, 1);
    direct.controller.pinchUpdate(point(190, 170), 1.8);

    const roundabout = mount();
    roundabout.controller.pinchActivated(FOCAL, 1);
    for (const [focal, scale] of [[point(185, 165), 1.1], [point(170, 150), 3], [point(190, 170), 1.8]] as const) {
      roundabout.controller.pinchUpdate(focal, scale);
    }

    expect(roundabout.store.get()).toStrictEqual(direct.store.get());
  });

  it('respeita os limites de escala (0,25 e 4) e o ponto sob o foco continua sob o foco', () => {
    const setup = mount(NEUTRAL_CAMERA);
    setup.controller.pinchActivated(point(100, 50), 1);
    setup.controller.pinchUpdate(point(100, 50), 50);
    expect(setup.store.get().scale).toBe(4);
    expect(worldToScreen(setup.store.get(), point(100, 50))).toStrictEqual({ x: 100, y: 50 });

    setup.controller.pinchUpdate(point(100, 50), 0.001);
    expect(setup.store.get().scale).toBe(0.25);
  });

  it('terminar a pinça (os dedos sobem) assenta a câmera; cancelar PRESERVA a câmera e também a assenta', () => {
    const ended = mount(NEUTRAL_CAMERA);
    ended.controller.pinchActivated(point(100, 50), 1);
    ended.controller.pinchUpdate(point(100, 50), 2);
    ended.controller.pinchEnd();
    expect(ended.store.getSettled()).toBe(ended.store.get());
    expect(ended.store.get().scale).toBe(2);
    expect(ended.controller.isPinching()).toBe(false);

    const cancelled = mount(NEUTRAL_CAMERA);
    cancelled.controller.pinchActivated(point(100, 50), 1);
    cancelled.controller.pinchUpdate(point(100, 50), 3);
    cancelled.controller.pinchCancel();
    expect(cancelled.store.get().scale).toBe(3); // nada foi restaurado
    expect(cancelled.store.getSettled()).toBe(cancelled.store.get());
  });

  it('a câmera viva muda a cada atualização e a assentada só no fim', () => {
    const setup = mount();
    setup.controller.pinchActivated(FOCAL, 1);
    setup.controller.pinchUpdate(FOCAL, 1.5);
    setup.controller.pinchUpdate(FOCAL, 1.7);

    expect(setup.liveCalls).toHaveBeenCalledTimes(2);
    expect(setup.settledCalls).not.toHaveBeenCalled();
    setup.controller.pinchEnd();
    expect(setup.settledCalls).toHaveBeenCalledTimes(1);
  });

  it('a pinça encerra um pan que estivesse ativo, assentando a câmera dele, e continua exatamente de onde o pan parou (sem salto)', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(44, 10));
    const panned = setup.store.get();
    setup.controller.pinchActivated(FOCAL, 1);

    expect(setup.controller.isPanning()).toBe(false);
    expect(setup.store.getSettled()).toBe(panned);
    setup.controller.pinchUpdate(FOCAL, 1); // escala 1, foco parado: a câmera não muda
    expect(setup.store.get()).toBe(panned);
    setup.controller.pinchUpdate(FOCAL, 2);
    expect(setup.store.get()).toStrictEqual(pinchFromAnchor(panned, FOCAL, 2, FOCAL));
  });

  it('escala de ativação inválida (0, negativa, NaN): nenhuma sessão, a câmera não muda', () => {
    for (const scale of [0, -1, NaN, Infinity]) {
      const setup = mount();
      setup.controller.pinchActivated(FOCAL, scale);
      setup.controller.pinchUpdate(FOCAL, 2);

      expect(setup.controller.isPinching()).toBe(false);
      expect(setup.store.get()).toBe(ANCHOR);
    }
  });

  it('atualização com valores inválidos não move a câmera (escala e foco)', () => {
    const setup = mount();
    setup.controller.pinchActivated(FOCAL, 1);
    setup.controller.pinchUpdate(FOCAL, NaN);
    setup.controller.pinchUpdate(point(NaN, 0), 2);

    expect(setup.store.get()).toBe(ANCHOR);
  });

  it('um reset ou um comando durante a pinça mata a sessão: atualizações atrasadas são recusadas', () => {
    const reset = mount();
    reset.controller.pinchActivated(FOCAL, 1);
    reset.store.reset(NEUTRAL_CAMERA);
    reset.controller.pinchUpdate(FOCAL, 3);
    expect(reset.store.get()).toBe(NEUTRAL_CAMERA);

    const commanded = mount();
    commanded.controller.pinchActivated(FOCAL, 1);
    const target: Camera = { x: 1, y: 2, scale: 1 };
    commanded.store.command(target);
    commanded.controller.pinchUpdate(FOCAL, 3);
    commanded.controller.pinchEnd();
    expect(commanded.store.get()).toBe(target);
  });

  it('atualizar sem ter ativado, ou depois do fim, não faz nada', () => {
    const setup = mount();
    setup.controller.pinchUpdate(FOCAL, 2);
    expect(setup.store.get()).toBe(ANCHOR);

    setup.controller.pinchActivated(FOCAL, 1);
    setup.controller.pinchEnd();
    setup.controller.pinchUpdate(FOCAL, 3);
    expect(setup.store.get()).toBe(ANCHOR);
  });
});

describe('abort e finalize', () => {
  it('abort assenta a câmera como está e descarta pan e pinça', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(44, 10));
    const moved = setup.store.get();
    setup.controller.abort();

    expect(setup.store.getSettled()).toBe(moved);
    expect(setup.controller.isPanning()).toBe(false);
    setup.controller.panUpdate(point(200, 200));
    expect(setup.store.get()).toBe(moved);
  });

  it('finalizar de novo (depois do fim) é inofensivo e não assenta outra vez', () => {
    const setup = mount();
    activatePan(setup);
    setup.controller.panUpdate(point(44, 10));
    setup.controller.panRelease(point(44, 10));
    const calls = setup.settledCalls.mock.calls.length;
    setup.controller.finalizePan();
    setup.controller.finalizePinch();
    setup.controller.abort();

    expect(setup.settledCalls).toHaveBeenCalledTimes(calls);
  });
});
