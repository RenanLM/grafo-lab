import { createCameraStore } from './camera-store';
import { NEUTRAL_CAMERA, type Camera } from './core';

// Armazém da câmera (ver camera-store.ts): a câmera viva, a assentada e a época que invalida gestos atrasados. Sem React e sem a store do editor.

const A: Camera = { x: 10, y: 20, scale: 2 };
const B: Camera = { x: -5, y: 7, scale: 1.5 };
const C: Camera = { x: 100, y: 0, scale: 4 };

describe('createCameraStore: câmera viva e câmera assentada', () => {
  it('começa na câmera dada (padrão: a neutra), viva e assentada, na época 0', () => {
    const store = createCameraStore();

    expect(store.get()).toBe(NEUTRAL_CAMERA);
    expect(store.getSettled()).toBe(NEUTRAL_CAMERA);
    expect(store.getEpoch()).toBe(0);
    expect(createCameraStore(A).get()).toBe(A);
  });

  it('uma atualização de gesto muda a câmera VIVA e avisa os assinantes dela; a assentada fica e ninguém dela é avisado', () => {
    const store = createCameraStore();
    const live = jest.fn();
    const settled = jest.fn();
    store.subscribe(live);
    store.subscribeSettled(settled);

    expect(store.update(A, store.getEpoch())).toBe(true);

    expect(store.get()).toBe(A);
    expect(store.getSettled()).toBe(NEUTRAL_CAMERA);
    expect(live).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('assentar (o gesto terminou) iguala a assentada à viva e avisa quem assina a assentada, uma vez', () => {
    const store = createCameraStore();
    const settled = jest.fn();
    store.subscribeSettled(settled);
    store.update(A, 0);
    store.update(B, 0);

    expect(store.settle(0)).toBe(true);
    expect(store.getSettled()).toBe(B);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(store.settle(0)).toBe(true); // de novo: nada mudou, ninguém é avisado
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('uma câmera igual à atual (mesmos números) não avisa ninguém: nenhuma renderização à toa', () => {
    const store = createCameraStore(A);
    const live = jest.fn();
    store.subscribe(live);

    expect(store.update({ ...A }, 0)).toBe(true);
    expect(store.update(A, 0)).toBe(true);

    expect(live).not.toHaveBeenCalled();
    expect(store.get()).toBe(A); // continua a mesma referência
  });

  it('cancelar a assinatura a desliga (viva e assentada)', () => {
    const store = createCameraStore();
    const live = jest.fn();
    const settled = jest.fn();
    const offLive = store.subscribe(live);
    const offSettled = store.subscribeSettled(settled);
    offLive();
    offSettled();
    store.update(A, 0);
    store.settle(0);

    expect(live).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });
});

describe('createCameraStore: a época invalida gestos de outra sessão', () => {
  it('reset começa outra sessão: a câmera é a nova, viva e assentada, e a época avança', () => {
    const store = createCameraStore();
    const live = jest.fn();
    const settled = jest.fn();
    store.subscribe(live);
    store.subscribeSettled(settled);
    store.reset(A);

    expect(store.get()).toBe(A);
    expect(store.getSettled()).toBe(A);
    expect(store.getEpoch()).toBe(1);
    expect(live).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('um evento ATRASADO de um gesto da sessão anterior não move a câmera do grafo novo (atualizar e assentar são ignorados)', () => {
    const store = createCameraStore();
    const epoch = store.getEpoch();
    store.update(A, epoch); // o gesto está em andamento
    store.reset(NEUTRAL_CAMERA); // o aluno começa outro grafo

    expect(store.update(B, epoch)).toBe(false);
    expect(store.settle(epoch)).toBe(false);
    expect(store.get()).toBe(NEUTRAL_CAMERA);
    expect(store.getSettled()).toBe(NEUTRAL_CAMERA);
  });

  it('um comando (Centralizar, Ajustar, redimensionamento) assenta a câmera e invalida o gesto que estava a caminho', () => {
    const store = createCameraStore();
    const epoch = store.getEpoch();
    store.update(A, epoch);
    store.command(C);

    expect(store.get()).toBe(C);
    expect(store.getSettled()).toBe(C);
    expect(store.getEpoch()).toBe(epoch + 1);
    expect(store.update(B, epoch)).toBe(false); // o gesto antigo não desfaz o comando
    expect(store.get()).toBe(C);
  });

  it('um gesto da época atual funciona depois de um comando: ele só precisa ler a época nova ao começar', () => {
    const store = createCameraStore();
    store.command(A);
    const epoch = store.getEpoch();

    expect(store.update(B, epoch)).toBe(true);
    expect(store.settle(epoch)).toBe(true);
    expect(store.getSettled()).toBe(B);
  });

  it('o mesmo objeto de câmera num comando não avisa duas vezes quem já o vê, mas a época avança (o gesto antigo morre)', () => {
    const store = createCameraStore(A);
    const live = jest.fn();
    store.subscribe(live);
    store.command(A);

    expect(live).not.toHaveBeenCalled();
    expect(store.getEpoch()).toBe(1);
  });

  it('nenhum assinante vê a câmera nova com a época antiga: dentro do aviso a época já é a nova', () => {
    const store = createCameraStore();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getEpoch()));
    store.reset(A);

    expect(seen).toStrictEqual([1]);
  });

  it('um assinante que se cancela durante o aviso não quebra os demais', () => {
    const store = createCameraStore();
    const second = jest.fn();
    const off = store.subscribe(() => {
      off();
    });
    store.subscribe(second);
    store.update(A, 0);

    expect(second).toHaveBeenCalledTimes(1);
  });
});
