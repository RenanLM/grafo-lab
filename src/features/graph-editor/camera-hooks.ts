import { useSyncExternalStore } from 'react';

import type { CameraStore } from './camera-store';
import type { Camera } from './core';

// Ganchos de leitura do armazém da câmera (Fase 3, incremento 3.10). Só ligam `useSyncExternalStore` às duas leituras do armazém; nenhuma regra.

/** A câmera VIVA: muda a cada atualização de um gesto. Use só onde isso é preciso (o renderizador do canvas); a tela usa a assentada. */
export function useLiveCamera(store: CameraStore): Camera {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** A câmera ASSENTADA: só muda quando uma sessão começa, um comando é dado ou um gesto termina. */
export function useSettledCamera(store: CameraStore): Camera {
  return useSyncExternalStore(store.subscribeSettled, store.getSettled);
}
