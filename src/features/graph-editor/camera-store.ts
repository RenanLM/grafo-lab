import { NEUTRAL_CAMERA, sameCamera, type Camera } from './core';

// Armazém da câmera (Fase 3, incremento 3.10): a ÚNICA fonte de verdade da câmera da sessão visual. TypeScript sem React, no formato de `useSyncExternalStore`
// (`subscribe` e `get`). A câmera NÃO está na store do editor (`editor-store.ts`), nem no `Graph`, no `GraphLayout`, no JSON ou nos instantâneos do desfazer: mover,
// ampliar, centralizar e ajustar nunca criam passo de histórico. Quem desenha, quem faz o hit-testing e quem calcula os gestos leem DESTE objeto; não existe uma segunda
// câmera para o gesto e outra para o SVG.
//
// Duas leituras, para a tela não ser percorrida a cada quadro de um gesto:
// - `get()` é a câmera VIVA e muda a cada atualização de um gesto. Só o renderizador do canvas a assina (`subscribe`), e o hit-testing a lê na hora do toque.
// - `getSettled()` é a câmera ASSENTADA e só muda quando uma sessão começa, um comando é dado ou um gesto termina (`subscribeSettled`). A tela assina esta (o resumo
//   acessível da cena e o aviso de "não coube" dependem dela), então um pan não re-renderiza a tela inteira a cada quadro.
//
// Época (`getEpoch`). Todo gesto de câmera guarda a época em que começou e só consegue alterar a câmera enquanto ela for a mesma (`update`, `settle`). `reset` (outro grafo ou
// exemplo) e `command` (Centralizar, Ajustar, redimensionamento) AVANÇAM a época, e com isso qualquer evento atrasado de um gesto anterior é ignorado: um gesto de um grafo
// não move a câmera do grafo seguinte, e um comando do aluno nunca é desfeito por um gesto que já estava a caminho.
//
// Complexidade: todas as operações são O(1) mais o aviso aos assinantes (O(assinantes)).

export type CameraStore = {
  /** A câmera atual (viva). A MESMA referência enquanto nada muda. */
  get(): Camera;
  /** A última câmera assentada (começo de sessão, comando ou fim de gesto). */
  getSettled(): Camera;
  /** A época atual: muda a cada `reset` e a cada `command`. */
  getEpoch(): number;
  /** Avisa a cada mudança da câmera viva. Devolve a função que cancela a assinatura. */
  subscribe(listener: () => void): () => void;
  /** Avisa quando a câmera assentada muda. */
  subscribeSettled(listener: () => void): () => void;
  /** Começa outra sessão (novo grafo, exemplo): câmera nova, assentada, época nova. */
  reset(camera: Camera): void;
  /** Comando explícito do aluno ou da tela (Centralizar, Ajustar, redimensionamento): câmera nova, assentada, época nova. */
  command(camera: Camera): void;
  /** Atualização de um gesto da época `epoch`: só vale se ela é a atual. Devolve se foi aplicada. A câmera viva muda; a assentada não. */
  update(camera: Camera, epoch: number): boolean;
  /** O gesto da época `epoch` terminou (ou foi cancelado): a câmera viva passa a ser a assentada. Devolve se valeu. */
  settle(epoch: number): boolean;
};

/** Cria o armazém com a câmera inicial dada (padrão: a neutra). */
export function createCameraStore(initial: Camera = NEUTRAL_CAMERA): CameraStore {
  let camera = initial;
  let settled = initial;
  let epoch = 0;
  const live = new Set<() => void>();
  const settledListeners = new Set<() => void>();

  const notify = (listeners: ReadonlySet<() => void>): void => {
    for (const listener of [...listeners]) listener();
  };

  /** Troca tudo de uma vez e avança a época: nenhum assinante vê a câmera nova com a época antiga. */
  const replace = (next: Camera): void => {
    epoch += 1;
    const liveChanged = next !== camera;
    const settledChanged = next !== settled;
    camera = next;
    settled = next;
    if (liveChanged) notify(live);
    if (settledChanged) notify(settledListeners);
  };

  return {
    get: () => camera,
    getSettled: () => settled,
    getEpoch: () => epoch,
    subscribe: (listener) => {
      live.add(listener);
      return () => {
        live.delete(listener);
      };
    },
    subscribeSettled: (listener) => {
      settledListeners.add(listener);
      return () => {
        settledListeners.delete(listener);
      };
    },
    reset: replace,
    command: replace,
    update: (next, forEpoch) => {
      if (forEpoch !== epoch) return false;
      if (next !== camera && !sameCamera(next, camera)) {
        camera = next;
        notify(live);
      }
      return true;
    },
    settle: (forEpoch) => {
      if (forEpoch !== epoch) return false;
      if (settled !== camera) {
        settled = camera;
        notify(settledListeners);
      }
      return true;
    },
  };
}
